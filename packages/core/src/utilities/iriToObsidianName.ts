/**
 * Reverse-map an RDF IRI back to its Obsidian property-key / asset-name form.
 *
 * Two recognised IRI shapes (both produced by the forward RDF emission path):
 *
 *   1. Symbolic ontology term —
 *      `https://exocortex.my/ontology/<prefix>#<local>` → `<prefix>__<local>`.
 *      Mirrors the forward path (`Namespace.fromPropertyKey` →
 *      `Namespace.forPrefix`), which auto-extends to ad-hoc namespaces under
 *      the same base. Issue #3274 — a prior hardcoded prefix whitelist silently
 *      dropped ad-hoc namespaces (`kitelev__`, `aiKnow__`, …).
 *
 *   2. Vault file URL — `obsidian://vault/<path>/<basename>.md` (or any path
 *      ending in `/<basename>.md`) → `<basename>` (a UID-canon basename or a
 *      whitelisted symbolic name such as `YYYY-MM-DD`).
 *
 * Returns `null` when the IRI matches neither shape (caller decides the
 * fallback — typically the raw IRI value).
 *
 * RFC 78c2b7d0 C4 — extracted verbatim from `CommandResolver.iriToObsidianName`
 * (was a private method) so the read-side `NamedQueryRunner` can convert SELECT
 * IRI bindings to wikilink-ready names without duplicating the regex. The
 * resolver now delegates to this single source of truth.
 */
export function iriToObsidianName(iri: string): string | null {
  const baseMatch = iri.match(
    /^https:\/\/exocortex\.my\/ontology\/([a-z][a-zA-Z0-9]*)#([^#]+)$/,
  );
  if (baseMatch) {
    const [, prefix, local] = baseMatch;
    return `${prefix}__${local}`;
  }
  // Handle obsidian:// vault URLs (e.g., obsidian://vault/ems/ems__EffortStatusDoing.md)
  const obsMatch = iri.match(/\/([^/]+)\.md$/);
  if (obsMatch) return obsMatch[1];
  return null;
}
