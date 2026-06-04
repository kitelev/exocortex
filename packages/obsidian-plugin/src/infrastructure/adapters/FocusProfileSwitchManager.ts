import type { App } from "obsidian";
import type { HardSwitchPlan, IConfirmGate } from "exocortex";

import { PluginLockManager } from "./PluginLockManager";
import type { AssetSpaceManager, AssetSpaceInfo } from "./AssetSpaceManager";
import type { ICacheLayer } from "./SwitchCacheLayer";
import type { GitSubmoduleOps } from "./GitSubmoduleOps";
import type { UncommittedChangesGuard } from "./UncommittedChangesGuard";
import type { PluginLocalDataStore } from "./PluginLocalDataStore";
import { TS_FLOOR_ASSETSPACE_UIDS } from "./FocusProfileOnloadWiring";

/**
 * FocusProfileSwitchManager — coordinates profile switching:
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
 * `exo__FocusProfile` class UID (frozen by RFC b6ba5595).
 *
 * RFC 13da049f Phase 6.5b (AC13) — **filter-only narrowing**: a FocusProfile
 * is strictly a *soft switch* — a query-time RDF-graph filter. It does NOT
 * materialise filesystem state; physical AssetSpace materialisation is the
 * responsibility of `exo__KnowledgeProfile` (hard switch, see
 * {@link KNOWLEDGE_PROFILE_CLASS_UID} + {@link hardSwitchKnowledgeProfile}).
 * The optional `exo__FocusProfile_appliesTo` predicate binds a FocusProfile to
 * the Knowledge profile it is meant to narrow — consumed at runtime by the
 * AC16 compatibility check in {@link softSwitchFocusProfile}.
 */
export const FOCUS_PROFILE_CLASS_UID = "3de846cd-1f0e-4f98-8613-b8587aa15174";

/**
 * `exo__KnowledgeProfile` class UID (RFC 13da049f Phase 6.5b).
 *
 * A KnowledgeProfile drives the **hard switch** — destructive filesystem
 * materialisation of `assetspaces/<as>/`. Distinct from {@link FOCUS_PROFILE_CLASS_UID}
 * (query-time filter only). An asset may declare BOTH classes (dual-class) when
 * it serves as both a materialisation target and a query-time filter.
 */
export const KNOWLEDGE_PROFILE_CLASS_UID =
  "b8884976-596f-43d2-b7f4-3da518f825d4";

/**
 * TS-floor (Vision Lock #17): ontology URIs that are ALWAYS in the effective
 * set, regardless of profile config. Hardcoded — never destroyable.
 * Prevents plugin self-brick если user accidentally removes $exo from a profile.
 */
export const TS_FLOOR_ONTOLOGY_URIS: ReadonlySet<string> = new Set([
  "https://exocortex.my/ontology/exo",
  "https://exocortex.my/ontology/exocmd",
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
  /** Directly declared `_includes` (ontology URIs). */
  includes: string[];
  /** Parent profile UID (resolves transitive). May be null/undefined. */
  extends?: string | null;
  /** Directly declared `_alwaysOnOverlay` (ontology URIs). */
  alwaysOnOverlay: string[];
  /**
   * Optional `exo__FocusProfile_appliesTo` (RFC 13da049f Phase 6.5b AC13) —
   * the Knowledge profile UID this Focus profile is scoped to. When declared,
   * the AC16 compatibility check (see {@link FocusProfileSwitchManager.softSwitchFocusProfile})
   * WARN+fallbacks to no-filter if the active Knowledge profile differs.
   * Empty / null means «applies to any active Knowledge — subset check only».
   */
  appliesTo?: string | null;
  /** Display label (used in user-facing Notice). */
  label?: string;
}

/**
 * Resolves a FocusProfile asset by UID. Production implementation reads via
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
   * Re-index the RDF graph filtering by the given effective ontology set.
   * Implementations (NoteToRDFConverter) skip files whose AssetSpace's
   * ontology is not in `effectiveOntologies`.
   */
  refresh(effectiveOntologies: ReadonlySet<string>): Promise<void>;
}

export interface SwitchSettings {
  activeProfileUid: string | null;
  /**
   * Active Knowledge profile slot (RFC 13da049f Phase 6.5b AC14). Optional —
   * pre-AC14 stores omit it; the backing adapter preserves the on-disk value
   * via read-modify-write when undefined.
   */
  activeKnowledgeProfileUid?: string | null;
  /** Active Focus profile slot (RFC 13da049f Phase 6.5b AC14). Optional — see above. */
  activeFocusProfileUid?: string | null;
  _switchInProgress: boolean;
}

