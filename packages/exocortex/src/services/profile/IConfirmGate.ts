/**
 * Confirmation gate for apply operations (RFC 22b50a17 Phase 1b).
 *
 * The apply path mutates the vault filesystem (destroys assetspace
 * directories not in the target profile's effective set, materializes new
 * ones). Both runtimes must DI a confirmation gate before executing such a
 * destructive operation:
 *
 *   - Plugin runtime: `ModalConfirmGate` — opens an interactive Obsidian
 *     `Modal` listing files-to-be-removed grouped by assetspace.
 *   - CLI runtime:    `HeadlessConfirmGate` — auto-refuses unless the caller
 *     opted in via `--yes`. The flag is a safety override for automation /
 *     scripted scenarios (Decision #2 in the source RFC).
 *
 * Phase 1b ships the interface + adapters + a CLI command scaffold; the
 * actual `applyProfile()` orchestration lands in Phase 3 and consumes
 * the gate via DI from both runtimes — no further interface change required.
 */

/**
 * Apply plan — payload passed to the confirmation gate.
 *
 * Aggregates everything a UI surface (modal or stderr summary) needs to
 * describe the impending mutation without re-querying the vault. Maps are
 * `ReadonlyMap` / `ReadonlyArray` so adapters cannot mutate them.
 */
export interface ApplyPlan {
  /** Target profile UID — the profile the user wants to switch INTO. */
  targetProfileUid: string;
  /** Target profile human label (used in modal title / verbose log). */
  targetProfileLabel: string;
  /** Source (currently active) profile UID; `null` if no active profile. */
  sourceProfileUid: string | null;
  /** Source profile human label (or a synthetic "<unknown>" fallback). */
  sourceProfileLabel: string;
  /**
   * Files about to be deleted, grouped by owning assetspace UID. Values are
   * vault-relative paths. The map is read-only to prevent adapters from
   * accidentally rewriting the plan during confirmation rendering.
   */
  filesToDestroy: ReadonlyMap<string /* asUid */, ReadonlyArray<string /* relative path */>>;
  /**
   * Assetspaces being torn down — UID, label, file count. Distinct from
   * `filesToDestroy.keys()` because the modal shows assetspace cardinality
   * (one bullet per AS) separately from the per-file list.
   */
  assetSpacesBeingTornDown: ReadonlyArray<{
    asUid: string;
    asLabel: string;
    fileCount: number;
  }>;
  /**
   * Assetspaces being materialized (cache-restored or GitHub-pulled). The
   * Phase 3 orchestrator computes this; Phase 1b only renders it.
   */
  assetSpacesBeingMaterialized: ReadonlyArray<{
    asUid: string;
    asLabel: string;
  }>;
}

/**
 * Contract: caller awaits `confirmApply(plan)`; the gate either
 * resolves `true` (user approved → orchestrator proceeds) or `false` (user
 * declined / Esc / CLI without `--yes` → orchestrator aborts before any
 * filesystem mutation).
 *
 * Gates MUST NOT throw on user-decline — `false` is the canonical signal.
 * Throwing is reserved for infrastructure failure (e.g. modal cannot open).
 */
export interface IConfirmGate {
  /** Render plan to the user and await approve/decline. */
  confirmApply(plan: ApplyPlan): Promise<boolean>;
}
