/**
 * SyncCommands — «Exocortex: Sync» palette logic (RFC 4e4dc453 Phase B).
 *
 * Manual on-command sync (VL#1) of the materialized AssetSpace set (VL#4)
 * through the Phase A `SyncEngine` composed by `SyncDepsFactory`. Pure
 * logic — Obsidian wiring (plugin.addCommand + notifier) is injected.
 *
 * Cross-invocation exclusion (D11): the engine is built FRESH per invocation
 * (Issue #3382 fresh-PAT pattern), so the engine-internal guard does not
 * span invocations — this handler's `running` flag does. It is set
 * synchronously before the first `await` so a double command invocation
 * cannot slip past it. The same flag feeds `ProfileApplyManager.isSyncBusy`
 * (apply→sync direction); the sync→apply direction is covered by the
 * `_switchInProgress` veto inside the materialization gate AND the pre-run
 * check here.
 */

import type { RepoSyncResult, SyncRepoSpec } from "exocortex";
import { orderChildrenFirst } from "exocortex";

import { GitHubRestClient } from "./GitHubRestClient";
import type { SyncSpecCollection, BuiltSyncEngine } from "./SyncDepsFactory";
import type { ParityCheck } from "./ExoSyncParityFactory";

export interface SyncCommandsDeps {
  /** Enumerate the materialized sync unit (collectSyncRepoSpecs). */
  collectSpecs: () => Promise<SyncSpecCollection>;
  /** Build a fresh engine from current PAT (buildSyncEngine). */
  buildEngine: (
    asUidByRepoKey: ReadonlyMap<string, string>,
  ) => Promise<BuiltSyncEngine>;
  /** D11 — profile apply in flight (PluginLocalDataStore). */
  isSwitchInProgress: () => boolean;
  /** User-facing Notice (route through ObsidianNotificationService). */
  notify: (message: string) => void;
  /** Diagnostic sink for per-repo warnings/details (default console). */
  log?: (message: string) => void;
  /**
   * E1 parity harness (RFC 4e4dc453 Phase E). When wired, every sync round
   * is followed by an automatic M1/M2 validation pass (best-effort — a
   * parity failure NEVER affects the sync result), and the standalone
   * palette report becomes available. Optional so engine-only compositions
   * and existing tests stay valid.
   */
  parity?: ParityCheck;
}

export class SyncCommands {
  private readonly deps: SyncCommandsDeps;
  private running = false;

  constructor(deps: SyncCommandsDeps) {
    this.deps = deps;
  }

  /** Apply→sync exclusion input for `ProfileApplyManager.isSyncBusy`. */
  isBusy(): boolean {
    return this.running;
  }

  /**
   * Standalone «ExoSync parity report» palette command (E1). Read-only,
   * but still takes the `running` flag: a sync mutating disk mid-walk
   * would only yield inconclusive noise, and the flag also keeps a
   * profile apply from starting underneath the walk (D11 composition).
   */
  async invokeParityReport(): Promise<void> {
    if (this.deps.parity === undefined) {
      this.deps.notify("ExoSync parity harness is not wired");
      return;
    }
    if (this.running) {
      this.deps.notify("Sync already in progress (D11) — wait for it to finish");
      return;
    }
    this.running = true;
    try {
      if (this.deps.isSwitchInProgress()) {
        this.deps.notify(
          "A profile apply is in progress — run the parity report after it finishes (D11)",
        );
        return;
      }
      const collection = await this.deps.collectSpecs();
      if (collection.specs.length === 0) {
        this.deps.notify(
          "Nothing to check — no materialized AssetSpaces with a GitHub source found",
        );
        return;
      }
      this.deps.notify(
        `ExoSync parity check started (${collection.specs.length} repo(s))…`,
      );
      this.deps.notify(
        await this.deps.parity.runStandalone(collection.specs),
      );
    } catch (err) {
      const msg = GitHubRestClient.redactTokens(
        err instanceof Error ? err.message : String(err),
      );
      this.deps.notify(`ExoSync parity check failed: ${msg}`);
    } finally {
      this.running = false;
    }
  }

