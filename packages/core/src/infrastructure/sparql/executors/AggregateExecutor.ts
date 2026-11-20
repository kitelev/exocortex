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
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import { QuotedTriple } from "../../../domain/models/rdf/QuotedTriple";
import type { Object as RDFObject } from "../../../domain/models/rdf/Triple";
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

/**
 * One value of a MIN / MAX / SAMPLE argument: what the group holds (`term` — an RDF
 * term, or the JS primitive a BIND / expression produced) and what MIN / MAX compare
 * (`key` — the term's text; for a variable, the value the other aggregates read).
 */
interface GroupValue {
  term: unknown;
  key: unknown;
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
        // An unbound aggregate (MIN / MAX of no values) is absent from the row, not
        // an `undefined` entry — otherwise it reads as bound (ems__Bug 37c80e59).
        if (value === undefined) continue;
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
  ): RDFObject | string | undefined {
    // Handle custom aggregates first
    if (isCustomAggregation(expr.aggregation)) {
      return this.computeCustomAggregate(expr, solutions);
    }

    const aggregation = expr.aggregation;
    if (aggregation === "min" || aggregation === "max" || aggregation === "sample") {
      return this.computeGroupTermAggregate(aggregation, this.extractGroupValues(expr, solutions));
    }

    const values = this.extractValues(expr, solutions);

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

      case "group_concat": {
        const concat = this.computeGroupConcat(values, expr.separator || " ", expr.distinct);
        return new Literal(concat || " ", XSD_STRING);
      }

      default: {
        // This ensures exhaustive check - if we get here, TypeScript knows aggregation is never
        const _exhaustiveCheck: never = aggregation;
        throw new AggregateExecutorError(`Unknown aggregation function: ${_exhaustiveCheck}`);
      }
    }
  }

  /**
   * MIN / MAX / SAMPLE answer one of the group's values — the RDF term itself, with its
   * datatype, language and IRI-ness (SPARQL 1.1 §18.5.1.5–§18.5.1.8). They used to build
   * a NEW literal from the JS value: `"42"^^xsd:integer` came out as `"42"^^xsd:decimal`,
   * an IRI or a date as an xsd:string, and SAMPLE ran parseFloat over text
   * ("2026-10-06T09:35" → 2026) (ems__Bug 2e597cb5, ems__Bug 03904911).
   *
   * Which value MIN / MAX pick is unchanged for a variable or a JS value — the same
   * comparison of its text as before; a term yielded by an expression (COALESCE(?n, 0))
   * is now compared by its text too, not by its N-Triples string. The answer is the
   * chosen value's own term. SAMPLE (with or without DISTINCT) answers the first value
   * of the group; SPARQL allows any.
   */
  private computeGroupTermAggregate(
    aggregation: "min" | "max" | "sample",
    values: GroupValue[]
  ): RDFObject | string | undefined {
    const chosen = aggregation === "sample" ? values[0] : this.computeExtreme(values, aggregation);
    // A group with no values has an unbound MIN / MAX / SAMPLE (SPARQL 1.1 §18.5.1).
    // MIN / MAX used to build Literal(""), which throws and failed the whole query
    // (ems__Bug 37c80e59); SAMPLE answered a lone space (ems__Bug 03904911).
    if (chosen === undefined) return undefined;
    return this.groupValueTerm(chosen.term);
  }

  /**
   * The value MIN / MAX choose: the least / greatest `key` — compared as before. Equal
   * keys from DIFFERENT terms (5 and "5", "42"^^xsd:integer and "42.0"^^xsd:decimal)
   * are ordered by the term's N-Triples form, so the answer does not depend on the
   * order the solutions arrive in (a pruned and a full store give the same term).
   */
  private computeExtreme(values: GroupValue[], aggregation: "min" | "max"): GroupValue | undefined {
    if (values.length === 0) return undefined;
    // Numeric comparison only when EVERY key is numeric — see asAllNumeric.
    const nums = this.asAllNumeric(values.map((v) => v.key));
    const keys = nums ?? values.map((v) => String(v.key));
    const ties = values.map((v) => String(this.groupValueTerm(v.term) ?? ""));
    let best = 0;
    for (let i = 1; i < keys.length; i++) {
      const order =
        keys[i] < keys[best] ? -1 : keys[i] > keys[best] ? 1 : ties[i] < ties[best] ? -1 : ties[i] > ties[best] ? 1 : 0;
      if (aggregation === "min" ? order < 0 : order > 0) best = i;
    }
    return values[best];
  }

  /**
   * The term an aggregate answers for a group value: an RDF term as it is. A JS value
   * (of a BIND or an expression) carries no RDF type the engine knows (ems__Bug
   * 864dc82a), so it answers as before: a number as xsd:decimal, anything else as its
   * text in xsd:string. ⛔ Not "the literal of its JS kind" (integer / boolean): a whole
   * result of a division — ROUND(?marked * 1000 / ?days) / 10, xsd:decimal by SPARQL —
   * would turn xsd:integer in stored queries that answer right today. The price: sameTerm
   * applies the JS-kind rule, so HAVING (sameTerm(MAX(?n + 1), 43)) is false, as before.
   * The empty string is a value the engine keeps as the JS string "" (Literal("") throws;
   * BIND("") holds it the same way), so it answers "" — it used to fail the whole query.
   */
  private groupValueTerm(term: unknown): RDFObject | string | undefined {
    if (term instanceof Literal || term instanceof IRI || term instanceof BlankNode || term instanceof QuotedTriple) {
      return term;
    }
    if (typeof term === "number") return new Literal(String(term), XSD_DECIMAL);
    const text = String(term);
    if (text === "") return "";
    return new Literal(text, XSD_STRING);
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
      // Second column for a two-argument aggregate. Evaluated per solution like the
      // first, and left undefined when the aggregate takes one column — so every
      // existing aggregate sees exactly the call it saw before #3994.
      let value2: Term | undefined = undefined;
      if (expr.expression2) {
        const evaluated2 = this.evaluateExpression(expr.expression2, solution);
        value2 = evaluated2 === undefined ? null : (evaluated2 as Term);
      }

      aggregate.step(state, value, value2);
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
   * The values of a MIN / MAX / SAMPLE argument, each with the term it came from.
   * A variable gives its bound term; any other expression the value FilterExecutor
   * evaluates it to — a term (COALESCE(?n, 0), "x"@en) or a JS primitive. `key` is the
   * term's text — what evaluateExpression gives a variable — so MIN / MAX compare
   * "42"^^xsd:integer as 42, not as its N-Triples string.
   */
  private extractGroupValues(expr: AggregateExpression, solutions: SolutionMapping[]): GroupValue[] {
    const argument = expr.expression;
    if (!argument) return solutions.map(() => ({ term: 1, key: 1 }));

    const values: GroupValue[] = [];
    for (const solution of solutions) {
      let term: unknown;
      if (argument.type === "variable") {
        term = solution.get((argument as import("../algebra/AlgebraOperation").VariableExpression).name);
      } else {
        try {
          term = this.filterExecutor.evaluateExpression(argument, solution);
        } catch {
          // An evaluation error leaves the value out (SPARQL 1.1 §18.5.1).
          term = undefined;
        }
      }
      if (term === undefined || term === null) continue;
      const key = typeof term === "object" && "value" in term ? (term as { value: unknown }).value : term;
      values.push({ term, key });
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
      const value = this.filterExecutor.evaluateExpression(expr, solution);
      // A language-tagged constant now evaluates to its Literal (ems__Bug 97ebe042);
      // the aggregates read its text, as they do for a variable bound to one.
      if (value instanceof Literal && value.language) return value.value;
      return value;
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
   * Strict numeric coercion for MIN/MAX (computeExtreme).
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

  private computeGroupConcat(values: unknown[], separator: string, distinct: boolean): string {
    let strs = values.map((v) => String(v));

    if (distinct) {
      strs = [...new Set(strs)];
    }

    return strs.join(separator);
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
        // MIN / MAX / SAMPLE of no values is unbound (SPARQL 1.1 §18.5.1), so the
        // variable is left out. It used to build Literal(""), which throws "Literal
        // value cannot be empty" and failed the whole query — reached far more often
        // once a FILTER over an unbound parameter keeps no rows (ems__Bug 37c80e59).
        case "min":
        case "max":
        case "sample":
          break;
        default:
          // Exhaustive check handled by TypeScript - unreachable for StandardAggregation
          result.set(aggregate.variable, new Literal("", XSD_STRING));
      }
    }

    return result;
  }
}
