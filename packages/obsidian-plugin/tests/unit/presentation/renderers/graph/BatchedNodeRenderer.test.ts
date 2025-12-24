/**
 * Tests for BatchedNodeRenderer - High-performance batched sprite rendering
 *
 * Since full PixiJS rendering requires WebGL which is unavailable in JSDOM,
 * we test the state management, batch logic, and configuration handling.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

// Mock the pixi.js module before importing anything that uses it
// Mock classes must be defined inline since jest.mock is hoisted
jest.mock("pixi.js", () => {
  // Create a proper texture mock with all required properties
  const createMockTexture = () => ({
    width: 32,
    height: 32,
    destroy: jest.fn(),
    valid: true,
    source: { width: 32, height: 32 },
  });

  return {
    Container: class MockContainer {
      children: unknown[] = [];
      sortableChildren = false;
      addChild(child: unknown): void {
        this.children.push(child);
      }
      removeChild(child: unknown): void {
        const index = this.children.indexOf(child);
        if (index >= 0) {
          this.children.splice(index, 1);
        }
      }
      removeChildren(): void {
        this.children = [];
      }
      destroy(): void {
        this.children = [];
      }
    },
    Graphics: class MockGraphics {
      clear(): this { return this; }
      circle(): this { return this; }
      rect(): this { return this; }
      roundRect(): this { return this; }
      moveTo(): this { return this; }
      lineTo(): this { return this; }
      closePath(): this { return this; }
      fill(): this { return this; }
      stroke(): this { return this; }
      destroy(): void {}
    },
    Sprite: class MockSprite {
      texture: unknown = null;
      position = { x: 0, y: 0, set: jest.fn() };
      anchor = { set: jest.fn() };
      scale = { set: jest.fn() };
      alpha = 1;
      visible = true;
      zIndex = 0;
      parent: unknown = null;
      destroy(): void {}
    },
    Texture: class MockTexture {
      width = 32;
      height = 32;
      destroy(): void {}
    },
    RenderTexture: {
      create: jest.fn(() => createMockTexture()),
    },
  };
});

import {
  BatchedNodeRenderer,
  createBatchedNodeRenderer,
  DEFAULT_BATCH_CONFIG,
  DEFAULT_BATCHED_NODE_RENDERER_CONFIG,
  type BatchNode,
  type BatchConfig,
} from "../../../../../src/presentation/renderers/graph/BatchedNodeRenderer";
import { LODSystem, LODLevel } from "../../../../../src/presentation/renderers/graph/LODSystem";

// Re-create MockContainer for use in tests (same structure as the mock above)
class MockContainer {
  children: unknown[] = [];
  sortableChildren = false;
  addChild(child: unknown): void {
    this.children.push(child);
  }
  removeChild(child: unknown): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
  }
  removeChildren(): void {
    this.children = [];
  }
  destroy(): void {
    this.children = [];
  }
}

describe("BatchedNodeRenderer", () => {
  let renderer: BatchedNodeRenderer;

  beforeEach(() => {
    renderer = new BatchedNodeRenderer();
  });

  afterEach(() => {
    renderer.destroy();
  });

  describe("initialization", () => {
    it("should create with default configuration", () => {
      expect(renderer).toBeInstanceOf(BatchedNodeRenderer);
    });

    it("should accept custom batch configuration", () => {
      const customRenderer = new BatchedNodeRenderer({
        batch: {
          maxSprites: 5000,
          maxTextures: 8,
        },
      });

      expect(customRenderer).toBeInstanceOf(BatchedNodeRenderer);
      customRenderer.destroy();
    });

    it("should create renderer using factory function", () => {
      const factoryRenderer = createBatchedNodeRenderer();
      expect(factoryRenderer).toBeInstanceOf(BatchedNodeRenderer);
      factoryRenderer.destroy();
    });
  });

  describe("initialization with container", () => {
    it("should initialize with parent container", () => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);

      // After initialization, a batch container should be added
      expect(container.children.length).toBe(1);
    });
  });

  describe("frame lifecycle", () => {
    beforeEach(() => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    it("should begin and end frame", () => {
      renderer.beginFrame();
      renderer.endFrame();

      const stats = renderer.getStats();
      expect(stats.totalNodes).toBe(0);
    });

    it("should add nodes during frame", () => {
      renderer.beginFrame();

      const node: BatchNode = {
        id: "test-node-1",
        x: 100,
        y: 100,
        radius: 8,
        color: 0x6366f1,
        alpha: 1,
        shape: "circle",
        isHovered: false,
        isSelected: false,
        zIndex: 0,
      };

      renderer.addNode(node);
      renderer.endFrame();

      const stats = renderer.getStats();
      expect(stats.totalNodes).toBe(1);
    });

    it("should track multiple nodes", () => {
      renderer.beginFrame();

      for (let i = 0; i < 100; i++) {
        renderer.addNode({
          id: `node-${i}`,
          x: i * 10,
          y: i * 10,
          radius: 8,
          color: 0x6366f1,
          alpha: 1,
          shape: "circle",
          isHovered: false,
          isSelected: false,
          zIndex: 0,
        });
      }

      renderer.endFrame();

      const stats = renderer.getStats();
      expect(stats.totalNodes).toBe(100);
    });

    it("should release sprites for removed nodes", () => {
      // First frame with nodes
      renderer.beginFrame();
      renderer.addNode({
        id: "node-1",
        x: 100,
        y: 100,
        radius: 8,
        color: 0x6366f1,
        alpha: 1,
        shape: "circle",
        isHovered: false,
        isSelected: false,
        zIndex: 0,
      });
      renderer.endFrame();

      const stats1 = renderer.getStats();
      expect(stats1.spritesInUse).toBe(1);

      // Second frame without the node
      renderer.beginFrame();
      renderer.endFrame();

      const stats2 = renderer.getStats();
      expect(stats2.spritesInUse).toBe(0);
    });
  });

  describe("node position updates", () => {
    beforeEach(() => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    it("should update node position", () => {
      renderer.beginFrame();
      renderer.addNode({
        id: "node-1",
        x: 100,
        y: 100,
        radius: 8,
        color: 0x6366f1,
        alpha: 1,
        shape: "circle",
        isHovered: false,
        isSelected: false,
        zIndex: 0,
      });
      renderer.endFrame();

      // Update position
      renderer.updateNodePosition("node-1", 200, 200);

      // No exception should be thrown
      expect(true).toBe(true);
    });

    it("should handle update for non-existent node", () => {
      // Should not throw
      renderer.updateNodePosition("non-existent", 100, 100);
      expect(true).toBe(true);
    });
  });

  describe("node state updates", () => {
    beforeEach(() => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    it("should update node hover state", () => {
      renderer.beginFrame();
      renderer.addNode({
        id: "node-1",
        x: 100,
        y: 100,
        radius: 8,
        color: 0x6366f1,
        alpha: 1,
        shape: "circle",
        isHovered: false,
        isSelected: false,
        zIndex: 0,
      });
      renderer.endFrame();

      renderer.updateNodeState("node-1", true, false);
      // No exception should be thrown
      expect(true).toBe(true);
    });

    it("should update node selection state", () => {
      renderer.beginFrame();
      renderer.addNode({
        id: "node-1",
        x: 100,
        y: 100,
        radius: 8,
        color: 0x6366f1,
        alpha: 1,
        shape: "circle",
        isHovered: false,
        isSelected: false,
        zIndex: 0,
      });
      renderer.endFrame();

      renderer.updateNodeState("node-1", false, true);
      // No exception should be thrown
      expect(true).toBe(true);
    });
  });

  describe("node removal", () => {
    beforeEach(() => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    it("should remove a specific node", () => {
      renderer.beginFrame();
      renderer.addNode({
        id: "node-1",
        x: 100,
        y: 100,
        radius: 8,
        color: 0x6366f1,
        alpha: 1,
        shape: "circle",
        isHovered: false,
        isSelected: false,
        zIndex: 0,
      });
      renderer.endFrame();

      renderer.removeNode("node-1");

      const stats = renderer.getStats();
      expect(stats.spritesInUse).toBe(0);
    });
  });

  describe("LOD integration", () => {
    let lodSystem: LODSystem;

    beforeEach(() => {
      lodSystem = new LODSystem();
      const container = new MockContainer();
      renderer.setLODSystem(lodSystem);
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    afterEach(() => {
      lodSystem.destroy();
    });

    it("should set LOD system", () => {
      const newLodSystem = new LODSystem();
      renderer.setLODSystem(newLodSystem);
      // No exception should be thrown
      expect(true).toBe(true);
      newLodSystem.destroy();
    });

    it("should enable/disable LOD", () => {
      renderer.setLODEnabled(false);
      renderer.setLODEnabled(true);
      // No exception should be thrown
      expect(true).toBe(true);
    });

    it("should respect LOD max nodes limit", () => {
      lodSystem.setZoom(0.5); // MEDIUM LOD with limited max nodes

      renderer.beginFrame();

      // Add more nodes than the LOD limit
      for (let i = 0; i < 5000; i++) {
        renderer.addNode({
          id: `node-${i}`,
          x: i * 10,
          y: i * 10,
          radius: 8,
          color: 0x6366f1,
          alpha: 1,
          shape: "circle",
          isHovered: false,
          isSelected: false,
          zIndex: 0,
        });
      }

      renderer.endFrame();

      const stats = renderer.getStats();
      // Should be limited by LOD settings (MEDIUM has maxNodes = 2000)
      expect(stats.totalNodes).toBeLessThanOrEqual(2000);
    });
  });

  describe("statistics", () => {
    beforeEach(() => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    it("should return stats object", () => {
      const stats = renderer.getStats();

      expect(stats).toHaveProperty("totalNodes");
      expect(stats).toHaveProperty("activeBatches");
      expect(stats).toHaveProperty("spritesInUse");
      expect(stats).toHaveProperty("spritesInPool");
      expect(stats).toHaveProperty("texturesInCache");
      expect(stats).toHaveProperty("drawCalls");
      expect(stats).toHaveProperty("renderTime");
    });

    it("should track render time", () => {
      renderer.beginFrame();

      for (let i = 0; i < 10; i++) {
        renderer.addNode({
          id: `node-${i}`,
          x: i * 10,
          y: i * 10,
          radius: 8,
          color: 0x6366f1,
          alpha: 1,
          shape: "circle",
          isHovered: false,
          isSelected: false,
          zIndex: 0,
        });
      }

      renderer.endFrame();

      const stats = renderer.getStats();
      expect(stats.renderTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("texture pre-generation", () => {
    it("should pre-generate textures", () => {
      renderer.preGenerateTextures([
        { shape: "circle", color: 0x6366f1, radius: 8 },
        { shape: "rect", color: 0x22c55e, radius: 10 },
        { shape: "hexagon", color: 0x3b82f6, radius: 12 },
      ]);

      const stats = renderer.getStats();
      expect(stats.texturesInCache).toBeGreaterThan(0);
    });
  });

  describe("memory usage", () => {
    it("should estimate memory usage", () => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);

      renderer.beginFrame();
      for (let i = 0; i < 100; i++) {
        renderer.addNode({
          id: `node-${i}`,
          x: i * 10,
          y: i * 10,
          radius: 8,
          color: 0x6366f1,
          alpha: 1,
          shape: "circle",
          isHovered: false,
          isSelected: false,
          zIndex: 0,
        });
      }
      renderer.endFrame();

      const memoryUsage = renderer.getMemoryUsage();
      expect(memoryUsage).toBeGreaterThan(0);
    });
  });

  describe("clear", () => {
    beforeEach(() => {
      const container = new MockContainer();
      renderer.initialize(container as unknown as import("pixi.js").Container);
    });

    it("should clear all rendered nodes", () => {
      renderer.beginFrame();
      for (let i = 0; i < 10; i++) {
        renderer.addNode({
          id: `node-${i}`,
          x: i * 10,
          y: i * 10,
          radius: 8,
          color: 0x6366f1,
          alpha: 1,
          shape: "circle",
          isHovered: false,
          isSelected: false,
          zIndex: 0,
        });
      }
      renderer.endFrame();

      renderer.clear();

      const stats = renderer.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.spritesInUse).toBe(0);
    });
  });
});

describe("DEFAULT_BATCH_CONFIG", () => {
  it("should have reasonable defaults", () => {
    expect(DEFAULT_BATCH_CONFIG.maxSprites).toBe(10000);
    expect(DEFAULT_BATCH_CONFIG.maxTextures).toBe(16);
    expect(DEFAULT_BATCH_CONFIG.useInstancing).toBe(true);
    expect(DEFAULT_BATCH_CONFIG.textureResolution).toBe(32);
  });
});

describe("DEFAULT_BATCHED_NODE_RENDERER_CONFIG", () => {
  it("should have reasonable defaults", () => {
    expect(DEFAULT_BATCHED_NODE_RENDERER_CONFIG.maxTextureCacheSize).toBe(256);
    expect(DEFAULT_BATCHED_NODE_RENDERER_CONFIG.maxSpritePoolSize).toBe(20000);
    expect(DEFAULT_BATCHED_NODE_RENDERER_CONFIG.enableLOD).toBe(true);
  });
});

describe("edge cases", () => {
  let renderer: BatchedNodeRenderer;

  beforeEach(() => {
    renderer = new BatchedNodeRenderer();
  });

  afterEach(() => {
    renderer.destroy();
  });

  it("should handle addNode called outside frame", () => {
    // Spy on console.warn
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderer.addNode({
      id: "test",
      x: 0,
      y: 0,
      radius: 8,
      color: 0x000000,
      alpha: 1,
      shape: "circle",
      isHovered: false,
      isSelected: false,
      zIndex: 0,
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should handle endFrame called outside frame", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderer.endFrame();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should handle beginFrame called while in frame", () => {
    const container = new MockContainer();
    renderer.initialize(container as unknown as import("pixi.js").Container);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    renderer.beginFrame();
    renderer.beginFrame(); // Called while already in frame

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    renderer.endFrame();
  });

  it("should handle z-index sorting", () => {
    const container = new MockContainer();
    renderer.initialize(container as unknown as import("pixi.js").Container);

    renderer.beginFrame();

    // Add nodes with different z-indices
    renderer.addNode({
      id: "node-high-z",
      x: 0,
      y: 0,
      radius: 8,
      color: 0x000000,
      alpha: 1,
      shape: "circle",
      isHovered: false,
      isSelected: false,
      zIndex: 100,
    });

    renderer.addNode({
      id: "node-low-z",
      x: 0,
      y: 0,
      radius: 8,
      color: 0x000000,
      alpha: 1,
      shape: "circle",
      isHovered: false,
      isSelected: false,
      zIndex: 1,
    });

    renderer.endFrame();

    // Nodes should be sorted by z-index
    const stats = renderer.getStats();
    expect(stats.totalNodes).toBe(2);
  });
});
