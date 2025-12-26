/**
 * ObjectPool Tests
 *
 * Comprehensive tests for the generic object pooling system.
 */

import {
  ObjectPool,
  createObjectPool,
  PoolExhaustedException,
  DEFAULT_POOL_CONFIG,
  type Poolable,
  type PoolConfig,
} from "../../../../../../src/presentation/renderers/graph/memory/ObjectPool";

/**
 * Simple poolable test object
 */
class TestPoolable implements Poolable {
  value: number = 0;
  private _inUse: boolean = false;
  resetCount: number = 0;

  reset(): void {
    this.value = 0;
    this.resetCount++;
  }

  isInUse(): boolean {
    return this._inUse;
  }

  setInUse(inUse: boolean): void {
    this._inUse = inUse;
  }
}

describe("ObjectPool", () => {
  let pool: ObjectPool<TestPoolable>;

  beforeEach(() => {
    pool = new ObjectPool(() => new TestPoolable(), {
      initialSize: 4,
      maxSize: 10,
      warmupCount: 4,
    });
  });

  afterEach(() => {
    pool.destroy();
  });

  describe("constructor", () => {
    it("should create pool with default config", () => {
      const defaultPool = new ObjectPool(() => new TestPoolable());
      const config = defaultPool.getConfig();

      expect(config.initialSize).toBe(DEFAULT_POOL_CONFIG.initialSize);
      expect(config.maxSize).toBe(DEFAULT_POOL_CONFIG.maxSize);
      expect(config.growthFactor).toBe(DEFAULT_POOL_CONFIG.growthFactor);
      expect(config.shrinkThreshold).toBe(DEFAULT_POOL_CONFIG.shrinkThreshold);

      defaultPool.destroy();
    });

    it("should create pool with custom config", () => {
      const customConfig: Partial<PoolConfig> = {
        initialSize: 8,
        maxSize: 100,
        growthFactor: 1.5,
        shrinkThreshold: 0.5,
      };

      const customPool = new ObjectPool(() => new TestPoolable(), customConfig);
      const config = customPool.getConfig();

      expect(config.initialSize).toBe(8);
      expect(config.maxSize).toBe(100);
      expect(config.growthFactor).toBe(1.5);
      expect(config.shrinkThreshold).toBe(0.5);

      customPool.destroy();
    });

    it("should warmup pool with initial objects", () => {
      expect(pool.getAvailableCount()).toBe(4);
      expect(pool.getInUseCount()).toBe(0);
      expect(pool.getTotalSize()).toBe(4);
    });

    it("should use custom name", () => {
      const namedPool = new ObjectPool(() => new TestPoolable(), {}, "CustomPool");
      expect(namedPool.getName()).toBe("CustomPool");
      namedPool.destroy();
    });
  });

  describe("acquire", () => {
    it("should acquire object from pool", () => {
      const obj = pool.acquire();

      expect(obj).toBeInstanceOf(TestPoolable);
      expect(obj.isInUse()).toBe(true);
      expect(pool.getInUseCount()).toBe(1);
      expect(pool.getAvailableCount()).toBe(3);
    });

    it("should reuse objects from pool (pool hits)", () => {
      const obj1 = pool.acquire();
      obj1.value = 42;
      pool.release(obj1);

      const obj2 = pool.acquire();
      // Object should be reset
      expect(obj2.value).toBe(0);
      expect(obj2.resetCount).toBe(1);
    });

    it("should create new objects when pool is empty", () => {
      // Exhaust initial pool
      const objects: TestPoolable[] = [];
      for (let i = 0; i < 4; i++) {
        objects.push(pool.acquire());
      }

      expect(pool.getAvailableCount()).toBe(0);

      // Should create new object
      const newObj = pool.acquire();
      expect(newObj).toBeInstanceOf(TestPoolable);
      expect(pool.getTotalSize()).toBe(5);

      // Cleanup
      for (const obj of objects) {
        pool.release(obj);
      }
      pool.release(newObj);
    });

    it("should throw PoolExhaustedException when max size reached", () => {
      const smallPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 2,
        maxSize: 3,
        warmupCount: 2,
      });

      // Fill the pool
      const obj1 = smallPool.acquire();
      const obj2 = smallPool.acquire();
      const obj3 = smallPool.acquire();

      expect(() => smallPool.acquire()).toThrow(PoolExhaustedException);

      smallPool.destroy();
    });

    it("should update metrics on acquire", () => {
      pool.acquire();
      pool.acquire();

      const metrics = pool.getMetrics();
      expect(metrics.totalAcquisitions).toBe(2);
      expect(metrics.poolHits).toBe(2);
      expect(metrics.inUseCount).toBe(2);
    });

    it("should track peak usage", () => {
      const obj1 = pool.acquire();
      const obj2 = pool.acquire();
      const obj3 = pool.acquire();

      expect(pool.getMetrics().peakUsage).toBe(3);

      pool.release(obj1);
      pool.release(obj2);

      // Peak should remain at 3
      expect(pool.getMetrics().peakUsage).toBe(3);

      pool.release(obj3);
    });
  });

  describe("release", () => {
    it("should release object back to pool", () => {
      const obj = pool.acquire();
      const result = pool.release(obj);

      expect(result).toBe(true);
      expect(obj.isInUse()).toBe(false);
      expect(pool.getAvailableCount()).toBe(4);
      expect(pool.getInUseCount()).toBe(0);
    });

    it("should reset object on release", () => {
      const obj = pool.acquire();
      obj.value = 123;

      pool.release(obj);

      expect(obj.value).toBe(0);
      expect(obj.resetCount).toBe(1);
    });

    it("should return false for unknown objects", () => {
      const unknownObj = new TestPoolable();
      const result = pool.release(unknownObj);

      expect(result).toBe(false);
    });

    it("should update metrics on release", () => {
      const obj = pool.acquire();
      pool.release(obj);

      const metrics = pool.getMetrics();
      expect(metrics.inUseCount).toBe(0);
      expect(metrics.availableCount).toBe(4);
    });
  });

  describe("releaseAll", () => {
    it("should release multiple objects", () => {
      const objects = [pool.acquire(), pool.acquire(), pool.acquire()];

      const released = pool.releaseAll(objects);

      expect(released).toBe(3);
      expect(pool.getInUseCount()).toBe(0);
    });

    it("should handle partial release", () => {
      const obj = pool.acquire();
      const unknownObj = new TestPoolable();

      const released = pool.releaseAll([obj, unknownObj]);

      expect(released).toBe(1);
    });
  });

  describe("shrink", () => {
    it("should shrink pool based on usage", () => {
      // Create pool with high shrink threshold
      const shrinkPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 4,
        maxSize: 20,
        shrinkThreshold: 0.5,
        autoShrink: false,
        warmupCount: 4,
      });

      // First grow the pool by acquiring more than initial
      const objects: TestPoolable[] = [];
      for (let i = 0; i < 10; i++) {
        objects.push(shrinkPool.acquire());
      }
      // Release all
      for (const obj of objects) {
        shrinkPool.release(obj);
      }

      expect(shrinkPool.getAvailableCount()).toBe(10);

      const removed = shrinkPool.shrink();

      // Should shrink since no objects are in use and pool grew beyond initial
      expect(removed).toBeGreaterThan(0);
      expect(shrinkPool.getAvailableCount()).toBeLessThan(10);

      shrinkPool.destroy();
    });

    it("should not shrink below initial size", () => {
      const shrinkPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 4,
        maxSize: 10,
        shrinkThreshold: 0.5,
        autoShrink: false,
        warmupCount: 4,
      });

      // Grow the pool
      const objects: TestPoolable[] = [];
      for (let i = 0; i < 6; i++) {
        objects.push(shrinkPool.acquire());
      }
      for (const obj of objects) {
        shrinkPool.release(obj);
      }

      // Now shrink - should not go below initial size
      shrinkPool.shrink();
      expect(shrinkPool.getAvailableCount()).toBeGreaterThanOrEqual(4);

      shrinkPool.destroy();
    });
  });

  describe("grow", () => {
    it("should grow pool by factor", () => {
      const growPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 4,
        maxSize: 20,
        growthFactor: 2,
        warmupCount: 4,
      });

      const initialSize = growPool.getTotalSize();
      const added = growPool.grow();

      expect(added).toBe(initialSize); // Should double
      expect(growPool.getTotalSize()).toBe(initialSize * 2);

      growPool.destroy();
    });

    it("should respect max size when growing", () => {
      const limitedPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 8,
        maxSize: 10,
        growthFactor: 2,
        warmupCount: 8,
      });

      const added = limitedPool.grow();

      expect(added).toBe(2); // Can only add 2 to reach max
      expect(limitedPool.getTotalSize()).toBe(10);

      limitedPool.destroy();
    });
  });

  describe("preallocate", () => {
    it("should preallocate up to target size", () => {
      const created = pool.preallocate(8);

      expect(created).toBe(4); // 8 - 4 initial
      expect(pool.getTotalSize()).toBe(8);
    });

    it("should respect max size when preallocating", () => {
      const created = pool.preallocate(20);

      expect(created).toBe(6); // 10 max - 4 initial
      expect(pool.getTotalSize()).toBe(10);
    });

    it("should return 0 if already at target size", () => {
      const created = pool.preallocate(2);

      expect(created).toBe(0);
      expect(pool.getTotalSize()).toBe(4);
    });
  });

  describe("clear", () => {
    it("should clear all objects and reset metrics", () => {
      pool.acquire();
      pool.acquire();

      pool.clear();

      const metrics = pool.getMetrics();
      expect(metrics.totalAcquisitions).toBe(0);
      expect(metrics.poolHits).toBe(0);
      expect(metrics.inUseCount).toBe(0);
      expect(pool.getTotalSize()).toBe(4); // Re-warmed up
    });
  });

  describe("getMetrics", () => {
    it("should calculate hit rate correctly", () => {
      // All hits from initial pool
      const obj1 = pool.acquire();
      const obj2 = pool.acquire();

      let metrics = pool.getMetrics();
      expect(metrics.hitRate).toBe(100);

      pool.release(obj1);
      pool.release(obj2);

      // Exhaust pool then create new
      const objects: TestPoolable[] = [];
      for (let i = 0; i < 5; i++) {
        objects.push(pool.acquire());
      }

      metrics = pool.getMetrics();
      // 4 hits from initial + 1 miss for new object
      expect(metrics.poolHits).toBe(6); // 2 previous + 4 from pool
      expect(metrics.poolMisses).toBe(1);
      expect(metrics.hitRate).toBeCloseTo((6 / 7) * 100, 1);

      for (const obj of objects) {
        pool.release(obj);
      }
    });
  });

  describe("hasAvailable", () => {
    it("should return true when objects available", () => {
      expect(pool.hasAvailable()).toBe(true);
    });

    it("should return false when pool empty", () => {
      // Exhaust pool
      for (let i = 0; i < 4; i++) {
        pool.acquire();
      }

      expect(pool.hasAvailable()).toBe(false);
    });
  });

  describe("canGrow", () => {
    it("should return true when below max", () => {
      expect(pool.canGrow()).toBe(true);
    });

    it("should return false when at max", () => {
      // Fill to max
      for (let i = 0; i < 10; i++) {
        pool.acquire();
      }

      expect(pool.canGrow()).toBe(false);
    });
  });

  describe("events", () => {
    it("should emit acquire event", () => {
      const listener = jest.fn();
      pool.addEventListener(listener);

      pool.acquire();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "acquire" })
      );
    });

    it("should emit release event", () => {
      const listener = jest.fn();
      const obj = pool.acquire();

      pool.addEventListener(listener);
      pool.release(obj);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "release" })
      );
    });

    it("should emit grow event", () => {
      const listener = jest.fn();
      pool.addEventListener(listener);

      pool.grow();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "grow" })
      );
    });

    it("should emit shrink event", () => {
      const listener = jest.fn();

      // Create pool with small initial, then grow it
      const largePool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 5,
        maxSize: 40,
        autoShrink: false,
        warmupCount: 5,
      });

      // Grow the pool
      const objects: TestPoolable[] = [];
      for (let i = 0; i < 20; i++) {
        objects.push(largePool.acquire());
      }
      for (const obj of objects) {
        largePool.release(obj);
      }

      largePool.addEventListener(listener);
      largePool.shrink();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "shrink" })
      );

      largePool.destroy();
    });

    it("should emit exhausted event", () => {
      const listener = jest.fn();
      const smallPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 1,
        maxSize: 1,
        warmupCount: 1,
      });

      smallPool.addEventListener(listener);
      smallPool.acquire();

      try {
        smallPool.acquire();
      } catch {
        // Expected
      }

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "exhausted" })
      );

      smallPool.destroy();
    });

    it("should allow unsubscribing", () => {
      const listener = jest.fn();
      const unsubscribe = pool.addEventListener(listener);

      unsubscribe();
      pool.acquire();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("createObjectPool", () => {
    it("should create pool with factory function", () => {
      const factoryPool = createObjectPool(
        () => new TestPoolable(),
        { initialSize: 5, warmupCount: 5 },
        "FactoryPool"
      );

      expect(factoryPool).toBeInstanceOf(ObjectPool);
      expect(factoryPool.getName()).toBe("FactoryPool");
      expect(factoryPool.getAvailableCount()).toBe(5);

      factoryPool.destroy();
    });
  });
});
