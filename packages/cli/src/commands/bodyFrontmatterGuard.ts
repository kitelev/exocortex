/**
 * Shared guard for the body-bearing CLI verbs — `set-body` (#3943) and
 * `create --body-file` (#3744): REFUSE a body whose leading text is a COPY of a
 * frontmatter block, fail-loud, before anything is written.
 *
 * Why it exists (ticket e6abe049): the program hub `31c2bdee` was found carrying
 * TWO frontmatter blocks — the real one, and immediately after its closing `---`
 * a stale 16-line copy with its own `---`. For the YAML parser the copy was
 * body, Obsidian rendered it as text, SPARQL read the first block and stayed
 * correct — so nothing reported it. The plausible writer is a `--body-file`
 * whose file was extracted together with the frontmatter (the classic
 * `sed -n '/^---$/,$p'` slice, which starts at the FIRST `---`).
 *
 * ⛔ The discriminator is NOT "the body starts with a `---` block". That naive
 * predicate refuses **31 live assets** — every one an `exo__Template`, whose
 * body IS a frontmatter skeleton by design (`exo__Asset_uid: $randomUUIDv4`).
 * Refusing those would break the template layer wholesale.
 *
 * What separates a COPY from a template is the VALUE: a copy carries the
 * system-generated identity of a real asset — a well-formed UUID in
 * `exo__Asset_uid` or a real ISO timestamp in `exo__Asset_createdAt` — while a
 * template carries a placeholder (`$randomUUIDv4`, `$nowTimestamp`, empty).
 * That narrow predicate refuses **0 of 52,086** live bodies and still refuses
 * the real pre-fix hub text `[three canonical vaults, assets with frontmatter,
 * 2026-09-24 ~10:50 +05]`. ⚠ The corpus is live (52,079 → 52,086 within one
 * hour), so the count carries its moment, not just its scope.
 *
 * ## Deliberate boundaries (measured, not overlooked)
 *
 * - **An unterminated leading block is REFUSED.** A body that opens a
 *   frontmatter-like block and never closes it runs to EOF, so a real uid far
 *   below still counts as "inside the leading block". Live bodies of that shape:
 *   **0**; the requirement says nothing about it; and the fail-loud direction is
 *   the safe one for a writer-side guard (a rejected write is recoverable, a
 *   silently doubled frontmatter block is not).
 * - **A uid line in SINGLE quotes, or with a trailing comment, is NOT caught.**
 *   `REAL_UID_RE` accepts the bare and double-quoted forms — the ones every
 *   writer in this repo emits. Live bodies carrying a single-quoted uid inside a
 *   leading block: **0**. Widening the pattern would trade a measured zero for
 *   more surface, so the narrow form ships and the gap is named here instead.
 */

/** `exo__Asset_uid: <well-formed uuid>` — the identity only a real asset has. */
const REAL_UID_RE =
  /^exo__Asset_uid\s*:\s*"?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"?\s*$/;

/** `exo__Asset_createdAt: <real ISO timestamp>` — same, for a copy whose uid line was dropped. */
const REAL_CREATED_AT_RE =
  /^exo__Asset_createdAt\s*:\s*"?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)"?\s*$/;

/**
 * A YAML mapping key (`key:` / `prefix__Key:`) — what makes a `---` a frontmatter fence.
 *
 * ⛔ The `__` separator gets NO group of its own. Spelling it out as
 * `[A-Za-z0-9_]*(?:__[A-Za-z0-9_]+)*` reads more explicitly and is
 * EXPONENTIAL: both parts accept `_`, so `A__0__0__…` has many equivalent
 * splits and the engine tries them all (CodeQL js/redos #318; measured on
 * `"A" + "__0".repeat(26) + "!"` — 1799 ms against 0 ms here). The character
 * class already covers `__`, so the two forms accept exactly the same strings
 * (verified over 12 live and edge shapes, 0 divergences).
 */
const YAML_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*:(?:\s|$)/;

/** A bare frontmatter head pasted without its `---` fence. */
const ASSET_HEAD_RE = /^(?:exo__Asset_uid|exo__Asset_createdAt)\s*:(?:\s|$)/;

function firstNonEmpty(lines: string[], from = 0): number {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") {
      return i;
    }
  }
  return -1;
}

/**
 * The lines of the body's LEADING frontmatter-like block, or undefined when the
 * body does not start with one.
 *
 * ⛤ Only the LEADING position is considered: a ```yaml fence, a prose example or
 * a `---` thematic break further down is ordinary content and must pass. A bare
 * `---` whose next non-empty line is NOT a YAML key is a thematic break, not a
 * fence, and also passes.
 */
function leadingFrontmatterBlock(body: string): string[] | undefined {
  const lines = body.split("\n");
  const i = firstNonEmpty(lines);
  if (i < 0) {
    return undefined;
  }
  const first = lines[i].replace(/\r$/, "");
  // ⛤ The bare form is the one the REAL incident took (hub 31c2bdee, pre-fix
  // text recovered from exoas-exodev@169e6846): the copy had NO opening `---` —
  // the real block's CLOSING fence served as it — so the body began directly
  // with `exo__Asset_uid:`. Both forms end at the copy's own closing `---`, and
  // cutting there matters: without it, a stray `exo__Asset_createdAt:` line in
  // prose far below could be read as part of the leading block.
  const start = ASSET_HEAD_RE.test(first) ? i : undefined;
  if (start === undefined) {
    if (first.trim() !== "---") {
      return undefined;
    }
    const j = firstNonEmpty(lines, i + 1);
    if (j < 0 || !YAML_KEY_RE.test(lines[j].replace(/\r$/, ""))) {
      return undefined; // thematic break, not a frontmatter fence
    }
  }
  const block: string[] = [];
  for (let k = start ?? i + 1; k < lines.length; k += 1) {
    if (lines[k].replace(/\r$/, "").trim() === "---") {
      break;
    }
    block.push(lines[k]);
  }
  return block;
}

/**
 * The offending `key: value` line when the body leads with a frontmatter COPY
 * (a leading frontmatter-like block carrying a real uid or a real createdAt),
 * or undefined when the body is ordinary content.
 */
export function detectFrontmatterCopy(body: string): string | undefined {
  const block = leadingFrontmatterBlock(body);
  if (!block) {
    return undefined;
  }
  for (const raw of block) {
    const line = raw.replace(/\r$/, "");
    if (REAL_UID_RE.test(line) || REAL_CREATED_AT_RE.test(line)) {
      return line.trim();
    }
  }
  return undefined;
}

/**
 * Fail-loud guard: throws when `body` leads with a frontmatter copy, leaving the
 * caller's file untouched. `verb` names the command in the message so the
 * operator sees which invocation to fix.
 */
export function assertNoFrontmatterCopy(body: string, verb: string): void {
  const offending = detectFrontmatterCopy(body);
  if (!offending) {
    return;
  }
  throw new Error(
    `The body starts with a COPY of a frontmatter block (${offending}). ` +
      `${verb} writes the body ONLY — the frontmatter is preserved (set-body) or built from ` +
      `--class/--property (create), so a leading frontmatter block would be stored as text and ` +
      `leave the asset carrying two blocks. Pass the body WITHOUT its frontmatter ` +
      `(a file sliced with 'sed -n "/^---$/,$p"' starts at the FIRST '---' — slice after the ` +
      `SECOND one instead). A template body whose uid/createdAt are placeholders is accepted.`,
  );
}
