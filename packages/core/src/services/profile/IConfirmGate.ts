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
   *
   * req `d4ccc901` — a PARKED assetspace is deliberately absent here. Its files
   * are not deleted, only moved, so counting them as "files to remove" would
   * make the approval card describe a reversible local move as a destruction —
   * at the exact moment consent is given, and unfalsifiably afterwards (the
   * files are still there).
   */
  filesToDestroy: ReadonlyMap<string /* asUid */, ReadonlyArray<string /* relative path */>>;
  /**
   * Assetspaces being torn down — UID, label, file count. Distinct from
   * `filesToDestroy.keys()` because the modal shows assetspace cardinality
   * (one bullet per AS) separately from the per-file list.
   *
   * req `d4ccc901` — DESTRUCTION only. Parked assetspaces live in
   * {@link ApplyPlan.assetSpacesBeingParked}.
   */
  assetSpacesBeingTornDown: ReadonlyArray<{
    asUid: string;
    asLabel: string;
    fileCount: number;
  }>;
  /**
   * req `d4ccc901` — assetspaces leaving the effective set via a SOFT
   * (`exo__DependencyKindReference`) edge: their mount is moved to
   * `.exocortex/parked/<owner>/<repo>` rather than removed, so the bytes stay on
   * the device and returning is a local move instead of a network pull.
   *
   * Required, not optional, on purpose: an optional field is one a renderer can
   * forget, and the failure mode of forgetting is a gate that says "N files to
   * remove" while a park happens. Making it required turns that into a compile
   * error at every construction and rendering site.
   */
  assetSpacesBeingParked: ReadonlyArray<{
    asUid: string;
    asLabel: string;
    fileCount: number;
  }>;
  /**
   * Assetspaces being materialized (cache-restored or GitHub-pulled). The
   * Phase 3 orchestrator computes this; Phase 1b only renders it.
   *
   * req `d4ccc901` — includes assetspaces returning FROM the parked state: they
   * reach `active` through the same materialise bookkeeping, differing only in
   * how the bytes arrive (local move vs network pull). See
   * {@link ApplyPlan.assetSpacesBeingUnparked} for the subset that costs no
   * network.
   */
  assetSpacesBeingMaterialized: ReadonlyArray<{
    asUid: string;
    asLabel: string;
  }>;
  /**
   * req `d4ccc901` — the subset of {@link ApplyPlan.assetSpacesBeingMaterialized}
   * restored from `.exocortex/parked/` rather than pulled over the network.
   *
   * Rendered separately so the user can tell a free, offline restore from a
   * download before approving — the two look identical in the count alone.
   */
  assetSpacesBeingUnparked: ReadonlyArray<{
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
