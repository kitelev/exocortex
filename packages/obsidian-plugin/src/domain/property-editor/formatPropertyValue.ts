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
 * ⛤ #4405 names a SECOND writer — `property_set` on an undeclared,
 * non-string-semantic property — and that half is now CLOSED TOO, by #4424 /
 * @req:992f0a75. The paragraph below used to end "fixing it needs a way to tell
 * author-written YAML from substituted user input, which is a design question,
 * not a serialisation one"; the design question has an answer, so the sentence
 * is corrected here rather than only appended to
 * (retracted-claim-outranks-its-correction).
 *
 * The answer is NOT a serialisation rule: `GroundingExecutor` records the
 * value's ORIGIN where the value is PRODUCED (did `substituteVariables`
 * actually replace anything) and consumes that flag at a step placed strictly
 * AFTER the unquoted-wikilink guard of @req:29e0d1b6. A substituted value is
 * serialised; YAML an author wrote in the grounding stays verbatim, so the
 * deliberate flow array `["[[ems__Task]]"]` of the multi-class convert still
 * lands as a list — pinned by axis K13 of
 * `range-typing-534a7a46.integration.test.ts` (@req:675cb0ab) and by J3 of
 * `grounding-substituted-value-origin-4424.integration.test.ts`. Declared-range
 * and string-semantic values keep going through this serialiser as before
 * (ticket 534a7a46).
 *
 * Here no such ambiguity ever existed: the value comes from a textbox a human
 * typed, so this file needs no discriminator — which is why the two halves were
 * fixed separately rather than together.
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
