import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { PreconditionDefinition } from "../domain/models/CommandDefinition";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type { AskOperation } from "../infrastructure/sparql/algebra/AlgebraOperation";

/**
 * Context passed to host function evaluators.
 */
export interface EvalContext {
  readonly targetIRI: string;
  readonly fileBasename?: string;
  readonly currentFolder?: string;
  readonly [key: string]: unknown;
}

/** Host function type: receives context, returns availability boolean */
export type HostFunction = (context: EvalContext) => boolean;

/**
 * Evaluates preconditions for dynamic commands (RFC-009 §5.4).
 *
 * Supports two evaluation strategies:
 * 1. SPARQL ASK — query evaluated against ITripleStore
 * 2. Host functions — TypeScript functions for non-SPARQL checks
 *
 * Variable substitution (text preprocessing before SPARQL parser):
 * - `$target` → `<targetIRI>` (IRI of the current asset)
 * - `$now` → current ISO 8601 timestamp
 * - `$today` → current date (YYYY-MM-DD)
 *
 * Default behavior:
 * - No precondition → true (permissive: command always available)
 * - SPARQL engine error → false (fail closed for safety)
 *
 * Issue #2429
 */
@injectable()
export class PreconditionEvaluator {
  private readonly hostFunctions = new Map<string, HostFunction>();
  private readonly tripleStore: ITripleStore;
  private readonly askCache = new Map<string, AskOperation>();

  constructor(tripleStore: ITripleStore) {
    this.tripleStore = tripleStore;
  }

  /**
   * Evaluate whether a command precondition is satisfied.
   *
   * @param precondition - The precondition to evaluate (undefined = always true)
   * @param targetIRI - IRI of the asset being checked
   * @param context - Optional additional context for host functions
   * @returns true if the command should be available, false otherwise
   */
  async evaluate(
    precondition: PreconditionDefinition | undefined,
    targetIRI: string,
    context?: EvalContext,
  ): Promise<boolean> {
    // No precondition = always available
    if (!precondition) return true;

    // SPARQL ASK evaluation
    if (precondition.sparqlAsk) {
      return this.evaluateSparqlAsk(precondition.sparqlAsk, targetIRI);
    }

    // Host function evaluation
    if (precondition.hostFunction) {
      return this.evaluateHostFunction(
        precondition.hostFunction,
        targetIRI,
        context,
      );
    }

    return true;
  }

  /**
   * Register a host function for non-SPARQL preconditions.
   */
  registerHostFunction(name: string, fn: HostFunction): void {
    this.hostFunctions.set(name, fn);
  }

  /**
   * Check if a host function is registered.
   */
  hasHostFunction(name: string): boolean {
    return this.hostFunctions.has(name);
  }

  invalidateCache(): void {
    this.askCache.clear();
  }

  // -- Private --

  private static readonly SENTINEL_IRI = "urn:exocortex:cache-sentinel:target";

  private compileAsk(sparqlAsk: string): AskOperation | null {
    const processedQuery = this.substituteVariables(
      sparqlAsk,
      PreconditionEvaluator.SENTINEL_IRI,
    );
    const parser = new ExoQLParser();
    const parsed = parser.parse(processedQuery);
    const translator = new ExoQLAlgebraTranslator();
    const algebra = translator.translate(parsed);

    const executor = new ExoQLQueryExecutor(this.tripleStore);
    if (!executor.isAskQuery(algebra)) {
      return null;
    }
    return algebra as AskOperation;
  }

  private evaluateHostFunction(
    name: string,
    targetIRI: string,
    context?: EvalContext,
  ): boolean {
    const fn = this.hostFunctions.get(name);
    if (!fn) return true;

    const evalContext: EvalContext = context
      ? { ...context, targetIRI }
      : { targetIRI };

    return fn(evalContext);
  }

  private async evaluateSparqlAsk(
    sparqlAsk: string,
    targetIRI: string,
  ): Promise<boolean> {
    try {
      let compiled = this.askCache.get(sparqlAsk);

      if (compiled === undefined) {
        const result = this.compileAsk(sparqlAsk);
        if (!result) return false;
        compiled = result;
        this.askCache.set(sparqlAsk, compiled);
      }

      const instantiated = JSON.parse(
        JSON.stringify(compiled).replaceAll(
          PreconditionEvaluator.SENTINEL_IRI,
          targetIRI,
        ),
      ) as AskOperation;

      const executor = new ExoQLQueryExecutor(this.tripleStore);
      return await executor.executeAsk(instantiated);
    } catch {
      return false;
    }
  }

  /**
   * Substitute custom variables in SPARQL query string.
   * This is TEXT replacement, NOT SPARQL variable binding.
   *
   * Variables:
   * - $target → <targetIRI> (wrapped in angle brackets)
   * - $now → "2026-03-31T10:00:00.000Z"^^xsd:dateTime
   * - $today → "2026-03-31"^^xsd:date
   */
  substituteVariables(query: string, targetIRI: string): string {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    return query
      .replace(/\$target/g, `<${targetIRI}>`)
      .replace(/\$now/g, `"${now}"^^xsd:dateTime`)
      .replace(/\$today/g, `"${today}"^^xsd:date`);
  }
}
