import type { App, CachedMetadata, TFile } from "obsidian";
import type { RefToFrontmatterResolver } from "@kitelev/exocortex-core";

/**
 * req c03f9e3e — per-ontology efforts routing — metadata-cache backed
 * {@link RefToFrontmatterResolver}, sibling of {@link createObsidianRefToFolderResolver}.
 *
 * # Why this lives in the plugin layer
 *
 * `GroundingExecutor` makes a SECOND hop for the `targetRefProperty` token —
 * from the click-target (an area) → the area's `exo__Asset_isDefinedBy` ontology
 * → that ontology's `exo__Ontology_effortsOntology` (the target efforts-ontology).
 * The core executor is storage-agnostic and cannot scan the vault for the file a
 * UID points at; the plugin injects this resolver, backed by the always-warm
 * Obsidian metadata cache.
 *
 * # How it works
 *
 * Given a bare asset reference (a UID, after the executor strips quotes /
 * `[[ ]]` / `|alias`), find the markdown file whose `exo__Asset_uid` equals it —
 * or, as a fast path for UID-canon filenames, whose basename equals it — and
 * return that file's parsed frontmatter.
 *
 * Returns `null` when nothing matches or the metadata-cache API is unavailable;
 * the executor then leaves isDefinedBy unrouted and co-locates the new instance
 * with the click-target rather than failing the create. Runs on both desktop and
 * mobile (no `Platform.isMobile` gating) — the metadata cache is available on
 * every platform.
 *
 * Cost is O(N) per lookup over markdown files; create_instance executions are
 * infrequent (one per button click), so an index is deferred unless profiling
 * shows it is hot.
 */
export function createObsidianRefToFrontmatterResolver(
  app: App,
): RefToFrontmatterResolver {
  return (ref: string): Record<string, unknown> | null => {
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
        const cache: CachedMetadata | null = getFileCache(file);
        return (cache?.frontmatter as Record<string, unknown> | undefined) ?? null;
      }
    }
    for (const file of files) {
      const cache: CachedMetadata | null = getFileCache(file);
      const uid = cache?.frontmatter?.["exo__Asset_uid"];
      if (typeof uid === "string" && uid === ref) {
        return (cache?.frontmatter as Record<string, unknown> | undefined) ?? null;
      }
    }

    return null;
  };
}
