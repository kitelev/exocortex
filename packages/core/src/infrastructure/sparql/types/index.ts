/**
 * Central type exports for the SPARQL subsystem.
 *
 * Usage:
 *   import type { SparqljsExpression, ExpressionResult } from "../types";
 */

export type {
  // sparqljs AST node types
  SparqljsVariableTerm,
  SparqljsNamedNode,
  SparqljsLiteralTerm,
  SparqljsBlankNode,
  SparqljsQuad,
  SparqljsTerm,
  SparqljsSelectVariableTerm,
  SparqljsSelectExpression,
  SparqljsSelectVariable,
  SparqljsOperationExpression,
  SparqljsAggregateExpression,
  SparqljsFunctionCallExpression,
  SparqljsExpression,
  SparqljsTriple,
  SparqljsPropertyPath,
  SparqljsBgpPattern,
  SparqljsFilterPattern,
  SparqljsOptionalPattern,
  SparqljsUnionPattern,
  SparqljsMinusPattern,
  SparqljsGroupPattern,
  SparqljsValuesPattern,
  SparqljsValuesRow,
  SparqljsBindPattern,
  SparqljsServicePattern,
  SparqljsGraphPattern,
  SparqljsSubqueryPattern,
  SparqljsPattern,
  SparqljsOrdering,
  SparqljsGrouping,
} from "./SparqljsAstTypes";

export type {
  // Expression evaluation types
  RDFTermValue,
  ExpressionResult,
  AggregateValue,
  ArithmeticResult,
  RDFTermLike,
  ExistsEvaluator,
  ExpressionEvaluationContext,
} from "./ExpressionTypes";

export { isRDFTermLike } from "./ExpressionTypes";

export type {
  // Execution types
  SubstitutableOperation,
  SubstitutedTripleElement,
  SubstitutedTriple,
  CollectableElement,
  CollectableExpression,
  TraversableOperation,
  TraversableExpression,
  ExpressionValue,
  ValueExpression,
  ValidatableQuery,
} from "./ExecutionTypes";

export {
  isOperationType,
  isAlgebraVariable,
  isAlgebraIRI,
  isAlgebraLiteral,
} from "./ExecutionTypes";