export interface ISettingsStore {
  load(): Promise<SwitchSettings>;
  save(s: SwitchSettings): Promise<void>;
}

/**
 * Journal entry shape — widened для hard-switch phase events per RFC
 * 22b50a17 F2 (per-AS recovery granularity). Soft-switch continues using
 * the three base phases (`starting`/`completed`/`failed`); hard-switch
 * emits the extended phase set with `as` field for per-AS events.
 */
export interface SwitchJournalEntry {
  phase:
    | "starting"
    | "completed"
    | "failed"
    // Hard-switch extended phases (RFC 22b50a17 §Solution Architecture):
    | "hard-switch-starting"
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
    | "hard-switch-completed"
    | "hard-switch-failed"
    | "recovery-restoring"
    | "recovery-completed";
  targetUid: string;
  ts: string; // ISO
  /** Per-AS UID for phase2-destroy-cached / phase2-materialized etc. */
  as?: string;
  elapsedMs?: number;
  error?: string;
}

export interface FocusProfileSwitchManagerOptions {
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

  // --- Hard-switch dependencies (RFC 22b50a17 Phase 3) ---
  /** AssetSpaceManager — provides pullAssetSpace + lookupAssetSpaceInfo. */
  assetSpaceManager?: AssetSpaceManager;
  /** Filesystem cache layer — destroy/restore tarballs (RFC §B.5). */
  cacheLayer?: ICacheLayer;
  /** Git submodule operations wrapper. */
  gitOps?: GitSubmoduleOps;
  /** Uncommitted-changes guard (Vision Lock #5). */
  uncommittedGuard?: UncommittedChangesGuard;
  /** Confirmation gate — ModalConfirmGate в plugin runtime. */
  confirmGate?: IConfirmGate;
  /** Device-local data store (`_switchInProgress` flag, activeProfileUid). */
  localDataStore?: PluginLocalDataStore;
  /** Absolute path к vault root — required for git operations. */
  vaultRootPath?: string;
}

const DEFAULT_JOURNAL_PATH = ".exocortex/switch-journal.jsonl";
const DEFAULT_MAX_EXTENDS_DEPTH = 5;

/**
 * Custom error thrown by R24 TS-floor guard. Distinguishable by name so
 * callers (palette command, recoverIncompleteSwitch) can surface clear UX.
 */
export class TsFloorViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TsFloorViolationError";
  }
}

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
 * Custom error thrown when the user declines the hard-switch ConfirmGate.
 */
export class HardSwitchAbortedByUser extends Error {
  constructor(message = "Hard switch aborted by user") {
    super(message);
    this.name = "HardSwitchAbortedByUser";
  }
}

export class FocusProfileSwitchManager {
  private readonly app: App;
  private readonly lockMgr: PluginLockManager;
  private readonly resolver: IProfileResolver;
  private readonly rdfIndexer: IRdfIndexer;
  private readonly settingsStore: ISettingsStore;
  private readonly journalPath: string;
  private readonly maxExtendsDepth: number;
  private readonly now: () => Date;
  private readonly notify: (message: string) => void;

  // Hard-switch dependencies (may be undefined when only soft switch wired).
  private readonly assetSpaceManager?: AssetSpaceManager;
  private readonly cacheLayer?: ICacheLayer;
  private readonly gitOps?: GitSubmoduleOps;
  private readonly uncommittedGuard?: UncommittedChangesGuard;
  private readonly confirmGate?: IConfirmGate;
  private readonly localDataStore?: PluginLocalDataStore;
  private readonly vaultRootPath?: string;

  constructor(options: FocusProfileSwitchManagerOptions) {
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
    this.uncommittedGuard = options.uncommittedGuard;
    this.confirmGate = options.confirmGate;
    this.localDataStore = options.localDataStore;
    this.vaultRootPath = options.vaultRootPath;
  }

