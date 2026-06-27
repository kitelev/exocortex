/**
 * YAML scalar serialization helpers — quote-when-needed.
 *
 * Issue #3748: `create_instance` / `apply create-task` wrote string scalars
 * (notably `exo__Asset_label` and `aliases` items) verbatim into frontmatter.
 * A label containing `: ` (colon-space) — e.g. `"ZZ probe: colon-space"` —
 * produced invalid YAML (`mapping values are not allowed here` /
 * `bad indentation of a mapping entry`). The created file then parsed to `{}`
 * (silently un-parseable frontmatter) → invisible to findFileByUID / SHACL /
 * metadataCache. Root cause of #3701 + ~16 broken WBS nodes.
 *
 * Strategy: emit string scalars verbatim UNLESS YAML would mis-parse them, in
 * which case wrap in a double-quoted scalar with proper escaping. Deliberately
 * conservative ("quote only when needed") so labels without special characters
 * keep their existing bare form — avoids mass snapshot churn and over-quoting.
 */

const YAML_LEADING_INDICATORS = /^[-!&*?|>%@`"'#,[\]{}]/;

/**
 * Does this string require double-quoting to round-trip as a YAML plain scalar?
 *
 * Returns false for values that are ALREADY a complete double-quoted scalar
 * (start and end with `"`) — production wikilink values arrive pre-wrapped as
 * `"[[uid]]"` and must pass through verbatim.
 */
export function needsYamlQuoting(value: string): boolean {
  // Empty → must be `""` (a bare empty value is an implicit null in YAML).
  if (value === "") return true;

  // Already a complete double-quoted scalar (e.g. `"[[StatusDone]]"`) — leave as-is.
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return false;
  }

  // Leading or trailing whitespace is stripped by a plain scalar.
  if (value !== value.trim()) return true;

  // `: ` or trailing `:` → YAML reads this as a nested mapping (the #3748 bug).
  if (/:(\s|$)/.test(value)) return true;

  // ` #` → YAML comment indicator mid-value.
  if (/\s#/.test(value)) return true;

  // Leading indicator characters that start anchors/aliases/tags/flow/quotes/etc.
  if (YAML_LEADING_INDICATORS.test(value)) return true;

  // Control characters that break a single-line plain scalar.
  if (/[\n\r\t]/.test(value)) return true;

  return false;
}

/** Wrap a string in a YAML double-quoted scalar with proper escaping. */
export function quoteYamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/**
 * Serialize a single scalar value for a YAML frontmatter line.
 *
 * - Non-strings (boolean, number) are emitted via `String()` unquoted so
 *   `archived: true` / `priority: 1` keep YAML-native types.
 * - Strings are emitted verbatim unless {@link needsYamlQuoting}, in which case
 *   they are double-quoted via {@link quoteYamlString}.
 */
export function serializeYamlScalar(value: unknown): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return needsYamlQuoting(value) ? quoteYamlString(value) : value;
}
