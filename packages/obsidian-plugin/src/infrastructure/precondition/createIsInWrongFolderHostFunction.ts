import { TFile, type App } from "obsidian";
import {
  needsFolderRepair,
  type FolderRepairService,
  type HostFunction,
} from "exocortex";

/**
 * Factory for the `isInWrongFolder` precondition host function used by the
 * homoiconic exocmd "Repair Folder" command (vault asset
 * `2afd04ae-218d-4ee9-8ee1-7c61f4d40a91`). Returns `true` only when the
 * asset's current parent folder differs from the folder of the file
 * referenced by `exo__Asset_isDefinedBy`.
 *
 * Hides the inline button + the Cmd+P palette entry on assets that are
 * already in the correct folder. Falls back to `false` (hide) whenever
 * the expected folder cannot be resolved — fail-closed for consistency
 * with the Obsidian command's gate.
 */
export function createIsInWrongFolderHostFunction(
  app: App,
  folderRepairService: FolderRepairService,
): HostFunction {
  return (ctx) => {
    const filePath =
      typeof ctx.filePath === "string" && ctx.filePath.length > 0
        ? ctx.filePath
        : null;
    if (filePath === null) return false;

    // Templater templates (09 Templates/) carry exo__Asset_isDefinedBy by
    // pattern inheritance but are NOT assets and must never move — never report
    // them as "in wrong folder" (mirror `audit co-location` +
    // co-location-enforce hook exclusion, RFC 0b7a2fad CR-1).
    if (filePath.split("/").includes("09 Templates")) return false;

    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    const metadata =
      (app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined) ?? {};

    const expected = folderRepairService.getExpectedFolderSync(file, metadata);
    const current =
      typeof ctx.currentFolder === "string"
        ? ctx.currentFolder
        : (file.parent?.path ?? "");

    return needsFolderRepair(current, expected);
  };
}
