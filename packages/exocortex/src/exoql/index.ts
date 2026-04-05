import type { ITripleStore } from "../interfaces/ITripleStore";
import type { Triple, Subject, Predicate, Object as RDFObject } from "../domain/models/rdf/Triple";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import {
  ExoQLQueryExecutor,
  type QueryExecutorConfig,
} from "../infrastructure/sparql/executors/QueryExecutor";
import type { SolutionMapping } from "../infrastructure/sparql/SolutionMapping";
import type {
  AskOperation,
  ConstructOperation,
} from "../infrastructure/sparql/algebra/AlgebraOperation";
import { SourceAnnotator, SOURCE_VARIABLE } from "../services/SourceAnnotator";
import { Literal } from "../domain/models/rdf/Literal";

/**
 * ExoQL  public facade for executing SPARQL queries against a triple store.
 *
 * Thin wrapper over the internal ExoQLParser → ExoQLAlgebraTranslator → ExoQLQueryExecutor
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
   * Execute a SELECT query and return only "own" (non-inherited) results.
   *
   * Uses the SourceAnnotator to check each solution mapping against the
   * `exo:inferred` named graph. Triples that exist in the inferred graph
   * were materialized from a prototype chain and are filtered out.
   *
   * The query MUST bind `?s` (subject), `?p` (predicate), and `?o` (object)
   * variables, or custom variable names can be specified via `OwnFilterConfig`.
   *
   * @param sparql  SPARQL SELECT query string
   * @param store   Triple store to query against
   * @param ownConfig  Optional configuration for variable name mapping
   * @param config  Optional QueryExecutor configuration
   * @returns Array of solution mappings for own (non-inherited) triples only
   *
   * @example
   * ```typescript
   * // Default: expects ?s ?p ?o variables
   * const own = await ExoQL.queryOwn(
   *   `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`,
   *   store,
   * );
   *
   * // Custom variable names
   * const own = await ExoQL.queryOwn(
   *   `SELECT ?subject ?predicate ?value WHERE { ?subject ?predicate ?value }`,
   *   store,
   *   { subjectVar: "subject", predicateVar: "predicate", objectVar: "value" },
   * );
   * ```
   */
  static async queryOwn(
    sparql: string,
    store: ITripleStore,
    ownConfig?: OwnFilterConfig,
    config?: QueryExecutorConfig,
  ): Promise<SolutionMapping[]> {
    const solutions = await ExoQL.query(sparql, store, config);

    if (solutions.length === 0) {
      return [];
    }

    const subjectVar = ownConfig?.subjectVar ?? "s";
    const predicateVar = ownConfig?.predicateVar ?? "p";
    const objectVar = ownConfig?.objectVar ?? "o";

    const annotator = new SourceAnnotator(store);
    const annotated = await annotator.annotate(
      solutions,
      subjectVar,
      predicateVar,
      objectVar,
    );

    return annotated.filter((sol) => {
      const source = sol.get(SOURCE_VARIABLE);
      return source instanceof Literal && source.value === "own";
    });
  }

  /**
   * Check whether a specific triple is "own" (directly asserted) or "inherited"
   * (materialized from a prototype chain via the `exo:inferred` named graph).
   *
   * @param subject   The triple's subject
   * @param predicate The triple's predicate
   * @param object    The triple's object
   * @param store     Triple store to check against
   * @returns `true` if the triple is own, `false` if inherited
   */
  static async isOwn(
    subject: Subject,
    predicate: Predicate,
    object: RDFObject,
    store: ITripleStore,
  ): Promise<boolean> {
    const annotator = new SourceAnnotator(store);
    const source = await annotator.determineSource(subject, predicate, object);
    return source === "own";
  }

  /**
   * Internal: parse SPARQL, translate to algebra, create executor.
   */
  private static prepare(
    sparql: string,
    store: ITripleStore,
    config?: QueryExecutorConfig,
  ) {
    const parser = new ExoQLParser();
    const translator = new ExoQLAlgebraTranslator();
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    const executor = new ExoQLQueryExecutor(store, config);
    return { algebra, executor };
  }
}

/**
 * Configuration for OWN() filtering variable name mapping.
 *
 * By default, `queryOwn()` expects the query to bind `?s`, `?p`, and `?o`.
 * Use this to specify custom variable names when the query uses different names.
 */
export interface OwnFilterConfig {
  /** Variable name for the subject (without '?' prefix). Default: "s" */
  subjectVar?: string;
  /** Variable name for the predicate (without '?' prefix). Default: "p" */
  predicateVar?: string;
  /** Variable name for the object (without '?' prefix). Default: "o" */
  objectVar?: string;
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
