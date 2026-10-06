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

/** Does this text name the rule class at all (UID or label, any case)? A text pre-filter, a superset of `namesCreationGateClass`. */
function namesRuleClass(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(CREATION_GATE_CLASS_UID.toLowerCase()) ||
    lower.includes(CREATION_GATE_CLASS_LABEL.toLowerCase())
  );
}

/**
 * A per-file index over the DISK, for a cold start (`metadataCache` not yet
 * `initialized`). Each file is read again only when its fingerprint — mtime and
 * size from Obsidian's in-memory file list, the same pair Obsidian's own
 * metadata cache keys on — differs from the one it was read at, so a cold start
 * pays one full disk pass and every later command reads only what changed: a
 * file the gate just wrote, a file the sync delivered, a file edited in place.
 * Nothing is trusted without reading it — a changed file is judged by what is
 * on disk now. A failed read keeps the file's previous value and leaves its
 * fingerprint unrecorded, so the next call reads it again. An entry is recorded
 * only AFTER its text was judged, so two commands judging at once can at worst
 * read a file twice, never skip one.
 */
class DiskIndex<T> {
  private readonly entries = new Map<string, { fp: string; value: T }>();

  constructor(
    private readonly app: App,
    private readonly extract: (text: string, file: TFile) => T,
  ) {}

  /** The current value of every markdown file, in Obsidian's file-list order. */
  async values(): Promise<{ file: TFile; value: T }[]> {
    const files = this.app.vault.getMarkdownFiles();
    const present = new Set<string>();
    const out: { file: TFile; value: T }[] = [];
    for (const file of files) {
      present.add(file.path);
      const stat = (file as { stat?: { mtime?: number; size?: number } }).stat;
      const fp = `${stat?.mtime ?? 0}:${stat?.size ?? 0}`;
      const entry = this.entries.get(file.path);
      if (entry && entry.fp === fp) {
        out.push({ file, value: entry.value });
        continue;
      }
      let text: string | null;
      try {
        text = await this.app.vault.cachedRead(file);
      } catch {
        text = null;
      }
      if (text === null) {
        if (entry) out.push({ file, value: entry.value });
        continue;
      }
      const value = this.extract(text, file);
      this.entries.set(file.path, { fp, value });
      out.push({ file, value });
    }
    for (const path of [...this.entries.keys()]) {
      if (!present.has(path)) this.entries.delete(path);
    }
    return out;
  }
}

/**
 * What the gate needs from the vault, split by cost so that a vault WITHOUT a
 * rule asset — every vault today — pays almost nothing per command:
 *
 * - **rules** — on a warm `metadataCache` an in-memory pass over the
 *   frontmatter Obsidian already holds (no disk read). A warm result is NOT
 *   kept: the cache may still be indexing a file that just arrived, and a kept
 *   miss would outlive it. On a cold start a {@link DiskIndex}: one disk pass,
 *   then only changed files; a text pre-filter decides which files are parsed.
 * - **names** (UID / label / alias / basename → file) — built once per session
 *   as soon as a rule asset exists (resolving a rule's own keys needs it), never
 *   without one. Cold: a second {@link DiskIndex}, filled only when needed.
 *
 * Frontmatter of a located file is always read fresh from disk (`vault.read`),
 * because `metadataCache` lags a write made a moment earlier by the same
 * composite command (plugin-getfrontmatter-stale-in-composite).
 */
export class PluginVaultView {
  private readonly coldRules: DiskIndex<boolean>;
  private readonly coldNames: DiskIndex<Record<string, unknown> | null>;

  constructor(private readonly app: App) {
    this.coldRules = new DiskIndex(app, (text) => {
      if (!namesRuleClass(text)) return false;
      try {
        return namesCreationGateClass(parseCandidateFrontmatter(text).exo__Instance_class);
      } catch {
        return false;
      }
    });
    this.coldNames = new DiskIndex(app, (text) => {
      try {
        return parseCandidateFrontmatter(text);
      } catch {
        return null;
      }
    });
  }

  isWarm(): boolean {
    return (
      (this.app.metadataCache as unknown as { initialized?: boolean })
        .initialized === true
    );
  }

  async rules(): Promise<TFile[]> {
    if (this.isWarm()) {
      return this.app.vault.getMarkdownFiles().filter((file) =>
        namesCreationGateClass(
          (
            this.app.metadataCache.getFileCache(file)?.frontmatter as
              | Record<string, unknown>
              | undefined
          )?.exo__Instance_class,
        ),
      );
    }
    return (await this.coldRules.values()).filter((e) => e.value).map((e) => e.file);
  }

  /** UID / label / alias / basename → file. Warm: from `metadataCache`; cold: from disk (see the class note). */
  async names(): Promise<Map<string, TFile>> {
    const byName = new Map<string, TFile>();
    const add = (name: unknown, file: TFile): void => {
      if (typeof name !== "string") return;
      const key = name.trim().toLowerCase();
      if (key.length > 0 && !byName.has(key)) byName.set(key, file);
    };
    const entries = this.isWarm()
      ? this.app.vault.getMarkdownFiles().map((file) => ({
          file,
          value:
            (this.app.metadataCache.getFileCache(file)?.frontmatter as
              | Record<string, unknown>
              | undefined) ?? null,
        }))
      : await this.coldNames.values();
    for (const { file, value: fm } of entries) {
      add(file.basename, file);
      if (!fm) continue;
      add(fm.exo__Asset_uid, file);
      add(fm.exo__Asset_label, file);
      const aliases = fm.aliases;
      for (const alias of Array.isArray(aliases) ? aliases : [aliases]) {
        add(alias, file);
      }
    }
    return byName;
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
