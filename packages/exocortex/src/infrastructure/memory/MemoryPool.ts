/**
 * MemoryPool - Efficient Memory Management for Graph Operations
 *
 * Provides pooled allocation and reuse of typed arrays to reduce
 * garbage collection pressure during frequent graph operations.
 *
 * @module infrastructure/memory
 * @since 1.0.0
 */

/**
 * Pool configuration
 */
export interface MemoryPoolConfig {
  /** Maximum number of pooled arrays per size bucket */
  maxPooledArrays?: number;
  /** Size buckets for pooling (powers of 2 recommended) */
  sizeBuckets?: number[];
  /** Enable automatic cleanup when pool is too large */
  autoCleanup?: boolean;
  /** Maximum total memory for pooled arrays (bytes) */
  maxPoolMemory?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<MemoryPoolConfig> = {
  maxPooledArrays: 16,
  sizeBuckets: [64, 256, 1024, 4096, 16384, 65536, 262144],
  autoCleanup: true,
  maxPoolMemory: 50 * 1024 * 1024, // 50MB
};

/**
 * Pool statistics
 */
export interface PoolStats {
  /** Number of allocations served from pool */
  poolHits: number;
  /** Number of allocations requiring new array */
  poolMisses: number;
  /** Number of arrays currently in pool */
  pooledArrays: number;
  /** Approximate memory used by pooled arrays */
  pooledMemory: number;
  /** Number of arrays returned to pool */
  returned: number;
  /** Number of arrays rejected (pool full) */
  rejected: number;
}

/**
 * Generic typed array pool for efficient memory reuse.
 */
export class MemoryPool {
  private config: Required<MemoryPoolConfig>;

  /** Pool buckets for Float32Array */
  private float32Pool: Map<number, Float32Array[]> = new Map();
  /** Pool buckets for Uint32Array */
  private uint32Pool: Map<number, Uint32Array[]> = new Map();
  /** Pool buckets for Uint16Array */
  private uint16Pool: Map<number, Uint16Array[]> = new Map();
  /** Pool buckets for Uint8Array */
  private uint8Pool: Map<number, Uint8Array[]> = new Map();

  /** Statistics */
  private stats: PoolStats = {
    poolHits: 0,
    poolMisses: 0,
    pooledArrays: 0,
    pooledMemory: 0,
    returned: 0,
    rejected: 0,
  };

  constructor(config?: MemoryPoolConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize pool buckets
    for (const size of this.config.sizeBuckets) {
      this.float32Pool.set(size, []);
      this.uint32Pool.set(size, []);
      this.uint16Pool.set(size, []);
      this.uint8Pool.set(size, []);
    }
  }

  /**
   * Find the appropriate bucket size for a requested size.
   */
  private getBucketSize(requestedSize: number): number {
    for (const bucket of this.config.sizeBuckets) {
      if (bucket >= requestedSize) {
        return bucket;
      }
    }
    // Return requested size if larger than all buckets
    return requestedSize;
  }

  /**
   * Get a Float32Array from the pool or create a new one.
   *
   * @param size - Minimum size needed
   * @returns Float32Array of at least the requested size
   */
  public getFloat32(size: number): Float32Array {
    const bucketSize = this.getBucketSize(size);
    const bucket = this.float32Pool.get(bucketSize);

    if (bucket && bucket.length > 0) {
      this.stats.poolHits++;
      this.stats.pooledArrays--;
      this.stats.pooledMemory -= bucketSize * 4;
      const array = bucket.pop()!;
      // Zero out the array for clean reuse
      array.fill(0);
      return array;
    }

    this.stats.poolMisses++;
    return new Float32Array(bucketSize);
  }

  /**
   * Get a Uint32Array from the pool or create a new one.
   *
   * @param size - Minimum size needed
   * @returns Uint32Array of at least the requested size
   */
  public getUint32(size: number): Uint32Array {
    const bucketSize = this.getBucketSize(size);
    const bucket = this.uint32Pool.get(bucketSize);

    if (bucket && bucket.length > 0) {
      this.stats.poolHits++;
      this.stats.pooledArrays--;
      this.stats.pooledMemory -= bucketSize * 4;
      const array = bucket.pop()!;
      array.fill(0);
      return array;
    }

    this.stats.poolMisses++;
    return new Uint32Array(bucketSize);
  }

  /**
   * Get a Uint16Array from the pool or create a new one.
   *
   * @param size - Minimum size needed
   * @returns Uint16Array of at least the requested size
   */
  public getUint16(size: number): Uint16Array {
    const bucketSize = this.getBucketSize(size);
    const bucket = this.uint16Pool.get(bucketSize);

    if (bucket && bucket.length > 0) {
      this.stats.poolHits++;
      this.stats.pooledArrays--;
      this.stats.pooledMemory -= bucketSize * 2;
      const array = bucket.pop()!;
      array.fill(0);
      return array;
    }

    this.stats.poolMisses++;
    return new Uint16Array(bucketSize);
  }

