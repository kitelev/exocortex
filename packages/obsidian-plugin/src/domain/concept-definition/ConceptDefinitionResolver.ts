/**
 * ConceptDefinitionResolver — a concept's `concept__Concept_definition` as a homoiconic
 * COMPUTED VIEW from its intensional structure (genus + differentia), the analog of
 * DisplayNameResolver over exo__DisplayNameSpec (Delta-2 of concept-typization,
 * req eb18a3a4). Aristotelian transparency: you declare `concept__Concept_genus` +
 * `concept__Concept_differentia` and the definition renders — you never hand-write it
 * (where a clean genus exists).
 *
 * Semantics — MATERIALIZED-OR-COMPUTED (RFC b860de33 revision F1; ~70% of stored
 * definitions carry non-reconstructible narrative and must be preserved):
 *  - genus PRESENT  → COMPUTED "<differentia labels joined by space> <genus label>"
 *      (differentia in authored order, then the genus). Each genus/differentia value is
 *      an ObjectProperty `[[uid]]` wikilink resolved 1-hop to its exo__Asset_label — the
 *      SAME resolution exo__PrintedProperty uses (see DisplayNameTemplateEngine
 *      .formatWikilinkValue). The rare conjunctive upper-ontology genus (≥2 genus values)
 *      renders "<differentia> [genus₁ ∧ genus₂]".
 *  - genus ABSENT   → the STORED free-text `concept__Concept_definition` is returned
 *      unchanged (materialized narrative).
 *  - FAIL-CLOSED    → genus absent AND no stored free-text → null. A definition is never
 *      fabricated.
 *
 * Pure domain unit — no Obsidian dependency. The 1-hop label resolution is delegated to
 * an injected MetadataResolver (wikilink target → its frontmatter), exactly as
 * DisplayNameResolver receives one from PrintNameRuleService.createMetadataResolver().
 */

/** Resolve a wikilink target to the referenced asset's frontmatter (or null). */
export type MetadataResolver = (wikilinkTarget: string) => Record<string, unknown> | null;

// Frontmatter keys of the Delta-1 concept-typization TBox properties.
const GENUS_KEY = "concept__Concept_genus";
const DIFFERENTIA_KEY = "concept__Concept_differentia";
const DEFINITION_KEY = "concept__Concept_definition";

// Conjunction glyph for the rare multi-genus (upper-ontology) case: "<diff> [g₁ ∧ g₂]".
const CONJUNCTION = " ∧ ";

// A UID-shaped value is NOT a usable definition token — a genus/differentia that resolves ONLY
// to a raw UID (target deleted/renamed, or metadataCache lag) must fail closed (fall through to
// the stored narrative), never render the 36-char UID over a good stored definition.
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class ConceptDefinitionResolver {
  constructor(private readonly metadataResolver?: MetadataResolver | null) {}

  /**
   * The effective definition (materialized-OR-computed, fail-closed):
   *  - genus present → the COMPUTED phrase; genus absent → the STORED free-text; neither → null.
   * Callers that want the definition to display (materialized case included) use this.
   */
  resolve(metadata: Record<string, unknown>): string | null {
    return this.resolveComputed(metadata) ?? this.storedDefinition(metadata[DEFINITION_KEY]);
  }

  /**
   * The COMPUTED "<differentia> <genus>" phrase, or null when genus is absent (so a caller
   * can distinguish "computed" from "stored/materialized"). The Properties-panel value patch
   * uses this: it OVERRIDES the native definition row ONLY when a computed value exists,
   * leaving the stored free-text row untouched when genus is absent.
   */
  resolveComputed(metadata: Record<string, unknown>): string | null {
    const genusLabels = this.resolveWikilinkLabels(metadata[GENUS_KEY]);
    if (genusLabels.length === 0) return null;
    const differentiaLabels = this.resolveWikilinkLabels(metadata[DIFFERENTIA_KEY]);
    return this.compose(differentiaLabels, genusLabels);
  }

  /**
   * Compose "<differentia labels> <genus part>". The genus part is the single genus label,
   * or — for the rare conjunctive upper-ontology genus — "[g₁ ∧ g₂ …]". Differentia labels
   * (already in authored order) join as space-separated adjectives BEFORE the genus, so
   * differentia=[recurring, quarterly] + genus=OKR → "recurring quarterly OKR".
   */
  private compose(differentiaLabels: string[], genusLabels: string[]): string {
    const genusPart =
      genusLabels.length >= 2
        ? `[${genusLabels.join(CONJUNCTION)}]`
        : genusLabels[0];
    const differentiaPart = differentiaLabels.join(" ");
    return differentiaPart ? `${differentiaPart} ${genusPart}` : genusPart;
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
   * Resolve a genus/differentia field (a single wikilink OR an array of wikilinks) into an
   * ordered list of the referenced assets' exo__Asset_label — dropping any value that
   * yields no label. The 1-hop resolution mirrors exo__PrintedProperty.
   */
  private resolveWikilinkLabels(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
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
   *  - "[[<uid>]]" with no label  → null (FAIL-CLOSED — a raw UID is never a definition token,
   *                                 so resolveComputed falls through to the stored narrative)
   *  - "[[target]]" non-UID bare  → target (a symbolic label, kept)
   *  - a non-wikilink string     → the string itself (a literal label; a bare UID → null)
   */
  private resolveWikilinkLabel(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
    if (!match) {
      // Not a wikilink — a literal label. A bare UID is not a usable token (fail-closed).
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

    // No alias, no resolvable label: a bare UID fails closed (null → fall through to stored);
    // a non-UID symbolic target is kept as its own label.
    if (!target) return null;
    return UUID_REGEX.test(target) ? null : target;
  }
}
