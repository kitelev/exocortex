import type { GroupOperation, AggregateExpression, Expression, CustomAggregation, StandardAggregation } from "../algebra/AlgebraOperation";
// Value import (not `import type`): the class is instantiated below. Previously a
// lazy `require("../SolutionMapping")` fetched the runtime class — a workaround
// (Issue #534) that is now vestigial: `SolutionMapping` imports only rdf domain
// models, so there is no cycle back here. `require` is `undefined` under ESM
// (the CLI package's jest runs `--experimental-vm-modules`), which broke any
// aggregate query executed from a CLI test; the top-level import fixes that
// while staying behavior-preserving in the bundled CJS build.
import { SolutionMapping } from "../SolutionMapping";
import { Literal } from "../../../domain/models/rdf/Literal";
import { IRI } from "../../../domain/models/rdf/IRI";
import { FilterExecutor } from "./FilterExecutor";
import { CustomAggregateRegistry, type Term } from "../aggregates/CustomAggregateRegistry";
import { BUILT_IN_AGGREGATES } from "../aggregates/BuiltInAggregates";

const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");
const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");

/**
 * Type guard to check if an aggregation is a custom aggregation.
 */
function isCustomAggregation(agg: StandardAggregation | CustomAggregation): agg is CustomAggregation {
  return typeof agg === "object" && agg.type === "custom";
}

export class AggregateExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "AggregateExecutorError";
  }
}

export class AggregateExecutor {
  private readonly filterExecutor: FilterExecutor;

  constructor() {
    this.filterExecutor = new FilterExecutor();
  }
  execute(
    operation: GroupOperation,
    inputSolutions: SolutionMapping[]
  ): SolutionMapping[] {
    const groups = this.groupSolutions(inputSolutions, operation.variables);
    const results: SolutionMapping[] = [];

    for (const [_groupKey, groupSolutions] of groups.entries()) {
      const resultBindings: Map<string, unknown> = new Map();

      for (const varName of operation.variables) {
        if (groupSolutions.length > 0) {
          const term = groupSolutions[0].get(varName);
          if (term) {
            resultBindings.set(varName, term);
          }
        }
      }

      for (const aggregate of operation.aggregates) {
        const value = this.computeAggregate(
          aggregate.expression,
          groupSolutions
        );
        resultBindings.set(aggregate.variable, value);
      }

      // Create a fresh result with ONLY GROUP BY variables and aggregate results
      // Per SPARQL 1.1 spec: aggregated results should contain only:
      // 1. Variables from GROUP BY clause
      // 2. Variables bound to aggregate expressions
      // This fixes Issue #534 Blocker 1: aggregate functions returning extra variables
      const result = new SolutionMapping();
      for (const [key, value] of resultBindings.entries()) {
        // `resultBindings` is `Map<string, unknown>`; the lazy `require`
        // previously typed the class as `any`, silently accepting these values.
        // Runtime behaviour is unchanged — cast to the set() param type.
        result.set(key, value as Parameters<typeof result.set>[1]);
      }
      results.push(result);
    }

    if (results.length === 0 && operation.aggregates.length > 0) {
      const emptyResult = this.createEmptyAggregateResult(operation);
      if (emptyResult) {
        results.push(emptyResult);
      }
    }

    return results;
  }

  private groupSolutions(
    solutions: SolutionMapping[],
    groupVariables: string[]
  ): Map<string, SolutionMapping[]> {
    const groups = new Map<string, SolutionMapping[]>();

    if (groupVariables.length === 0) {
      groups.set("", solutions);
      return groups;
    }

    for (const solution of solutions) {
      const key = this.computeGroupKey(solution, groupVariables);
      const existing = groups.get(key);
      if (existing) {
        existing.push(solution);
      } else {
        groups.set(key, [solution]);
      }
    }

    return groups;
  }

