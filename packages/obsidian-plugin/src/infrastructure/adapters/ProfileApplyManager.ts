import { Platform } from "obsidian";
import type { App } from "obsidian";
import type { ApplyPlan, IConfirmGate } from "exocortex";
import {
  derivePath,
  assertTsFloorReconciled,
  PLUGIN_UI_FLOOR,
  CATALOG_KEEP_NAMESPACES,
  transitiveDependsOnClosure,
  TsFloorViolationError,
  isAssetSpaceFrontmatter,
} from "exocortex";

import { PluginLockManager } from "./PluginLockManager";
import { nodeFsPromises } from "./lazyNodeModules";
import type { AssetSpaceManager, AssetSpaceInfo } from "./AssetSpaceManager";
import type { ICacheLayer } from "./SwitchCacheLayer";
import type { GitSubmoduleOps } from "./GitSubmoduleOps";
import type { RestAssetSpaceMount } from "./RestAssetSpaceMount";
import type { UncommittedChangesGuard } from "./UncommittedChangesGuard";
import type { PluginLocalDataStore } from "./PluginLocalDataStore";
import { TS_FLOOR_ASSETSPACE_UIDS } from "./ProfileOnloadWiring";

/**
 * ProfileApplyManager — coordinates profile switching:
 *   1. acquire persistent lock (B.6)
 *   2. write journal entry «starting»
 *   3. compute effective ontology set (с TS-floor per Vision Lock #17)
 *   4. persist `settings.activeProfileUid` BEFORE filesystem changes (Architect #2)
 *   5. trigger RDF re-index with new filter
 *   6. clear in-progress flag
 *   7. write journal entry «completed»
 *
 * v3 backward-compat scope: NO destroy/pull (Phase C+D deferred). Only RDF
 * graph filter update via re-index. Filesystem state untouched.
 *
 * Recovery: at plugin load, call `recoverIfNeeded()`. If last journal entry
 * shows incomplete switch + `_switchInProgress=true`, idempotently re-trigger
 * the re-index (no destructive rollback needed in v3 — re-index is pure).
 *
 * Per RFC 0a0791c1 §B.4 + Vision Lock #17 + Architect #2.
 */

/**
 * `exo__Profile` class UID (frozen by RFC b6ba5595).
 *
 * RFC 01a83de8 Phase 2 unified the profile model onto this single `exo__Profile`
 * class; the mount-state switch ({@link applyProfile}) and effective-set
 * resolution both operate on it.
 */
export const PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

/**
 * TS-floor (Vision Lock #17): ontology URIs that are ALWAYS in the effective
 * set, regardless of profile config. Hardcoded — never destroyable.
 *
 * floor = `{exo}` only (RFC 5aa2a73a / #3440 collapsed the floor to the SDK
 * core). `exocmd` and `shared-identities` are OPTIONAL — a profile may omit
 * them. Kept in sync with the AS-UID floor `TS_FLOOR_ASSETSPACE_UIDS={exo}`.
 * Prevents plugin self-brick if a user accidentally removes $exo from a profile.
 */
export const TS_FLOOR_ONTOLOGY_URIS: ReadonlySet<string> = new Set([
  "https://exocortex.my/ontology/exo",
]);

/**
 * Pattern для detecting "shared identities"-style ontologies. Ontology URIs
 * containing `shared-identities` или `shared-` prefix are auto-included
 * in the floor (R15 mitigation — `discoverSharedOntologies`).
 */
export const TS_FLOOR_SHARED_PATTERN = /(?:^|\/)shared-/;

export interface ProfileResolution {
  /** Profile UID. */
  uid: string;
  /**
   * Directly declared `exo__Profile_includes` — AssetSpace UIDs (RFC 01a83de8
   * Phase 2 retarget Ontology→AssetSpace). Consumed by the mount-state
   * hard/REST switch effective-set derivation (the query-time soft-filter that
   * also read these was removed in RFC 01a83de8 Phase 3 T3b).
   */
  includes: string[];
  /**
   * Parent profile UID (`exo__Profile_imports`, single-parent MVP 0..1; resolves
   * transitive). Field name `extends` retained internally to bound the rename
   * cascade. May be null/undefined.
   */
  extends?: string | null;
  /** Display label (used in user-facing Notice). */
  label?: string;
}

/**
 * Resolves a Profile asset by UID. Production implementation reads via
 * Obsidian metadataCache + vault.adapter; tests provide an in-memory map.
 */
export interface IProfileResolver {
  resolve(profileUid: string): Promise<ProfileResolution | null>;
  /**
   * Optional discovery hook — returns ALL ontology URIs matching the shared
   * identities pattern. Production scans vault triples; tests can return [].
   */
  discoverSharedOntologies(): Promise<string[]>;
}

export interface IRdfIndexer {
  /**
   * Re-index the RDF graph from the current vault state. Profile switching is
   * mount-state based (RFC 01a83de8 Phase 3 — the query-time soft-filter was
   * removed); the refresh re-indexes whatever AssetSpace folders are currently
   * materialised on disk.
   */
  refresh(): Promise<void>;
}

export interface SwitchSettings {
  /**
   * Last-applied profile cache (RFC 0a0791c1 Phase 5 T2). The former dual
   * Knowledge/Focus slots were retired together with the soft RDF filter.
   */
  activeProfileUid: string | null;
  _switchInProgress: boolean;
}

export interface ISettingsStore {
  load(): Promise<SwitchSettings>;
  save(s: SwitchSettings): Promise<void>;
}

/**
 * Journal entry shape — widened для apply phase events per RFC
 * 22b50a17 F2 (per-AS recovery granularity). Reindex-only path continues using
 * the three base phases (`starting`/`completed`/`failed`); apply
 * emits the extended phase set with `as` field for per-AS events.
 */
export interface SwitchJournalEntry {
  phase:
    | "starting"
    | "completed"
    | "failed"
    // Apply extended phases (RFC 22b50a17 §Solution Architecture):
    | "apply-starting"
    | "phase1-pulling"
    | "phase1-pulled"
    | "phase1-done"
    | "aborted-phase1"
    | "phase2-start"
    | "phase2-destroy-cached"
    | "phase2-destroyed"
    | "phase2-materializing"
    | "phase2-materialized"
    | "phase2-done"
    | "git-commit-done"
    | "apply-completed"
    | "apply-failed"
    | "recovery-restoring"
    | "recovery-completed";
  targetUid: string;
  ts: string; // ISO
  /** Per-AS UID for phase2-destroy-cached / phase2-materialized etc. */
  as?: string;
  elapsedMs?: number;
  error?: string;
}

export interface ProfileApplyManagerOptions {
  app: App;
  lockMgr: PluginLockManager;
  resolver: IProfileResolver;
  rdfIndexer: IRdfIndexer;
  settingsStore: ISettingsStore;
  /** Journal path relative to vault root. Default `.exocortex/switch-journal.jsonl`. */
  journalPath?: string;
  /** Max `_extends` depth — guards against cycles. Default 5 (per RFC b6ba5595 validation). */
  maxExtendsDepth?: number;
  /** Injectable Date.now для deterministic tests. */
  now?: () => Date;
  /** User-facing notifier (typically `new Notice()`). */
  notify?: (message: string) => void;

  // --- Apply dependencies (RFC 22b50a17 Phase 3) ---
  /** AssetSpaceManager — provides pullAssetSpace + lookupAssetSpaceInfo. */
  assetSpaceManager?: AssetSpaceManager;
  /** Filesystem cache layer — destroy/restore tarballs (RFC §B.5). */
  cacheLayer?: ICacheLayer;
  /** Git submodule operations wrapper. */
  gitOps?: GitSubmoduleOps;
  /**
   * REST/tarball AssetSpace mount/unmount (RFC 01a83de8 Phase 3 T1). The
   * cross-platform (incl. iOS) materialisation path. When wired and running on
   * mobile, `applyProfile` delegates to {@link applyProfileViaRest}
   * (no git binary / staging / cache). Desktop keeps the git-binary path.
   *
   * Captured at onload — used to gate command registration + as a fallback.
   * Prefer {@link restMountFactory} for a fresh-PAT mount at switch time.
   */
  restMount?: RestAssetSpaceMount;
  /**
   * Factory building a {@link RestAssetSpaceMount} with the CURRENTLY stored
   * PAT. Preferred over {@link restMount} inside {@link applyProfileViaRest} so a
   * PAT configured AFTER onload is honoured without a reload (matches the
   * Issue #3382 fix for the Bootstrap/Add-AssetSpace puller). Falls back to the
   * captured {@link restMount} when absent.
   */
  restMountFactory?: () => Promise<RestAssetSpaceMount>;
  /** Uncommitted-changes guard (Vision Lock #5). */
  uncommittedGuard?: UncommittedChangesGuard;
  /** Confirmation gate — ModalConfirmGate в plugin runtime. */
  confirmGate?: IConfirmGate;
  /** Device-local data store (`_switchInProgress` flag, activeProfileUid). */
  localDataStore?: PluginLocalDataStore;
  /** Absolute path к vault root — required for git operations. */
  vaultRootPath?: string;
  /**
   * ExoSync mutual exclusion (RFC 4e4dc453 D11, Phase B composition): a
   * running sync vetoes apply — apply destroys/materialises the same folders
   * the sync engine is reading/writing. The sync side already vetoes on
   * `_switchInProgress`; this closes the opposite direction.
   */
  isSyncBusy?: () => boolean;
  /**
   * Overall deadline (ms) for the post-confirm apply critical section — lock
   * acquire → Phase 1 pull → Phase 2 destroy/materialize → git commit → RDF
   * refresh (and the REST/reindex equivalents).
   *
   * Issue #3532: on macOS desktop the apply-profile path hung forever AFTER the
   * confirm dialog — `_switchInProgress` never even flipped (the stall happened
   * before the mutation phase), no journal, 0 files cloned. The per-request
   * (`requestTimeoutMs`, #3531) + per-git-clone (`execFile` timeout) bounds only
   * cover the network/subprocess steps; the surrounding `vault.adapter` writes
   * (lock + journal), `rdfIndexer.refresh()`, and any other Obsidian-API await
   * have NO shared upper bound, so a single macOS-specific stall left the whole
   * promise pending. This watchdog races the entire critical section so it
   * REJECTS deterministically (clearing `_switchInProgress` + releasing the
   * lock) instead of hanging — the palette callsite then surfaces a Notice.
   *
   * The confirm-dialog wait is deliberately OUTSIDE this deadline — user
   * think-time must never expire.
   *
   * This is the PER-AssetSpace budget: the effective deadline scales as
   * `applyTimeoutMs × max(1, unitCount)` (AssetSpaces pull/clone/unmount
   * sequentially), so a healthy 16-18-AS EKA-alpha cold apply is never
   * false-positive-rejected (code-review MEDIUM). Default 600_000 (10 min/unit)
   * — comfortably longer than the slowest HEALTHY single AS (per-pull 120s +
   * per-clone 300s bounds, #3531, reject a genuinely stalled step far earlier
   * with a clear message; this is the coarse never-hang backstop). Set `0` to
   * disable (e.g. tests asserting the unbounded behaviour).
   */
  applyTimeoutMs?: number;
}

