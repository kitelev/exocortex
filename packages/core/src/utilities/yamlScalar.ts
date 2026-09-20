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
 * Ticket 2227d660 (declared-range typing): the writers decided a scalar's
 * YAML type by its SHAPE — `needsYamlQuoting` quoted any value starting with a
 * YAML indicator (`-1001234567890` → `"-1001234567890"`) and left a bare digit
 * run bare (`42`) — while the validator (`ShaclLiteValidator`, founder rule
 * 2026-09-19) judges the literal's tag against the property's DECLARED
 * `exo__Property_range`. So a negative chat id under `xsd:integer` landed as
 * an `xsd:string` literal (sh:datatype violation) and a numeric string under
 * `xsd:string` as `xsd:integer` (the mirror violation). The third argument,
 * `declaredRange`, lets a writer that knows the range type the scalar by it:
 * see {@link scalarTypingForRange} and {@link needsYamlQuoting}. Without a
 * range the behaviour is exactly the pre-ticket one (fail-open: a vault with
 * no mounted TBox keeps creating assets).
 *
 * Strategy: emit string scalars verbatim UNLESS YAML would mis-parse or
 * mis-type them, in which case wrap in a double-quoted scalar with proper
 * escaping. Deliberately conservative ("quote only when needed") so labels
 * without special characters keep their existing bare form — avoids mass
 * snapshot churn and over-quoting.
 */

import * as yaml from "js-yaml";
import { xsdDatatypeLocalName, xsdNumericFamily } from "./xsdDatatype";

