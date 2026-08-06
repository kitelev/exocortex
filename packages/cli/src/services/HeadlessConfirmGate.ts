/**
 * HeadlessConfirmGate — CLI implementation of `IConfirmGate` (RFC
 * 22b50a17 Phase 1b).
 *
 * The CLI has no interactive surface; instead it follows the
 * automation-safe pattern from the source RFC's Decision #2:
 *   - Default behaviour is REFUSE (returns `false`) so an unattended
 *     pipeline cannot accidentally destroy assetspaces.
 *   - Caller opts in via `--yes` — explicit safety override.
 *   - `--verbose` writes a one-line plan summary to stderr so logs
 *     attribute what was approved.
 *
 * All logging goes to stderr. Stdout is reserved for the eventual
 * machine-readable output the Phase 3 orchestrator may emit.
 */

import type { IConfirmGate, ApplyPlan } from "@kitelev/exocortex-core";

export interface HeadlessConfirmGateOptions {
  /** Confirm apply (safety override). False by default. */
  yes: boolean;
  /** Echo the plan summary to stderr before deciding. False by default. */
  verbose?: boolean;
  /** Injectable logger — defaults to `process.stderr.write`. */
  log?: (message: string) => void;
}

const DEFAULT_LOG: (message: string) => void = (message: string) => {
  process.stderr.write(`${message}\n`);
};

export class HeadlessConfirmGate implements IConfirmGate {
  private readonly yes: boolean;
  private readonly verbose: boolean;
  private readonly log: (message: string) => void;

  constructor(opts: HeadlessConfirmGateOptions) {
    this.yes = opts.yes;
    this.verbose = opts.verbose ?? false;
    this.log = opts.log ?? DEFAULT_LOG;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async confirmApply(plan: ApplyPlan): Promise<boolean> {
    if (this.verbose) {
      const totalFiles = Array.from(plan.filesToDestroy.values()).reduce(
        (sum, files) => sum + files.length,
        0,
      );
      this.log(
        `[apply-profile] Target: ${plan.targetProfileLabel} (${plan.targetProfileUid})`,
      );
      this.log(`[apply-profile] Source: ${plan.sourceProfileLabel}`);
      this.log(
        `[apply-profile] ${totalFiles} files to remove, ${plan.assetSpacesBeingTornDown.length} AS to tear down, ${plan.assetSpacesBeingMaterialized.length} AS to materialize`,
      );
      // req `d4ccc901` — parking gets its OWN line rather than being folded into
      // the removal counts. `filesToDestroy` already excludes parked
      // AssetSpaces, so the line above stays truthful; but without this line a
      // park would be entirely INVISIBLE on the surface the user reads before
      // typing `--yes`, and an unannounced mutation is no better than a
      // mis-announced one. Emitted only when non-empty, so the common no-park
      // apply reads exactly as it did before.
      if (plan.assetSpacesBeingParked.length > 0) {
        const parkedFiles = plan.assetSpacesBeingParked.reduce(
          (sum, as) => sum + as.fileCount,
          0,
        );
        this.log(
          `[apply-profile] ${parkedFiles} files to park (moved to .exocortex/parked, NOT removed), ${plan.assetSpacesBeingParked.length} AS to park`,
        );
      }
      if (plan.assetSpacesBeingUnparked.length > 0) {
        this.log(
          `[apply-profile] ${plan.assetSpacesBeingUnparked.length} AS to unpark (restored from .exocortex/parked, no download)`,
        );
      }
    }

    if (!this.yes) {
      this.log(
        "[apply-profile] Refused: --yes flag required for headless mode (Decision #2 safety).",
      );
      return false;
    }

    return true;
  }
}
