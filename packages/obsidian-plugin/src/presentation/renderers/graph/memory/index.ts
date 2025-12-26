/**
 * Memory Module
 *
 * Comprehensive object pooling and memory optimization system for graph visualization.
 * Minimizes garbage collection pressure during graph interactions by reusing
 * frequently allocated objects like render batches, events, and computation buffers.
 *
 * Components:
 * - ObjectPool: Generic high-performance object pooling
 * - PoolableTypes: Specialized poolable implementations (RenderBatch, EventObject, etc.)
 * - PoolManager: Central coordinator for multiple pools with memory pressure handling
 *
 * @module presentation/renderers/graph/memory
 * @since 1.0.0
 */

// Object Pool
export {
  ObjectPool,
  createObjectPool,
  PoolExhaustedException,
  DEFAULT_POOL_CONFIG,
} from "./ObjectPool";
export type {
  Poolable,
  PoolConfig,
  PoolMetrics,
  PoolEventType,
  PoolEvent,
  PoolEventListener,
} from "./ObjectPool";

// Poolable Types
export {
  BasePoolable,
  RenderBatch,
  EventObject,
  ComputationBuffer,
  PoolableVector2D,
  PoolableRect,
} from "./PoolableTypes";
export type {
  NodePosition,
  EdgePosition,
  PoolableEventType,
  BufferType,
} from "./PoolableTypes";

// Pool Manager
export {
  PoolManager,
  createPoolManager,
  getGlobalPoolManager,
  resetGlobalPoolManager,
  MemoryPressureLevel,
  POOL_NAMES,
  DEFAULT_POOL_CONFIGS,
  DEFAULT_POOL_MANAGER_CONFIG,
} from "./PoolManager";
export type {
  PoolManagerConfig,
  PoolManagerStats,
  PoolManagerEventType,
  PoolManagerEvent,
  PoolManagerEventListener,
} from "./PoolManager";
