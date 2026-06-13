/**
 * Extract the first fenced ```sparql code block from a markdown body.
 *
 * Single source of truth for the M2-lock body-extraction (RFC c78cc5c8): the
 * SPARQL of an `exoql__Query` / `query__NamedQuery` asset lives EXCLUSIVELY in
 * its markdown ```sparql block, never mirrored into frontmatter. Both the
 * Obsidian resolver (`ObsidianQueryBodyResolver`) and the CLI resolver
 * (`FsQueryBodyResolver`) delegate here so the regex has one home.
 *
 * @param markdown Full markdown body (frontmatter already stripped, or not —
 *                 the ```sparql fence cannot legally appear inside YAML
 *                 frontmatter, so stripping is optional but recommended).
 * @returns The trimmed SPARQL string, or `null` when no non-empty sparql block
 *          is present (callers fail closed).
 */
export function extractSparqlBlock(markdown: string): string | null {
  const match = markdown.match(/```sparql\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  const inner = match[1].trim();
  return inner.length > 0 ? inner : null;
}

/**
 * Strip a leading YAML frontmatter block (`---\n…\n---`) from markdown content.
 * Returns the content unchanged when no frontmatter is present.
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  return content.slice(end + 4);
}
