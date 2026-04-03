/**
 * TypeScript interfaces for sparqljs AST nodes.
 *
 * These types describe the raw AST that sparqljs produces when parsing
 * SPARQL queries. The AlgebraTranslator converts these into the internal
 * algebra representation (AlgebraOperation).
 *
 * The sparqljs library uses a loosely-typed AST with duck-typed nodes.
 * These interfaces provide type-safety for the translation layer without
 * depending on the incomplete @types/sparqljs definitions.
 */

// ---------------------------------------------------------------------------
// RDF Terms (sparqljs AST representation)
// ---------------------------------------------------------------------------

/**
 * A sparqljs variable term: { termType: "Variable", value: "x" }
 */
export interface SparqljsVariableTerm {
  termType: "Variable";
  value: string;
}

/**
 * A sparqljs named node (IRI): { termType: "NamedNode", value: "http://..." }
 */
export interface SparqljsNamedNode {
  termType: "NamedNode";
  value: string;
}

/**
 * A sparqljs literal term: { termType: "Literal", value: "...", datatype?: ..., language?: "en" }
 */
export interface SparqljsLiteralTerm {
  termType: "Literal";
  value: string;
  datatype?: SparqljsNamedNode;
  language?: string;
}

/**
 * A sparqljs blank node: { termType: "BlankNode", value: "b0" }
 */
export interface SparqljsBlankNode {
  termType: "BlankNode";
  value: string;
}

/**
 * A sparqljs Quad (RDF-Star quoted triple).
 */
export interface SparqljsQuad {
  termType: "Quad";
  value: string;
  subject: SparqljsTerm;
  predicate: SparqljsTerm;
  object: SparqljsTerm;
  graph: { termType: "DefaultGraph"; value: "" };
}

/**
 * Union of all sparqljs term types.
 */
export type SparqljsTerm =
  | SparqljsVariableTerm
  | SparqljsNamedNode
  | SparqljsLiteralTerm
  | SparqljsBlankNode
  | SparqljsQuad;

// ---------------------------------------------------------------------------
// SELECT variable items
// ---------------------------------------------------------------------------

/**
 * A SELECT variable that is a simple term reference (SELECT ?x).
 */
export type SparqljsSelectVariableTerm = SparqljsVariableTerm;

/**
 * A SELECT variable with an expression alias (SELECT (expr AS ?alias)).
 */
export interface SparqljsSelectExpression {
  expression: SparqljsExpression;
  variable: SparqljsVariableTerm;
}

/**
 * Union of SELECT variable item types.
 */
export type SparqljsSelectVariable = SparqljsSelectVariableTerm | SparqljsSelectExpression;

// ---------------------------------------------------------------------------
// Expression nodes (sparqljs AST format)
// ---------------------------------------------------------------------------

/**
 * An operation expression: { type: "operation", operator: "=", args: [...] }
 */
export interface SparqljsOperationExpression {
  type: "operation";
  operator: string;
  args: SparqljsExpression[];
}

/**
 * An aggregate expression: { type: "aggregate", aggregation: "count", ... }
 */
export interface SparqljsAggregateExpression {
  type: "aggregate";
  aggregation: string | SparqljsNamedNode;
  expression?: SparqljsExpression;
  distinct?: boolean;
  separator?: string;
}

/**
 * A function call expression: { type: "functionCall", function: "str", args: [...] }
 */
export interface SparqljsFunctionCallExpression {
  type: "functionCall" | "functioncall";
  function: string | SparqljsNamedNode;
  args: SparqljsExpression[];
}

/**
 * Union of all sparqljs expression types.
 * Expressions can be operation nodes, aggregate nodes, function calls, or raw terms.
 */
export type SparqljsExpression =
  | SparqljsOperationExpression
  | SparqljsAggregateExpression
  | SparqljsFunctionCallExpression
  | SparqljsTerm;

// ---------------------------------------------------------------------------
// Pattern nodes (sparqljs AST format)
// ---------------------------------------------------------------------------

/**
 * A triple in sparqljs AST: { subject, predicate, object }
 */
export interface SparqljsTriple {
  subject: SparqljsTerm;
  predicate: SparqljsTerm | SparqljsPropertyPath;
  object: SparqljsTerm;
}

