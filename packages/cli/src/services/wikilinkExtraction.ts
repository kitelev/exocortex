/**
 * Wikilink target extraction for the ontology-imports audit
 * (RFC df39007b §Решение Шаг 1).
 *
 * Scope decisions locked by the RFC review interview:
 * - Frontmatter AND body wikilinks both count as graph edges (VL#3).
 * - Wikilinks inside fenced code blocks do NOT count (R10) — Obsidian does
 *   not treat them as graph edges; they are code examples in RFC/aiKnow
 *   assets. Inline code spans are NOT excluded (R10 names fenced blocks only).
 * - Anchors (`#heading`, `#^block`) and aliases (`|alias`) are stripped —
 *   the edge target is the linkpath.
 */

/** Matches both `[[target]]` and `![[target]]` (embeds are edges too). */
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Remove fenced code blocks (``` or ~~~ fences, CommonMark semantics: the
 * closer uses the same fence char with at least the opener's length; an
 * unclosed fence runs to end of text). Line-based on purpose — a regex with
 * a backreferenced closer cannot express "closer may be longer than opener".
 */
export function stripFencedCodeBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let openFence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (openFence === null) {
      if (fenceMatch) {
        openFence = fenceMatch[1];
      } else {
        out.push(line);
      }
    } else if (
      fenceMatch &&
      fenceMatch[1][0] === openFence[0] &&
      fenceMatch[1].length >= openFence.length &&
      /^[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(line)
    ) {
      openFence = null;
    }
  }
  return out.join("\n");
}

/**
 * Extract normalized wikilink targets from a text chunk: alias stripped,
 * anchor stripped, trimmed. Empty results (pure self-anchor links like
 * `[[#heading]]`) are dropped — they reference the containing file and never
 * form a cross-ontology edge.
 */
export function extractWikilinkTargets(text: string): string[] {
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    let inner = match[1];
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx !== -1) inner = inner.slice(0, pipeIdx);
    const hashIdx = inner.indexOf("#");
    if (hashIdx !== -1) inner = inner.slice(0, hashIdx);
    const target = inner.trim();
    if (target.length > 0) targets.push(target);
  }
  return targets;
}

/**
 * Recursively collect every string value from parsed frontmatter so wikilinks
 * in nested arrays/objects are found. Non-string scalars are ignored.
 */
export function collectFrontmatterStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectFrontmatterStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(
      collectFrontmatterStrings,
    );
  }
  return [];
}

/**
 * Body of a markdown file = everything after the frontmatter block (or the
 * whole content when there is none). Mirrors NodeFsAdapter frontmatter regex.
 */
export function bodyOf(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---/);
  return match ? content.slice(match[0].length) : content;
}

/**
 * All wikilink edge targets of one file: frontmatter strings + body with
 * fenced code blocks removed.
 */
export function extractFileWikilinkTargets(
  metadata: Record<string, unknown>,
  content: string,
): string[] {
  const fromFrontmatter = collectFrontmatterStrings(metadata).flatMap(
    extractWikilinkTargets,
  );
  const fromBody = extractWikilinkTargets(
    stripFencedCodeBlocks(bodyOf(content)),
  );
  return [...fromFrontmatter, ...fromBody];
}
