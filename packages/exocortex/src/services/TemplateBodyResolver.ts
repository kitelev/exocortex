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
 * a markdown body is freeform prose, so an UNKNOWN `$word`, a non-scalar
 * resolver (`string[]`), or a context-missing resolver (`null`) leaves the
 * literal `$word` untouched rather than throwing or emitting an empty string.
 * Only KNOWN scalar tokens are spliced — `$5.00`, `$totallyUnknown` survive.
 */

import {
  getResolver,
  installDefaultResolvers,
  type ResolverContext,
} from "./SubstitutionResolverRegistry";

// Ensure the default resolver vocabulary is installed even if no other module
// (GroundingExecutor / the editor inserter) imported it first. Idempotent —
// last registration wins, so tests that need determinism clear + register their
// own resolvers AFTER import (see TemplateBodyResolver.test.ts beforeEach).
installDefaultResolvers();

/**
 * Token marker: `$` followed by an identifier (letter, then letters/digits/_).
 * The identifier is greedy so `$todayX` matches the whole name `todayX` (an
 * unknown token → left literal), never the prefix `today`. A token name stops
 * at the first non-identifier char, so `$today.md` → `<value>.md`.
 */
const TOKEN_RE = /\$([A-Za-z][A-Za-z0-9_]*)/g;

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
  return rawBody.replace(TOKEN_RE, (literal, name: string) => {
    const resolver = getResolver(name);
    if (resolver === undefined) return literal;
    const value = resolver(ctx);
    // Only scalar strings are spliced into freeform body text. `string[]`
    // (list-typed properties) and `null` (context missing) leave the literal
    // marker intact — surprising YAML-ish output / empty holes are worse than
    // a visible unresolved token the user can fix.
    return typeof value === "string" ? value : literal;
  });
}
