/**
 * ClusterQueryExecutor tests
 *
 * Tests for SPARQL query validation, execution, caching, and cancellation.
 */

import {
  ClusterQueryExecutor,
  type TripleStoreAdapter,
  type ClusterQueryExecutorConfig,
} from "@plugin/presentation/renderers/graph/cluster/ClusterQueryExecutor";
import type { ClusterQueryOptions } from "@plugin/presentation/renderers/graph/cluster/ClusterTypes";

// Mock triple store adapter
function createMockAdapter(
  results: Map<string, unknown>[] = [],
  tripleCount = 100
): TripleStoreAdapter {
  return {
    query: jest.fn().mockResolvedValue(results),
    getTripleCount: jest.fn().mockReturnValue(tripleCount),
  };
}

describe("ClusterQueryExecutor", () => {
  let executor: ClusterQueryExecutor;
  let mockAdapter: TripleStoreAdapter;

  beforeEach(() => {
    mockAdapter = createMockAdapter([
      new Map([["s", "subject1"], ["p", "predicate1"], ["o", "object1"]]),
      new Map([["s", "subject2"], ["p", "predicate2"], ["o", "object2"]]),
    ]);
    executor = new ClusterQueryExecutor(mockAdapter);
  });

  afterEach(() => {
    executor.dispose();
  });

  describe("constructor", () => {
    it("should create executor with default config", () => {
      const exec = new ClusterQueryExecutor(mockAdapter);
      expect(exec.getActiveQueryCount()).toBe(0);
      exec.dispose();
    });

    it("should create executor with custom config", () => {
      const config: ClusterQueryExecutorConfig = {
        cacheSize: 50,
        cacheTTL: 30000,
        defaultTimeout: 10000,
        cachePlans: false,
      };
      const exec = new ClusterQueryExecutor(mockAdapter, config);
      expect(exec.getCacheStats().capacity).toBe(50);
      exec.dispose();
    });
  });

  describe("validate", () => {
    it("should validate SELECT query", () => {
      const result = executor.validate("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
      expect(result.valid).toBe(true);
      expect(result.queryType).toBe("select");
      expect(result.variables).toContain("s");
      expect(result.variables).toContain("p");
      expect(result.variables).toContain("o");
    });

    it("should validate CONSTRUCT query", () => {
      const result = executor.validate("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");
      expect(result.valid).toBe(true);
      expect(result.queryType).toBe("construct");
    });

    it("should validate ASK query", () => {
      const result = executor.validate("ASK WHERE { ?s ?p ?o }");
      expect(result.valid).toBe(true);
      expect(result.queryType).toBe("ask");
    });

    it("should validate DESCRIBE query", () => {
      const result = executor.validate("DESCRIBE <http://example.org/resource>");
      expect(result.valid).toBe(true);
      expect(result.queryType).toBe("describe");
    });

    it("should reject empty query", () => {
      const result = executor.validate("");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe("Query is empty");
    });

    it("should reject query without WHERE clause in SELECT", () => {
      const result = executor.validate("SELECT ?s ?p ?o");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("WHERE clause"))).toBe(true);
    });

    it("should reject unbalanced braces", () => {
      const result = executor.validate("SELECT ?s WHERE { ?s ?p ?o ");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Unbalanced braces"))).toBe(true);
    });

    it("should reject unknown query type", () => {
      const result = executor.validate("INVALID ?s ?p ?o");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Unknown query type"))).toBe(true);
    });

    it("should warn about SELECT *", () => {
      const result = executor.validate("SELECT * WHERE { ?s ?p ?o }");
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("SELECT *"))).toBe(true);
    });

    it("should warn about missing LIMIT", () => {
      const result = executor.validate("SELECT ?s WHERE { ?s ?p ?o }");
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("LIMIT"))).toBe(true);
    });

    it("should handle query with PREFIX declarations", () => {
      const result = executor.validate(`
        PREFIX ex: <http://example.org/>
        SELECT ?s WHERE { ?s ex:prop ?o }
      `);
      expect(result.valid).toBe(true);
    });

    it("should reject PREFIX without query body", () => {
      const result = executor.validate("PREFIX ex: <http://example.org/>");
      expect(result.valid).toBe(false);
    });
  });

  describe("execute", () => {
    it("should execute valid SELECT query", async () => {
      const result = await executor.execute("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");

      expect(result.queryId).toMatch(/^query_\d+_\d+$/);
      expect(result.type).toBe("select");
      expect(result.bindings).toHaveLength(2);
      expect(result.stats.resultCount).toBe(2);
      expect(result.stats.cacheHit).toBe(false);
      expect(result.stats.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should return error for invalid query", async () => {
      const result = await executor.execute("");

      expect(result.error).toBeDefined();
      expect(result.stats.resultCount).toBe(0);
    });

    it("should apply LIMIT from options", async () => {
      const options: ClusterQueryOptions = { limit: 10 };
      await executor.execute("SELECT ?s WHERE { ?s ?p ?o }", options);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT 10")
      );
    });

    it("should apply OFFSET from options", async () => {
      const options: ClusterQueryOptions = { offset: 5 };
      await executor.execute("SELECT ?s WHERE { ?s ?p ?o }", options);

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining("OFFSET 5")
      );
    });

    it("should not duplicate LIMIT if already in query", async () => {
      const options: ClusterQueryOptions = { limit: 10 };
      await executor.execute("SELECT ?s WHERE { ?s ?p ?o } LIMIT 5", options);

      // Should not add another LIMIT
      const calledQuery = (mockAdapter.query as jest.Mock).mock.calls[0][0];
      expect(calledQuery.match(/LIMIT/gi)?.length).toBe(1);
    });
  });

  describe("caching", () => {
    it("should cache query results", async () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";

      // First execution
      const result1 = await executor.execute(query);
      expect(result1.stats.cacheHit).toBe(false);

      // Second execution should hit cache
      const result2 = await executor.execute(query);
      expect(result2.stats.cacheHit).toBe(true);

      // Adapter should only be called once
      expect(mockAdapter.query).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache with forceRefresh", async () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";

      await executor.execute(query);
      await executor.execute(query, { forceRefresh: true });

      expect(mockAdapter.query).toHaveBeenCalledTimes(2);
    });

    it("should skip cache when cache option is false", async () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";

      await executor.execute(query);
      await executor.execute(query, { cache: false });

      expect(mockAdapter.query).toHaveBeenCalledTimes(2);
    });

    it("should track cache statistics", async () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";

      await executor.execute(query);
      await executor.execute(query);

      const stats = executor.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);
    });

    it("should clear cache", async () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      await executor.execute(query);

      executor.clearCache();

      const stats = executor.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("cancellation", () => {
    it("should cancel running query", async () => {
      // Create slow adapter
      const slowAdapter: TripleStoreAdapter = {
        query: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 5000))
        ),
      };
      const exec = new ClusterQueryExecutor(slowAdapter);

      // Start query
      const queryPromise = exec.execute("SELECT ?s WHERE { ?s ?p ?o }");

      // Get query ID from active queries
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(exec.getActiveQueryCount()).toBe(1);

      // Cancel all queries
      exec.cancelAll();

      const result = await queryPromise;
      expect(result.cancelled).toBe(true);

      exec.dispose();
    });

    it("should track active query count", async () => {
      expect(executor.getActiveQueryCount()).toBe(0);

      const promise = executor.execute("SELECT ?s WHERE { ?s ?p ?o }");
      // Query starts and completes quickly with mock
      await promise;

      expect(executor.getActiveQueryCount()).toBe(0);
    });
  });

  describe("explain", () => {
    it("should generate query plan for SELECT", async () => {
      const plan = await executor.explain("SELECT ?s ?p ?o WHERE { ?s ?p ?o . ?s a ?type }");

      expect(plan.algebra).toBeDefined();
      expect(plan.estimatedCost).toBeGreaterThan(0);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.type === "scan")).toBe(true);
    });

    it("should include filter step when FILTER present", async () => {
      const plan = await executor.explain(
        "SELECT ?s WHERE { ?s ?p ?o . FILTER(?o > 10) }"
      );

      expect(plan.steps.some((s) => s.type === "filter")).toBe(true);
    });

    it("should include aggregate step when GROUP BY present", async () => {
      const plan = await executor.explain(
        "SELECT ?s (COUNT(?o) AS ?count) WHERE { ?s ?p ?o } GROUP BY ?s"
      );

      expect(plan.steps.some((s) => s.type === "aggregate")).toBe(true);
    });

    it("should include sort step when ORDER BY present", async () => {
      const plan = await executor.explain(
        "SELECT ?s ?o WHERE { ?s ?p ?o } ORDER BY ?o"
      );

      expect(plan.steps.some((s) => s.type === "sort")).toBe(true);
    });

    it("should include limit step when LIMIT present", async () => {
      const plan = await executor.explain(
        "SELECT ?s WHERE { ?s ?p ?o } LIMIT 10"
      );

      expect(plan.steps.some((s) => s.type === "limit")).toBe(true);
    });
  });

  describe("dispose", () => {
    it("should cancel all queries on dispose", async () => {
      const slowAdapter: TripleStoreAdapter = {
        query: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 5000))
        ),
      };
      const exec = new ClusterQueryExecutor(slowAdapter);

      exec.execute("SELECT ?s WHERE { ?s ?p ?o }");
      await new Promise((resolve) => setTimeout(resolve, 10));

      exec.dispose();

      expect(exec.getActiveQueryCount()).toBe(0);
    });

    it("should clear cache on dispose", async () => {
      await executor.execute("SELECT ?s WHERE { ?s ?p ?o }");
      expect(executor.getCacheStats().size).toBe(1);

      executor.dispose();

      expect(executor.getCacheStats().size).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should handle adapter errors gracefully", async () => {
      const errorAdapter: TripleStoreAdapter = {
        query: jest.fn().mockRejectedValue(new Error("Database error")),
      };
      const exec = new ClusterQueryExecutor(errorAdapter);

      const result = await exec.execute("SELECT ?s WHERE { ?s ?p ?o }");

      expect(result.error).toBe("Database error");
      expect(result.stats.resultCount).toBe(0);

      exec.dispose();
    });

    it("should handle timeout", async () => {
      const slowAdapter: TripleStoreAdapter = {
        query: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve([]), 5000))
        ),
      };
      const exec = new ClusterQueryExecutor(slowAdapter, { defaultTimeout: 100 });

      const result = await exec.execute("SELECT ?s WHERE { ?s ?p ?o }", { timeout: 50 });

      expect(result.error).toContain("timeout");

      exec.dispose();
    });
  });
});
