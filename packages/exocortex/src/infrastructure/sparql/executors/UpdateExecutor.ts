import type { ITripleStore, GraphName } from "../../../interfaces/ITripleStore";
import type { Update, UpdateOperation } from "../SPARQLParser";
import { Triple, Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type * as sparqljs from "sparqljs";

export class UpdateExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "UpdateExecutorError";
  }
}

/**
 * Result of executing an UPDATE operation.
 */
export interface UpdateResult {
  /** Type of update that was executed */
  type: "insert" | "delete" | "insertdelete" | "deletewhere" | "clear" | "drop" | "load" | "create" | "copy" | "move" | "add";
  /** Number of triples inserted (for INSERT operations) */
  inserted?: number;
  /** Number of triples deleted (for DELETE operations) */
  deleted?: number;
  /** Whether the operation succeeded */
  success: boolean;
}

/**
 * Executes SPARQL UPDATE operations against a triple store.
 *
 * SPARQL 1.1 Update specification:
 * https://www.w3.org/TR/sparql11-update/
 *
 * Currently supported operations:
 * - INSERT DATA: Add static triples to the graph
 *
 * Future operations (not yet implemented):
 * - DELETE DATA: Remove static triples from the graph
 * - INSERT/DELETE: Modify triples based on WHERE clause
 * - CLEAR: Remove all triples from a graph
 * - DROP: Remove a graph
 * - LOAD: Load triples from an external source
 * - CREATE: Create an empty graph
 * - COPY/MOVE/ADD: Graph management operations
 */
export class UpdateExecutor {
  private readonly tripleStore: ITripleStore;

  constructor(tripleStore: ITripleStore) {
    this.tripleStore = tripleStore;
  }

