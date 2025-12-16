import type { ITripleStore } from "../../../interfaces/ITripleStore";
import type { Triple } from "../../../domain/models/rdf/Triple";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";

/**
 * Options for extended DESCRIBE behavior (SPARQL 1.2).
 */
export interface DescribeExecutorOptions {
  /**
   * Maximum depth to follow from described resources.
   * - undefined: Unlimited depth (default, follows all connected resources)
   * - 0 or 1: Only direct triples (resource as subject or object)
   * - 2+: Follow N-1 hops from the initial resource
   *
   * Example with DEPTH 2:
   * - Initial resource: :Alice
   * - Depth 1: :Alice :knows :Bob (direct triple)
   * - Depth 2: :Bob :lives :City (one hop from :Bob)
   */
  depth?: number;

  /**
   * Whether to include both incoming and outgoing triples.
   * Default behavior (false/undefined) already includes both directions,
   * but SYMMETRIC makes this explicit per SPARQL 1.2.
   *
   * When true, explicitly guarantees:
   * - Outgoing: triples where resource is subject
   * - Incoming: triples where resource is object
   */
  symmetric?: boolean;
}

export class DescribeExecutor {
  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Execute DESCRIBE for given resources with optional SPARQL 1.2 options.
   *
   * @param resources - Resources to describe (IRIs)
   * @param options - Optional DEPTH and SYMMETRIC options
   * @returns Array of triples describing the resources
   */
  async execute(
    resources: (Subject | Predicate)[],
    options?: DescribeExecutorOptions
  ): Promise<Triple[]> {
    const resultTriples: Triple[] = [];
    const seen = new Set<string>();
    const visitedResources = new Set<string>();

    // Determine effective depth: undefined means unlimited
    // DEPTH 1 means only direct triples
    // DEPTH 2+ means follow that many levels
    const maxDepth = options?.depth;

    for (const resource of resources) {
      await this.describeResourceWithDepth(
        resource,
        maxDepth,
        1, // current depth starts at 1
        options?.symmetric ?? true, // default to symmetric (both directions)
        resultTriples,
        seen,
        visitedResources
      );
    }

    return resultTriples;
  }

  /**
   * Recursively describe a resource up to the specified depth.
   */
  private async describeResourceWithDepth(
    resource: Subject | Predicate,
    maxDepth: number | undefined,
    currentDepth: number,
    symmetric: boolean,
    resultTriples: Triple[],
    seen: Set<string>,
    visitedResources: Set<string>
  ): Promise<void> {
    const resourceKey = resource.toString();

    // Avoid infinite loops by tracking visited resources
    if (visitedResources.has(resourceKey)) {
      return;
    }
    visitedResources.add(resourceKey);

    // Check if we've exceeded max depth
    if (maxDepth !== undefined && currentDepth > maxDepth) {
      return;
    }

    // Collect triples at current depth
    const triplesAtThisLevel: Triple[] = [];

    // Get outgoing triples (resource as subject)
    const asSubject = await this.tripleStore.match(resource, undefined, undefined);
    triplesAtThisLevel.push(...asSubject);

    // Get incoming triples (resource as object) - always do this for symmetric
    // Note: Default DESCRIBE behavior is symmetric, so we always include both
    if (symmetric) {
      const asObject = await this.tripleStore.match(undefined, undefined, resource);
      triplesAtThisLevel.push(...asObject);
    }

    // Add triples to result, avoiding duplicates
    const nextLevelResources: (Subject | Predicate)[] = [];
    for (const triple of triplesAtThisLevel) {
      const key = `${triple.subject.toString()}|${triple.predicate.toString()}|${triple.object.toString()}`;
      if (!seen.has(key)) {
        seen.add(key);
        resultTriples.push(triple);

        // Collect resources for next level exploration (if depth allows)
        if (maxDepth === undefined || currentDepth < maxDepth) {
          // Add subject if it's an IRI and not the current resource
          if (this.isIRI(triple.subject) && triple.subject.toString() !== resourceKey) {
            nextLevelResources.push(triple.subject as Subject);
          }
          // Add object if it's an IRI and not the current resource
          if (this.isIRI(triple.object) && triple.object.toString() !== resourceKey) {
            nextLevelResources.push(triple.object as RDFObject as Subject);
          }
        }
      }
    }

    // Recursively describe connected resources at next depth level
    for (const nextResource of nextLevelResources) {
      await this.describeResourceWithDepth(
        nextResource,
        maxDepth,
        currentDepth + 1,
        symmetric,
        resultTriples,
        seen,
        visitedResources
      );
    }
  }

  /**
   * Check if a term is an IRI (named node).
   */
  private isIRI(term: any): boolean {
    if (!term) return false;
    // Check various IRI indicators
    return (
      term instanceof IRI ||
      term.termType === "NamedNode" ||
      (typeof term.value === "string" && term.value.startsWith("http"))
    );
  }

  /**
   * Describe a resource by IRI string.
   *
   * @param iri - The IRI string of the resource to describe
   * @param options - Optional DEPTH and SYMMETRIC options
   * @returns Array of triples describing the resource
   */
  async describeByIRI(iri: string, options?: DescribeExecutorOptions): Promise<Triple[]> {
    const resource = new IRI(iri);
    return this.execute([resource], options);
  }
}
