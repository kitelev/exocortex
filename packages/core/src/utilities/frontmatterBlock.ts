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
 * Tolerant of ALL THREE line-ending forms on BOTH fences — `\r\n`, `\n` and a
 * bare `\r` (classic pre-OS9 Mac endings, a file with no `\n` anywhere).
 *
 * ⛔ WITHDRAWN (req `74419202-264e-4394-a634-0b36d47357f8`, #4452): the previous
 * edition of this docblock said a fence "still needs at least one `\n`" and that
 * a lone-CR file "remains no block at all … tracked as #4452 rather than widened
 * here". Both are now FALSE and are retracted here rather than left to rot — a
 * stale "we deliberately do not do this" reads as a proven fact to the next
 * reader. The alternation order is load-bearing: `\r\n` FIRST, so a CRLF fence
 * is consumed whole instead of leaving its `\n` at the head of the body.
 *
 * ⛤ The groups are NON-capturing on purpose: group 1 stays the YAML body, so
 * every call site that reads `match[1]` is unaffected by the widening.
 *
 * ⛔ Never `.match()` raw content against this directly — go through
 * {@link matchFrontmatterBlock}. A BOM before `---` defeats the `^` anchor
 * exactly as a CRLF fence did.
 */
const FRONTMATTER_BLOCK = /^---(?:\r\n|\r|\n)([\s\S]*?)(?:\r\n|\r|\n)---/;

/**
 * Length of the leading U+FEFF RUN (0, 1, or N) — BOM bytes only count while
 * they are still at the head of the content.
 *
 * ⛔ WITHDRAWN (req `74419202`, #4452): this used to skip AT MOST ONE byte, and
 * said so ("0 or 1"). A doubled BOM — the artifact of a naive "ensure a BOM"
 * tool that does not check for an existing one — therefore still defeated the
 * `^` anchor and the whole asset read as "no block at all".
 *
 * ⛤ Exported because the CLI write path needs the SAME arithmetic to decide
 * where the content proper begins (#4461 sanctioned either exporting this or
 * keeping a local copy; a local copy is the drift this file exists to end).
 * A run is skipped for MATCHING only — what a write path does with N>1 is that
 * path's decision, recorded in its own docstring.
 */
export function leadingBomLength(content: string): number {
  let n = 0;
  while (content.charCodeAt(n) === 0xfeff) n += 1;
  return n;
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
 * Match a leading frontmatter block, tolerating CRLF **or lone-CR** fences and
 * a RUN of leading BOMs.
 *
 * ⛤ A BOM run is skipped for MATCHING ONLY, and `blockStart` reports its full
 * length so a write path can decide for itself what to do with `N>1`.
 * ⛔ WITHDRAWN (req `74419202`, #4452): "Exactly ONE is skipped: a doubled BOM
 * still defeats the `^` anchor" was this docblock's claim and is no longer true.
 *
 * ⛤ The body is returned VERBATIM — neither `\r` nor a lone-CR line ending is
 * stripped from it. YAML 1.1 treats `\r\n` AND a bare `\r` as line breaks, so a
 * CR-separated body parses to the same mapping as its LF twin (measured on
 * js-yaml 5.3.0, the version `packages/cli` resolves — `a: 1\rb: 2\rc: three`
 * loads to the same object as its `\n` form). Stripping would be a second,
 * silent normalisation of user content and would make the returned offsets stop
 * matching the returned text.
 *
 * @returns the block, or `null` when the content does not open with one
 */
export function matchFrontmatterBlock(
  content: string,
): FrontmatterBlockMatch | null {
  const bom = leadingBomLength(content);
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
