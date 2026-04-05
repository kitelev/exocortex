import { ITripleStore } from "../interfaces/ITripleStore";
import { Triple, type Subject } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";
import { NonInheritablePropertyRegistry } from "./NonInheritablePropertyRegistry";

/**
 * Named graph IRI for materialized (inherited) triples.
 * Used to distinguish own vs inherited properties in Phase 6 (ExoQL OWN()).
 */
export const INFERRED_GRAPH = new IRI("https://exocortex.my/ontology/exo#inferred");

/**
 * Single-hop prototype chain materializer.
 *
 * For each instance with an exo__Asset_prototype link, copies all inheritable
 * properties from the prototype that the instance doesn't already own.
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
   * Materialize inherited properties from prototypes into instances.
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

    // Find all instance → prototype links
    const prototypeTriples = await store.match(
      undefined,
      prototypePredicate,
      undefined,
    );

    if (prototypeTriples.length === 0) {
      return 0;
    }

    // Build map: instance → prototype (single-hop only)
    // Cycle detection: skip if instance equals prototype
    const instanceToPrototype = new Map<string, { instance: Subject; prototype: Subject }>();
    for (const triple of prototypeTriples) {
      if (triple.subject instanceof IRI && triple.object instanceof IRI) {
        const instanceIRI = triple.subject.value;
        const prototypeIRI = triple.object.value;

        // Cycle detection
        if (instanceIRI === prototypeIRI) {
          continue;
        }

        instanceToPrototype.set(instanceIRI, {
          instance: triple.subject,
          prototype: triple.object as IRI,
        });
      }
    }

    if (instanceToPrototype.size === 0) {
      return 0;
    }

    let materializedCount = 0;

    for (const { instance, prototype } of instanceToPrototype.values()) {
      // Get all triples of the prototype
      const prototypeTriples = await store.match(prototype, undefined, undefined);

      if (prototypeTriples.length === 0) {
        continue;
      }

      // Get predicates the instance already owns
      const ownTriples = await store.match(instance, undefined, undefined);
      const ownPredicates = new Set<string>();
      for (const t of ownTriples) {
        ownPredicates.add(t.predicate.value);
      }

      // Materialize inheritable properties
      for (const protoTriple of prototypeTriples) {
        const predicateIRI = protoTriple.predicate.value;

        // Skip non-inheritable properties
        if (this.registry.isNonInheritable(predicateIRI)) {
          continue;
        }

        // Skip if instance already has this property (own takes priority)
        if (ownPredicates.has(predicateIRI)) {
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

        materializedCount++;
      }
    }

    return materializedCount;
  }
}
