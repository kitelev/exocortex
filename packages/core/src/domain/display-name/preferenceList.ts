/**
 * The shape a multi-value `exo__PrintedProperty_property` compiles to.
 *
 * A multi-value property is an ORDERED PREFERENCE LIST, not a set: "print the
 * first of these that has a value". It is compiled into the placeholder as
 * `a|b|c`, and `DisplayNameTemplateEngine.resolveValue` walks the candidates in
 * order and returns the first non-empty render.
 *
 * ⛤ This lives on its own because TWO subsystems compile that predicate and
 * they resolve a single reference DIFFERENTLY by construction — the display-name
 * engine hops through a `VaultMetadataPort`, `ConceptDefinitionSpecService` hops
 * through Obsidian's `metadataCache`. What they must NOT disagree about is what
 * multiplicity MEANS, and that is exactly this function: one predicate, one
 * semantics (issue #4050). Sharing the per-reference resolution instead would
 * have to pick one of the two adapters and is not what diverged.
 *
 * WHY a list and not N parts: N parts would print EVERY candidate that is set —
 * an effort carrying both an end and a start timestamp would render both dates —
 * which is a concatenation, not a preference.
 *
 * @param value the raw frontmatter value
 * @param resolveOne resolves ONE reference to its frontmatter key (caller's adapter)
 */
export function resolvePreferenceList(
  value: unknown,
  resolveOne: (raw: unknown) => string | null,
): string | null {
  if (Array.isArray(value) && value.length > 1) {
    const keys = value
      .map((v) => resolveOne(v))
      .filter((k): k is string => k !== null && k.length > 0);
    return keys.length > 0 ? keys.join("|") : null;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return resolveOne(value[0]);
  }
  return resolveOne(value);
}
