import crypto from "crypto";
import path from "path";
import os from "os";
import fs from "fs-extra";

/**
 * Default eviction caps (Issue #3981). When either the entry count or the
 * total size of the query-results cache exceeds its cap after a `set`, the
 * oldest entries are pruned until both are back under the cap. These prevent
 * the unbounded growth observed pre-#3979 (18,094 files / 191 MB on a real
 * machine — distinct queries each write one file and were never proactively
 * evicted). Cached SPARQL results are freely regenerable, so pruning is safe.
 */
export const DEFAULT_MAX_ENTRIES = 500;
export const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Options for QueryResultCache constructor
 */
export interface QueryResultCacheOptions {
  /** Custom cache directory. Defaults to ~/.exocortex/cache/query-results */
  cacheDir?: string;
  /**
   * Maximum number of cache entries before oldest-first eviction kicks in on
   * `set`. Defaults to {@link DEFAULT_MAX_ENTRIES}. A non-positive / non-finite
   * value disables the count cap.
   */
  maxEntries?: number;
  /**
   * Maximum total cache size in bytes before oldest-first eviction kicks in on
   * `set`. Defaults to {@link DEFAULT_MAX_SIZE_BYTES}. A non-positive /
   * non-finite value disables the size cap.
   */
  maxSizeBytes?: number;
}

/**
 * Structure of cached data stored on disk
 */
interface CachedData {
  /** Unix timestamp (ms) when the result was cached */
  timestamp: number;
  /** The cached query result */
  result: unknown;
  /**
   * Coarse vault content signature at cache time (Issue #3983). When present and
   * a signature is supplied to {@link QueryResultCache.get}, a mismatch means the
   * vault changed since caching → the entry is treated as stale. Absent on
   * entries written before this feature (and when the caller supplies no
   * signature) → falls back to TTL-only invalidation (prior behaviour).
   */
  vaultSignature?: string;
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
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;

  constructor(options: QueryResultCacheOptions = {}) {
    this.cacheDir = options.cacheDir ??
      path.join(os.homedir(), ".exocortex", "cache", "query-results");
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
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
   * @param vaultSignature - Optional coarse vault content signature (Issue #3983).
   *   When both this and the stored signature are present and differ, the vault
   *   changed since caching → the entry is stale (removed, cache miss). Omit (or
   *   pass null) to keep TTL-only invalidation.
   * @returns The cached result, or null if not found, expired, or stale
   */
  async get(
    query: string,
    ttlSeconds: number,
    vaultSignature?: string | null,
  ): Promise<unknown | null> {
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

      // Issue #3983: vault-mtime-aware invalidation. If the caller supplied a
      // signature and the entry was cached with one, a mismatch means the vault
      // changed since caching (e.g. a set-property / apply mutation) → stale.
      // When either signature is absent, fall back to TTL-only (prior behaviour).
      if (
        vaultSignature &&
        cached.vaultSignature &&
        cached.vaultSignature !== vaultSignature
      ) {
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
   * @param vaultSignature - Optional coarse vault content signature (Issue #3983)
   *   captured at cache time, used by {@link QueryResultCache.get} to detect a
   *   vault change. Omit (or pass null) to store a TTL-only entry.
   */
  async set(
    query: string,
    result: unknown,
    ttlSeconds: number,
    vaultSignature?: string | null,
  ): Promise<void> {
    const cacheKey = this.getCacheKey(query);
    const cachePath = this.getCachePath(cacheKey);

    // Ensure cache directory exists
    await fs.ensureDir(this.cacheDir);

    const data: CachedData = {
      timestamp: Date.now(),
      result,
      ...(vaultSignature ? { vaultSignature } : {}),
    };

    // Write atomically to prevent corruption
    // fs-extra's writeJson creates a temp file and renames it
    await fs.writeJson(cachePath, data, { spaces: 0 });

    // Issue #3981 — enforce size/count caps with oldest-first eviction so the
    // cache directory does not grow unbounded from distinct queries. Best-effort:
    // never let a prune failure fail the write we just committed, and never evict
    // the entry we just wrote.
    await this.prune(cacheKey);
  }

  /**
   * Enforces the entry-count and total-size caps by evicting the oldest cache
   * entries (by file mtime) until both are back within their caps. Expired
   * entries — being the oldest writes — are naturally evicted first.
   *
   * Best-effort: swallows all errors (a prune failure must never fail the
   * `set` that triggered it) and never evicts the just-written entry.
   *
   * @param keepKey - Cache key of the just-written entry to preserve.
   */
  private async prune(keepKey: string): Promise<void> {
    try {
      const countCapped = Number.isFinite(this.maxEntries) && this.maxEntries > 0;
      const sizeCapped = Number.isFinite(this.maxSizeBytes) && this.maxSizeBytes > 0;
      if (!countCapped && !sizeCapped) {
        return;
      }

      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith(".json"));

      const entries: { path: string; mtimeMs: number; size: number }[] = [];
      let totalSizeBytes = 0;
      const keepFile = `${keepKey}.json`;
      for (const file of jsonFiles) {
        if (file === keepFile) {
          // The just-written entry always counts toward totals but is never a
          // prune candidate.
          try {
            const stat = await fs.stat(path.join(this.cacheDir, file));
            totalSizeBytes += stat.size;
          } catch {
            // File vanished (concurrent prune) — ignore.
          }
          continue;
        }
        try {
          const filePath = path.join(this.cacheDir, file);
          const stat = await fs.stat(filePath);
          entries.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
          totalSizeBytes += stat.size;
        } catch {
          // File vanished between readdir and stat — ignore.
        }
      }

      // +1 for the always-kept just-written entry (excluded from `entries`).
      let entryCount = entries.length + 1;

      const overCap = () =>
        (countCapped && entryCount > this.maxEntries) ||
        (sizeCapped && totalSizeBytes > this.maxSizeBytes);

      if (!overCap()) {
        return;
      }

      // Oldest first (smallest mtime). Expired entries sort to the front.
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);

      for (const entry of entries) {
        if (!overCap()) {
          break;
        }
        try {
          await fs.remove(entry.path);
          entryCount--;
          totalSizeBytes -= entry.size;
        } catch {
          // Ignore — another process may have removed it.
        }
      }
    } catch {
      // Prune is best-effort — never fail the caller's `set`.
    }
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
