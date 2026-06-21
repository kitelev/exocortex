/**
 * SPARQLParser Contract
 *
 * Defines the expected behaviors of the SPARQL parser component.
 * The obsidian-plugin relies on this for:
 * - Parsing user SPARQL queries from code blocks
 * - Validating query syntax before execution
 * - Converting parsed queries back to strings
 */

export interface SPARQLParserContractMethod {
  description: string;
  inputTypes: string[];
  outputType: string;
  mustNotThrow?: string[];
  mayThrow?: string[];
}

export interface SPARQLParserContract {
  name: "SPARQLParser";
  version: "1.0.0";

  methods: {
    parse: SPARQLParserContractMethod;
    toString: SPARQLParserContractMethod;
    getQueryType: SPARQLParserContractMethod;
    isSelectQuery: SPARQLParserContractMethod;
    isConstructQuery: SPARQLParserContractMethod;
    isAskQuery: SPARQLParserContractMethod;
    isDescribeQuery: SPARQLParserContractMethod;
  };

  behaviors: string[];
}

export const SPARQLParserContract: SPARQLParserContract = {
  name: "SPARQLParser",
  version: "1.0.0",

  methods: {
    parse: {
      description: "Parse a SPARQL query string into AST",
      inputTypes: ["string"],
      outputType: "SPARQLQuery",
      mustNotThrow: [
        "valid SELECT query",
        "valid CONSTRUCT query",
        "valid ASK query",
        "valid DESCRIBE query",
        "query with PREFIX declarations",
        "query with FILTER expressions",
        "query with OPTIONAL patterns",
        "query with UNION patterns",
        "query with VALUES clause",
        "query with ORDER BY clause",
        "query with LIMIT/OFFSET",
        "query with GROUP BY and aggregates",
        "query with BIND expressions",
        "query with subqueries",
        "query with CASE WHEN expressions",
      ],
      mayThrow: [
        "invalid SPARQL syntax",
        "unbalanced braces",
        "unknown prefix",
        "invalid keyword",
      ],
    },

    toString: {
      description: "Serialize a parsed query back to SPARQL string",
      inputTypes: ["SPARQLQuery"],
      outputType: "string",
      mustNotThrow: ["valid parsed query object"],
      mayThrow: ["malformed query object"],
    },

    getQueryType: {
      description: "Get the type of a parsed query",
      inputTypes: ["SPARQLQuery"],
      outputType: "QueryType",
      mustNotThrow: ["valid SELECT query", "valid CONSTRUCT query"],
    },

    isSelectQuery: {
      description: "Check if query is SELECT type",
      inputTypes: ["SPARQLQuery"],
      outputType: "boolean",
      mustNotThrow: ["any valid query"],
    },

    isConstructQuery: {
      description: "Check if query is CONSTRUCT type",
      inputTypes: ["SPARQLQuery"],
      outputType: "boolean",
      mustNotThrow: ["any valid query"],
    },

    isAskQuery: {
      description: "Check if query is ASK type",
      inputTypes: ["SPARQLQuery"],
      outputType: "boolean",
      mustNotThrow: ["any valid query"],
    },

    isDescribeQuery: {
      description: "Check if query is DESCRIBE type",
      inputTypes: ["SPARQLQuery"],
      outputType: "boolean",
      mustNotThrow: ["any valid query"],
    },
  },

  behaviors: [
    "parse() returns SPARQLQuery object for valid SPARQL",
    "parse() throws SPARQLParseError for invalid syntax",
    "SPARQLParseError includes line and column information when available",
    "toString(parse(query)) produces semantically equivalent query",
    "parse() supports CASE WHEN transformation to IF expressions",
    "getQueryType() returns correct type string for each query type",
    "Type guard methods return accurate boolean values",
    "parse() handles multi-line queries with proper whitespace",
    "parse() validates query structure after parsing",
  ],
};