const DEFAULT_JOURNAL_PATH = ".exocortex/switch-journal.jsonl";
const DEFAULT_MAX_EXTENDS_DEPTH = 5;
/**
 * Default never-hang watchdog deadline for the post-confirm apply critical
 * section (Issue #3532). 10 min — generous vs a healthy apply, finite enough to
 * surface a macOS-desktop stall well before the user gives up.
 */
const DEFAULT_APPLY_TIMEOUT_MS = 600_000;

/** Apply dependencies resolved by {@link ProfileApplyManager.assertApplyDepsWired}. */
interface ResolvedApplyDeps {
  assetSpaceManager: AssetSpaceManager;
  cacheLayer: ICacheLayer;
  gitOps: GitSubmoduleOps;
  uncommittedGuard: UncommittedChangesGuard;
  confirmGate: IConfirmGate;
  localDataStore: PluginLocalDataStore;
  vaultRootPath: string;
}

/**
 * Post-confirm desktop apply mutation context — bundles the locals the extracted
 * {@link ProfileApplyManager.runApplyMutation} needs so the public
 * {@link ProfileApplyManager.applyProfile} can hand the whole critical section
 * to the never-hang watchdog (Issue #3532).
 */
interface DesktopApplyMutationContext {
  targetProfileUid: string;
  targetProfileLabel: string;
  startedAt: number;
  toDestroy: Array<{ asUid: string; submodulePath: string; label: string }>;
  toMaterialize: Array<{
    asUid: string;
    submodulePath: string;
    gitUrl: string;
    label: string;
    ref: string;
  }>;
  infoBySubmodulePath: Map<string, AssetSpaceInfo>;
  deps: ResolvedApplyDeps;
}

/** Post-confirm REST/mobile apply mutation context (Issue #3532 watchdog parity). */
interface RestApplyMutationContext {
  targetProfileUid: string;
  targetProfileLabel: string;
  startedAt: number;
  toDestroy: Array<{ asUid: string; submodulePath: string; label: string }>;
  toMaterialize: Array<{
    asUid: string;
    submodulePath: string;
    gitUrl: string;
    label: string;
    ref: string;
  }>;
  restMount: RestAssetSpaceMount;
  localDataStore: PluginLocalDataStore;
}

/**
 * R24 TS-floor guard error. Re-exported from the `exocortex` core
 * ({@link ../../../../../exocortex/src/domain/profile/TsFloorGuard}) so the
 * single class identity is shared across plugin + CLI — `e instanceof
 * TsFloorViolationError` works regardless of import path. Retained as a named
 * export here for backward-compat with the profile command palette et al.
 */
export { TsFloorViolationError };

/**
 * Custom error thrown by Vision Lock #5 uncommitted abort.
 */
export class UncommittedChangesAbortError extends Error {
  readonly affectedFiles: ReadonlyArray<{
    asUid: string;
    submodulePath: string;
    files: ReadonlyArray<string>;
  }>;
  constructor(
    message: string,
    affectedFiles: ReadonlyArray<{
      asUid: string;
      submodulePath: string;
      files: ReadonlyArray<string>;
    }>,
  ) {
    super(message);
    this.name = "UncommittedChangesAbortError";
    this.affectedFiles = affectedFiles;
  }
}

/**
 * Custom error thrown when the user declines the apply ConfirmGate.
 */
export class ApplyAbortedByUser extends Error {
  constructor(message = "Apply aborted by user") {
    super(message);
    this.name = "ApplyAbortedByUser";
  }
}

export class ProfileApplyManager {
  private readonly app: App;
  private readonly lockMgr: PluginLockManager;
  private readonly resolver: IProfileResolver;
  private readonly rdfIndexer: IRdfIndexer;
  private readonly settingsStore: ISettingsStore;
  private readonly journalPath: string;
  private readonly maxExtendsDepth: number;
  private readonly now: () => Date;
  private readonly notify: (message: string) => void;

  // Apply dependencies (may be undefined when only reindex wired).
  private readonly assetSpaceManager?: AssetSpaceManager;
  private readonly cacheLayer?: ICacheLayer;
  private readonly gitOps?: GitSubmoduleOps;
  private readonly restMount?: RestAssetSpaceMount;
  private readonly restMountFactory?: () => Promise<RestAssetSpaceMount>;
  private readonly uncommittedGuard?: UncommittedChangesGuard;
  private readonly confirmGate?: IConfirmGate;
  private readonly localDataStore?: PluginLocalDataStore;
  private readonly vaultRootPath?: string;
  private readonly isSyncBusy?: () => boolean;
  private readonly applyTimeoutMs: number;
  /**
   * Monotonic apply-attempt token (Issue #3532 watchdog, code-review LOW). Each
   * mutation claims a generation AFTER acquiring the lock; its `finally` releases
   * the lock / pings heartbeat ONLY while still the active generation. This
   * stops a watchdog-orphaned (stalled-then-resumed) mutation from releasing a
   * newer apply's lock or pinging on its behalf.
   */
  private applyGeneration = 0;

  constructor(options: ProfileApplyManagerOptions) {
    this.app = options.app;
    this.lockMgr = options.lockMgr;
    this.resolver = options.resolver;
    this.rdfIndexer = options.rdfIndexer;
    this.settingsStore = options.settingsStore;
    this.journalPath = options.journalPath ?? DEFAULT_JOURNAL_PATH;
    this.maxExtendsDepth = options.maxExtendsDepth ?? DEFAULT_MAX_EXTENDS_DEPTH;
    this.now = options.now ?? (() => new Date());
    this.notify = options.notify ?? (() => undefined);

    this.assetSpaceManager = options.assetSpaceManager;
    this.cacheLayer = options.cacheLayer;
    this.gitOps = options.gitOps;
    this.restMount = options.restMount;
    this.restMountFactory = options.restMountFactory;
    this.uncommittedGuard = options.uncommittedGuard;
    this.confirmGate = options.confirmGate;
    this.localDataStore = options.localDataStore;
    this.vaultRootPath = options.vaultRootPath;
    this.isSyncBusy = options.isSyncBusy;
    // Negative is meaningless — clamp to 0 (disabled). `0` keeps the unbounded
    // behaviour (tests that assert pre-watchdog semantics).
    this.applyTimeoutMs = Math.max(
      0,
      options.applyTimeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS,
    );
  }

  /**
   * Reindex-only apply path (RFC 0a0791c1 Phase 5 T2 — replaces the retired
   * public query-time RDF-filter method). Records the target as the last-applied
   * profile cache (`activeProfileUid`) and rebuilds the RDF graph from the
   * currently-materialised mount-state. Does NOT mutate the filesystem.
   *
   * Used internally by the «Apply profile» mount path when the effective set
   * matches the current mount-state (no AssetSpace to add/remove — a no-op
   * mount diff still re-indexes + records the selection), and by
   * {@link recoverIfNeeded} crash recovery. Lock-guarded, journaled.
   *
   * Visibility is mount-state based (RFC 01a83de8 Phase 3 — the query-time
   * soft RDF filter was removed); this method indexes whatever AssetSpace
   * folders are currently on disk.
   */
  private async reindexMountState(
    targetProfileUid: string,
    noticeOverride?: string,
  ): Promise<void> {
    // Never-hang watchdog (Issue #3532) — the reindex path acquires a lock,
    // writes journal entries (`vault.adapter`), and calls `rdfIndexer.refresh()`,
    // none of which has a native upper bound. Race the whole section so a
    // macOS-desktop stall rejects deterministically instead of hanging.
    await this.withApplyDeadline(
      () => this.runReindexMountState(targetProfileUid, noticeOverride),
      `reindex ${targetProfileUid.slice(0, 8)}`,
      () => this.clearStuckSettingsState(),
      this.applyTimeoutMs,
    );
  }

  private async runReindexMountState(
    targetProfileUid: string,
    noticeOverride?: string,
  ): Promise<void> {
    // Ensure the `.exocortex/` parent exists before the lock/journal writes —
    // Obsidian's `vault.adapter.write` does NOT create parent dirs, so a fresh
    // vault would otherwise throw ENOENT on the first lock write (Issue #3532).
    await this.ensureExocortexDir();
    const acquired = await this.lockMgr.acquireLock(`switch-profile-${targetProfileUid}`);
    if (!acquired) {
      throw new Error(`Another switch is in progress (lock held). Try again shortly.`);
    }
    // Generation claim AFTER acquire (code-review LOW) — see runApplyMutation.
    const myGen = ++this.applyGeneration;

    const startedAt = this.now().getTime();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    try {
      await this.appendJournal({
        phase: "starting",
        targetUid: targetProfileUid,
        ts: new Date(startedAt).toISOString(),
      });

      heartbeatTimer = setInterval(() => {
        // Best-effort heartbeat — swallow errors, lock manager logs them.
        if (this.applyGeneration !== myGen) return; // abandoned (see myGen)
        void this.lockMgr.heartbeat();
      }, 30_000);

      // Persist the last-applied profile cache BEFORE the re-index
      // (Architect #2 — atomicity invariant).
      const settings = await this.settingsStore.load();
      settings.activeProfileUid = targetProfileUid;
      settings._switchInProgress = true;
      await this.settingsStore.save(settings);

      // Rebuild the RDF graph from the currently-materialised mount-state.
      await this.rdfIndexer.refresh();

      // Clear in-progress flag
      settings._switchInProgress = false;
      await this.settingsStore.save(settings);

      const elapsedMs = this.now().getTime() - startedAt;
      await this.appendJournal({
        phase: "completed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        elapsedMs,
      });

      if (noticeOverride !== undefined) {
        this.notify(noticeOverride);
      } else {
        const profileLabel = await this.profileLabel(targetProfileUid);
        this.notify(`Applied ${profileLabel} (${elapsedMs}ms)`);
      }
    } catch (e) {
      await this.appendJournal({
        phase: "failed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        error: this.redactError(String(e)),
      });
      throw e;
    } finally {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      // Release only if still the active generation (code-review LOW) — see
      // runApplyMutation.
      if (this.applyGeneration === myGen) await this.lockMgr.releaseLock();
    }
  }

  /**
   * Builds the user-facing notice for the no-op (empty-diff) apply branch.
   * Distinguishes a genuine «already matches» no-op from the case where the
   * vault layout yields 0 recognized mounted AssetSpaces (a likely
   * derivePath/layout mismatch where the strict-replace had nothing to act on).
   */
  private noChangeNotice(profileLabel: string, recognizedCount: number): string {
    return recognizedCount === 0
      ? `Apply "${profileLabel}": no changes — 0 AssetSpaces recognized as mounted (check vault layout).`
      : `Applied "${profileLabel}": no changes (${recognizedCount} AssetSpace(s) already match).`;
  }

