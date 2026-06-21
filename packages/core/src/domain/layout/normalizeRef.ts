/**
 * normalizeRef — shared wikilink/identifier normalizer for the layout domain.
 *
 * Used by `Layout` + `LayoutBlock` frontmatter parsers to coerce wikilink or
 * raw identifier values to their canonical string form.
 *
 * @module domain/layout
 */

import { WikiLinkHelpers } from "../../utilities/WikiLinkHelpers";

/**
 * Normalize a wikilink or raw identifier to its canonical string form, or
 * `null` when the input cannot be normalized.
 *
 * Delegates to {@link WikiLinkHelpers.normalize} so every layout consumer
 * shares the SAME wikilink semantics as the rest of `@kitelev/exocortex-core`
 * (issue #2941 — prior asymmetric "before-pipe wins" behaviour caused
 * frontmatter match failures for starter-kit-style `[[uuid|alias]]` values).
 *
 * Behaviour (via `WikiLinkHelpers.normalize`):
 * - `"[[ems__Area]]"` → `"ems__Area"`
 * - `"[[UUID|ems__Area]]"` → `"ems__Area"` (UUID target ⇒ alias wins)
 * - `"[[Some Note|Display]]"` → `"Some Note"` (non-UUID target ⇒ target wins)
 *
 * Returns `null` for non-string inputs, empty strings, and wikilinks whose
 * inner text collapses to empty (e.g. `"[[|alias]]"`).
 */
export function normalizeRef(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = WikiLinkHelpers.normalize(value);
  return normalized.length > 0 ? normalized : null;
}
