/**
 * ClusterQueryExecutor - SPARQL query execution with validation and caching
 *
 * Provides an optimized query executor for dynamic graph exploration:
 * - Query validation before execution
 * - LRU caching for repeated queries
 * - Query timeout and cancellation support
 * - Query plan explanation for debugging
 * - Integration with triple store
 *
 * @module presentation/renderers/graph/cluster
 * @since 1.0.0
 */

import type {
  ClusterQueryOptions,
  ClusterQueryResult,
  ClusterQueryStats,
  QueryValidationResult,
  QueryValidationError,
  QueryValidationWarning,
  QueryPlan,
  QueryPlanStep,
} from "./ClusterTypes";
import { DEFAULT_CLUSTER_QUERY_OPTIONS } from "./ClusterTypes";
import { LRUCache } from "@plugin/infrastructure/cache/LRUCache";

// ============================================================
// Types
// ============================================================

/**
 * Triple store adapter interface
 */
export interface TripleStoreAdapter {
  /** Execute SPARQL query */
  query(sparql: string): Promise<Map<string, unknown>[]>;

  /** Get triple count for statistics */
  getTripleCount?(): number;
}

/**
 * Configuration for ClusterQueryExecutor
 */
export interface ClusterQueryExecutorConfig {
  /** Maximum cache size @default 100 */
  cacheSize?: number;

  /** Cache TTL in milliseconds @default 60000 (1 minute) */
  cacheTTL?: number;

  /** Default query timeout @default 30000 (30 seconds) */
  defaultTimeout?: number;

  /** Enable query plan caching @default true */
  cachePlans?: boolean;
}

/**
 * Default executor configuration
 */
const DEFAULT_EXECUTOR_CONFIG: Required<ClusterQueryExecutorConfig> = {
  cacheSize: 100,
  cacheTTL: 60000,
  defaultTimeout: 30000,
  cachePlans: true,
};

// ============================================================
// ClusterQueryExecutor Implementation
// ============================================================

/**
 * SPARQL query executor with validation and caching for cluster visualization
 *
 * Features:
 * - Query validation with syntax and semantic checks
 * - LRU cache with TTL for repeated queries
 * - Query timeout with cancellation support
 * - Query plan explanation for debugging
 * - Statistics tracking for performance monitoring
 *
 * @example
 * ```typescript
 * const executor = new ClusterQueryExecutor(tripleStore);
 *
 * // Validate query
 * const validation = executor.validate("SELECT ?s WHERE { ?s ?p ?o }");
 * if (!validation.valid) {
 *   console.error(validation.errors);
 * }
 *
 * // Execute query
 * const result = await executor.execute("SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100");
 * console.log(`Found ${result.stats.resultCount} results in ${result.stats.executionTime}ms`);
 *
 * // Cancel running query
 * executor.cancel(result.queryId);
 * ```
 */
export class ClusterQueryExecutor {
  private readonly adapter: TripleStoreAdapter;
  private readonly config: Required<ClusterQueryExecutorConfig>;
  private readonly cache: LRUCache<string, ClusterQueryResult>;
  private readonly activeQueries: Map<string, AbortController> = new Map();
  private queryCounter = 0;

  constructor(
    adapter: TripleStoreAdapter,
    config: ClusterQueryExecutorConfig = {}
  ) {
    this.adapter = adapter;
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
    this.cache = new LRUCache({
      maxEntries: this.config.cacheSize,
      ttl: this.config.cacheTTL,
    });
  }