const YAML_LEADING_INDICATORS = /^[-!&*?|>%@`"'#,[\]{}]/;

// Control characters that break a single-line plain scalar: the C0 range + DEL
// (#3750 LOW-4 — `\t` `\n` `\r` plus `\x07` `\b` `\f` `\v` NUL etc.) and the C1
// range U+0080–U+009F (req 389d4e14, ticket 71f1ca37). Measured on js-yaml 5.3.0
// under YAML11_SCHEMA: a bare C1 character other than NEL (U+0085) makes the
// reader throw "non-printable characters" for the WHOLE frontmatter; NEL loads
// bare but is quoted uniformly with its class.
// eslint-disable-next-line no-control-regex -- the C0/DEL/C1 class IS the pattern's purpose (#3750 LOW-4, req 389d4e14)
const YAML_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

// Non-printable positions js-yaml rejects OUTSIDE the control class above
// (`PATTERN_NON_PRINTABLE`, js-yaml 5.3.0 dist/js-yaml.cjs.js:1812, applied by
// `checkPrintable` to plain AND block scalars (readPlainScalar :2263,
// readBlockScalar :2213) — inside `"…"` the raw unit loads, as with C1): the
// non-characters
// U+FFFE / U+FFFF and lone surrogate halves (a high D800–DBFF not followed by
// a low DC00–DFFF, a low not preceded by a high). Copied verbatim minus the
// C0/DEL/C1 part; deliberately NO `u` flag — the reader matches UTF-16 code
// units, so must this predicate. A valid pair (astral char), U+FFFD and a BOM
// inside a value are printable to the reader and stay bare (ticket 65ea50c4).
const YAML_NON_PRINTABLE_CHARS =
  /[\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

// Scalar tokens the YAML 1.2 CORE schema (js-yaml 4 DEFAULT_SCHEMA — the
// reader Obsidian's metadataCache uses, #3750 MEDIUM-3) coerces away from
// string. Replicated from js-yaml 4's resolvers
// (lib/type/{bool,null,int,float,timestamp}.js). Ticket 8185c9dd: this table
// is the SECOND half of {@link looksLikeNonStringScalar} — the first half is
// the product's own reader (js-yaml 5.3.0 `YAML11_SCHEMA`), consulted
// directly. The two schemas disagree in BOTH directions (`1e5` / `08` / `0o17`
// are numbers only in 1.2-core; `10:30` / `yes` / `+.5` only in YAML 1.1), so
// the writer quotes when EITHER reader would hand back a non-string.
const YAML_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
const YAML_NULL = /^(?:null|Null|NULL|~)$/;
const YAML_INT = /^[-+]?(?:0b[01_]+|0o[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*)$/;
const YAML_FLOAT =
  /^(?:[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
// Date-only timestamp (`2026-01-15`) of the 1.2-core table. A DATETIME
// (`2026-01-15T10:00:00`) is not listed here — the YAML11 reader half reads
// it as a `Date` and quotes it under string semantics (ticket 8185c9dd; the
// #3750 "datetime stays bare" bound was for TIMESTAMP properties, which never
// reach this oracle — they are neither string-semantic nor `xsd:string`).
const YAML_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
/** The two lexical forms `xsd:string` leaves bare (ticket 8185c9dd — the range-rule boolean exclusion, canonical lowercase only). */
const CANONICAL_YAML_BOOLEAN = /^(?:true|false)$/;

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
 * How a property's DECLARED `exo__Property_range` types a frontmatter scalar
 * (ticket 2227d660): the numeric families emit a canonical number BARE, a
 * boolean emits `true`/`false` bare, a string quotes scalar-looking values.
 * `undefined` = the range gives no typing → shape-based behaviour as before.
 */
export type DeclaredRangeTyping = "integer" | "decimal" | "boolean" | "string";

/**
 * Canonical lexical forms a numeric declared range lets the writer emit BARE.
 *
 * ⛔ Deliberately NARROWER than js-yaml's own `YAML_INT` / `YAML_FLOAT`
 * resolvers: the writer's promise is "the reader gets back the same number
 * the author wrote", and the YAML 1.1 schema the reader uses
 * (`parseYamlFrontmatterTolerant`, js-yaml 5.3.0 `YAML11_SCHEMA`) does NOT
 * keep that promise for every int-shaped run — measured 2026-09-19: `010` →
 * 8 (octal), `007` → 7, `1_000` → 1000, `0x1F` → 31, `08` → the STRING "08".
 * A leading zero, an underscore or a base prefix therefore keeps today's
 * shape-based behaviour; only `0` or a non-zero-led digit run (with an
 * optional sign, and for the decimal family an optional `.digits` fraction)
 * is a canonical number. `-` before a digit is a plain scalar, not a block
 * sequence indicator (that needs `- `), so a canonical negative is safe bare.
 */
const CANONICAL_INTEGER_LEXICAL = /^[+-]?(?:0|[1-9][0-9]*)$/;
const CANONICAL_DECIMAL_LEXICAL = /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
/** The two lexical forms `xsd:boolean` shares with a YAML boolean (`true` / `false`). */
const CANONICAL_BOOLEAN_LEXICAL = /^(?:true|false)$/;

/**
 * Typing implied by a property's declared `exo__Property_range` values, as the
 * TBox writes them — the CURIE `xsd:<local>` or the full W3C IRI (both forms
 * `xsdDatatypeLocalName` reads).
 *
 * Only a range that is exactly ONE XSD datatype types the scalar. A class
 * range (`[[<uid>]]`, `ems__Effort`), a multi-valued range, a foreign CURIE
 * or an absent range (`undefined`) yields `undefined`: the writer then keeps
 * its shape-based behaviour, so a property whose range the writer cannot read
 * is written exactly as before this ticket (fail-open by construction).
 */
export function scalarTypingForRange(
  declaredRange: readonly string[] | undefined,
): DeclaredRangeTyping | undefined {
  if (declaredRange === undefined || declaredRange.length !== 1) {
    return undefined;
  }
  const local = xsdDatatypeLocalName(declaredRange[0].trim());
  if (local === null) return undefined;
  const numeric = xsdNumericFamily(local);
  if (numeric !== null) return numeric;
  if (local === "boolean") return "boolean";
  if (local === "string") return "string";
  return undefined;
}

/**
 * Is the value a COMPLETE, single double-quoted YAML scalar (`"…"`)?
 *
 * True for production-formed values like `"[[uid]]"` (wikilinks arrive
 * pre-wrapped) and `"My Workflow"` (DefaultWorkflows pre-wraps labels) — these
 * pass through verbatim. False for `"a" and "b"` (two quoted runs — has an
 * unescaped interior `"`) and `"\"` (the closing quote is escaped), which must
 * be re-quoted instead of emitted as invalid YAML. (#3750 MEDIUM-2.)
 */
export function isCompleteDoubleQuotedScalar(value: string): boolean {
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
 * Does the product's own reader hand this bare plain scalar back as something
 * other than a string? (ticket 8185c9dd) The oracle IS the reader: the value
 * is loaded in the same `key: value` position `parseYamlFrontmatterTolerant`
 * reads it from, under the same js-yaml 5.3.0 `YAML11_SCHEMA`. A `Date`, a
 * number, a boolean, `null` or a nested structure is "not a string"; so is a
 * value the reader refuses to parse at all (quoted, it will load).
 *
 * ⛔ Not a regex table: the previous oracle replicated js-yaml 4's 1.2-core
 * resolvers and MISSED every YAML 1.1-only form — the sexagesimal integer
 * (`10:30` → 630, `1:2:3` → 3723, `1:30.5` → 90.5), the 1.1 booleans
 * (`yes` / `no` / `on` / `off` / `y` / `n` in any case) and `+.5` (review
 * #4282 MEDIUM-1; differential fuzz 2026-09-20: 261 of 39 128 forms read
 * non-string yet were written bare). Delegating to `yaml.load` makes "what
 * the writer quotes" identical to "what the reader coerces" by construction.
 */
function yaml11ReaderCoercesToNonString(value: string): boolean {
  let loaded: unknown;
  try {
    loaded = yaml.load(`v: ${value}`, { schema: yaml.YAML11_SCHEMA });
  } catch {
    // Defensive (integration-test-revert-verify §A35): every form the reader
    // rejects in this position (`- x`, `::`, `10:`, a control character) is
    // already quoted by the guards `needsYamlQuoting` runs BEFORE this oracle;
    // a probe of 400 000 indicator-dense forms (probe-throw.cjs, 2026-09-20)
    // found none that passes them and throws here. Kept so a reader upgrade
    // that starts rejecting a new form fails towards quoting, never bare.
    return true;
  }
  // Defensive likewise: `v: <plain scalar>` always loads as a mapping.
  if (typeof loaded !== "object" || loaded === null) return true;
  return typeof (loaded as { v?: unknown }).v !== "string";
}

/**
 * Does ANY reader of this frontmatter coerce the bare plain scalar to a
 * non-string type? (#3750 MEDIUM-3, ticket 8185c9dd.) Two readers exist:
 * the product's `parseYamlFrontmatterTolerant` (js-yaml 5.3.0 `YAML11_SCHEMA`
 * — asked directly, {@link yaml11ReaderCoercesToNonString}) and Obsidian's
 * metadataCache (YAML 1.2 core — the {@link YAML_INT}… table). The union is
 * deliberate: quoting a string is lossless, so every form quoted before this
 * ticket stays quoted (`1e5`, `08`, `0o17` — strings to YAML 1.1, numbers to
 * 1.2-core) and every YAML 1.1-only form joins them.
 */
function looksLikeNonStringScalar(value: string): boolean {
  return (
    yaml11ReaderCoercesToNonString(value) ||
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
 *   survive as strings (#3750 MEDIUM-3). "Scalar-looking" = a form ANY reader
 *   of the file coerces to a non-string ({@link looksLikeNonStringScalar},
 *   ticket 8185c9dd) — including a datetime (`2026-01-15T10:00:00`, read as a
 *   `Date`): the #3750 "datetime stays bare" bound applied to TIMESTAMP
 *   properties, which never pass this flag, and was lifted for label/aliases
 *   (ticket 71f1ca37 п.2 → 8185c9dd; live datetime-shaped labels 0/0/0).
 *   Default false — number/bool/date-shaped values of OTHER properties keep
 *   their native YAML type.
 * @param declaredRange — the property's declared `exo__Property_range` values
 *   when the writer has them (ticket 2227d660; see {@link scalarTypingForRange}).
 *   A numeric range emits a canonical number BARE even with a leading `-`
 *   (and even when `quoteAmbiguousScalars` is true — the declaration wins
 *   over the property-name set); `xsd:boolean` emits `true`/`false` bare;
 *   `xsd:string` quotes a scalar-looking value the way the string-semantic
 *   set does, EXCEPT the canonical lowercase `true` / `false`: under a string
 *   range the converter already emits those as a plain string literal, so
 *   quoting would change only the YAML-level type that YAML readers see (233
 *   live bare lowercase booleans under `xsd:string` in `exoas-flow`, measured
 *   2026-09-19) for no graph gain. Every OTHER boolean spelling (`True`,
 *   `FALSE`, `yes`, `Off`, `n`, …) IS quoted (ticket 8185c9dd): the converter
 *   would fold it to `true` / `false` and the author's spelling would be lost.
 *   `undefined` (no range known) = the pre-ticket behaviour.
 */
export function needsYamlQuoting(
  value: string,
  quoteAmbiguousScalars = false,
  declaredRange?: readonly string[],
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

  // Ticket 2227d660 — the DECLARED range types a canonical scalar. Decided
  // BEFORE the shape checks below: a canonical negative (`-1001234567890`)
  // starts with the `-` indicator and would otherwise be quoted into an
  // `xsd:string` literal under an `xsd:integer` range. The integer family is
  // additionally gated to the safe-integer range: js-yaml reads a bare int as
  // a JS Number, and `12345678901234567890` comes back as 12345678901234567000
  // (measured on 5.3.0) — quoted, the digits at least survive on disk.
  const typing = scalarTypingForRange(declaredRange);
  if (
    typing === "integer" &&
    CANONICAL_INTEGER_LEXICAL.test(value) &&
    Number.isSafeInteger(Number(value))
  ) {
    return false;
  }
  if (typing === "decimal" && CANONICAL_DECIMAL_LEXICAL.test(value)) {
    return false;
  }
  if (typing === "boolean" && CANONICAL_BOOLEAN_LEXICAL.test(value)) {
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

  // Non-characters / lone surrogates: bare, the reader throws for the whole
  // frontmatter; quoted, they are `\uNNNN`-escaped (ticket 65ea50c4).
  if (YAML_NON_PRINTABLE_CHARS.test(value)) return true;

  // Scalar-looking strings coerced to non-string types by a real YAML parser
  // (#3750 MEDIUM-3) — quote so a semantically-string value round-trips. Gated
  // to string-semantic properties so timestamp/numeric properties keep their
  // native type (see {@link STRING_SCALAR_PROPERTIES}).
  if (quoteAmbiguousScalars && looksLikeNonStringScalar(value)) return true;

  // Ticket 2227d660 — a declared `xsd:string` range extends the string-semantic
  // rule to this property: a number / null / date-shaped value is quoted so
  // the converter tags it `xsd:string` (bare `42` is tagged `xsd:integer` and
  // violates the range). The canonical lowercase `true` / `false` are
  // deliberately left bare — see the `declaredRange` note in the JSDoc above;
  // `True` / `FALSE` / `yes` / `on` are quoted (ticket 8185c9dd — the converter
  // would fold them to `true` / `false`, losing the author's spelling).
  if (
    typing === "string" &&
    looksLikeNonStringScalar(value) &&
    !CANONICAL_YAML_BOOLEAN.test(value)
  ) {
    return true;
  }

  return false;
}

/**
 * Wrap a string in a YAML double-quoted scalar with proper escaping.
 *
 * Escapes `\` `"` `\n` `\r` `\t` and any other control character (`\xNN`) so
 * the quoted form is itself valid and js-yaml can load it (#3750 LOW-4). The
 * `\xNN` form covers C0 + DEL and the C1 range U+0080–U+009F (req 389d4e14):
 * js-yaml loads a raw C1 byte inside `"…"` too, but the escape keeps the
 * emitted text printable and the on-disk form explicit.
 *
 * The non-characters U+FFFE / U+FFFF and lone surrogate halves are emitted as
 * `\uNNNN` (ticket 65ea50c4): js-yaml rejects them raw in a plain or block
 * scalar but loads the raw unit inside `"…"` (like C1), so the quoting is what makes the
 * frontmatter readable and the escape keeps the emitted text printable — and,
 * for a lone half, survivable: a raw lone surrogate written as UTF-8 becomes
 * U+FFFD, the escape reads back as the same unit (the form js-yaml's own
 * `dump` emits). A valid surrogate pair is an ordinary printable character
 * and is emitted raw, never split into two escapes.
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
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      out += "\\x" + code.toString(16).toUpperCase().padStart(2, "0");
    } else if (code === 0xfffe || code === 0xffff) {
      out += "\\u" + code.toString(16).toUpperCase();
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      // Defensive: past the end `charCodeAt` is NaN and both range checks
      // below are false anyway; kept for readability, not reachability.
      i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      // Valid pair — the astral character is printable; keep both units raw.
      out += ch + value[i + 1];
      i++;
    } else if (code >= 0xd800 && code <= 0xdfff) {
      // Lone half (e.g. a truncated emoji) — `\uNNNN` round-trips it faithfully;
      // a raw UTF-8 file write would have turned it into U+FFFD instead.
      out += "\\u" + code.toString(16).toUpperCase();
    } else {
      out += ch;
    }
  }
  return `"${out}"`;
}

/**
 * Is the value a COMPLETE single-quoted YAML scalar (`'…'`)? Inside single
 * quotes the only escape is `''` (a literal `'`), so the run is complete when
 * every interior `'` is doubled.
 */
function isCompleteSingleQuotedScalar(value: string): boolean {
  if (value.length < 2 || !value.startsWith("'") || !value.endsWith("'")) {
    return false;
  }
  const inner = value.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "'") {
      if (inner[i + 1] !== "'") return false; // lone interior quote
      i++; // skip the doubled quote
    }
  }
  return true;
}

/**
 * Decode the RAW TEXT of a YAML scalar back to its string VALUE (ticket
 * 4f226028) — the read-side counterpart of {@link quoteYamlString}.
 *
 * `FrontmatterService.parseObject` is a textual reader: it hands callers the
 * scalar exactly as it sits on the line, quotes and escapes included. Every
 * consumer that turns such a raw value back into a scalar (`$target.<prop>`
 * substitution → `property_append` / `labelTemplate`, the append dedup) must
 * therefore DECODE it first; stripping only the outer quotes leaves the
 * interior escapes (`\"`, `\\`) in the text, and re-quoting that through
 * {@link quoteYamlString} double-escapes them.
 *
 * ⛤ The decode is the REAL parser, not a hand-rolled table: the text on disk is
 * written by several serialisers — `quoteYamlString` (`\\ \" \n \r \t \xNN`),
 * but also js-yaml `dump` on the object-path writers (`FileSystemVaultAdapter`,
 * `AtomicFrontmatterService`, Obsidian's `processFrontMatter`), which emits the
 * full YAML 1.2 §5.7 set (`\_` NBSP, `\N \L \P`, `\0 \a \b \e \f \v`,
 * `\UNNNNNNNN`, …). A table that knew only the first set silently turned
 * `"foo\_bar"` into `foo_bar` (PR #4250 review MEDIUM). Delegating to
 * `yaml.load` makes "what the decoder returns" identical to "what the parser
 * reads from that line" by construction.
 *
 * - complete double-quoted / single-quoted scalar → `yaml.load(raw)`.
 * - a quoted run js-yaml itself REJECTS (`"\q"`, `"\xZZ"`) → returned VERBATIM
 *   (byte-lossless: re-quoting it round-trips the text, nothing is invented).
 * - anything else (a plain scalar, an INCOMPLETE quoted run such as
 *   `"a" and "b"`) → returned verbatim — it IS the value.
 */
export function decodeYamlQuotedScalar(raw: string): string {
  if (
    !isCompleteDoubleQuotedScalar(raw) &&
    !isCompleteSingleQuotedScalar(raw)
  ) {
    return raw;
  }
  try {
    const loaded: unknown = yaml.load(raw);
    return typeof loaded === "string" ? loaded : raw;
  } catch {
    return raw;
  }
}

/**
 * Serialize a single scalar value for a YAML frontmatter line.
 *
 * - Non-strings (boolean, number) are emitted via `String()` unquoted so
 *   `archived: true` / `priority: 1` keep YAML-native types.
 * - Strings are emitted verbatim unless {@link needsYamlQuoting}, in which case
 *   they are double-quoted via {@link quoteYamlString}. `declaredRange` (the
 *   property's `exo__Property_range`, ticket 2227d660) is forwarded so a
 *   writer that knows the range types the scalar by it; a non-string value is
 *   already typed and is never affected by it.
 */
export function serializeYamlScalar(
  value: unknown,
  quoteAmbiguousScalars = false,
  declaredRange?: readonly string[],
): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return needsYamlQuoting(value, quoteAmbiguousScalars, declaredRange)
    ? quoteYamlString(value)
    : value;
}
