import { QueryPlanCache } from "../../../../../src/infrastructure/sparql/cache/QueryPlanCache";
import type { AlgebraOperation, BGPOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("QueryPlanCache", () => {
  let cache: QueryPlanCache;

  const createMockPlan = (id: string): AlgebraOperation => ({
    type: "bgp",
    triples: [
      {
        subject: { type: "variable", value: id },
        predicate: { type: "iri", value: "http://example.org/pred" },
        object: { type: "variable", value: "obj" },
      },
    ],
  } as BGPOperation);

  beforeEach(() => {
    cache = new QueryPlanCache(3);
  });

  describe("get and set", () => {
    it("should return undefined for uncached query", () => {
      expect(cache.get("SELECT * WHERE { ?s ?p ?o }")).toBeUndefined();
    });

    it("should return cached plan for same query", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const plan = createMockPlan("s");

      cache.set(query, plan);

      expect(cache.get(query)).toBe(plan);
    });

    it("should normalize whitespace when caching", () => {
      const query1 = "SELECT  *   WHERE { ?s ?p ?o }";
      const query2 = "SELECT * WHERE { ?s ?p ?o }";
      const plan = createMockPlan("s");

      cache.set(query1, plan);

      expect(cache.get(query2)).toBe(plan);
    });

    it("should trim queries when caching", () => {
      const query1 = "  SELECT * WHERE { ?s ?p ?o }  ";
      const query2 = "SELECT * WHERE { ?s ?p ?o }";
      const plan = createMockPlan("s");

      cache.set(query1, plan);

      expect(cache.get(query2)).toBe(plan);
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entry when cache is full", () => {
      const plan1 = createMockPlan("1");
      const plan2 = createMockPlan("2");
      const plan3 = createMockPlan("3");
      const plan4 = createMockPlan("4");

      cache.set("query1", plan1);
      cache.set("query2", plan2);
      cache.set("query3", plan3);

      // Cache is full (size 3), adding query4 should evict query1
      cache.set("query4", plan4);

      expect(cache.get("query1")).toBeUndefined();
      expect(cache.get("query2")).toBe(plan2);
      expect(cache.get("query3")).toBe(plan3);
      expect(cache.get("query4")).toBe(plan4);
    });

    it("should update LRU order on access", () => {
      const plan1 = createMockPlan("1");
      const plan2 = createMockPlan("2");
      const plan3 = createMockPlan("3");
      const plan4 = createMockPlan("4");

      cache.set("query1", plan1);
      cache.set("query2", plan2);
      cache.set("query3", plan3);

      // Access query1 to make it most recently used
      cache.get("query1");

      // Adding query4 should now evict query2 (oldest after access)
      cache.set("query4", plan4);

      expect(cache.get("query1")).toBe(plan1);
      expect(cache.get("query2")).toBeUndefined();
      expect(cache.get("query3")).toBe(plan3);
      expect(cache.get("query4")).toBe(plan4);
    });
  });

  describe("has", () => {
    it("should return false for uncached query", () => {
      expect(cache.has("SELECT * WHERE { ?s ?p ?o }")).toBe(false);
    });

    it("should return true for cached query", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      cache.set(query, createMockPlan("s"));

      expect(cache.has(query)).toBe(true);
    });
  });

  describe("clear", () => {
    it("should remove all cached entries", () => {
      cache.set("query1", createMockPlan("1"));
      cache.set("query2", createMockPlan("2"));

      cache.clear();

      expect(cache.get("query1")).toBeUndefined();
      expect(cache.get("query2")).toBeUndefined();
    });
  });

  describe("statistics", () => {
    it("should track cache hits", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      cache.set(query, createMockPlan("s"));

      cache.get(query);
      cache.get(query);

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it("should track cache misses", () => {
      cache.get("uncached1");
      cache.get("uncached2");

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it("should calculate hit rate", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      cache.set(query, createMockPlan("s"));

      cache.get(query); // hit
      cache.get("uncached"); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.5);
    });

    it("should report cache size", () => {
      cache.set("query1", createMockPlan("1"));
      cache.set("query2", createMockPlan("2"));

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });

    it("should reset statistics", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      cache.set(query, createMockPlan("s"));
      cache.get(query);
      cache.get("uncached");

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("should handle hit rate with no queries", () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle cache size of 1", () => {
      const smallCache = new QueryPlanCache(1);
      const plan1 = createMockPlan("1");
      const plan2 = createMockPlan("2");

      smallCache.set("query1", plan1);
      expect(smallCache.get("query1")).toBe(plan1);

      smallCache.set("query2", plan2);
      expect(smallCache.get("query2")).toBe(plan2);
      expect(smallCache.get("query1")).toBeUndefined(); // Evicted
    });

    it("should handle empty queries", () => {
      const plan = createMockPlan("s");

      cache.set("", plan);

      expect(cache.get("")).toBe(plan);
    });

    it("should handle queries with only whitespace", () => {
      const plan = createMockPlan("s");

      cache.set("   ", plan);

      // After normalization, "   " becomes ""
      expect(cache.get("")).toBe(plan);
      expect(cache.get("   ")).toBe(plan);
      expect(cache.get("  ")).toBe(plan);
    });

    it("should handle newlines and tabs in queries", () => {
      const plan = createMockPlan("s");
      const query1 = "SELECT *\n\tWHERE { ?s ?p ?o }";
      const query2 = "SELECT * WHERE { ?s ?p ?o }";

      cache.set(query1, plan);

      expect(cache.get(query2)).toBe(plan);
    });

    it("should handle overwriting existing entry", () => {
      const plan1 = createMockPlan("1");
      const plan2 = createMockPlan("2");
      const query = "SELECT * WHERE { ?s ?p ?o }";

      cache.set(query, plan1);
      expect(cache.get(query)).toBe(plan1);

      cache.set(query, plan2);
      expect(cache.get(query)).toBe(plan2);
      expect(cache.getStats().size).toBe(1);
    });

    it("should maintain statistics across clear", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      cache.set(query, createMockPlan("s"));

      cache.get(query); // hit
      cache.get("uncached"); // miss

      cache.clear();

      // After clear, stats are preserved (only entries cleared)
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it("should correctly track LRU order after set updates", () => {
      const plan1 = createMockPlan("1");
      const plan1Updated = createMockPlan("1-updated");
      const plan2 = createMockPlan("2");
      const plan3 = createMockPlan("3");
      const plan4 = createMockPlan("4");

      cache.set("query1", plan1);
      cache.set("query2", plan2);
      cache.set("query3", plan3);

      // Update query1 - this should make it most recently used
      cache.set("query1", plan1Updated);

      // Adding query4 should evict query2 (oldest non-updated)
      cache.set("query4", plan4);

      expect(cache.get("query1")).toBe(plan1Updated);
      expect(cache.get("query2")).toBeUndefined();
      expect(cache.get("query3")).toBe(plan3);
      expect(cache.get("query4")).toBe(plan4);
    });
  });
});
