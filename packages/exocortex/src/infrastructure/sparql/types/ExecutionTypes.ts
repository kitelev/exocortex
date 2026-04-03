/**
 * TypeScript types for SPARQL query execution.
 *
 * These types are used by QueryExecutor, AggregateExecutor, and related
 * execution-layer modules for variable substitution, variable collection,
 * and algebra traversal during query evaluation.
 */

import type {
  AlgebraOperation,
  Triple,
  TripleElement,
  Expression,
  IRI,
  Variable,
  Literal,
} from "../algebra/AlgebraOperation";

// ---------------------------------------------------------------------------
// Variable substitution types (QueryExecutor)
// ---------------------------------------------------------------------------

/**
 * An algebra operation used as input to substituteInOperation.
 * This is typed as AlgebraOperation but the function operates on it
 * via structural duck-typing (checking .type, .input, .left, etc.).
 */
export type SubstitutableOperation = AlgebraOperation;

/**
 * The result of substituting variables in a triple element.
 * Can be the original element unchanged or a replaced term (IRI/Literal).
 */
export type SubstitutedTripleElement = TripleElement;

/**
 * A triple after variable substitution.
 * Structurally identical to Triple but may have variable positions
 * replaced with concrete values.
 */
export type SubstitutedTriple = Triple;

// ---------------------------------------------------------------------------
// Variable collection types (QueryExecutor)
// ---------------------------------------------------------------------------

/**
 * A triple element that may be a variable whose name should be collected.
 * Used by collectVarsFromElement for traversing triple patterns.
 */
export type CollectableElement = TripleElement;

/**
 * An expression tree node that may contain variable references.
 * Used by collectVarsFromExpressionTree for traversing expression trees.
 */
export type CollectableExpression = Expression;

// ---------------------------------------------------------------------------
// Algebra operation shape (for duck-typed traversal)
// ---------------------------------------------------------------------------

/**
 * Shape of an algebra operation as accessed during recursive traversal.
 * Used by substituteInOperation and collectVarsFromOperation which
 * navigate the operation tree structurally.
 *
 * This interface captures the superset of optional properties that
 * different AlgebraOperation subtypes may have.
 */
export interface TraversableOperation {
  type: string;
  triples?: Triple[];
  variables?: string[];
  variable?: string;
  input?: AlgebraOperation;
  left?: AlgebraOperation;
  right?: AlgebraOperation;
  pattern?: AlgebraOperation;
  query?: AlgebraOperation;
  where?: AlgebraOperation;
  expression?: Expression;
}

/**
 * Shape of an expression node as accessed during recursive traversal.
 * Used by substituteInExpression and collectVarsFromExpressionTree.
 */
export interface TraversableExpression {
  type: string;
  name?: string;
  pattern?: AlgebraOperation;
  left?: Expression;
  right?: Expression;
  operands?: Expression[];
  args?: Expression[];
  expression?: Expression;
  list?: Expression[];
}

// ---------------------------------------------------------------------------
// Query result value extraction
// ---------------------------------------------------------------------------

/**
 * Result of getExpressionValue: extracts a primitive value from an
 * expression and solution mapping for use in ORDER BY comparisons.
 */
export type ExpressionValue = string | number | boolean | undefined;

/**
 * Shape of an expression node used in getExpressionValue.
 * Simpler than full Expression since it only accesses .type, .name, .value.
 */
export interface ValueExpression {
  type: string;
  name?: string;
  value?: string | number | boolean;
}

// ---------------------------------------------------------------------------
// SPARQL validation types
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a parsed query for validation in SPARQLParser.
 * The parser validates that the query has the expected structure
 * before passing it to the AlgebraTranslator.
 */
export interface ValidatableQuery {
  type: string;
  queryType?: string;
  where?: unknown[];
  variables?: unknown[];
  template?: unknown[];
  values?: unknown[];
}

// ---------------------------------------------------------------------------
// Pattern type discrimination helpers
// ---------------------------------------------------------------------------

/**
 * Check if an algebra operation is a named type (used for type narrowing).
 */
export function isOperationType<T extends AlgebraOperation["type"]>(
  op: AlgebraOperation,
  type: T
): op is Extract<AlgebraOperation, { type: T }> {
  return op.type === type;
}

/**
 * Check if a triple element is a variable.
 */
export function isAlgebraVariable(element: TripleElement): element is Variable {
  return element.type === "variable";
}

/**
 * Check if a triple element is an IRI.
 */
export function isAlgebraIRI(element: TripleElement): element is IRI {
  return element.type === "iri";
}

/**
 * Check if a triple element is a literal.
 */
export function isAlgebraLiteral(element: TripleElement): element is Literal {
  return element.type === "literal";
}
