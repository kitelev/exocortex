import type { ServiceOperation } from "../algebra/AlgebraOperation";
import { SolutionMapping } from "../SolutionMapping";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";

export class ServiceExecutorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "ServiceExecutorError";
  }
}

/**
 * Result format for SPARQL JSON query results.
 * Follows SPARQL 1.1 Query Results JSON Format specification.
 * https://www.w3.org/TR/sparql11-results-json/
 */
interface SPARQLJsonResult {
  head: {
    vars: string[];
  };
  results: {
    bindings: SPARQLJsonBinding[];
  };
}

interface SPARQLJsonBinding {
  [variable: string]: {
    type: "uri" | "literal" | "bnode";
    value: string;
    "xml:lang"?: string;
    datatype?: string;
  };
}

/**
 * Configuration options for SERVICE execution.
 */
export interface ServiceExecutorConfig {
  /**
   * Default timeout in milliseconds for HTTP requests to SPARQL endpoints.
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Custom HTTP client for making requests. If not provided, uses global fetch.
   * This allows for dependency injection in testing.
   */
  httpClient?: (url: string, options: RequestInit) => Promise<Response>;

  /**
   * Maximum number of retries on transient failures.
   * Default: 2
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds.
   * Default: 1000 (1 second)
   */
  retryDelay?: number;
}

/**
 * Executes SERVICE operations for federated SPARQL queries.
 *
 * SERVICE allows querying external SPARQL endpoints within a local query.
 * This executor sends SPARQL queries to remote endpoints via HTTP and
 * converts the results to SolutionMappings for joining with local patterns.
 *
 * Features:
 * - Executes graph patterns against remote SPARQL endpoints
 * - SILENT mode for graceful error handling
 * - Configurable timeouts and retries
 * - Supports SPARQL JSON result format
 *
 * SPARQL 1.1 Federated Query:
 * https://www.w3.org/TR/sparql11-federated-query/
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
 */
export class ServiceExecutor {
  private readonly timeout: number;
  private readonly httpClient: (url: string, options: RequestInit) => Promise<Response>;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(config: ServiceExecutorConfig = {}) {
    this.timeout = config.timeout ?? 30000;
    this.httpClient = config.httpClient ?? ((url, options) => fetch(url, options));
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelay = config.retryDelay ?? 1000;
  }

  /**
   * Execute a SERVICE operation by querying a remote SPARQL endpoint.
   *
   * The inner pattern is converted to a SPARQL query, sent to the endpoint,
   * and results are converted to SolutionMappings.
   *
   * @param operation - The SERVICE operation with endpoint, pattern, and silent flag
   * @param queryGenerator - Function to convert an algebra operation to SPARQL string
   * @returns AsyncIterableIterator of SolutionMappings from the remote endpoint
   */
  async *execute(
    operation: ServiceOperation,
    queryGenerator: (pattern: ServiceOperation["pattern"]) => string
  ): AsyncIterableIterator<SolutionMapping> {
    try {
      // Generate SPARQL query from the inner pattern
      const sparqlQuery = queryGenerator(operation.pattern);

      // Execute against remote endpoint
      const results = await this.executeRemoteQuery(operation.endpoint, sparqlQuery);

      // Yield solution mappings from results
      for (const solution of results) {
        yield solution;
      }
    } catch (error) {
      if (operation.silent) {
        // SILENT mode: suppress errors and return empty results
        return;
      }
      throw error;
    }
  }

  /**
   * Execute a SPARQL query against a remote endpoint.
   *
   * Uses HTTP POST with application/sparql-query content type.
   * Expects SPARQL JSON results format in response.
   */
  private async executeRemoteQuery(
    endpoint: string,
    query: string
  ): Promise<SolutionMapping[]> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await this.httpClient(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/sparql-query",
              "Accept": "application/sparql-results+json",
            },
            body: query,
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new ServiceExecutorError(
              `Remote SPARQL endpoint returned ${response.status}: ${response.statusText}`
            );
          }

          const json = await response.json() as SPARQLJsonResult;
          return this.parseJsonResults(json);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable (network errors, timeouts, 5xx responses)
        if (this.isRetryableError(lastError) && attempt < this.maxRetries) {
          await this.delay(this.retryDelay);
          continue;
        }

        throw new ServiceExecutorError(
          `Failed to query remote SPARQL endpoint ${endpoint}: ${lastError.message}`,
          lastError
        );
      }
    }

    throw new ServiceExecutorError(
      `Failed to query remote SPARQL endpoint ${endpoint} after ${this.maxRetries + 1} attempts`,
      lastError
    );
  }

  /**
   * Parse SPARQL JSON results format into SolutionMappings.
   *
   * SPARQL 1.1 Query Results JSON Format:
   * https://www.w3.org/TR/sparql11-results-json/
   */
  private parseJsonResults(json: SPARQLJsonResult): SolutionMapping[] {
    if (!json.results || !Array.isArray(json.results.bindings)) {
      return [];
    }

    return json.results.bindings.map((binding) => this.parseBinding(binding));
  }

  /**
   * Parse a single SPARQL JSON binding into a SolutionMapping.
   */
  private parseBinding(binding: SPARQLJsonBinding): SolutionMapping {
    const solution = new SolutionMapping();

    for (const [varName, value] of Object.entries(binding)) {
      const rdfTerm = this.parseRDFTerm(value);
      solution.set(varName, rdfTerm);
    }

    return solution;
  }

  /**
   * Parse a SPARQL JSON RDF term into an IRI, Literal, or BlankNode.
   */
  private parseRDFTerm(term: SPARQLJsonBinding[string]): Subject | Predicate | RDFObject {
    switch (term.type) {
      case "uri":
        return new IRI(term.value);

      case "literal": {
        const datatype = term.datatype ? new IRI(term.datatype) : undefined;
        return new Literal(term.value, datatype, term["xml:lang"]);
      }

      case "bnode":
        return new BlankNode(term.value);

      default:
        throw new ServiceExecutorError(`Unknown RDF term type: ${(term as any).type}`);
    }
  }

  /**
   * Check if an error is retryable (transient network issues).
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Aborted (timeout)
    if (error.name === "AbortError") {
      return true;
    }

    // Network errors
    if (
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout")
    ) {
      return true;
    }

    // 5xx server errors
    if (message.includes("returned 5")) {
      return true;
    }

    return false;
  }

  /**
   * Delay for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
