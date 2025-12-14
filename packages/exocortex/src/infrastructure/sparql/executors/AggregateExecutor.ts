import type { GroupOperation, AggregateExpression, Expression } from "../algebra/AlgebraOperation";
import type { SolutionMapping } from "../SolutionMapping";
import { Literal } from "../../../domain/models/rdf/Literal";
import { IRI } from "../../../domain/models/rdf/IRI";
import { FilterExecutor } from "./FilterExecutor";

const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");
const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");

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
      const resultBindings: Map<string, any> = new Map();

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
      const { SolutionMapping: SM } = require("../SolutionMapping");
      const result = new SM();
      for (const [key, value] of resultBindings.entries()) {
        result.set(key, value);
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

  private termToString(term: any): string {
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
    const values = this.extractValues(expr, solutions);

    switch (expr.aggregation) {
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

      default:
        throw new AggregateExecutorError(`Unknown aggregation function: ${expr.aggregation}`);
    }
  }

  private extractValues(expr: AggregateExpression, solutions: SolutionMapping[]): any[] {
    if (!expr.expression) {
      return solutions.map(() => 1);
    }

    const values: any[] = [];
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
  private evaluateExpression(expr: Expression, solution: SolutionMapping): any {
    // For variable expressions, we need special handling to extract values properly
    if (expr.type === "variable") {
      const term = solution.get((expr as any).name);
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
        return (term as any).value;
      }

      // Fallback: return as-is
      return term;
    }

    // For literal expressions, return the value directly
    if (expr.type === "literal") {
      return (expr as any).value;
    }

    // For all other expression types (arithmetic, function, comparison, etc.),
    // delegate to FilterExecutor which has full expression evaluation support
    try {
      return this.filterExecutor.evaluateExpression(expr as any, solution);
    } catch {
      // If evaluation fails (e.g., missing variable, type error), return undefined
      // This matches SPARQL semantics where errors result in unbound values
      return undefined;
    }
  }

  private computeCount(values: any[], distinct: boolean): number {
    if (distinct) {
      return new Set(values.map((v) => String(v))).size;
    }
    return values.length;
  }

  private computeSum(values: any[]): number {
    const nums = values.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
    return nums.reduce((acc, n) => acc + n, 0);
  }

  private computeAvg(values: any[]): number {
    const nums = values.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
    if (nums.length === 0) return 0;
    return nums.reduce((acc, n) => acc + n, 0) / nums.length;
  }

  private computeMin(values: any[]): any {
    if (values.length === 0) return undefined;

    const nums = values.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
    if (nums.length > 0) {
      return Math.min(...nums);
    }

    const strs = values.map((v) => String(v));
    return strs.reduce((min, s) => (s < min ? s : min), strs[0]);
  }

  private computeMax(values: any[]): any {
    if (values.length === 0) return undefined;

    const nums = values.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
    if (nums.length > 0) {
      return Math.max(...nums);
    }

    const strs = values.map((v) => String(v));
    return strs.reduce((max, s) => (s > max ? s : max), strs[0]);
  }

  private computeGroupConcat(values: any[], separator: string, distinct: boolean): string {
    let strs = values.map((v) => String(v));

    if (distinct) {
      strs = [...new Set(strs)];
    }

    return strs.join(separator);
  }

  private createEmptyAggregateResult(operation: GroupOperation): SolutionMapping | null {
    const { SolutionMapping: SM } = require("../SolutionMapping");
    const result = new SM();

    for (const aggregate of operation.aggregates) {
      switch (aggregate.expression.aggregation) {
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
        default:
          result.set(aggregate.variable, new Literal("", XSD_STRING));
      }
    }

    return result;
  }
}
