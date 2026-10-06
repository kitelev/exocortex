import type { App, TFile } from "obsidian";
import {
  CreationGateSession,
  isUuid,
  namesCreationGateClass,
  parseCandidateFrontmatter,
  withCreationGate,
  type CreationGatePolicySource,
  type CreationGateWriterSession,
  type FrontmatterByRef,
} from "@kitelev/exocortex-core";

/**
 * req f5b79260 (ticket 316dd2be) — the plugin's side of the creation gate:
 * the same `exocmd__CreationGate` rule the CLI enforces, judged at the
 * plugin's write points (the grounding engine's writer and the service
 * registry's adapters), so a button press and `cli apply` give one verdict
 * (UI/CLI parity, #3417). Nothing here knows a rule's values.
 */

/**
 * One execution's view of the vault: every asset name — UID, label, alias,
 * basename — mapped to its file. Built from `metadataCache` when it is warm;
 * on a cold start (the cache not yet `initialized`) from the files on disk,
 * so a rule is never missed because Obsidian is still indexing.
 *
 * The index only LOCATES files; frontmatter is always read fresh from disk
 * (`vault.read`), because `metadataCache` lags a write made a moment earlier
 * by the same composite command (plugin-getfrontmatter-stale-in-composite).
 */
class PluginVaultIndex {
  private load?: Promise<{ byName: Map<string, TFile>; rules: TFile[] }>;

  constructor(private readonly app: App) {}

  private isWarm(): boolean {
    return (
      (this.app.metadataCache as unknown as { initialized?: boolean })
        .initialized === true
    );
  }

  private async frontmatterOf(
    file: TFile,
    warm: boolean,
  ): Promise<Record<string, unknown> | null> {
    if (warm) {
      return (
        (this.app.metadataCache.getFileCache(file)?.frontmatter as
          | Record<string, unknown>
          | undefined) ?? null
      );
    }
    try {
      return parseCandidateFrontmatter(await this.app.vault.cachedRead(file));
    } catch {
      return null;
    }
  }

  index(): Promise<{ byName: Map<string, TFile>; rules: TFile[] }> {
    this.load ??= (async () => {
      const byName = new Map<string, TFile>();
      const rules: TFile[] = [];
      const warm = this.isWarm();
      const add = (name: unknown, file: TFile): void => {
        if (typeof name !== "string") return;
        const key = name.trim().toLowerCase();
        if (key.length > 0 && !byName.has(key)) byName.set(key, file);
      };
      for (const file of this.app.vault.getMarkdownFiles()) {
        add(file.basename, file);
        const fm = await this.frontmatterOf(file, warm);
        if (!fm) continue;
        add(fm.exo__Asset_uid, file);
        add(fm.exo__Asset_label, file);
        const aliases = fm.aliases;
        for (const alias of Array.isArray(aliases) ? aliases : [aliases]) {
          add(alias, file);
        }
        if (namesCreationGateClass(fm.exo__Instance_class)) rules.push(file);
      }
      return { byName, rules };
    })();
    return this.load;
  }

  async fresh(file: TFile): Promise<Record<string, unknown> | null> {
    try {
      return parseCandidateFrontmatter(await this.app.vault.read(file));
    } catch {
      return null;
    }
  }
}

/** A gate session over one execution's view of the vault. */
export function createPluginCreationGateSession(app: App): CreationGateSession {
  const index = new PluginVaultIndex(app);
  const frontmatterByRef: FrontmatterByRef = async (ref) => {
    const wanted = ref.trim();
    if (wanted.length === 0) return null;
    const { byName } = await index.index();
    let file = byName.get(wanted.toLowerCase()) ?? null;
    if (!file && isUuid(wanted)) {
      const dest = app.metadataCache.getFirstLinkpathDest(wanted, "");
      file = dest ?? null;
    }
    return file ? index.fresh(file) : null;
  };
  const source: CreationGatePolicySource = {
    async candidates() {
      const { rules } = await index.index();
      const out: { path: string; frontmatter: Record<string, unknown> }[] = [];
      for (const file of rules) {
        const fm = await index.fresh(file);
        if (fm) out.push({ path: file.path, frontmatter: fm });
      }
      return out;
    },
  };
  return new CreationGateSession({ source, frontmatterByRef });
}

/**
 * The plugin builds its grounding engine ONCE, so "one session per command
 * execution" needs a scope: an execution opens a session (rules loaded once,
 * a fresh execution journal), nested executions — composite steps, workflow
 * post-actions — share it, and the outermost one closes it. A write outside
 * any execution (a service invoked directly) gets a session of its own.
 */
export class CreationGateScope implements CreationGateWriterSession {
  private current: CreationGateSession | null = null;
  private depth = 0;

  constructor(private readonly open: () => CreationGateSession) {}

  private session(): CreationGateSession {
    return this.current ?? this.open();
  }

  assertAllowed(path: string, content: string): Promise<void> {
    return this.session().assertAllowed(path, content);
  }

  remember(path: string, content: string): void {
    this.current?.remember(path, content);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth++ === 0) this.current = this.open();
    try {
      return await fn();
    } finally {
      if (--this.depth === 0) this.current = null;
    }
  }
}

/** Anything with an async `execute` — the plugin's GroundingExecutor. */
interface Executes {
  execute(...args: never[]): Promise<unknown>;
}

/** The plugin's gated writers, built once at load. */
export interface PluginCreationGate {
  readonly scope: CreationGateScope;
  /** The grounding engine's writer (create_instance). */
  readonly engineWriter: <T extends object>(writer: T) => T;
  /** An adapter for `populateServiceRegistry` (createAsset, subtree, duplicate, GenericAssetCreationService). */
  readonly serviceAdapter: <T extends object>(adapter: T) => T;
  /** Route every execution of `executor` through {@link CreationGateScope.run}. */
  readonly scopeExecutions: (executor: Executes) => void;
}

export function createPluginCreationGate(app: App): PluginCreationGate {
  const scope = new CreationGateScope(() => createPluginCreationGateSession(app));
  return {
    scope,
    engineWriter: (writer) => withCreationGate(writer, scope),
    serviceAdapter: (adapter) => withCreationGate(adapter, scope),
    scopeExecutions: (executor) => {
      const execute = executor.execute.bind(executor) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      (executor as unknown as { execute: (...args: unknown[]) => Promise<unknown> }).execute = (
        ...args: unknown[]
      ) => scope.run(() => execute(...args));
    },
  };
}