/**
 * A property path: { type: "path", pathType: "/"|"|"|"^"|"+"|"*"|"?", items: [...] }
 */
export interface SparqljsPropertyPath {
  type: "path";
  pathType: "/" | "|" | "^" | "+" | "*" | "?";
  items: (SparqljsNamedNode | SparqljsPropertyPath)[];
}

/**
 * A BGP pattern: { type: "bgp", triples: [...] }
 */
export interface SparqljsBgpPattern {
  type: "bgp";
  triples: SparqljsTriple[];
}

/**
 * A FILTER pattern: { type: "filter", expression: ..., patterns?: [...] }
 */
export interface SparqljsFilterPattern {
  type: "filter";
  expression: SparqljsExpression;
  patterns?: SparqljsPattern[];
}

/**
 * An OPTIONAL pattern: { type: "optional", patterns: [...] }
 */
export interface SparqljsOptionalPattern {
  type: "optional";
  patterns: SparqljsPattern[];
  expression?: SparqljsExpression;
}

/**
 * A UNION pattern: { type: "union", patterns: [...] }
 */
export interface SparqljsUnionPattern {
  type: "union";
  patterns: SparqljsPattern[];
}

/**
 * A MINUS pattern: { type: "minus", patterns: [...] }
 */
export interface SparqljsMinusPattern {
  type: "minus";
  patterns: SparqljsPattern[];
}

/**
 * A GROUP pattern (braces): { type: "group", patterns: [...] }
 */
export interface SparqljsGroupPattern {
  type: "group";
  patterns: SparqljsPattern[];
}

/**
 * A VALUES pattern: { type: "values", values: [...] }
 */
export interface SparqljsValuesPattern {
  type: "values";
  values: SparqljsValuesRow[];
}

/**
 * A single VALUES row: maps "?var" -> term.
 */
export type SparqljsValuesRow = Record<string, SparqljsTerm | undefined>;

/**
 * A BIND pattern: { type: "bind", variable: ..., expression: ... }
 */
export interface SparqljsBindPattern {
  type: "bind";
  variable: SparqljsVariableTerm;
  expression: SparqljsExpression;
}

/**
 * A SERVICE pattern: { type: "service", name: ..., patterns: [...], silent?: boolean }
 */
export interface SparqljsServicePattern {
  type: "service";
  name: SparqljsNamedNode;
  patterns: SparqljsPattern[];
  silent?: boolean;
}

/**
 * A GRAPH pattern: { type: "graph", name: ..., patterns: [...] }
 */
export interface SparqljsGraphPattern {
  type: "graph";
  name: SparqljsNamedNode | SparqljsVariableTerm;
  patterns: SparqljsPattern[];
}

/**
 * A subquery pattern (nested SELECT): { type: "query", queryType: "SELECT", ... }
 */
export interface SparqljsSubqueryPattern {
  type: "query";
  queryType: "SELECT";
  variables: SparqljsSelectVariable[];
  where?: SparqljsPattern[];
  order?: SparqljsOrdering[];
  group?: SparqljsGrouping[];
  having?: SparqljsExpression[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  reduced?: boolean;
}

/**
 * Union of all sparqljs pattern types.
 */
export type SparqljsPattern =
  | SparqljsBgpPattern
  | SparqljsFilterPattern
  | SparqljsOptionalPattern
  | SparqljsUnionPattern
  | SparqljsMinusPattern
  | SparqljsGroupPattern
  | SparqljsValuesPattern
  | SparqljsBindPattern
  | SparqljsServicePattern
  | SparqljsGraphPattern
  | SparqljsSubqueryPattern;

// ---------------------------------------------------------------------------
// Query modifiers (ORDER BY, GROUP BY)
// ---------------------------------------------------------------------------

/**
 * An ORDER BY entry: { expression: ..., descending?: boolean }
 */
export interface SparqljsOrdering {
  expression: SparqljsExpression;
  descending?: boolean;
}

/**
 * A GROUP BY entry: { expression: ... }
 */
export interface SparqljsGrouping {
  expression: SparqljsExpression;
}
