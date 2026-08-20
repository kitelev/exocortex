/**
 * Unwrap a frontmatter wikilink value into the linkpath a vault lookup expects:
 * quotes off, `[[ ]]` off, display alias off, trimmed.
 *
 * ⛔ The ALIAS strip is the part that matters. `[[<uid>|<label>]]` points at
 * `<uid>` exactly as `[[<uid>]]` does, but a lookup for `"<uid>|<label>"` never
 * resolves — so an aliased reference produced a SILENT non-match (req fedeaa6e
 * scenario 3). Both wikilink forms must resolve identically; that is the
 * dual-IRI floor.
 *
 * ⛤ This lives on its own because TWO surfaces unwrap the same authored value
 * and then hop through DIFFERENT adapters by construction — the display-name
 * engine through a `VaultMetadataPort`, `PropertiesDefinitionValuePatch`
 * through Obsidian's `metadataCache` (it deliberately does not depend on
 * `PrintNameRuleService`). The hop is legitimately theirs; the unwrap is not,
 * and letting each keep its own is how they drifted (issue #4041).
 *
 * ⚠ The `.md`-suffix retry stays with the caller's adapter: one of them retries
 * and the other's port promises to, so it is not part of this contract.
 */
export function unwrapLinkTarget(raw: string): string {
  const unwrapped = raw
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/^"|"$/g, "")
    .trim();
  const target = unwrapped.includes("|")
    ? (unwrapped.split("|")[0]?.trim() ?? "")
    : unwrapped;
  return target;
}