  private computeGroupKey(solution: SolutionMapping, variables: string[]): string {
    return variables
      .map((v) => {
        const term = solution.get(v);
        if (!term) return "";
        return this.termToString(term);
      })
      .join("|");
  }

  private termToString(term: unknown): string {
    if (term && typeof term === "object") {
      if ("value" in term) return String(term.value);
      if ("id" in term) return String(term.id);
    }
    return String(term);
  }

  private computeAggregate(
    expr: AggregateExpression,
    solutions: SolutionMapping[]
  ): Literal {
    // Handle custom aggregates first
    if (isCustomAggregation(expr.aggregation)) {
      return this.computeCustomAggregate(expr, solutions);
    }

    const values = this.extractValues(expr, solutions);
    const aggregation = expr.aggregation;

    switch (aggregation) {
      case "count": {
        const count = this.computeCount(values, expr.distinct);
        return new Literal(String(count), XSD_INTEGER);
      }

      case "sum": {
        const sum = this.computeSum(values);
        return new Literal(String(sum), XSD_DECIMAL);
      }

      case "avg": {
        const avg = this.computeAvg(values);
        return new Literal(String(avg), XSD_DECIMAL);
      }

      case "min": {
        const min = this.computeMin(values);
        if (min === undefined) {
          return new Literal("", XSD_STRING);
        }
        return typeof min === "number"
          ? new Literal(String(min), XSD_DECIMAL)
          : new Literal(String(min), XSD_STRING);
      }

      case "max": {
        const max = this.computeMax(values);
        if (max === undefined) {
          return new Literal("", XSD_STRING);
        }
        return typeof max === "number"
          ? new Literal(String(max), XSD_DECIMAL)
          : new Literal(String(max), XSD_STRING);
      }

      case "group_concat": {
        const concat = this.computeGroupConcat(values, expr.separator || " ", expr.distinct);
        return new Literal(concat || " ", XSD_STRING);
      }

      case "sample": {
        const sample = this.computeSample(values, expr.distinct);
        if (sample === undefined) {
          // Return space for unbound/empty SAMPLE result (Literal cannot be empty)
          return new Literal(" ", XSD_STRING);
        }
        return typeof sample === "number"
          ? new Literal(String(sample), XSD_DECIMAL)
          : new Literal(String(sample), XSD_STRING);
      }

      default: {
        // This ensures exhaustive check - if we get here, TypeScript knows aggregation is never
        const _exhaustiveCheck: never = aggregation;
        throw new AggregateExecutorError(`Unknown aggregation function: ${_exhaustiveCheck}`);
      }
    }
  }

  /**
   * Compute a custom aggregate function.
   *
   * First checks the CustomAggregateRegistry for user-registered aggregates,
   * then falls back to built-in aggregates (median, variance, etc.).
   *
   * @param expr - The aggregate expression with custom aggregation
   * @param solutions - The solution mappings in the group
   * @returns The computed aggregate result as a Literal
   * @throws AggregateExecutorError if the custom aggregate is not found
   */
  private computeCustomAggregate(
    expr: AggregateExpression,
    solutions: SolutionMapping[]
  ): Literal {
    const customAgg = expr.aggregation as CustomAggregation;
    const iri = customAgg.iri;

    // First check user-registered aggregates
    const registry = CustomAggregateRegistry.getInstance();
    let aggregate = registry.get(iri);

    // Fall back to built-in aggregates
    if (!aggregate) {
      aggregate = BUILT_IN_AGGREGATES[iri];
    }

    if (!aggregate) {
      throw new AggregateExecutorError(
        `Unknown custom aggregate function: ${iri}. ` +
        `Register it with CustomAggregateRegistry.getInstance().register() or use a built-in aggregate.`
      );
    }

    // Initialize accumulator state
    const state = aggregate.init();

    // Extract and process values
    for (const solution of solutions) {
      let value: Term = null;

      if (expr.expression) {
        const evaluated = this.evaluateExpression(expr.expression, solution);
        if (evaluated !== undefined) {
          value = evaluated as Term;
        }
      } else {
        // COUNT(*) style - pass a marker value
        value = 1;
      }

      // For DISTINCT, we'd need to track seen values
      // For now, custom aggregates handle DISTINCT internally if needed
      aggregate.step(state, value);
    }

    // Finalize and return result
    return aggregate.finalize(state);
  }

