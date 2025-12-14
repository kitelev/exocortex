/**
 * TypeScript type definitions for sparqljs AST nodes.
 *
 * These types provide more specific typing for working with the sparqljs parser.
 * The sparqljs library parses SPARQL queries into an AST, and these types
 * help bridge between the @types/sparqljs definitions and our internal algebra.
 */

import type * as sparqljs from "sparqljs";

// Re-export core types from sparqljs for convenient imports
export type {
  SelectQuery,
  ConstructQuery,
  AskQuery,
  DescribeQuery,
  SparqlQuery,
  Pattern,
  Triple,
  Expression,
  OperationExpression,
  FunctionCallExpression,
  AggregateExpression as SparqljsAggregateExpression,
  Variable,
  VariableTerm,
  IriTerm,
  LiteralTerm,
  BlankTerm,
  Grouping,
  Ordering,
  BgpPattern,
  FilterPattern,
  OptionalPattern,
  UnionPattern,
  MinusPattern,
  GroupPattern,
  ServicePattern,
  GraphPattern,
  BindPattern,
  ValuesPattern,
  PropertyPath,
  Term,
  ValuePatternRow,
} from "sparqljs";

/**
 * Union type for SELECT variable items (can be a term or an expression).
 */
export type SelectVariable = sparqljs.Variable;

/**
 * Values binding row from sparqljs AST.
 */
export type ValuesBindingRow = sparqljs.ValuePatternRow;

/**
 * Type guard to check if a variable is a VariableExpression (has both expression and variable).
 */
export function isVariableExpression(
  v: unknown
): v is { expression: sparqljs.Expression; variable: sparqljs.VariableTerm } {
  return (
    typeof v === "object" &&
    v !== null &&
    "expression" in v &&
    "variable" in v
  );
}

/**
 * Type guard to check if a node is a Variable term.
 */
export function isVariableTerm(node: unknown): node is sparqljs.VariableTerm {
  return (
    typeof node === "object" &&
    node !== null &&
    "termType" in node &&
    (node as { termType: string }).termType === "Variable"
  );
}

/**
 * Type guard to check if a node is a NamedNode (IRI).
 */
export function isNamedNode(node: unknown): node is sparqljs.IriTerm {
  return (
    typeof node === "object" &&
    node !== null &&
    "termType" in node &&
    (node as { termType: string }).termType === "NamedNode"
  );
}

/**
 * Type guard to check if a node is a Literal.
 */
export function isLiteral(node: unknown): node is sparqljs.LiteralTerm {
  return (
    typeof node === "object" &&
    node !== null &&
    "termType" in node &&
    (node as { termType: string }).termType === "Literal"
  );
}

/**
 * Type guard to check if a node is a property path.
 */
export function isPropertyPath(node: unknown): node is sparqljs.PropertyPath {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    (node as { type: string }).type === "path"
  );
}

/**
 * Type guard to check if a node is an aggregate expression.
 */
export function isAggregateExpression(
  node: unknown
): node is sparqljs.AggregateExpression {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    (node as { type: string }).type === "aggregate"
  );
}

/**
 * Type guard to check if a node is an operation expression.
 */
export function isOperationExpression(
  node: unknown
): node is sparqljs.OperationExpression {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    (node as { type: string }).type === "operation"
  );
}

/**
 * Type guard to check if a node is a function call expression.
 */
export function isFunctionCallExpression(
  node: unknown
): node is sparqljs.FunctionCallExpression {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    ((node as { type: string }).type === "functionCall" ||
      (node as { type: string }).type === "functioncall")
  );
}