  /**
   * Execute a SPARQL query with optional caching and timeout
   */
  async execute<T = unknown>(
    query: string,
    options: ClusterQueryOptions = {}
  ): Promise<ClusterQueryResult<T>> {
    const opts = { ...DEFAULT_CLUSTER_QUERY_OPTIONS, ...options };
    const queryId = this.generateQueryId();
    const startTime = performance.now();

    // Check cache first
    if (opts.cache && !opts.forceRefresh) {
      const cacheKey = this.getCacheKey(query, opts);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          queryId,
          stats: {
            ...cached.stats,
            cacheHit: true,
            executionTime: performance.now() - startTime,
          },
        } as ClusterQueryResult<T>;
      }
    }

    // Validate query
    const validation = this.validate(query);
    if (!validation.valid) {
      return {
        queryId,
        type: "select",
        stats: this.createStats(startTime, 0, false),
        error: validation.errors.map((e) => e.message).join("; "),
      };
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeQueries.set(queryId, abortController);

    try {
      // Apply LIMIT and OFFSET if not in query
      let modifiedQuery = query;
      if (opts.limit && !query.toLowerCase().includes("limit")) {
        modifiedQuery += ` LIMIT ${opts.limit}`;
      }
      if (opts.offset && opts.offset > 0 && !query.toLowerCase().includes("offset")) {
        modifiedQuery += ` OFFSET ${opts.offset}`;
      }

      // Execute with timeout
      const result = await this.executeWithTimeout(
        modifiedQuery,
        opts.timeout,
        abortController.signal
      );

      // Build result based on query type
      const queryResult: ClusterQueryResult<T> = {
        queryId,
        type: validation.queryType || "select",
        bindings: result as T[],
        stats: this.createStats(startTime, result.length, false),
      };

      // Cache result
      if (opts.cache) {
        const cacheKey = this.getCacheKey(query, opts);
        this.cache.set(cacheKey, queryResult as ClusterQueryResult);
      }

      return queryResult;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          queryId,
          type: validation.queryType || "select",
          stats: this.createStats(startTime, 0, false),
          cancelled: true,
        };
      }

      return {
        queryId,
        type: validation.queryType || "select",
        stats: this.createStats(startTime, 0, false),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * Validate a SPARQL query without executing it
   */
  validate(query: string): QueryValidationResult {
    const errors: QueryValidationError[] = [];
    const warnings: QueryValidationWarning[] = [];

    // Basic syntax validation
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      errors.push({
        type: "syntax",
        message: "Query is empty",
        suggestion: "Provide a valid SPARQL query",
      });
      return { valid: false, errors, warnings };
    }

    // Detect query type
    const upperQuery = trimmedQuery.toUpperCase();
    let queryType: "select" | "construct" | "ask" | "describe" | undefined;
    let variables: string[] | undefined;

    if (upperQuery.startsWith("SELECT") || upperQuery.includes("SELECT ")) {
      queryType = "select";
      // Extract variables from SELECT clause
      const selectMatch = trimmedQuery.match(/SELECT\s+(DISTINCT\s+)?(.+?)\s+WHERE/i);
      if (selectMatch) {
        const varsClause = selectMatch[2];
        if (varsClause === "*") {
          variables = ["*"];
        } else {
          variables = varsClause
            .split(/\s+/)
            .filter((v) => v.startsWith("?") || v.startsWith("$"))
            .map((v) => v.replace(/^[?$]/, ""));
        }
      }
    } else if (upperQuery.startsWith("CONSTRUCT") || upperQuery.includes("CONSTRUCT ")) {
      queryType = "construct";
    } else if (upperQuery.startsWith("ASK") || upperQuery.includes("ASK ")) {
      queryType = "ask";
    } else if (upperQuery.startsWith("DESCRIBE") || upperQuery.includes("DESCRIBE ")) {
      queryType = "describe";
    } else {
      // Check for PREFIX declarations without query body
      if (upperQuery.includes("PREFIX") && !upperQuery.match(/\b(SELECT|CONSTRUCT|ASK|DESCRIBE)\b/)) {
        errors.push({
          type: "syntax",
          message: "Query has PREFIX declarations but no query body",
          suggestion: "Add a SELECT, CONSTRUCT, ASK, or DESCRIBE clause",
        });
      } else {
        errors.push({
          type: "syntax",
          message: "Unknown query type",
          suggestion: "Query must start with SELECT, CONSTRUCT, ASK, or DESCRIBE",
        });
      }
      return { valid: false, errors, warnings, queryType };
    }

    // Check for WHERE clause (required for SELECT, optional for others)
    if (queryType === "select" && !upperQuery.includes("WHERE")) {
      errors.push({
        type: "syntax",
        message: "SELECT query requires a WHERE clause",
        suggestion: "Add WHERE { ... } to your query",
      });
    }

    // Check for balanced braces
    const openBraces = (trimmedQuery.match(/\{/g) || []).length;
    const closeBraces = (trimmedQuery.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push({
        type: "syntax",
        message: `Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`,
        suggestion: "Check that all { have matching }",
      });
    }

    // Check for common issues
    if (trimmedQuery.includes("??")) {
      warnings.push({
        type: "compatibility",
        message: "Double question marks (??) may cause parsing issues",
      });
    }

    // Performance warnings
    if (queryType === "select" && !upperQuery.includes("LIMIT")) {
      warnings.push({
        type: "performance",
        message: "Query has no LIMIT clause",
      });
    }

    if (upperQuery.includes("SELECT *")) {
      warnings.push({
        type: "performance",
        message: "SELECT * may return unnecessary data",
      });
    }

    return {
      valid: errors.length === 0,
      queryType,
      errors,
      warnings,
      variables,
    };
  }

  /**
   * Get an explanation of the query execution plan
   */
  async explain(query: string): Promise<QueryPlan> {
    const validation = this.validate(query);
    const steps: QueryPlanStep[] = [];
    const notes: string[] = [];

    // Parse query structure for plan generation
    const upperQuery = query.toUpperCase();

    // Scan step (always present)
    steps.push({
      type: "scan",
      description: "Scan triple store for matching patterns",
      estimatedRows: 1000, // Placeholder
    });

    // Filter step if FILTER present
    if (upperQuery.includes("FILTER")) {
      steps.push({
        type: "filter",
        description: "Apply FILTER conditions",
        estimatedRows: 500,
      });
    }

    // Join step if multiple patterns
    const patternCount = (query.match(/\?[\w]+\s+[\w:<>]+\s+[\w?:<>"]+\s*\./g) || []).length;
    if (patternCount > 1) {
      steps.push({
        type: "join",
        description: `Join ${patternCount} triple patterns`,
        estimatedRows: 200,
      });
      notes.push(`Query contains ${patternCount} triple patterns requiring joins`);
    }

    // Aggregate step if GROUP BY or aggregates
    if (upperQuery.includes("GROUP BY") || upperQuery.match(/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/)) {
      steps.push({
        type: "aggregate",
        description: "Apply aggregation functions",
        estimatedRows: 50,
      });
    }

    // Sort step if ORDER BY
    if (upperQuery.includes("ORDER BY")) {
      steps.push({
        type: "sort",
        description: "Sort results",
        estimatedRows: 50,
      });
      notes.push("Consider adding an index for ORDER BY columns");
    }

    // Limit step if LIMIT
    const limitMatch = query.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      steps.push({
        type: "limit",
        description: `Limit to ${limitMatch[1]} results`,
        estimatedRows: parseInt(limitMatch[1], 10),
      });
    }

    // Project step for SELECT
    if (validation.variables && validation.variables.length > 0) {
      steps.push({
        type: "project",
        description: `Project ${validation.variables.length} variables`,
        outputVars: validation.variables,
        estimatedRows: steps[steps.length - 1]?.estimatedRows || 100,
      });
    }

    // Calculate estimated cost
    const estimatedCost = steps.reduce((sum, step) => sum + step.estimatedRows, 0);

    return {
      algebra: this.queryToAlgebra(query),
      estimatedCost,
      notes,
      steps,
    };
  }

  /**
   * Cancel a running query
   */
  cancel(queryId: string): void {
    const controller = this.activeQueries.get(queryId);
    if (controller) {
      controller.abort();
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * Cancel all running queries
   */
  cancelAll(): void {
    for (const [queryId, controller] of this.activeQueries) {
      controller.abort();
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * Clear the query cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; size: number; capacity: number } {
    const stats = this.cache.getStats();
    return {
      hits: stats.hits,
      misses: stats.misses,
      size: stats.size,
      capacity: stats.capacity,
    };
  }

  /**
   * Get number of active queries
   */
  getActiveQueryCount(): number {
    return this.activeQueries.size;
  }

  /**
   * Dispose of executor resources
   */
  dispose(): void {
    this.cancelAll();
    this.cache.cleanup();
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  private generateQueryId(): string {
    return `query_${Date.now()}_${++this.queryCounter}`;
  }

  private getCacheKey(query: string, options: ClusterQueryOptions): string {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    const optionsKey = `${options.limit || ""}_${options.offset || ""}_${options.format || ""}`;
    return `${normalizedQuery}|${optionsKey}`;
  }

  private async executeWithTimeout(
    query: string,
    timeout: number,
    signal: AbortSignal
  ): Promise<Map<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      // Set up abort handling
      if (signal.aborted) {
        reject(new DOMException("Query cancelled", "AbortError"));
        return;
      }

      const abortHandler = () => {
        reject(new DOMException("Query cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abortHandler, { once: true });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        signal.removeEventListener("abort", abortHandler);
        reject(new Error(`Query timeout after ${timeout}ms`));
      }, timeout);

      // Execute query
      this.adapter
        .query(query)
        .then((result) => {
          clearTimeout(timeoutId);
          signal.removeEventListener("abort", abortHandler);
          resolve(result);
        })
        .catch((error: unknown) => {
          clearTimeout(timeoutId);
          signal.removeEventListener("abort", abortHandler);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private createStats(
    startTime: number,
    resultCount: number,
    cacheHit: boolean
  ): ClusterQueryStats {
    const executionTime = performance.now() - startTime;
    return {
      executionTime,
      resultCount,
      bytesScanned: resultCount * 100, // Estimate
      cacheHit,
      triplesEvaluated: this.adapter.getTripleCount?.() || 0,
    };
  }

  private queryToAlgebra(query: string): string {
    // Simplified algebra representation for debugging
    const validation = this.validate(query);
    const lines: string[] = [];

    switch (validation.queryType) {
      case "select":
        lines.push(`(project (${validation.variables?.join(" ") || "*"})`);
        break;
      case "construct":
        lines.push("(construct");
        break;
      case "ask":
        lines.push("(ask");
        break;
      case "describe":
        lines.push("(describe");
        break;
    }

    // Extract WHERE clause patterns
    const whereMatch = query.match(/WHERE\s*\{([^}]+)\}/i);
    if (whereMatch) {
      const patterns = whereMatch[1]
        .split(".")
        .map((p) => p.trim())
        .filter(Boolean);
      lines.push("  (bgp");
      for (const pattern of patterns) {
        lines.push(`    (triple ${pattern})`);
      }
      lines.push("  )");
    }

    lines.push(")");
    return lines.join("\n");
  }
}
