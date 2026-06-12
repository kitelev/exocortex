/**
 * Shared vault-path exclusion predicates for audit commands (RFC df39007b R6,
 * RFC 0b7a2fad CR-1).
 *
 * Templater template files carry `exo__Asset_isDefinedBy` / wikilinks by
 * pattern inheritance (intentional `<%* %>` / `{{…}}` placeholder syntax) but
 * are NOT assets — they must never be audited, moved, or counted as graph
 * edges. The live vault keeps them under root-level `templates/`; the legacy
 * location `09 Templates/` no longer exists on disk but stays excluded so the
 * audits remain safe against older vault snapshots/clones.
 */

const TEMPLATE_SEGMENTS = new Set(["templates", "09 templates"]);

/**
 * True when any path segment is a templates folder (case-insensitive,
 * current `templates/` or legacy `09 Templates/`).
 */
export function isTemplatesPath(relPath: string): boolean {
  return relPath
    .split("/")
    .some((segment) => TEMPLATE_SEGMENTS.has(segment.toLowerCase()));
}

/** True when the path passes through node_modules (never vault content). */
export function isNodeModulesPath(relPath: string): boolean {
  return relPath.split("/").includes("node_modules");
}
