import { IRI } from "../domain/models/rdf/IRI";
import { Literal } from "../domain/models/rdf/Literal";
import { BlankNode } from "../domain/models/rdf/BlankNode";
import { Triple, Subject, Object as RDFObject } from "../domain/models/rdf/Triple";

/**
 * Synth-A IRI form: `obsidian://vault/<uuid>.md` with NO subdirectory segment.
 *
 * Emitted by `NoteToRDFConverter.synthesizeWikilinkTargetIRI` (Issue #3219)
 * when an `--also`-loaded vault's converter encounters a UUID-form wikilink
 * whose target file is not present in that vault. The synthesized IRI is the
 * bare basename, missing the canonical `assetspaces/<sub>/` path prefix that
 * the target's owning vault uses for the same file.
 *
 * Detection is strict: exactly the `obsidian://vault/` scheme + UUID + `.md`,
 * nothing in between. Full-path IRIs like
 *   `obsidian://vault/assetspaces/shared-identities/<uuid>.md`
 * intentionally do NOT match.
 */
const SYNTH_A_IRI_PATTERN =
  /^obsidian:\/\/vault\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.md$/i;

export interface CanonicalizationResult {
  /** Triple set with synth-A IRIs remapped to canonical full-path IRIs. */
  triples: Triple[];
  /** Number of triples mutated (each remap counted once per triple). */
  remapCount: number;
  /** Number of distinct synth-A IRIs that found a canonical mapping. */
  uniqueRemapCount: number;
}

/**
 * Issue #3286 — post-load IRI canonicalization for cross-vault RDF stores.
 *
 * In a multi-vault load (`--also`-style federation), the same logical UID can
 * surface in two distinct IRI forms:
 *   - Full-path: `obsidian://vault/assetspaces/<sub>/<uuid>.md` — emitted by
 *     the vault that owns the file.
 *   - Synth-A:   `obsidian://vault/<uuid>.md` — emitted by a sibling vault's
 *     converter as a guess when the target couldn't be resolved locally.
 *
 * JOINs across the two forms silently miss, breaking prototype-chain
 * materialization and DISTINCT counts. This canonicalizer remaps every
 * synth-A occurrence to the canonical form whenever the UID can be found in
 * the supplied file index.
 *
 * Scope discipline:
 *   - **Only `IRI` nodes are remapped.** `Literal` (bare-UUID dual-storage
 *     emission from Issue #3353) and `BlankNode` pass through untouched.
 *   - **Predicates are never remapped** — they are namespace IRIs, not file
 *     references.
 *   - **No mutation of source `.md` files.** Operates on an in-memory
 *     `Triple[]` snapshot only.
 *   - **No-op when the UID has no canonical entry** — graceful degradation,
 *     preserves original IRIs.
 */
export class IRICanonicalizer {
  /** Exposed for tests + callers that need to detect synth-A form directly. */
  static readonly SYNTH_A_IRI_PATTERN = SYNTH_A_IRI_PATTERN;

  /**
   * Extracts the lowercased UUID from a synth-A IRI, or returns null if the
   * IRI is not in synth-A form.
   */
  static extractSynthAUid(iriValue: string): string | null {
    const match = SYNTH_A_IRI_PATTERN.exec(iriValue);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Returns a new triple array where every synth-A IRI occurrence (subject
   * or object) is replaced with its canonical full-path IRI when the
   * lookup map yields a hit.
   *
   * @param triples Input triples — not mutated; a new array is returned.
   * @param uidToCanonicalIRI Lookup map: lowercased UUID → canonical IRI
   *   string. Caller is responsible for building this with primary-first
   *   precedence (first vault that owns the UID wins).
   */
  static canonicalize(
    triples: Triple[],
    uidToCanonicalIRI: ReadonlyMap<string, string>,
  ): CanonicalizationResult {
    if (uidToCanonicalIRI.size === 0) {
      return { triples, remapCount: 0, uniqueRemapCount: 0 };
    }

    // Memoize new IRI instances per canonical value so we don't allocate
    // a fresh IRI for every triple that points at the same target.
    const irisByCanonical = new Map<string, IRI>();
    const remappedUids = new Set<string>();
    let remapCount = 0;

    const remapped = triples.map((triple) => {
      const newSubject = IRICanonicalizer.remapIfSynthA(
        triple.subject,
        uidToCanonicalIRI,
        irisByCanonical,
        remappedUids,
      );
      const newObject = IRICanonicalizer.remapIfSynthA(
        triple.object,
        uidToCanonicalIRI,
        irisByCanonical,
        remappedUids,
      );

      if (newSubject === triple.subject && newObject === triple.object) {
        return triple;
      }

      remapCount++;
      return new Triple(
        newSubject as Subject,
        triple.predicate,
        newObject as RDFObject,
      );
    });

    return {
      triples: remapped,
      remapCount,
      uniqueRemapCount: remappedUids.size,
    };
  }

  /**
   * Returns either the original node (passes IRI/Literal/BlankNode through
   * unchanged when no remap applies) or a new IRI when the node is synth-A
   * and the UID is in the lookup map.
   */
  private static remapIfSynthA(
    node: Subject | RDFObject,
    uidMap: ReadonlyMap<string, string>,
    cache: Map<string, IRI>,
    remappedUids: Set<string>,
  ): Subject | RDFObject {
    // Literals: bare-UUID dual-storage form lives here. Never remap — they
    // are not IRIs and serve as a separate join key for #3353.
    if (node instanceof Literal) return node;
    // BlankNodes: no file reference. Pass through.
    if (node instanceof BlankNode) return node;
    // QuotedTriple / other: pass through. We only canonicalize IRI atoms.
    if (!(node instanceof IRI)) return node;

    const match = SYNTH_A_IRI_PATTERN.exec(node.value);
    if (!match) return node;

    const uid = match[1].toLowerCase();
    const canonical = uidMap.get(uid);
    if (!canonical || canonical === node.value) {
      return node;
    }

    remappedUids.add(uid);
    let cached = cache.get(canonical);
    if (!cached) {
      cached = new IRI(canonical);
      cache.set(canonical, cached);
    }
    return cached;
  }
}
