/**
 * Error classes for the exoql__Query + exo:eval pipeline.
 *
 * RFC c78cc5c8 Phase 1a — exoql__Query + exo:eval MVP.
 *
 * Each error inherits from Error and sets a stable `name` so tests / callers
 * can match by `error.name === "ExoQLForbiddenKeywordError"` or via
 * `instanceof`. The names are also asserted against in the BDD red-anchor
 * suite (`packages/obsidian-plugin/tests/unit/exoql/exoql-eval-stubs.test.ts`).
 */

export class ExoQLForbiddenKeywordError extends Error {
  public readonly keyword: string;

  constructor(keyword: string, message?: string) {
    super(
      message ??
        `ExoQLForbiddenKeywordError: keyword "${keyword}" is not permitted by the exoql__Query AST allowlist`,
    );
    this.name = "ExoQLForbiddenKeywordError";
    this.keyword = keyword;
  }
}

export class ExoQLEvalDisabledError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "ExoQLEvalDisabledError: exoql.eval.enabled is false (default). Flip the feature flag to opt in.",
    );
    this.name = "ExoQLEvalDisabledError";
  }
}

export class ExoQLCycleError extends Error {
  public readonly path: ReadonlyArray<string>;

  constructor(path: ReadonlyArray<string>, message?: string) {
    super(
      message ??
        `ExoQLCycleError: cycle detected in nested exo:eval invocations: ${path.join(" → ")}`,
    );
    this.name = "ExoQLCycleError";
    this.path = path;
  }
}

export type ExoQLBudgetKind = "nested-eval-count" | "aggregate-eval-millis";

export class ExoQLBudgetExceededError extends Error {
  public readonly budget: ExoQLBudgetKind;
  public readonly limit: number;
  public readonly observed: number;

  constructor(
    budget: ExoQLBudgetKind,
    limit: number,
    observed: number,
    message?: string,
  ) {
    super(
      message ??
        `ExoQLBudgetExceededError: ${budget} budget exceeded (limit=${limit}, observed=${observed})`,
    );
    this.name = "ExoQLBudgetExceededError";
    this.budget = budget;
    this.limit = limit;
    this.observed = observed;
  }
}
