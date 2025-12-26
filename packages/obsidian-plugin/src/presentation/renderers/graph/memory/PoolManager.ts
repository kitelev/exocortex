/**
 * PoolManager - Central coordinator for multiple object pools
 *
 * Manages a collection of object pools with unified metrics, lifecycle management,
 * and memory pressure handling. Provides a single point of access for all pooled
 * resources in the graph rendering system.
 *
 * Features:
 * - Centralized pool registration and management
 * - Unified metrics across all pools
 * - Memory pressure detection and response
 * - Automatic cleanup and maintenance
 * - Global statistics and monitoring
 *
 * @module presentation/renderers/graph/memory
 * @since 1.0.0
 */

import {
  ObjectPool,
  createObjectPool,
  type PoolConfig,
  type PoolMetrics,
  type Poolable,
} from "./ObjectPool";
import {
  RenderBatch,
  EventObject,
  ComputationBuffer,
  PoolableVector2D,
  PoolableRect,
} from "./PoolableTypes";

/**
 * Pool registration entry
 */
interface PoolEntry<T extends Poolable> {
  /** The object pool */
  pool: ObjectPool<T>;
  /** Pool priority (higher = more important) */
  priority: number;
  /** Whether pool is essential (never shrink below initial) */
  essential: boolean;
}

/**
 * Memory pressure levels
 */
export enum MemoryPressureLevel {
  /** Normal operation */
  NORMAL = "normal",
  /** Moderate pressure, start considering cleanup */
  MODERATE = "moderate",
  /** High pressure, aggressive cleanup needed */
  HIGH = "high",
  /** Critical pressure, emergency measures */
  CRITICAL = "critical",
}

/**
 * Pool manager configuration
 */
export interface PoolManagerConfig {
  /** Enable automatic memory pressure management (default: true) */
  enablePressureManagement?: boolean;
  /** Memory pressure check interval in ms (default: 1000) */
  pressureCheckInterval?: number;
  /** Threshold for moderate pressure (default: 0.7) */
  moderatePressureThreshold?: number;
  /** Threshold for high pressure (default: 0.85) */
  highPressureThreshold?: number;
  /** Threshold for critical pressure (default: 0.95) */
  criticalPressureThreshold?: number;
  /** Target memory limit in bytes (default: 64MB) */
  memoryLimitBytes?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Default pool manager configuration
 */
export const DEFAULT_POOL_MANAGER_CONFIG: Required<PoolManagerConfig> = {
  enablePressureManagement: true,
  pressureCheckInterval: 1000,
  moderatePressureThreshold: 0.7,
  highPressureThreshold: 0.85,
  criticalPressureThreshold: 0.95,
  memoryLimitBytes: 64 * 1024 * 1024, // 64MB
  debug: false,
};

/**
 * Aggregated pool statistics
 */
export interface PoolManagerStats {
  /** Number of registered pools */
  poolCount: number;
  /** Total objects across all pools */
  totalObjects: number;
  /** Total objects in use */
  totalInUse: number;
  /** Total objects available */
  totalAvailable: number;
  /** Total acquisitions */
  totalAcquisitions: number;
  /** Total pool hits */
  totalHits: number;
  /** Total pool misses */
  totalMisses: number;
  /** Overall hit rate */
  overallHitRate: number;
  /** Estimated memory usage in bytes */
  estimatedMemoryBytes: number;
  /** Current memory pressure level */
  pressureLevel: MemoryPressureLevel;
  /** Per-pool metrics */
  poolMetrics: Map<string, PoolMetrics>;
}

/**
 * Pool manager event types
 */
export type PoolManagerEventType =
  | "poolRegistered"
  | "poolUnregistered"
  | "pressureChange"
  | "cleanup"
  | "reset";

/**
 * Pool manager event
 */
export interface PoolManagerEvent {
  /** Event type */
  type: PoolManagerEventType;
  /** Pool name (for pool events) */
  poolName?: string;
  /** Previous pressure level (for pressure events) */
  previousPressure?: MemoryPressureLevel;
  /** New pressure level (for pressure events) */
  newPressure?: MemoryPressureLevel;
  /** Stats snapshot */
  stats: PoolManagerStats;
}

/**
 * Pool manager event listener
 */
export type PoolManagerEventListener = (event: PoolManagerEvent) => void;

/**
 * Built-in pool names
 */
export const POOL_NAMES = {
  RENDER_BATCH: "renderBatch",
  EVENT: "event",
  COMPUTATION_BUFFER: "computationBuffer",
  VECTOR2D: "vector2d",
  RECT: "rect",
} as const;

/**
 * Default pool configurations for built-in pools
 */
export const DEFAULT_POOL_CONFIGS: Record<string, Partial<PoolConfig>> = {
  [POOL_NAMES.RENDER_BATCH]: {
    initialSize: 8,
    maxSize: 64,
    growthFactor: 2,
    shrinkThreshold: 0.25,
  },
  [POOL_NAMES.EVENT]: {
    initialSize: 32,
    maxSize: 256,
    growthFactor: 2,
    shrinkThreshold: 0.25,
  },
  [POOL_NAMES.COMPUTATION_BUFFER]: {
    initialSize: 4,
    maxSize: 32,
    growthFactor: 2,
    shrinkThreshold: 0.5,
  },
  [POOL_NAMES.VECTOR2D]: {
    initialSize: 128,
    maxSize: 4096,
    growthFactor: 2,
    shrinkThreshold: 0.25,
  },
  [POOL_NAMES.RECT]: {
    initialSize: 64,
    maxSize: 1024,
    growthFactor: 2,
    shrinkThreshold: 0.25,
  },
};

/**
 * PoolManager - Centralized object pool management
 *
 * @example
 * ```typescript
 * // Create manager with custom config
 * const manager = new PoolManager({
 *   memoryLimitBytes: 128 * 1024 * 1024, // 128MB
 * });
 *
 * // Initialize built-in pools
 * manager.initializeBuiltInPools();
 *
 * // Acquire objects from pools
 * const batch = manager.acquireRenderBatch();
 * const event = manager.acquireEvent();
 *
 * // Use objects...
 *
 * // Release back to pools
 * manager.releaseRenderBatch(batch);
 * manager.releaseEvent(event);
 *
 * // Get stats
 * console.log(manager.getStats());
 * ```
 */
export class PoolManager {
  /** Configuration */
  private config: Required<PoolManagerConfig>;

