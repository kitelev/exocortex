import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";

// Import the module after test setup
const { QueryResultCache } = await import("../../../src/cache/QueryResultCache.js");

describe("QueryResultCache", () => {
  let tempDir: string;
  let cache: InstanceType<typeof QueryResultCache>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create temp directory for cache
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "query-cache-test-"));
    cache = new QueryResultCache({ cacheDir: tempDir });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe("getCacheKey", () => {
    it("should generate SHA256 hash of query string", () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const key = cache.getCacheKey(query);

      // Verify it's a valid SHA256 hash (64 hex characters)
      expect(key).toMatch(/^[a-f0-9]{64}$/);

      // Verify it's deterministic
      const key2 = cache.getCacheKey(query);
      expect(key2).toBe(key);

      // Verify different queries produce different keys
      const differentKey = cache.getCacheKey("SELECT ?x WHERE { ?x a ?type }");
      expect(differentKey).not.toBe(key);
    });

    it("should normalize whitespace for cache key generation", () => {
      const query1 = "SELECT * WHERE { ?s ?p ?o }";
      const query2 = "SELECT  *  WHERE  {  ?s  ?p  ?o  }";
      const query3 = "SELECT *\nWHERE {\n  ?s ?p ?o\n}";

      const key1 = cache.getCacheKey(query1);
      const key2 = cache.getCacheKey(query2);
      const key3 = cache.getCacheKey(query3);

      // All should produce the same key after normalization
      expect(key2).toBe(key1);
      expect(key3).toBe(key1);
    });
  });

  describe("get/set with TTL", () => {
    it("should return cached result within TTL", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [{ s: "test", p: "pred", o: "obj" }] };
      const ttlSeconds = 300;

      await cache.set(query, result, ttlSeconds);
      const cached = await cache.get(query, ttlSeconds);

      expect(cached).toEqual(result);
    });

    it("should return null when cache is expired", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [{ s: "test", p: "pred", o: "obj" }] };
      const ttlSeconds = 1; // 1 second TTL

      await cache.set(query, result, ttlSeconds);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const cached = await cache.get(query, ttlSeconds);
      expect(cached).toBeNull();
    });

    it("should return null when cache does not exist", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const cached = await cache.get(query, 300);
      expect(cached).toBeNull();
    });

    it("should handle custom TTL correctly", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [] };

      // Set with 10 second TTL
      await cache.set(query, result, 10);

      // Get with 5 second TTL - should find since set TTL was longer
      const cached5 = await cache.get(query, 5);
      expect(cached5).toEqual(result);

      // Get with 10 second TTL - should also find
      const cached10 = await cache.get(query, 10);
      expect(cached10).toEqual(result);
    });
  });

  describe("cache file structure", () => {
    it("should store cache as JSON with timestamp", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [{ x: "value" }] };

      await cache.set(query, result, 300);

      const cacheKey = cache.getCacheKey(query);
      const cachePath = path.join(tempDir, `${cacheKey}.json`);

      expect(await fs.pathExists(cachePath)).toBe(true);

      const stored = await fs.readJson(cachePath);
      expect(stored).toHaveProperty("timestamp");
      expect(stored).toHaveProperty("result");
      expect(stored.result).toEqual(result);
      expect(typeof stored.timestamp).toBe("number");
    });

    it("should use atomic writes to prevent corruption", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [{ x: "value" }] };

      // Write multiple times concurrently
      await Promise.all([
        cache.set(query, result, 300),
        cache.set(query, result, 300),
        cache.set(query, result, 300),
      ]);

      // Should be able to read without corruption
      const cached = await cache.get(query, 300);
      expect(cached).toEqual(result);
    });
  });

  describe("cache directory handling", () => {
    it("should create cache directory if it does not exist", async () => {
      const newCacheDir = path.join(tempDir, "new-cache-dir");
      const newCache = new QueryResultCache({ cacheDir: newCacheDir });

      expect(await fs.pathExists(newCacheDir)).toBe(false);

      await newCache.set("query", { result: "test" }, 300);

      expect(await fs.pathExists(newCacheDir)).toBe(true);
    });

    it("should use default cache directory (~/.exocortex/cache/query-results)", () => {
      const defaultCache = new QueryResultCache();
      const expectedDir = path.join(os.homedir(), ".exocortex", "cache", "query-results");
      expect(defaultCache.getCacheDir()).toBe(expectedDir);
    });
  });

  describe("invalidate", () => {
    it("should remove cached result for specific query", async () => {
      const query1 = "SELECT * WHERE { ?s ?p ?o }";
      const query2 = "SELECT ?x WHERE { ?x a ?type }";
      const result = { bindings: [] };

      await cache.set(query1, result, 300);
      await cache.set(query2, result, 300);

      await cache.invalidate(query1);

      expect(await cache.get(query1, 300)).toBeNull();
      expect(await cache.get(query2, 300)).toEqual(result);
    });

    it("should not throw when invalidating non-existent cache", async () => {
      await expect(cache.invalidate("non-existent")).resolves.not.toThrow();
    });
  });

  describe("clear", () => {
    it("should remove all cached results", async () => {
      const query1 = "SELECT * WHERE { ?s ?p ?o }";
      const query2 = "SELECT ?x WHERE { ?x a ?type }";
      const result = { bindings: [] };

      await cache.set(query1, result, 300);
      await cache.set(query2, result, 300);

      await cache.clear();

      expect(await cache.get(query1, 300)).toBeNull();
      expect(await cache.get(query2, 300)).toBeNull();
    });
  });

  describe("getCacheStats", () => {
    it("should return statistics about cache", async () => {
      const query1 = "SELECT * WHERE { ?s ?p ?o }";
      const query2 = "SELECT ?x WHERE { ?x a ?type }";
      const result = { bindings: [{ x: "test" }] };

      await cache.set(query1, result, 300);
      await cache.set(query2, result, 300);

      const stats = await cache.getCacheStats();

      expect(stats.entryCount).toBe(2);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
    });

    it("should return zero stats when cache is empty", async () => {
      const stats = await cache.getCacheStats();

      expect(stats.entryCount).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });
  });

  describe("isCached", () => {
    it("should return true when result is cached and not expired", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [] };

      await cache.set(query, result, 300);

      expect(await cache.isCached(query, 300)).toBe(true);
    });

    it("should return false when result is not cached", async () => {
      expect(await cache.isCached("non-existent", 300)).toBe(false);
    });

    it("should return false when result is expired", async () => {
      const query = "SELECT * WHERE { ?s ?p ?o }";
      const result = { bindings: [] };

      await cache.set(query, result, 1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(await cache.isCached(query, 1)).toBe(false);
    });
  });
});
