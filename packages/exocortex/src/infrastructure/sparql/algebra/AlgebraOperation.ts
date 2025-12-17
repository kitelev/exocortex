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
  | LateralJoinOperation
  | ConstructOperation
  | AskOperation
  | DescribeOperation
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

export type TripleElement = Variable | IRI | Literal | BlankNode | QuotedTriple;

/**
 * RDF-Star Quoted Triple (SPARQL 1.2)
 * Represents a triple pattern that can appear in subject or object position.
 * Used for matching statements about statements.
 *
 * Example:
 * ```sparql
 * # Find sources that claim "Alice knows Bob"
 * SELECT ?source WHERE {
 *   << :Alice :knows :Bob >> :source ?source .
 * }
 * ```
 *
 * SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
 */
export interface QuotedTriple {
  type: "quoted";
  subject: TripleElement;
  predicate: IRI | Variable;
  object: TripleElement;
}

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
  /**
   * Base direction for bidirectional text (SPARQL 1.2).
   * Used with language-tagged literals for directional language tags.
   * Format: `"text"@lang--dir` where dir is "ltr" or "rtl".
   * @see https://w3c.github.io/rdf-dir-literal/
   */
  direction?: "ltr" | "rtl";
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

/**
 * Standard SPARQL 1.1 aggregate function names.
 */
export type StandardAggregation = "count" | "sum" | "avg" | "min" | "max" | "group_concat" | "sample";

/**
 * Custom aggregate function reference (SPARQL 1.2).
 * Contains the full IRI of the custom aggregate function.
 */
export interface CustomAggregation {
  type: "custom";
  iri: string;
}

export interface AggregateExpression {
  type: "aggregate";
  /**
   * The aggregation function to apply.
   * Can be a standard SPARQL 1.1 function name or a custom function reference.
   */
  aggregation: StandardAggregation | CustomAggregation;
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
 * LATERAL join operation for correlated subqueries (SPARQL 1.2).
 *
 * LATERAL enables the inner subquery to reference variables from the outer query,
 * creating a correlated subquery pattern. For each solution in the outer query,
 * the inner subquery is executed with those variable bindings available.
 *
 * This is fundamentally different from regular subqueries which are executed
 * independently and then joined. LATERAL subqueries are re-executed for each
 * outer solution, enabling patterns like "top N per group".
 *
 * Example - Get top 1 friend for each person:
 * ```sparql
 * SELECT ?person ?topFriend
 * WHERE {
 *   ?person a :Person .
 *   LATERAL {
 *     SELECT ?friend WHERE {
 *       ?person :knows ?friend .  # ?person comes from outer query!
 *       ?friend :score ?score .
 *     }
 *     ORDER BY DESC(?score)
 *     LIMIT 1
 *   }
 * }
 * ```
 *
 * Semantics:
 * - For each binding from the outer pattern (left side)
 * - Execute the inner subquery with that binding's variables substituted
 * - Join the inner results with the outer binding
 * - If inner produces no results, the outer binding is excluded (inner join semantics)
 *
 * SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
 */
export interface LateralJoinOperation {
  type: "lateraljoin";
  /**
   * The outer pattern that produces bindings.
   * Variables from this pattern are visible to the inner subquery.
   */
  left: AlgebraOperation;
  /**
   * The correlated subquery.
   * Can reference variables from the left/outer pattern.
   * Executed once per solution from the left pattern.
   */
  right: AlgebraOperation;
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

/**
 * DESCRIBE operation for resource description (SPARQL 1.2 extended).
 *
 * Returns all triples that describe the specified resources.
 * By default, includes triples where the resource appears as either
 * subject or object.
 *
 * SPARQL 1.2 extensions:
 * - DEPTH: Limits how many hops to follow from the initial resource
 * - SYMMETRIC: Explicitly includes both incoming and outgoing links
 *
 * Examples:
 * ```sparql
 * # Basic DESCRIBE
 * DESCRIBE <http://example.org/resource>
 *
 * # DESCRIBE with depth limit (only direct triples)
 * DESCRIBE ?x DEPTH 1 WHERE { ?x a :Person }
 *
 * # DESCRIBE with symmetric (explicit both directions)
 * DESCRIBE ?x SYMMETRIC WHERE { ?x a :Person }
 *
 * # Combined options
 * DESCRIBE ?x DEPTH 2 SYMMETRIC WHERE { ?x a :Person }
 * ```
 *
 * SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
 */
export interface DescribeOperation {
  type: "describe";
  /**
   * Resources to describe. Can be IRIs or Variables.
   * If variables, they should be bound by the WHERE clause.
   */
  resources: (IRI | Variable)[];
  /**
   * Optional WHERE clause to bind variables in resources.
   * If provided, DESCRIBE will describe all bindings for the variables.
   */
  where?: AlgebraOperation;
  /**
   * Maximum depth to follow from described resources.
   * - undefined/0: Only direct triples (resource as subject or object)
   * - 1: Direct triples plus one hop from those results
   * - 2+: Follow N hops from the initial resource
   */
  depth?: number;
  /**
   * Whether to include both incoming and outgoing triples.
   * Default behavior (false/undefined) already includes both directions,
   * but SYMMETRIC makes this explicit per SPARQL 1.2.
   */
  symmetric?: boolean;
}
