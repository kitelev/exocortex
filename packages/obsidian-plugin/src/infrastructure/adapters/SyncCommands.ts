/**
 * SyncCommands — «Exocortex: Sync» palette logic (RFC 4e4dc453 Phase B),
 * plus the split «Pull» / «Push» commands (#3473): both are SUBSETS of the
 * same engine cycle (pull = empty push set, push = detect+push with remote
 * changes pinned to re-derive). Sync stays the default/primary command —
 * the split commands are advanced ergonomics, not a replacement.
 *
 * Manual on-command sync (VL#1) of the materialized AssetSpace set (VL#4)
 * through the Phase A `SyncEngine` composed by `SyncDepsFactory`. Pure
 * logic — Obsidian wiring (plugin.addCommand + notifier) is injected.
 *
 * Cross-invocation exclusion (D11): the engine is built FRESH per invocation
 * (Issue #3382 fresh-PAT pattern), so the engine-internal guard does not
 * span invocations — this handler's `running` flag does, ACROSS all three
 * commands (a parallel Pull during a Sync is inadmissible). It is set
 * synchronously before the first `await` so a double command invocation
 * cannot slip past it. The same flag feeds `ProfileApplyManager.isSyncBusy`
 * (apply→sync direction); the sync→apply direction is covered by the
 * `_switchInProgress` veto inside the materialization gate AND the pre-run
 * check here.
 */

import type { RepoSyncResult, SyncDirection, SyncRepoSpec } from "exocortex";
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
  /** Label of the run holding the flag — busy notices name the real culprit. */
  private runningLabel = "Sync";

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
      this.deps.notify(
        `${this.runningLabel} already in progress (D11) — wait for it to finish`,
      );
      return;
    }
    this.running = true;
    this.runningLabel = "Sync parity report";
    try {
      if (this.deps.isSwitchInProgress()) {
        this.deps.notify(
          "A profile apply is in progress — run the parity report after it finishes (D11)",
        );
        return;
      }
      const log = this.deps.log ?? ((m: string): void => console.warn(m));
      const collection = await this.deps.collectSpecs();
      // Skipped-declaration diagnostics matter MOST in the on-demand
      // report — it is the command users debug "why is repo X missing"
      // with (code-reviewer LOW, PR #3474).
      for (const w of collection.warnings) log(`[ExoSync parity] ${w}`);
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

  /** Full pull→merge→push cycle — the default/primary command. */
  async invokeSync(): Promise<void> {
    return this.invoke("sync");
  }

  /**
   * Pull-only run (#3473): applies remote changes only — nothing leaves the
   * device (no commit, local changes stay undiffed). Advanced ergonomics
   * NEXT TO the default Sync, not a replacement: split-only usage
   * accumulates divergence and bigger merges.
   */
  async invokePull(): Promise<void> {
    return this.invoke("pull");
  }

  /**
   * Push-only run (#3473): sends the local delta only — remote changes are
   * never applied to disk (pinned to re-derive on the next pull/Sync). Same
   * advanced-ergonomics caveat as {@link invokePull}.
   */
  async invokePush(): Promise<void> {
    return this.invoke("push");
  }

  private label(direction: SyncDirection): string {
    return direction === "pull"
      ? "Pull"
      : direction === "push"
        ? "Push"
        : "Sync";
  }

  private async invoke(direction: SyncDirection): Promise<void> {
    const label = this.label(direction);
    if (this.running) {
      this.deps.notify(
        `${this.runningLabel} already in progress (D11) — wait for it to finish`,
      );
      return;
    }
    this.running = true;
    this.runningLabel = label;
    try {
      await this.runSync(direction);
    } catch (err) {
      // The palette callback fire-and-forgets this promise — surface the
      // failure instead of leaking an unhandled rejection. Redacted as
      // defence-in-depth: a credential-embedded URL error must not reach a
      // Notice (code-reviewer LOW, PR #3461).
      const msg = GitHubRestClient.redactTokens(
        err instanceof Error ? err.message : String(err),
      );
      this.deps.notify(`${label} failed: ${msg}`);
      (this.deps.log ?? ((m: string): void => console.warn(m)))(
        `[ExoSync] ${label.toLowerCase()} run threw: ${msg}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async runSync(direction: SyncDirection): Promise<void> {
    const label = this.label(direction);
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
    // conservation coverage this round). Split runs skip the whole parity
    // pass (#3473): they leave INTENTIONAL divergence (unpushed local /
    // unapplied remote), so M1/M2 would report guaranteed false positives.
    // The standalone parity-report command stays available for manual checks.
    const snapshot =
      direction === "sync"
        ? await this.deps.parity?.captureSnapshot(
            collection.specs as SyncRepoSpec[],
          )
        : undefined;

    this.deps.notify(`${label} started (${collection.specs.length} repo(s))…`);
    const results = await engine.syncAll(
      orderChildrenFirst(collection.specs as SyncRepoSpec[]),
      direction,
    );
    this.report(results, log, label);

    // E1 post-sync parity round (M1/M2). Best-effort: a parity failure is
    // logged + surfaced as its own Notice, never mutates the sync outcome.
    if (direction === "sync" && this.deps.parity !== undefined) {
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
    label = "Sync",
  ): void {
    let pushed = 0;
    let deleted = 0;
    let pulled = 0;
    let merged = 0;
    let quarantined = 0;
    let deferred = 0;
    let synced = 0;
    const problems: string[] = [];
    let authRequired = false;

    for (const r of results) {
      for (const w of r.warnings) log(`[ExoSync] ${r.repoKey}: ${w}`);
      if (r.detail !== undefined) {
        log(`[ExoSync] ${r.repoKey}: ${r.status} — ${r.detail}`);
      }
      pushed += r.pushedCount;
      deleted += r.pushedDeletes?.length ?? 0;
      pulled += r.pulledCount;
      merged += r.mergedCount;
      quarantined += r.quarantinedCount;
      deferred += r.deferredPaths?.length ?? 0;
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
        `${label} failed: the GitHub PAT is expired, revoked or under-scoped — update it in Settings → Exocortex`,
      );
      return;
    }

    // Split-run deferrals (#3473) are surfaced in the Notice — without this
    // the user only sees them in the console log. Pushed deletions (#3476)
    // surface as their own count: a real propagation, not a deferral.
    const counts =
      `pushed ${pushed}, pulled ${pulled}, merged ${merged}, quarantined ${quarantined}` +
      (deleted > 0 ? `, deleted ${deleted}` : "") +
      (deferred > 0 ? `, deferred ${deferred} (a full Sync resolves them)` : "");
    if (problems.length === 0) {
      this.deps.notify(
        `${label} done: ${synced}/${results.length} repo(s) — ${counts}`,
      );
    } else {
      this.deps.notify(
        `${label} finished with issues (${problems.join("; ")}) — ${counts}. See console for details.`,
      );
    }
  }
}
