import type { App } from "obsidian";
import { isEffortBlocked as coreIsEffortBlocked } from "@kitelev/exocortex-core";
import { ObsidianVaultMetadataAdapter } from "@plugin/domain/display-name/ObsidianVaultMetadataAdapter";
import { ObsidianApp } from "@plugin/types";

/**
 * Obsidian-side wrapper over the core `isEffortBlocked` predicate (req 5cd9fffe).
 *
 * The logic moved to `packages/core` so the CLI naming oracle runs the SAME predicate instead of
 * silently skipping the spec that names it. This class stays — with its original
 * `(app, metadata)` signature — precisely so its four consumers (ExocortexAPI, DailyTasksRenderer,
 * RelationsRenderer, AssetMetadataService) and their tests need no change at all: it is the
 * adapter boundary, not a re-export.
 *
 * ⛔ Do not reintroduce the predicate here. If the two surfaces ever disagree about whether an
 * effort is blocked, the cause is a divergence between the Obsidian and filesystem adapters —
 * not two implementations drifting apart, because there is only one.
 */
export class BlockerHelpers {
  /**
   * Checks if an effort is blocked by another effort.
   * An effort is considered blocked when:
   * - It has an ems__Effort_blocker property referencing another effort
   * - The referenced blocker effort has a status that is not DONE or TRASHED
   *
   * @param app The Obsidian app instance
   * @param metadata The metadata of the effort to check
   * @returns true if the effort is blocked, false otherwise
   */
  static isEffortBlocked(
    app: ObsidianApp,
    metadata: Record<string, unknown>,
  ): boolean {
    // Constructing the adapter per call is free — it only captures the app reference — which is
    // why the four existing consumers keep their signature instead of threading a port through.
    return coreIsEffortBlocked(
      new ObsidianVaultMetadataAdapter(app as unknown as App),
      metadata,
    );
  }
}
