import { ITripleStore } from "../../interfaces/ITripleStore";
import { Triple, type Predicate } from "../../domain/models/rdf/Triple";
import { IRI } from "../../domain/models/rdf/IRI";

/**
 * RDFS inference engine that materializes inferred Instance_class triples
 * based on Class_superClass hierarchy (transitive closure).
 *
 * Given:
 *   FleetingNote  Class_superClass  Note
 *   Note          Class_superClass  Asset
 *   myNote        Instance_class    FleetingNote
 *
 * Materializes:
 *   myNote        Instance_class    Note       (inferred)
 *   myNote        Instance_class    Asset      (inferred)
 */
export class RDFSInferenceEngine {
  /**
   * Materialize inferred Instance_class triples into the store.
   *
   * 1. Finds all Class_superClass triples to build class hierarchy
   * 2. Computes transitive closure (with cycle detection)
   * 3. For each Instance_class triple, adds inferred triples for all ancestors
   *
   * @param store - The triple store to read from and write inferred triples into
   * @returns Number of new inferred triples added (excludes duplicates)
   */
  async materialize(store: ITripleStore): Promise<number> {
    const allPredicates = await store.predicates();

    const superClassPredicate = allPredicates.find((p) =>
      p.value.includes("Class_superClass"),
    );
    const instanceClassPredicate = allPredicates.find((p) =>
      p.value.includes("Instance_class"),
    );

    if (!superClassPredicate || !instanceClassPredicate) {
      return 0;
    }

    // Build direct parent map from Class_superClass triples
    const directParents = await this.buildDirectParentMap(
      store,
      superClassPredicate,
    );

    if (directParents.size === 0) {
      return 0;
    }

    // Compute transitive closure for all classes
    const allAncestors = this.computeAllAncestors(directParents);

    // Generate inferred Instance_class triples
    const countBefore = await store.count();

    const instanceTriples = await store.match(
      undefined,
      instanceClassPredicate,
    );
    const inferredTriples: Triple[] = [];

    for (const triple of instanceTriples) {
      if (triple.object instanceof IRI) {
        const ancestors = allAncestors.get(triple.object.value);
        if (ancestors) {
          for (const ancestorIRI of ancestors) {
            inferredTriples.push(
              new Triple(
                triple.subject,
                instanceClassPredicate,
                new IRI(ancestorIRI),
              ),
            );
          }
        }
      }
    }

    if (inferredTriples.length > 0) {
      await store.addAll(inferredTriples);
    }

    const countAfter = await store.count();
    return countAfter - countBefore;
  }

  private async buildDirectParentMap(
    store: ITripleStore,
    superClassPredicate: Predicate,
  ): Promise<Map<string, Set<string>>> {
    const superClassTriples = await store.match(
      undefined,
      superClassPredicate,
    );
    const directParents = new Map<string, Set<string>>();

    for (const triple of superClassTriples) {
      if (triple.subject instanceof IRI && triple.object instanceof IRI) {
        const child = triple.subject.value;
        const parent = triple.object.value;

        if (!directParents.has(child)) {
          directParents.set(child, new Set());
        }
        directParents.get(child)!.add(parent);
      }
    }

    return directParents;
  }

  private computeAllAncestors(
    directParents: Map<string, Set<string>>,
  ): Map<string, Set<string>> {
    const allAncestors = new Map<string, Set<string>>();

    for (const classIRI of directParents.keys()) {
      if (!allAncestors.has(classIRI)) {
        allAncestors.set(
          classIRI,
          this.computeAncestorsBFS(classIRI, directParents),
        );
      }
    }

    return allAncestors;
  }

  /**
   * BFS traversal to compute all ancestors with cycle detection.
   */
  private computeAncestorsBFS(
    classIRI: string,
    directParents: Map<string, Set<string>>,
  ): Set<string> {
    const ancestors = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [];

    const parents = directParents.get(classIRI);
    if (parents) {
      for (const parent of parents) {
        queue.push(parent);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue; // cycle detection
      }
      visited.add(current);
      ancestors.add(current);

      const grandparents = directParents.get(current);
      if (grandparents) {
        for (const gp of grandparents) {
          if (!visited.has(gp)) {
            queue.push(gp);
          }
        }
      }
    }

    return ancestors;
  }
}
