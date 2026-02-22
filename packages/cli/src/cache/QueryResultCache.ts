import crypto from "crypto";
import path from "path";
import os from "os";
import fs from "fs-extra";

/**
 * Options for QueryResultCache constructor
 */
export interface QueryResultCacheOptions {
  /** Custom cache directory. Defaults to ~/.exocortex/cache/query-results */
  cacheDir?: string;
}

/**
 * Structure of cached data stored on disk
 */
interface CachedData {
  /** Unix timestamp (ms) when the result was cached */
  timestamp: number;
  /** The cached query result */
  result: unknown;
}

/**
 * Cache statistics
 */
export interface QueryCacheStats {
  /** Number of cached entries */
  entryCount: number;
  /** Total size of all cache files in bytes */
  totalSizeBytes: number;
}

/**
 * Query result cache with TTL-based invalidation.
 *
 * Caches SPARQL query results to reduce server load from repeated queries.
 * Uses SHA256 hash of normalized query text as cache key.
 *
 * @example
 * ```typescript
 * const cache = new QueryResultCache();
 *
 * // Cache a query result with 5-minute TTL
 * await cache.set("SELECT * WHERE { ?s ?p ?o }", results, 300);
 *
 * // Retrieve cached result (returns null if expired or not found)
 * const cached = await cache.get("SELECT * WHERE { ?s ?p ?o }", 300);
 * if (cached) {
 *   console.log("(cached)", cached);
 * }
 * ```
 */
export class QueryResultCache {
  private readonly cacheDir: string;

  constructor(options: QueryResultCacheOptions = {}) {
    this.cacheDir = options.cacheDir ??
      path.join(os.homedir(), ".exocortex", "cache", "query-results");
  }

  /**
   * Returns the cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Generates a SHA256 hash of the normalized query string.
   *
   * Normalization includes:
   * - Trimming whitespace
   * - Collapsing multiple whitespace characters to single space
   *
   * @param query - The SPARQL query string
   * @returns 64-character hexadecimal hash
   */
  getCacheKey(query: string): string {
    // Normalize query: trim and collapse whitespace
    const normalized = query.trim().replace(/\s+/g, " ");
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * Retrieves a cached query result if it exists and is not expired.
   *
   * @param query - The SPARQL query string
   * @param ttlSeconds - Time-to-live in seconds
   * @returns The cached result, or null if not found or expired
   */
  async get(query: string, ttlSeconds: number): Promise<unknown | null> {
    const cacheKey = this.getCacheKey(query);
    const cachePath = this.getCachePath(cacheKey);

    try {
      if (!await fs.pathExists(cachePath)) {
        return null;
      }

      const cached: CachedData = await fs.readJson(cachePath);

      // Check if cache has expired
      const ageMs = Date.now() - cached.timestamp;
      const ttlMs = ttlSeconds * 1000;

      if (ageMs > ttlMs) {
        // Cache expired, delete it
        await fs.remove(cachePath);
        return null;
      }

      return cached.result;
    } catch {
      // If any error occurs reading cache, treat as cache miss
      return null;
    }
  }

  /**
   * Stores a query result in the cache.
   *
   * Uses atomic writes to prevent corruption from concurrent writes.
   *
   * @param query - The SPARQL query string
   * @param result - The query result to cache
   * @param ttlSeconds - Time-to-live in seconds (stored for reference)
   */
  async set(query: string, result: unknown, ttlSeconds: number): Promise<void> {
    const cacheKey = this.getCacheKey(query);
    const cachePath = this.getCachePath(cacheKey);

    // Ensure cache directory exists
    await fs.ensureDir(this.cacheDir);

    const data: CachedData = {
      timestamp: Date.now(),
      result,
    };

    // Write atomically to prevent corruption
    // fs-extra's writeJson creates a temp file and renames it
    await fs.writeJson(cachePath, data, { spaces: 0 });
  }

  /**
   * Checks if a query result is cached and not expired.
   *
   * @param query - The SPARQL query string
   * @param ttlSeconds - Time-to-live in seconds
   * @returns true if result is cached and valid, false otherwise
   */
  async isCached(query: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.get(query, ttlSeconds);
    return result !== null;
  }

  /**
   * Invalidates (removes) the cache for a specific query.
   *
   * @param query - The SPARQL query string
   */
  async invalidate(query: string): Promise<void> {
    const cacheKey = this.getCacheKey(query);
    const cachePath = this.getCachePath(cacheKey);

    try {
      await fs.remove(cachePath);
    } catch {
      // Ignore errors if file doesn't exist
    }
  }

  /**
   * Clears all cached query results.
   */
  async clear(): Promise<void> {
    try {
      if (await fs.pathExists(this.cacheDir)) {
        const files = await fs.readdir(this.cacheDir);
        await Promise.all(
          files
            .filter(f => f.endsWith(".json"))
            .map(f => fs.remove(path.join(this.cacheDir, f)))
        );
      }
    } catch {
      // Ignore errors during clear
    }
  }

  /**
   * Returns statistics about the cache.
   *
   * @returns Cache statistics including entry count and total size
   */
  async getCacheStats(): Promise<QueryCacheStats> {
    try {
      if (!await fs.pathExists(this.cacheDir)) {
        return { entryCount: 0, totalSizeBytes: 0 };
      }

      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith(".json"));

      let totalSizeBytes = 0;
      for (const file of jsonFiles) {
        const stat = await fs.stat(path.join(this.cacheDir, file));
        totalSizeBytes += stat.size;
      }

      return {
        entryCount: jsonFiles.length,
        totalSizeBytes,
      };
    } catch {
      return { entryCount: 0, totalSizeBytes: 0 };
    }
  }

  /**
   * Returns the full path to a cache file.
   */
  private getCachePath(cacheKey: string): string {
    return path.join(this.cacheDir, `${cacheKey}.json`);
  }
}
