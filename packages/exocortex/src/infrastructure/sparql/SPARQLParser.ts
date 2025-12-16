import * as sparqljs from "sparqljs";
import { CaseWhenTransformer, CaseWhenTransformerError } from "./CaseWhenTransformer";
import { LateralTransformer, LateralTransformerError } from "./LateralTransformer";
import {
  PrefixStarTransformer,
  PrefixStarTransformerError,
  VocabularyResolver,
} from "./PrefixStarTransformer";

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

/**
 * Configuration options for the SPARQL parser.
 */
export interface SPARQLParserOptions {
  /**
   * Custom vocabulary resolver for PREFIX* declarations.
   * If not provided, uses the default WellKnownPrefixResolver.
   */
  vocabularyResolver?: VocabularyResolver;
}

export class SPARQLParser {
  private readonly parser: InstanceType<typeof sparqljs.Parser>;
  private readonly generator: InstanceType<typeof sparqljs.Generator>;
  private readonly caseWhenTransformer: CaseWhenTransformer;
  private readonly lateralTransformer: LateralTransformer;
  private readonly prefixStarTransformer: PrefixStarTransformer;

  constructor(options?: SPARQLParserOptions) {
    // Enable SPARQL-Star (RDF-Star) support for triple patterns in subject/object positions
    // SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
    // This enables:
    // - Quoted triples: << :Alice :knows :Bob >>
    // - Annotation syntax: ?s :knows ?o {| :source ?doc |} .
    this.parser = new sparqljs.Parser({ sparqlStar: true });
    this.generator = new sparqljs.Generator({ sparqlStar: true });
    this.caseWhenTransformer = new CaseWhenTransformer();
    this.lateralTransformer = new LateralTransformer();
    this.prefixStarTransformer = new PrefixStarTransformer(options?.vocabularyResolver);
  }

  /**
   * Parse a SPARQL query string synchronously.
   *
   * Note: This method does NOT support PREFIX* declarations (SPARQL 1.2).
   * For PREFIX* support, use parseAsync() instead.
   *
   * @param queryString - The SPARQL query to parse
   * @returns The parsed query AST
   * @throws SPARQLParseError if parsing fails
   */
  parse(queryString: string): SPARQLQuery {
    try {
      // Transform LATERAL joins to marked subqueries (SPARQL 1.2)
      let transformedQuery = this.lateralTransformer.transform(queryString);
      // Transform CASE WHEN expressions to IF expressions before parsing
      transformedQuery = this.caseWhenTransformer.transform(transformedQuery);
      const parsed = this.parser.parse(transformedQuery);
      this.validateQuery(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof LateralTransformerError) {
        throw new SPARQLParseError(error.message);
      }
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

  /**
   * Parse a SPARQL query string with support for PREFIX* declarations (SPARQL 1.2).
   *
   * PREFIX* allows importing all prefixes from a vocabulary:
   * ```sparql
   * PREFIX* <http://schema.org/>
   * SELECT ?s WHERE { ?s schema:name "Example" }
   * ```
   *
   * @param queryString - The SPARQL query to parse
   * @returns The parsed query AST
   * @throws SPARQLParseError if parsing fails
   */
  async parseAsync(queryString: string): Promise<SPARQLQuery> {
    try {
      // First, transform PREFIX* declarations to regular PREFIX declarations
      const prefixTransformed = await this.prefixStarTransformer.transform(queryString);
      // Transform LATERAL joins to marked subqueries (SPARQL 1.2)
      const lateralTransformed = this.lateralTransformer.transform(prefixTransformed);
      // Then transform CASE WHEN expressions to IF expressions
      const caseTransformed = this.caseWhenTransformer.transform(lateralTransformed);
      const parsed = this.parser.parse(caseTransformed);
      this.validateQuery(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof PrefixStarTransformerError) {
        throw new SPARQLParseError(error.message);
      }
      if (error instanceof LateralTransformerError) {
        throw new SPARQLParseError(error.message);
      }
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

  /**
   * Check if a query string contains PREFIX* declarations.
   * Use this to decide whether to use parse() or parseAsync().
   *
   * @param queryString - The SPARQL query to check
   * @returns true if the query contains PREFIX* declarations
   */
  hasPrefixStar(queryString: string): boolean {
    // Simple regex check - PREFIX followed by optional whitespace and *
    return /PREFIX\s*\*/i.test(queryString);
  }

  /**
   * Check if a query string contains LATERAL keywords (SPARQL 1.2).
   *
   * @param queryString - The SPARQL query to check
   * @returns true if the query contains LATERAL keywords
   */
  hasLateral(queryString: string): boolean {
    return this.lateralTransformer.hasLateral(queryString);
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
