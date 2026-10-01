/**
 * TemplateBodyResolver — resolve `$token` substitution markers inside a
 * markdown body using the shared {@link SubstitutionResolverRegistry}.
 *
 * Homoiconic templating (vehy 2-4, project 17f58ebe / vision 09a3fbec). The
 * vision's "variables" are NOT a new class — they are the EXISTING
 * `exocmd__SubstitutionToken` vocabulary (interview Q6): a Template body that
 * writes `$today` / `$randomUUIDv4` / `$nowTimestamp` reuses the very same
 * resolvers that the RFC 727572d2 RDF-driven asset-creation pipeline dispatches.
 * One source of truth — a hand-inserted token and a `create_instance`-time
 * token resolve identically.
 *
 * Used by:
 *   - Веха 2 — editor "Insert template" command (insert a Template body at the
 *     cursor with tokens resolved).
 *   - Веха 3 — `body_template` grounding step (copy a Template body into a
 *     newly created asset with tokens resolved).
 *   - Веха 4 — the `$token` resolution itself.
 *
 * Leniency contract (deliberately different from grounding value positions):
 * a markdown body is freeform prose, so the literal `$word` is left untouched
 * (rather than thrown on or blanked) when the token is UNKNOWN, when the
 * resolver yields a non-scalar (`string[]`), `null`, OR an EMPTY string. The
 * last case matters because several built-in resolvers (`target`,
 * `targetFolder`, `userInputLabel`, …) return `""` when their context is
 * absent — and the editor "Insert template" path resolves with NO context. A
 * visible unresolved `$target` the user can fix beats a silently-deleted token.
 * Only KNOWN, NON-EMPTY scalar tokens are spliced — `$5.00`, `$totallyUnknown`,
 * and context-missing `$target` all survive.
 */

import {
  getResolver,
  installDefaultResolvers,
  isResolverModifierAware,
  type ResolverContext,
} from "./SubstitutionResolverRegistry";
import { matchFrontmatterBlock } from "../utilities/frontmatterBlock";

// Ensure the default resolver vocabulary is installed even if no other module
// (GroundingExecutor / the editor inserter) imported it first. Idempotent —
// last registration wins, so tests that need determinism clear + register their
// own resolvers AFTER import (see TemplateBodyResolver.test.ts beforeEach).
installDefaultResolvers();

/**
 * Token marker: `$` followed by an identifier (letter, then letters/digits/_),
 * then an OPTIONAL date modifier suffix (Веха 5 — Templater `tp.date.*`):
 *   - offset  `[+-]\d+[dwMy]`         e.g. `+7d`, `-3d`, `+2w`, `+1M`, `+1y`
 *   - format  `:` then a format charset (`HH:mm:ss`, `DD.MM.YYYY`, `YYYY/MM/DD`)
 * Examples captured as (name, suffix):
 *   `$today`            → ("today", "")            — bare, suffix empty
 *   `$date+7d`           → ("date", "+7d")
 *   `$date:DD.MM.YYYY`   → ("date", ":DD.MM.YYYY")
 *   `$now+1M:YYYY-MM`    → ("now", "+1M:YYYY-MM")
 *   `$today.md`          → ("today", "")  + literal ".md" (no leading `:`)
 *   `$today-end`         → ("today", "")  + literal "-end" (no digit after `-`)
 * The identifier is greedy so `$todayX` matches the whole name `todayX` (an
 * unknown token → left literal), never the prefix `today`. The suffix only
 * matches a date-shaped offset and/or a `:`-led format, so non-date tokens with
 * trailing punctuation (`$today.md`, `$today-end`) capture an empty suffix and
 * behave exactly as before this feature.
 *
 * Format charset stops at whitespace/comma/etc, so a sentence like
 * `Due $date:YYYY-MM-DD, soon` keeps `, soon` outside the token. (A trailing `.`
 * IS in the charset — `Due $date:YYYY-MM-DD.` renders `…2026-06-21.` with the
 * period reproduced as a literal format char, visually identical.)
 *
 * LIMITATION — a format containing a SPACE or COMMA is truncated at that char in
 * BODY text: `$now:h:mm A` resolves only `:h:mm` → `12:30` and the ` A` survives
 * as prose, `$date:dddd, MMMM Do YYYY` resolves only `:dddd`. Multi-word formats
 * (`h:mm A`, `dddd, MMMM Do YYYY`) are reachable only via a vault
 * `exocmd__TokenInvocation_parameter` (the resolver itself handles spaces), NOT
 * via an inline body suffix. For body use, compose contiguous formats (`HH:mm`,
 * `YYYY-MM-DDTHH:mm:ss`) or multiple tokens. (Descoped: bracket-escaping.)
 */
const TOKEN_RE =
  /\$([A-Za-z][A-Za-z0-9_]*)((?:[+-]\d+[dwMy])?(?::[A-Za-z0-9:./-]+)?)/g;

/**
 * Replace every KNOWN scalar `$token` in `rawBody` with its resolver value.
 *
 * @param rawBody markdown body (frontmatter NOT included).
 * @param ctx     optional resolver context (userInput, target, etc.) forwarded
 *                to context-dependent resolvers; defaults to empty.
 * @returns the body with known scalar tokens substituted; unknown / non-scalar
 *          / null-yielding tokens left as their literal `$name` text.
 */
