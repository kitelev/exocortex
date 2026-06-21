/**
 * SPARQLResultCache - Caches SPARQL query results for faster repeated queries
 *
 * This cache sits between the SPARQL executor and the triple store,
 * storing serialized query results for frequently-used queries.
 *
 * Features:
 * - LRU eviction when cache is full
 * - TTL-based expiration for freshness
 * - Automatic invalidation on triple store changes
 * - File-specific invalidation for incremental updates
 * - Statistics tracking for monitoring
 *
 * Performance targets (Issue #1280):
 * - SPARQL query should return < 1 second
 * - Cache hit should return < 10ms
 *
 * @module infrastructure/sparql/cache
 * @since 1.0.0
 */

import type { SolutionMapping } from "../SolutionMapping";
import type { Triple } from "../../../domain/models/rdf/Triple";
import { LRUCache } from "../../rdf/LRUCache";

/**
 * Result type that can be cached - either SELECT results or CONSTRUCT results
 */
export type CacheableResult = SolutionMapping[] | Triple[];

/**
 * Cache entry with metadata for invalidation
 */
interface CacheEntry {
  /** The cached result */
  result: CacheableResult;
  /** Timestamp when cached */
  timestamp: number;
  /** Set of file paths that contributed to this result */
  affectedFiles: Set<string>;
  /** Hash of the result for change detection */
  resultHash: string;
}

/**
 * Configuration options for SPARQLResultCache
 */
export interface SPARQLResultCacheOptions {
  /** Maximum number of queries to cache (default: 500) */
  maxSize?: number;
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttlMs?: number;
  /** Whether to enable file-based invalidation (default: true) */
  enableFileInvalidation?: boolean;
  /** Maximum result size to cache in bytes (default: 10MB) */
  maxResultSizeBytes?: number;
}

/**
 * Cache statistics for monitoring
 */
export interface SPARQLResultCacheStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Current cache size */
  size: number;
  /** Maximum cache size */
  maxSize: number;
  /** Number of evictions due to size limit */
  evictions: number;
  /** Number of invalidations due to TTL */
  ttlInvalidations: number;
  /** Number of invalidations due to file changes */
  fileInvalidations: number;
  /** Average time saved per cache hit (ms) */
  avgTimeSavedMs: number;
}

/**
 * Default configuration values
 */
const DEFAULT_OPTIONS: Required<SPARQLResultCacheOptions> = {
  maxSize: 500,
  ttlMs: 5 * 60 * 1000, // 5 minutes
  enableFileInvalidation: true,
  maxResultSizeBytes: 10 * 1024 * 1024, // 10MB
};

/**
 * SPARQLResultCache - High-performance query result cache
 *
 * @example
 * ```typescript
 * const cache = new SPARQLResultCache({ maxSize: 1000, ttlMs: 60000 });
 *
 * // Check cache before executing query
 * const cached = cache.get(queryString);
 * if (cached) {
 *   return cached;
 * }
 *
 * // Execute query and cache result
 * const result = await executor.execute(query);
 * cache.set(queryString, result, affectedFiles);
 *
 * // Invalidate when file changes
 * cache.invalidateByFile('/path/to/changed-file.md');
 *
 * // Get stats for monitoring
 * const stats = cache.getStats();
 * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
 * ```
 */
export class SPARQLResultCache {
  private readonly cache: LRUCache<string, CacheEntry>;
  private readonly options: Required<SPARQLResultCacheOptions>;

  /** Map from file path to set of query keys that depend on it */
  private readonly fileToQueries: Map<string, Set<string>> = new Map();

