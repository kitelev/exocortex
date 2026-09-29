/**
 * The ONE answer to "does this content open with a frontmatter block, and what
 * is its body?" — shared, so the surfaces that ask it cannot disagree.
 *
 * ⛤ WHY THIS FILE EXISTS (req `1dfbd427-9a96-4fc2-a49e-146f6b2a46e5`, #4453).
 * The three PLUGIN sites decided it independently and two of them were LF-only,
 * so the same `.md` file produced triples through the CLI (`\r?\n`-tolerant
 * since #4450) and ZERO triples through the plugin — a parity defect by
 * surface, not by data. On iPhone the plugin is the only surface there is.
 *
 *   | plugin site | before #4453 |
 *   |---|---|
 *   | `ObsidianVaultAdapter` (read + the #4440 diagnostic) | LF-only |
 *   | `ObsidianFileSystemAdapter.extractFrontmatter` | LF-only |
 *   | `VaultRDFIndexer.parseFrontmatterFromContent` | LF-only regex, but the whole content was BOM-stripped and CRLF-normalised BEFORE matching — tolerant by a DIFFERENT mechanism, undocumented as such and pinned by nothing |
 *
 * ⛔ THE SCOPE OF THIS HELPER IS THE PLUGIN'S THREE SITES — NOT THE REPO.
 * An earlier draft of this comment said the predicate "was written in FIVE
 * places" and that the repo goes "from five to three". Both were FALSE and are
 * withdrawn here rather than left to rot: they were inherited from the
 * requirement's own prose and repeated under the words "measured, not assumed"
 * without anyone measuring. The actual census (2026-09-29, `packages/**` minus
 * `node_modules`/`dist`): **109** `^---…---` regex literals, of which ~30 in
 * production `src/`, in at least TWO tolerance shapes — `\r?\n`-tolerant
 * (~22, e.g. `sync/ChangeDetector`, `ShapeLoader`, `GroundingExecutor`,
 * `AtomicFrontmatterService`) and still LF-only (~8, e.g.
 * `FrontmatterService.FRONTMATTER_REGEX`, `PropertyCleanupService`,
 * `RenameToUidService`, `NodeFsAdapter`, `CandidateShaclValidator`).
 *
 * So this file converges the PLUGIN's three copies to zero. It does not, and
 * does not claim to, converge the repo. Two of the LF-only survivors are live
 * parity gaps with their own work items (found by the review of PR #4458):
 * `CandidateShaclValidator` (its own comment asserts byte-identical parity with
 * `FileSystemVaultAdapter`, false since #4450) and `NodeFsAdapter` (breaks
 * `apply`'s create-instance resolvers for a CRLF/BOM-fenced referenced asset).
 * `extractBodyContent` and `FrontmatterService.FRONTMATTER_REGEX` are named
 * non-goals in the requirement, with reasons.
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
function bomLength(content: string): number {
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
