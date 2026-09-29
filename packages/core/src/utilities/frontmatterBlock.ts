/**
 * The ONE answer to "does this content open with a frontmatter block, and what
 * is its body?" — shared, so the surfaces that ask it cannot disagree.
 *
 * ⛤ WHY THIS FILE EXISTS (req `1dfbd427-9a96-4fc2-a49e-146f6b2a46e5`, #4453).
 * The same predicate was written independently in FIVE places, and they had
 * already drifted into three different tolerances:
 *
 *   | where | tolerance before #4453 |
 *   |---|---|
 *   | `packages/cli` `FileSystemVaultAdapter.matchFrontmatterBlock` | `\r?\n` + BOM skip (#4450) |
 *   | `packages/core` `NoteToRDFConverter.extractBodyContent` | `\r?\n` + BOM skip (#4450) |
 *   | `packages/obsidian-plugin` `ObsidianVaultAdapter` | LF-only |
 *   | `packages/obsidian-plugin` `ObsidianFileSystemAdapter` | LF-only |
 *   | `packages/obsidian-plugin` `VaultRDFIndexer` | LF-only regex, but the whole content was BOM-stripped and CRLF-normalised BEFORE matching — tolerant by a DIFFERENT mechanism, undocumented as such and pinned by nothing |
 *
 * So the same `.md` file produced triples through the CLI and zero triples
 * through the plugin — a parity defect by surface, not by data. The three
 * plugin sites now call this helper; the CLI adapter and `extractBodyContent`
 * are deliberate non-goals of that requirement (each named there, with its
 * reason and a follow-up).
 */

/**
 * A leading `---` block; group 1 = its YAML body.
 *
 * CRLF-tolerant on BOTH fences. A fence still needs at least one `\n`: a
 * lone-CR file (classic pre-OS9 Mac line endings) remains "no block at all",
 * which is the CLI's residue too and is tracked as #4452 rather than widened
 * here — the two surfaces stay in step, including in what they do NOT accept.
 *
 * ⛔ Never `.match()` raw content against this directly — go through
 * {@link matchFrontmatterBlock}. A BOM before `---` defeats the `^` anchor
 * exactly as a CRLF fence did.
 */
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Length of a leading U+FEFF (0 or 1) — a BOM only counts at index 0. */
export function bomLength(content: string): number {
  return content.charCodeAt(0) === 0xfeff ? 1 : 0;
}

/**
 * A matched leading frontmatter block.
 *
 * `blockStart`/`blockEnd` are offsets into the ORIGINAL string (i.e. the BOM is
 * already accounted for), so a write path can splice around the block and leave
 * the byte where the user put it — patching one unrelated property must not
 * silently strip a file's BOM. None of the current plugin call sites writes;
 * the offsets are here so a future one does not have to re-derive them (and so
 * the CLI adapter, whose write path needs exactly this, can migrate onto the
 * helper without changing its shape).
 */
export interface FrontmatterBlockMatch {
  /** The YAML text between the fences, verbatim (line endings preserved). */
  body: string;
  blockStart: number;
  blockEnd: number;
}

/**
 * Match a leading frontmatter block, tolerating CRLF fences and a single
 * leading BOM.
 *
 * ⛤ A BOM is skipped for MATCHING ONLY. Exactly ONE is skipped: a doubled BOM
 * still defeats the `^` anchor, which keeps this in step with the CLI predicate
 * (#4452 owns that residue for both surfaces).
 *
 * ⛤ The body is returned VERBATIM — `\r` is not stripped from it. YAML treats
 * `\r\n` as a line break, so a CRLF body parses to the same mapping; stripping
 * would be a second, silent normalisation of user content and would make the
 * returned offsets stop matching the returned text.
 *
 * @returns the block, or `null` when the content does not open with one
 */
export function matchFrontmatterBlock(
  content: string,
): FrontmatterBlockMatch | null {
  const bom = bomLength(content);
  const match = FRONTMATTER_BLOCK.exec(bom === 0 ? content : content.slice(bom));
  if (!match) return null;
  // `^`-anchored and non-global ⇒ the match always begins at index 0 of the
  // string we handed it, so the original offsets are that string's offsets
  // shifted by the BOM.
  return {
    body: match[1],
    blockStart: bom,
    blockEnd: bom + match[0].length,
  };
}

/**
 * The body of a leading frontmatter block, or `null` when there is none — the
 * read-only shorthand the three plugin sites use.
 */
export function frontmatterBlockBody(content: string): string | null {
  return matchFrontmatterBlock(content)?.body ?? null;
}
