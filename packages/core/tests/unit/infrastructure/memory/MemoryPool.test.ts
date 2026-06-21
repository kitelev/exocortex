/**
 * Unit tests for MemoryPool
 */

import {
  MemoryPool,
  getGlobalPool,
  resetGlobalPool,
} from "../../../../src/infrastructure/memory/MemoryPool";

describe("MemoryPool", () => {
  let pool: MemoryPool;

  beforeEach(() => {
    pool = new MemoryPool({
      maxPooledArrays: 4,
      sizeBuckets: [64, 256, 1024],
      maxPoolMemory: 1024 * 1024, // 1MB
    });
  });

  describe("getFloat32", () => {
    it("should return a Float32Array of at least the requested size", () => {
      const arr = pool.getFloat32(50);
      expect(arr).toBeInstanceOf(Float32Array);
      expect(arr.length).toBeGreaterThanOrEqual(50);
    });

    it("should return a bucketed size", () => {
      const arr = pool.getFloat32(50);
      expect(arr.length).toBe(64); // Smallest bucket >= 50
    });

    it("should record a pool miss for new allocations", () => {
      pool.getFloat32(50);
      const stats = pool.getStats();
      expect(stats.poolMisses).toBe(1);
      expect(stats.poolHits).toBe(0);
    });

    it("should return a zeroed array from pool", () => {
      const arr1 = pool.getFloat32(64);
      arr1.fill(42);
      pool.releaseFloat32(arr1);

      const arr2 = pool.getFloat32(64);
      expect(arr2.every((v) => v === 0)).toBe(true);
    });
  });

  describe("getUint32", () => {
    it("should return a Uint32Array", () => {
      const arr = pool.getUint32(100);
      expect(arr).toBeInstanceOf(Uint32Array);
      expect(arr.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe("getUint16", () => {
    it("should return a Uint16Array", () => {
      const arr = pool.getUint16(32);
      expect(arr).toBeInstanceOf(Uint16Array);
      expect(arr.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe("getUint8", () => {
    it("should return a Uint8Array", () => {
      const arr = pool.getUint8(128);
      expect(arr).toBeInstanceOf(Uint8Array);
      expect(arr.length).toBeGreaterThanOrEqual(128);
    });
  });

  describe("releaseFloat32", () => {
    it("should add array to pool for reuse", () => {
      const arr = pool.getFloat32(64);
      pool.releaseFloat32(arr);

      const stats = pool.getStats();
      expect(stats.returned).toBe(1);
      expect(stats.pooledArrays).toBe(1);
    });

    it("should reuse released arrays", () => {
      const arr1 = pool.getFloat32(64);
      pool.releaseFloat32(arr1);

      pool.getFloat32(64);
      const stats = pool.getStats();
      expect(stats.poolHits).toBe(1);
    });

    it("should reject arrays when pool is full", () => {
      const arrays: Float32Array[] = [];
      for (let i = 0; i < 5; i++) {
        arrays.push(pool.getFloat32(64));
      }

      for (const arr of arrays) {
        pool.releaseFloat32(arr);
      }

      const stats = pool.getStats();
      expect(stats.returned).toBe(4); // maxPooledArrays = 4
      expect(stats.rejected).toBe(1);
    });
  });

  describe("releaseUint32", () => {
    it("should pool Uint32Arrays", () => {
      const arr = pool.getUint32(64);
      pool.releaseUint32(arr);

      const stats = pool.getStats();
      expect(stats.pooledArrays).toBe(1);
    });
  });

  describe("releaseUint16", () => {
    it("should pool Uint16Arrays", () => {
      const arr = pool.getUint16(64);
      pool.releaseUint16(arr);

      const stats = pool.getStats();
      expect(stats.pooledArrays).toBe(1);
    });
  });

  describe("releaseUint8", () => {
    it("should pool Uint8Arrays", () => {
      const arr = pool.getUint8(64);
      pool.releaseUint8(arr);

      const stats = pool.getStats();
      expect(stats.pooledArrays).toBe(1);
    });
  });

  describe("getStats", () => {
    it("should return all statistics", () => {
      pool.getFloat32(64);
      const arr = pool.getFloat32(64);
      pool.releaseFloat32(arr);
      pool.getFloat32(64);

      const stats = pool.getStats();
      expect(stats.poolHits).toBe(1);
      expect(stats.poolMisses).toBe(2);
      expect(stats.returned).toBe(1);
      expect(stats.pooledArrays).toBe(0); // Reused
      expect(stats.pooledMemory).toBe(0);
    });
  });

  describe("getHitRatio", () => {
    it("should return 0 for no accesses", () => {
      expect(pool.getHitRatio()).toBe(0);
    });

    it("should calculate correct hit ratio", () => {
      // 2 misses
      const arr1 = pool.getFloat32(64);
      pool.getFloat32(64);

      // Release one
      pool.releaseFloat32(arr1);

      // 1 hit
      pool.getFloat32(64);

      // Ratio: 1/(1+2) = 0.333...
      expect(pool.getHitRatio()).toBeCloseTo(1 / 3);
    });
  });

  describe("clear", () => {
    it("should remove all pooled arrays", () => {
      const arr = pool.getFloat32(64);
      pool.releaseFloat32(arr);

      pool.clear();

      const stats = pool.getStats();
      expect(stats.pooledArrays).toBe(0);
      expect(stats.pooledMemory).toBe(0);
    });

    it("should not reset hit/miss statistics", () => {
      pool.getFloat32(64);
      pool.clear();

      const stats = pool.getStats();
      expect(stats.poolMisses).toBe(1);
    });
  });

  describe("cleanup", () => {
    it("should remove arrays to reach target memory", () => {
      // Allocate all arrays first (so they don't get reused during the loop)
      const arrays: Float32Array[] = [];
      for (let i = 0; i < 3; i++) {
        arrays.push(pool.getFloat32(1024));
      }

      // Then release them all to the pool
      for (const arr of arrays) {
        pool.releaseFloat32(arr);
      }

      const statsBefore = pool.getStats();
      expect(statsBefore.pooledArrays).toBe(3);

      // Target low memory
      pool.cleanup(1024); // Target 1KB

      const statsAfter = pool.getStats();
      expect(statsAfter.pooledMemory).toBeLessThanOrEqual(1024);
    });

    it("should do nothing if already under target", () => {
      const arr = pool.getFloat32(64);
      pool.releaseFloat32(arr);

      const statsBefore = pool.getStats();
      pool.cleanup(100000); // Target 100KB

      const statsAfter = pool.getStats();
      expect(statsAfter.pooledArrays).toBe(statsBefore.pooledArrays);
    });
  });

  describe("resetStats", () => {
    it("should reset hit/miss statistics", () => {
      pool.getFloat32(64);
      pool.resetStats();

      const stats = pool.getStats();
      expect(stats.poolHits).toBe(0);
      expect(stats.poolMisses).toBe(0);
      expect(stats.returned).toBe(0);
      expect(stats.rejected).toBe(0);
    });
  });

  describe("memory limit", () => {
    it("should reject arrays when memory limit is reached", () => {
      const smallPool = new MemoryPool({
        maxPooledArrays: 100,
        sizeBuckets: [1024],
        maxPoolMemory: 4096, // Only 4KB
        autoCleanup: true,
      });

      // Each Float32Array of 1024 is 4096 bytes
      const arr1 = smallPool.getFloat32(1024);
      const arr2 = smallPool.getFloat32(1024);

      smallPool.releaseFloat32(arr1);
      smallPool.releaseFloat32(arr2);

      const stats = smallPool.getStats();
      expect(stats.returned).toBe(1);
      expect(stats.rejected).toBe(1);
    });
  });
});

describe("Global Pool", () => {
  beforeEach(() => {
    resetGlobalPool();
  });

  afterEach(() => {
    resetGlobalPool();
  });

  describe("getGlobalPool", () => {
    it("should return the same instance", () => {
      const pool1 = getGlobalPool();
      const pool2 = getGlobalPool();
      expect(pool1).toBe(pool2);
    });

    it("should create a pool instance", () => {
      const pool = getGlobalPool();
      expect(pool).toBeInstanceOf(MemoryPool);
    });
  });

  describe("resetGlobalPool", () => {
    it("should clear the global pool", () => {
      const pool = getGlobalPool();
      const arr = pool.getFloat32(64);
      pool.releaseFloat32(arr);

      resetGlobalPool();

      const newPool = getGlobalPool();
      const stats = newPool.getStats();
      expect(stats.pooledArrays).toBe(0);
    });

    it("should create a new instance after reset", () => {
      const pool1 = getGlobalPool();
      resetGlobalPool();
      const pool2 = getGlobalPool();

      expect(pool1).not.toBe(pool2);
    });
  });
});
