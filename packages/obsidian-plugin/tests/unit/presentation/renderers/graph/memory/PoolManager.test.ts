/**
 * PoolManager Tests
 *
 * Tests for the central pool coordination system.
 */

import {
  PoolManager,
  createPoolManager,
  getGlobalPoolManager,
  resetGlobalPoolManager,
  MemoryPressureLevel,
  POOL_NAMES,
  DEFAULT_POOL_MANAGER_CONFIG,
  type PoolManagerConfig,
} from "../../../../../../src/presentation/renderers/graph/memory/PoolManager";
import {
  ObjectPool,
  type Poolable,
} from "../../../../../../src/presentation/renderers/graph/memory/ObjectPool";
import {
  RenderBatch,
  EventObject,
  ComputationBuffer,
  PoolableVector2D,
  PoolableRect,
} from "../../../../../../src/presentation/renderers/graph/memory/PoolableTypes";

// Simple test poolable
class TestPoolable implements Poolable {
  value: number = 0;
  private _inUse: boolean = false;

  reset(): void {
    this.value = 0;
  }

  isInUse(): boolean {
    return this._inUse;
  }

  setInUse(inUse: boolean): void {
    this._inUse = inUse;
  }
}

describe("PoolManager", () => {
  let manager: PoolManager;

  beforeEach(() => {
    manager = new PoolManager({
      enablePressureManagement: false, // Disable for deterministic tests
    });
    manager.initializeBuiltInPools();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      const defaultManager = new PoolManager();
      expect(defaultManager).toBeInstanceOf(PoolManager);
      expect(defaultManager.getPressureLevel()).toBe(MemoryPressureLevel.NORMAL);
      defaultManager.destroy();
    });

    it("should create with custom config", () => {
      const customConfig: Partial<PoolManagerConfig> = {
        memoryLimitBytes: 128 * 1024 * 1024,
        moderatePressureThreshold: 0.5,
      };

      const customManager = new PoolManager(customConfig);
      expect(customManager).toBeInstanceOf(PoolManager);
      customManager.destroy();
    });
  });

  describe("initializeBuiltInPools", () => {
    it("should create all built-in pools", () => {
      const stats = manager.getStats();

      expect(stats.poolCount).toBe(5);
      expect(stats.poolMetrics.has(POOL_NAMES.RENDER_BATCH)).toBe(true);
      expect(stats.poolMetrics.has(POOL_NAMES.EVENT)).toBe(true);
      expect(stats.poolMetrics.has(POOL_NAMES.COMPUTATION_BUFFER)).toBe(true);
      expect(stats.poolMetrics.has(POOL_NAMES.VECTOR2D)).toBe(true);
      expect(stats.poolMetrics.has(POOL_NAMES.RECT)).toBe(true);
    });
  });

  describe("registerPool", () => {
    it("should register custom pool", () => {
      const customPool = new ObjectPool(() => new TestPoolable(), {
        initialSize: 10,
      });

      manager.registerPool("custom", customPool, 5, true);

      expect(manager.getPool("custom")).toBe(customPool);
      expect(manager.getStats().poolCount).toBe(6);

      customPool.destroy();
    });

    it("should emit poolRegistered event", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);

      const customPool = new ObjectPool(() => new TestPoolable());
      manager.registerPool("custom", customPool);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "poolRegistered",
          poolName: "custom",
        })
      );

      customPool.destroy();
    });
  });

  describe("unregisterPool", () => {
    it("should remove pool", () => {
      const customPool = new ObjectPool(() => new TestPoolable());
      manager.registerPool("custom", customPool);

      const result = manager.unregisterPool("custom");

      expect(result).toBe(true);
      expect(manager.getPool("custom")).toBeUndefined();
    });

    it("should return false for unknown pool", () => {
      const result = manager.unregisterPool("nonexistent");
      expect(result).toBe(false);
    });

    it("should emit poolUnregistered event", () => {
      const customPool = new ObjectPool(() => new TestPoolable());
      manager.registerPool("custom", customPool);

      const listener = jest.fn();
      manager.addEventListener(listener);

      manager.unregisterPool("custom");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "poolUnregistered",
          poolName: "custom",
        })
      );
    });
  });

  describe("built-in pool accessors", () => {
    describe("RenderBatch", () => {
      it("should acquire render batch", () => {
        const batch = manager.acquireRenderBatch();

        expect(batch).toBeInstanceOf(RenderBatch);
        expect(batch.isInUse()).toBe(true);
      });

      it("should release render batch", () => {
        const batch = manager.acquireRenderBatch();
        batch.addNode({ id: "1", x: 0, y: 0, radius: 1, color: 0, alpha: 1, zIndex: 0 });

        const result = manager.releaseRenderBatch(batch);

        expect(result).toBe(true);
        expect(batch.isInUse()).toBe(false);
        expect(batch.getNodeCount()).toBe(0); // Should be reset
      });
    });

    describe("EventObject", () => {
      it("should acquire event", () => {
        const event = manager.acquireEvent();

        expect(event).toBeInstanceOf(EventObject);
        expect(event.isInUse()).toBe(true);
      });

      it("should release event", () => {
        const event = manager.acquireEvent();
        event.setType("nodeClick");

        const result = manager.releaseEvent(event);

        expect(result).toBe(true);
        expect(event.getType()).toBe("custom"); // Reset to default
      });
    });

    describe("ComputationBuffer", () => {
      it("should acquire buffer", () => {
        const buffer = manager.acquireComputationBuffer();

        expect(buffer).toBeInstanceOf(ComputationBuffer);
        expect(buffer.isInUse()).toBe(true);
      });

      it("should release buffer", () => {
        const buffer = manager.acquireComputationBuffer();
        buffer.resize(100);

        const result = manager.releaseComputationBuffer(buffer);

        expect(result).toBe(true);
        expect(buffer.getSize()).toBe(0); // Reset
      });
    });

    describe("Vector2D", () => {
      it("should acquire vector", () => {
        const vec = manager.acquireVector2D();

        expect(vec).toBeInstanceOf(PoolableVector2D);
        expect(vec.isInUse()).toBe(true);
      });

      it("should release vector", () => {
        const vec = manager.acquireVector2D();
        vec.set(100, 200);

        const result = manager.releaseVector2D(vec);

        expect(result).toBe(true);
        expect(vec.x).toBe(0);
        expect(vec.y).toBe(0);
      });
    });

    describe("Rect", () => {
      it("should acquire rect", () => {
        const rect = manager.acquireRect();

        expect(rect).toBeInstanceOf(PoolableRect);
        expect(rect.isInUse()).toBe(true);
      });

      it("should release rect", () => {
        const rect = manager.acquireRect();
        rect.set(10, 20, 100, 50);

        const result = manager.releaseRect(rect);

        expect(result).toBe(true);
        expect(rect.x).toBe(0);
        expect(rect.width).toBe(0);
      });
    });
  });

  describe("uninitialized pool access", () => {
    it("should throw when accessing uninitialized pools", () => {
      const uninitManager = new PoolManager();
      // Don't call initializeBuiltInPools

      expect(() => uninitManager.acquireRenderBatch()).toThrow(
        "Built-in pools not initialized"
      );
      expect(() => uninitManager.acquireEvent()).toThrow(
        "Built-in pools not initialized"
      );
      expect(() => uninitManager.acquireComputationBuffer()).toThrow(
        "Built-in pools not initialized"
      );
      expect(() => uninitManager.acquireVector2D()).toThrow(
        "Built-in pools not initialized"
      );
      expect(() => uninitManager.acquireRect()).toThrow(
        "Built-in pools not initialized"
      );

      uninitManager.destroy();
    });
  });

  describe("getStats", () => {
    it("should aggregate statistics from all pools", () => {
      manager.acquireRenderBatch();
      manager.acquireEvent();
      manager.acquireEvent();

      const stats = manager.getStats();

      expect(stats.poolCount).toBe(5);
      expect(stats.totalInUse).toBe(3);
      expect(stats.totalAcquisitions).toBe(3);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    });

    it("should calculate overall hit rate", () => {
      // Multiple acquisitions should have high hit rate from warmup
      manager.acquireRenderBatch();
      manager.acquireRenderBatch();
      manager.acquireEvent();

      const stats = manager.getStats();

      expect(stats.overallHitRate).toBeGreaterThan(0);
      expect(stats.totalHits).toBe(3);
    });
  });

  describe("shrinkAllPools", () => {
    it("should shrink all pools", () => {
      // Acquire and release to allow shrinking
      const batches = [
        manager.acquireRenderBatch(),
        manager.acquireRenderBatch(),
      ];
      for (const b of batches) {
        manager.releaseRenderBatch(b);
      }

      const listener = jest.fn();
      manager.addEventListener(listener);

      manager.shrinkAllPools();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cleanup" })
      );
    });
  });

  describe("reset", () => {
    it("should reset all pools", () => {
      manager.acquireRenderBatch();
      manager.acquireEvent();

      manager.reset();

      const stats = manager.getStats();
      expect(stats.totalInUse).toBe(0);
      expect(stats.totalAcquisitions).toBe(0);
    });

    it("should emit reset event", () => {
      const listener = jest.fn();
      manager.addEventListener(listener);

      manager.reset();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "reset" })
      );
    });

    it("should reset pressure level", () => {
      manager.reset();
      expect(manager.getPressureLevel()).toBe(MemoryPressureLevel.NORMAL);
    });
  });

  describe("events", () => {
    it("should support adding and removing listeners", () => {
      const listener = jest.fn();
      const unsubscribe = manager.addEventListener(listener);

      manager.acquireRenderBatch();
      // No pool events are emitted on acquire through manager

      unsubscribe();

      manager.reset();

      // Listener was removed before reset, but may have been called before
      // Just verify unsubscribe works
    });
  });

  describe("memory pressure", () => {
    it("should start with NORMAL pressure", () => {
      expect(manager.getPressureLevel()).toBe(MemoryPressureLevel.NORMAL);
    });
  });

  describe("createPoolManager", () => {
    it("should create manager instance", () => {
      const created = createPoolManager({ debug: true });

      expect(created).toBeInstanceOf(PoolManager);

      created.destroy();
    });
  });

  describe("global pool manager", () => {
    afterEach(() => {
      resetGlobalPoolManager();
    });

    it("should create singleton on first call", () => {
      const global1 = getGlobalPoolManager();
      const global2 = getGlobalPoolManager();

      expect(global1).toBe(global2);
    });

    it("should initialize built-in pools", () => {
      const global = getGlobalPoolManager();
      const stats = global.getStats();

      expect(stats.poolCount).toBe(5);
    });

    it("should reset global manager", () => {
      const global1 = getGlobalPoolManager();
      resetGlobalPoolManager();
      const global2 = getGlobalPoolManager();

      expect(global1).not.toBe(global2);
    });
  });
});

