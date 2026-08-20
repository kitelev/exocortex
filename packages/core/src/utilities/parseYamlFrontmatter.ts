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
/**
 * Keys that YAML may resolve to something other than a string.
 *
 * Cheap pre-filter for a hot path: `parseYamlFrontmatterTolerant` runs on every
 * asset read, and re-parsing all ~260k keys of a real vault would be absurd. A
 * key only needs the exact check when it LOOKS like a non-string scalar —
 * empty, a null/bool literal, or numeric-ish. Everything else (a property name
 * like `exo__Asset_uid`) is a string by construction and skips the parse.
 */
const AMBIGUOUS_KEY_RE =
  /^(?:|~|null|true|false|y|n|yes|no|on|off|[+-]?[\d.][\d._eE+-]*|0[xXbBoO][\dA-Fa-f_]+)$/i;

/**
 * True when every top-level key came from a STRING scalar.
 *
 * ⛔ js-yaml 5 relaxed the parser: `  : : :` THREW in js-yaml 4 (verified on
 * 4.1.1: "incomplete explicit mapping pair") and in 5 parses to
 * `{ null: { null: { null: null } } }` under EVERY schema — CORE, YAML11 and the
 * default alike. So this is a strictness change, not a schema one, and no load
 * option restores the old behaviour (`LoadOptions` in 5.3.0 offers only
 * filename, maxDepth, source, schema, json, maxTotalMergeKeys, maxAliases).
 *
 * Frontmatter keys are property names — always strings. A key that YAML itself
 * resolves to null/bool/number therefore did not come from a property name, and
 * the block is malformed, which is exactly what js-yaml 4 said by throwing.
 *
 * ⛤ Measured before choosing this predicate, because it could in principle
 * reject a legitimate key (`on`, `y` and `12` are non-strings in YAML 1.1):
 * across vault-exodev + vault-my — 26,572 files, 260,914 top-level keys — the
 * count of keys resolving to a non-string is ZERO. The predicate costs nothing
 * real and rejects nothing real.
 */
function keysAreStrings(
  parsed: Record<string, unknown>,
  schema: unknown,
): boolean {
  for (const key of Object.keys(parsed)) {
    if (!AMBIGUOUS_KEY_RE.test(key)) continue;
    let resolved: unknown;
    try {
      resolved = yaml.load(key, { schema } as Parameters<typeof yaml.load>[1]);
    } catch {
      return false; // a key that will not parse at all is not a property name
    }
    if (typeof resolved !== "string") return false;
  }
  return true;
}

export function parseYamlFrontmatterTolerant(
  yamlBlock: string,
  context?: string,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlBlock, { schema: yaml.YAML11_SCHEMA });
  } catch (strictError) {
    try {
      // JSON-compat mode: duplicate keys resolve last-wins instead of throwing.
      parsed = yaml.load(yamlBlock, { json: true, schema: yaml.YAML11_SCHEMA });
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const mapping = parsed as Record<string, unknown>;
  // js-yaml 5 accepts input js-yaml 4 rejected (see keysAreStrings). A block
  // whose keys are not property names is malformed; returning null keeps the
  // caller's historical `{}` rather than handing it `{ null: { null: … } }`.
  return keysAreStrings(mapping, yaml.YAML11_SCHEMA) ? mapping : null;
}
