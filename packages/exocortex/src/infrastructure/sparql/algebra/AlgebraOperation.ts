export type AlgebraOperation =
  | BGPOperation
  | FilterOperation
  | JoinOperation
  | LeftJoinOperation
  | UnionOperation
  | MinusOperation
  | ValuesOperation
  | ProjectOperation
  | OrderByOperation
  | SliceOperation
  | DistinctOperation
  | ReducedOperation
  | GroupOperation
  | ExtendOperation
  | SubqueryOperation
  | ConstructOperation
  | AskOperation
  | ServiceOperation
  | GraphOperation;

export interface BGPOperation {
  type: "bgp";
  triples: Triple[];
}

export interface Triple {
  subject: TripleElement;
  predicate: TripleElement | PropertyPath;
  object: TripleElement;
}

export type TripleElement = Variable | IRI | Literal | BlankNode;

/**
 * Property path expression for SPARQL 1.1 property paths.
 * Supports: sequence (/), alternative (|), inverse (^),
 * oneOrMore (+), zeroOrMore (*), zeroOrOne (?)
 */
export type PropertyPath =
  | SequencePath
  | AlternativePath
  | InversePath
  | OneOrMorePath
  | ZeroOrMorePath
  | ZeroOrOnePath;

export interface SequencePath {
  type: "path";
  pathType: "/";
  items: (IRI | PropertyPath)[];
}

export interface AlternativePath {
  type: "path";
  pathType: "|";
  items: (IRI | PropertyPath)[];
}

export interface InversePath {
  type: "path";
  pathType: "^";
  items: [IRI | PropertyPath]; // Single item
}

export interface OneOrMorePath {
  type: "path";
  pathType: "+";
  items: [IRI | PropertyPath]; // Single item
}

export interface ZeroOrMorePath {
  type: "path";
  pathType: "*";
  items: [IRI | PropertyPath]; // Single item
}

export interface ZeroOrOnePath {
  type: "path";
  pathType: "?";
  items: [IRI | PropertyPath]; // Single item
}

export interface Variable {
  type: "variable";
  value: string;
}

export interface IRI {
  type: "iri";
  value: string;
}

export interface Literal {
  type: "literal";
  value: string;
  datatype?: string;
  language?: string;
}

export interface BlankNode {
  type: "blank";
  value: string;
}

export interface FilterOperation {
  type: "filter";
  expression: Expression;
  input: AlgebraOperation;
}

export type Expression =
  | ComparisonExpression
  | LogicalExpression
  | ArithmeticExpression
  | FunctionCallExpression
  | RawFunctionCallExpression
  | VariableExpression
  | LiteralExpression
  | ExistsExpression
  | InExpression;

export interface ComparisonExpression {
  type: "comparison";
  operator: "=" | "!=" | "<" | ">" | "<=" | ">=";
  left: Expression;
  right: Expression;
}

export interface LogicalExpression {
  type: "logical";
  operator: "&&" | "||" | "!";
  operands: Expression[];
}

export interface ArithmeticExpression {
  type: "arithmetic";
  operator: "+" | "-" | "*" | "/";
  left: Expression;
  right: Expression;
}

export interface FunctionCallExpression {
  type: "function";
  function: string;
  args: Expression[];
}

// Raw sparqljs format - used for direct SELECT expressions before algebra translation
export interface RawFunctionCallExpression {
  type: "functionCall";
  function: string | { termType: string; value: string };
  args: Expression[];
}

export interface VariableExpression {
  type: "variable";
  name: string;
}

export interface LiteralExpression {
  type: "literal";
  value: string | number | boolean;
  datatype?: string;
}

export interface ExistsExpression {
  type: "exists";
  negated: boolean;
  pattern: AlgebraOperation;
}

/**
 * IN / NOT IN expression for set membership testing.
 * SPARQL 1.1 Section 17.4.1.5: Tests whether a value is in a list of values.
 *
 * Example:
 * ```sparql
 * FILTER(?status IN ("active", "pending", "review"))
 * FILTER(?priority NOT IN (1, 2))
 * ```
 *
 * Semantics:
 * - IN returns true if the expression equals any value in the list
 * - NOT IN returns true if the expression does not equal any value in the list
 * - Comparison uses RDF term equality (=)
 */
export interface InExpression {
  type: "in";
  /** The expression being tested */
  expression: Expression;
  /** List of values to test against */
  list: Expression[];
  /** True for NOT IN, false for IN */
  negated: boolean;
}

export interface JoinOperation {
  type: "join";
  left: AlgebraOperation;
  right: AlgebraOperation;
}

export interface LeftJoinOperation {
  type: "leftjoin";
  left: AlgebraOperation;
  right: AlgebraOperation;
  expression?: Expression;
}

