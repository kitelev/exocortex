/**
 * ObjectPool - Generic object pooling system for memory optimization
 *
 * Implements a high-performance object pool to minimize garbage collection
 * pressure during graph interactions. Supports configurable pool sizes,
 * automatic growth/shrinking, and detailed metrics collection.
 *
 * Features:
 * - Generic pooling for any Poolable object
 * - Configurable initial, max sizes and growth factor
 * - Automatic warmup on creation
 * - Pool shrinking based on usage patterns
 * - Comprehensive metrics for monitoring
 * - Thread-safe design patterns
 *
 * @module presentation/renderers/graph/memory
 * @since 1.0.0
 */

/**
 * Interface for objects that can be pooled
 */
export interface Poolable {
  /** Reset object to initial state for reuse */
  reset(): void;
  /** Check if object is currently in use */
  isInUse(): boolean;
  /** Mark object as in use or available */
  setInUse(inUse: boolean): void;
}

/**
 * Configuration for object pool behavior
 */
export interface PoolConfig {
  /** Initial number of objects to create (default: 16) */
  initialSize: number;
  /** Maximum pool size (default: 1024) */
  maxSize: number;
  /** Factor to grow pool by when exhausted (default: 2.0) */
  growthFactor: number;
  /** Usage ratio threshold for shrinking pool (default: 0.25) */
  shrinkThreshold: number;
  /** Number of objects to create during warmup (optional, defaults to initialSize) */
  warmupCount?: number;
  /** Whether to enable automatic shrinking (default: true) */
  autoShrink?: boolean;
  /** Minimum time between shrink operations in ms (default: 5000) */
  shrinkCooldownMs?: number;
}

/**
 * Default pool configuration
 */
export const DEFAULT_POOL_CONFIG: Required<PoolConfig> = {
  initialSize: 16,
  maxSize: 1024,
  growthFactor: 2.0,
  shrinkThreshold: 0.25,
  warmupCount: 16,
  autoShrink: true,
  shrinkCooldownMs: 5000,
};

/**
 * Pool metrics for monitoring and debugging
 */
export interface PoolMetrics {
  /** Current pool size (total objects) */
  poolSize: number;
  /** Number of objects currently in use */
  inUseCount: number;
  /** Number of objects available */
  availableCount: number;
  /** Total acquisitions since creation */
  totalAcquisitions: number;
  /** Pool hits (object reused from pool) */
  poolHits: number;
  /** Pool misses (new object created) */
  poolMisses: number;
  /** Pool exhausted events (max size reached) */
  poolExhaustedEvents: number;
  /** Hit rate percentage */
  hitRate: number;
  /** Shrink operations performed */
  shrinkOperations: number;
  /** Grow operations performed */
  growOperations: number;
  /** Peak usage (max in use at once) */
  peakUsage: number;
  /** Last shrink timestamp */
  lastShrinkTime: number;
}

/**
 * Error thrown when pool is exhausted and cannot grow
 */
export class PoolExhaustedException extends Error {
  constructor(
    public readonly maxSize: number,
    public readonly poolName?: string
  ) {
    super(
      `Object pool ${poolName ? `'${poolName}' ` : ""}exhausted: max size of ${maxSize} reached`
    );
    this.name = "PoolExhaustedException";
  }
}

/**
 * Pool event types
 */
export type PoolEventType =
  | "acquire"
  | "release"
  | "grow"
  | "shrink"
  | "exhausted"
  | "reset";

/**
 * Pool event data
 */
export interface PoolEvent {
  /** Event type */
  type: PoolEventType;
  /** Current metrics snapshot */
  metrics: PoolMetrics;
  /** Optional additional data */
  data?: Record<string, unknown>;
}

/**
 * Pool event listener callback
 */
export type PoolEventListener = (event: PoolEvent) => void;

/**
 * ObjectPool - Generic high-performance object pool
 *
 * @typeParam T - Type of pooled objects, must implement Poolable interface
 *
 * @example
 * ```typescript
 * // Define a poolable object
 * class PoolableVector implements Poolable {
 *   x = 0;
 *   y = 0;
 *   private _inUse = false;
 *
 *   reset(): void {
 *     this.x = 0;
 *     this.y = 0;
 *   }
 *
 *   isInUse(): boolean {
 *     return this._inUse;
 *   }
 *
 *   setInUse(inUse: boolean): void {
 *     this._inUse = inUse;
 *   }
 * }
 *
 * // Create pool
 * const vectorPool = new ObjectPool(
 *   () => new PoolableVector(),
 *   { initialSize: 100, maxSize: 10000 }
 * );
 *
 * // Acquire and use
 * const vec = vectorPool.acquire();
 * vec.x = 10;
 * vec.y = 20;
 *
 * // Release back to pool
 * vectorPool.release(vec);
 *
 * // Get metrics
 * console.log(vectorPool.getMetrics());
 * ```
 */
