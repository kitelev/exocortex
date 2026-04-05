import { ITripleStore } from "../interfaces/ITripleStore";
import { Triple } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { NonInheritablePropertyRegistry } from "./NonInheritablePropertyRegistry";

/**
 * Named graph IRI for materialized (inherited) triples.
 * Used to distinguish own vs inherited properties in Phase 6 (ExoQL OWN()).
 */
export const INFERRED_GRAPH = new IRI("https://exocortex.my/ontology/exo#inferred");

/**
 * Maximum depth for prototype chain traversal.
 * Protects against unbounded chains and excessive memory usage.
 */
export const MAX_PROTOTYPE_DEPTH = 10;

/**
 * Multi-hop prototype chain materializer.
 *
 * For each instance with an exo__Asset_prototype link, resolves the full
 * prototype chain via BFS traversal (up to MAX_PROTOTYPE_DEPTH) and copies
 * all inheritable properties that the instance doesn't already own.
 *
 * Closest prototype wins: if proto1 and proto2 both define `area`,
 * the value from proto1 (nearer) is used.
 *
 * Materialized triples are added to both the default graph (for match() visibility)
 * and the `exo:inferred` named graph (for own/inherited distinction).
 *
 * Follows the RDFSInferenceEngine pattern: post-index pass over the triple store.
 */
export class PrototypeChainMaterializer {
  private readonly registry: NonInheritablePropertyRegistry;

  constructor(registry: NonInheritablePropertyRegistry) {
    this.registry = registry;
  }

  /**
   * Materialize inherited properties from the full prototype chain into instances.
   *
   * @param store - The triple store to read from and write materialized triples into
   * @returns Number of new materialized triples added
   */
  async materialize(store: ITripleStore): Promise<number> {
    const allPredicates = await store.predicates();

    // Find the prototype predicate (exo:Asset_prototype)
    const prototypePredicate = allPredicates.find((p) =>
      p.value.includes("Asset_prototype"),
    );

    if (!prototypePredicate) {
      return 0;
    }

    // Find all subject → prototype links
    const prototypeTriples = await store.match(
      undefined,
      prototypePredicate,
      undefined,
    );

    if (prototypeTriples.length === 0) {
      return 0;
    }

    // Build prototype graph: subject IRI string → prototype IRI
    // Self-cycle detection: skip if subject equals prototype
    const protoGraph = new Map<string, IRI>();
    for (const triple of prototypeTriples) {
      if (triple.subject instanceof IRI && triple.object instanceof IRI) {
        const subjectIRI = triple.subject.value;
        const prototypeIRI = triple.object.value;

        if (subjectIRI !== prototypeIRI) {
          protoGraph.set(subjectIRI, triple.object as IRI);
        }
      }
    }

    if (protoGraph.size === 0) {
      return 0;
    }

    let materializedCount = 0;

    for (const [instanceIRI] of protoGraph) {
      const instance = new IRI(instanceIRI);

      // Resolve full prototype chain via BFS: [proto1, proto2, ..., protoN] near→far
      const chain = this.resolveChain(instanceIRI, protoGraph);

      if (chain.length === 0) {
        continue;
      }

      // Get predicates the instance already owns
      const ownTriples = await store.match(instance, undefined, undefined);
      const seenPredicates = new Set<string>();
      for (const t of ownTriples) {
        seenPredicates.add(t.predicate.value);
      }

      // Walk chain near→far: closest prototype wins
      for (const protoIRIStr of chain) {
        const proto = new IRI(protoIRIStr);
        const protoTriples = await store.match(proto, undefined, undefined);

        for (const protoTriple of protoTriples) {
          const predicateValue = protoTriple.predicate.value;

          // Skip non-inheritable properties
          if (this.registry.isNonInheritable(predicateValue)) {
            continue;
          }

          // Skip if already seen (own or from closer prototype)
          if (seenPredicates.has(predicateValue)) {
            continue;
          }

          // Materialize: create triple with instance as subject
          const materializedTriple = new Triple(
            instance,
            protoTriple.predicate,
            protoTriple.object,
          );

          // Add to default graph (for match() visibility)
          await store.add(materializedTriple);

          // Add to named graph (for own/inherited distinction)
          if (store.addToGraph) {
            await store.addToGraph(materializedTriple, INFERRED_GRAPH);
          }

          seenPredicates.add(predicateValue);
          materializedCount++;
        }
      }
    }

    return materializedCount;
  }

  /**
   * BFS traversal to resolve the full prototype chain for a given instance.
   * Returns ordered array of prototype IRIs from nearest to farthest.
   *
   * Uses a BFS queue with visited set for cycle detection and
   * MAX_PROTOTYPE_DEPTH limit to prevent unbounded traversal.
   *
   * @param instanceIRI - Starting instance IRI string
   * @param protoGraph - Map of subject IRI string → prototype IRI
   * @returns Array of prototype IRI strings, ordered near→far
   */
  private resolveChain(
    instanceIRI: string,
    protoGraph: Map<string, IRI>,
  ): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    visited.add(instanceIRI);

    const queue: string[] = [];
    const directProto = protoGraph.get(instanceIRI);
    if (directProto) {
      queue.push(directProto.value);
    }

    while (queue.length > 0 && chain.length < MAX_PROTOTYPE_DEPTH) {
      const current = queue.shift();
      if (current === undefined) break;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);
      chain.push(current);

      const nextProto = protoGraph.get(current);
      if (nextProto && !visited.has(nextProto.value)) {
        queue.push(nextProto.value);
      }
    }

    return chain;
  }
}
