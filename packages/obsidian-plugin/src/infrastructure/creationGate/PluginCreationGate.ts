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
 * What the gate needs from the vault, split by cost so that a vault WITHOUT a
 * rule asset — every vault today — pays almost nothing per command:
 *
 * - **rules** — on a warm `metadataCache` an in-memory pass over the
 *   frontmatter Obsidian already holds (no disk read). A warm result is NOT
 *   kept: the cache may still be indexing a file that just arrived, and a kept
 *   miss would outlive it. On a cold start (the cache not yet `initialized`)
 *   the files are read from disk, a text pre-filter decides which are parsed,
 *   and the result is KEPT across commands until the file list changes — a
 *   fingerprint of every file's mtime and size from Obsidian's in-memory list.
 *   The gate's own allowed writes do not count as a change unless their text
 *   names the rule class: a file that does not name it cannot be a rule, so a
 *   cold start pays one disk pass, not one per creating command. A pass in which
 *   a read failed is not kept.
 * - **names** (UID / label / alias / basename → file) — built once per session
 *   as soon as a rule asset exists (resolving a rule's own keys needs it); never
 *   without one. On a cold start kept like the rules, but keyed on EVERY change,
 *   the gate's own writes included (a later command may name what it wrote).
 *
 * Frontmatter of a located file is always read fresh from disk (`vault.read`),
 * because `metadataCache` lags a write made a moment earlier by the same
 * composite command (plugin-getfrontmatter-stale-in-composite).
 */
export class PluginVaultView {
  private coldRules?: { stamp: string; rules?: Promise<TFile[]> };
  private coldNames?: { stamp: string; names?: Promise<Map<string, TFile>> };
  /** Cold start only: files the gate itself wrote, not naming the rule class → their fingerprint once seen. */
  private readonly ownWrites = new Map<string, string | null>();

  constructor(private readonly app: App) {}

  isWarm(): boolean {
    return (
      (this.app.metadataCache as unknown as { initialized?: boolean })
        .initialized === true
    );
  }

  /** The gate allowed and wrote `path`; see {@link rules} for why it matters. */
  noteOwnWrite(path: string, content: string): void {
    if (this.isWarm() || namesRuleClass(content)) return;
    this.ownWrites.set(path, null);
  }

  /**
   * `[stamp of every file, stamp without the gate's own non-rule writes]`.
   * An own write changed by someone else afterwards counts again.
   */
  private stamps(): [string, string] {
    let all = 0;
    let rulesOnly = 0;
    let counted = 0;
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const stat = (file as { stat?: { mtime?: number; size?: number } }).stat;
      const mtime = stat?.mtime ?? 0;
      const size = stat?.size ?? 0;
      all = (Math.imul(all, 31) + mtime + size) | 0;
      if (this.ownWrites.has(file.path)) {
        const seen = this.ownWrites.get(file.path);
        const now = `${mtime}:${size}`;
        if (seen === null) this.ownWrites.set(file.path, now);
        if (seen === null || seen === now) continue;
        this.ownWrites.delete(file.path);
      }
      counted++;
      rulesOnly = (Math.imul(rulesOnly, 31) + mtime + size) | 0;
    }
    return [`${files.length}:${all}`, `${counted}:${rulesOnly}`];
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
      this.coldRules = undefined;
      this.coldNames = undefined;
      this.ownWrites.clear();
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
    const stamp = this.stamps()[1];
    if (this.coldRules?.stamp !== stamp) this.coldRules = { stamp };
    const memo = this.coldRules;
    memo.rules ??= (async () => {
      const rules: TFile[] = [];
      let failed = false;
      for (const file of this.app.vault.getMarkdownFiles()) {
        const text = await this.diskText(file);
        if (text === null) {
          failed = true;
          continue;
        }
        if (!namesRuleClass(text)) continue;
        try {
          if (namesCreationGateClass(parseCandidateFrontmatter(text).exo__Instance_class)) {
            rules.push(file);
          }
        } catch {
          continue;
        }
      }
      if (failed) memo.rules = undefined;
      return rules;
    })();
    return memo.rules;
  }

  /** UID / label / alias / basename → file. Warm: from `metadataCache`; cold: from disk, kept (see the class note). */
  names(): Promise<Map<string, TFile>> {
    const warm = this.isWarm();
    let failed = false;
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
          if (text === null) failed = true;
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
    const stamp = this.stamps()[0];
    if (this.coldNames?.stamp !== stamp) this.coldNames = { stamp };
    const memo = this.coldNames;
    memo.names ??= build().then((byName) => {
      if (failed) memo.names = undefined;
      return byName;
    });
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

  constructor(
    private readonly open: () => CreationGateSession,
    private readonly onWritten?: (path: string, content: string) => void,
  ) {}

  private session(): CreationGateSession {
    return this.current ?? this.open();
  }

  assertAllowed(path: string, content: string): Promise<void> {
    return this.session().assertAllowed(path, content);
  }

  remember(path: string, content: string): void {
    this.current?.remember(path, content);
    this.onWritten?.(path, content);
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
  const scope = new CreationGateScope(
    () => createPluginCreationGateSession(app, view),
    (path, content) => view.noteOwnWrite(path, content),
  );
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
