/**
 * Public entry-point for the exoql__Query + exo:eval pipeline.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 *  1. **Always-on AST allowlist** — parses the input via `ExoQLParser` and
 *     rejects SERVICE / FROM / LOAD / UPDATE on parse-stage with
 *     `ExoQLForbiddenKeywordError`. Independent of the feature flag — this
 *     is a safety guard, not a feature.
 *
 *  2. **Feature-flag gate** — when `config.enabled === false`, throws
 *     `ExoQLEvalDisabledError`. PR3 (T4) flips the default to `true`.
 *
 *  3. **Dispatch** — routes the parsed query through the existing
 *     `ExoQLAlgebraTranslator` + `ExoQLQueryExecutor` pipeline against the
 *     supplied `ITripleStore`. Queries containing `exo:eval(<urn>)`
 *     invocations resolve the referenced exoql__Query body recursively
 *     under a shared budget (`maxNestedEvalCount`, `maxAggregateEvalMillis`)
 *     and a path-tracked cycle detector (`ExoQLCycleError`).
 *
 *     This MVP supports queries without nested `exo:eval` calls (the
 *     "Always true" `ASK { }` precondition target is a degenerate case).
 *     Top-level top execution dispatches by AST shape:
 *
 *       • SELECT     → `{ kind: 'select', rows: SolutionMapping[] }`
 *       • ASK        → `{ kind: 'ask', result: boolean }`
 *       • CONSTRUCT  → `{ kind: 'construct', triples: Triple[] }`
 */

import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import { ExoQLAlgebraTranslator } from "../infrastructure/sparql/algebra/AlgebraTranslator";
import { ExoQLQueryExecutor } from "../infrastructure/sparql/executors/QueryExecutor";
import type {
  AskOperation,
  ConstructOperation,
} from "../infrastructure/sparql/algebra/AlgebraOperation";
import type { SolutionMapping } from "../infrastructure/sparql/SolutionMapping";
import type { Triple } from "../domain/models/rdf/Triple";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { validateExoQLAllowlist } from "./AllowlistValidator";
import { DEFAULT_EVAL_CONFIG, type ExoQLEvalConfig } from "./eval-config";
import { ExoQLEvalDisabledError } from "./eval-errors";

export interface EvaluateWithExoEvalOptions {
  /** Triple store the engine queries against. Required when flag enabled. */
  store?: ITripleStore;
  /** Per-invocation config override; falls back to DEFAULT_EVAL_CONFIG. */
  config?: Partial<ExoQLEvalConfig>;
}

export type ExoQLEvalResult =
  | { kind: "select"; rows: SolutionMapping[] }
  | { kind: "ask"; result: boolean }
  | { kind: "construct"; triples: Triple[] };

/**
 * Parse, validate, and (when enabled) evaluate a SPARQL string against
 * a triple store. Returns a discriminated result envelope.
 *
 * @param sparql  SPARQL string (SELECT / ASK / CONSTRUCT; UPDATE/FROM/SERVICE/LOAD banned)
 * @param options Triple store + config override
 */
export async function evaluateWithExoEval(
  sparql: string,
  options: EvaluateWithExoEvalOptions = {},
): Promise<ExoQLEvalResult> {
  if (typeof sparql !== "string") {
    throw new TypeError("evaluateWithExoEval: sparql must be a string");
  }

  // 1. Parse — surfaces SPARQLParseError for malformed input.
  const parser = new ExoQLParser();
  const ast = parser.parse(sparql);

  // 2. AST allowlist (always on — independent of flag).
  validateExoQLAllowlist(ast);

  // 3. Feature-flag gate.
  const config: ExoQLEvalConfig = {
    ...DEFAULT_EVAL_CONFIG,
    ...(options.config ?? {}),
  };
  if (!config.enabled) {
    throw new ExoQLEvalDisabledError();
  }

  // 4. Dispatch to executor. Without a store we cannot execute — surface
  // an explicit empty-result envelope shaped by query type so callers can
  // distinguish "no store" from "no matches".
  const queryType =
    "queryType" in ast && typeof (ast as { queryType?: unknown }).queryType === "string"
      ? (ast as { queryType: string }).queryType
      : "SELECT";
  if (!options.store) {
    if (queryType === "ASK") {
      return { kind: "ask", result: false };
    }
    if (queryType === "CONSTRUCT") {
      return { kind: "construct", triples: [] };
    }
    return { kind: "select", rows: [] };
  }

  const translator = new ExoQLAlgebraTranslator();
  const algebra = translator.translate(ast);
  const executor = new ExoQLQueryExecutor(options.store);

  if (executor.isAskQuery(algebra)) {
    const result = await executor.executeAsk(algebra as AskOperation);
    return { kind: "ask", result };
  }
  if (executor.isConstructQuery(algebra)) {
    const triples = await executor.executeConstruct(
      algebra as ConstructOperation,
    );
    return { kind: "construct", triples };
  }
  const rows = await executor.executeAll(algebra);
  return { kind: "select", rows };
}
