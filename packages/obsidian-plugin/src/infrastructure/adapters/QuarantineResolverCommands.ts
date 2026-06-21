/**
 * QuarantineResolverCommands — «Exocortex: Resolve sync conflicts» palette
 * logic (finding a0a3d1d6). Desktop↔Mobile parity by construction: it drives
 * the platform-free {@link QuarantineResolver} over the SAME REST transport the
 * sync engine uses (no Node `fs`/git — the resolver reads the AssetSpace head
 * and commits resolutions over `restCommit`, iOS-capable).
 *
 * Pure logic — the Obsidian Modal is injected (`openResolver`) so the command
 * orchestration (D11 guards, R8 PAT prompt, empty-state, error redaction) is
 * unit-testable without a renderer. The modal calls {@link resolveOne} back for
 * each user choice.
 *
 * Cross-invocation exclusion (D11): a resolution WRITES (disk + remote commit),
 * so it must not run during a sync or a profile apply, and a sync/apply must not
 * start while a resolution is in flight. The `running` flag (set synchronously
 * before the first await) plus the injected `isSyncBusy` / `isSwitchInProgress`
 * checks cover all three directions.
 */

import type {
  ConflictDetail,
  QuarantineResolver,
  ResolvableConflict,
  ResolveChoice,
  ResolveResult,
  SyncRepoSpec,
} from "@kitelev/exocortex-core";

import { GitHubRestClient } from "./GitHubRestClient";
import type { SyncSpecCollection } from "./SyncDepsFactory";

export interface BuiltQuarantineResolverLike {
  resolver: QuarantineResolver;
  pat: string | null;
}

/** Everything the injected modal needs to render + drive the resolver. */
export interface ResolverModalContext {
  resolver: QuarantineResolver;
  /** repoKey → spec, for resolving a chosen conflict. */
  specByRepoKey: ReadonlyMap<string, SyncRepoSpec>;
  conflicts: ResolvableConflict[];
  /** Materialise the three versions of one conflict (diff view). */
  loadConflict: (conflict: ResolvableConflict) => Promise<ConflictDetail>;
  /** Apply one resolution (wraps {@link QuarantineResolverCommands.resolveOne}). */
  resolveOne: (
    conflict: ResolvableConflict,
    choice: ResolveChoice,
  ) => Promise<ResolveResult | null>;
  notify: (message: string) => void;
  /**
   * MUST be called by the modal when it closes — releases the D11 busy flag so
   * a sync / apply can start again. The flag is held for the WHOLE modal session
   * (a resolution WRITES), not just the brief open.
   */
  onClose: () => void;
}

export interface QuarantineResolverCommandsDeps {
  /** Enumerate the materialized sync unit (collectSyncRepoSpecs). */
  collectSpecs: () => Promise<SyncSpecCollection>;
  /** Build a fresh resolver from the current PAT (buildQuarantineResolver). */
  buildResolver: () => Promise<BuiltQuarantineResolverLike>;
  /** D11 — profile apply in flight (PluginLocalDataStore). */
  isSwitchInProgress: () => boolean;
  /** D11 — a sync/pull/push in flight (SyncCommands.isBusy). */
  isSyncBusy: () => boolean;
  /** User-facing Notice (route through ObsidianNotificationService). */
  notify: (message: string) => void;
  /** Diagnostic sink (warnings / activity-log). Default console. */
  log?: (message: string) => void;
  /** Open the resolver UI. Injected so the orchestration stays testable. */
  openResolver: (ctx: ResolverModalContext) => void;
}

export class QuarantineResolverCommands {
  private readonly deps: QuarantineResolverCommandsDeps;
  private running = false;

  constructor(deps: QuarantineResolverCommandsDeps) {
    this.deps = deps;
  }

  /** Apply→sync→resolve exclusion input. */
  isBusy(): boolean {
    return this.running;
  }

  /** «Exocortex: Resolve sync conflicts» palette entry point. */
  async invokeResolve(): Promise<void> {
    if (this.running) {
      this.deps.notify(
        "Resolve already open — finish the current conflict first",
      );
      return;
    }
    if (this.deps.isSyncBusy()) {
      this.deps.notify("A sync is in progress — resolve after it finishes (D11)");
      return;
    }
    if (this.deps.isSwitchInProgress()) {
      this.deps.notify(
        "A profile apply is in progress — resolve after it finishes (D11)",
      );
      return;
    }
    // Held for the whole modal session (a resolution WRITES) — released by the
    // modal's onClose, NOT here. Cleared inline only on the no-open paths.
    this.running = true;
    let modalOpened = false;
    try {
      modalOpened = await this.openConflicts();
    } catch (err) {
      this.deps.notify(`Resolve failed: ${this.redact(err)}`);
      this.logWarn(`[ExoSync] resolve open threw: ${this.redact(err)}`);
    } finally {
      if (!modalOpened) this.running = false;
    }
  }