  /** Registered pools */
  private pools: Map<string, PoolEntry<Poolable>> = new Map();

  /** Current pressure level */
  private pressureLevel: MemoryPressureLevel = MemoryPressureLevel.NORMAL;

  /** Pressure check interval handle */
  private pressureCheckHandle: ReturnType<typeof setInterval> | null = null;

  /** Event listeners */
  private listeners: Set<PoolManagerEventListener> = new Set();

  /** Built-in pool references */
  private renderBatchPool: ObjectPool<RenderBatch> | null = null;
  private eventPool: ObjectPool<EventObject> | null = null;
  private computationBufferPool: ObjectPool<ComputationBuffer> | null = null;
  private vector2DPool: ObjectPool<PoolableVector2D> | null = null;
  private rectPool: ObjectPool<PoolableRect> | null = null;

  constructor(config: Partial<PoolManagerConfig> = {}) {
    this.config = { ...DEFAULT_POOL_MANAGER_CONFIG, ...config };

    if (this.config.enablePressureManagement) {
      this.startPressureMonitoring();
    }
  }

  /**
   * Initialize built-in pools
   */
  initializeBuiltInPools(): void {
    // Render batch pool
    this.renderBatchPool = createObjectPool(
      () => new RenderBatch(),
      DEFAULT_POOL_CONFIGS[POOL_NAMES.RENDER_BATCH],
      POOL_NAMES.RENDER_BATCH
    );
    this.registerPool(POOL_NAMES.RENDER_BATCH, this.renderBatchPool, 1, true);

    // Event pool
    this.eventPool = createObjectPool(
      () => new EventObject(),
      DEFAULT_POOL_CONFIGS[POOL_NAMES.EVENT],
      POOL_NAMES.EVENT
    );
    this.registerPool(POOL_NAMES.EVENT, this.eventPool, 2, true);

    // Computation buffer pool
    this.computationBufferPool = createObjectPool(
      () => new ComputationBuffer(),
      DEFAULT_POOL_CONFIGS[POOL_NAMES.COMPUTATION_BUFFER],
      POOL_NAMES.COMPUTATION_BUFFER
    );
    this.registerPool(POOL_NAMES.COMPUTATION_BUFFER, this.computationBufferPool, 1, false);

    // Vector2D pool
    this.vector2DPool = createObjectPool(
      () => new PoolableVector2D(),
      DEFAULT_POOL_CONFIGS[POOL_NAMES.VECTOR2D],
      POOL_NAMES.VECTOR2D
    );
    this.registerPool(POOL_NAMES.VECTOR2D, this.vector2DPool, 0, false);

    // Rect pool
    this.rectPool = createObjectPool(
      () => new PoolableRect(),
      DEFAULT_POOL_CONFIGS[POOL_NAMES.RECT],
      POOL_NAMES.RECT
    );
    this.registerPool(POOL_NAMES.RECT, this.rectPool, 0, false);
  }

