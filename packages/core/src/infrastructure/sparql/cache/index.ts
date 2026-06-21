/**
 * SPARQL Cache Module
 *
 * Provides caching infrastructure for SPARQL query execution:
 * - QueryPlanCache: Caches parsed and optimized query plans
 * - SPARQLResultCache: Caches query results with smart invalidation
 * - IncrementalIndexer: Tracks file changes for targeted cache invalidation
 *
 * @module infrastructure/sparql/cache
 * @since 1.0.0
 */

export { QueryPlanCache } from "./QueryPlanCache";

export {
  SPARQLResultCache,
  createSPARQLResultCache,
  type SPARQLResultCacheOptions,
  type SPARQLResultCacheStats,
  type CacheableResult,
} from "./SPARQLResultCache";

export {
  IncrementalIndexer,
  createIncrementalIndexer,
  type IncrementalIndexerOptions,
  type IncrementalIndexerStats,
  type FileChange,
  type ChangeType,
} from "./IncrementalIndexer";
