import type { App, CachedMetadata, TFile } from "obsidian";
import type { ClassLabelToUidResolver } from "@kitelev/exocortex-core";

/**
 * Issue #3223 — alias-index-backed {@link ClassLabelToUidResolver}.
 *
 * # Why this lives in the plugin layer
 *
 * `GroundingExecutor.executeCreateInstance` writes `exo__Instance_class` from
 * `grounding.targetClass`. In production cold-start, that value is label-form
 * (`"ems__Task"`) rather than UUID-canon (`"1b20a8f0-..."`) because the command
 * was resolved against a store lacking the class TBox file:
 *
 *   - `ExocmdFastResolver` (#3171, removed in Phase 3c) mini-store = open asset
 *     + `assetspaces/exocmd` only; the class TBox lives in `assetspaces/ems`.
 *   - the persisted binding cache (#3183) bakes the label and survives restart.
 *
 * `CommandResolver.findUidByLabel` (#3212) returns null in that path; #3220's
 * resolver was supposed to bridge the gap at execution time but used
 * `app.metadataCache.getFirstLinkpathDest`, which — verified by DevTools eval
 * in vault-2025 — resolves only by filename basename and does NOT consult
 * frontmatter `aliases:` or `exo__Asset_label`. The #3220 production gap
 * therefore persisted in v16.12.6, v16.13.2, and v16.13.3. See #3223.
 *
 * # How this resolver works
 *
 * Scans the vault's markdown files via `app.vault.getMarkdownFiles()` and for
 * each file inspects its cached frontmatter via `app.metadataCache.getFileCache`.
 * A label matches when either:
 *
 *   - the `aliases:` array (string or string[] in YAML) contains the label, or
 *   - `exo__Asset_label` equals the label.
 *
 * Returns the file's `exo__Asset_uid` for the first match. UUID inputs short-
 * circuit through `getFirstLinkpathDest` (the only path where it works — by
 * basename), so already-canonical refs pay nothing extra.
 *
 * Cost is O(N) per lookup over markdown files. Typical vaults are well under
 * 10k files and lookups are infrequent (one per `create_instance` execution).
 * If profiling shows this is hot, build an index at plugin init invalidated on
 * `metadataCache.on('changed')` — left for a follow-up if needed.
 *
 * Returns `null` when nothing matches, the matched file lacks
 * `exo__Asset_uid`, or the metadata-cache API surface is unavailable —
 * `GroundingExecutor` then preserves its prior label-form output.
 */
export function createObsidianClassLabelResolver(
  app: App,
): ClassLabelToUidResolver {
  return (label: string): string | null => {
    if (!label) return null;

    const metadataCache = app.metadataCache;
    const vault = app.vault;
    if (!metadataCache || !vault) return null;

    const getFileCache = metadataCache.getFileCache?.bind(metadataCache);
    const getMarkdownFiles = vault.getMarkdownFiles?.bind(vault);
    if (!getFileCache || !getMarkdownFiles) return null;

    const files: TFile[] = getMarkdownFiles();
    for (const file of files) {
      const cache: CachedMetadata | null = getFileCache(file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter) continue;

      if (!labelMatches(frontmatter, label)) continue;

      const uid = frontmatter["exo__Asset_uid"];
      if (typeof uid === "string" && uid.length > 0) return uid;
    }

    return null;
  };
}

function labelMatches(
  frontmatter: Record<string, unknown>,
  label: string,
): boolean {
  const assetLabel = frontmatter["exo__Asset_label"];
  if (typeof assetLabel === "string" && assetLabel === label) return true;

  const aliases = frontmatter["aliases"];
  if (typeof aliases === "string" && aliases === label) return true;
  if (Array.isArray(aliases)) {
    for (const entry of aliases) {
      if (typeof entry === "string" && entry === label) return true;
    }
  }
  return false;
}
