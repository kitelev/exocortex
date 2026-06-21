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
 * Strip the leading YAML frontmatter block, returning the markdown body. When
 * no frontmatter is present the whole content is the body. A single newline
 * separating the closing `---` from the body is consumed so the body does not
 * start with a blank line. `\r?\n` tolerates CRLF (Windows vaults).
 *
 * Single source for "an exotemplate__Template asset's body is its file body"
 * — reused by the plugin editor inserter, the plugin TemplateLoaderPort, and
 * the CLI TemplateLoaderPort (one strip, no per-consumer regex drift).
 *
 * NOTE — distinct from `utilities/sparqlBlock.stripFrontmatter`, which keeps a
 * leading newline (`\nbody`). This one consumes the separating newline so the
 * inserted/copied block does not start blank, and is CRLF-tolerant.
 */
export function stripTemplateFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length) : content;
}