  /** @returns true when a modal was opened (it now owns the busy flag). */
  private async openConflicts(): Promise<boolean> {
    const collection = await this.deps.collectSpecs();
    for (const w of collection.warnings) this.logWarn(`[ExoSync] ${w}`);
    if (collection.specs.length === 0) {
      this.deps.notify(
        "Nothing to resolve — no materialized AssetSpaces with a GitHub source found",
      );
      return false;
    }

    const { resolver, pat } = await this.deps.buildResolver();
    if (pat === null || pat.length === 0) {
      // R8 — never silently degrade to unauthenticated reads.
      this.deps.notify(
        "ExoSync needs a GitHub PAT — configure it in Settings → Exocortex",
      );
      return false;
    }

    const specs = collection.specs as SyncRepoSpec[];
    const conflicts = await resolver.listOpenConflicts(specs);
    if (conflicts.length === 0) {
      // #a0a3d1d6 dissonance: the sync summary may report "quarantined N /
      // deferred N", yet the resolver legitimately lists nothing — duplicate
      // uids (#3477) suppress uid-identity, routing those conflicts to
      // cross-path `deferred` / ambiguous-quarantine that the genuine-3-way
      // filter excludes. Don't claim a misleading "✅"; point at the real fix.
      const dupCount = await resolver.detectDuplicateUids(specs);
      this.deps.notify(
        dupCount > 0
          ? `No directly-resolvable conflicts — but ${dupCount} duplicate uid(s) detected (#3477) block resolution. Run 'exosync dedup-uids' then Sync to surface them.`
          : "No open sync conflicts — nothing to resolve ✅",
      );
      return false;
    }

    const specByRepoKey = new Map(specs.map((s) => [s.repoKey, s]));
    this.deps.openResolver({
      resolver,
      specByRepoKey,
      conflicts,
      notify: this.deps.notify,
      loadConflict: (c) =>
        resolver.loadConflict(this.specFor(specByRepoKey, c), c.path),
      resolveOne: (c, choice) =>
        this.resolveOne(resolver, specByRepoKey, c, choice),
      onClose: () => {
        this.running = false;
      },
    });
    return true;
  }

  /**
   * Apply one user choice. Returns the result, or `null` on a (redacted)
   * failure already surfaced to the user — the modal keeps the conflict in the
   * list so the user can retry without losing anything (the disk choice and any
   * backup persist).
   */
  async resolveOne(
    resolver: QuarantineResolver,
    specByRepoKey: ReadonlyMap<string, SyncRepoSpec>,
    conflict: ResolvableConflict,
    choice: ResolveChoice,
  ): Promise<ResolveResult | null> {
    try {
      const spec = this.specFor(specByRepoKey, conflict);
      const result = await resolver.resolve(spec, conflict.path, choice);
      const where =
        result.awaitingPush === true
          ? "awaiting push (will sync on next Sync)"
          : result.pushedSha !== undefined
            ? `pushed @${result.pushedSha.slice(0, 7)}`
            : "remote already matched";
      this.deps.notify(
        `Resolved ${conflict.path} (${result.resolvedTo}) — ${where}`,
      );
      if (result.discardedLocalBackupPath !== undefined) {
        this.logWarn(
          `[ExoSync] discarded local version preserved at ${spec.localPath}/${result.discardedLocalBackupPath}`,
        );
      }
      return result;
    } catch (err) {
      this.deps.notify(`Resolve ${conflict.path} failed: ${this.redact(err)}`);
      this.logWarn(
        `[ExoSync] resolve ${conflict.path} threw: ${this.redact(err)}`,
      );
      return null;
    }
  }

  private specFor(
    specByRepoKey: ReadonlyMap<string, SyncRepoSpec>,
    conflict: ResolvableConflict,
  ): SyncRepoSpec {
    const spec = specByRepoKey.get(conflict.repoKey);
    if (spec === undefined) {
      throw new Error(
        `no materialized spec for ${conflict.repoKey} (was the AssetSpace unmounted?)`,
      );
    }
    return spec;
  }

  private redact(err: unknown): string {
    return GitHubRestClient.redactTokens(
      err instanceof Error ? err.message : String(err),
    );
  }

  private logWarn(message: string): void {
    (this.deps.log ?? ((m: string): void => console.warn(m)))(message);
  }
}