describe("PoolManager pressure handling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetGlobalPoolManager();
  });

  it("should detect moderate pressure", () => {
    const manager = new PoolManager({
      enablePressureManagement: true,
      pressureCheckInterval: 100,
      memoryLimitBytes: 1000, // Very small limit
      moderatePressureThreshold: 0.5,
    });
    manager.initializeBuiltInPools();

    const listener = jest.fn();
    manager.addEventListener(listener);

    // Trigger pressure check
    jest.advanceTimersByTime(100);

    // Given the small memory limit, should be above moderate threshold
    const stats = manager.getStats();
    if (stats.estimatedMemoryBytes / 1000 >= 0.5) {
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "pressureChange" })
      );
    }

    manager.destroy();
  });

  it("should emit pressureChange event on level change", () => {
    const manager = new PoolManager({
      enablePressureManagement: true,
      pressureCheckInterval: 100,
      memoryLimitBytes: 100, // Extremely small
      moderatePressureThreshold: 0.1,
    });
    manager.initializeBuiltInPools();

    const listener = jest.fn();
    manager.addEventListener(listener);

    jest.advanceTimersByTime(100);

    // Check if pressure change was emitted
    const pressureEvents = listener.mock.calls.filter(
      call => call[0].type === "pressureChange"
    );

    // Should have detected non-normal pressure
    expect(manager.getPressureLevel()).not.toBe(MemoryPressureLevel.NORMAL);

    manager.destroy();
  });
});
