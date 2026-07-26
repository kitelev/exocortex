import { DisplayNameTemplateEngine } from "@plugin/domain/display-name/DisplayNameTemplateEngine";

/**
 * ConceptDefinitionResolver — a THIN interpreter of a VAULT-DECLARED concept-definition
 * composition. The composition template ("<differentia> <genus>", order, separators) is NOT
 * hardcoded here — it is declared as vault data (a `concept__ConceptDefinitionSpec` + ordered
 * `exo__PrintedProperty`/`exo__PrintedLiteral` parts, loaded by ConceptDefinitionSpecService and
 * compiled to a `DisplayNameTemplateEngine` template). This resolver only:
 *   1. applies the materialized-OR-computed + fail-closed CONTRACT (the Q3 interpreter rule), and
 *   2. renders the vault template via DisplayNameTemplateEngine (the reused homoiconic engine).
 * Delta-2 of concept-typization (req eb18a3a4), the analog of DisplayNameResolver over
 * exo__DisplayNameSpec — here targeting the `concept__Concept_definition` VALUE, not the title.
 *
 * Semantics (materialized-OR-computed, fail-closed):
 *  - genus PRESENT (resolves to ≥1 clean label) → the definition is COMPUTED by rendering the
 *    vault template (each genus/differentia `[[uid]]` resolved 1-hop to its exo__Asset_label; a
 *    multi-valued differentia joins all adjectives via the engine's opt-in joinArrayValues).
 *  - genus ABSENT / resolves only to a bare UID → the definition is NOT computed → the caller
 *    falls through to the STORED free-text `concept__Concept_definition` (materialized narrative).
 *  - no vault template (spec not authored) → not computed → stored fallback.
 *  - FAIL-CLOSED: never fabricate a definition from a raw UID or over a good stored narrative.
 *
 * Pure domain unit — the 1-hop label resolution is delegated to an injected MetadataResolver.
 */

/** Resolve a wikilink target to the referenced asset's frontmatter (or null). */
export type MetadataResolver = (wikilinkTarget: string) => Record<string, unknown> | null;

// Frontmatter keys of the Delta-1 concept-typization TBox.
const GENUS_KEY = "concept__Concept_genus";
const DEFINITION_KEY = "concept__Concept_definition";

// A UID-shaped value is NOT a usable definition token — a genus that resolves ONLY to a raw UID
// (target deleted/renamed, or metadataCache lag) must fail closed (fall through to the stored
// narrative), never render the 36-char UID over a good stored definition.
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class ConceptDefinitionResolver {
  constructor(private readonly metadataResolver?: MetadataResolver | null) {}

  /**
   * The effective definition (materialized-OR-computed, fail-closed):
   *  - genus present + a vault template → the COMPUTED phrase;
   *  - else → the STORED free-text; else → null.
   * `template` is the vault-declared composition template (from ConceptDefinitionSpecService), or
   * null when no spec is authored.
   */
  resolve(metadata: Record<string, unknown>, template: string | null): string | null {
    return this.resolveComputed(metadata, template) ?? this.storedDefinition(metadata[DEFINITION_KEY]);
  }

  /**
   * The COMPUTED definition rendered from the VAULT-DECLARED template, or null when the definition
   * should fall through to the stored narrative (no template, no genus, or genus resolves only to
   * a bare UID). The Properties-panel value patch uses this: it OVERRIDES the native definition
   * row ONLY when a computed value exists, leaving the stored free-text untouched otherwise.
   */
  resolveComputed(metadata: Record<string, unknown>, template: string | null): string | null {
    if (!template) return null; // no vault spec authored → materialized (stored) path
    // Fail-closed gate: genus must resolve to ≥1 clean label (absent / only-bare-UID → stored).
    if (this.resolveWikilinkLabels(metadata[GENUS_KEY]).length === 0) return null;

    // Render the vault-declared composition template (order/parts/separators = vault data). The
    // engine resolves each {{property}} 1-hop; joinArrayValues renders a multi-valued differentia
    // as all adjectives joined (dropping bare-UID values), while leaving the displayName path
    // (default first-only) unchanged.
    const rendered = new DisplayNameTemplateEngine(template, { joinArrayValues: true }).render(
      metadata,
      "",
      undefined,
      this.metadataResolver ?? undefined,
    );
    return rendered && rendered.trim() ? rendered : null;
  }

  /** A stored free-text definition, trimmed non-empty, else null (fail-closed). */
  private storedDefinition(value: unknown): string | null {
    let raw = value;
    if (Array.isArray(raw)) raw = raw.length > 0 ? raw[0] : undefined;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Resolve a genus field (a single wikilink OR an array) into the referenced assets'
   * exo__Asset_label — dropping any value that resolves only to a bare UID. Used ONLY for the
   * fail-closed gate (whether genus is meaningfully present); the composition itself is rendered
   * by the engine from the vault template.
   */
  private resolveWikilinkLabels(value: unknown): string[] {
    const raw = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : [value];
    const labels: string[] = [];
    for (const item of raw) {
      const label = this.resolveWikilinkLabel(item);
      if (label) labels.push(label);
    }
    return labels;
  }

  /**
   * Resolve one wikilink value to a display label (mirrors
   * DisplayNameTemplateEngine.formatWikilinkValue, plus a FAIL-CLOSED guard):
   *  - "[[target|alias]]"        → alias
   *  - "[[target]]" + resolver   → the referenced asset's exo__Asset_label
   *  - "[[<uid>]]" with no label  → null (FAIL-CLOSED — a raw UID is never a definition token)
   *  - "[[target]]" non-UID bare  → target (a symbolic label, kept)
   *  - a non-wikilink string     → the string itself (a literal label; a bare UID → null)
   */
  private resolveWikilinkLabel(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
    if (!match) {
      const bare = trimmed.replace(/^\[\[|\]\]$/g, "").trim();
      if (!bare) return null;
      return UUID_REGEX.test(bare) ? null : bare;
    }

    const target = match[1].trim();
    const alias = match[2]?.trim();
    if (alias) return alias;

    if (this.metadataResolver) {
      const resolved = this.metadataResolver(trimmed);
      const label = resolved?.exo__Asset_label;
      if (typeof label === "string" && label.trim()) return label.trim();
    }

    if (!target) return null;
    return UUID_REGEX.test(target) ? null : target;
  }
}
