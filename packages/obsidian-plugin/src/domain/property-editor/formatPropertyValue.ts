import { serializeYamlScalar } from "@kitelev/exocortex-core";

/**
 * Formats a property value for YAML frontmatter storage.
 *
 * ⛔ The consumer is `FrontmatterService.updateProperty`, whose contract is
 * "already-formatted YAML" — it writes what it is handed VERBATIM. Returning
 * raw `String(value)` therefore let any YAML-significant text the user typed
 * change meaning on the way back in (#4405): `PR #42 merged` was stored bare
 * and re-read as `PR`, because ` #` opens a comment; `#4263: …` re-read as
 * `null`. The same grammar bites a leading `[ { & * ! | > % @` or backtick, a
 * `: ` inside the text, and a leading `-`.
 *
 * So strings go through the SAME quote-when-needed serialiser the CLI's
 * `property_set` uses (`serializeYamlScalar`), rather than a second,
 * hand-rolled notion of "needs quoting" that would drift from it. Plain text
 * still comes out bare — quoting is applied only where the grammar demands it.
 *
 * ⛔ #4405 names a SECOND writer — `property_set` on an undeclared,
 * non-string-semantic property — and that half is deliberately NOT fixed here.
 * `GroundingExecutor` already routes declared-range and string-semantic values
 * through this serialiser (ticket 534a7a46) and leaves the rest verbatim ON
 * PURPOSE: there the value is YAML an author wrote, so quoting it would break
 * the deliberate flow array `["[[ems__Task]]"]` of the multi-class convert —
 * pinned by axis K13 of `range-typing-534a7a46.integration.test.ts`
 * (@req:675cb0ab). Fixing it needs a way to tell author-written YAML from
 * substituted user input, which is a design question, not a serialisation one.
 * Here no such ambiguity exists: the value comes from a textbox a human typed.
 *
 * @param value - The value to format
 * @returns The formatted string value
 */
export function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  // An emptied field means "no value", so it keeps the pre-#4405 shape (`k:`)
  // instead of the serialiser's `""`. This is the ONE place this writer parts
  // with `serializeYamlScalar`, and deliberately: the executor's `property_set`
  // takes an explicit literal, where an empty string is a value the author
  // typed; here it is a textbox the user cleared. Quoting it would change what
  // clearing a field does — behaviour outside the scope of #4405, which is
  // about text whose MEANING changes on the way back in.
  if (value === "") {
    return "";
  }
  if (typeof value === "boolean") {
    return value.toString();
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    // Items are scalars in a block sequence and need the same treatment: an
    // unquoted `- PR #42 merged` loses its tail exactly like a mapping value.
    return `\n${value.map((v) => `  - ${serializeYamlScalar(v)}`).join("\n")}`;
  }
  return serializeYamlScalar(value);
}
