import type { AlgebraOperation } from "../algebra/AlgebraOperation";
import { LRUCache } from "../../rdf/LRUCache";

/**
 * Caches optimized SPARQL algebra trees to avoid re-parsing and re-optimizing
 * repeated queries. Uses LRU eviction to bound memory usage.
 *
 * The cache key is the normalized query string (whitespace normalized).
 * The cached value is the fully optimized algebra tree ready for execution.
 *
 * Cache is automatically invalidated when the triple store changes (add/remove),
 * as query results may differ. Invalidation is handled externally by calling clear().
 */
export class QueryPlanCache {
  private readonly cache: LRUCache<string, AlgebraOperation>;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 100) {
    this.cache = new LRUCache(maxSize);
  }

  /**
   * Get a cached query plan for the given query string.
   * Returns undefined if not cached.
   */
  get(queryString: string): AlgebraOperation | undefined {
    const key = this.normalizeQuery(queryString);
    const plan = this.cache.get(key);
    if (plan !== undefined) {
      this.hits++;
    } else {
      this.misses++;
    }
    return plan;
  }

  /**
   * Cache an optimized query plan for the given query string.
   */
  set(queryString: string, plan: AlgebraOperation): void {
    const key = this.normalizeQuery(queryString);
    this.cache.set(key, plan);
  }

  /**
   * Check if a query plan is cached.
   */
  has(queryString: string): boolean {
    const key = this.normalizeQuery(queryString);
    return this.cache.get(key) !== undefined;
  }

  /**
   * Clear all cached query plans.
   * Call this when the triple store is modified.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for monitoring.
   */
  getStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size(),
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Normalize query string for consistent cache keys.
   * Collapses whitespace and trims.
   */
  private normalizeQuery(queryString: string): string {
    return queryString.replace(/\s+/g, " ").trim();
  }
}