  /**
   * Plugin-load recovery: if last journal entry shows an incomplete switch
   * AND settings._switchInProgress=true, re-trigger the re-index идempotently.
   *
   * Re-index is pure (no filesystem state to roll back), so we simply
   * re-run {@link reindexMountState} — it's safe and idempotent. Genuine
   * filesystem-partial recovery (destroyed-not-materialized AssetSpaces)
   * is handled separately by {@link recoverIncompleteSwitch}.
   */
  async recoverIfNeeded(): Promise<{ recovered: boolean; targetUid: string | null }> {
    const lastEntry = await this.readLastJournalEntry();
    const settings = await this.settingsStore.load();

    if (!lastEntry) return { recovered: false, targetUid: null };
    if (lastEntry.phase === "completed") return { recovered: false, targetUid: null };
    if (!settings._switchInProgress) return { recovered: false, targetUid: null };

    // Incomplete: re-trigger
    this.notify(`Recovering incomplete switch to ${lastEntry.targetUid}...`);
    await this.reindexMountState(lastEntry.targetUid);
    return { recovered: true, targetUid: lastEntry.targetUid };
  }

  /**
   * Compute the effective set for a given profile.
   *
   * = derived(profile) ∪ TS_FLOOR ∪ discoveredSharedOntologies
   *
   * Where derived = union of `_includes` along the `_imports*` single-parent
   * chain (RFC 01a83de8 Phase 2 — `_includes` are AssetSpace UIDs). The
   * mount-state hard/REST switch consumes these AssetSpace UIDs directly (the
   * query-time soft-filter consumer was removed in RFC 01a83de8 Phase 3 T3b).
   *
   * TS-floor (Vision Lock #17) — hardcoded `[$exo]` (floor={exo}, #3440) +
   * pattern match для shared-identities — guarantees the plugin keeps
   * functioning regardless of profile config.
   */
  async resolveEffectiveSet(profileUid: string): Promise<Set<string>> {
    const derived = await this.computeDerivedSet(profileUid);
    const sharedDiscovered = await this.resolver.discoverSharedOntologies();
    const result = new Set<string>();
    for (const u of derived) result.add(u);
    for (const u of TS_FLOOR_ONTOLOGY_URIS) result.add(u);
    for (const u of sharedDiscovered) {
      if (TS_FLOOR_SHARED_PATTERN.test(u)) result.add(u);
    }
    return result;
  }

  /**
   * Compute derived ontology set without TS-floor — useful для tests verifying
   * inheritance walk separately from floor enforcement.
   */
  async computeDerivedSet(profileUid: string): Promise<Set<string>> {
    const visited = new Set<string>();
    const result = new Set<string>();
    await this.walkProfileChain(profileUid, visited, result, 0);
    return result;
  }

  // === Apply orchestration (RFC 22b50a17 Phase 3) ===