  private extractValues(expr: AggregateExpression, solutions: SolutionMapping[]): unknown[] {
    if (!expr.expression) {
      return solutions.map(() => 1);
    }

    const values: unknown[] = [];
    for (const solution of solutions) {
      const value = this.evaluateExpression(expr.expression, solution);
      if (value !== undefined && value !== null) {
        values.push(value);
      }
    }

    return values;
  }

  /**
   * Evaluate an expression against a solution mapping.
   * Supports all expression types including arithmetic, function calls, and BIND-computed values.
   *
   * This enables aggregate functions to work with:
   * - Simple variables: AVG(?duration) where ?duration is BIND-computed
   * - Arithmetic expressions: SUM(?end - ?start)
   * - Function calls: AVG(HOURS(?end) - HOURS(?start))
   * - Nested expressions: SUM((?end - ?start) / 60000)
   */
  private evaluateExpression(expr: Expression, solution: SolutionMapping): unknown {
    // For variable expressions, we need special handling to extract values properly
    if (expr.type === "variable") {
      const term = solution.get((expr as import("../algebra/AlgebraOperation").VariableExpression).name);
      if (term === undefined || term === null) return undefined;

      // Handle raw primitive values (from BIND computations)
      if (typeof term === "number") {
        return term;
      }
      if (typeof term === "string") {
        return term;
      }
      if (typeof term === "boolean") {
        return term;
      }

      // Handle RDF terms with .value property (Literal, IRI)
      if (typeof term === "object" && "value" in term) {
        return (term as { value: string }).value;
      }

      // Fallback: return as-is
      return term;
    }

    // For literal expressions, return the value directly
    if (expr.type === "literal") {
      return (expr as import("../algebra/AlgebraOperation").LiteralExpression).value;
    }

    // For all other expression types (arithmetic, function, comparison, etc.),
    // delegate to FilterExecutor which has full expression evaluation support
    try {
      return this.filterExecutor.evaluateExpression(expr, solution);
    } catch {
      // If evaluation fails (e.g., missing variable, type error), return undefined
      // This matches SPARQL semantics where errors result in unbound values
      return undefined;
    }
  }

  private computeCount(values: unknown[], distinct: boolean): number {
    if (distinct) {
      return new Set(values.map((v) => String(v))).size;
    }
    return values.length;
  }

  private computeSum(values: unknown[]): number {
    const nums = values.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
    return nums.reduce((acc, n) => acc + n, 0);
  }

  private computeAvg(values: unknown[]): number {
    const nums = values.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
    if (nums.length === 0) return 0;
    return nums.reduce((acc, n) => acc + n, 0) / nums.length;
  }

