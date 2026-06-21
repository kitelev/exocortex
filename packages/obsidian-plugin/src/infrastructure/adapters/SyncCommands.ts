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

import type {
  RepoSyncResult,
  SyncDirection,
  SyncProgressEvent,
  SyncRepoSpec,
} from "exocortex";
import {
  aggregateTimings,
  formatRepoTimings,
  formatTimingsLine,
  orderChildrenFirst,
  totalMs,
} from "exocortex";

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
  /**
   * D11 — the quarantine resolver modal is open / a resolution is in flight.
   * A resolution WRITES disk + remote + the SAME device-local watermark, so a
   * sync must refuse while it is held (the apply guard already does, via
   * `isSyncBusy`; this closes the symmetric sync direction — code-reviewer
   * HIGH-2). Optional (absent ⇒ no resolver wired): a forward-reference
   * closure breaks the construction-order cycle (sync is built before the
   * resolver).
   */
  isResolverBusy?: () => boolean;
  /** User-facing Notice (route through ObsidianNotificationService). */
  notify: (message: string) => void;
  /** Diagnostic sink for per-repo warnings/details (default console). */
  log?: (message: string) => void;
  /**
   * Info-level sink for the success summary (#3489). Info channel default
   * is {notice:false, console:true, file:false}, so this produces exactly
   * one console line without duplicating the existing notify() toast or
   * writing to the file log. Optional — absent callers get no-op.
   */
  logInfo?: (message: string) => void;
  /**
   * #3498 — opt-in durable verbose FILE sink for the sync step trace. Wired to
   * append directly to the plugin file log, gated on the `verboseSyncLogging`
   * setting (read live in the plugin wiring), INDEPENDENT of the global
   * `logChannels.info.file` toggle. Every step line (start, each in-flight
   * per-step line, each per-repo outcome line) is forwarded here; when the
   * setting is off the wired callback is a no-op, so the trace stays
   * console-only (#3186). Absent ⇒ no-op (engine-only / test compositions).
   */
  logVerbose?: (message: string) => void;
  /**
   * #3499 — opt-in verbose step toasts. When this returns true, the per-step
   * info trace lines (start + per-repo) are ALSO surfaced as user-facing
   * Notices on top of their console line. Default off (absent / returns
   * false): a Sync touches 14+ repos = 14+ toasts, so this is only for users
   * actively watching a run.
   *
   * Read live (a callback, like `isSwitchInProgress`) so toggling the setting
   * in Settings takes effect on the very next sync without a plugin reload —
   * the whole point of the toggle is immediate observability.
   *
   * The summary is intentionally NOT re-mirrored here: the «… done» summary
   * Notice (#3489) already fires unconditionally, so gating the summary info
   * line would produce TWO summary toasts (AC #3499 "no double summary"). The
   * #3495 quarantine-sink warn is likewise excluded — it owns its own Notice.
   */
  stepNoticesEnabled?: () => boolean;
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
  /**
   * #3495 one-shot guard — the quarantine-sink-not-configured warn fires at
   * most ONCE per plugin load (SyncCommands is a singleton per onload). A
   * conflict re-derives every sync, so without the latch the warn would nag
   * on every run; the latch keeps it to a single high-signal notice.
   */
  private quarantineSinkWarned = false;

  constructor(deps: SyncCommandsDeps) {
    this.deps = deps;
  }

  /** Apply→sync exclusion input for `ProfileApplyManager.isSyncBusy`. */
  isBusy(): boolean {
    return this.running;
  }

  /**
   * #3499 — mirror a step trace line to a user-facing Notice when the opt-in
   * verbose toggle is on. No-op by default (toggle off / absent): the step
   * line stays console-only as today. Only the start + per-repo step lines
   * call this; the summary keeps its single #3489 Notice (no double toast).
   */
  private maybeStepNotice(message: string): void {
    if (this.deps.stepNoticesEnabled?.() === true) this.deps.notify(message);
  }

  /**
   * #3498 — render an in-flight engine progress event into a step trace line.
   * Coarse, human-readable, mirrors the issue's example wording.
   */
  private static progressStepLine(event: SyncProgressEvent): string {
    const phaseText: Record<SyncProgressEvent["phase"], string> = {
      detecting: "detecting changes…",
      "pulling-remote": "pulling remote tree…",
      merging: "merge layer firing…",
    };
    return `[ExoSync] ${event.repoKey}: ${phaseText[event.phase]}`;
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
    // RFC 0002 §3.2 (P3) — coherent with the «Check sync status» command name.
    this.runningLabel = "Check sync status";
    try {
      if (this.deps.isSwitchInProgress()) {
        this.deps.notify(
          "A profile apply is in progress — run the parity report after it finishes (D11)",
        );
        return;
      }
      if (this.deps.isResolverBusy?.() === true) {
        this.deps.notify(
          "The conflict resolver is open — run the parity report after it closes (D11)",
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
      this.deps.notify(await this.deps.parity.runStandalone(collection.specs));
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
    if (this.deps.isResolverBusy?.() === true) {
      this.deps.notify(
        "The conflict resolver is open — sync after it closes (D11)",
      );
      return;
    }

    const collection = await this.deps.collectSpecs();
    for (const w of collection.warnings) log(`[ExoSync] ${w}`);
    // FINDING-3 (al-ux-findings) — surface mounted-but-undeclared packs so the
    // user is not silently surprised that edits in an ad-hoc «Add a knowledge
    // pack» repo (added by URL outside the registry, hence no AssetSpace
    // descriptor) never push. One notice per run; also logged for the record.
    if (collection.mountedNotDeclared.length > 0) {
      const n = collection.mountedNotDeclared.length;
      log(
        `[ExoSync] ${n} mounted pack(s) not synced (no AssetSpace descriptor): ` +
          collection.mountedNotDeclared.join(", "),
      );
      this.deps.notify(
        `${n} mounted pack(s) won't sync — they have no AssetSpace descriptor ` +
          "(added by URL outside the registry). Their edits stay local.",
      );
    }
    if (collection.specs.length === 0) {
      this.deps.notify(
        "Nothing to sync — no materialized AssetSpaces with a GitHub source found",
      );
      return;
    }

    const { engine, pat, quarantineConfigured } = await this.deps.buildEngine(
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
    // #3496 — step trace start line on the info channel (console-only on the
    // default logChannels.info config = {notice:false,file:false}; honours the
    // user's routing like every other info log, #3186). The notify() above is
    // the single toast; this is the diagnostic counterpart.
    const logInfo = this.deps.logInfo ?? ((_m: string): void => undefined);
    const startLine = `[ExoSync] ${label} started — ${collection.specs.length} repo(s), direction=${direction}`;
    logInfo(startLine);
    // #3499 — verbose toggle: also surface the start step as a Notice.
    this.maybeStepNotice(startLine);
    // #3498 — durable verbose file trace (no-op unless verboseSyncLogging on).
    this.deps.logVerbose?.(startLine);
    // #3498 — in-flight per-step progress: each phase the engine enters while
    // processing a repo (detecting / pulling remote tree / merge layer firing)
    // surfaces on the info channel and the verbose file sink. Observation-only:
    // the engine swallows a throwing observer, so this never affects the sync.
    const onProgress = (event: SyncProgressEvent): void => {
      const line = SyncCommands.progressStepLine(event);
      logInfo(line);
      this.deps.logVerbose?.(line);
    };
    const results = await engine.syncAll(
      orderChildrenFirst(collection.specs as SyncRepoSpec[]),
      direction,
      onProgress,
    );
    const summary = this.report(results, log, label);

    // #3495 — surface the silent degraded mode: a conflict was quarantined
    // but no durable sink exists to save it. High-signal (only on an actual
    // quarantined conflict, never on clean / deferred-only runs) and one-shot
    // per session. Skipped on auth-required runs — the PAT prompt already
    // owns that failure and the conflict re-surfaces on the next good run.
    this.maybeWarnQuarantineSink(quarantineConfigured, summary);

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

  /**
   * Aggregate the per-repo results into the user-facing Notice + the #3489
   * info summary, AND emit the #3496 per-repo step lines on the info channel.
   * Returns the aggregate the caller needs for the #3495 degraded-mode warn —
   * computed up front so it is available even on the auth-required early
   * return.
   */
  private report(
    results: RepoSyncResult[],
    log: (message: string) => void,
    label = "Sync",
  ): { quarantined: number; deferred: number; authRequired: boolean } {
    const logInfo = this.deps.logInfo ?? ((_m: string): void => undefined);
    let pushed = 0;
    let deleted = 0;
    let pulled = 0;
    let merged = 0;
    let quarantined = 0;
    let deferred = 0;
    let synced = 0;
    // Deferred-push outbox flush totals (PR-3b — offline resolutions).
    let resolvedPushed = 0;
    let resolvedReconflicted = 0;
    // #a0a3d1d6 — surface duplicate-uid anomalies (#3477) in the summary: the
    // ChangeDetector already emits a per-uid warning, but the user only sees
    // them buried in the console log. Counting the distinct uids here lets the
    // toast point at `exosync dedup-uids` (CLI) / the dedup helper.
    const dupUids = new Set<string>();
    const problems: string[] = [];
    let authRequired = false;

    for (const r of results) {
      for (const w of r.warnings) {
        log(`[ExoSync] ${r.repoKey}: ${w}`);
        const dup = /duplicate uid ([^\s]+)/.exec(w);
        if (dup !== null) dupUids.add(dup[1]);
      }
      if (r.detail !== undefined) {
        log(`[ExoSync] ${r.repoKey}: ${r.status} — ${r.detail}`);
      }
      // #3496 — per-repo outcome line on the info channel (console-only on the
      // default logChannels.info config, no file/notice spam #3186; honours the
      // user's info routing if they opt in). Fires for EVERY repo (clean ones
      // too) and on every direction/status: the step trace is most valuable
      // precisely when a run misbehaves, so it is NOT gated on success.
      const stepLine = SyncCommands.repoStepLine(r);
      logInfo(stepLine);
      // #3499 — verbose toggle: also surface the per-repo step as a Notice.
      // This is the firehose the toggle exists to gate (14+ repos = 14+ toasts).
      this.maybeStepNotice(stepLine);
      // #3498 — durable verbose file trace (no-op unless verboseSyncLogging on).
      this.deps.logVerbose?.(stepLine);
      // ExoSync Phase 0 (measure-first) — per-AS phase breakdown. Goes to the
      // ALWAYS-ON activity log (logInfo, #3540 — persistent + iPhone-readable
      // in-app) and the durable file trace, never a toast (would be the same
      // 14-repo firehose). This is the per-phase + per-AS data Andrey reads to
      // decide which optimisation Phase 1 picks.
      if (r.timings !== undefined && totalMs(r.timings) > 0) {
        const timingLine = formatRepoTimings(r.repoKey, r.timings);
        logInfo(timingLine);
        this.deps.logVerbose?.(timingLine);
      }
      pushed += r.pushedCount;
      deleted += r.pushedDeletes?.length ?? 0;
      pulled += r.pulledCount;
      merged += r.mergedCount;
      quarantined += r.quarantinedCount;
      deferred += r.deferredPaths?.length ?? 0;
      resolvedPushed += r.outboxPushedCount ?? 0;
      resolvedReconflicted += r.outboxReconflictedCount ?? 0;
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

    const summary = { quarantined, deferred, authRequired };

    // ExoSync Phase 0 (measure-first) — aggregate the per-AS breakdowns into a
    // run total and surface the dominant phase. The concise line rides the
    // single summary toast (as a 2nd line — preserves the "no double summary"
    // toast invariant #3499) so Andrey reads which phase dominated immediately
    // on iPhone; the same line also goes to the always-on activity log.
    const aggTimings = aggregateTimings(results);
    const timingLine =
      totalMs(aggTimings) > 0 ? formatTimingsLine(aggTimings) : "";
    if (timingLine !== "") {
      logInfo(timingLine);
      this.deps.logVerbose?.(timingLine);
    }
    const timingSuffix = timingLine !== "" ? `\n${timingLine}` : "";

    if (authRequired) {
      // R8 — explicit, never treated as success.
      this.deps.notify(
        `${label} failed: the GitHub PAT is expired, revoked or under-scoped — update it in Settings → Exocortex`,
      );
      return summary;
    }

    // Split-run deferrals (#3473) are surfaced in the Notice — without this
    // the user only sees them in the console log. Pushed deletions (#3476)
    // surface as their own count: a real propagation, not a deferral.
    // Quarantine (#a0a3d1d6): point the user at the resolver — without this the
    // count is a dead-end ("quarantined 14" but no way to act). dup-uids (#3477)
    // get their own pointer to `exosync dedup-uids`.
    // #a0a3d1d6 dissonance-fix (3a — UX honesty): the "run 'Resolve sync
    // conflicts'" hint is MISLEADING when duplicate uids are present — those
    // conflicts are routed to cross-path deferred / ambiguous-quarantine that
    // the resolver's genuine-3-way filter excludes, so it would answer "nothing
    // to resolve". When dup-uids block resolution, point at the real first step
    // (dedup-uids → Sync) instead of the resolver.
    const dupsBlock = dupUids.size > 0;
    const counts =
      `pushed ${pushed}, pulled ${pulled}, merged ${merged}, quarantined ${quarantined}` +
      (quarantined > 0
        ? dupsBlock
          ? " (⚠ duplicate uids block the resolver — run 'exosync dedup-uids' then Sync first)"
          : " (run 'Resolve sync conflicts' to fix)"
        : "") +
      (deleted > 0 ? `, deleted ${deleted}` : "") +
      (deferred > 0
        ? `, deferred ${deferred} (a full Sync resolves them)`
        : "") +
      (resolvedPushed > 0
        ? `, pushed ${resolvedPushed} resolved conflict(s)`
        : "") +
      (resolvedReconflicted > 0
        ? `, ${resolvedReconflicted} resolution(s) re-conflicted (remote moved — resolve again)`
        : "") +
      (dupUids.size > 0
        ? `, ${dupUids.size} duplicate uid(s) (run 'exosync dedup-uids')`
        : "");
    if (problems.length === 0) {
      this.deps.notify(
        `${label} done: ${synced}/${results.length} repo(s) — ${counts}${timingSuffix}`,
      );
      logInfo(
        `[ExoSync] ${label} OK: ${synced}/${results.length} repo(s) — ${counts}`,
      );
    } else {
      this.deps.notify(
        `${label} finished with issues (${problems.join("; ")}) — ${counts}. See console for details.${timingSuffix}`,
      );
    }
    return summary;
  }

  /**
   * #3496 — one info-channel line per repo, summarising the phase outcomes
   * (detect/pull/merge/push/watermark) the engine recorded for it. Pure
   * formatting from {@link RepoSyncResult}; no engine plumbing. In-flight
   * per-step progress (detecting…/pulling…/merging…) would need a SyncEngine
   * progress callback — deferred to a follow-up to keep the sync engine
   * untouched.
   */
  private static repoStepLine(r: RepoSyncResult): string {
    const deletes = r.pushedDeletes?.length ?? 0;
    const deferred = r.deferredPaths?.length ?? 0;
    const parts = [
      `pushed ${r.pushedCount}`,
      `pulled ${r.pulledCount}`,
      `merged ${r.mergedCount}`,
      `quarantined ${r.quarantinedCount}`,
    ];
    if (deletes > 0) parts.push(`deleted ${deletes}`);
    if (deferred > 0) parts.push(`deferred ${deferred}`);
    return `[ExoSync] ${r.repoKey}: ${r.status} — ${parts.join(", ")}`;
  }

  /**
   * #3495 — degraded-mode warn when the engine had no durable quarantine sink
   * AND a conflict was quarantined. ⚠ VESTIGIAL since the offline-resolution
   * program: the device-local conflict cache is now ALWAYS the (durable) sink,
   * so `quarantineConfigured` is always `true` and this returns at the first
   * guard — it never fires. Retained (with its tested logic) only so the
   * #3495 contract is preserved if a "sink unavailable" condition is ever
   * reintroduced; the full plumbing removal is a follow-up. The message no
   * longer points at the (removed) quarantine-repo setting.
   */
  private maybeWarnQuarantineSink(
    quarantineConfigured: boolean,
    summary: { quarantined: number; authRequired: boolean },
  ): void {
    if (quarantineConfigured) return;
    if (summary.authRequired) return;
    if (summary.quarantined <= 0) return;
    if (this.quarantineSinkWarned) return;
    this.quarantineSinkWarned = true;
    const message =
      `Exocortex: no durable quarantine sink — ${summary.quarantined} conflict(s) ` +
      `re-derive but aren't saved. Reinstall/repair the plugin if this persists.`;
    this.deps.notify(message);
    (this.deps.logInfo ?? ((_m: string): void => undefined))(
      `[ExoSync] ${message}`,
    );
  }
}
