/**
 * TypeScript types for expression evaluation in the SPARQL engine.
 *
 * These types capture the runtime values that flow through the expression
 * evaluator. SPARQL expressions can produce RDF terms, primitive values,
 * or structured objects like Literals with datatype information.
 */

import type { IRI } from "../../../domain/models/rdf/IRI";
import type { Literal } from "../../../domain/models/rdf/Literal";
import type { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type { Expression, AlgebraOperation } from "../algebra/AlgebraOperation";
import type { SolutionMapping } from "../SolutionMapping";

// ---------------------------------------------------------------------------
// Expression evaluation result types
// ---------------------------------------------------------------------------

/**
 * An RDF term that can appear in a solution mapping.
 * This is the domain-level representation (not the sparqljs AST level).
 */
export type RDFTermValue = IRI | Literal | BlankNode;

/**
 * A value that a SPARQL expression can evaluate to.
 *
 * In SPARQL, expression results can be:
 * - RDF terms (IRI, Literal, BlankNode)
 * - Primitive values (string, number, boolean) from literal coercion
 * - undefined/null for unbound or error cases
 */
export type ExpressionResult = RDFTermValue | string | number | boolean | undefined | null;

/**
 * Values that can appear in aggregate computation arrays.
 * Similar to ExpressionResult but excludes null (filtered out by extractValues).
 */
export type AggregateValue = RDFTermValue | string | number | boolean;

/**
 * Result of evaluating an arithmetic expression.
 * Can be a plain number or a structured Literal (for date/duration arithmetic).
 */
export type ArithmeticResult = number | Literal;

// ---------------------------------------------------------------------------
// Type guard helpers for expression evaluation
// ---------------------------------------------------------------------------

/**
 * An RDF term-like object with a value property.
 * Used in type guards to safely access .value on unknown objects.
 */
export interface RDFTermLike {
  value: string;
  termType?: string;
  datatype?: { value: string };
  language?: string;
  id?: string;
}

/**
 * Check whether an unknown value is an RDF-term-like object (has .value).
 */
export function isRDFTermLike(value: unknown): value is RDFTermLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value
  );
}

// ---------------------------------------------------------------------------
// Function evaluation context (used by FunctionRegistry)
// ---------------------------------------------------------------------------

/**
 * Callback type for evaluating EXISTS patterns.
 * The callback executes the pattern with the given solution bindings
 * and returns true if at least one result is found.
 */
export type ExistsEvaluator = (
  pattern: AlgebraOperation,
  solution: SolutionMapping
) => Promise<boolean>;

/**
 * Context provided to function handlers in the FunctionRegistry.
 * Re-exported here for centralized type visibility.
 */
export interface ExpressionEvaluationContext {
  evaluateExpression: (expr: Expression, solution: SolutionMapping) => ExpressionResult;
  getTermFromExpression: (expr: Expression, solution: SolutionMapping) => unknown;
  getStringValue: (value: ExpressionResult) => string;
  solution: SolutionMapping;
  isYearMonthDurationValue: (value: ExpressionResult) => boolean;
  isDayTimeDurationValue: (value: ExpressionResult) => boolean;
}
