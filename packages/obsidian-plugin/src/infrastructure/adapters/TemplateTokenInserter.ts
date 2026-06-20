import type { Editor } from "obsidian";
import { getResolver, installDefaultResolvers } from "exocortex";

/**
 * TemplateTokenInserter — pure logic behind the editor "Insert template token"
 * command (homoiconic templating MVP, project 17f58ebe / vision 09a3fbec).
 *
 * The MVP inserts a single substitution-token value at the cursor. Token values
 * are produced by the SAME `SubstitutionResolverRegistry` that drives the
 * RFC 727572d2 RDF-driven asset-creation pipeline — so a "Random UUID" inserted
 * by hand and a `$randomUUIDv4` resolved during `create_instance` come from one
 * source of truth (interview Q6: reuse the existing resolvers, no duplication).
 *
 * The menu set + formats are the interview-confirmed MVP decisions (2026-06-20):
 *   - Random UUID     → `randomUUIDv4`  (bare v4 lowercase, crypto.randomUUID())  [Q1/Q2]
 *   - Current Timestamp → `nowTimestamp` (local ISO YYYY-MM-DDTHH:MM:SS, no TZ)    [Q1/Q3]
 *   - Current Date    → `nowDate`       (LOCAL date YYYY-MM-DD)                     [Q1]
 *
 * Why `nowDate` (local) and not the registry's `today` (UTC `toISOString`):
 * Andrey is UTC+5 and works in the early morning, when a UTC date is still
 * "yesterday". A local date matches both the user's expectation and the local
 * (no-TZ) timestamp decision (Q3) — same `YYYY-MM-DD` shape Andrey asked for.
 */

/** A single menu choice in the "Insert template token" picker. */
export interface TemplateTokenChoice {
  /** Stable id (command/test reference; not user-facing). */
  readonly id: string;
  /** Human-facing menu label. */
  readonly label: string;
  /** Resolver id in the SubstitutionResolverRegistry. */
  readonly resolverId: string;
  /** Short human description (searchable in the fuzzy picker; a11y line). */
  readonly description: string;
}

/**
 * MVP menu set (interview-confirmed Q1). Frozen so callers cannot mutate the
 * shared list. Extending the set later (vehy 2-5) is additive.
 */
export const TEMPLATE_TOKEN_CHOICES: readonly TemplateTokenChoice[] = Object.freeze([
  {
    id: "random-uuid",
    label: "Random UUID",
    resolverId: "randomUUIDv4",
    description: "A random UUID v4 (lowercase, crypto.randomUUID())",
  },
  {
    id: "current-timestamp",
    label: "Current Timestamp",
    resolverId: "nowTimestamp",
    description: "Local date-time, no timezone (YYYY-MM-DDTHH:MM:SS)",
  },
  {
    id: "current-date",
    label: "Current Date",
    resolverId: "nowDate",
    description: "Today's local date (YYYY-MM-DD)",
  },
]);

// Ensure the default resolver vocabulary is installed even if no other module
// (e.g. GroundingExecutor) imported it first. Idempotent — last registration
// wins, so this never clobbers a deterministic resolver a test injected AFTER
// import (tests that need determinism call clearResolvers + registerResolver in
// beforeEach).
installDefaultResolvers();

/**
 * Resolve a token's value via the shared registry. These MVP tokens
 * (`randomUUIDv4` / `nowTimestamp` / `nowDate`) need no context, so an empty
 * ResolverContext is passed. Throws (fail-loud) when the resolver id is
 * unregistered or yields a non-string — the menu only offers known scalar
 * tokens, so either is a programming error worth surfacing, not a silent
 * no-op insert.
 */
export function resolveTokenValue(resolverId: string): string {
  const resolver = getResolver(resolverId);
  if (resolver === undefined) {
    throw new Error(
      `Insert template token: no resolver registered for "${resolverId}".`,
    );
  }
  const value = resolver({});
  if (typeof value !== "string") {
    throw new Error(
      `Insert template token: resolver "${resolverId}" did not produce a scalar string value.`,
    );
  }
  return value;
}

/**
 * Resolve the chosen token and insert it at the cursor (replacing any selection)
 * via the Obsidian Editor API. Returns the inserted value so the caller can
 * surface it (e.g. a confirmation Notice) and so tests can assert exact
 * passthrough deterministically without registering a fixed resolver.
 */
export function insertTemplateToken(
  editor: Editor,
  choice: TemplateTokenChoice,
): string {
  const value = resolveTokenValue(choice.resolverId);
  editor.replaceSelection(value);
  return value;
}
