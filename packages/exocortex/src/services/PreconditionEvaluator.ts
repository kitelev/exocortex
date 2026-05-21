import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { IQueryBodyResolver } from "../interfaces/IQueryBodyResolver";
import type { PreconditionDefinition } from "../domain/models/CommandDefinition";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type { AskOperation } from "../infrastructure/sparql/algebra/AlgebraOperation";
import { evaluateWithExoEval } from "../exoql/evaluateWithExoEval";

/**
 * Context passed to host function evaluators.
 */
export interface EvalContext {
  readonly targetIRI: string;
  readonly fileBasename?: string;
  readonly currentFolder?: string;
  readonly assetUid?: string;
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
  private readonly queryBodyResolver?: IQueryBodyResolver;

  constructor(
    tripleStore: ITripleStore,
    queryBodyResolver?: IQueryBodyResolver,
  ) {
    this.tripleStore = tripleStore;
    this.queryBodyResolver = queryBodyResolver;
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

    // SPARQL ASK evaluation (inline body — legacy path)
    if (precondition.sparqlAsk) {
      return this.evaluateSparqlAsk(precondition.sparqlAsk, targetIRI);
    }

    // exoql__Query reference (RFC c78cc5c8 Phase 1a) — resolve body
    // through IQueryBodyResolver, then route through evaluateWithExoEval
    // (allowlist + flag + executor). Fail closed if resolver is absent
    // or the query asset cannot be loaded.
    if (precondition.query) {
      return this.evaluateQueryRef(precondition.query, targetIRI);
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

  private async evaluateQueryRef(
    queryUid: string,
    targetIRI: string,
  ): Promise<boolean> {
    if (!this.queryBodyResolver) return false;
    try {
      const body = await this.queryBodyResolver.resolveSparql(queryUid);
      if (!body) return false;
      const substituted = this.substituteVariables(body, targetIRI);
      const result = await evaluateWithExoEval(substituted, {
        store: this.tripleStore,
      });
      if (result.kind !== "ask") return false;
      return result.result;
    } catch {
      return false;
    }
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
   * Asia/Almaty UTC offset in milliseconds (UTC+5, no DST).
   */
  private static readonly ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

  /**
   * Substitute custom variables in SPARQL query string.
   * This is TEXT replacement, NOT SPARQL variable binding.
   *
   * Variables:
   * - $target → <targetIRI> (wrapped in angle brackets)
   * - $now → "2026-03-31T10:00:00.000Z"^^xsd:dateTime
   * - $today → "2026-03-31"^^xsd:date
   * - $yesterday → "2026-03-30"^^xsd:date (Asia/Almaty)
   * - $thisWeekStart → "2026-03-30"^^xsd:date (Monday, Asia/Almaty)
   * - $lastWeekStart → "2026-03-23"^^xsd:date (prev Monday, Asia/Almaty)
   * - $thisMonthStart → "2026-03-01"^^xsd:date (Asia/Almaty)
   * - $lastMonthStart → "2026-02-01"^^xsd:date (Asia/Almaty)
   * - $thisYearStart → "2026-01-01"^^xsd:date (Asia/Almaty)
   */
  substituteVariables(query: string, targetIRI: string): string {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Compute Almaty-local date components
    const utcNow = new Date();
    const almatyNow = new Date(utcNow.getTime() + PreconditionEvaluator.ALMATY_OFFSET_MS);
    const almatyYear = almatyNow.getUTCFullYear();
    const almatyMonth = almatyNow.getUTCMonth(); // 0-based
    const almatyDate = almatyNow.getUTCDate();
    const almatyDay = almatyNow.getUTCDay(); // 0=Sun

    // $yesterday
    const yesterday = new Date(Date.UTC(almatyYear, almatyMonth, almatyDate - 1));
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    // $thisWeekStart (Monday of current week)
    const daysFromMonday = (almatyDay + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
    const thisWeekStart = new Date(Date.UTC(almatyYear, almatyMonth, almatyDate - daysFromMonday));
    const thisWeekStartStr = thisWeekStart.toISOString().slice(0, 10);

    // $lastWeekStart (Monday of previous week)
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastWeekStartStr = lastWeekStart.toISOString().slice(0, 10);

    // $thisMonthStart
    const thisMonthStartStr = `${almatyYear}-${String(almatyMonth + 1).padStart(2, "0")}-01`;

    // $lastMonthStart
    const lastMonthIdx = almatyMonth === 0 ? 11 : almatyMonth - 1;
    const lastMonthYear = almatyMonth === 0 ? almatyYear - 1 : almatyYear;
    const lastMonthStartStr = `${lastMonthYear}-${String(lastMonthIdx + 1).padStart(2, "0")}-01`;

    // $thisYearStart
    const thisYearStartStr = `${almatyYear}-01-01`;

    return query
      .replace(/\$target/g, `<${targetIRI}>`)
      .replace(/\$now/g, `"${now}"^^xsd:dateTime`)
      .replace(/\$yesterday/g, `"${yesterdayStr}"^^xsd:date`)
      .replace(/\$thisWeekStart/g, `"${thisWeekStartStr}"^^xsd:date`)
      .replace(/\$lastWeekStart/g, `"${lastWeekStartStr}"^^xsd:date`)
      .replace(/\$thisMonthStart/g, `"${thisMonthStartStr}"^^xsd:date`)
      .replace(/\$lastMonthStart/g, `"${lastMonthStartStr}"^^xsd:date`)
      .replace(/\$thisYearStart/g, `"${thisYearStartStr}"^^xsd:date`)
      .replace(/\$today/g, `"${today}"^^xsd:date`);
  }
}
