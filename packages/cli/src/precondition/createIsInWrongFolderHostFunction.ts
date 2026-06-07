import {
  needsFolderRepair,
  type FolderRepairService,
  type HostFunction,
  type IFile,
  type IVaultAdapter,
} from "exocortex";

/**
 * CLI counterpart of the plugin's
 * `obsidian-plugin/src/infrastructure/precondition/createIsInWrongFolderHostFunction.ts`.
 *
 * Returns `true` only when the asset referenced by `ctx.filePath` lives in a
 * folder that differs from the folder of the file it points to via
 * `exo__Asset_isDefinedBy`. Used by the homoiconic "Repair Folder" exocmd
 * command (vault asset `2afd04ae-218d-4ee9-8ee1-7c61f4d40a91`) to keep
 * `npx exocortex-cli apply <repair-folder-uid> <path>` from succeeding on
 * assets that are already in the correct folder (Issue #3302).
 *
 * Fail-closed on missing context, missing file, or unresolvable expected
 * folder — mirrors the plugin factory's contract so visible/invocable
 * gating is symmetric between surfaces.
 */
export function createIsInWrongFolderHostFunction(
  vaultAdapter: IVaultAdapter,
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

    const node = vaultAdapter.getAbstractFileByPath(filePath);
    if (node === null || !("basename" in node)) return false;
    const file = node as IFile;

    const metadata =
      (vaultAdapter.getFrontmatter(file) as Record<string, unknown> | null) ??
      {};

    const expected = folderRepairService.getExpectedFolderSync(file, metadata);
    const current =
      typeof ctx.currentFolder === "string"
        ? ctx.currentFolder
        : (file.parent?.path ?? "");

    return needsFolderRepair(current, expected);
  };
}
