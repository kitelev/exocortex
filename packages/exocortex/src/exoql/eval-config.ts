/**
 * Configuration for the exoql__Query + exo:eval evaluator.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 * The default config keeps `enabled: false` (B2 lock — PR2 ships inert; PR3
 * flips the flag in user-facing settings). Budget defaults are the values
 * declared in the BDD scenarios (`packages/obsidian-plugin/specs/features/
 * exoql/exoql-eval.feature`): ≤100 nested invocations, ≤10 000 ms aggregate
 * wall-clock per top-level query.
 */
export interface ExoQLEvalConfig {
  /**
   * Master feature flag (`exoql.eval.enabled`). When `false`, every public
   * entry-point throws `ExoQLEvalDisabledError` BEFORE any work happens — the
   * only paths that remain hot are the always-on parser allowlist (which is a
   * safety guard, not a feature) and the registry symbol lookup.
   */
  enabled: boolean;

  /**
   * Maximum number of nested `exo:eval` calls per top-level query.
   * Counted across the whole call-tree, not per recursion depth.
   * The 101st invocation raises `ExoQLBudgetExceededError`.
   */
  maxNestedEvalCount: number;

  /**
   * Maximum aggregate wall-clock time spent inside nested evaluations,
   * measured in milliseconds and counted across the whole call-tree.
   * Crossing the threshold raises `ExoQLBudgetExceededError`.
   */
  maxAggregateEvalMillis: number;
}

/**
 * Default config — PR3 (T4) flips B2 lock to `enabled: true`. Production
 * default after RFC c78cc5c8 Phase 1a goes live. Roll back via
 * `docs/ROLLBACK_EXOQL_EVAL.md` (override config to `{ enabled: false }`).
 */
export const DEFAULT_EVAL_CONFIG: ExoQLEvalConfig = Object.freeze({
  enabled: true,
  maxNestedEvalCount: 100,
  maxAggregateEvalMillis: 10_000,
});