  /**
   * Execute an UPDATE request containing one or more update operations.
   *
   * @param update - The parsed UPDATE request from sparqljs
   * @returns Array of results, one for each update operation
   */
  async execute(update: Update): Promise<UpdateResult[]> {
    if (update.type !== "update") {
      throw new UpdateExecutorError("Expected UPDATE request");
    }

    const results: UpdateResult[] = [];

    for (const operation of update.updates) {
      const result = await this.executeOperation(operation);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a single update operation.
   */
  private async executeOperation(operation: UpdateOperation): Promise<UpdateResult> {
    // Check for InsertDeleteOperation types
    if ("updateType" in operation) {
      switch (operation.updateType) {
        case "insert":
          return this.executeInsertData(operation);
        case "delete":
          return this.executeDeleteData(operation);
        case "insertdelete":
          throw new UpdateExecutorError("INSERT/DELETE with WHERE clause not yet implemented");
        case "deletewhere":
          throw new UpdateExecutorError("DELETE WHERE not yet implemented");
        default:
          throw new UpdateExecutorError(`Unknown update type: ${(operation as any).updateType}`);
      }
    }

    // Check for ManagementOperation types
    if ("type" in operation) {
      switch (operation.type) {
        case "clear":
        case "drop":
        case "load":
        case "create":
        case "copy":
        case "move":
        case "add":
          throw new UpdateExecutorError(`${operation.type.toUpperCase()} operation not yet implemented`);
        default:
          throw new UpdateExecutorError(`Unknown operation type: ${(operation as any).type}`);
      }
    }

    throw new UpdateExecutorError("Unknown update operation structure");
  }

  /**
   * Execute INSERT DATA operation.
   *
   * INSERT DATA adds static triples to the graph without a WHERE clause.
   * Triples can be added to the default graph or to named graphs.
   *
   * SPARQL 1.1 specification:
   * https://www.w3.org/TR/sparql11-update/#insertData
   *
   * Examples:
   * ```sparql
   * INSERT DATA {
   *   <http://example/s> <http://example/p> "value" .
   * }
   *
   * INSERT DATA {
   *   GRAPH <http://example/g1> {
   *     <http://example/s> <http://example/p> "value" .
   *   }
   * }
   * ```
   */
  private async executeInsertData(operation: sparqljs.InsertDeleteOperation): Promise<UpdateResult> {
    if (operation.updateType !== "insert") {
      throw new UpdateExecutorError("Expected INSERT DATA operation");
    }

    // sparqljs represents INSERT DATA as { updateType: "insert", insert: Quads[] }
    const insertData = operation as { updateType: "insert"; insert: sparqljs.Quads[]; graph?: sparqljs.GraphOrDefault };

    let insertedCount = 0;

    // Process each quad pattern in the insert array
    for (const quads of insertData.insert) {
      if (quads.type === "bgp") {
        // Default graph triples
        const graphName = this.resolveGraphName(insertData.graph);
        insertedCount += await this.insertTriples(quads.triples, graphName);
      } else if (quads.type === "graph") {
        // Named graph triples
        const graphQuads = quads as sparqljs.GraphQuads;
        const graphName = this.parseGraphName(graphQuads.name);
        insertedCount += await this.insertTriples(graphQuads.triples, graphName);
      }
    }

    return {
      type: "insert",
      inserted: insertedCount,
      success: true,
    };
  }

  /**
   * Execute DELETE DATA operation.
   *
   * DELETE DATA removes static triples from the graph without a WHERE clause.
   *
   * SPARQL 1.1 specification:
   * https://www.w3.org/TR/sparql11-update/#deleteData
   */
  private async executeDeleteData(operation: sparqljs.InsertDeleteOperation): Promise<UpdateResult> {
    if (operation.updateType !== "delete") {
      throw new UpdateExecutorError("Expected DELETE DATA operation");
    }

    const deleteData = operation as { updateType: "delete"; delete: sparqljs.Quads[]; graph?: sparqljs.GraphOrDefault };

    let deletedCount = 0;

    for (const quads of deleteData.delete) {
      if (quads.type === "bgp") {
        const graphName = this.resolveGraphName(deleteData.graph);
        deletedCount += await this.deleteTriples(quads.triples, graphName);
      } else if (quads.type === "graph") {
        const graphQuads = quads as sparqljs.GraphQuads;
        const graphName = this.parseGraphName(graphQuads.name);
        deletedCount += await this.deleteTriples(graphQuads.triples, graphName);
      }
    }

    return {
      type: "delete",
      deleted: deletedCount,
      success: true,
    };
  }

  /**
   * Insert triples into the triple store.
   */
  private async insertTriples(triples: sparqljs.Triple[], graphName: GraphName): Promise<number> {
    let count = 0;

    for (const sparqljsTriple of triples) {
      const triple = this.convertTriple(sparqljsTriple);

      if (graphName && this.tripleStore.addToGraph) {
        await this.tripleStore.addToGraph(triple, graphName);
      } else {
        await this.tripleStore.add(triple);
      }
      count++;
    }

    return count;
  }

  /**
   * Delete triples from the triple store.
   */
  private async deleteTriples(triples: sparqljs.Triple[], graphName: GraphName): Promise<number> {
    let count = 0;

    for (const sparqljsTriple of triples) {
      const triple = this.convertTriple(sparqljsTriple);

      let removed: boolean;
      if (graphName && this.tripleStore.removeFromGraph) {
        removed = await this.tripleStore.removeFromGraph(triple, graphName);
      } else {
        removed = await this.tripleStore.remove(triple);
      }

      if (removed) {
        count++;
      }
    }

    return count;
  }

  /**
   * Convert a sparqljs Triple to our domain Triple.
   */
  private convertTriple(sparqljsTriple: sparqljs.Triple): Triple {
    return new Triple(
      this.convertSubject(sparqljsTriple.subject),
      this.convertPredicate(sparqljsTriple.predicate),
      this.convertObject(sparqljsTriple.object)
    );
  }

  /**
   * Convert a sparqljs subject term to our domain Subject.
   */
  private convertSubject(term: sparqljs.Term): Subject {
    if (term.termType === "NamedNode") {
      return new IRI(term.value);
    }
    if (term.termType === "BlankNode") {
      return new BlankNode(term.value);
    }
    throw new UpdateExecutorError(`Invalid subject term type: ${term.termType}. Variables are not allowed in INSERT DATA.`);
  }

  /**
   * Convert a sparqljs predicate term to our domain Predicate.
   */
  private convertPredicate(term: sparqljs.Term | sparqljs.PropertyPath): Predicate {
    if ("termType" in term && term.termType === "NamedNode") {
      return new IRI(term.value);
    }
    throw new UpdateExecutorError(`Invalid predicate term type. Only IRIs are allowed in INSERT DATA.`);
  }

  /**
   * Convert a sparqljs object term to our domain Object.
   */
  private convertObject(term: sparqljs.Term): RDFObject {
    if (term.termType === "NamedNode") {
      return new IRI(term.value);
    }
    if (term.termType === "BlankNode") {
      return new BlankNode(term.value);
    }
    if (term.termType === "Literal") {
      const literal = term as sparqljs.LiteralTerm;
      if (literal.language) {
        return new Literal(literal.value, undefined, literal.language);
      }
      if (literal.datatype) {
        return new Literal(literal.value, new IRI(literal.datatype.value));
      }
      return new Literal(literal.value);
    }
    throw new UpdateExecutorError(`Invalid object term type: ${term.termType}. Variables are not allowed in INSERT DATA.`);
  }

  /**
   * Resolve a GraphOrDefault to a GraphName.
   */
  private resolveGraphName(graph?: sparqljs.GraphOrDefault): GraphName {
    if (!graph) {
      return undefined; // Default graph
    }
    if (graph.default) {
      return undefined; // Explicitly the default graph
    }
    if (graph.name) {
      return new IRI(graph.name.value);
    }
    return undefined;
  }

  /**
   * Parse a graph name term to GraphName.
   * In INSERT DATA and DELETE DATA, the graph name must be an IRI (not a variable).
   */
  private parseGraphName(term: sparqljs.IriTerm | sparqljs.VariableTerm): GraphName {
    if (term.termType === "Variable") {
      throw new UpdateExecutorError("Variables are not allowed as graph names in INSERT DATA / DELETE DATA.");
    }
    return new IRI(term.value);
  }
}