  /** Statistics tracking */
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    ttlInvalidations: 0,
    fileInvalidations: 0,
    totalTimeSavedMs: 0,
  };

  /** Estimated average query time for time-saved calculation */
  private avgQueryTimeMs = 100;

  constructor(options: SPARQLResultCacheOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new LRUCache(this.options.maxSize);
  }

  /**
   * Normalize query string for consistent cache keys.
   * Collapses whitespace and trims.
   */
  private normalizeQuery(queryString: string): string {
    return queryString.replace(/\s+/g, " ").trim();
  }

  /**
   * Calculate a simple hash of the result for change detection.
   */
  private hashResult(result: CacheableResult): string {
    // Use length as a simple hash - full content hashing is expensive
    if (this.isTripleArray(result)) {
      return `T:${result.length}`;
    }
    return `S:${result.length}`;
  }

  /**
   * Type guard to check if result is Triple array
   */
  private isTripleArray(result: CacheableResult): result is Triple[] {
    return result.length > 0 && "subject" in result[0];
  }

  /**
   * Estimate the size of a result in bytes
   */
  private estimateResultSize(result: CacheableResult): number {
    // Rough estimate: 200 bytes per solution mapping, 300 bytes per triple
    if (this.isTripleArray(result)) {
      return result.length * 300;
    }
    return result.length * 200;
  }

  /**
   * Get a cached result for the given query string.
   * Returns undefined if not cached or expired.
   *
   * @param queryString - The SPARQL query string
   * @returns The cached result or undefined
   */
  get(queryString: string): CacheableResult | undefined {
    const key = this.normalizeQuery(queryString);
    const entry = this.cache.get(key);

    if (entry === undefined) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.options.ttlMs) {
      this.cache.set(key, undefined as unknown as CacheEntry); // Force eviction
      this.stats.ttlInvalidations++;
      this.stats.misses++;
      return undefined;
    }

    this.stats.hits++;
    this.stats.totalTimeSavedMs += this.avgQueryTimeMs;
    return entry.result;
  }

  /**
   * Cache a query result.
   *
   * @param queryString - The SPARQL query string
   * @param result - The query result to cache
   * @param affectedFiles - Set of file paths that contributed to this result
   * @param queryTimeMs - Optional: actual query execution time for statistics
   */
  set(
    queryString: string,
    result: CacheableResult,
    affectedFiles?: Set<string>,
    queryTimeMs?: number
  ): void {
    // Skip if result is too large
    const size = this.estimateResultSize(result);
    if (size > this.options.maxResultSizeBytes) {
      return;
    }

    // Update average query time for stats
    if (queryTimeMs !== undefined) {
      this.avgQueryTimeMs = (this.avgQueryTimeMs + queryTimeMs) / 2;
    }

    const key = this.normalizeQuery(queryString);
    const files = affectedFiles ?? new Set<string>();

    const entry: CacheEntry = {
      result,
      timestamp: Date.now(),
      affectedFiles: files,
      resultHash: this.hashResult(result),
    };

    // Track evictions
    const wasEviction = this.cache.size() >= this.options.maxSize;
    if (wasEviction) {
      this.stats.evictions++;
    }

    this.cache.set(key, entry);

    // Update file-to-query index for fast invalidation
    if (this.options.enableFileInvalidation) {
      for (const file of files) {
        let queries = this.fileToQueries.get(file);
        if (!queries) {
          queries = new Set();
          this.fileToQueries.set(file, queries);
        }
        queries.add(key);
      }
    }
  }

  /**
   * Check if a query is cached (without affecting LRU order).
   *
   * @param queryString - The SPARQL query string
   * @returns true if cached and not expired
   */
  has(queryString: string): boolean {
    const key = this.normalizeQuery(queryString);
    const entry = this.cache.get(key);

    if (entry === undefined) {
      return false;
    }

    // Check TTL without updating LRU
    const age = Date.now() - entry.timestamp;
    return age <= this.options.ttlMs;
  }

  /**
   * Invalidate cache entries that depend on a specific file.
   * Call this when a file is modified/created/deleted.
   *
   * @param filePath - Path to the changed file
   * @returns Number of cache entries invalidated
   */
  invalidateByFile(filePath: string): number {
    if (!this.options.enableFileInvalidation) {
      return 0;
    }

    const queries = this.fileToQueries.get(filePath);
    if (!queries) {
      return 0;
    }

    let invalidated = 0;
    for (const key of queries) {
      // We can't directly delete from LRU, so we set to undefined which will be treated as miss
      this.cache.set(key, undefined as unknown as CacheEntry);
      invalidated++;
      this.stats.fileInvalidations++;
    }

    this.fileToQueries.delete(filePath);
    return invalidated;
  }

  /**
   * Invalidate all cache entries.
   * Call this when the triple store is completely rebuilt.
   */
  clear(): void {
    this.cache.clear();
    this.fileToQueries.clear();
  }

  /**
   * Get cache statistics for monitoring.
   *
   * @returns Cache statistics
   */
  getStats(): SPARQLResultCacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      size: this.cache.size(),
      maxSize: this.options.maxSize,
      evictions: this.stats.evictions,
      ttlInvalidations: this.stats.ttlInvalidations,
      fileInvalidations: this.stats.fileInvalidations,
      avgTimeSavedMs: this.stats.hits > 0
        ? this.stats.totalTimeSavedMs / this.stats.hits
        : 0,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      ttlInvalidations: 0,
      fileInvalidations: 0,
      totalTimeSavedMs: 0,
    };
  }

  /**
   * Get the current cache size.
   */
  size(): number {
    return this.cache.size();
  }

  /**
   * Prune expired entries.
   * Call periodically to free memory.
   *
   * @returns Number of entries pruned
   */
  pruneExpired(): number {
    // LRU cache doesn't expose iteration, so we can't prune directly
    // This is a placeholder for future optimization
    return 0;
  }
}

/**
 * Create a new SPARQLResultCache instance with the given options.
 *
 * @param options - Cache configuration options
 * @returns New cache instance
 */
export function createSPARQLResultCache(
  options?: SPARQLResultCacheOptions
): SPARQLResultCache {
  return new SPARQLResultCache(options);
}
