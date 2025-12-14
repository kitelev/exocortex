import { EffortStatus } from "exocortex";
import { ObsidianApp } from '@plugin/types';

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
    const effortBlocker = metadata.ems__Effort_blocker;
    if (!effortBlocker) {
      return false;
    }

    const blockerPath = String(effortBlocker).replace(/^\[\[|\]\]$/g, "");
    const blockerFile = app.metadataCache.getFirstLinkpathDest(
      blockerPath,
      "",
    );

    if (!blockerFile) {
      return false;
    }

    const blockerCache = app.metadataCache.getFileCache(blockerFile);
    const blockerMetadata = blockerCache?.frontmatter || {};
    const blockerStatus = blockerMetadata.ems__Effort_status || "";
    const blockerStatusStr = String(blockerStatus).replace(/^\[\[|\]\]$/g, "");

    return (
      blockerStatusStr !== EffortStatus.DONE &&
      blockerStatusStr !== EffortStatus.TRASHED
    );
  }
}
