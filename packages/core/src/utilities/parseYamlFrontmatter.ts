import * as yaml from "js-yaml";

/**
 * Tolerantly parse a YAML frontmatter block.
 *
 * A bare `yaml.load` throws on a **duplicated mapping key**, which makes the
 * whole asset collapse to `{}`/`null` at every read (0 triples → every `apply`
 * precondition false-fails → the asset is invisible AND unrepairable, #3800 —
 * same throw→`{}` mechanism as #3701).
 *
 * This helper keeps the STRICT parse for the common (well-formed) case, so a
 * non-duplicate file is byte-for-byte unaffected (zero behaviour change). Only
 * when the strict parse throws does it retry with `{ json: true }` — js-yaml's
 * JSON-compatibility mode, in which a duplicated key resolves **last-wins**
 * instead of throwing (empirically verified; matches the line-based
 * `FrontmatterService.parseObject` and the raw-text `repair-frontmatter`
 * dedupe, which both keep the last occurrence). A one-line WARN is emitted so
 * the malformed asset is observable rather than silently swallowed.
 *
 * Genuinely-unparseable frontmatter (bad indentation, unterminated quote, …)
 * still throws even in tolerant mode → returns `null` (same as the old
 * throw→`{}` behaviour), so this only ever RESCUES the duplicate-key class.
 *
 * @param yamlBlock the raw YAML text between the `---` fences
 * @param context   optional label (e.g. file path) surfaced in the WARN log
 * @returns the parsed mapping, or `null` when it is not a non-null object or is
 *          genuinely unparseable even in tolerant mode
 */
export function parseYamlFrontmatterTolerant(
  yamlBlock: string,
  context?: string,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlBlock);
  } catch (strictError) {
    try {
      // JSON-compat mode: duplicate keys resolve last-wins instead of throwing.
      parsed = yaml.load(yamlBlock, { json: true });
    } catch {
      // Not a mere duplicate-key issue — genuinely malformed. Preserve the
      // historical throw→null/`{}` fallback rather than crash the caller.
      return null;
    }
    const detail =
      strictError instanceof Error
        ? strictError.message.split("\n")[0]
        : String(strictError);
    console.warn(
      `[frontmatter] tolerant-parsed malformed YAML${
        context ? ` (${context})` : ""
      } — resolving last-wins: ${detail}`,
    );
  }
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;
}