  /**
   * Strict numeric coercion for MIN/MAX.
   *
   * ⛔ `parseFloat` takes the NUMERIC PREFIX of a string, so every ISO-8601 timestamp
   *    parsed as its year and MIN/MAX silently answered `"2026"^^xsd:decimal` instead of
   *    the timestamp (task 0c24668f, measured on the live graph):
   *
   *      parseFloat("2026-08-02T20:07:15")  →  2026   (isNaN: false)   ⛔
   *      Number("2026-08-02T20:07:15")      →  NaN                     ✅
   *
   * ⛤ `Number()` requires the WHOLE string to be numeric, which is exactly the question
   *    being asked. Its one quirk — `Number("") === 0` — is excluded explicitly, otherwise
   *    an empty binding would join the numeric branch as a zero.
   *
   * ⛔ Returns null unless EVERY value is numeric. A single number among timestamps used to
   *    flip the whole set into the numeric branch, collapsing the dates to years AND dropping
   *    the non-numeric ones through the `isNaN` filter — the aggregate then answered over a
   *    subset nobody asked for. Mixed sets therefore fall through to lexical comparison,
   *    which for ISO-8601 coincides with chronological order (the same property that makes
   *    `ORDER BY DESC(?dateTime)` correct today).
   */
  private asAllNumeric(values: unknown[]): number[] | null {
    const nums: number[] = [];
    for (const v of values) {
      if (typeof v === "number") {
        nums.push(v);
        continue;
      }
      const text = String(v).trim();
      if (text === "") return null;
      const n = Number(text);
      if (Number.isNaN(n)) return null;
      nums.push(n);
    }
    return nums.length > 0 ? nums : null;
  }

  private computeMin(values: unknown[]): unknown {
    if (values.length === 0) return undefined;

    const nums = this.asAllNumeric(values);
    if (nums) {
      return Math.min(...nums);
    }

    const strs = values.map((v) => String(v));
    return strs.reduce((min, s) => (s < min ? s : min), strs[0]);
  }

  private computeMax(values: unknown[]): unknown {
    if (values.length === 0) return undefined;

    // ⛤ Same strict coercion as computeMin — see asAllNumeric. MIN and MAX are
    //    byte-identical in shape, so fixing only one leaves the sibling broken.
    const nums = this.asAllNumeric(values);
    if (nums) {
      return Math.max(...nums);
    }

    const strs = values.map((v) => String(v));
    return strs.reduce((max, s) => (s > max ? s : max), strs[0]);
  }

  private computeGroupConcat(values: unknown[], separator: string, distinct: boolean): string {
    let strs = values.map((v) => String(v));

    if (distinct) {
      strs = [...new Set(strs)];
    }

    return strs.join(separator);
  }

  /**
   * SAMPLE aggregate function (SPARQL 1.1).
   * Returns an arbitrary value from the group.
   * Per spec, this returns any value - we choose the first non-null value.
   */
  private computeSample(values: unknown[], distinct: boolean): unknown {
    if (values.length === 0) return undefined;

    if (distinct) {
      const uniqueValues = [...new Set(values.map((v) => String(v)))];
      if (uniqueValues.length === 0) return undefined;

      // Try to return numeric value if first unique value is numeric
      const firstUnique = uniqueValues[0];
      const num = parseFloat(firstUnique);
      return !isNaN(num) ? num : firstUnique;
    }

    // Return first value - try to preserve type
    const first = values[0];
    if (typeof first === "number") return first;
    const num = parseFloat(String(first));
    return !isNaN(num) ? num : String(first);
  }

  private createEmptyAggregateResult(operation: GroupOperation): SolutionMapping | null {
    const result = new SolutionMapping();

    for (const aggregate of operation.aggregates) {
      const agg = aggregate.expression.aggregation;

      // Handle custom aggregates
      if (isCustomAggregation(agg)) {
        // Custom aggregates return decimal 0 for empty groups
        result.set(aggregate.variable, new Literal("0", XSD_DECIMAL));
        continue;
      }

      switch (agg) {
        case "count":
          result.set(aggregate.variable, new Literal("0", XSD_INTEGER));
          break;
        case "sum":
        case "avg":
          result.set(aggregate.variable, new Literal("0", XSD_DECIMAL));
          break;
        case "group_concat":
          result.set(aggregate.variable, new Literal(" ", XSD_STRING));
          break;
        case "min":
        case "max":
        case "sample":
          result.set(aggregate.variable, new Literal("", XSD_STRING));
          break;
        default:
          // Exhaustive check handled by TypeScript - unreachable for StandardAggregation
          result.set(aggregate.variable, new Literal("", XSD_STRING));
      }
    }

    return result;
  }
}