  async invokeSync(): Promise<void> {
    if (this.running) {
      this.deps.notify("Sync already in progress (D11) — wait for it to finish");
      return;
    }
    this.running = true;
    try {
      await this.runSync();
    } catch (err) {
      // The palette callback fire-and-forgets this promise — surface the
      // failure instead of leaking an unhandled rejection. Redacted as
      // defence-in-depth: a credential-embedded URL error must not reach a
      // Notice (code-reviewer LOW, PR #3461).
      const msg = GitHubRestClient.redactTokens(
        err instanceof Error ? err.message : String(err),
      );
      this.deps.notify(`Sync failed: ${msg}`);
      (this.deps.log ?? ((m: string): void => console.warn(m)))(
        `[ExoSync] sync run threw: ${msg}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async runSync(): Promise<void> {
    const log = this.deps.log ?? ((m: string): void => console.warn(m));

    if (this.deps.isSwitchInProgress()) {
      this.deps.notify(
        "A profile apply is in progress — sync after it finishes (D11)",
      );
      return;
    }

    const collection = await this.deps.collectSpecs();
    for (const w of collection.warnings) log(`[ExoSync] ${w}`);
    if (collection.specs.length === 0) {
      this.deps.notify(
        "Nothing to sync — no materialized AssetSpaces with a GitHub source found",
      );
      return;
    }

    const { engine, pat } = await this.deps.buildEngine(
      collection.asUidByRepoKey,
    );
    if (pat === null || pat.length === 0) {
      // R8 — never silently degrade to unauthenticated pushes.
      this.deps.notify(
        "ExoSync needs a GitHub PAT — configure it in Settings → Exocortex",
      );
      return;
    }

    // E1 conservation snapshot — MUST precede the sync mutation (best-effort
    // by contract: captureSnapshot never throws; undefined just means no
    // conservation coverage this round).
    const snapshot = await this.deps.parity?.captureSnapshot(
      collection.specs as SyncRepoSpec[],
    );

    this.deps.notify(`Sync started (${collection.specs.length} repo(s))…`);
    const results = await engine.syncAll(
      orderChildrenFirst(collection.specs as SyncRepoSpec[]),
    );
    this.report(results, log);

    // E1 post-sync parity round (M1/M2). Best-effort: a parity failure is
    // logged + surfaced as its own Notice, never mutates the sync outcome.
    if (this.deps.parity !== undefined) {
      try {
        this.deps.notify(
          await this.deps.parity.runAfterSync(
            collection.specs as SyncRepoSpec[],
            results,
            snapshot,
          ),
        );
      } catch (err) {
        const msg = GitHubRestClient.redactTokens(
          err instanceof Error ? err.message : String(err),
        );
        log(`[ExoSync] parity round failed: ${msg}`);
        this.deps.notify(`ExoSync parity check failed: ${msg}`);
      }
    }
  }

  private report(
    results: RepoSyncResult[],
    log: (message: string) => void,
  ): void {
    let pushed = 0;
    let pulled = 0;
    let merged = 0;
    let quarantined = 0;
    let synced = 0;
    const problems: string[] = [];
    let authRequired = false;

    for (const r of results) {
      for (const w of r.warnings) log(`[ExoSync] ${r.repoKey}: ${w}`);
      if (r.detail !== undefined) {
        log(`[ExoSync] ${r.repoKey}: ${r.status} — ${r.detail}`);
      }
      pushed += r.pushedCount;
      pulled += r.pulledCount;
      merged += r.mergedCount;
      quarantined += r.quarantinedCount;
      switch (r.status) {
        case "synced":
          synced++;
          break;
        case "auth-required":
          authRequired = true;
          problems.push(`${r.repoKey}: PAT rejected`);
          break;
        case "skipped-not-materialized":
        case "busy":
          // Skips are visible in the log; not a failure.
          break;
        default:
          problems.push(`${r.repoKey}: ${r.status}`);
      }
    }

    if (authRequired) {
      // R8 — explicit, never treated as success.
      this.deps.notify(
        "Sync failed: the GitHub PAT is expired, revoked or under-scoped — update it in Settings → Exocortex",
      );
      return;
    }

    const counts = `pushed ${pushed}, pulled ${pulled}, merged ${merged}, quarantined ${quarantined}`;
    if (problems.length === 0) {
      this.deps.notify(`Sync done: ${synced}/${results.length} repo(s) — ${counts}`);
    } else {
      this.deps.notify(
        `Sync finished with issues (${problems.join("; ")}) — ${counts}. See console for details.`,
      );
    }
  }
}
