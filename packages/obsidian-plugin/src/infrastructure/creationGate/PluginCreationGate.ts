import type { App, TFile } from "obsidian";
import {
  CREATION_GATE_CLASS_LABEL,
  CREATION_GATE_CLASS_UID,
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
 * What the gate needs from the vault, split by cost so that a vault WITHOUT a
 * rule asset — every vault today — pays almost nothing per command:
 *
 * - **rules** — on a warm `metadataCache` an in-memory pass over the
 *   frontmatter Obsidian already holds (no disk read); on a cold start (the
 *   cache not yet `initialized`) the files are read from disk, a text
 *   pre-filter decides which are parsed, and the result is KEPT across
 *   executions until the vault's file list changes (count of markdown files +
 *   newest mtime, both from Obsidian's in-memory list) — a cold start pays one
 *   pass, not one per command. A warm result is not kept: the cache may still
 *   be indexing a file that just arrived, and a kept miss would outlive it.
 * - **names** (UID / label / alias / basename → file) — built only when a
 *   rule applies and a chain has to be walked, once per execution.
 *
 * Frontmatter of a located file is always read fresh from disk (`vault.read`),
 * because `metadataCache` lags a write made a moment earlier by the same
 * composite command (plugin-getfrontmatter-stale-in-composite).
 */
export class PluginVaultView {
  private cold?: {
    stamp: string;
    rules?: Promise<TFile[]>;
    names?: Promise<Map<string, TFile>>;
  };

  constructor(private readonly app: App) {}

  isWarm(): boolean {
    return (
      (this.app.metadataCache as unknown as { initialized?: boolean })
        .initialized === true
    );
  }

  /** The cold-start memo for the vault's current file list. */
  private coldMemo(): NonNullable<PluginVaultView["cold"]> {
    const files = this.app.vault.getMarkdownFiles();
    let newest = 0;
    for (const file of files) {
      const mtime = (file as { stat?: { mtime?: number } }).stat?.mtime ?? 0;
      if (mtime > newest) newest = mtime;
    }
    const stamp = `${files.length}:${newest}`;
    if (this.cold?.stamp !== stamp) this.cold = { stamp };
    return this.cold;
  }

  private async diskText(file: TFile): Promise<string | null> {
    try {
      return await this.app.vault.cachedRead(file);
    } catch {
      return null;
    }
  }

  rules(): Promise<TFile[]> {
    if (this.isWarm()) {
      this.cold = undefined;
      return Promise.resolve(
        this.app.vault.getMarkdownFiles().filter((file) =>
          namesCreationGateClass(
            (
              this.app.metadataCache.getFileCache(file)?.frontmatter as
                | Record<string, unknown>
                | undefined
            )?.exo__Instance_class,
          ),
        ),
      );
    }
    const memo = this.coldMemo();
    memo.rules ??= (async () => {
      const uid = CREATION_GATE_CLASS_UID.toLowerCase();
      const label = CREATION_GATE_CLASS_LABEL.toLowerCase();
      const rules: TFile[] = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        const text = await this.diskText(file);
        if (text === null) continue;
        const lower = text.toLowerCase();
        if (!lower.includes(uid) && !lower.includes(label)) continue;
        try {
          if (namesCreationGateClass(parseCandidateFrontmatter(text).exo__Instance_class)) {
            rules.push(file);
          }
        } catch {
          continue;
        }
      }
      return rules;
    })();
    return memo.rules;
  }

  /** UID / label / alias / basename → file. Warm: from `metadataCache`; cold: from disk, kept like {@link rules}. */
  names(): Promise<Map<string, TFile>> {
    const warm = this.isWarm();
    const build = async (): Promise<Map<string, TFile>> => {
      const byName = new Map<string, TFile>();
      const add = (name: unknown, file: TFile): void => {
        if (typeof name !== "string") return;
        const key = name.trim().toLowerCase();
        if (key.length > 0 && !byName.has(key)) byName.set(key, file);
      };
      for (const file of this.app.vault.getMarkdownFiles()) {
        add(file.basename, file);
        let fm: Record<string, unknown> | null;
        if (warm) {
          fm =
            (this.app.metadataCache.getFileCache(file)?.frontmatter as
              | Record<string, unknown>
              | undefined) ?? null;
        } else {
          const text = await this.diskText(file);
          try {
            fm = text === null ? null : parseCandidateFrontmatter(text);
          } catch {
            fm = null;
          }
        }
        if (!fm) continue;
        add(fm.exo__Asset_uid, file);
        add(fm.exo__Asset_label, file);
        const aliases = fm.aliases;
        for (const alias of Array.isArray(aliases) ? aliases : [aliases]) {
          add(alias, file);
        }
      }
      return byName;
    };
    if (warm) return build();
    const memo = this.coldMemo();
    memo.names ??= build();
    return memo.names;
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
export function createPluginCreationGateSession(
  app: App,
  view: PluginVaultView = new PluginVaultView(app),
): CreationGateSession {
  let names: Promise<Map<string, TFile>> | undefined;
  const frontmatterByRef: FrontmatterByRef = async (ref) => {
    const wanted = ref.trim();
    if (wanted.length === 0) return null;
    names ??= view.names();
    let file = (await names).get(wanted.toLowerCase()) ?? null;
    if (!file && isUuid(wanted)) {
      const dest = app.metadataCache.getFirstLinkpathDest(wanted, "");
      file = dest ?? null;
    }
    return file ? view.fresh(file) : null;
  };
  const source: CreationGatePolicySource = {
    async candidates() {
      const out: { path: string; frontmatter: Record<string, unknown> }[] = [];
      for (const file of await view.rules()) {
        const fm = await view.fresh(file);
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
  const view = new PluginVaultView(app);
  const scope = new CreationGateScope(() => createPluginCreationGateSession(app, view));
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
