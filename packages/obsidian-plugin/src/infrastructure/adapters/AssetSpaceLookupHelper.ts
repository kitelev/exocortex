import type { App } from "obsidian";
import { derivePath } from "@kitelev/exocortex-core";

import { isAssetSpaceFrontmatter } from "./AssetSpaceFrontmatter";

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
    // RFC 01a83de8 Phase 1b T3 — match the AssetSpace's *mount* folder
    // (`derivePath(source)` = `assetspaces/<owner>/<repo>`), not the descriptor
    // file's parent folder. Post-migration the descriptor lives in the registry,
    // so its parent folder is the registry path, not the AssetSpace it describes.
    // `parentFolder(file.path)` remains a defensive fallback for descriptors
    // without a resolvable `_source` (should not occur — `_source` is required).
    const source = readSource(fm);
    const folder =
      (source !== null ? derivePath(source) : null) ?? parentFolder(file.path);
    if (folder !== normalised) continue;
    const uid = fm["exo__Asset_uid"];
    if (typeof uid === "string" && uid.length > 0) return uid;
  }
  return null;
}

/** Dual-read `_source ?? _git` (RFC 01a83de8 v10). */
function readSource(fm: Record<string, unknown>): string | null {
  const source = fm["exo__AssetSpace_source"];
  if (typeof source === "string" && source.length > 0) return source;
  const git = fm["exo__AssetSpace_git"];
  if (typeof git === "string" && git.length > 0) return git;
  return null;
}

function parentFolder(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx < 0 ? "" : filePath.slice(0, idx);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
