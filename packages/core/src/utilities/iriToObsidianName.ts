import { Namespace } from "../domain/models/rdf/Namespace";

/**
 * Reverse-map an RDF IRI back to its Obsidian property-key / asset-name form.
 *
 * Two recognised IRI shapes (both produced by the forward RDF emission path):
 *
 *   1. Symbolic ontology term — `<namespace-base><local>` → `<prefix>__<local>`,
 *      resolved by {@link Namespace.fromTermIRI}, the shared inverse of the
 *      forward path (`Namespace.fromPropertyKey` → `Namespace.forPrefix`). This
 *      covers BOTH the ad-hoc `https://exocortex.my/ontology/<prefix>#` convention
 *      AND the registered external W3C vocabularies (`rdf`, `rdfs`, `owl`, `xsd`,
 *      `sh`), whose canonical bases are not derivable from the exocortex.my base.
 *      Issue #3274 — a prior hardcoded prefix whitelist silently dropped ad-hoc
 *      namespaces (`kitelev__`, `aiKnow__`, …); req `aceaa2cc-15b6-4e1c-bf63-72c7c209de51`
 *      — a hand-rolled exocortex.my regex here silently dropped the W3C ones.
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
  // Shape 1 — a term IRI in ANY registered namespace (exocortex.my ad-hoc AND the
  // external W3C vocabularies) via the shared inverse, so this direction cannot
  // drift from the forward emission path. Hand-rolling the exocortex.my regex
  // here is what made `rdfs__subClassOf` unreadable once the forward path started
  // emitting the canonical `http://www.w3.org/2000/01/rdf-schema#` base.
  const term = Namespace.fromTermIRI(iri);
  if (term) return `${term.namespace.prefix}__${term.localName}`;
  // Shape 2 — obsidian:// vault URLs (e.g. obsidian://vault/ems/ems__EffortStatusDoing.md)
  const obsMatch = iri.match(/\/([^/]+)\.md$/);
  if (obsMatch) return obsMatch[1];
  return null;
}
