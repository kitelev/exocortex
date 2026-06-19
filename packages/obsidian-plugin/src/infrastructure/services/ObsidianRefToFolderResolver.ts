import type { App, CachedMetadata, TFile } from "obsidian";
import type { RefToFolderResolver } from "exocortex";

/**
 * T1 "Create Instance" homoiconic button (project bbe40f8c) — metadata-cache
 * backed {@link RefToFolderResolver}.
 *
 * # Why this lives in the plugin layer
 *
 * `GroundingExecutor.executeCreateInstance` places a new instance co-located
 * with its chosen `exo__Asset_isDefinedBy` ontology (co-location invariant)
 * when the grounding's `targetFolder` is the `$isDefinedByFolder` token. The
 * core executor is storage-agnostic and cannot scan the vault for the file a
 * UID points at; the plugin injects this resolver, backed by the always-warm
 * Obsidian metadata cache (mirrors {@link createObsidianClassLabelResolver}).
 *
 * # How it works
 *
 * Given a bare asset reference (a UID, after the executor strips quotes /
 * `[[ ]]` / `|alias`), find the markdown file whose `exo__Asset_uid` equals it
 * — or, as a fast path for UID-canon filenames, whose basename equals it — and
 * return that file's vault-relative parent folder.
 *
 * Returns `null` when nothing matches or the metadata-cache API is unavailable;
 * the executor then falls back to the host folder rather than failing the
 * create. Runs on both desktop and mobile (no `Platform.isMobile` gating) —
 * the metadata cache is available on every platform.
 *
 * Cost is O(N) per lookup over markdown files; create_instance executions are
 * infrequent (one per button click), so an index is deferred unless profiling
 * shows it is hot.
 */
export function createObsidianRefToFolderResolver(
  app: App,
): RefToFolderResolver {
  return (ref: string): string | null => {
    if (!ref) return null;

    const metadataCache = app.metadataCache;
    const vault = app.vault;
    if (!metadataCache || !vault) return null;

    const getFileCache = metadataCache.getFileCache?.bind(metadataCache);
    const getMarkdownFiles = vault.getMarkdownFiles?.bind(vault);
    if (!getFileCache || !getMarkdownFiles) return null;

    const files: TFile[] = getMarkdownFiles();
    for (const file of files) {
      // Fast path: UID-canon filenames are `<uid>.md`, so the basename match
      // avoids reading frontmatter for the common case.
      if (file.basename === ref) {
        return file.parent?.path ?? "";
      }
    }
    for (const file of files) {
      const cache: CachedMetadata | null = getFileCache(file);
      const uid = cache?.frontmatter?.["exo__Asset_uid"];
      if (typeof uid === "string" && uid === ref) {
        return file.parent?.path ?? "";
      }
    }

    return null;
  };
}
