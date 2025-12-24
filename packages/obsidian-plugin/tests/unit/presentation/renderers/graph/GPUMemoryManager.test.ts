/**
 * Tests for GPUMemoryManager - GPU memory management for graph rendering
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  GPUMemoryManager,
  createGPUMemoryManager,
  getGlobalMemoryManager,
  resetGlobalMemoryManager,
  MemoryPressure,
  DEFAULT_GPU_MEMORY_MANAGER_CONFIG,
  type MemoryEvent,
  type MemoryEventListener,
  type ResourceType,
} from "../../../../../src/presentation/renderers/graph/GPUMemoryManager";

// Mock PixiJS Texture
class MockTexture {
  width: number;
  height: number;
  destroyed = false;

  constructor(width = 64, height = 64) {
    this.width = width;
    this.height = height;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

describe("GPUMemoryManager", () => {
  let manager: GPUMemoryManager;

  beforeEach(() => {
    manager = new GPUMemoryManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("initialization", () => {
    it("should create with default configuration", () => {
      expect(manager).toBeInstanceOf(GPUMemoryManager);
    });

    it("should accept custom budget", () => {
      const customManager = new GPUMemoryManager({
        budget: 64 * 1024 * 1024, // 64MB
      });

      const usage = customManager.getUsage();
      expect(usage.budget).toBe(64 * 1024 * 1024);
      customManager.destroy();
    });

    it("should start with no allocated memory", () => {
      const usage = manager.getUsage();
      expect(usage.totalAllocated).toBe(0);
      expect(usage.resourceCount).toBe(0);
    });

    it("should start with NORMAL pressure", () => {
      expect(manager.getPressure()).toBe(MemoryPressure.NORMAL);
    });
  });

  describe("resource registration", () => {
    it("should register a texture resource", () => {
      const texture = new MockTexture();
      const id = manager.register({
        id: "texture-1",
        type: "texture",
        size: 64 * 64 * 4,
        resource: texture,
      });

      expect(id).toBe("texture-1");
      expect(manager.has(id)).toBe(true);
    });

    it("should track allocated memory", () => {
      const texture = new MockTexture();
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 64 * 64 * 4,
        resource: texture,
      });

      const usage = manager.getUsage();
      expect(usage.totalAllocated).toBe(64 * 64 * 4);
      expect(usage.textureMemory).toBe(64 * 64 * 4);
    });

    it("should handle multiple resource types", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.register({
        id: "buffer-1",
        type: "buffer",
        size: 2048,
        resource: {},
      });

      manager.register({
        id: "geometry-1",
        type: "geometry",
        size: 512,
        resource: {},
      });

      const usage = manager.getUsage();
      expect(usage.textureMemory).toBe(1024);
      expect(usage.bufferMemory).toBe(2048);
      expect(usage.geometryMemory).toBe(512);
      expect(usage.resourceCount).toBe(3);
    });
  });

  describe("resource access", () => {
    it("should update lastAccessedAt on access", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      const before = manager.get("texture-1")?.lastAccessedAt;

      // Wait a bit to ensure time difference
      const waitStart = Date.now();
      while (Date.now() - waitStart < 10) {
        // busy wait
      }

      manager.access("texture-1");

      const after = manager.get("texture-1")?.lastAccessedAt;
      expect(after).toBeGreaterThanOrEqual(before!);
    });

    it("should return false for non-existent resource", () => {
      expect(manager.access("non-existent")).toBe(false);
    });
  });

  describe("reference counting", () => {
    it("should increment ref count", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      const newCount = manager.addRef("texture-1");
      expect(newCount).toBe(2);
    });

    it("should decrement ref count", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.addRef("texture-1"); // refCount = 2
      const newCount = manager.removeRef("texture-1"); // refCount = 1
      expect(newCount).toBe(1);
    });

    it("should not decrement below 0", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.removeRef("texture-1"); // refCount = 0
      manager.removeRef("texture-1"); // Still 0

      const resource = manager.get("texture-1");
      expect(resource?.refCount).toBe(0);
    });

    it("should return -1 for non-existent resource", () => {
      expect(manager.addRef("non-existent")).toBe(-1);
      expect(manager.removeRef("non-existent")).toBe(-1);
    });
  });

  describe("resource release", () => {
    it("should release a resource", () => {
      let cleanupCalled = false;
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        cleanup: () => { cleanupCalled = true; },
      });

      manager.removeRef("texture-1"); // Reduce refCount to 0
      const released = manager.release("texture-1");

      expect(released).toBe(true);
      expect(cleanupCalled).toBe(true);
      expect(manager.has("texture-1")).toBe(false);
    });

    it("should not release if refCount > 1", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.addRef("texture-1"); // refCount = 2
      const released = manager.release("texture-1"); // Only decrements

      expect(released).toBe(false);
      expect(manager.has("texture-1")).toBe(true);
    });

    it("should force release regardless of refCount", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.addRef("texture-1"); // refCount = 2
      const released = manager.release("texture-1", true); // Force release

      expect(released).toBe(true);
      expect(manager.has("texture-1")).toBe(false);
    });

    it("should update memory tracking on release", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.removeRef("texture-1");
      manager.release("texture-1");

      const usage = manager.getUsage();
      expect(usage.totalAllocated).toBe(0);
    });
  });

  describe("pinning", () => {
    it("should pin a resource", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      expect(manager.pin("texture-1")).toBe(true);
      expect(manager.get("texture-1")?.pinned).toBe(true);
    });

    it("should unpin a resource", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        pinned: true,
      });

      expect(manager.unpin("texture-1")).toBe(true);
      expect(manager.get("texture-1")?.pinned).toBe(false);
    });

    it("should prevent eviction of pinned resources", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        pinned: true,
      });

      manager.removeRef("texture-1");
      const evicted = manager.evictLRU(10);

      expect(evicted).toBe(0);
      expect(manager.has("texture-1")).toBe(true);
    });
  });

  describe("memory pressure", () => {
    it("should detect LOW pressure", () => {
      const smallBudget = new GPUMemoryManager({
        budget: 10000,
        lowPressureThreshold: 0.6,
      });

      smallBudget.register({
        id: "texture-1",
        type: "texture",
        size: 7000, // 70% of budget
        resource: new MockTexture(),
      });

      expect(smallBudget.getPressure()).toBe(MemoryPressure.LOW);
      smallBudget.destroy();
    });

    it("should detect HIGH pressure", () => {
      const smallBudget = new GPUMemoryManager({
        budget: 10000,
        highPressureThreshold: 0.8,
      });

      smallBudget.register({
        id: "texture-1",
        type: "texture",
        size: 8500, // 85% of budget
        resource: new MockTexture(),
      });

      expect(smallBudget.getPressure()).toBe(MemoryPressure.HIGH);
      smallBudget.destroy();
    });

    it("should detect CRITICAL pressure", () => {
      const smallBudget = new GPUMemoryManager({
        budget: 10000,
        criticalPressureThreshold: 0.95,
        autoEviction: false, // Disable auto-eviction for testing
      });

      smallBudget.register({
        id: "texture-1",
        type: "texture",
        size: 9600, // 96% of budget
        resource: new MockTexture(),
      });

      expect(smallBudget.getPressure()).toBe(MemoryPressure.CRITICAL);
      smallBudget.destroy();
    });
  });

  describe("LRU eviction", () => {
    beforeEach(() => {
      manager = new GPUMemoryManager({
        lruTimeThreshold: 0, // Allow immediate eviction
      });
    });

    it("should evict least recently used resources", () => {
      // Add resources
      manager.register({
        id: "old-texture",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      // Wait and add another
      manager.register({
        id: "new-texture",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      // Access the newer one
      manager.access("new-texture");

      // Release refs so they can be evicted
      manager.removeRef("old-texture");
      manager.removeRef("new-texture");

      // Evict 1 resource
      const evicted = manager.evictLRU(1);

      expect(evicted).toBe(1);
      expect(manager.has("old-texture")).toBe(false); // Older should be evicted
      expect(manager.has("new-texture")).toBe(true);
    });

    it("should respect priority during eviction", () => {
      manager.register({
        id: "low-priority",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        priority: 0,
      });

      manager.register({
        id: "high-priority",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        priority: 10,
      });

      manager.removeRef("low-priority");
      manager.removeRef("high-priority");

      const evicted = manager.evictLRU(1);

      expect(evicted).toBe(1);
      expect(manager.has("low-priority")).toBe(false); // Lower priority evicted first
      expect(manager.has("high-priority")).toBe(true);
    });
  });

  describe("garbage collection", () => {
    beforeEach(() => {
      manager = new GPUMemoryManager();
    });

    it("should collect unreferenced resources", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.register({
        id: "texture-2",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      // Remove ref from one
      manager.removeRef("texture-1");

      const collected = manager.collectGarbage();

      expect(collected).toBe(1);
      expect(manager.has("texture-1")).toBe(false);
      expect(manager.has("texture-2")).toBe(true);
    });
  });

  describe("event handling", () => {
    it("should emit resourceAllocated event", () => {
      const events: MemoryEvent[] = [];
      manager.addEventListener((event) => events.push(event));

      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("resourceAllocated");
      expect(events[0].resourceId).toBe("texture-1");
    });

    it("should emit resourceReleased event", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      const events: MemoryEvent[] = [];
      manager.addEventListener((event) => events.push(event));

      manager.removeRef("texture-1");
      manager.release("texture-1");

      expect(events.some((e) => e.type === "resourceReleased")).toBe(true);
    });

    it("should emit pressureChange event", () => {
      const smallManager = new GPUMemoryManager({
        budget: 10000,
        lowPressureThreshold: 0.6,
      });

      const events: MemoryEvent[] = [];
      smallManager.addEventListener((event) => events.push(event));

      smallManager.register({
        id: "texture-1",
        type: "texture",
        size: 7000,
        resource: new MockTexture(),
      });

      expect(events.some((e) => e.type === "pressureChange")).toBe(true);
      smallManager.destroy();
    });

    it("should support removeEventListener", () => {
      const events: MemoryEvent[] = [];
      const listener: MemoryEventListener = (event) => events.push(event);

      manager.addEventListener(listener);
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      expect(events.length).toBe(1);

      manager.removeEventListener(listener);
      manager.register({
        id: "texture-2",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      expect(events.length).toBe(1); // No new events
    });
  });

  describe("statistics", () => {
    it("should track allocations", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      const stats = manager.getStats();
      expect(stats.totalAllocations).toBe(1);
      expect(stats.totalBytesAllocated).toBe(1024);
    });

    it("should track deallocations", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.removeRef("texture-1");
      manager.release("texture-1");

      const stats = manager.getStats();
      expect(stats.totalDeallocations).toBe(1);
      expect(stats.totalBytesFreed).toBe(1024);
    });

    it("should track peak memory usage", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 5000,
        resource: new MockTexture(),
      });

      manager.register({
        id: "texture-2",
        type: "texture",
        size: 3000,
        resource: new MockTexture(),
      });

      const peakBefore = manager.getStats().peakMemoryUsage;

      manager.removeRef("texture-1");
      manager.release("texture-1");

      const peakAfter = manager.getStats().peakMemoryUsage;
      expect(peakAfter).toBe(peakBefore); // Peak should not decrease
      expect(peakAfter).toBe(8000);
    });
  });

  describe("resource queries", () => {
    beforeEach(() => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.register({
        id: "texture-2",
        type: "texture",
        size: 2048,
        resource: new MockTexture(),
      });

      manager.register({
        id: "buffer-1",
        type: "buffer",
        size: 512,
        resource: {},
      });
    });

    it("should get resources by type", () => {
      const textures = manager.getResourcesByType("texture");
      expect(textures.length).toBe(2);

      const buffers = manager.getResourcesByType("buffer");
      expect(buffers.length).toBe(1);
    });

    it("should get resource counts by type", () => {
      const counts = manager.getResourceCounts();
      expect(counts.get("texture")).toBe(2);
      expect(counts.get("buffer")).toBe(1);
    });
  });

  describe("budget management", () => {
    it("should allow changing budget", () => {
      manager.setBudget(64 * 1024 * 1024);

      const usage = manager.getUsage();
      expect(usage.budget).toBe(64 * 1024 * 1024);
    });

    it("should recalculate pressure after budget change", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 6000,
        resource: new MockTexture(),
      });

      manager.setBudget(10000);

      // Now at 60% which should trigger LOW pressure
      expect(manager.getPressure()).toBe(MemoryPressure.LOW);
    });
  });

  describe("clear", () => {
    it("should clear all non-pinned resources", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
      });

      manager.register({
        id: "texture-2",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        pinned: true,
      });

      manager.clear();

      expect(manager.has("texture-1")).toBe(false);
      expect(manager.has("texture-2")).toBe(true); // Pinned should remain
    });

    it("should force clear all resources", () => {
      manager.register({
        id: "texture-1",
        type: "texture",
        size: 1024,
        resource: new MockTexture(),
        pinned: true,
      });

      manager.clear(true);

      expect(manager.has("texture-1")).toBe(false);
    });
  });

  describe("static utility methods", () => {
    it("should estimate texture size", () => {
      const size = GPUMemoryManager.estimateTextureSize(256, 256);
      expect(size).toBe(256 * 256 * 4);
    });

    it("should estimate texture size with custom format", () => {
      const size = GPUMemoryManager.estimateTextureSize(256, 256, 3);
      expect(size).toBe(256 * 256 * 3);
    });

    it("should estimate buffer size", () => {
      const size = GPUMemoryManager.estimateBufferSize(1000, 32);
      expect(size).toBe(32000);
    });

    it("should format bytes", () => {
      expect(GPUMemoryManager.formatBytes(0)).toBe("0 B");
      expect(GPUMemoryManager.formatBytes(512)).toBe("512 B");
      expect(GPUMemoryManager.formatBytes(1024)).toBe("1 KB");
      expect(GPUMemoryManager.formatBytes(1048576)).toBe("1 MB");
      expect(GPUMemoryManager.formatBytes(1073741824)).toBe("1 GB");
    });
  });
});

describe("createGPUMemoryManager", () => {
  it("should create manager with factory function", () => {
    const manager = createGPUMemoryManager();
    expect(manager).toBeInstanceOf(GPUMemoryManager);
    manager.destroy();
  });

  it("should pass config to factory function", () => {
    const manager = createGPUMemoryManager({
      budget: 64 * 1024 * 1024,
    });

    const usage = manager.getUsage();
    expect(usage.budget).toBe(64 * 1024 * 1024);
    manager.destroy();
  });
});

describe("global memory manager", () => {
  afterEach(() => {
    resetGlobalMemoryManager();
  });

  it("should create global instance on first call", () => {
    const manager = getGlobalMemoryManager();
    expect(manager).toBeInstanceOf(GPUMemoryManager);
  });

  it("should return same instance on subsequent calls", () => {
    const manager1 = getGlobalMemoryManager();
    const manager2 = getGlobalMemoryManager();
    expect(manager1).toBe(manager2);
  });

  it("should reset global instance", () => {
    const manager1 = getGlobalMemoryManager();
    resetGlobalMemoryManager();
    const manager2 = getGlobalMemoryManager();
    expect(manager1).not.toBe(manager2);
  });
});

describe("DEFAULT_GPU_MEMORY_MANAGER_CONFIG", () => {
  it("should have reasonable defaults", () => {
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.budget).toBe(256 * 1024 * 1024);
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.lowPressureThreshold).toBe(0.6);
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.highPressureThreshold).toBe(0.8);
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.criticalPressureThreshold).toBe(0.95);
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.autoEviction).toBe(true);
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.evictionBatchSize).toBe(10);
    expect(DEFAULT_GPU_MEMORY_MANAGER_CONFIG.lruTimeThreshold).toBe(30000);
  });
});
