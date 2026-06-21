/**
 * Memory Management Module
 *
 * Provides memory-efficient data structures and utilities for
 * handling large graph datasets in the Exocortex knowledge management system.
 *
 * Key components:
 * - CompactGraphStore: TypedArray-based graph storage
 * - StringTable: String interning for URIs and labels
 * - MemoryPool: Pooled array allocation
 * - StreamingLoader: Incremental data loading
 *
 * @module infrastructure/memory
 * @since 1.0.0
 */

// Types
export type {
  CompactNodeData,
  CompactEdgeData,
  CompactGraphStoreConfig,
  MemoryStats,
  NodeUpdate,
  BatchUpdateResult,
  ChunkNode,
  ChunkEdge,
  GraphChunk,
  StreamingProgressEvent,
  StreamingProgressCallback,
} from "./types";

export { NODE_FLAGS, DEFAULT_COLORS } from "./types";

// StringTable
export { StringTable } from "./StringTable";

// CompactGraphStore
export { CompactGraphStore } from "./CompactGraphStore";

// MemoryPool
export type { MemoryPoolConfig, PoolStats } from "./MemoryPool";
export { MemoryPool, getGlobalPool, resetGlobalPool } from "./MemoryPool";

// StreamingLoader
export type { StreamingLoaderConfig, LoaderState } from "./StreamingLoader";
export { StreamingLoader, createStreamingSource } from "./StreamingLoader";