export interface UnionOperation {
  type: "union";
  left: AlgebraOperation;
  right: AlgebraOperation;
}

/**
 * MINUS operation for set difference.
 * Removes solutions from left that are compatible with any solution in right.
 *
 * Semantics (SPARQL 1.1):
 * - Two solutions are compatible if shared variables have the same values
 * - If no variables are shared, solutions are always compatible (MINUS removes nothing)
 * - Different from FILTER NOT EXISTS which evaluates patterns per-solution
 *
 * Example:
 * SELECT ?task WHERE {
 *   ?task a ems:Task .
 *   MINUS { ?task ems:status "done" }
 * }
 * Returns all tasks except those with status "done"
 */
export interface MinusOperation {
  type: "minus";
  left: AlgebraOperation;
  right: AlgebraOperation;
}

/**
 * VALUES operation for inline data injection.
 * Provides explicit value bindings that are joined with the query pattern.
 *
 * SPARQL 1.1 spec: VALUES allows specifying an inline table of values
 * that behave like a virtual table in the query.
 *
 * Each binding in the bindings array represents a single row of values.
 * UNDEF is represented by omitting the variable from the binding object.
 *
 * Example:
 * ```sparql
 * SELECT ?task ?status WHERE {
 *   VALUES ?status { "active" "pending" }
 *   ?task ems:status ?status .
 * }
 * ```
 *
 * Multi-variable example:
 * ```sparql
 * SELECT ?name ?role WHERE {
 *   VALUES (?name ?role) {
 *     ("Alice" "admin")
 *     ("Bob" "editor")
 *   }
 *   ?person foaf:name ?name .
 *   ?person schema:role ?role .
 * }
 * ```
 *
 * UNDEF example (variable omitted from binding):
 * ```sparql
 * VALUES (?x ?y) {
 *   (1 2)
 *   (UNDEF 3)  # ?x is unbound for this row
 * }
 * ```
 */
export interface ValuesOperation {
  type: "values";
  /** Variable names (without ? prefix) that are bound by this VALUES clause */
  variables: string[];
  /**
   * Array of bindings, each representing a row of values.
   * Each binding maps variable names to their bound terms.
   * UNDEF is represented by omitting the variable from the binding.
   */
  bindings: ValuesBinding[];
}

/**
 * A single row of variable bindings in a VALUES clause.
 * Maps variable names (without ? prefix) to their bound values.
 * UNDEF is represented by the absence of the variable key.
 */
export interface ValuesBinding {
  [variable: string]: ValuesBindingValue;
}

/**
 * A value in a VALUES binding - can be an IRI or Literal.
 * BlankNodes are not typically used in VALUES clauses.
 */
export type ValuesBindingValue = IRI | Literal;

export interface ProjectOperation {
  type: "project";
  variables: string[];
  input: AlgebraOperation;
}

export interface OrderByOperation {
  type: "orderby";
  comparators: OrderComparator[];
  input: AlgebraOperation;
}

export interface OrderComparator {
  expression: Expression;
  descending: boolean;
}

export interface SliceOperation {
  type: "slice";
  offset?: number;
  limit?: number;
  input: AlgebraOperation;
}

export interface DistinctOperation {
  type: "distinct";
  input: AlgebraOperation;
}

/**
 * REDUCED solution modifier.
 * SPARQL 1.1 spec allows implementations to eliminate some or all duplicates.
 * This implementation treats REDUCED identically to DISTINCT (allowed by spec).
 *
 * SPARQL 1.1 Query Language Section 15.3:
 * "REDUCED can be viewed as a hint to the query engine that duplicates
 * may be eliminated, but it is not required to do so."
 */
export interface ReducedOperation {
  type: "reduced";
  input: AlgebraOperation;
}

export interface GroupOperation {
  type: "group";
  variables: string[];
  aggregates: AggregateBinding[];
  input: AlgebraOperation;
}

export interface AggregateBinding {
  variable: string;
  expression: AggregateExpression;
}

export interface AggregateExpression {
  type: "aggregate";
  aggregation: "count" | "sum" | "avg" | "min" | "max" | "group_concat";
  expression?: Expression;
  distinct: boolean;
  separator?: string;
}

export interface ExtendOperation {
  type: "extend";
  variable: string;
  expression: Expression | AggregateExpression;
  input: AlgebraOperation;
}

/**
 * Subquery operation for nested SELECT queries.
 * A subquery is a complete SELECT query that produces solution mappings
 * which are then joined with the outer query.
 *
 * Example:
 * SELECT ?name WHERE {
 *   { SELECT ?x WHERE { ?x :hasAge ?age } ORDER BY ?age LIMIT 10 }
 *   ?x :hasName ?name .
 * }
 */
export interface SubqueryOperation {
  type: "subquery";
  /** The complete algebra tree for the inner SELECT query */
  query: AlgebraOperation;
}

