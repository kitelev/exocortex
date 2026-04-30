/**
 * Public entry-point for the exoql__Query + exo:eval pipeline (PR2 inert).
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 *  1. **Always-on AST allowlist** — parses the input via `ExoQLParser` and
 *     rejects SERVICE / FROM / LOAD / UPDATE on parse-stage with
 *     `ExoQLForbiddenKeywordError`. Independent of the feature flag — this
 *     is a safety guard, not a feature.
 *
 *  2. **Feature-flag gate** — when `config.enabled === false` (the default,
 *     B2 lock for PR2), throws `ExoQLEvalDisabledError`. PR3 (T4) flips the
 *     default to `true` once the dogfood store wiring lands.
 *
 *  3. **Recursive eval engine** — when the flag is `true`, walks the parsed
 *     query for `exo:eval(<urn>)` invocations, recursively fetches the
 *     referenced exoql__Query body from the triple store, and executes it
 *     under a shared budget (max nested invocations / aggregate millis) and
 *     a path-tracked cycle detector (`ExoQLCycleError`). PR3 wires the
 *     ITripleStore consumer; PR2 ships the structural skeleton so the
 *     symbol exists for Jest TDD red-anchors.
 *
 * Test contract:
 *   • Synchronous return type (matches `it.failing` red-anchors in
 *     `packages/obsidian-plugin/tests/unit/exoql/exoql-eval-stubs.test.ts`).
 *   • The function symbol MUST be exported from
 *     `packages/exocortex/src/exoql/index.ts` so
 *     `require("…/exocortex/src/exoql").evaluateWithExoEval` returns it.
 */

import { ExoQLParser } from "../infrastructure/sparql/SPARQLParser";
import type { ITripleStore } from "../interfaces/ITripleStore";
import { validateExoQLAllowlist } from "./AllowlistValidator";
import { DEFAULT_EVAL_CONFIG, type ExoQLEvalConfig } from "./eval-config";
import { ExoQLEvalDisabledError } from "./eval-errors";

export interface EvaluateWithExoEvalOptions {
  /** Triple store the recursive engine queries against (PR3 wiring). */
  store?: ITripleStore;
  /** Per-invocation config override; falls back to DEFAULT_EVAL_CONFIG. */
  config?: Partial<ExoQLEvalConfig>;
}

/**
 * Synchronously parse, validate, and (when enabled) evaluate a SPARQL string
 * containing `exo:eval(<urn>)` calls.
 *
 * On PR2 (inert): throws `ExoQLEvalDisabledError` when the flag is `false`.
 *
 * @param sparql  SPARQL string (SELECT or ASK; UPDATE/FROM/SERVICE/LOAD banned)
 * @param options Triple store + config override
 * @returns       Solution rows (PR2: empty array — never reached when inert)
 */
export function evaluateWithExoEval(
  sparql: string,
  options: EvaluateWithExoEvalOptions = {},
): unknown[] {
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

  // 4. PR3 wiring slot — recursive engine attaches here. PR2 returns [].
  return [];
}