  /**
   * Register a pool with the manager
   *
   * @param name - Unique pool name
   * @param pool - The object pool
   * @param priority - Pool priority (higher = more important)
   * @param essential - Whether pool is essential
   */
  registerPool<T extends Poolable>(
    name: string,
    pool: ObjectPool<T>,
    priority: number = 0,
    essential: boolean = false
  ): void {
    if (this.pools.has(name)) {
      console.warn(`PoolManager: Pool '${name}' already registered, replacing`);
    }

    this.pools.set(name, {
      pool: pool as unknown as ObjectPool<Poolable>,
      priority,
      essential,
    });

    this.emitEvent({
      type: "poolRegistered",
      poolName: name,
      stats: this.getStats(),
    });

    if (this.config.debug) {
      console.log(`PoolManager: Registered pool '${name}'`);
    }
  }

  /**
   * Unregister a pool from the manager
   *
   * @param name - Pool name to remove
   * @returns True if pool was removed
   */
  unregisterPool(name: string): boolean {
    const entry = this.pools.get(name);
    if (!entry) {
      return false;
    }

    entry.pool.destroy();
    this.pools.delete(name);

    this.emitEvent({
      type: "poolUnregistered",
      poolName: name,
      stats: this.getStats(),
    });

    if (this.config.debug) {
      console.log(`PoolManager: Unregistered pool '${name}'`);
    }

    return true;
  }

  /**
   * Get a pool by name
   *
   * @param name - Pool name
   * @returns The pool or undefined
   */
  getPool<T extends Poolable>(name: string): ObjectPool<T> | undefined {
    const entry = this.pools.get(name);
    return entry?.pool as ObjectPool<T> | undefined;
  }

