import type { GraphOperation, AlgebraOperation, IRI, Variable } from "../algebra/AlgebraOperation";
import { SolutionMapping } from "../SolutionMapping";
import type { ITripleStore } from "../../../interfaces/ITripleStore";
import { IRI as IRIClass } from "../../../domain/models/rdf/IRI";

export class GraphExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "GraphExecutorError";
  }
}

/**
 * Executes GRAPH operations for named graph queries.
 *
 * GRAPH allows querying specific named graphs within an RDF dataset.
 * This executor handles both:
 * - Concrete graph names: GRAPH <http://example.org/g1> { ... }
 * - Graph variables: GRAPH ?g { ... } (iterates over all named graphs)
 *
 * SPARQL 1.1 spec Section 13.3:
 * https://www.w3.org/TR/sparql11-query/#queryDataset
 *
 * Example:
 * ```sparql
 * # Query a specific named graph
 * SELECT ?s ?p ?o
 * WHERE {
 *   GRAPH <http://example.org/graph1> {
 *     ?s ?p ?o
 *   }
 * }
 *
 * # Query all named graphs, binding graph name to ?g
 * SELECT ?g ?s ?p ?o
 * WHERE {
 *   GRAPH ?g {
 *     ?s ?p ?o
 *   }
 * }
 * ```
 */
export class GraphExecutor {
  constructor(private readonly tripleStore: ITripleStore) {}

  /**
   * Execute a GRAPH operation.
   *
   * @param operation - The GRAPH operation with graph name and pattern
   * @param executePattern - Function to recursively execute inner pattern
   * @param currentSolution - Current solution mapping (for variable graph bindings)
   * @returns AsyncIterableIterator of SolutionMappings
   */
  async *execute(
    operation: GraphOperation,
    executePattern: (pattern: AlgebraOperation, graphContext?: IRIClass) => AsyncIterableIterator<SolutionMapping>,
    currentSolution?: SolutionMapping
  ): AsyncIterableIterator<SolutionMapping> {
    const graphName = operation.name;

    if (graphName.type === "iri") {
      // Concrete graph name: execute pattern against the specific named graph
      yield* this.executeWithGraph(operation.pattern, graphName, executePattern);
    } else if (graphName.type === "variable") {
      // Variable graph name: iterate over all named graphs
      yield* this.executeWithGraphVariable(operation, graphName, executePattern, currentSolution);
    } else {
      throw new GraphExecutorError(`Invalid graph name type: ${(graphName as any).type}`);
    }
  }

  /**
   * Execute pattern against a specific named graph.
   */
  private async *executeWithGraph(
    pattern: AlgebraOperation,
    graphName: IRI,
    executePattern: (pattern: AlgebraOperation, graphContext?: IRIClass) => AsyncIterableIterator<SolutionMapping>
  ): AsyncIterableIterator<SolutionMapping> {
    // Create IRI instance from algebra IRI
    const graphIRI = new IRIClass(graphName.value);

    // Check if the named graph exists (optional - depends on implementation)
    if (this.tripleStore.hasGraph) {
      const exists = await this.tripleStore.hasGraph(graphIRI);
      if (!exists) {
        // Named graph doesn't exist - return empty results
        // Per SPARQL 1.1 semantics, querying a non-existent graph returns no results
        return;
      }
    }

    // Execute the inner pattern in the context of this named graph
    yield* executePattern(pattern, graphIRI);
  }

  /**
   * Execute pattern with a graph variable, iterating over all named graphs.
   */
  private async *executeWithGraphVariable(
    operation: GraphOperation,
    graphVariable: Variable,
    executePattern: (pattern: AlgebraOperation, graphContext?: IRIClass) => AsyncIterableIterator<SolutionMapping>,
    currentSolution?: SolutionMapping
  ): AsyncIterableIterator<SolutionMapping> {
    // Check if the graph variable is already bound in the current solution
    if (currentSolution) {
      const boundValue = currentSolution.get(graphVariable.value);
      if (boundValue && boundValue instanceof IRIClass) {
        // Variable already bound - execute only against that specific graph
        yield* this.executeWithGraph(
          operation.pattern,
          { type: "iri", value: boundValue.value },
          executePattern
        );
        return;
      }
    }

    // Get all named graphs
    if (!this.tripleStore.getNamedGraphs) {
      // Triple store doesn't support named graphs - return empty results
      return;
    }

    const namedGraphs = await this.tripleStore.getNamedGraphs();

    // Iterate over each named graph
    for (const graphIRI of namedGraphs) {
      // Execute pattern in this graph's context
      for await (const solution of executePattern(operation.pattern, graphIRI)) {
        // Bind the graph variable to this graph's IRI
        const extendedSolution = solution.clone();
        extendedSolution.set(graphVariable.value, graphIRI);
        yield extendedSolution;
      }
    }
  }
}