export class ObjectPool<T extends Poolable> {
  /** Available objects in pool */
  private pool: T[] = [];

  /** Objects currently in use */
  private inUse: Set<T> = new Set();

  /** Factory function to create new objects */
  private factory: () => T;

  /** Pool configuration */
  private config: Required<PoolConfig>;

  /** Pool name for identification */
  private name: string;

  /** Metrics tracking */
  private metrics: PoolMetrics;

  /** Event listeners */
  private listeners: Set<PoolEventListener> = new Set();

  /**
   * Create a new ObjectPool
   *
   * @param factory - Factory function to create new pooled objects
   * @param config - Pool configuration options
   * @param name - Optional name for identification
   */
  constructor(factory: () => T, config: Partial<PoolConfig> = {}, name?: string) {
    this.factory = factory;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.name = name ?? "ObjectPool";

    // Initialize metrics
    this.metrics = {
      poolSize: 0,
      inUseCount: 0,
      availableCount: 0,
      totalAcquisitions: 0,
      poolHits: 0,
      poolMisses: 0,
      poolExhaustedEvents: 0,
      hitRate: 0,
      shrinkOperations: 0,
      growOperations: 0,
      peakUsage: 0,
      lastShrinkTime: 0,
    };

    // Warmup pool
    this.warmup();
  }

  /**
   * Warmup the pool by pre-creating objects
   */
  private warmup(): void {
    const count = this.config.warmupCount ?? this.config.initialSize;
    for (let i = 0; i < count; i++) {
      const obj = this.createObject();
      this.pool.push(obj);
    }
    this.updateMetrics();
  }

  /**
   * Create a new pooled object using the factory
   */
  private createObject(): T {
    const obj = this.factory();
    obj.setInUse(false);
    return obj;
  }

  /**
   * Acquire an object from the pool
   *
   * @returns A pooled object ready for use
   * @throws PoolExhaustedException if pool is at max capacity
   */
  acquire(): T {
    this.metrics.totalAcquisitions++;

    let item: T;

    if (this.pool.length > 0) {
      // Reuse from pool
      item = this.pool.pop()!;
      this.metrics.poolHits++;
    } else if (this.getTotalSize() < this.config.maxSize) {
      // Create new object
      item = this.createObject();
      this.metrics.poolMisses++;
      this.metrics.growOperations++;

      this.emitEvent({
        type: "grow",
        metrics: this.getMetrics(),
        data: { reason: "pool_empty", newSize: this.getTotalSize() + 1 },
      });
    } else {
      // Pool exhausted
      this.metrics.poolExhaustedEvents++;
      this.emitEvent({
        type: "exhausted",
        metrics: this.getMetrics(),
      });
      throw new PoolExhaustedException(this.config.maxSize, this.name);
    }

    item.setInUse(true);
    this.inUse.add(item);

    // Update peak usage
    if (this.inUse.size > this.metrics.peakUsage) {
      this.metrics.peakUsage = this.inUse.size;
    }

    this.updateMetrics();

    this.emitEvent({
      type: "acquire",
      metrics: this.getMetrics(),
    });

    return item;
  }

  /**
   * Release an object back to the pool
   *
   * @param item - Object to release
   * @returns True if released successfully, false if item wasn't from this pool
   */
  release(item: T): boolean {
    if (!this.inUse.has(item)) {
      console.warn(`${this.name}: Attempting to release item not in use`);
      return false;
    }

    // Reset and return to pool
    item.reset();
    item.setInUse(false);
    this.inUse.delete(item);
    this.pool.push(item);

    this.updateMetrics();

    this.emitEvent({
      type: "release",
      metrics: this.getMetrics(),
    });

    // Check for auto-shrink opportunity
    if (this.config.autoShrink) {
      this.checkShrink();
    }

    return true;
  }

  /**
   * Release multiple objects back to the pool
   *
   * @param items - Objects to release
   * @returns Number of items successfully released
   */
  releaseAll(items: T[]): number {
    let released = 0;
    for (const item of items) {
      if (this.release(item)) {
        released++;
      }
    }
    return released;
  }

  /**
   * Check if pool should shrink based on usage
   */
  private checkShrink(): void {
    const now = Date.now();
    const cooldownElapsed =
      now - this.metrics.lastShrinkTime > this.config.shrinkCooldownMs;

    if (!cooldownElapsed) {
      return;
    }

    const totalSize = this.getTotalSize();
    const usageRatio = this.inUse.size / totalSize;

    if (usageRatio < this.config.shrinkThreshold && this.pool.length > this.config.initialSize) {
      this.shrink();
    }
  }