/**
 * CONSTRUCT operation for generating RDF triples from query results.
 * Applies a template to solution mappings to produce derived triples.
 *
 * SPARQL 1.1 spec: CONSTRUCT queries return RDF triples constructed
 * by substituting variables in a template graph pattern with values
 * from the solutions to the WHERE clause.
 *
 * Example:
 * ```sparql
 * CONSTRUCT {
 *   ?task exo:Sleep_durationMinutes ?duration .
 * }
 * WHERE {
 *   ?task ems:Effort_startTimestamp ?start .
 *   ?task ems:Effort_endTimestamp ?end .
 *   BIND((SECONDS(?end) - SECONDS(?start)) / 60 AS ?duration)
 * }
 * ```
 */
export interface ConstructOperation {
  type: "construct";
  /** The triple template patterns to instantiate with solution bindings */
  template: Triple[];
  /** The WHERE clause algebra that produces solution mappings */
  where: AlgebraOperation;
}

/**
 * ASK operation for existence testing.
 * Returns a boolean indicating whether the WHERE pattern matches any solutions.
 *
 * SPARQL 1.1 spec (Section 16.3): ASK queries test whether a pattern matches
 * and return true if there is at least one solution, false otherwise.
 * No bindings are returned, only the boolean result.
 *
 * Example:
 * ```sparql
 * ASK WHERE {
 *   ?task a ems:Task .
 *   ?task ems:status "done" .
 * }
 * ```
 * Returns true if any task has status "done", false otherwise.
 */
export interface AskOperation {
  type: "ask";
  /** The WHERE clause algebra pattern to test for existence */
  where: AlgebraOperation;
}

/**
 * SERVICE operation for federated queries.
 * Executes a graph pattern against a remote SPARQL endpoint.
 *
 * SPARQL 1.1 Federated Query:
 * https://www.w3.org/TR/sparql11-federated-query/
 *
 * The SERVICE clause allows querying external SPARQL endpoints within
 * a local query. Results from the remote endpoint are joined with
 * local query patterns.
 *
 * Example:
 * ```sparql
 * SELECT ?s ?label ?dbpediaLabel
 * WHERE {
 *   ?s <label> ?label .
 *   SERVICE <http://dbpedia.org/sparql> {
 *     ?s rdfs:label ?dbpediaLabel .
 *     FILTER(LANG(?dbpediaLabel) = 'en')
 *   }
 * }
 * ```
 *
 * SILENT keyword:
 * When SILENT is specified, errors from the remote endpoint are suppressed
 * and the SERVICE pattern returns an empty result set instead of failing.
 *
 * Example with SILENT:
 * ```sparql
 * SELECT ?s ?name WHERE {
 *   ?s a :Person .
 *   SERVICE SILENT <http://example.org/sparql> {
 *     ?s foaf:name ?name .
 *   }
 * }
 * ```
 */
export interface ServiceOperation {
  type: "service";
  /** The URI of the remote SPARQL endpoint */
  endpoint: string;
  /** The graph pattern to execute at the remote endpoint */
  pattern: AlgebraOperation;
  /** If true, errors from the remote endpoint are suppressed */
  silent: boolean;
}

/**
 * GRAPH operation for named graph patterns.
 * Evaluates a graph pattern against a specific named graph in the dataset.
 *
 * SPARQL 1.1 spec Section 13.3:
 * https://www.w3.org/TR/sparql11-query/#queryDataset
 *
 * The GRAPH keyword restricts pattern matching to a specific named graph.
 * The graph can be specified as:
 * - A concrete IRI: GRAPH <http://example.org/graph1> { ... }
 * - A variable: GRAPH ?g { ... } (matches all named graphs, binding ?g)
 *
 * Examples:
 * ```sparql
 * # Query a specific named graph
 * SELECT ?s ?p ?o
 * WHERE {
 *   GRAPH <http://example.org/graph1> {
 *     ?s ?p ?o
 *   }
 * }
 *
 * # Query all named graphs, binding graph name to ?g
 * SELECT ?g ?s ?p ?o
 * WHERE {
 *   GRAPH ?g {
 *     ?s ?p ?o
 *   }
 * }
 * ```
 *
 * Dataset management with FROM/FROM NAMED:
 * - FROM clauses specify the default graph (merged from multiple sources)
 * - FROM NAMED clauses specify available named graphs
 * - Without FROM/FROM NAMED, all graphs in the dataset are available
 */
export interface GraphOperation {
  type: "graph";
  /**
   * The named graph to match against.
   * Can be an IRI (concrete graph name) or Variable (match all named graphs).
   */
  name: IRI | Variable;
  /** The graph pattern to evaluate within the named graph */
  pattern: AlgebraOperation;
}
