import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { PreconditionDefinition } from "../domain/models/CommandDefinition";
import { SPARQLParser } from "../infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type { AskOperation } from "../infrastructure/sparql/algebra/AlgebraOperation";

/**
 * Context passed to host function evaluators.
 */
export interface EvalContext {
  readonly targetIRI: string;
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
    _context?: EvalContext,
  ): Promise<boolean> {
    // No precondition = always available
    if (!precondition) return true;

    // SPARQL ASK evaluation
    if (precondition.sparqlAsk) {
      return this.evaluateSparqlAsk(precondition.sparqlAsk, targetIRI);
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

  // -- Private --

  private async evaluateSparqlAsk(
    sparqlAsk: string,
    targetIRI: string,
  ): Promise<boolean> {
    try {
      // Step 1: Variable substitution (text preprocessing BEFORE parser)
      const processedQuery = this.substituteVariables(sparqlAsk, targetIRI);

      // Step 2: Parse SPARQL ASK query
      const parser = new SPARQLParser();
      const parsed = parser.parse(processedQuery);

      // Step 3: Translate to algebra
      const translator = new AlgebraTranslator();
      const algebra = translator.translate(parsed);

      // Step 4: Verify it's an ASK operation
      const executor = new QueryExecutor(this.tripleStore);
      if (!executor.isAskQuery(algebra)) {
        return false;
      }

      // Step 5: Execute ASK
      return await executor.executeAsk(algebra as AskOperation);
    } catch {
      // Fail closed: SPARQL errors → command not available
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
