import type { App } from "obsidian";

import { isAssetSpaceFrontmatter } from "./AssetSpaceManager";

/**
 * Folder-name → AssetSpace UID lookup. Returns the `exo__Asset_uid` of the
 * AssetSpace ABox asset whose containing folder matches `folderName`, or
 * `null` if no such asset is found.
 *
 * Shared by:
 *  - `AssetSpaceManager.lookupAssetSpaceForPath` (PAT-present path) —
 *    full push capability via GitHub REST.
 *  - `ExocortexPlugin.buildAssetSpacePusher` (PAT-absent stub path) —
 *    lookup-only path while push is unavailable.
 *
 * Both consumers iterate `vault.getMarkdownFiles()`, apply
 * `isAssetSpaceFrontmatter` (strict wikilink regex per Issue #3312
 * MEDIUM #1), and compare the file's parent folder against the
 * normalised input. Centralising here avoids drift if the AssetSpace
 * class UID changes or the wikilink shape evolves.
 *
 * Class-membership check delegates to the shared `isAssetSpaceFrontmatter`
 * helper — strict wikilink matching, not loose substring — so adjacent
 * UUID-like noise in `exo__Instance_class` doesn't falsely register.
 */
export function lookupAssetSpaceUidByFolder(
  app: App,
  folderName: string,
): string | null {
  if (typeof folderName !== "string" || folderName.length === 0) return null;
  const normalised = stripTrailingSlash(folderName);
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) continue;
    if (!isAssetSpaceFrontmatter(fm)) continue;
    const parent = parentFolder(file.path);
    if (parent !== normalised) continue;
    const uid = fm["exo__Asset_uid"];
    if (typeof uid === "string" && uid.length > 0) return uid;
  }
  return null;
}

function parentFolder(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx < 0 ? "" : filePath.slice(0, idx);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
