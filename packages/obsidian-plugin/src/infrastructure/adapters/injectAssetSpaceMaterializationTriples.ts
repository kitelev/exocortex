import {
  DomainIRI as IRI,
  DomainLiteral as Literal,
  DomainTriple as Triple,
  Namespace,
  vaultPathToIRI,
  type ITripleStore,
} from "exocortex";

import type { AssetSpaceMaterializationStatus } from "./AssetSpaceMaterializationTracker";

/** `exo:AssetSpace_materialized` — RFC 22b50a17 Phase 4 (Vision Lock #12). */
export const ASSET_SPACE_MATERIALIZED_PREDICATE: IRI = Namespace.EXO.term(
  "AssetSpace_materialized",
);

/** `xsd:boolean` datatype for the materialization flag triples. */
export const XSD_BOOLEAN_DATATYPE: IRI = Namespace.XSD.term("boolean");

/**
 * Inject runtime-derived `<as-iri> exo:AssetSpace_materialized "true|false"^^xsd:boolean`
 * triples into the live triple store.
 *
 * Called after `sparql.refresh()` resolves — the refresh clears+rebuilds the
 * store from frontmatter alone, so derived triples must be re-added on every
 * cycle. The walk is small (typically ~13 AS).
 *
 * Best-effort: failure to add a single triple does not abort the loop.
 * Errors are swallowed so vault-wide query latency cannot regress on a
 * partial-corrupt store; missing triples manifest as «available» status
 * in SPARQL, which is the fail-closed default.
 */
export async function injectAssetSpaceMaterializationTriples(
  store: ITripleStore,
  statuses: ReadonlyArray<AssetSpaceMaterializationStatus>,
): Promise<void> {
  for (const s of statuses) {
    try {
      const subjectIri = new IRI(vaultPathToIRI(s.asFilePath));
      const object = new Literal(
        s.materialized ? "true" : "false",
        XSD_BOOLEAN_DATATYPE,
      );
      await store.add(
        new Triple(subjectIri, ASSET_SPACE_MATERIALIZED_PREDICATE, object),
      );
    } catch {
      // Best-effort: per-AS failure should not block the rest.
    }
  }
}