  /**
   * Get a Uint8Array from the pool or create a new one.
   *
   * @param size - Minimum size needed
   * @returns Uint8Array of at least the requested size
   */
  public getUint8(size: number): Uint8Array {
    const bucketSize = this.getBucketSize(size);
    const bucket = this.uint8Pool.get(bucketSize);

    if (bucket && bucket.length > 0) {
      this.stats.poolHits++;
      this.stats.pooledArrays--;
      this.stats.pooledMemory -= bucketSize;
      const array = bucket.pop()!;
      array.fill(0);
      return array;
    }

    this.stats.poolMisses++;
    return new Uint8Array(bucketSize);
  }

  /**
   * Return a Float32Array to the pool for reuse.
   *
   * @param array - The array to return
   */
  public releaseFloat32(array: Float32Array): void {
    this.releaseToPool(this.float32Pool, array, 4);
  }

  /**
   * Return a Uint32Array to the pool for reuse.
   *
   * @param array - The array to return
   */
  public releaseUint32(array: Uint32Array): void {
    this.releaseToPool(this.uint32Pool, array, 4);
  }

  /**
   * Return a Uint16Array to the pool for reuse.
   *
   * @param array - The array to return
   */
  public releaseUint16(array: Uint16Array): void {
    this.releaseToPool(this.uint16Pool, array, 2);
  }

  /**
   * Return a Uint8Array to the pool for reuse.
   *
   * @param array - The array to return
   */
  public releaseUint8(array: Uint8Array): void {
    this.releaseToPool(this.uint8Pool, array, 1);
  }

  /**
   * Generic release to pool.
   */
  private releaseToPool<
    T extends Float32Array | Uint32Array | Uint16Array | Uint8Array
  >(pool: Map<number, T[]>, array: T, bytesPerElement: number): void {
    const size = array.length;
    const bucket = pool.get(size);

    // Check if this is a standard bucket size and pool isn't full
    if (bucket && bucket.length < this.config.maxPooledArrays) {
      // Check memory limit
      if (
        this.config.autoCleanup &&
        this.stats.pooledMemory + size * bytesPerElement >
          this.config.maxPoolMemory
      ) {
        // Pool is at memory limit, don't add
        this.stats.rejected++;
        return;
      }

      bucket.push(array as T);
      this.stats.returned++;
      this.stats.pooledArrays++;
      this.stats.pooledMemory += size * bytesPerElement;
    } else {
      this.stats.rejected++;
    }
  }

  /**
   * Get pool statistics.
   *
   * @returns Current pool stats
   */
  public getStats(): PoolStats {
    return { ...this.stats };
  }

  /**
   * Get cache hit ratio.
   *
   * @returns Hit ratio (0-1)
   */
  public getHitRatio(): number {
    const total = this.stats.poolHits + this.stats.poolMisses;
    return total > 0 ? this.stats.poolHits / total : 0;
  }

  /**
   * Clear all pooled arrays.
   */
  public clear(): void {
    for (const bucket of this.float32Pool.values()) {
      bucket.length = 0;
    }
    for (const bucket of this.uint32Pool.values()) {
      bucket.length = 0;
    }
    for (const bucket of this.uint16Pool.values()) {
      bucket.length = 0;
    }
    for (const bucket of this.uint8Pool.values()) {
      bucket.length = 0;
    }

    this.stats.pooledArrays = 0;
    this.stats.pooledMemory = 0;
  }

  /**
   * Perform cleanup of oldest/largest pooled arrays.
   * Call this during idle time to reduce memory pressure.
   *
   * @param targetMemory - Target memory usage (bytes)
   */
  public cleanup(targetMemory: number): void {
    if (this.stats.pooledMemory <= targetMemory) {
      return;
    }

    // Remove arrays from largest buckets first
    const sortedBuckets = [...this.config.sizeBuckets].sort((a, b) => b - a);

    for (const size of sortedBuckets) {
      if (this.stats.pooledMemory <= targetMemory) {
        break;
      }

      // Remove from each pool type
      for (const [pool, bytesPerElement] of [
        [this.float32Pool, 4],
        [this.uint32Pool, 4],
        [this.uint16Pool, 2],
        [this.uint8Pool, 1],
      ] as const) {
        const bucket = pool.get(size);
        if (bucket) {
          while (bucket.length > 0 && this.stats.pooledMemory > targetMemory) {
            bucket.pop();
            this.stats.pooledArrays--;
            this.stats.pooledMemory -= size * bytesPerElement;
          }
        }
      }
    }
  }

  /**
   * Reset statistics.
   */
  public resetStats(): void {
    this.stats.poolHits = 0;
    this.stats.poolMisses = 0;
    this.stats.returned = 0;
    this.stats.rejected = 0;
  }
}

/**
 * Global memory pool singleton.
 * Use this for shared memory management across the application.
 */
let globalPool: MemoryPool | null = null;

/**
 * Get the global memory pool instance.
 *
 * @returns The global MemoryPool
 */
export function getGlobalPool(): MemoryPool {
  if (!globalPool) {
    globalPool = new MemoryPool();
  }
  return globalPool;
}

/**
 * Reset the global memory pool (for testing).
 */
export function resetGlobalPool(): void {
  if (globalPool) {
    globalPool.clear();
  }
  globalPool = null;
}
