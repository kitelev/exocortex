/**
 * QueryExecutor Contract
 *
 * Defines the expected behaviors of the SPARQL query executor.
 * The obsidian-plugin relies on this for:
 * - Executing SPARQL queries against the triple store
 * - Processing various SPARQL algebra operations
 * - Streaming results for large datasets
 */

export interface QueryExecutorContractMethod {
  description: string;
  inputTypes: string[];
  outputType: string;
  mustNotThrow?: string[];
  mayThrow?: string[];
}

export interface QueryExecutorContract {
  name: "QueryExecutor";
  version: "1.0.0";

  methods: {
    execute: QueryExecutorContractMethod;
    executeAll: QueryExecutorContractMethod;
    executeConstruct: QueryExecutorContractMethod;
    executeAsk: QueryExecutorContractMethod;
    isConstructQuery: QueryExecutorContractMethod;
    isAskQuery: QueryExecutorContractMethod;
  };

  supportedOperations: string[];

  behaviors: string[];
}

export const QueryExecutorContract: QueryExecutorContract = {
  name: "QueryExecutor",
  version: "1.0.0",

  methods: {
    execute: {
      description: "Execute algebra operation and stream solution mappings",
      inputTypes: ["AlgebraOperation"],
      outputType: "AsyncIterableIterator<SolutionMapping>",
      mustNotThrow: [
        "BGP operation",
        "FILTER operation",
        "JOIN operation",
        "LEFT JOIN operation",
        "UNION operation",
        "MINUS operation",
        "VALUES operation",
        "PROJECT operation",
        "ORDER BY operation",
        "SLICE operation",
        "DISTINCT operation",
        "REDUCED operation",
        "GROUP operation",
        "EXTEND operation",
        "SUBQUERY operation",
        "GRAPH operation",
      ],
      mayThrow: [
        "unknown operation type",
        "SERVICE operation without endpoint",
      ],
    },

    executeAll: {
      description: "Execute operation and collect all results",
      inputTypes: ["AlgebraOperation"],
      outputType: "Promise<SolutionMapping[]>",
      mustNotThrow: [
        "any supported operation",
      ],
    },

    executeConstruct: {
      description: "Execute CONSTRUCT query and return triples",
      inputTypes: ["ConstructOperation"],
      outputType: "Promise<Triple[]>",
      mustNotThrow: [
        "valid CONSTRUCT operation",
        "CONSTRUCT with no matching patterns (empty result)",
      ],
      mayThrow: [
        "non-CONSTRUCT operation passed",
      ],
    },

    executeAsk: {
      description: "Execute ASK query and return boolean",
      inputTypes: ["AskOperation"],
      outputType: "Promise<boolean>",
      mustNotThrow: [
        "valid ASK operation",
        "ASK with no matches (returns false)",
        "ASK with matches (returns true)",
      ],
      mayThrow: [
        "non-ASK operation passed",
      ],
    },

    isConstructQuery: {
      description: "Check if operation is CONSTRUCT type",
      inputTypes: ["AlgebraOperation"],
      outputType: "boolean",
      mustNotThrow: ["any operation"],
    },

    isAskQuery: {
      description: "Check if operation is ASK type",
      inputTypes: ["AlgebraOperation"],
      outputType: "boolean",
      mustNotThrow: ["any operation"],
    },
  },

  supportedOperations: [
    "bgp - Basic Graph Pattern matching",
    "filter - Filter expressions evaluation",
    "join - Inner join of two patterns",
    "leftjoin - Left outer join (OPTIONAL)",
    "union - Union of two patterns",
    "minus - Set difference",
    "values - Inline data binding",
    "project - Variable projection",
    "orderby - Result ordering",
    "slice - LIMIT and OFFSET",
    "distinct - Duplicate elimination",
    "reduced - Duplicate reduction (spec-compliant)",
    "group - GROUP BY with aggregates",
    "extend - BIND expression evaluation",
    "subquery - Nested SELECT query",
    "service - Federated query (optional)",
    "graph - Named graph pattern",
    "construct - CONSTRUCT template application",
    "ask - Boolean existence check",
  ],

  behaviors: [
    "execute() returns empty iterator for empty triple store",
    "execute() respects LIMIT clause in slice operation",
    "execute() respects OFFSET clause in slice operation",
    "executeAll() collects all results from execute()",
    "executeConstruct() applies template to all matching solutions",
    "executeAsk() returns true on first match (early termination)",
    "executeAsk() returns false when no matches found",
    "BGP matches triples using pattern variables",
    "FILTER evaluates expressions and excludes non-matching solutions",
    "JOIN produces cross-product filtered by compatible bindings",
    "LEFT JOIN preserves left side even when right has no match",
    "UNION combines results from both patterns",
    "MINUS excludes solutions that match right pattern",
    "VALUES injects inline bindings",
    "ORDER BY sorts by specified comparators",
    "DISTINCT eliminates duplicate solutions",
    "GROUP BY aggregates solutions by grouping variables",
    "EXTEND binds new variables via expressions",
    "EXISTS evaluates nested pattern existence",
    "Solutions are streamed (not all collected in memory)",
  ],
};