  // Built-in pool accessors
  acquireRenderBatch(): RenderBatch {
    if (!this.renderBatchPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.renderBatchPool.acquire();
  }

  releaseRenderBatch(batch: RenderBatch): boolean {
    if (!this.renderBatchPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.renderBatchPool.release(batch);
  }

  acquireEvent(): EventObject {
    if (!this.eventPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.eventPool.acquire();
  }

  releaseEvent(event: EventObject): boolean {
    if (!this.eventPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.eventPool.release(event);
  }

  acquireComputationBuffer(): ComputationBuffer {
    if (!this.computationBufferPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.computationBufferPool.acquire();
  }

  releaseComputationBuffer(buffer: ComputationBuffer): boolean {
    if (!this.computationBufferPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.computationBufferPool.release(buffer);
  }

  acquireVector2D(): PoolableVector2D {
    if (!this.vector2DPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.vector2DPool.acquire();
  }

  releaseVector2D(vec: PoolableVector2D): boolean {
    if (!this.vector2DPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.vector2DPool.release(vec);
  }

  acquireRect(): PoolableRect {
    if (!this.rectPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.rectPool.acquire();
  }

  releaseRect(rect: PoolableRect): boolean {
    if (!this.rectPool) {
      throw new Error("PoolManager: Built-in pools not initialized");
    }
    return this.rectPool.release(rect);
  }

  /**
   * Start memory pressure monitoring
   */
  private startPressureMonitoring(): void {
    if (this.pressureCheckHandle) {
      return;
    }

    this.pressureCheckHandle = setInterval(() => {
      this.checkPressure();
    }, this.config.pressureCheckInterval);
  }

  /**
   * Stop memory pressure monitoring
   */
  private stopPressureMonitoring(): void {
    if (this.pressureCheckHandle) {
      clearInterval(this.pressureCheckHandle);
      this.pressureCheckHandle = null;
    }
  }

  /**
   * Check and update memory pressure level
   */
  private checkPressure(): void {
    const stats = this.getStats();
    const usageRatio = stats.estimatedMemoryBytes / this.config.memoryLimitBytes;

    let newPressure: MemoryPressureLevel;

    if (usageRatio >= this.config.criticalPressureThreshold) {
      newPressure = MemoryPressureLevel.CRITICAL;
    } else if (usageRatio >= this.config.highPressureThreshold) {
      newPressure = MemoryPressureLevel.HIGH;
    } else if (usageRatio >= this.config.moderatePressureThreshold) {
      newPressure = MemoryPressureLevel.MODERATE;
    } else {
      newPressure = MemoryPressureLevel.NORMAL;
    }

    if (newPressure !== this.pressureLevel) {
      const previousPressure = this.pressureLevel;
      this.pressureLevel = newPressure;

      this.emitEvent({
        type: "pressureChange",
        previousPressure,
        newPressure,
        stats: this.getStats(),
      });

      if (this.config.debug) {
        console.log(
          `PoolManager: Pressure changed from ${previousPressure} to ${newPressure}`
        );
      }

      // Respond to pressure
      this.handlePressureChange(newPressure);
    }
  }

  /**
   * Handle pressure level change
   */
  private handlePressureChange(pressure: MemoryPressureLevel): void {
    switch (pressure) {
      case MemoryPressureLevel.MODERATE:
        // Start shrinking non-essential pools
        this.shrinkNonEssentialPools();
        break;
      case MemoryPressureLevel.HIGH:
        // Aggressively shrink all pools
        this.shrinkAllPools();
        break;
      case MemoryPressureLevel.CRITICAL:
        // Emergency cleanup
        this.emergencyCleanup();
        break;
      case MemoryPressureLevel.NORMAL:
        // No action needed
        break;
    }
  }

  /**
   * Shrink non-essential pools
   */
  private shrinkNonEssentialPools(): void {
    for (const [name, entry] of this.pools) {
      if (!entry.essential) {
        const shrunk = entry.pool.shrink();
        if (shrunk > 0 && this.config.debug) {
          console.log(`PoolManager: Shrunk pool '${name}' by ${shrunk} objects`);
        }
      }
    }
  }

  /**
   * Shrink all pools
   */
  shrinkAllPools(): void {
    for (const [name, entry] of this.pools) {
      const shrunk = entry.pool.shrink();
      if (shrunk > 0 && this.config.debug) {
        console.log(`PoolManager: Shrunk pool '${name}' by ${shrunk} objects`);
      }
    }

    this.emitEvent({
      type: "cleanup",
      stats: this.getStats(),
    });
  }

  /**
   * Emergency cleanup - aggressive memory reduction
   */
  private emergencyCleanup(): void {
    // Sort pools by priority (ascending) to shrink lower priority first
    const sortedPools = Array.from(this.pools.entries()).sort(
      (a, b) => a[1].priority - b[1].priority
    );

    for (const [name, entry] of sortedPools) {
      // Force shrink to initial size
      while (entry.pool.getAvailableCount() > entry.pool.getConfig().initialSize) {
        const shrunk = entry.pool.shrink();
        if (shrunk === 0) break;

        if (this.config.debug) {
          console.log(`PoolManager: Emergency shrink pool '${name}' by ${shrunk}`);
        }
      }
    }

    this.emitEvent({
      type: "cleanup",
      stats: this.getStats(),
    });
  }

  /**
   * Get aggregated statistics
   */
  getStats(): PoolManagerStats {
    let totalObjects = 0;
    let totalInUse = 0;
    let totalAvailable = 0;
    let totalAcquisitions = 0;
    let totalHits = 0;
    let totalMisses = 0;
    let estimatedMemory = 0;
    const poolMetrics = new Map<string, PoolMetrics>();

    for (const [name, entry] of this.pools) {
      const metrics = entry.pool.getMetrics();
      poolMetrics.set(name, metrics);

      totalObjects += metrics.poolSize;
      totalInUse += metrics.inUseCount;
      totalAvailable += metrics.availableCount;
      totalAcquisitions += metrics.totalAcquisitions;
      totalHits += metrics.poolHits;
      totalMisses += metrics.poolMisses;

      // Estimate memory (rough heuristic)
      estimatedMemory += metrics.poolSize * this.estimateObjectSize(name);
    }

    const overallHitRate =
      totalAcquisitions > 0 ? (totalHits / totalAcquisitions) * 100 : 0;

    return {
      poolCount: this.pools.size,
      totalObjects,
      totalInUse,
      totalAvailable,
      totalAcquisitions,
      totalHits,
      totalMisses,
      overallHitRate,
      estimatedMemoryBytes: estimatedMemory,
      pressureLevel: this.pressureLevel,
      poolMetrics,
    };
  }

  /**
   * Estimate memory size for objects in a pool
   */
  private estimateObjectSize(poolName: string): number {
    // Rough estimates in bytes
    switch (poolName) {
      case POOL_NAMES.RENDER_BATCH:
        return 8192; // ~8KB per batch
      case POOL_NAMES.EVENT:
        return 256; // ~256B per event
      case POOL_NAMES.COMPUTATION_BUFFER:
        return 16384; // ~16KB per buffer
      case POOL_NAMES.VECTOR2D:
        return 32; // ~32B per vector
      case POOL_NAMES.RECT:
        return 48; // ~48B per rect
      default:
        return 128; // Default estimate
    }
  }

  /**
   * Get current memory pressure level
   */
  getPressureLevel(): MemoryPressureLevel {
    return this.pressureLevel;
  }

  /**
   * Reset all pools
   */
  reset(): void {
    for (const [name, entry] of this.pools) {
      entry.pool.clear();
      if (this.config.debug) {
        console.log(`PoolManager: Reset pool '${name}'`);
      }
    }

    this.pressureLevel = MemoryPressureLevel.NORMAL;

    this.emitEvent({
      type: "reset",
      stats: this.getStats(),
    });
  }

  /**
   * Add event listener
   */
  addEventListener(listener: PoolManagerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: PoolManagerEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(event: PoolManagerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("PoolManager: Event listener error:", error);
      }
    }
  }

  /**
   * Destroy the manager and all pools
   */
  destroy(): void {
    this.stopPressureMonitoring();

    for (const entry of this.pools.values()) {
      entry.pool.destroy();
    }

    this.pools.clear();
    this.listeners.clear();

    this.renderBatchPool = null;
    this.eventPool = null;
    this.computationBufferPool = null;
    this.vector2DPool = null;
    this.rectPool = null;
  }
}

/**
 * Create a PoolManager instance
 *
 * @param config - Configuration options
 * @returns PoolManager instance
 */
export function createPoolManager(config?: Partial<PoolManagerConfig>): PoolManager {
  return new PoolManager(config);
}

/**
 * Singleton instance for global pool management
 */
let globalPoolManager: PoolManager | null = null;

/**
 * Get or create the global pool manager
 *
 * @param config - Configuration options (only used on first call)
 * @returns Global PoolManager instance
 */
export function getGlobalPoolManager(config?: Partial<PoolManagerConfig>): PoolManager {
  if (!globalPoolManager) {
    globalPoolManager = new PoolManager(config);
    globalPoolManager.initializeBuiltInPools();
  }
  return globalPoolManager;
}

/**
 * Reset the global pool manager (for testing)
 */
export function resetGlobalPoolManager(): void {
  if (globalPoolManager) {
    globalPoolManager.destroy();
    globalPoolManager = null;
  }
}