export function resolveTemplateBody(
  rawBody: string,
  ctx: ResolverContext = {},
): string {
  return rawBody.replace(TOKEN_RE, (literal, name: string, suffix: string) => {
    const resolver = getResolver(name);
    if (resolver === undefined) return literal;
    // Modifier-aware date resolvers (`date`/`now`/`tomorrow`/`yesterday`)
    // consume the suffix; all others ignore the second arg.
    const value = resolver(ctx, suffix.length > 0 ? suffix : undefined);
    // Only KNOWN, NON-EMPTY scalar strings are spliced into freeform body text.
    // `string[]` (list-typed), `null`, and `""` (context-missing resolvers such
    // as `target`/`targetFolder`/`userInputLabel` return empty when their
    // context is absent) all leave the FULL literal marker intact — a visible
    // unresolved token the user can fix beats a silently-deleted one.
    if (typeof value !== "string" || value.length === 0) return literal;
    // For a modifier-aware resolver the suffix is already baked into `value`.
    // For a legacy (modifier-unaware) resolver the suffix was NOT part of this
    // token's semantics, so reproduce it verbatim — `$today+7d` → `<date>+7d`,
    // `$nowDate:foo` → `<date>:foo` — identical to pre-feature behaviour where
    // the old regex stopped at the first non-identifier char.
    return isResolverModifierAware(name) ? value : value + suffix;
  });
}

/**
 * One leading line terminator, in any of the three forms — what the block's
 * CLOSING fence is followed by when a body comes after it.
 *
 * ⛤ Consumed so the inserted/copied body does not open with a blank line. The
 * form is read from the file rather than assumed: the closing fence's own
 * terminator need not match the opening one in a hand-edited file, so this is
 * deliberately NOT `FrontmatterService.leadingBlock().eol` (which reports the
 * OPENING fence's style — the right answer for a WRITER inserting a line INTO
 * the block, and the wrong one for a reader slicing after it).
 */
const SEPARATING_TERMINATOR = /^(?:\r\n|\n|\r)/;

/**
 * Strip the leading YAML frontmatter block, returning the markdown body. When
 * no frontmatter is present the whole content is the body. A single terminator
 * separating the closing `---` from the body is consumed so the body does not
 * start with a blank line.
 *
 * Single source for "an exotemplate__Template asset's body is its file body"
 * — reused by the plugin editor inserter, the plugin TemplateLoaderPort, and
 * the CLI TemplateLoaderPort (one strip, no per-consumer regex drift).
 *
 * ⛔ WITHDRAWN (#4482): the previous edition of this docblock said "`\r?\n`
 * tolerates CRLF (Windows vaults)" and left it there, which read as a statement
 * of the tolerance this function HAS. It carried its OWN
 * `/^---\r?\n[\s\S]*?\r?\n---\r?\n?/` — the sixth copy of a predicate
 * `matchFrontmatterBlock` has owned since #4452/#4453 — and `\r?\n` is
 * indivisible, so it needs at least one `\n`: a lone-CR-fenced template (classic
 * pre-OS9 Mac endings, no `\n` anywhere) matched NOTHING, and neither did a
 * BOM-prefixed one (`^---` cannot reach past `U+FEFF`). The match was `null`,
 * this function returned the content VERBATIM, and the TEMPLATE's own
 * frontmatter — `exo__Asset_uid`, `exo__Instance_class`, every property — was
 * inserted into the target note's body as text. Three production consumers
 * reached it: `apply`'s TemplateLoaderPort, the plugin's TemplateLoaderPort
 * (`ExocortexPlugin` → `extractTemplateBody`) and the editor "Insert template"
 * command (`resolveTemplateForInsert`).
 *
 * ⛤ BOM policy — a RUN of N leading `U+FEFF` is recognised, identical to
 * `FrontmatterService.leadingBlock` because both ask the SAME `leadingBomLength`
 * arithmetic through `matchFrontmatterBlock`. The "collapse a run to exactly
 * ONE" half of that policy has no counterpart here and is deliberately NOT
 * reimplemented: this is a READER whose result is a body placed into a DIFFERENT
 * file, so the BOM — a property of the template file, not of its body — is
 * dropped with the block it precedes, for N=3 exactly as for N=1.
 *
 * ⛤ The canonical over-widening input is UNCHANGED, measured rather than assumed
 * (#4468's HIGH, #4482 Risk 1): `---\r\n---\r\n<body>` — two stacked horizontal
 * rules sharing ONE physical CRLF — is "no block" for the old local regex
 * (`\r?\n` is indivisible at each fence) AND for `matchFrontmatterBlock` (the
 * opening terminator is consumed before the closing fence is searched), so the
 * content comes back verbatim both before and after this conversion.
 *
 * NOTE — distinct from `utilities/sparqlBlock.stripFrontmatter`, which keeps a
 * leading newline (`\nbody`). This one consumes the separating terminator so the
 * inserted/copied block does not start blank.
 */
export function stripTemplateFrontmatter(content: string): string {
  const block = matchFrontmatterBlock(content);
  if (!block) return content;
  // `blockEnd` is the offset in the ORIGINAL string just past the closing
  // `---`, so a leading BOM run is already accounted for and no reconstruction
  // length is involved.
  const afterBlock = content.slice(block.blockEnd);
  const separator = SEPARATING_TERMINATOR.exec(afterBlock);
  return separator ? afterBlock.slice(separator[0].length) : afterBlock;
}
