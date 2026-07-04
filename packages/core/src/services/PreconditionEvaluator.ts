import { injectable } from "tsyringe";
import type { ITripleStore } from "../interfaces/ITripleStore";
import type { IQueryBodyResolver } from "../interfaces/IQueryBodyResolver";
import type { PreconditionDefinition } from "../domain/models/CommandDefinition";
import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type { AskOperation } from "../infrastructure/sparql/algebra/AlgebraOperation";
import { evaluateWithExoEval } from "../exoql/evaluateWithExoEval";
import { DateFormatter } from "../utilities/DateFormatter";
import type { IClock } from "./IClock";
import { liveClock } from "./IClock";

/**
 * Context passed to host function evaluators.
 */
export interface EvalContext {
  readonly targetIRI: string;
  readonly fileBasename?: string;
  readonly currentFolder?: string;
  readonly filePath?: string;
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
 * - Registered host function throws → false (fail closed for safety)
 * - Unregistered host function → true on the async {@link evaluate} path
 *   (fail open, permissive for inline buttons); `null` on
 *   {@link evaluateHostFunctionSync} (caller decides — the palette registrar
 *   treats `null` as fail closed to surface misconfiguration). This
 *   asymmetry is intentional and regression-guarded by unit tests.
 *
 * Issue #2429
 */
@injectable()
export class PreconditionEvaluator {
  private readonly hostFunctions = new Map<string, HostFunction>();
  private readonly tripleStore: ITripleStore;
  private readonly askCache = new Map<string, AskOperation>();
  private readonly queryBodyResolver?: IQueryBodyResolver;
  private readonly clock: IClock;

  constructor(
    tripleStore: ITripleStore,
    queryBodyResolver?: IQueryBodyResolver,
    options?: { clock?: IClock },
  ) {
    this.tripleStore = tripleStore;
    this.queryBodyResolver = queryBodyResolver;
    this.clock = options?.clock ?? liveClock();
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

  /**
   * Synchronously evaluate a host-function precondition (Issue #3292).
   *
   * Returns `null` when the named host function is not registered — the
   * caller decides whether absence means "deny" or "allow" (palette
   * registrar treats `null` as "fail closed = false" to surface
   * misconfiguration loudly).
   *
   * Used by surfaces that cannot await an async precondition — notably
   * Obsidian's `addCommand({ checkCallback })`, which is synchronous and
   * runs on every Command Palette open. The async {@link evaluate} method
   * remains the canonical path for inline buttons, layouts, CLI, and any
   * other surface that can wait for SPARQL ASK / `exoql__Query`.
   */
  evaluateHostFunctionSync(
    name: string,
    targetIRI: string,
    context?: EvalContext,
  ): boolean | null {
    if (!this.hostFunctions.has(name)) return null;
    return this.evaluateHostFunction(name, targetIRI, context);
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

    try {
      return fn(evalContext);
    } catch {
      // A registered host function that throws is treated as fail-closed
      // (command hidden), consistent with the SPARQL-engine-error policy.
      // This matters most for `evaluateHostFunctionSync`, which runs inside
      // Obsidian's synchronous `addCommand({ checkCallback })` on every
      // Command Palette open — an uncaught throw there surfaces as a
      // palette-breaking exception. The async inline-button path also relied
      // on its own caller-side catch; centralising here makes both surfaces
      // uniformly graceful. Note this only governs the registered-but-errored
      // case; the unregistered fail-open/closed asymmetry above is unchanged.
      return false;
    }
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
   * - $now → "2026-03-31T10:00:00.000Z"^^xsd:dateTime (UTC instant)
   * - $today → "2026-03-31"^^xsd:date (LOCAL calendar day)
   * - $yesterday → "2026-03-30"^^xsd:date (LOCAL)
   * - $thisWeekStart → "2026-03-30"^^xsd:date (Monday, LOCAL)
   * - $lastWeekStart → "2026-03-23"^^xsd:date (prev Monday, LOCAL)
   * - $thisMonthStart → "2026-03-01"^^xsd:date (LOCAL)
   * - $lastMonthStart → "2026-02-01"^^xsd:date (LOCAL)
   * - $thisYearStart → "2026-01-01"^^xsd:date (LOCAL)
   *
   * All calendar-date tokens derive from ONE shared LOCAL wall-clock day
   * (`DateFormatter.toDateString` / local `Date` getters + plain local
   * `new Date(y, mo, d - N)` arithmetic), consistent with the rest of the
   * `$today` family (#3806/#3808/#3809). `$now` stays a UTC `xsd:dateTime`
   * instant — an instant is timezone-absolute.
   *
   * Formerly `$today` was sliced from `clock.now().toISOString()` (UTC) while
   * its sibling tokens derived from a hardcoded `ALMATY_OFFSET_MS` local shift,
   * so between local midnight and 05:00 Asia/Almaty `$today` equalled
   * `$yesterday` (internally absurd) and any visibility precondition comparing
   * an asset date against `$today` mis-fired at the boundary (#3811). Now every
   * token shares one local basis — no hardcoded timezone, portable, and
   * internally consistent.
   */
  substituteVariables(query: string, targetIRI: string): string {
    const now = this.clock.now();
    const nowIso = now.toISOString();

    // ONE local wall-clock day basis (system timezone) for every calendar-date
    // token — no hardcoded offset. `DateFormatter.toDateString` and the
    // `new Date(y, mo, d - N)` arithmetic below all read/write local components.
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const date = now.getDate();
    const day = now.getDay(); // 0=Sun

    // $today
    const todayStr = DateFormatter.toDateString(now);

    // $yesterday
    const yesterdayStr = DateFormatter.toDateString(new Date(year, month, date - 1));

    // $thisWeekStart (Monday of current week)
    const daysFromMonday = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
    const thisWeekStartStr = DateFormatter.toDateString(
      new Date(year, month, date - daysFromMonday),
    );

    // $lastWeekStart (Monday of previous week)
    const lastWeekStartStr = DateFormatter.toDateString(
      new Date(year, month, date - daysFromMonday - 7),
    );

    // $thisMonthStart
    const thisMonthStartStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;

    // $lastMonthStart
    const lastMonthIdx = month === 0 ? 11 : month - 1;
    const lastMonthYear = month === 0 ? year - 1 : year;
    const lastMonthStartStr = `${lastMonthYear}-${String(lastMonthIdx + 1).padStart(2, "0")}-01`;

    // $thisYearStart
    const thisYearStartStr = `${year}-01-01`;

    return query
      .replace(/\$target/g, `<${targetIRI}>`)
      .replace(/\$now/g, `"${nowIso}"^^xsd:dateTime`)
      .replace(/\$yesterday/g, `"${yesterdayStr}"^^xsd:date`)
      .replace(/\$thisWeekStart/g, `"${thisWeekStartStr}"^^xsd:date`)
      .replace(/\$lastWeekStart/g, `"${lastWeekStartStr}"^^xsd:date`)
      .replace(/\$thisMonthStart/g, `"${thisMonthStartStr}"^^xsd:date`)
      .replace(/\$lastMonthStart/g, `"${lastMonthStartStr}"^^xsd:date`)
      .replace(/\$thisYearStart/g, `"${thisYearStartStr}"^^xsd:date`)
      .replace(/\$today/g, `"${todayStr}"^^xsd:date`);
  }
}