  /**
   * Soft switch — set the active FocusProfile (RDF query-time filter only).
   * Lock-guarded, journaled. Idempotent re-index on failure (no destructive
   * rollback in v3). Does NOT mutate the filesystem — that is hard switch
   * (see {@link hardSwitchKnowledgeProfile}).
   *
   * RFC 13da049f Phase 6.5b (AC13) — **filter-only narrowing**: the Focus
   * filter narrows the *view* within the materialised Knowledge set; it never
   * materialises ontologies the active Knowledge profile does not provide.
   *
   * AC16 — **compatibility check (WARN + fallback, NEVER throw)**: before
   * applying the target profile's filter, validate it against the active
   * Knowledge profile (`activeKnowledgeProfileUid`, surfaced by
   * `PluginSettingsStoreAdapter` from `localDataStore.getActiveKnowledgeProfileUid()`):
   *   - If the target declares `_appliesTo` and it differs from the active
   *     Knowledge profile → incompatible.
   *   - If the active Knowledge profile's effective set is empty / not
   *     materialised (EC3) → incompatible.
   *   - If the target's `_includes ⊄ active Knowledge effective set` →
   *     incompatible.
   * On incompatibility the switch still **resolves successfully** (no throw):
   * it logs a `console.warn`, surfaces a `Notice`, and sets the RDF filter to
   * **no-filter** (empty set → full vault) instead of the target's narrowed
   * set. When no Knowledge profile is active and the target declares no
   * `_appliesTo`, the check is a backward-compatible pass-through (pre-AC16
   * behaviour — the declared filter is applied).
   *
   * RFC 13da049f Phase 6.5b (AC15): canonical name for the soft-switch path.
   * Legacy callers reach this via the deprecated {@link switchProfile} /
   * {@link softSwitchProfile} aliases.
   */
  async softSwitchFocusProfile(targetProfileUid: string): Promise<void> {
    const acquired = await this.lockMgr.acquireLock(`switch-profile-${targetProfileUid}`);
    if (!acquired) {
      throw new Error(`Another switch is in progress (lock held). Try again shortly.`);
    }

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
        void this.lockMgr.heartbeat();
      }, 30_000);

      // Resolve effective set ONCE before any settings mutation
      const effective = await this.resolveEffectiveSet(targetProfileUid);

      // Persist BEFORE filesystem changes (Architect #2 — atomicity invariant)
      const settings = await this.settingsStore.load();

      // AC16 — compatibility check against the active Knowledge profile. On
      // violation we still persist the Focus selection but apply a no-filter
      // (empty set → full vault) instead of the target's narrowed set. The
      // check NEVER throws (R37 — soft fallback).
      const compat = await this.evaluateFocusKnowledgeCompat(
        targetProfileUid,
        settings,
      );
      // No-filter signal: an empty set makes `NoteToRDFConverter` fall back to
      // the no-filter path (see `shouldSkipFileForEffectiveSet` — empty
      // effective set → index everything, avoids self-brick).
      const filterSet: ReadonlySet<string> = compat.compatible
        ? effective
        : new Set<string>();
      if (!compat.compatible) {
        // AC16 action #1 — console.warn with the compatibility violation.
        console.warn(`[FocusProfileSwitchManager] ${compat.reason}`);
        // AC16 action #2 — user-facing Notice.
        this.notify(compat.userMessage);
      }

      settings.activeProfileUid = targetProfileUid;
      // AC14 — soft switch owns the Focus slot. The legacy `activeProfileUid`
      // mirror is retained above for backward read / downgrade safety.
      settings.activeFocusProfileUid = targetProfileUid;
      settings._switchInProgress = true;
      await this.settingsStore.save(settings);

      // AC16 action #3 — Trigger RDF re-index (no-filter set on violation).
      await this.rdfIndexer.refresh(filterSet);

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

      // On the compatible path emit the success Notice. On the incompatible
      // path the AC16 fallback Notice (above) is the user-facing message, so
      // we skip a second «Switched…» line to avoid implying the narrowed view
      // was applied when it was not.
      if (compat.compatible) {
        const profileLabel = await this.profileLabel(targetProfileUid);
        this.notify(`Switched to ${profileLabel} (${elapsedMs}ms)`);
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
      await this.lockMgr.releaseLock();
    }
  }

  /**
   * @deprecated Use {@link softSwitchFocusProfile}. Retained for backward
   * compatibility (RFC 13da049f Phase 6.5b AC15 — Knowledge/Focus split).
   * This was the original method name before the soft/hard semantic split.
   */
  async switchProfile(targetProfileUid: string): Promise<void> {
    return this.softSwitchFocusProfile(targetProfileUid);
  }

  /**
   * @deprecated Use {@link softSwitchFocusProfile}. Alias matching the RFC
   * 13da049f naming convention (`softSwitchProfile` → `softSwitchFocusProfile`).
   */
  async softSwitchProfile(targetProfileUid: string): Promise<void> {
    return this.softSwitchFocusProfile(targetProfileUid);
  }

  /**
   * @deprecated Use {@link hardSwitchKnowledgeProfile}. Retained for backward
   * compatibility (RFC 13da049f Phase 6.5b AC15 — Knowledge/Focus split).
   * Hard switch materialises filesystem state, so it is semantically a
   * Knowledge-profile operation.
   */
  async hardSwitchProfile(targetProfileUid: string): Promise<void> {
    return this.hardSwitchKnowledgeProfile(targetProfileUid);
  }

  /**
   * Plugin-load recovery: if last journal entry shows an incomplete switch
   * AND settings._switchInProgress=true, re-trigger the re-index идempotently.
   *
   * In v3 backward-compat mode: re-index is pure (no filesystem state to roll
   * back), so we simply call switchProfile again — it's safe.
   *
   * In Phase C+D future: this would need full two-phase rollback (restore
   * staging dir, undo destroy). Deferred.
   */
  async recoverIfNeeded(): Promise<{ recovered: boolean; targetUid: string | null }> {
    const lastEntry = await this.readLastJournalEntry();
    const settings = await this.settingsStore.load();

    if (!lastEntry) return { recovered: false, targetUid: null };
    if (lastEntry.phase === "completed") return { recovered: false, targetUid: null };
    if (!settings._switchInProgress) return { recovered: false, targetUid: null };

    // Incomplete: re-trigger
    this.notify(`Recovering incomplete switch to ${lastEntry.targetUid}...`);
    await this.softSwitchFocusProfile(lastEntry.targetUid);
    return { recovered: true, targetUid: lastEntry.targetUid };
  }

  /**
   * Compute the effective ontology URI set for a given profile.
   *
   * = derived(profile) ∪ TS_FLOOR ∪ discoveredSharedOntologies
   *
   * Where derived = includes ∪ extends*[alwaysOnOverlay] ∪ includes (transitive).
   *
   * TS-floor (Vision Lock #17) — hardcoded `[$exo, $exocmd]` + pattern match
   * для shared-identities — guarantees the plugin keeps functioning regardless
   * of profile config.
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

  /**
   * AC16 (RFC 13da049f Phase 6.5b) — evaluate whether a target FocusProfile is
   * compatible with the currently-active Knowledge profile.
   *
   * Decision layers (matches `exo__FocusProfile_appliesTo` TBox semantics):
   *   1. `_appliesTo` declared → must equal the active Knowledge UID; any
   *      mismatch (including no active Knowledge) is incompatible.
   *   2. No `_appliesTo` AND no active Knowledge → backward-compatible
   *      pass-through (apply the declared filter; pre-AC16 behaviour).
   *   3. Active Knowledge resolves to an empty derived set (EC3 — not
   *      materialised) → incompatible.
   *   4. Target `_includes ⊄ active Knowledge effective set` → incompatible.
   *
   * The active Knowledge UID is read from `settings.activeKnowledgeProfileUid`,
   * which `PluginSettingsStoreAdapter` populates from
   * `PluginLocalDataStore.getActiveKnowledgeProfileUid()`.
   *
   * NEVER throws — on any evaluation error it returns `compatible` (apply the
   * declared filter) and logs, so a compat-evaluation bug cannot block a switch
   * (AC16 invariant: WARN + fallback, never throw).
   */
  private async evaluateFocusKnowledgeCompat(
    targetProfileUid: string,
    settings: SwitchSettings,
  ): Promise<
    | { compatible: true }
    | { compatible: false; reason: string; userMessage: string }
  > {
    try {
      const activeKnowledgeUid =
        typeof settings.activeKnowledgeProfileUid === "string" &&
        settings.activeKnowledgeProfileUid.length > 0
          ? settings.activeKnowledgeProfileUid
          : null;

      const profile = await this.resolver.resolve(targetProfileUid);
      const appliesTo =
        profile !== null &&
        typeof profile.appliesTo === "string" &&
        profile.appliesTo.length > 0
          ? profile.appliesTo
          : null;

      // Layer 1 — `_appliesTo` declared: the Focus profile is bound to one
      // Knowledge profile. Mismatch (incl. no active Knowledge) is incompatible.
      if (appliesTo !== null) {
        if (activeKnowledgeUid !== appliesTo) {
          return {
            compatible: false,
            reason:
              `Focus profile ${targetProfileUid} declares _appliesTo=${appliesTo} but active ` +
              `Knowledge profile is ${activeKnowledgeUid ?? "<none>"}. Applying no-filter (AC16 ` +
              `applies-to mismatch — soft fallback, no throw).`,
            userMessage:
              "Focus profile is scoped to a different Knowledge profile — showing the full " +
              "vault instead. Hard-switch the matching Knowledge profile first to narrow the view.",
          };
        }
        // appliesTo === activeKnowledgeUid → fall through to the subset check.
      } else if (activeKnowledgeUid === null) {
        // Layer 2 — no `_appliesTo` constraint AND no active Knowledge profile:
        // there is no Knowledge scope to validate against. Backward-compatible
        // pass-through (pre-AC16 behaviour) — apply the Focus filter as declared.
        return { compatible: true };
      }

      // Defensive: activeKnowledgeUid is non-null past this point (either
      // appliesTo matched it, or appliesTo was absent but Knowledge is active).
      if (activeKnowledgeUid === null) return { compatible: true };

      // Layer 3 (EC3) — active Knowledge resolves to an empty derived set
      // (no declared ontologies, e.g. not materialised). Cannot validate the
      // Focus scope against it → no-filter fallback.
      const knowledgeDerived = await this.computeDerivedSet(activeKnowledgeUid);
      if (knowledgeDerived.size === 0) {
        return {
          compatible: false,
          reason:
            `Active Knowledge profile ${activeKnowledgeUid} has an empty effective set ` +
            `(not materialised) — cannot validate Focus scope. Applying no-filter (AC16 EC3).`,
          userMessage:
            "The active Knowledge profile has no materialised ontologies yet — showing the full " +
            "vault. Hard-switch a Knowledge profile to enable focused filtering.",
        };
      }

      // Layer 4 — `_includes ⊆ active Knowledge effective set`. The effective
      // set includes the TS-floor, so a Focus profile may always reference the
      // plugin foundations ($exo, $exocmd) regardless of the Knowledge declaration.
      const knowledgeEffective =
        await this.resolveEffectiveSet(activeKnowledgeUid);
      const includes = profile !== null ? profile.includes : [];
      const missing = includes.filter((u) => !knowledgeEffective.has(u));
      if (missing.length > 0) {
        return {
          compatible: false,
          reason:
            `Focus profile ${targetProfileUid} _includes references ontologies outside the active ` +
            `Knowledge effective set: ${missing.slice(0, 5).join(", ")}` +
            `${missing.length > 5 ? ", …" : ""}. Applying no-filter (AC16 subset violation).`,
          userMessage:
            "Focus profile references ontologies the active Knowledge profile does not provide — " +
            "showing the full vault to avoid an empty view.",
        };
      }

      return { compatible: true };
    } catch (e) {
      // AC16 invariant — compat evaluation must never throw / block the switch.
      // Proceed with the declared filter (failing closed to no-filter would
      // surprise the user more than a best-effort narrowed view).
      console.warn(
        `[FocusProfileSwitchManager] compat evaluation errored for ${targetProfileUid}; ` +
          `proceeding with the declared filter. ${this.redactError(String(e))}`,
      );
      return { compatible: true };
    }
  }

  // === Hard switch orchestration (RFC 22b50a17 Phase 3) ===

  /**
   * Hard switch — destructive filesystem mutation of `assetspaces/<as>/`
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
   *   5. Build HardSwitchPlan + confirmGate.confirmHardSwitch(plan) — abort
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
   *  11. rdfIndexer.refresh(effective) for new RDF view.
   *  12. Release lock + clear staging.
   *
   * On catch: attempt cache.restore(prevActiveProfileUid) для best-effort
   * rollback; rethrow.
   *
   * @throws TsFloorViolationError if target excludes any TS-floor AS.
   * @throws UncommittedChangesAbortError if dirty files in any to-destroy AS.
   * @throws HardSwitchAbortedByUser if confirmGate declines.
   */
  async hardSwitchKnowledgeProfile(targetProfileUid: string): Promise<void> {
    if (typeof targetProfileUid !== "string" || targetProfileUid.length === 0) {
      throw new Error("hardSwitchKnowledgeProfile: targetProfileUid is required");
    }
    const deps = this.assertHardSwitchWired();

    const startedAt = this.now().getTime();
    const prevActiveProfileUid = deps.localDataStore.getActiveProfileUid();
    const targetProfileLabel = await this.profileLabel(targetProfileUid);
    const sourceProfileLabel = prevActiveProfileUid !== null
      ? await this.profileLabel(prevActiveProfileUid)
      : "<unknown>";

    // R24 — assert TS-floor BEFORE any mutation. Use computeDerivedSet (NOT
    // resolveEffectiveSet) because the latter silently injects TS_FLOOR_ONTOLOGY_URIS
    // before returning — feeding that injected set into our translation step
    // would auto-rescue the floor through containsOntology mapping and
    // defeat the guard's purpose. Soft-switch (Phase 1 onload wiring) silently
    // injects floor for UX; hard-switch is destructive so we require explicit
    // intent in the user's profile declaration.
    const declaredOntologySet = await this.computeDerivedSet(targetProfileUid);
    const folderToAsUid = await this.scanFolderToAsUid();
    const ontologyToAs = await this.scanOntologyToAsUid();
    const declaredAsUids = new Set<string>();
    const folderMapValues = new Set(folderToAsUid.values());
    for (const uid of declaredOntologySet) {
      if (folderMapValues.has(uid)) {
        declaredAsUids.add(uid);
        continue;
      }
      const translated = ontologyToAs.get(uid);
      if (translated !== undefined) declaredAsUids.add(translated);
    }
    this.assertTsFloor(declaredAsUids);

    // For the actual mutation diff, also accept the shared-ontology discovery
    // (e.g. `shared-identities` URI patterns) AND inject TS-floor at AS level
    // — but only after the R24 guard already approved the user's explicit
    // intent. The injection here is for completeness, not rescue.
    const effectiveAsUids = new Set(declaredAsUids);
    for (const floor of TS_FLOOR_ASSETSPACE_UIDS) effectiveAsUids.add(floor);

    // Compute toDestroy / toMaterialize via .gitmodules ∩ filesystem presence.
    // Phase 6 Vision Lock #9 amendment: `.gitmodules` entries persist post-destroy
    // (URL registry). Therefore materialization state ≠ `.gitmodules` membership.
    // Source of truth for «is currently materialized» = working tree dir exists.
    const currentSubmodulePaths = await deps.gitOps.readGitmodulesPaths();
    const allInfos = this.listAllAssetSpaceInfos();
    // Index by submodulePath for O(1) lookup.
    const infoBySubmodulePath = new Map<string, AssetSpaceInfo>();
    for (const info of allInfos) infoBySubmodulePath.set(info.folderName, info);

    // Currently-materialized AS UIDs: .gitmodules entries with working tree on disk.
    const currentAsUids = await this.derivePhysicallyMaterializedAsUids(
      currentSubmodulePaths,
      infoBySubmodulePath,
    );

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
          `Hard switch aborted — ${total} uncommitted file(s) in ${uncommitted.affectedFiles.length} to-destroy AssetSpace(s). Commit or stash first.`,
          uncommitted.affectedFiles,
        );
      }
    }

    // Build HardSwitchPlan + ConfirmGate.
    const filesToDestroyMap = new Map<string, string[]>();
    for (const target of toDestroy) {
      const files = await this.enumerateFilesUnder(target.submodulePath);
      filesToDestroyMap.set(target.asUid, files);
    }
    const plan: HardSwitchPlan = {
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
    const approved = await deps.confirmGate.confirmHardSwitch(plan);
    if (!approved) throw new HardSwitchAbortedByUser();

    // No-op early exit: no destroy + no materialize == effectively soft path.
    // Still emit hard-switch-completed so recoverIncompleteSwitch's tail-scan
    // has a clean cutoff for any prior aborted run (HIGH catch from review).
    if (toDestroy.length === 0 && toMaterialize.length === 0) {
      await this.appendJournal({
        phase: "hard-switch-starting",
        targetUid: targetProfileUid,
        ts: new Date(startedAt).toISOString(),
      });
      await this.softSwitchFocusProfile(targetProfileUid);
      await this.appendJournal({
        phase: "hard-switch-completed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        elapsedMs: this.now().getTime() - startedAt,
      });
      return;
    }

    // Acquire lock, set _switchInProgress.
    const acquired = await this.lockMgr.acquireLock(`hard-switch-${targetProfileUid}`);
    if (!acquired) {
      throw new Error("Another hard switch is in progress (lock held). Try again shortly.");
    }
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stagingPaths: Array<{ asUid: string; stagingPath: string }> = [];
    // Tracks AS that were successfully cached в Phase 2 — drives the
    // attemptCacheRollback list on catch so we only restore entries the cache
    // layer actually saw. Avoids spurious CacheMissError noise + double-restore
    // on partial-fail (HIGH catch from code-review).
    const cachedSuccessfully: Array<{ asUid: string; submodulePath: string }> = [];

    try {
      await this.appendJournal({
        phase: "hard-switch-starting",
        targetUid: targetProfileUid,
        ts: new Date(startedAt).toISOString(),
      });
      const localState = deps.localDataStore.snapshot();
      await deps.localDataStore.save({
        activeProfileUid: localState.activeProfileUid,
        _switchInProgress: true,
      });

      heartbeatTimer = setInterval(() => {
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
        `chore(profile): hard switch к ${targetProfileLabel}`,
      );
      await this.appendJournal({
        phase: "git-commit-done",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
      });

      // ---- Persist new state + trigger RDF re-index ----
      // AC14 — hard switch owns the Knowledge slot. Spread the current
      // snapshot so the sibling Focus slot is preserved; the legacy
      // `activeProfileUid` mirror is updated for backward read / downgrade.
      const persistState = deps.localDataStore.snapshot();
      await deps.localDataStore.save({
        ...persistState,
        activeProfileUid: targetProfileUid,
        activeKnowledgeProfileUid: targetProfileUid,
        _switchInProgress: false,
      });
      await this.rdfIndexer.refresh(effectiveAsUids);

      const elapsedMs = this.now().getTime() - startedAt;
      await this.appendJournal({
        phase: "hard-switch-completed",
        targetUid: targetProfileUid,
        ts: this.now().toISOString(),
        elapsedMs,
      });
      this.notify(`Hard switched к ${targetProfileLabel} (${elapsedMs}ms)`);
    } catch (e) {
      // Rollback attempt: best-effort cache restore previously-destroyed AS.
      // This is partial — anything that was already added via `submodule add`
      // before commit will be untracked git state until the user manually
      // resets. We log + notify but rethrow.
      await this.appendJournal({
        phase: "hard-switch-failed",
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
      await this.lockMgr.releaseLock();
    }
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
      throw new Error("recoverIncompleteSwitch: hard switch dependencies not wired");
    }
    const events = await this.readJournalTail(200);
    const destroyedAsUids = new Set<string>();
    const materializedAsUids = new Set<string>();
    for (const e of events) {
      if (e.phase === "phase2-destroy-cached" && typeof e.as === "string") {
        destroyedAsUids.add(e.as);
      } else if (e.phase === "phase2-materialized" && typeof e.as === "string") {
        materializedAsUids.add(e.as);
      } else if (e.phase === "hard-switch-completed") {
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
   * before reconciling via hardSwitchKnowledgeProfile.
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
      throw new Error("reconcileToLocal: hard switch dependencies not wired");
    }
    const activeProfileUid = localDataStore.getActiveProfileUid();
    if (activeProfileUid === null) {
      return { outcome: "no-active-profile" };
    }
    // Compute expected AS set for activeProfileUid.
    const declared = await this.resolveEffectiveSet(activeProfileUid);
    const folderToAsUid = await this.scanFolderToAsUid();
    const ontologyToAs = await this.scanOntologyToAsUid();
    const expectedAsUids = new Set<string>();
    const folderMapValues = new Set(folderToAsUid.values());
    for (const uid of declared) {
      if (folderMapValues.has(uid)) {
        expectedAsUids.add(uid);
        continue;
      }
      const t = ontologyToAs.get(uid);
      if (t !== undefined) expectedAsUids.add(t);
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

    // Diff.
    const missing = Array.from(expectedAsUids).filter((u) => !materializedAsUids.has(u));
    const extra = Array.from(materializedAsUids).filter((u) => !expectedAsUids.has(u));
    if (missing.length === 0 && extra.length === 0) {
      return { outcome: "no-divergence" };
    }

    // Surface modal — reuse HardSwitchPlan shape so ModalConfirmGate renders.
    const reconcilePlan = await this.buildReconcilePlan(
      activeProfileUid,
      missing,
      extra,
      allInfos,
    );
    const approved = this.confirmGate !== undefined
      ? await this.confirmGate.confirmHardSwitch(reconcilePlan)
      : true; // No gate wired (tests / headless) — proceed.
    if (!approved) return { outcome: "declined" };
    await this.hardSwitchKnowledgeProfile(activeProfileUid);
    return { outcome: "reconciled" };
  }

  /**
   * Build a HardSwitchPlan describing the reconcile operation — vault has
   * extra AS that local profile doesn't include OR missing AS that local
   * profile expects. Used for the confirm modal in `reconcileToLocal`.
   */
  private async buildReconcilePlan(
    activeProfileUid: string,
    missing: ReadonlyArray<string>,
    extra: ReadonlyArray<string>,
    allInfos: ReadonlyArray<AssetSpaceInfo>,
  ): Promise<HardSwitchPlan> {
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

  // === Hard-switch helpers ===

  private assertHardSwitchWired(): {
    assetSpaceManager: AssetSpaceManager;
    cacheLayer: ICacheLayer;
    gitOps: GitSubmoduleOps;
    uncommittedGuard: UncommittedChangesGuard;
    confirmGate: IConfirmGate;
    localDataStore: PluginLocalDataStore;
    vaultRootPath: string;
  } {
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
        "hardSwitchKnowledgeProfile: dependencies not wired (assetSpaceManager, cacheLayer, gitOps, uncommittedGuard, confirmGate, localDataStore, vaultRootPath required)",
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

  private assertTsFloor(effective: ReadonlySet<string>): void {
    const missing: string[] = [];
    for (const floor of TS_FLOOR_ASSETSPACE_UIDS) {
      if (!effective.has(floor)) missing.push(floor);
    }
    if (missing.length > 0) {
      throw new TsFloorViolationError(
        `Effective set missing TS-floor AssetSpace UID(s): ${missing.join(", ")}. Aborting hard switch — would brick plugin (R24 mitigation).`,
      );
    }
  }

  private listAllAssetSpaceInfos(): AssetSpaceInfo[] {
    // Single vault scan — extracts AssetSpace ABox metadata directly from
    // frontmatter. Independent of AssetSpaceManager (так hard switch tests
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
      const instanceClass = fm["exo__Instance_class"];
      const classes: string[] = Array.isArray(instanceClass)
        ? instanceClass.filter((c): c is string => typeof c === "string")
        : typeof instanceClass === "string"
          ? [instanceClass]
          : [];
      const isAssetSpace = classes.some(
        (c) => c.includes("AssetSpace") && !c.includes("AssetSpaceManager"),
      );
      if (!isAssetSpace) continue;
      const git = typeof fm["exo__AssetSpace_git"] === "string"
        ? (fm["exo__AssetSpace_git"] as string)
        : "";
      const namespace = typeof fm["exo__AssetSpace_namespace"] === "string"
        ? (fm["exo__AssetSpace_namespace"] as string)
        : "";
      if (!git || !namespace) continue;
      const lastPulledSha = typeof fm["exo__AssetSpace_lastPulledSha"] === "string"
        ? (fm["exo__AssetSpace_lastPulledSha"] as string)
        : undefined;
      const folderName = parentFolderOf(file.path);
      seen.add(uid);
      out.push({ uid, git, namespace, folderName, lastPulledSha });
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

  private async scanOntologyToAsUid(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm) continue;
      const uid = typeof fm["exo__Asset_uid"] === "string" ? (fm["exo__Asset_uid"] as string) : null;
      if (uid === null) continue;
      const rawContains = fm["exo__AssetSpace_containsOntology"];
      const declared: unknown[] = Array.isArray(rawContains)
        ? rawContains
        : rawContains !== undefined && rawContains !== null
          ? [rawContains]
          : [];
      for (const raw of declared) {
        if (typeof raw !== "string") continue;
        const cleaned = raw.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (cleaned.length > 0) out.set(cleaned, uid);
      }
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
    // paths. Hard switch needs total file counts up-front for the modal; can't
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
          /* eslint-disable-next-line import/no-nodejs-modules */
          const fs = await import("node:fs");
          await fs.promises.rm(stagingPath, { recursive: true, force: true });
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
        `FocusProfile chain exceeds max depth ${this.maxExtendsDepth} at ${uid} — possible cycle`,
      );
    }
    if (visited.has(uid)) return; // cycle guard
    visited.add(uid);

    const profile = await this.resolver.resolve(uid);
    if (profile === null) return; // tolerate missing parent — leaf

    for (const u of profile.includes) result.add(u);
    for (const u of profile.alwaysOnOverlay) result.add(u);

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
