import { Triple, Subject, Predicate, Object as RDFObject } from "../domain/models/rdf/Triple";
import { IRI } from "../domain/models/rdf/IRI";

/**
 * Graph identifier for named graph operations.
 * - undefined: default graph
 * - IRI: named graph
 */
export type GraphName = IRI | undefined;

export interface ITripleStore {
  add(triple: Triple): Promise<void>;

  remove(triple: Triple): Promise<boolean>;

  has(triple: Triple): Promise<boolean>;

  match(
    subject?: Subject,
    predicate?: Predicate,
    object?: RDFObject
  ): Promise<Triple[]>;

  addAll(triples: Triple[]): Promise<void>;

  removeAll(triples: Triple[]): Promise<number>;

  clear(): Promise<void>;

  count(): Promise<number>;

  subjects(): Promise<Subject[]>;

  predicates(): Promise<Predicate[]>;

  objects(): Promise<RDFObject[]>;

  beginTransaction(): Promise<ITransaction>;

  /**
   * Find subjects containing a specific UUID.
   * This is an optimization for FILTER(CONTAINS(STR(?s), 'uuid')) patterns.
   *
   * @param uuid - The UUID string to search for (case-insensitive)
   * @returns Array of subjects whose URI contains the UUID
   */
  findSubjectsByUUID?(uuid: string): Promise<Subject[]>;

  /**
   * Synchronous version of findSubjectsByUUID for use in expression evaluation.
   * Required for exo:byUUID() function which requires synchronous evaluation.
   *
   * @param uuid - The UUID string to search for (case-insensitive)
   * @returns Array of subjects whose URI contains the UUID
   */
  findSubjectsByUUIDSync?(uuid: string): Subject[];

  // ===== Named Graph Support (SPARQL 1.1 Section 13.3) =====

  /**
   * Add a triple to a specific named graph.
   *
   * @param triple - The triple to add
   * @param graph - The graph name (undefined for default graph)
   */
  addToGraph?(triple: Triple, graph: GraphName): Promise<void>;

  /**
   * Remove a triple from a specific named graph.
   *
   * @param triple - The triple to remove
   * @param graph - The graph name (undefined for default graph)
   * @returns true if the triple was removed, false if it didn't exist
   */
  removeFromGraph?(triple: Triple, graph: GraphName): Promise<boolean>;

  /**
   * Match triples within a specific named graph.
   *
   * @param subject - Subject filter (undefined for any)
   * @param predicate - Predicate filter (undefined for any)
   * @param object - Object filter (undefined for any)
   * @param graph - The graph name (undefined for default graph)
   * @returns Array of matching triples
   */
  matchInGraph?(
    subject?: Subject,
    predicate?: Predicate,
    object?: RDFObject,
    graph?: GraphName
  ): Promise<Triple[]>;

  /**
   * Get all named graphs in the dataset.
   *
   * @returns Array of graph IRIs (does not include the default graph)
   */
  getNamedGraphs?(): Promise<IRI[]>;

  /**
   * Check if a named graph exists in the dataset.
   *
   * @param graph - The graph name to check
   * @returns true if the graph exists and contains at least one triple
   */
  hasGraph?(graph: IRI): Promise<boolean>;

  /**
   * Clear all triples from a specific named graph.
   *
   * @param graph - The graph name (undefined for default graph)
   */
  clearGraph?(graph: GraphName): Promise<void>;

  /**
   * Get the count of triples in a specific named graph.
   *
   * @param graph - The graph name (undefined for default graph)
   * @returns Number of triples in the graph
   */
  countInGraph?(graph: GraphName): Promise<number>;
}

export interface ITransaction {
  add(triple: Triple): Promise<void>;

  remove(triple: Triple): Promise<boolean>;

  commit(): Promise<void>;

  rollback(): Promise<void>;
}

export class TripleAlreadyExistsError extends Error {
  constructor(triple: Triple) {
    super(`Triple already exists: ${triple.toString()}`);
    this.name = "TripleAlreadyExistsError";
  }
}

export class TripleNotFoundError extends Error {
  constructor(triple: Triple) {
    super(`Triple not found: ${triple.toString()}`);
    this.name = "TripleNotFoundError";
  }
}

export class TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionError";
  }
}