  /**
   * Apply — destructive filesystem mutation of `assetspaces/<as>/`
   * directories. Tears down AssetSpaces NOT in the target profile's effective
   * set, materialises new ones from cache or fresh GitHub pull, commits
   * the resulting `.gitmodules`/`assetspaces/` changes.
   *
   * Algorithm (mirrors RFC §Solution Architecture pseudocode):
   *
   *   1. Resolve effective set for target.
   *   2. R24 TS-floor assert (refuse if target excludes any floor AS).
   *   3. Compute toDestroy / toMaterialize via .gitmodules diff.
   *   4. Vision Lock #5 — abort if uncommitted changes in any to-destroy AS.
   *   5. Build ApplyPlan + confirmGate.confirmApply(plan) — abort
   *      on user-decline.
   *   6. lockMgr.acquireLock + localDataStore.save({_switchInProgress: true}).
   *   7. Phase 1 — for each toMaterialize, pull tarball (or cache restore)
   *      to staging dir.
   *   8. Phase 2 — for each toDestroy: cache(X), journal destroy-cached(X),
   *      git submodule deinit X, rm .git/modules/X, rm <vault>/X. The
   *      `.gitmodules` entry is PRESERVED (Phase 6 Vision Lock #9
   *      amendment, RFC 13da049f v1.3) — serves as per-vault URL registry
   *      for switch-back. Then for each toMaterialize: if `.gitmodules`
   *      entry already exists (preserved post-destroy), re-init submodule
   *      and pull from preserved URL; else `git submodule add <url> X`.
   *      mv staging/X -> <vault>/X, journal materialized(X).
   *   9. git add .gitmodules, git add assetspaces/, git commit.
   *  10. Clear _switchInProgress, persist new activeProfileUid.
   *  11. rdfIndexer.refresh() to re-index the newly-materialised vault.
   *  12. Release lock + clear staging.
   *
   * On catch: attempt cache.restore(prevActiveProfileUid) для best-effort
   * rollback; rethrow.
   *
   * @throws TsFloorViolationError if target excludes any TS-floor AS.
   * @throws UncommittedChangesAbortError if dirty files in any to-destroy AS.
   * @throws ApplyAbortedByUser if confirmGate declines.
   */
  async applyProfile(targetProfileUid: string): Promise<void> {
    if (typeof targetProfileUid !== "string" || targetProfileUid.length === 0) {
      throw new Error("applyProfile: targetProfileUid is required");
    }
    // ExoSync D11 composition (RFC 4e4dc453 Phase B): refuse to start a
    // destructive mount-state switch while a sync run is reading/writing the
    // same folders. The sync side vetoes on `_switchInProgress` symmetrically.
    // Throw only (no notify here) — the palette callsite catches and surfaces
    // the message; notifying here too produced a double Notice.
    if (this.isSyncBusy?.() === true) {
      throw new Error(
        "applyProfile: ExoSync run in progress (D11 guard) — retry after it finishes",
      );
    }
    // RFC 01a83de8 Phase 3 T2 — on mobile the git binary is unavailable, so
    // delegate to the REST/tarball mount/unmount path (no staging / cache /
    // git commit). Desktop keeps the git-binary path below unchanged.
    if (
      Platform.isMobile &&
      (this.restMount !== undefined || this.restMountFactory !== undefined)
    ) {
      return this.applyProfileViaRest(targetProfileUid);
    }
    const deps = this.assertApplyDepsWired();

    const startedAt = this.now().getTime();
    const prevActiveProfileUid = deps.localDataStore.getActiveProfileUid();
    const targetProfileLabel = await this.profileLabel(targetProfileUid);
    const sourceProfileLabel = prevActiveProfileUid !== null
      ? await this.profileLabel(prevActiveProfileUid)
      : "<unknown>";

    // R24 — assert TS-floor BEFORE any mutation. resolveDeclaredAndEffective
    // expands the profile's `_includes` by its `exo__AssetSpace_dependsOn`
    // closure (EKA D18, issue #3511), asserts the reconciled floor (UID OR
    // namespace), and returns the effective set (declared ∪ TS-floor). Uses the
    // declared (closure) set — NOT resolveEffectiveSet — so the floor URIs it
    // would inject don't mask a profile that legitimately omits a floor AS.
    const allInfos = this.listAllAssetSpaceInfos();
    const { effectiveAsUids } = await this.resolveDeclaredAndEffective(
      targetProfileUid,
      allInfos,
    );

    // Compute toDestroy / toMaterialize via .gitmodules ∩ filesystem presence.
    // Phase 6 Vision Lock #9 amendment: `.gitmodules` entries persist post-destroy
    // (URL registry). Therefore materialization state ≠ `.gitmodules` membership.
    // Source of truth for «is currently materialized» = working tree dir exists.
    const currentSubmodulePaths = await deps.gitOps.readGitmodulesPaths();
    // Index by submodulePath for O(1) lookup.
    const infoBySubmodulePath = new Map<string, AssetSpaceInfo>();
    for (const info of allInfos) infoBySubmodulePath.set(info.folderName, info);

    // Currently-materialized AS UIDs: .gitmodules entries with working tree on disk.
    const currentAsUids = await this.derivePhysicallyMaterializedAsUids(
      currentSubmodulePaths,
      infoBySubmodulePath,
    );

    // EKA Alpha (issue #3511) — keep the catalog (registry/profiles) mounted.
    this.keepMaterializedCatalog(effectiveAsUids, allInfos, currentAsUids);

    const toDestroy: Array<{ asUid: string; submodulePath: string; label: string }> = [];
    const toMaterialize: Array<{ asUid: string; submodulePath: string; gitUrl: string; label: string; ref: string }> = [];

    // Iterate only over physically-materialized AS (working tree exists on disk).
    // Skips destroyed-but-`.gitmodules`-preserved entries — they're already gone.
    for (const asUid of currentAsUids) {
      const info = allInfos.find((i) => i.uid === asUid);
      if (info === undefined) continue; // Defensive
      if (!effectiveAsUids.has(info.uid)) {
        toDestroy.push({
          asUid: info.uid,
          submodulePath: info.folderName,
          label: info.namespace || info.uid.slice(0, 8),
        });
      }
    }
    for (const asUid of effectiveAsUids) {
      if (currentAsUids.has(asUid)) continue;
      const info = allInfos.find((i) => i.uid === asUid);
      if (info === undefined) {
        // AssetSpace declared in effective set but no ABox in vault — skip
        // (would happen if profile references AS not yet declared as ABox).
        continue;
      }
      toMaterialize.push({
        asUid: info.uid,
        submodulePath: info.folderName,
        gitUrl: info.git,
        label: info.namespace || info.uid.slice(0, 8),
        ref: "main",
      });
    }

    // Vision Lock #5 — uncommitted abort. Scope = only to-destroy AS.
    if (toDestroy.length > 0) {
      const uncommitted = await deps.uncommittedGuard.check(
        toDestroy.map((t) => ({ asUid: t.asUid, submodulePath: t.submodulePath })),
      );
      if (!uncommitted.clean) {
        const total = uncommitted.affectedFiles.reduce((s, a) => s + a.files.length, 0);
        throw new UncommittedChangesAbortError(
          `Apply aborted — ${total} uncommitted file(s) in ${uncommitted.affectedFiles.length} to-destroy AssetSpace(s). Commit or stash first.`,
          uncommitted.affectedFiles,
        );
      }
    }

    // Build ApplyPlan + ConfirmGate.
    const filesToDestroyMap = new Map<string, string[]>();
    for (const target of toDestroy) {
      const files = await this.enumerateFilesUnder(target.submodulePath);
      filesToDestroyMap.set(target.asUid, files);
    }
    const plan: ApplyPlan = {
      targetProfileUid,
      targetProfileLabel,
      sourceProfileUid: prevActiveProfileUid,
      sourceProfileLabel,
      filesToDestroy: filesToDestroyMap,
      assetSpacesBeingTornDown: toDestroy.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
        fileCount: filesToDestroyMap.get(t.asUid)?.length ?? 0,
      })),
      assetSpacesBeingMaterialized: toMaterialize.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
      })),
    };
    const approved = await deps.confirmGate.confirmApply(plan);
    if (!approved) throw new ApplyAbortedByUser();

    // No-op early exit: no destroy + no materialize == mount-state already
    // matches the target. Re-index + record the selection (reindex-only path).
    // Still emit apply-completed so recoverIncompleteSwitch's tail-scan
    // has a clean cutoff for any prior aborted run (HIGH catch from review).
    // Bracketing journal writes go through `vault.adapter` (the #3532 stall
    // surface), so the whole branch — not just the inner reindex — runs under
    // the watchdog (code-review MEDIUM). Calls `runReindexMountState` directly to
    // avoid a redundant nested deadline.
    if (toDestroy.length === 0 && toMaterialize.length === 0) {
      await this.withApplyDeadline(
        async () => {
          await this.ensureExocortexDir();
          await this.appendJournal({
            phase: "apply-starting",
            targetUid: targetProfileUid,
            ts: new Date(startedAt).toISOString(),
          });
          await this.runReindexMountState(
            targetProfileUid,
            this.noChangeNotice(targetProfileLabel, currentAsUids.size),
          );
          await this.appendJournal({
            phase: "apply-completed",
            targetUid: targetProfileUid,
            ts: this.now().toISOString(),
            elapsedMs: this.now().getTime() - startedAt,
          });
        },
        targetProfileLabel,
        () => this.clearStuckSettingsState(),
        this.applyTimeoutMs,
      );
      return;
    }

    // Never-hang watchdog (Issue #3532): bound the whole post-confirm mutation
    // (lock acquire → Phase 1 pull → Phase 2 → git commit → RDF refresh). A
    // single stalled `vault.adapter` write / git step / refresh would otherwise
    // leave the apply pending forever (the macOS-desktop hang — `_switchInProgress`
    // never even flipped). On timeout the watchdog rejects + best-effort clears
    // `_switchInProgress` and releases the lock; the palette callsite surfaces
    // the resulting error as a Notice. The deadline scales with the unit count
    // (sequential per-AS pull+clone) so a healthy large cold apply is not
    // false-positive-rejected (code-review MEDIUM).
    await this.withApplyDeadline(
      () =>
        this.runApplyMutation({
          targetProfileUid,
          targetProfileLabel,
          startedAt,
          toDestroy,
          toMaterialize,
          infoBySubmodulePath,
          deps,
        }),
      targetProfileLabel,
      () => this.clearStuckLocalState(deps.localDataStore),
      this.computeApplyDeadlineMs(toDestroy.length + toMaterialize.length),
    );
  }

  /**
   * Post-confirm desktop apply mutation — extracted from {@link applyProfile}
   * so {@link withApplyDeadline} can race the whole critical section against a
   * deadline (Issue #3532). Acquire lock → Phase 1 pull → Phase 2
   * destroy/materialize → git commit → persist + RDF refresh. Its own
   * try/catch/finally clears `_switchInProgress` + releases the lock on any
   * error or on success; the watchdog's timeout handler repeats that best-effort
   * if this promise is still pending when the deadline fires (idempotent).
   */
  private async runApplyMutation(
    ctx: DesktopApplyMutationContext,
  ): Promise<void> {
    const {
      targetProfileUid,
      targetProfileLabel,
      startedAt,
      toDestroy,
      toMaterialize,
      infoBySubmodulePath,
      deps,
    } = ctx;
    // Ensure `.exocortex/` exists before the lock/journal writes (Issue #3532) —
    // under the watchdog so even a stalled mkdir/exists is bounded.
    await this.ensureExocortexDir();
    // Acquire lock, set _switchInProgress.
    const acquired = await this.lockMgr.acquireLock(`apply-${targetProfileUid}`);
    if (!acquired) {
      throw new Error("Another apply is in progress (lock held). Try again shortly.");
    }
    // Claim a generation AFTER acquiring the lock (code-review LOW): the finally
    // releases the lock / the heartbeat pings ONLY while still active, so a
    // watchdog-orphaned mutation can't release a newer apply's lock.
    const myGen = ++this.applyGeneration;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stagingPaths: Array<{ asUid: string; stagingPath: string }> = [];
    // Tracks AS that were successfully cached в Phase 2 — drives the
    // attemptCacheRollback list on catch so we only restore entries the cache
    // layer actually saw. Avoids spurious CacheMissError noise + double-restore
    // on partial-fail (HIGH catch from code-review).
    const cachedSuccessfully: Array<{ asUid: string; submodulePath: string }> = [];

    try {
      // ExoSync D11 re-check (code-reviewer MEDIUM, PR #3461): the entry
      // guard ran BEFORE the confirm gate + several awaits — a sync started
      // in that window would otherwise race the destructive switch. Re-check
      // immediately before the `_switchInProgress` flag is raised.
      if (this.isSyncBusy?.() === true) {
        throw new Error(
          "applyProfile: ExoSync run started during apply pre-flight (D11 guard) — retry after it finishes",
        );
      }
      await this.appendJournal({
        phase: "apply-starting",
        targetUid: targetProfileUid,
        ts: new Date(startedAt).toISOString(),
      });
      const localState = deps.localDataStore.snapshot();
      await deps.localDataStore.save({
        activeProfileUid: localState.activeProfileUid,
        _switchInProgress: true,
      });

      heartbeatTimer = setInterval(() => {
        if (this.applyGeneration !== myGen) return; // abandoned (see myGen)
        void this.lockMgr.heartbeat();
      }, 30_000);

      // ---- Phase 1: pull all to-materialize AS to staging ----
      await this.appendJournal({
        phase: "phase1-pulling",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
      });
      for (const target of toMaterialize) {
        try {
          // R28 — SHA-aware cache lookup. We don't know upstream SHA up-front,
          // so we pull. (R28 future optimization: HEAD probe before pull.)
          const result = await deps.assetSpaceManager.pullAssetSpace(
            target.asUid,
            target.gitUrl,
            target.ref,
          );
          const stagingPath = result.stagingPath;
          stagingPaths.push({ asUid: target.asUid, stagingPath });
          await this.appendJournal({
            phase: "phase1-pulled",
            targetUid: targetProfileUid,
            as: target.asUid,
            ts: this.now().toISOString(),
          });
        } catch (e) {
          // R26 partial-fail — release already-allocated staging dirs.
          await this.releaseStagingPaths(stagingPaths);
          await this.appendJournal({
            phase: "aborted-phase1",
            targetUid: targetProfileUid,
            ts: this.now().toISOString(),
            error: this.redactError(String(e)),
          });
          throw e;
        }
      }
      await this.appendJournal({
        phase: "phase1-done",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
      });

      // ---- Phase 2: destroy + materialize per-AS ----
      await this.appendJournal({
        phase: "phase2-start",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
      });

      // F2 journal-write-BEFORE-destroy: cache first, journal, then destroy.
      for (const target of toDestroy) {
        const vaultAbsPath = deps.vaultRootPath + "/" + target.submodulePath;
        // F6 — cache verifies archive before returning; if cache fails,
        // throws CacheWriteError and destroy never starts.
        // Use pull SHA when available (lastPulledSha frontmatter), else literal
        // "unknown" timestamp-suffix to keep cache lookup useful.
        const info = infoBySubmodulePath.get(target.submodulePath);
        const sha = (info?.lastPulledSha ?? `unknown-${this.now().getTime()}`).slice(0, 40);
        await deps.cacheLayer.cache(target.asUid, vaultAbsPath, sha);
        cachedSuccessfully.push({ asUid: target.asUid, submodulePath: target.submodulePath });
        // CRITICAL: journal entry BEFORE rm -rf (F2 advisor catch).
        await this.appendJournal({
          phase: "phase2-destroy-cached",
          targetUid: targetProfileUid,
          as: target.asUid,
          ts: this.now().toISOString(),
        });
        await deps.gitOps.submoduleDeinit(target.submodulePath);
        await deps.gitOps.removeGitModulesDir(target.submodulePath);
        await deps.gitOps.removeWorkingTree(target.submodulePath);
        // Vision Lock #9 amendment (Phase 6 RFC 13da049f v1.3):
        // preserve `.gitmodules` entry through destroy phase. This enables
        // cold-bootstrap UX + switch-back URL recovery — the entry serves
        // as per-vault AssetSpace URL registry. Git semantic precedent:
        // `git submodule deinit` keeps `.gitmodules`. The previous
        // atomicGitmodulesEntryRemove call here was the Phase 5 lock #9
        // shipped behavior; Phase 6 reverses it after RFC 13da049f.
        await this.appendJournal({
          phase: "phase2-destroyed",
          targetUid: targetProfileUid,
          as: target.asUid,
          ts: this.now().toISOString(),
        });
      }

      // Snapshot preserved `.gitmodules` paths — to detect re-materialize-after-destroy
      // case (entry persists via Phase 6 amendment) where `submoduleAdd` would fail with
      // «already exists in .gitmodules». Snapshot taken once before loop to avoid races.
      const preservedGitmodulesPaths = new Set<string>(
        await deps.gitOps.readGitmodulesPaths(),
      );

      for (const target of toMaterialize) {
        await this.appendJournal({
          phase: "phase2-materializing",
          targetUid: targetProfileUid,
          as: target.asUid,
          ts: this.now().toISOString(),
        });
        // Phase 6 amendment: if `.gitmodules` already has this path (preserved
        // from earlier destroy), strip entry first so `submodule add` works cleanly.
        // URL is preserved in `target.gitUrl` from AS ABox metadata — no data loss.
        if (preservedGitmodulesPaths.has(target.submodulePath)) {
          await deps.gitOps.atomicGitmodulesEntryRemove(target.submodulePath);
        }
        // git submodule add — populates `.gitmodules`, `.git/modules/<name>/`,
        // and `.git/config`. The target directory MUST not exist yet — Phase 1
        // staging is NOT under vault root, so this stays clean.
        await deps.gitOps.submoduleAdd(target.gitUrl, target.submodulePath);
        // submodule add already populates the working tree from the remote.
        // Overwrite with staging contents — staging may be ahead of remote.
        const stagingPath = stagingPaths.find((s) => s.asUid === target.asUid)?.stagingPath;
        if (stagingPath !== undefined) {
          // Wipe what `submodule add` populated; replace with staging contents.
          await deps.gitOps.removeWorkingTree(target.submodulePath);
          await deps.gitOps.renameIntoVault(stagingPath, target.submodulePath);
        }
        await this.appendJournal({
          phase: "phase2-materialized",
          targetUid: targetProfileUid,
          as: target.asUid,
          ts: this.now().toISOString(),
        });
      }

      await this.appendJournal({
        phase: "phase2-done",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
      });

      // ---- Git commit ----
      await deps.gitOps.add(".gitmodules");
      await deps.gitOps.add("assetspaces/");
      await deps.gitOps.commit(
        `chore(profile): apply к ${targetProfileLabel}`,
      );
      await this.appendJournal({
        phase: "git-commit-done",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
      });

      // ---- Persist new state + trigger RDF re-index ----
      // Record the applied profile as the last-applied cache.
      const persistState = deps.localDataStore.snapshot();
      await deps.localDataStore.save({
        ...persistState,
        activeProfileUid: targetProfileUid,
        _switchInProgress: false,
      });
      await this.rdfIndexer.refresh();

      const elapsedMs = this.now().getTime() - startedAt;
      await this.appendJournal({
        phase: "apply-completed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        elapsedMs,
      });
      this.notify(
        `Applied "${targetProfileLabel}": ${toMaterialize.length} mounted, ${toDestroy.length} unmounted (${elapsedMs}ms).`,
      );
    } catch (e) {
      // Rollback attempt: best-effort cache restore previously-destroyed AS.
      // This is partial — anything that was already added via `submodule add`
      // before commit will be untracked git state until the user manually
      // resets. We log + notify but rethrow.
      await this.appendJournal({
        phase: "apply-failed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        error: this.redactError(String(e)),
      });
      // Try to restore destroyed AS from cache — but only the ones we
      // successfully cached (HIGH catch from code-review: rolling back on
      // toDestroy.all would call restore on never-cached entries → noisy
      // CacheMissError plus risk of restoring stale entries from prior runs).
      try {
        await this.attemptCacheRollback(cachedSuccessfully);
      } catch {
        // Swallow — original error takes precedence.
      }
      // Clear in-progress flag so subsequent operations не see stuck state.
      try {
        const s = deps.localDataStore.snapshot();
        await deps.localDataStore.save({
          activeProfileUid: s.activeProfileUid,
          _switchInProgress: false,
        });
      } catch {
        // Swallow.
      }
      throw e;
    } finally {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      await this.releaseStagingPaths(stagingPaths);
      // Release the lock ONLY if still the active generation (code-review LOW):
      // a watchdog-orphaned mutation that resumes after a retry must not delete
      // the newer apply's lock. The timed-out apply's lock is released by the
      // watchdog's onTimeout handler instead.
      if (this.applyGeneration === myGen) await this.lockMgr.releaseLock();
    }
  }

  /**
   * Mobile-capable profile switch (RFC 01a83de8 Phase 3 T2). Materialises the
   * target profile's effective AssetSpace set via REST/tarball mount/unmount
   * (no git binary, staging dir, cache layer, or git commit). Delegated to by
   * {@link applyProfile} when running on mobile with `restMount`
   * wired; desktop keeps the git-binary path.
   *
   * Visibility is **mount-state**: an AssetSpace is "active" iff its derived
   * folder (`derivePath(_source)`) exists on disk. The soft RDF-filter remains
   * coexisting (RFC v9 EV4) — removed only after the iPhone verify gate (T3).
   *
   * Algorithm:
   *   1. Resolve declared ontology set → AssetSpace UIDs; assert TS-floor.
   *   2. Diff effective set vs currently-materialised (folder exists).
   *   3. ConfirmGate (destructive — unmount removes folders).
   *   4. Lock + journal; unmount toDestroy, mount toMaterialize via restMount.
   *   5. Persist active profile (+ Knowledge mirror) + RDF re-index.
   *
   * **Partial-failure / recovery**: like T1's primitive, this does
   * unmount-then-mount with NO rollback. On a mid-switch crash the catch block
   * clears `_switchInProgress` and leaves `activeProfileUid` at the pre-switch
   * value (the success-path save never ran). The desktop cache-restore worker
   * (`recoverIncompleteSwitch`) is desktop-only (cache/gitOps-gated), so mobile
   * has no auto cache-restore — but the state self-heals: mount-state is
   * self-describing (folder exists = active), T1 mount/unmount are per-op
   * idempotent, and re-running the switch reconciles to the target.
   *
   * @throws TsFloorViolationError if target excludes any TS-floor AS.
   * @throws ApplyAbortedByUser if confirmGate declines.
   */
  async applyProfileViaRest(targetProfileUid: string): Promise<void> {
    if (typeof targetProfileUid !== "string" || targetProfileUid.length === 0) {
      throw new Error("applyProfileViaRest: targetProfileUid is required");
    }
    const { confirmGate, localDataStore } = this.assertRestApplyWired();
    // Prefer the fresh-PAT factory (Issue #3382 pattern) over the onload-captured
    // mount, so a PAT set after onload is honoured without a reload.
    const restMount = this.restMountFactory
      ? await this.restMountFactory()
      : (this.restMount as RestAssetSpaceMount);
    const startedAt = this.now().getTime();
    const prevActiveProfileUid = localDataStore.getActiveProfileUid();
    const targetProfileLabel = await this.profileLabel(targetProfileUid);
    const sourceProfileLabel =
      prevActiveProfileUid !== null
        ? await this.profileLabel(prevActiveProfileUid)
        : "<unknown>";

    // 1. Effective AssetSpace set (declared ontologies → AS UIDs + TS-floor).
    // Shares resolveDeclaredAndEffective with the desktop path (parity): expand
    // `_includes` by the dependsOn closure (EKA D18, issue #3511) + reconciled
    // R24 floor (UID OR namespace). Uses the declared (closure) set — NOT
    // resolveEffectiveSet — which would silently inject floor ontologies.
    const allInfos = this.listAllAssetSpaceInfos();
    const { effectiveAsUids } = await this.resolveDeclaredAndEffective(
      targetProfileUid,
      allInfos,
    );

    // 2. Diff: materialised == folder exists on disk (mount-state, derivePath).
    const infoBySubmodulePath = new Map<string, AssetSpaceInfo>();
    for (const info of allInfos) infoBySubmodulePath.set(info.folderName, info);
    const currentAsUids = await this.derivePhysicallyMaterializedAsUids(
      allInfos.map((i) => i.folderName),
      infoBySubmodulePath,
    );

    // EKA Alpha (issue #3511) — keep the catalog (registry/profiles) mounted.
    this.keepMaterializedCatalog(effectiveAsUids, allInfos, currentAsUids);

    const toDestroy: Array<{ asUid: string; submodulePath: string; label: string }> = [];
    const toMaterialize: Array<{
      asUid: string;
      submodulePath: string;
      gitUrl: string;
      label: string;
      ref: string;
    }> = [];
    // Iterate ALL declared AS (vs the desktop path's `currentAsUids` for the
    // destroy loop) — equivalent because `materialised` implies presence in
    // `currentAsUids`; this single loop also covers the materialise side.
    for (const info of allInfos) {
      const materialised = currentAsUids.has(info.uid);
      const inEffective = effectiveAsUids.has(info.uid);
      const label = info.namespace || info.uid.slice(0, 8);
      if (materialised && !inEffective) {
        toDestroy.push({ asUid: info.uid, submodulePath: info.folderName, label });
      } else if (!materialised && inEffective) {
        toMaterialize.push({
          asUid: info.uid,
          submodulePath: info.folderName,
          gitUrl: info.git,
          label,
          ref: "main",
        });
      }
    }

    // 3. Build plan + ConfirmGate (destructive — unmount removes folders).
    const filesToDestroyMap = new Map<string, string[]>();
    for (const target of toDestroy) {
      filesToDestroyMap.set(
        target.asUid,
        await this.enumerateFilesUnder(target.submodulePath),
      );
    }
    const plan: ApplyPlan = {
      targetProfileUid,
      targetProfileLabel,
      sourceProfileUid: prevActiveProfileUid,
      sourceProfileLabel,
      filesToDestroy: filesToDestroyMap,
      assetSpacesBeingTornDown: toDestroy.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
        fileCount: filesToDestroyMap.get(t.asUid)?.length ?? 0,
      })),
      assetSpacesBeingMaterialized: toMaterialize.map((t) => ({
        asUid: t.asUid,
        asLabel: t.label,
      })),
    };
    const approved = await confirmGate.confirmApply(plan);
    if (!approved) throw new ApplyAbortedByUser();

    // No-op early exit — mount-state already matches the target. Re-index +
    // record the selection (reindex-only path; already watchdog-wrapped).
    if (toDestroy.length === 0 && toMaterialize.length === 0) {
      await this.reindexMountState(
        targetProfileUid,
        this.noChangeNotice(targetProfileLabel, currentAsUids.size),
      );
      return;
    }

    // Never-hang watchdog (Issue #3532) — parity with the desktop path. Bound
    // the REST mount/unmount critical section so a stalled tarball mount /
    // `vault.adapter` write / refresh rejects deterministically instead of
    // hanging; the timeout handler clears `_switchInProgress` + releases the
    // lock. Deadline scales with the unit count (sequential per-AS mount).
    await this.withApplyDeadline(
      () =>
        this.runRestApplyMutation({
          targetProfileUid,
          targetProfileLabel,
          startedAt,
          toDestroy,
          toMaterialize,
          restMount,
          localDataStore,
        }),
      targetProfileLabel,
      () => this.clearStuckLocalState(localDataStore),
      this.computeApplyDeadlineMs(toDestroy.length + toMaterialize.length),
    );
  }

  /**
   * Post-confirm REST/mobile apply mutation — extracted from
   * {@link applyProfileViaRest} so {@link withApplyDeadline} can race the whole
   * critical section against a deadline (Issue #3532 watchdog parity with the
   * desktop path). Own try/catch/finally clears `_switchInProgress` + releases
   * the lock on error/success; the watchdog repeats that best-effort on timeout.
   */
  private async runRestApplyMutation(
    ctx: RestApplyMutationContext,
  ): Promise<void> {
    const {
      targetProfileUid,
      targetProfileLabel,
      startedAt,
      toDestroy,
      toMaterialize,
      restMount,
      localDataStore,
    } = ctx;
    // Ensure `.exocortex/` exists before the lock/journal writes (Issue #3532).
    await this.ensureExocortexDir();
    const acquired = await this.lockMgr.acquireLock(`apply-rest-${targetProfileUid}`);
    if (!acquired) {
      throw new Error("Another profile switch is in progress (lock held). Try again shortly.");
    }
    // Generation claim AFTER acquire (code-review LOW) — see runApplyMutation.
    const myGen = ++this.applyGeneration;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    try {
      // ExoSync D11 re-check (code-reviewer MEDIUM, PR #3461) — same
      // pre-flag window as the desktop path; see applyProfile.
      if (this.isSyncBusy?.() === true) {
        throw new Error(
          "applyProfile: ExoSync run started during apply pre-flight (D11 guard) — retry after it finishes",
        );
      }
      await this.appendJournal({
        phase: "apply-starting",
        targetUid: targetProfileUid,
        ts: new Date(startedAt).toISOString(),
      });
      const localState = localDataStore.snapshot();
      await localDataStore.save({
        activeProfileUid: localState.activeProfileUid,
        _switchInProgress: true,
      });
      heartbeatTimer = setInterval(() => {
        if (this.applyGeneration !== myGen) return; // abandoned (see myGen)
        void this.lockMgr.heartbeat();
      }, 30_000);

      // Unmount removed AssetSpaces (rm folder + strip .gitmodules stanza).
      for (const target of toDestroy) {
        await restMount.unmount(target.submodulePath);
        await this.appendJournal({
          phase: "phase2-destroyed",
          targetUid: targetProfileUid,
          as: target.asUid,
          ts: this.now().toISOString(),
        });
      }
      // Mount new AssetSpaces (REST tarball → vault folder + .gitmodules entry).
      for (const target of toMaterialize) {
        await restMount.mount(target.gitUrl, target.submodulePath, target.ref);
        await this.appendJournal({
          phase: "phase2-materialized",
          targetUid: targetProfileUid,
          as: target.asUid,
          ts: this.now().toISOString(),
        });
      }

      // Persist the applied profile as last-applied cache + clear in-progress.
      const persistState = localDataStore.snapshot();
      await localDataStore.save({
        ...persistState,
        activeProfileUid: targetProfileUid,
        _switchInProgress: false,
      });
      await this.rdfIndexer.refresh();

      const elapsedMs = this.now().getTime() - startedAt;
      await this.appendJournal({
        phase: "apply-completed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        elapsedMs,
      });
      this.notify(
        `Applied "${targetProfileLabel}": ${toMaterialize.length} mounted, ${toDestroy.length} unmounted (${elapsedMs}ms, REST).`,
      );
    } catch (e) {
      await this.appendJournal({
        phase: "apply-failed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        error: this.redactError(String(e)),
      });
      // Clear in-progress so subsequent operations don't see stuck state.
      try {
        const s = localDataStore.snapshot();
        await localDataStore.save({
          activeProfileUid: s.activeProfileUid,
          _switchInProgress: false,
        });
      } catch {
        // Swallow — original error takes precedence.
      }
      throw e;
    } finally {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      // Release only if still the active generation (code-review LOW) — see
      // runApplyMutation.
      if (this.applyGeneration === myGen) await this.lockMgr.releaseLock();
    }
  }

  private assertRestApplyWired(): {
    confirmGate: IConfirmGate;
    localDataStore: PluginLocalDataStore;
  } {
    if (
      (this.restMount === undefined && this.restMountFactory === undefined) ||
      this.confirmGate === undefined ||
      this.localDataStore === undefined
    ) {
      throw new Error(
        "applyProfileViaRest: dependencies not wired (restMount|restMountFactory, confirmGate, localDataStore required)",
      );
    }
    return {
      confirmGate: this.confirmGate,
      localDataStore: this.localDataStore,
    };
  }

  /**
   * Recovery worker — call from plugin onload when localDataStore reports
   * `_switchInProgress=true`. Reads journal tail, identifies AS destroyed
   * but not materialized, restores each from cache.
   *
   * @returns count of restored AS.
   */
  async recoverIncompleteSwitch(): Promise<{ restored: ReadonlyArray<string> }> {
    const cacheLayer = this.cacheLayer;
    const localDataStore = this.localDataStore;
    const vaultRootPath = this.vaultRootPath;
    if (cacheLayer === undefined || localDataStore === undefined || vaultRootPath === undefined) {
      throw new Error("recoverIncompleteSwitch: apply dependencies not wired");
    }
    const events = await this.readJournalTail(200);
    const destroyedAsUids = new Set<string>();
    const materializedAsUids = new Set<string>();
    for (const e of events) {
      if (e.phase === "phase2-destroy-cached" && typeof e.as === "string") {
        destroyedAsUids.add(e.as);
      } else if (e.phase === "phase2-materialized" && typeof e.as === "string") {
        materializedAsUids.add(e.as);
      } else if (e.phase === "apply-completed") {
        // Anything before a completed event was a finished switch — clear set.
        destroyedAsUids.clear();
        materializedAsUids.clear();
      }
    }

    const restored: string[] = [];
    for (const asUid of destroyedAsUids) {
      if (materializedAsUids.has(asUid)) continue;
      try {
        // Restore destination = vaultRoot/assetspaces/<namespace>. Look up
        // the AssetSpace info to determine submodulePath. If ABox missing
        // (deleted concurrently), fall back to `assetspaces/<asUid>` as
        // a safe diagnostic location.
        const info = this.listAllAssetSpaceInfos().find((i) => i.uid === asUid);
        const target = info !== undefined
          ? vaultRootPath + "/" + info.folderName
          : vaultRootPath + "/assetspaces/" + asUid;
        await this.appendJournal({
          phase: "recovery-restoring",
          targetUid: asUid,
          as: asUid,
          ts: this.now().toISOString(),
        });
        await cacheLayer.restore(asUid, target);
        restored.push(asUid);
      } catch (err) {
        await this.appendJournal({
          phase: "recovery-restoring",
          targetUid: asUid,
          as: asUid,
          ts: this.now().toISOString(),
          error: this.redactError(String(err)),
        });
      }
    }

    // Clear stuck _switchInProgress flag.
    const snapshot = localDataStore.snapshot();
    await localDataStore.save({
      activeProfileUid: snapshot.activeProfileUid,
      _switchInProgress: false,
    });
    await this.appendJournal({
      phase: "recovery-completed",
      targetUid: snapshot.activeProfileUid ?? "<none>",
      ts: this.now().toISOString(),
    });
    if (restored.length > 0) {
      this.notify(`Recovered ${restored.length} AssetSpace(s) from cache after interrupted switch`);
    }
    return { restored };
  }

  /**
   * Cross-device divergence reconcile — call from plugin onload.
   *
   * Detection: parse `.gitmodules` to get currently-materialized AS folders,
   * compare to effective set derived from local `activeProfileUid`. Mismatch
   * → call confirmGate (reusing IConfirmGate plan shape) to get user OK
   * before reconciling via applyProfile.
   *
   * Returns `null` if no divergence detected. Otherwise returns the action
   * taken: `"reconciled"` if user approved, `"declined"` if user declined.
   */
  async reconcileToLocal(): Promise<{
    outcome: "no-divergence" | "reconciled" | "declined" | "no-active-profile";
  }> {
    const localDataStore = this.localDataStore;
    const gitOps = this.gitOps;
    if (localDataStore === undefined || gitOps === undefined) {
      throw new Error("reconcileToLocal: apply dependencies not wired");
    }
    const activeProfileUid = localDataStore.getActiveProfileUid();
    if (activeProfileUid === null) {
      return { outcome: "no-active-profile" };
    }
    // Compute expected AS set for activeProfileUid.
    const declared = await this.resolveEffectiveSet(activeProfileUid);
    const folderToAsUid = await this.scanFolderToAsUid();
    const expectedAsUids = new Set<string>();
    const folderMapValues = new Set(folderToAsUid.values());
    // `_includes` are AssetSpace UIDs (RFC 01a83de8 Phase 2) → resolve directly
    // against the folder map. The TS-floor ontology URIs added by
    // resolveEffectiveSet are not AS UIDs and are re-injected at AS level just
    // below. The former Ontology→AS translation (containsOntology) is dead —
    // removed in Phase 3 T3b-cleanup.
    for (const uid of declared) {
      if (folderMapValues.has(uid)) {
        expectedAsUids.add(uid);
      }
    }
    for (const floor of TS_FLOOR_ASSETSPACE_UIDS) expectedAsUids.add(floor);

    // Materialized AS UIDs: .gitmodules ∩ working-tree-on-disk
    // (Phase 6 Vision Lock #9 amendment: `.gitmodules` ≠ materialization state).
    const submodulePaths = await gitOps.readGitmodulesPaths();
    const allInfos = this.listAllAssetSpaceInfos();
    const infoByPath = new Map<string, AssetSpaceInfo>();
    for (const info of allInfos) infoByPath.set(info.folderName, info);
    const materializedAsUids = await this.derivePhysicallyMaterializedAsUids(
      submodulePaths,
      infoByPath,
    );

    // EKA Alpha (issue #3511) — match the apply paths: expand the expected set
    // by the `exo__AssetSpace_dependsOn` closure and keep the catalog mounted,
    // so transitive deps that applyProfile legitimately materialises don't show
    // up as `extra` and trigger a spurious divergence prompt.
    const dependsOnMap = new Map<string, string[]>();
    for (const info of allInfos) {
      if (info.dependsOn !== undefined && info.dependsOn.length > 0) {
        dependsOnMap.set(info.uid, info.dependsOn);
      }
    }
    for (const uid of transitiveDependsOnClosure(expectedAsUids, dependsOnMap)) {
      expectedAsUids.add(uid);
    }
    this.keepMaterializedCatalog(expectedAsUids, allInfos, materializedAsUids);

    // Diff.
    const missing = Array.from(expectedAsUids).filter((u) => !materializedAsUids.has(u));
    const extra = Array.from(materializedAsUids).filter((u) => !expectedAsUids.has(u));
    if (missing.length === 0 && extra.length === 0) {
      return { outcome: "no-divergence" };
    }

    // Surface modal — reuse ApplyPlan shape so ModalConfirmGate renders.
    const reconcilePlan = await this.buildReconcilePlan(
      activeProfileUid,
      missing,
      extra,
      allInfos,
    );
    const approved = this.confirmGate !== undefined
      ? await this.confirmGate.confirmApply(reconcilePlan)
      : true; // No gate wired (tests / headless) — proceed.
    if (!approved) return { outcome: "declined" };
    await this.applyProfile(activeProfileUid);
    return { outcome: "reconciled" };
  }

  /**
   * Build a ApplyPlan describing the reconcile operation — vault has
   * extra AS that local profile doesn't include OR missing AS that local
   * profile expects. Used for the confirm modal in `reconcileToLocal`.
   */
  private async buildReconcilePlan(
    activeProfileUid: string,
    missing: ReadonlyArray<string>,
    extra: ReadonlyArray<string>,
    allInfos: ReadonlyArray<AssetSpaceInfo>,
  ): Promise<ApplyPlan> {
    const targetLabel = await this.profileLabel(activeProfileUid);
    const infoByUid = new Map<string, AssetSpaceInfo>();
    for (const i of allInfos) infoByUid.set(i.uid, i);
    const filesToDestroy = new Map<string, string[]>();
    const tornDown: Array<{ asUid: string; asLabel: string; fileCount: number }> = [];
    for (const uid of extra) {
      const info = infoByUid.get(uid);
      const submodulePath = info?.folderName ?? `assetspaces/${uid}`;
      const files = await this.enumerateFilesUnder(submodulePath);
      filesToDestroy.set(uid, files);
      tornDown.push({
        asUid: uid,
        asLabel: info?.namespace ?? uid.slice(0, 8),
        fileCount: files.length,
      });
    }
    const materialized = missing.map((uid) => ({
      asUid: uid,
      asLabel: infoByUid.get(uid)?.namespace ?? uid.slice(0, 8),
    }));
    return {
      targetProfileUid: activeProfileUid,
      targetProfileLabel: `${targetLabel} (cross-device reconcile)`,
      sourceProfileUid: null,
      sourceProfileLabel: "<diverged remote>",
      filesToDestroy,
      assetSpacesBeingTornDown: tornDown,
      assetSpacesBeingMaterialized: materialized,
    };
  }

  // === Apply helpers ===

  private assertApplyDepsWired(): ResolvedApplyDeps {
    if (
      this.assetSpaceManager === undefined ||
      this.cacheLayer === undefined ||
      this.gitOps === undefined ||
      this.uncommittedGuard === undefined ||
      this.confirmGate === undefined ||
      this.localDataStore === undefined ||
      this.vaultRootPath === undefined
    ) {
      throw new Error(
        "applyProfile: dependencies not wired (assetSpaceManager, cacheLayer, gitOps, uncommittedGuard, confirmGate, localDataStore, vaultRootPath required)",
      );
    }
    return {
      assetSpaceManager: this.assetSpaceManager,
      cacheLayer: this.cacheLayer,
      gitOps: this.gitOps,
      uncommittedGuard: this.uncommittedGuard,
      confirmGate: this.confirmGate,
      localDataStore: this.localDataStore,
      vaultRootPath: this.vaultRootPath,
    };
  }

  private assertTsFloor(
    declaredAsUids: ReadonlySet<string>,
    declaredNamespaces: ReadonlySet<string>,
  ): void {
    // EV8 — delegate to the single named guard in `exocortex`. The plugin
    // enforces the **plugin-UI floor** (= the SDK floor `{exo}`, #3440) so UI
    // commands never self-brick. Issue #3511 (EKA Alpha): the floor is matched
    // by legacy UID OR `exo__AssetSpace_namespace`, so a central-registry vault
    // whose $exo descriptor has a different UID (namespace "exo") still passes.
    assertTsFloorReconciled(declaredAsUids, declaredNamespaces, PLUGIN_UI_FLOOR);
  }

  /**
   * Resolve the target profile's declared AssetSpace set, expanded by its
   * transitive `exo__AssetSpace_dependsOn` closure (EKA Alpha D18, issue #3511),
   * intersected with the known (scanned) AssetSpaces. Asserts the R24 TS-floor
   * (reconciled UID-or-namespace) then returns the effective set (declared ∪
   * TS-floor) for the mount-state diff. Shared by the desktop + REST apply paths
   * to keep the resolution logic identical (parity invariant).
   */
  private async resolveDeclaredAndEffective(
    targetProfileUid: string,
    allInfos: ReadonlyArray<AssetSpaceInfo>,
  ): Promise<{
    declaredAsUids: Set<string>;
    declaredNamespaces: Set<string>;
    effectiveAsUids: Set<string>;
  }> {
    const declaredRoots = await this.computeDerivedSet(targetProfileUid);
    const dependsOnMap = new Map<string, string[]>();
    const folderMapValues = new Set<string>();
    const infoByUid = new Map<string, AssetSpaceInfo>();
    for (const info of allInfos) {
      folderMapValues.add(info.uid);
      infoByUid.set(info.uid, info);
      if (info.dependsOn !== undefined && info.dependsOn.length > 0) {
        dependsOnMap.set(info.uid, info.dependsOn);
      }
    }
    // RFC 01a83de8 Phase 2 — `_includes` are AssetSpace UIDs that resolve
    // directly against the folder map; EKA D18 expands them by the dependsOn
    // closure (leaf-only profiles resolve to their full dependency set).
    const declaredOntologySet = transitiveDependsOnClosure(
      declaredRoots,
      dependsOnMap,
    );
    const declaredAsUids = new Set<string>();
    const declaredNamespaces = new Set<string>();
    for (const uid of declaredOntologySet) {
      if (folderMapValues.has(uid)) {
        declaredAsUids.add(uid);
        const ns = infoByUid.get(uid)?.namespace;
        if (ns !== undefined && ns.length > 0) declaredNamespaces.add(ns);
      }
    }
    // R24 — assert BEFORE any mutation. Use the declared (closure) set so the
    // floor URIs that resolveEffectiveSet would inject don't mask a profile
    // that legitimately omits a floor AS — R24 must see the user's explicit
    // intent. Apply is destructive, so we require explicit intent.
    this.assertTsFloor(declaredAsUids, declaredNamespaces);
    const effectiveAsUids = new Set(declaredAsUids);
    for (const floor of TS_FLOOR_ASSETSPACE_UIDS) effectiveAsUids.add(floor);
    return { declaredAsUids, declaredNamespaces, effectiveAsUids };
  }

  /**
   * EKA Alpha (issue #3511) — protect the catalog AssetSpaces (central registry
   * + profiles) from tear-down. A leaf-profile apply resolves to a dependsOn
   * closure that excludes them, so strict mount-state replace would `rm` the
   * registry that holds every descriptor (one-level self-brick). Add any
   * already-materialised catalog AssetSpace to the effective set so it survives.
   * NOT force-materialised (a vault without them is unaffected). Mutates
   * `effectiveAsUids` in place.
   */
  private keepMaterializedCatalog(
    effectiveAsUids: Set<string>,
    allInfos: ReadonlyArray<AssetSpaceInfo>,
    materializedAsUids: ReadonlySet<string>,
  ): void {
    for (const info of allInfos) {
      if (
        CATALOG_KEEP_NAMESPACES.has(info.namespace) &&
        materializedAsUids.has(info.uid)
      ) {
        effectiveAsUids.add(info.uid);
      }
    }
  }

  private listAllAssetSpaceInfos(): AssetSpaceInfo[] {
    // Single vault scan — extracts AssetSpace ABox metadata directly from
    // frontmatter. Independent of AssetSpaceManager (так apply tests
    // and recovery-only flows can call this without a wired manager).
    const out: AssetSpaceInfo[] = [];
    const seen = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm) continue;
      const uid = typeof fm["exo__Asset_uid"] === "string" ? (fm["exo__Asset_uid"] as string) : null;
      if (uid === null) continue;
      if (seen.has(uid)) continue;
      // Recognise AssetSpace descriptors by EITHER the canonical AssetSpace
      // class UID (`73bd00e4-…`, strict wikilink — same as AssetSpaceManager /
      // AssetSpaceMaterializationTracker / AssetSpaceLookupHelper / CLI) OR the
      // legacy label-form substring. The substring-only check SILENTLY skipped
      // UID-canon registry descriptors (`exo__Instance_class: [[73bd00e4-…]]`,
      // RFC UUID-canon TBox) → a leaf-profile apply got an empty effective set
      // → no-op apply (the EKA Obsidian-leg #3511 GUI regression). The OR keeps
      // the legacy label-form (`[[exo__AssetSpace]]`) recognised too, so this is
      // strictly additive — no behaviour change for existing label-form vaults.
      const instanceClass = fm["exo__Instance_class"];
      const classes: string[] = Array.isArray(instanceClass)
        ? instanceClass.filter((c): c is string => typeof c === "string")
        : typeof instanceClass === "string"
          ? [instanceClass]
          : [];
      const isAssetSpace =
        isAssetSpaceFrontmatter(fm) ||
        classes.some(
          (c) => c.includes("AssetSpace") && !c.includes("AssetSpaceManager"),
        );
      if (!isAssetSpace) continue;
      // Dual-read `_source ?? _git` (RFC 01a83de8 v10 T3) — new
      // `exo__AssetSpace_source` supersedes legacy `_git` during the transition.
      const source = typeof fm["exo__AssetSpace_source"] === "string"
        ? (fm["exo__AssetSpace_source"] as string)
        : "";
      const git = source || (typeof fm["exo__AssetSpace_git"] === "string"
        ? (fm["exo__AssetSpace_git"] as string)
        : "");
      const namespace = typeof fm["exo__AssetSpace_namespace"] === "string"
        ? (fm["exo__AssetSpace_namespace"] as string)
        : "";
      // `git` is essential (folder derivation + materialise). `namespace` is
      // OPTIONAL — real registry descriptors (Maven-style) may omit it, and the
      // CLI resolver keeps them too (parity, issue #3511 — gating on namespace
      // would silently shrink the plugin's dependsOn closure vs the CLI's).
      // Label/floor-namespace fall back gracefully on an empty namespace.
      if (!git) continue;
      const lastPulledSha = typeof fm["exo__AssetSpace_lastPulledSha"] === "string"
        ? (fm["exo__AssetSpace_lastPulledSha"] as string)
        : undefined;
      // EKA Alpha D18 dependsOn DAG (issue #3511) — transitive-dep edges so a
      // leaf-only profile can be expanded to its closure.
      const dependsOn = parseDependsOnWikilinks(fm["exo__AssetSpace_dependsOn"]);
      // RFC 01a83de8 Phase 1b T3 — folder = derived mount path
      // (`assetspaces/<owner>/<repo>`), not the descriptor's parent folder
      // (post-migration the descriptor lives in the registry). parentFolderOf
      // is a defensive fallback for unresolvable sources.
      const folderName = derivePath(git) ?? parentFolderOf(file.path);
      seen.add(uid);
      out.push({ uid, git, namespace, folderName, lastPulledSha, dependsOn });
    }
    return out;
  }

  private async scanFolderToAsUid(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const info of this.listAllAssetSpaceInfos()) {
      out.set(info.folderName, info.uid);
    }
    return out;
  }

  /**
   * Derives currently-materialized AssetSpace UIDs by intersecting
   * `.gitmodules` entries with on-disk working-tree presence (via
   * `vault.adapter.exists`).
   *
   * Phase 6 Vision Lock #9 amendment (RFC 13da049f v1.3): `.gitmodules`
   * entries persist post-destroy as per-vault URL registry. Therefore
   * materialization state ≠ `.gitmodules` membership. Source of truth =
   * working tree directory exists in vault.
   *
   * Without this intersection, switch-back from B→A would see X's
   * `.gitmodules` entry, conclude «already materialized», and skip the
   * re-materialization that Phase 6.1 AC2 requires.
   */
  private async derivePhysicallyMaterializedAsUids(
    submodulePaths: Iterable<string>,
    infoBySubmodulePath: ReadonlyMap<string, AssetSpaceInfo>,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    for (const submodulePath of submodulePaths) {
      const info = infoBySubmodulePath.get(submodulePath);
      if (info === undefined) continue;
      const exists = await this.app.vault.adapter.exists(submodulePath);
      if (exists) result.add(info.uid);
    }
    return result;
  }

  private async enumerateFilesUnder(submodulePath: string): Promise<string[]> {
    // Recursive walk via Obsidian vault.adapter.list. Returns vault-relative
    // paths. Apply needs total file counts up-front for the modal; can't
    // lazy-stream.
    const out: string[] = [];
    await this.walkVaultDir(submodulePath, out);
    return out;
  }

  private async walkVaultDir(dir: string, out: string[]): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(dir);
      if (!exists) return;
      const result = await this.app.vault.adapter.list(dir);
      for (const f of result.files) {
        if (f.endsWith("/")) continue;
        out.push(f);
      }
      for (const sub of result.folders) {
        // Skip dot-dirs to avoid `.git` traversal (defense-in-depth).
        const base = sub.split("/").pop() ?? sub;
        if (base.startsWith(".")) continue;
        await this.walkVaultDir(sub, out);
      }
    } catch {
      // Best-effort: directory may not exist or be inaccessible.
    }
  }

  private async releaseStagingPaths(
    stagingPaths: ReadonlyArray<{ asUid: string; stagingPath: string }>,
  ): Promise<void> {
    if (this.assetSpaceManager === undefined) return;
    const tracker = this.assetSpaceManager.stagingTracker;
    for (const { stagingPath } of stagingPaths) {
      if (tracker !== null) {
        await tracker.release(stagingPath).catch(() => undefined);
      } else {
        try {
          // Lazy accessor (Issue #3464) — this branch is desktop-only
          // (staging paths only exist after a desktop pull).
          const fs = nodeFsPromises();
          await fs.rm(stagingPath, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      }
    }
  }

  private async attemptCacheRollback(
    toDestroy: ReadonlyArray<{ asUid: string; submodulePath: string }>,
  ): Promise<void> {
    const cacheLayer = this.cacheLayer;
    const vaultRootPath = this.vaultRootPath;
    if (cacheLayer === undefined || vaultRootPath === undefined) return;
    for (const target of toDestroy) {
      try {
        const targetPath = vaultRootPath + "/" + target.submodulePath;
        await cacheLayer.restore(target.asUid, targetPath);
      } catch {
        // Skip — partial rollback acceptable; user-facing notice covers gap.
      }
    }
  }

  private async readJournalTail(maxEntries: number): Promise<SwitchJournalEntry[]> {
    try {
      const exists = await this.app.vault.adapter.exists(this.journalPath);
      if (!exists) return [];
      const text = await this.app.vault.adapter.read(this.journalPath);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      const tail = lines.slice(-maxEntries);
      const out: SwitchJournalEntry[] = [];
      for (const line of tail) {
        try {
          out.push(JSON.parse(line) as SwitchJournalEntry);
        } catch {
          // Skip malformed.
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  // === Helpers ===

  private async walkProfileChain(
    uid: string,
    visited: Set<string>,
    result: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth > this.maxExtendsDepth) {
      throw new Error(
        `Profile chain exceeds max depth ${this.maxExtendsDepth} at ${uid} — possible cycle`,
      );
    }
    if (visited.has(uid)) return; // cycle guard
    visited.add(uid);

    const profile = await this.resolver.resolve(uid);
    if (profile === null) return; // tolerate missing parent — leaf

    for (const u of profile.includes) result.add(u);

    if (typeof profile.extends === "string" && profile.extends.length > 0) {
      await this.walkProfileChain(profile.extends, visited, result, depth + 1);
    }
  }

  private async appendJournal(entry: SwitchJournalEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    let existing = "";
    try {
      const exists = await this.app.vault.adapter.exists(this.journalPath);
      if (exists) existing = await this.app.vault.adapter.read(this.journalPath);
    } catch {
      existing = "";
    }
    await this.app.vault.adapter.write(this.journalPath, existing + line);
  }

  private async readLastJournalEntry(): Promise<SwitchJournalEntry | null> {
    try {
      const exists = await this.app.vault.adapter.exists(this.journalPath);
      if (!exists) return null;
      const text = await this.app.vault.adapter.read(this.journalPath);
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) return null;
      return JSON.parse(lines[lines.length - 1]) as SwitchJournalEntry;
    } catch {
      return null;
    }
  }

  private async profileLabel(uid: string): Promise<string> {
    try {
      const p = await this.resolver.resolve(uid);
      return p?.label ?? uid.slice(0, 8);
    } catch {
      return uid.slice(0, 8);
    }
  }

  /**
   * Never-hang watchdog (Issue #3532). Race `work()` against {@link applyTimeoutMs}.
   *
   * Obsidian's `vault.adapter` writes (lock + journal), `rdfIndexer.refresh()`,
   * and (pre-#3531) `requestUrl` have no shared upper bound — a single stalled
   * step on macOS desktop left the whole apply pending forever (the
   * `_switchInProgress`-never-flips signature in #3532). On timeout we REJECT
   * with a clear, PAT-free error AND run `onTimeout` (best-effort clear of the
   * persisted in-progress flag + lock release), because the stuck `work` promise
   * won't run its own `finally` while it's still pending. If `work` settles
   * normally (success OR a real error) `onTimeout` never runs — `work`'s own
   * try/catch/finally already cleaned up; the two are idempotent if both fire.
   *
   * The losing (stuck) promise cannot be cancelled, so it is left to settle and
   * its eventual result discarded; `clearTimeout` on the win path prevents a
   * leaked timer.
   */
  private async withApplyDeadline<T>(
    work: () => Promise<T>,
    label: string,
    onTimeout: () => Promise<void>,
    timeoutMs: number,
  ): Promise<T> {
    const workPromise = work();
    if (timeoutMs <= 0) return workPromise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `applyProfile "${label}" timed out after ${timeoutMs}ms — ` +
              `a step stalled (network / git / filesystem). The vault may be ` +
              `unchanged or partially applied; reload Obsidian and re-check. ` +
              `(Issue #3532)`,
          ),
        );
      }, timeoutMs);
      // Unref so a pending timer never keeps a Node test process alive; guarded
      // because Electron renderer / browser timers expose no `unref`.
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    try {
      return await Promise.race([workPromise, deadline]);
    } finally {
      clearTimeout(timer);
      if (timedOut) {
        await onTimeout().catch(() => undefined);
      }
    }
  }

  /**
   * Compute the never-hang watchdog deadline (Issue #3532, code-review MEDIUM)
   * scaled by the amount of work. The post-confirm loop pulls + clones each
   * AssetSpace SEQUENTIALLY (Phase 1 pull ≤120s + Phase 2 clone ≤300s per AS),
   * so a flat deadline would false-positive-reject a HEALTHY large cold apply
   * (EKA alpha mounts ~16-18 AssetSpaces). Allot a per-unit budget on top of the
   * configured base; `applyTimeoutMs <= 0` keeps the watchdog disabled.
   */
  private computeApplyDeadlineMs(unitCount: number): number {
    if (this.applyTimeoutMs <= 0) return 0;
    // `applyTimeoutMs` is the PER-UNIT budget; the overall deadline is it × the
    // number of AssetSpaces being pulled/cloned/unmounted (they run
    // sequentially). A single-AS apply gets the full base; a 16-18-AS EKA-alpha
    // cold apply gets proportionally more so a healthy run is never
    // false-positive-rejected. Finite either way (never-hang). Generous by
    // design — the tight per-step protection is #3531's 120s/300s bounds, which
    // reject a stalled network/git step (with a clear message) well before this
    // coarse backstop.
    return this.applyTimeoutMs * Math.max(1, unitCount);
  }

  /**
   * Best-effort recovery after a watchdog timeout on a path backed by
   * {@link PluginLocalDataStore} (desktop apply + REST apply). Clears the
   * persisted `_switchInProgress` flag and releases the lock so the next apply
   * is not blocked by a stuck state. All failures swallowed — this runs in a
   * degraded (stalled) environment.
   */
  private async clearStuckLocalState(
    localDataStore: PluginLocalDataStore,
  ): Promise<void> {
    try {
      const s = localDataStore.snapshot();
      await localDataStore.save({
        activeProfileUid: s.activeProfileUid,
        _switchInProgress: false,
      });
    } catch {
      // Swallow — best-effort in a degraded environment.
    }
    try {
      await this.lockMgr.releaseLock();
    } catch {
      // Swallow.
    }
  }

  /**
   * Best-effort recovery after a watchdog timeout on the reindex path, which
   * tracks `_switchInProgress` via {@link settingsStore} (not localDataStore).
   */
  private async clearStuckSettingsState(): Promise<void> {
    try {
      const s = await this.settingsStore.load();
      s._switchInProgress = false;
      await this.settingsStore.save(s);
    } catch {
      // Swallow.
    }
    try {
      await this.lockMgr.releaseLock();
    } catch {
      // Swallow.
    }
  }

  /**
   * Ensure the `.exocortex/` parent dir (holding the lock + journal files)
   * exists before the first write. Obsidian's `vault.adapter.write` does NOT
   * create parent directories, so on a fresh vault the very first lock/journal
   * write would throw ENOENT (Issue #3532 defensive; mirrors the Docker-e2e
   * manual `mkdir .exocortex/` workaround). Best-effort + idempotent: skips if
   * the dir already exists and swallows mkdir errors (a genuine failure surfaces
   * later as a clear write error rather than a confusing mkdir trace).
   */
  private async ensureExocortexDir(): Promise<void> {
    const idx = this.journalPath.lastIndexOf("/");
    if (idx <= 0) return;
    const dir = this.journalPath.slice(0, idx);
    try {
      if (await this.app.vault.adapter.exists(dir)) return;
      const adapter = this.app.vault.adapter as unknown as {
        mkdir?: (p: string) => Promise<void>;
      };
      if (typeof adapter.mkdir === "function") {
        await adapter.mkdir(dir);
      }
    } catch {
      // Best-effort — the subsequent write surfaces a clear error if needed.
    }
  }

  /**
   * Redact GitHub PAT shapes from error messages — defensive depth (same regex
   * as B.1 GitHubRestClient). Even though this class doesn't directly handle
   * PATs, downstream errors могут carry them through stacktrace.
   */
  private redactError(msg: string): string {
    return msg.replace(
      /(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,})/g,
      "***REDACTED***",
    );
  }
}

function parentFolderOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx < 0 ? "" : filePath.slice(0, idx);
}

/**
 * Parse an `exo__AssetSpace_dependsOn` frontmatter value (a single wikilink, an
 * array of wikilinks, or undefined) to the bare UID portion of each entry
 * (`[[uid|alias]]` → `uid`). Used to build the EKA D18 dependsOn DAG (#3511).
 */
function parseDependsOnWikilinks(value: unknown): string[] {
  const arr: unknown[] = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const uid = raw
      .trim()
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]
      .trim();
    if (uid.length > 0) out.push(uid);
  }
  return out;
}
