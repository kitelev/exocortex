/**
 * Extract the bare linkpath reference from a frontmatter property value
 * (typically `exo__Asset_isDefinedBy`), normalizing the forms that appear in
 * Exocortex frontmatter:
 *
 * - `[[Reference]]`     → `Reference`
 * - `"[[Reference]]"`   → `Reference` (surrounding YAML quotes stripped)
 * - `[[uid|alias]]`     → `uid`        (alias suffix dropped)
 * - `Reference`         → `Reference`
 *
 * Returns `null` for non-string input or an empty result.
 *
 * The single canonical implementation consumed by `FolderRepairService`
 * (plugin/grounding path) and the CLI `FolderRepairExecutor` / `BatchExecutor`
 * (audit #3384 finding H4 — was triplicated byte-for-byte).
 *
 * NOTE: intentionally distinct from {@link WikiLinkHelpers.normalize}. For a
 * UUID-aliased wikilink `[[uuid|ems__Area]]`, `normalize` keeps the *alias*
 * (`ems__Area`) because its consumers compare against symbolic class names,
 * whereas `extractAssetReference` keeps the *target* (`uuid`) because its only
 * consumer feeds the result to `getFirstLinkpathDest`, which resolves the
 * target linkpath and returns null for the pipe-aliased form. Do not merge the
 * two.
 */
export function extractAssetReference(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  // Remove quotes if present
  let cleaned = value.trim().replace(/^["']|["']$/g, "");

  // Remove wiki-link brackets if present
  cleaned = cleaned.replace(/^\[\[|\]\]$/g, "");

  // Strip alias suffix (everything after first `|`) — getFirstLinkpathDest
  // returns null for pipe-aliased linkpaths, breaking alias-form refs.
  const pipeIdx = cleaned.indexOf("|");
  if (pipeIdx !== -1) {
    cleaned = cleaned.slice(0, pipeIdx).trim();
  }

  return cleaned || null;
}
