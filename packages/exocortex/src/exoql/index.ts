import type { ITripleStore } from "../interfaces/ITripleStore";
import type { Triple } from "../domain/models/rdf/Triple";
import { SPARQLParser } from "../infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import {
  QueryExecutor,
  type QueryExecutorConfig,
} from "../infrastructure/sparql/executors/QueryExecutor";
import type { SolutionMapping } from "../infrastructure/sparql/SolutionMapping";
import type {
  AskOperation,
  ConstructOperation,
} from "../infrastructure/sparql/algebra/AlgebraOperation";

/**
 * ExoQL  public facade for executing SPARQL queries against a triple store.
 *
 * Thin wrapper over the internal SPARQLParser  AlgebraTranslator  QueryExecutor
 * pipeline, providing a concise three-method API:
 *
 * - `query(sparql, store)`      SELECT  SolutionMapping[]
 * - `ask(sparql, store)`        ASK     boolean
 * - `construct(sparql, store)`  CONSTRUCT  Triple[]
 *
 * All methods accept a raw SPARQL string and an ITripleStore instance.
 */
export class ExoQL {
  /**
   * Execute a SELECT query and return all solution mappings.
   *
   * @param sparql  SPARQL SELECT query string
   * @param store   Triple store to query against
   * @param config  Optional QueryExecutor configuration
   * @returns Array of solution mappings (variable bindings)
   */
  static async query(
    sparql: string,
    store: ITripleStore,
    config?: QueryExecutorConfig,
  ): Promise<SolutionMapping[]> {
    const { algebra, executor } = ExoQL.prepare(sparql, store, config);
    return executor.executeAll(algebra);
  }

  /**
   * Execute an ASK query and return a boolean result.
   *
   * @param sparql  SPARQL ASK query string
   * @param store   Triple store to query against
   * @param config  Optional QueryExecutor configuration
   * @returns true if the pattern has at least one match, false otherwise
   */
  static async ask(
    sparql: string,
    store: ITripleStore,
    config?: QueryExecutorConfig,
  ): Promise<boolean> {
    const { algebra, executor } = ExoQL.prepare(sparql, store, config);
    if (!executor.isAskQuery(algebra)) {
      throw new ExoQLError("ExoQL.ask() requires an ASK query");
    }
    return executor.executeAsk(algebra as AskOperation);
  }

  /**
   * Execute a CONSTRUCT query and return generated triples.
   *
   * @param sparql  SPARQL CONSTRUCT query string
   * @param store   Triple store to query against
   * @param config  Optional QueryExecutor configuration
   * @returns Array of RDF triples produced by the CONSTRUCT template
   */
  static async construct(
    sparql: string,
    store: ITripleStore,
    config?: QueryExecutorConfig,
  ): Promise<Triple[]> {
    const { algebra, executor } = ExoQL.prepare(sparql, store, config);
    if (!executor.isConstructQuery(algebra)) {
      throw new ExoQLError("ExoQL.construct() requires a CONSTRUCT query");
    }
    return executor.executeConstruct(algebra as ConstructOperation);
  }

  /**
   * Internal: parse SPARQL, translate to algebra, create executor.
   */
  private static prepare(
    sparql: string,
    store: ITripleStore,
    config?: QueryExecutorConfig,
  ) {
    const parser = new SPARQLParser();
    const translator = new AlgebraTranslator();
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    const executor = new QueryExecutor(store, config);
    return { algebra, executor };
  }
}

/**
 * Error thrown by ExoQL when the query type does not match the method called.
 */
export class ExoQLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExoQLError";
  }
}
