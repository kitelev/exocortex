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
 * Issue #3750 (follow-up hardening, from an adversarial review of #3749):
 *  - MEDIUM-2: the `"`-wrapped passthrough accepted ANY value starting+ending
 *    with `"`, so `"a" and "b"` (not a complete scalar) emitted bare → invalid
 *    YAML. Tightened to pass through only a *complete* double-quoted scalar
 *    (no unescaped interior `"`).
 *  - MEDIUM-3: scalar-looking strings (`123`, `12_000`, `true`, `null`, `~`,
 *    `1.5`, `.inf`, `.nan`, date-only `2026-01-15`) emitted bare are coerced to
 *    number/bool/null/Date by a real YAML parser (Obsidian metadataCache) —
 *    wrong type for a semantically-string label/alias. They are now quoted so
 *    they round-trip as strings. NB: datetime timestamps (`YYYY-MM-DDThh:mm:ss`,
 *    the system's `createdAt`/`updatedAt`/effort-timestamp format) are
 *    deliberately NOT quoted — they are semantic dates and stay bare.
 *  - LOW-4: control chars beyond `\n\r\t` (`\x07`, `\b`, `\f`, `\v`, NUL, DEL)
 *    are detected and escaped (`\xNN`) so they never reach a parser bare.
 *
 * Strategy: emit string scalars verbatim UNLESS YAML would mis-parse or
 * mis-type them, in which case wrap in a double-quoted scalar with proper
 * escaping. Deliberately conservative ("quote only when needed") so labels
 * without special characters keep their existing bare form — avoids mass
 * snapshot churn and over-quoting.
 */

const YAML_LEADING_INDICATORS = /^[-!&*?|>%@`"'#,[\]{}]/;

// Control characters (C0 range + DEL) that break a single-line plain scalar.
// Covers `\t` `\n` `\r` plus `\x07` `\b` `\f` `\v` NUL etc. (#3750 LOW-4).
// eslint-disable-next-line no-control-regex
const YAML_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Scalar tokens a real YAML parser (js-yaml DEFAULT_SCHEMA, used by Obsidian
// metadataCache) coerces away from string. Replicated from js-yaml's resolvers
// (lib/type/{bool,null,int,float,timestamp}.js). (#3750 MEDIUM-3.)
const YAML_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
const YAML_NULL = /^(?:null|Null|NULL|~)$/;
const YAML_INT = /^[-+]?(?:0b[01_]+|0o[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*)$/;
const YAML_FLOAT =
  /^(?:[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
// Date-only timestamp (`2026-01-15`). Datetime values (with a `T`/time part)
// are intentionally excluded — they are the system's semantic-date format.
const YAML_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Frontmatter properties whose values are semantically STRINGS (labels), so a
 * scalar-looking value (`123`, `true`, `2026-01-15`) must be quoted to avoid
 * type-coercion (#3750 MEDIUM-3). This is deliberately narrow: timestamp
 * properties (`exo__Asset_createdAt`, `ems__Effort_plannedStartTimestamp`, …)
 * and numeric properties are NOT here — they SHOULD keep their native
 * number/date type under a real YAML parser.
 */
export const STRING_SCALAR_PROPERTIES = new Set<string>([
  "exo__Asset_label",
  "aliases",
]);

/**
 * Is the value a COMPLETE, single double-quoted YAML scalar (`"…"`)?
 *
 * True for production-formed values like `"[[uid]]"` (wikilinks arrive
 * pre-wrapped) and `"My Workflow"` (DefaultWorkflows pre-wraps labels) — these
 * pass through verbatim. False for `"a" and "b"` (two quoted runs — has an
 * unescaped interior `"`) and `"\"` (the closing quote is escaped), which must
 * be re-quoted instead of emitted as invalid YAML. (#3750 MEDIUM-2.)
 */
function isCompleteDoubleQuotedScalar(value: string): boolean {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return false;
  }
  const inner = value.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") {
      // A trailing backslash would escape the closing `"` → not complete.
      if (i + 1 >= inner.length) return false;
      i++; // skip the escaped char
      continue;
    }
    if (inner[i] === '"') return false; // unescaped interior quote
  }
  return true;
}

/**
 * Does a real YAML parser coerce this bare plain scalar to a non-string type?
 * (#3750 MEDIUM-3 — quote these so a semantically-string label/alias survives
 * as a string.) Datetime timestamps are excluded by {@link YAML_DATE} so the
 * system's `createdAt`/effort-timestamp values keep their native date type.
 */
function looksLikeNonStringScalar(value: string): boolean {
  return (
    YAML_BOOL.test(value) ||
    YAML_NULL.test(value) ||
    YAML_INT.test(value) ||
    YAML_FLOAT.test(value) ||
    YAML_DATE.test(value)
  );
}

/**
 * Does this string require double-quoting to round-trip as a YAML plain scalar?
 *
 * Returns false for values that are ALREADY a complete double-quoted scalar —
 * production wikilink values arrive pre-wrapped as `"[[uid]]"` and some callers
 * pre-wrap plain labels as `"name"`; both must pass through verbatim.
 *
 * @param quoteAmbiguousScalars — when true (string-semantic properties like
 *   `exo__Asset_label` / `aliases`), also quote scalar-looking strings so they
 *   survive as strings (#3750 MEDIUM-3). Default false — number/bool/date-shaped
 *   values of OTHER properties keep their native YAML type.
 */
export function needsYamlQuoting(
  value: string,
  quoteAmbiguousScalars = false,
): boolean {
  // Empty → must be `""` (a bare empty value is an implicit null in YAML).
  if (value === "") return true;

  // Already a COMPLETE double-quoted scalar (e.g. `"[[StatusDone]]"`) — leave
  // as-is. Tightened in #3750 MEDIUM-2: an incomplete/invalid quoted run like
  // `"a" and "b"` is NOT passed through (it would emit invalid YAML); it falls
  // through to quoteYamlString and round-trips as the literal string.
  if (isCompleteDoubleQuotedScalar(value)) {
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

  // Control characters that break a single-line plain scalar (#3750 LOW-4).
  if (YAML_CONTROL_CHARS.test(value)) return true;

  // Scalar-looking strings coerced to non-string types by a real YAML parser
  // (#3750 MEDIUM-3) — quote so a semantically-string value round-trips. Gated
  // to string-semantic properties so timestamp/numeric properties keep their
  // native type (see {@link STRING_SCALAR_PROPERTIES}).
  if (quoteAmbiguousScalars && looksLikeNonStringScalar(value)) return true;

  return false;
}

/**
 * Wrap a string in a YAML double-quoted scalar with proper escaping.
 *
 * Escapes `\` `"` `\n` `\r` `\t` and any other control character (`\xNN`) so
 * the quoted form is itself valid and js-yaml can load it (#3750 LOW-4).
 */
export function quoteYamlString(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += "\\x" + code.toString(16).toUpperCase().padStart(2, "0");
    } else {
      out += ch;
    }
  }
  return `"${out}"`;
}

/**
 * Serialize a single scalar value for a YAML frontmatter line.
 *
 * - Non-strings (boolean, number) are emitted via `String()` unquoted so
 *   `archived: true` / `priority: 1` keep YAML-native types.
 * - Strings are emitted verbatim unless {@link needsYamlQuoting}, in which case
 *   they are double-quoted via {@link quoteYamlString}.
 */
export function serializeYamlScalar(
  value: unknown,
  quoteAmbiguousScalars = false,
): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return needsYamlQuoting(value, quoteAmbiguousScalars)
    ? quoteYamlString(value)
    : value;
}
