import * as sparqljs from "sparqljs";
import { CaseWhenTransformer, CaseWhenTransformerError } from "./CaseWhenTransformer";

export class SPARQLParseError extends Error {
  public readonly line?: number;
  public readonly column?: number;

  constructor(message: string, line?: number, column?: number, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "SPARQLParseError";
    this.line = line;
    this.column = column;
  }
}

export type SPARQLQuery = sparqljs.SparqlQuery;
export type SelectQuery = sparqljs.SelectQuery;
export type ConstructQuery = sparqljs.ConstructQuery;
export type AskQuery = sparqljs.AskQuery;
export type DescribeQuery = sparqljs.DescribeQuery;
export type Update = sparqljs.Update;
export type UpdateOperation = sparqljs.UpdateOperation;
export type QueryType = "SELECT" | "CONSTRUCT" | "ASK" | "DESCRIBE";

export class SPARQLParser {
  private readonly parser: InstanceType<typeof sparqljs.Parser>;
  private readonly generator: InstanceType<typeof sparqljs.Generator>;
  private readonly caseWhenTransformer: CaseWhenTransformer;

  constructor() {
    // Enable SPARQL-Star (RDF-Star) support for triple patterns in subject/object positions
    // SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
    this.parser = new sparqljs.Parser({ sparqlStar: true });
    this.generator = new sparqljs.Generator();
    this.caseWhenTransformer = new CaseWhenTransformer();
  }

  parse(queryString: string): SPARQLQuery {
    try {
      // Transform CASE WHEN expressions to IF expressions before parsing
      const transformedQuery = this.caseWhenTransformer.transform(queryString);
      const parsed = this.parser.parse(transformedQuery);
      this.validateQuery(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof CaseWhenTransformerError) {
        throw new SPARQLParseError(error.message);
      }
      if (error instanceof Error) {
        const match = error.message.match(/line (\d+), column (\d+)/);
        const line = match ? parseInt(match[1], 10) : undefined;
        const column = match ? parseInt(match[2], 10) : undefined;
        throw new SPARQLParseError(
          `SPARQL syntax error: ${error.message}`,
          line,
          column,
          error,
        );
      }
      throw error;
    }
  }

  toString(query: SPARQLQuery): string {
    try {
      return this.generator.stringify(query);
    } catch (error) {
      if (error instanceof Error) {
        throw new SPARQLParseError(`Failed to serialize SPARQL query: ${error.message}`, undefined, undefined, error);
      }
      throw error;
    }
  }

  getQueryType(query: SPARQLQuery): QueryType {
    if ("queryType" in query && query.type === "query") {
      return query.queryType as QueryType;
    }
    throw new SPARQLParseError("Query does not have a valid queryType property");
  }

  isSelectQuery(query: SPARQLQuery): query is SelectQuery {
    return "queryType" in query && query.type === "query" && query.queryType === "SELECT";
  }

  isConstructQuery(query: SPARQLQuery): query is ConstructQuery {
    return "queryType" in query && query.type === "query" && query.queryType === "CONSTRUCT";
  }

  isAskQuery(query: SPARQLQuery): query is AskQuery {
    return "queryType" in query && query.type === "query" && query.queryType === "ASK";
  }

  isDescribeQuery(query: SPARQLQuery): query is DescribeQuery {
    return "queryType" in query && query.type === "query" && query.queryType === "DESCRIBE";
  }

  /**
   * Check if a parsed query is an UPDATE request.
   * UPDATE requests contain one or more update operations (INSERT DATA, DELETE DATA, etc.)
   */
  isUpdateQuery(query: SPARQLQuery): query is Update {
    return query.type === "update";
  }

  /**
   * Check if an update operation is an INSERT DATA operation.
   * INSERT DATA adds static triples without a WHERE clause.
   */
  isInsertDataOperation(operation: UpdateOperation): boolean {
    return "updateType" in operation && operation.updateType === "insert";
  }

  /**
   * Check if an update operation is a DELETE DATA operation.
   * DELETE DATA removes static triples without a WHERE clause.
   */
  isDeleteDataOperation(operation: UpdateOperation): boolean {
    return "updateType" in operation && operation.updateType === "delete";
  }

  private validateQuery(query: any): void {
    if (!query || typeof query !== "object") {
      throw new SPARQLParseError("Invalid query: not an object");
    }

    if (query.type !== "query" && query.type !== "update") {
      throw new SPARQLParseError(`Invalid type: expected "query" or "update", got "${query.type}"`);
    }

    if (query.type === "query") {
      const validQueryTypes = ["SELECT", "CONSTRUCT", "ASK", "DESCRIBE"];
      if (!validQueryTypes.includes(query.queryType)) {
        throw new SPARQLParseError(
          `Invalid query type: expected one of ${validQueryTypes.join(", ")}, got "${query.queryType}"`,
        );
      }
    }
  }
}
