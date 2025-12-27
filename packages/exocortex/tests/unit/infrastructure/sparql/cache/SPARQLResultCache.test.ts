import { SPARQLResultCache } from "../../../../../src/infrastructure/sparql/cache/SPARQLResultCache";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";

describe("SPARQLResultCache", () => {
  let cache: SPARQLResultCache;

  beforeEach(() => {
    cache = new SPARQLResultCache({ maxSize: 10, ttlMs: 1000 });
  });

  describe("constructor", () => {
    it("should create cache with default options", () => {
      const defaultCache = new SPARQLResultCache();
      expect(defaultCache.size()).toBe(0);
    });

    it("should create cache with custom options", () => {
      const customCache = new SPARQLResultCache({
        maxSize: 100,
        ttlMs: 5000,
        enableFileInvalidation: false,
      });
      expect(customCache.size()).toBe(0);
    });
  });

  describe("get/set/has", () => {
    it("should cache and retrieve SELECT results", () => {
      const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [
        new SolutionMapping(new Map([["s", new IRI("http://example.org/1")]])),
        new SolutionMapping(new Map([["s", new IRI("http://example.org/2")]])),
      ];

      cache.set(query, results);

      expect(cache.has(query)).toBe(true);
      expect(cache.get(query)).toEqual(results);
    });

    it("should cache and retrieve CONSTRUCT results", () => {
      const query = "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }";
      const results: Triple[] = [
        new Triple(
          new IRI("http://example.org/s1"),
          new IRI("http://example.org/p1"),
          new Literal("value1")
        ),
      ];

      cache.set(query, results);

      expect(cache.has(query)).toBe(true);
      expect(cache.get(query)).toEqual(results);
    });

    it("should return undefined for uncached query", () => {
      expect(cache.get("SELECT * WHERE { ?s ?p ?o }")).toBeUndefined();
      expect(cache.has("SELECT * WHERE { ?s ?p ?o }")).toBe(false);
    });

    it("should normalize query strings", () => {
      const query1 = "SELECT   ?s   ?p   ?o   WHERE { ?s ?p ?o }";
      const query2 = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [new SolutionMapping()];

      cache.set(query1, results);

      // Should retrieve with normalized query
      expect(cache.get(query2)).toEqual(results);
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      const shortTtlCache = new SPARQLResultCache({ maxSize: 10, ttlMs: 50 });
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [new SolutionMapping()];

      shortTtlCache.set(query, results);
      expect(shortTtlCache.get(query)).toEqual(results);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortTtlCache.get(query)).toBeUndefined();
    });

    it("should not return expired entries via has()", async () => {
      const shortTtlCache = new SPARQLResultCache({ maxSize: 10, ttlMs: 50 });
      const query = "SELECT ?s WHERE { ?s ?p ?o }";

      shortTtlCache.set(query, [new SolutionMapping()]);
      expect(shortTtlCache.has(query)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortTtlCache.has(query)).toBe(false);
    });
  });

  describe("file-based invalidation", () => {
    it("should invalidate entries by file path", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [new SolutionMapping()];
      const affectedFiles = new Set(["/path/to/file1.md", "/path/to/file2.md"]);

      cache.set(query, results, affectedFiles);
      expect(cache.get(query)).toEqual(results);

      // Invalidate by file
      const invalidated = cache.invalidateByFile("/path/to/file1.md");

      expect(invalidated).toBe(1);
      expect(cache.get(query)).toBeUndefined();
    });

    it("should not invalidate entries without affected files", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [new SolutionMapping()];

      cache.set(query, results); // No affected files

      const invalidated = cache.invalidateByFile("/some/random/file.md");

      expect(invalidated).toBe(0);
      expect(cache.get(query)).toEqual(results);
    });

    it("should invalidate multiple entries for same file", () => {
      const query1 = "SELECT ?s WHERE { ?s ?p ?o }";
      const query2 = "SELECT ?p WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [new SolutionMapping()];
      const sharedFile = new Set(["/path/to/shared.md"]);

      cache.set(query1, results, sharedFile);
      cache.set(query2, results, sharedFile);

      const invalidated = cache.invalidateByFile("/path/to/shared.md");

      expect(invalidated).toBe(2);
      expect(cache.get(query1)).toBeUndefined();
      expect(cache.get(query2)).toBeUndefined();
    });

    it("should respect enableFileInvalidation option", () => {
      const noFileCache = new SPARQLResultCache({
        maxSize: 10,
        enableFileInvalidation: false,
      });
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const results: SolutionMapping[] = [new SolutionMapping()];
      const affectedFiles = new Set(["/path/to/file.md"]);

      noFileCache.set(query, results, affectedFiles);

      const invalidated = noFileCache.invalidateByFile("/path/to/file.md");

      expect(invalidated).toBe(0);
      expect(noFileCache.get(query)).toEqual(results);
    });
  });

  describe("clear()", () => {
    it("should clear all cache entries", () => {
      cache.set("query1", [new SolutionMapping()]);
      cache.set("query2", [new SolutionMapping()]);

      expect(cache.size()).toBe(2);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get("query1")).toBeUndefined();
      expect(cache.get("query2")).toBeUndefined();
    });
  });

  describe("statistics", () => {
    it("should track hits and misses", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      cache.set(query, [new SolutionMapping()]);

      cache.get(query); // hit
      cache.get(query); // hit
      cache.get("other query"); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it("should track evictions", () => {
      const smallCache = new SPARQLResultCache({ maxSize: 2 });

      smallCache.set("query1", [new SolutionMapping()]);
      smallCache.set("query2", [new SolutionMapping()]);
      smallCache.set("query3", [new SolutionMapping()]); // Evicts query1

      const stats = smallCache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it("should track file invalidations", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const files = new Set(["/path/to/file.md"]);

      cache.set(query, [new SolutionMapping()], files);
      cache.invalidateByFile("/path/to/file.md");

      const stats = cache.getStats();
      expect(stats.fileInvalidations).toBe(1);
    });

    it("should reset stats", () => {
      cache.set("query", [new SolutionMapping()]);
      cache.get("query");
      cache.get("missing");

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe("result size limit", () => {
    it("should not cache results exceeding size limit", () => {
      const smallCache = new SPARQLResultCache({
        maxSize: 10,
        maxResultSizeBytes: 100, // Very small limit
      });

      // Create a large result
      const largeResults: SolutionMapping[] = Array.from(
        { length: 100 },
        () => new SolutionMapping()
      );

      smallCache.set("query", largeResults);

      // Should not be cached due to size limit
      expect(smallCache.get("query")).toBeUndefined();
    });
  });
});
