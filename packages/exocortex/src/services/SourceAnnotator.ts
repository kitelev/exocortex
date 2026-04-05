import type { ITripleStore } from "../interfaces/ITripleStore";
import type { Subject, Predicate, Object as RDFObject } from "../domain/models/rdf/Triple";
import { Literal } from "../domain/models/rdf/Literal";
import { IRI } from "../domain/models/rdf/IRI";
import { SolutionMapping } from "../infrastructure/sparql/SolutionMapping";
import { INFERRED_GRAPH } from "./PrototypeChainMaterializer";

/**
 * Source type for triple provenance: own (asserted directly) or inherited (materialized from prototype).
 */
export type TripleSource = "own" | "inherited";

/**
 * The variable name used to annotate solution mappings with source information.
 */
export const SOURCE_VARIABLE = "_source";

/**
 * Annotates SPARQL query results with own/inherited provenance.
 *
 * For each solution mapping, checks whether the triple (identified by subject,
 * predicate, and object bindings) exists in the `exo:inferred` named graph.
 * If it does, the triple was materialized from a prototype chain and is "inherited".
 * Otherwise, it was directly asserted and is "own".
 *
 * Usage:
 * ```typescript
 * const annotator = new SourceAnnotator(tripleStore);
 * const annotated = await annotator.annotate(solutions, "s", "p", "o");
 * // Each solution now has a "_source" binding: "own" or "inherited"
 * ```
 *
 * Designed for ExoQL results where users need to distinguish between
 * properties defined on an asset vs inherited from its prototype.
 */
export class SourceAnnotator {
  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Annotate solution mappings with `_source` binding.
   *
   * For each solution, extracts the subject, predicate, and object from the
   * specified variable names, then checks the `exo:inferred` named graph
   * to determine provenance.
   *
   * @param solutions - Array of solution mappings from query execution
   * @param subjectVar - Variable name for the subject (without '?' prefix)
   * @param predicateVar - Variable name for the predicate (without '?' prefix)
   * @param objectVar - Variable name for the object (without '?' prefix)
   * @returns New array of annotated solution mappings with `_source` binding
   */
  async annotate(
    solutions: SolutionMapping[],
    subjectVar: string,
    predicateVar: string,
    objectVar: string,
  ): Promise<SolutionMapping[]> {
    if (!this.tripleStore.matchInGraph) {
      // Triple store doesn't support named graphs - all triples are "own"
      return solutions.map((sol) => {
        const clone = sol.clone();
        clone.set(SOURCE_VARIABLE, new Literal("own"));
        return clone;
      });
    }

    const annotated: SolutionMapping[] = [];

    for (const solution of solutions) {
      const subject = solution.get(subjectVar);
      const predicate = solution.get(predicateVar);
      const object = solution.get(objectVar);

      const clone = solution.clone();

      if (!subject || !predicate || !object) {
        // Missing bindings - cannot determine source, default to "own"
        clone.set(SOURCE_VARIABLE, new Literal("own"));
      } else {
        const source = await this.determineSource(
          subject as Subject,
          predicate as Predicate,
          object as RDFObject,
        );
        clone.set(SOURCE_VARIABLE, new Literal(source));
      }

      annotated.push(clone);
    }

    return annotated;
  }

  /**
   * Annotate a single solution mapping with `_source` binding.
   *
   * @param solution - A solution mapping from query execution
   * @param subjectVar - Variable name for the subject
   * @param predicateVar - Variable name for the predicate
   * @param objectVar - Variable name for the object
   * @returns New annotated solution mapping with `_source` binding
   */
  async annotateSingle(
    solution: SolutionMapping,
    subjectVar: string,
    predicateVar: string,
    objectVar: string,
  ): Promise<SolutionMapping> {
    const results = await this.annotate([solution], subjectVar, predicateVar, objectVar);
    return results[0];
  }

  /**
   * Determine whether a specific triple is "own" or "inherited".
   *
   * Checks if the triple exists in the `exo:inferred` named graph.
   * If it does, the triple was materialized from a prototype and is "inherited".
   * If not, it was directly asserted and is "own".
   *
   * @param subject - The triple's subject
   * @param predicate - The triple's predicate
   * @param object - The triple's object
   * @returns "own" or "inherited"
   */
  async determineSource(
    subject: Subject,
    predicate: Predicate,
    object: RDFObject,
  ): Promise<TripleSource> {
    if (!this.tripleStore.matchInGraph) {
      return "own";
    }

    const inferredMatches = await this.tripleStore.matchInGraph(
      subject,
      predicate,
      object,
      INFERRED_GRAPH,
    );

    return inferredMatches.length > 0 ? "inherited" : "own";
  }

  /**
   * Batch-annotate solutions using a subject-based approach.
   *
   * For queries where only the subject is known (not predicate/object),
   * checks if ANY triple for that subject exists in the inferred graph.
   * This is useful for queries like `SELECT ?s WHERE { ?s a ems:Task }`.
   *
   * @param solutions - Array of solution mappings
   * @param subjectVar - Variable name for the subject
   * @returns New array with `_source` binding: "own" if subject has no
   *          inferred triples, "inherited" if ALL its triples are inferred,
   *          "mixed" if it has both own and inferred triples
   */
  async annotateBySubject(
    solutions: SolutionMapping[],
    subjectVar: string,
  ): Promise<SolutionMapping[]> {
    if (!this.tripleStore.matchInGraph) {
      return solutions.map((sol) => {
        const clone = sol.clone();
        clone.set(SOURCE_VARIABLE, new Literal("own"));
        return clone;
      });
    }

    const annotated: SolutionMapping[] = [];

    // Cache: subject IRI -> source determination
    const cache = new Map<string, TripleSource>();

    for (const solution of solutions) {
      const subject = solution.get(subjectVar);
      const clone = solution.clone();

      if (!subject || !(subject instanceof IRI)) {
        clone.set(SOURCE_VARIABLE, new Literal("own"));
      } else {
        const cacheKey = subject.value;

        if (!cache.has(cacheKey)) {
          const inferredTriples = await this.tripleStore.matchInGraph(
            subject,
            undefined,
            undefined,
            INFERRED_GRAPH,
          );
          cache.set(cacheKey, inferredTriples.length > 0 ? "inherited" : "own");
        }

        const cachedSource = cache.get(cacheKey) ?? "own";
        clone.set(SOURCE_VARIABLE, new Literal(cachedSource));
      }

      annotated.push(clone);
    }

    return annotated;
  }
}