  /**
   * Shrink the pool by removing excess unused objects
   */
  shrink(): number {
    const targetSize = Math.max(
      this.config.initialSize,
      Math.ceil(this.inUse.size / this.config.shrinkThreshold)
    );

    const currentAvailable = this.pool.length;
    const targetAvailable = Math.max(0, targetSize - this.inUse.size);
    const toRemove = currentAvailable - targetAvailable;

    if (toRemove <= 0) {
      return 0;
    }

    // Remove excess objects
    this.pool.splice(0, toRemove);

    this.metrics.shrinkOperations++;
    this.metrics.lastShrinkTime = Date.now();
    this.updateMetrics();

    this.emitEvent({
      type: "shrink",
      metrics: this.getMetrics(),
      data: { removed: toRemove, newSize: this.getTotalSize() },
    });

    return toRemove;
  }

  /**
   * Grow the pool by a factor
   *
   * @param factor - Growth factor (default: config.growthFactor)
   * @returns Number of objects added
   */
  grow(factor?: number): number {
    const growthFactor = factor ?? this.config.growthFactor;
    const currentSize = this.getTotalSize();
    const targetSize = Math.min(
      this.config.maxSize,
      Math.ceil(currentSize * growthFactor)
    );
    const toAdd = targetSize - currentSize;

    if (toAdd <= 0) {
      return 0;
    }

    for (let i = 0; i < toAdd; i++) {
      const obj = this.createObject();
      this.pool.push(obj);
    }

    this.metrics.growOperations++;
    this.updateMetrics();

    this.emitEvent({
      type: "grow",
      metrics: this.getMetrics(),
      data: { added: toAdd, newSize: this.getTotalSize() },
    });

    return toAdd;
  }

  /**
   * Pre-allocate objects up to a specific size
   *
   * @param size - Target pool size
   * @returns Number of objects created
   */
  preallocate(size: number): number {
    const targetSize = Math.min(size, this.config.maxSize);
    const currentSize = this.getTotalSize();
    const toAdd = targetSize - currentSize;

    if (toAdd <= 0) {
      return 0;
    }

    for (let i = 0; i < toAdd; i++) {
      const obj = this.createObject();
      this.pool.push(obj);
    }

    this.updateMetrics();
    return toAdd;
  }

  /**
   * Clear all objects and reset to initial state
   */
  clear(): void {
    this.pool = [];
    this.inUse.clear();

    // Reset metrics
    this.metrics = {
      poolSize: 0,
      inUseCount: 0,
      availableCount: 0,
      totalAcquisitions: 0,
      poolHits: 0,
      poolMisses: 0,
      poolExhaustedEvents: 0,
      hitRate: 0,
      shrinkOperations: 0,
      growOperations: 0,
      peakUsage: 0,
      lastShrinkTime: 0,
    };

    this.emitEvent({
      type: "reset",
      metrics: this.getMetrics(),
    });

    // Re-warmup
    this.warmup();
  }

  /**
   * Get current pool metrics
   *
   * @returns Current metrics snapshot
   */
  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /**
   * Update metrics based on current state
   */
  private updateMetrics(): void {
    this.metrics.poolSize = this.getTotalSize();
    this.metrics.inUseCount = this.inUse.size;
    this.metrics.availableCount = this.pool.length;
    this.metrics.hitRate =
      this.metrics.totalAcquisitions > 0
        ? (this.metrics.poolHits / this.metrics.totalAcquisitions) * 100
        : 0;
  }

  /**
   * Get total pool size (available + in use)
   */
  getTotalSize(): number {
    return this.pool.length + this.inUse.size;
  }

  /**
   * Get number of available objects
   */
  getAvailableCount(): number {
    return this.pool.length;
  }

  /**
   * Get number of objects in use
   */
  getInUseCount(): number {
    return this.inUse.size;
  }

  /**
   * Check if pool has available objects
   */
  hasAvailable(): boolean {
    return this.pool.length > 0;
  }

  /**
   * Check if pool can grow
   */
  canGrow(): boolean {
    return this.getTotalSize() < this.config.maxSize;
  }

  /**
   * Get pool configuration
   */
  getConfig(): Required<PoolConfig> {
    return { ...this.config };
  }

  /**
   * Get pool name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Add event listener
   *
   * @param listener - Event callback
   * @returns Unsubscribe function
   */
  addEventListener(listener: PoolEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove event listener
   *
   * @param listener - Event callback to remove
   */
  removeEventListener(listener: PoolEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit pool event to listeners
   */
  private emitEvent(event: PoolEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`${this.name}: Event listener error:`, error);
      }
    }
  }

  /**
   * Destroy the pool and release all resources
   */
  destroy(): void {
    this.pool = [];
    this.inUse.clear();
    this.listeners.clear();
  }
}

/**
 * Create an ObjectPool instance
 *
 * @param factory - Factory function to create objects
 * @param config - Pool configuration
 * @param name - Optional pool name
 * @returns ObjectPool instance
 */
export function createObjectPool<T extends Poolable>(
  factory: () => T,
  config?: Partial<PoolConfig>,
  name?: string
): ObjectPool<T> {
  return new ObjectPool(factory, config, name);
}
