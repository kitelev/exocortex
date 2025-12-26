/**
 * Graph3DPerformanceManager Unit Tests
 *
 * Tests for LOD (Level of Detail), frustum culling, and WebGL context recovery.
 * These tests verify the performance optimization logic without requiring WebGL.
 */

import * as THREE from "three";
import {
  Graph3DPerformanceManager,
  createGraph3DPerformanceManager,
  DEFAULT_LOD_CONFIG,
  DEFAULT_FRUSTUM_CULLING_CONFIG,
  DEFAULT_WEBGL_RECOVERY_CONFIG,
  DEFAULT_PERFORMANCE_CONFIG,
  type PerformanceConfig,
  type LODConfig,
  type FrustumCullingConfig,
  type WebGLRecoveryConfig,
  type NodeVisibility,
  type PerformanceEvent,
  type PerformanceStats,
} from "@plugin/presentation/renderers/graph/3d/Graph3DPerformanceManager";

describe("Graph3DPerformanceManager", () => {
  describe("module exports", () => {
    it("exports Graph3DPerformanceManager class", () => {
      expect(Graph3DPerformanceManager).toBeDefined();
      expect(typeof Graph3DPerformanceManager).toBe("function");
    });

    it("exports createGraph3DPerformanceManager factory function", () => {
      expect(createGraph3DPerformanceManager).toBeDefined();
      expect(typeof createGraph3DPerformanceManager).toBe("function");
    });

    it("exports default configs", () => {
      expect(DEFAULT_LOD_CONFIG).toBeDefined();
      expect(DEFAULT_FRUSTUM_CULLING_CONFIG).toBeDefined();
      expect(DEFAULT_WEBGL_RECOVERY_CONFIG).toBeDefined();
      expect(DEFAULT_PERFORMANCE_CONFIG).toBeDefined();
    });
  });

  describe("default configurations", () => {
    it("has valid LOD config", () => {
      expect(DEFAULT_LOD_CONFIG.enabled).toBe(true);
      expect(DEFAULT_LOD_CONFIG.labelFadeStart).toBe(150);
      expect(DEFAULT_LOD_CONFIG.labelFadeEnd).toBe(250);
      expect(DEFAULT_LOD_CONFIG.labelMinOpacity).toBe(0);
      expect(DEFAULT_LOD_CONFIG.nodeDetailFadeStart).toBe(200);
      expect(DEFAULT_LOD_CONFIG.nodeDetailFadeEnd).toBe(400);
    });

    it("has valid frustum culling config", () => {
      expect(DEFAULT_FRUSTUM_CULLING_CONFIG.enabled).toBe(true);
      expect(DEFAULT_FRUSTUM_CULLING_CONFIG.padding).toBe(50);
      expect(DEFAULT_FRUSTUM_CULLING_CONFIG.updateInterval).toBe(2);
    });

    it("has valid WebGL recovery config", () => {
      expect(DEFAULT_WEBGL_RECOVERY_CONFIG.enabled).toBe(true);
      expect(DEFAULT_WEBGL_RECOVERY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_WEBGL_RECOVERY_CONFIG.retryDelay).toBe(1000);
      expect(DEFAULT_WEBGL_RECOVERY_CONFIG.showRecoveryMessage).toBe(true);
    });
  });

  describe("constructor", () => {
    it("creates instance with default options", () => {
      const manager = new Graph3DPerformanceManager();
      expect(manager).toBeDefined();
    });

    it("creates instance with custom LOD config", () => {
      const manager = new Graph3DPerformanceManager({
        lod: {
          enabled: false,
          labelFadeStart: 100,
          labelFadeEnd: 200,
          labelMinOpacity: 0.1,
          nodeDetailFadeStart: 150,
          nodeDetailFadeEnd: 300,
        },
      });
      expect(manager).toBeDefined();
      expect(manager.getConfig().lod.enabled).toBe(false);
      expect(manager.getConfig().lod.labelFadeStart).toBe(100);
    });

    it("creates instance with custom frustum culling config", () => {
      const manager = new Graph3DPerformanceManager({
        frustumCulling: {
          enabled: false,
          padding: 100,
          updateInterval: 5,
        },
      });
      expect(manager).toBeDefined();
      expect(manager.getConfig().frustumCulling.enabled).toBe(false);
    });

    it("creates instance with custom WebGL recovery config", () => {
      const manager = new Graph3DPerformanceManager({
        webglRecovery: {
          enabled: false,
          maxAttempts: 5,
          retryDelay: 2000,
          showRecoveryMessage: false,
        },
      });
      expect(manager).toBeDefined();
      expect(manager.getConfig().webglRecovery.maxAttempts).toBe(5);
    });

    it("creates instance via factory function", () => {
      const manager = createGraph3DPerformanceManager();
      expect(manager).toBeDefined();
    });
  });

  describe("LOD calculations", () => {
    let manager: Graph3DPerformanceManager;
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager({
        lod: {
          enabled: true,
          labelFadeStart: 100,
          labelFadeEnd: 200,
          labelMinOpacity: 0,
          nodeDetailFadeStart: 150,
          nodeDetailFadeEnd: 300,
        },
        frustumCulling: {
          enabled: false, // Disable frustum culling for LOD tests
          padding: 50,
          updateInterval: 1,
        },
      });
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      camera.position.set(0, 0, 100);
      camera.updateMatrixWorld();
    });

    it("returns full opacity for close nodes", () => {
      // Manually set camera for visibility calculation
      (manager as any).camera = camera;

      const position = new THREE.Vector3(0, 0, 50);
      const visibility = manager.calculateNodeVisibility("node1", position, 10);

      expect(visibility.labelOpacity).toBe(1);
      expect(visibility.labelVisible).toBe(true);
      expect(visibility.detailLevel).toBe(1);
    });

    it("returns reduced opacity for mid-distance nodes", () => {
      (manager as any).camera = camera;

      // Node at 150 distance from camera at (0,0,100)
      // Camera at (0,0,100), node at (0,0,-50) = 150 distance
      const position = new THREE.Vector3(0, 0, -50);
      const visibility = manager.calculateNodeVisibility("node2", position, 10);

      // Distance is 150, which is between 100 and 200
      expect(visibility.labelOpacity).toBeLessThan(1);
      expect(visibility.labelOpacity).toBeGreaterThan(0);
      expect(visibility.labelVisible).toBe(true);
    });

    it("returns zero opacity for far nodes", () => {
      (manager as any).camera = camera;

      // Node at 250 distance
      const position = new THREE.Vector3(0, 0, -150);
      const visibility = manager.calculateNodeVisibility("node3", position, 10);

      expect(visibility.labelOpacity).toBe(0);
      expect(visibility.labelVisible).toBe(false);
    });

    it("returns reduced detail level for distant nodes", () => {
      (manager as any).camera = camera;

      // Node at 250 distance (between 150 and 300)
      const position = new THREE.Vector3(0, 0, -150);
      const visibility = manager.calculateNodeVisibility("node4", position, 10);

      expect(visibility.detailLevel).toBeLessThan(1);
      expect(visibility.detailLevel).toBeGreaterThan(0.2);
    });

    it("caches visibility calculations", () => {
      (manager as any).camera = camera;

      const position = new THREE.Vector3(0, 0, 0);

      // First calculation
      const visibility1 = manager.calculateNodeVisibility("node5", position, 10);

      // Second calculation should return cached value
      const visibility2 = manager.calculateNodeVisibility("node5", position, 10);

      expect(visibility1).toBe(visibility2);
    });

    it("clears cache when requested", () => {
      (manager as any).camera = camera;

      const position = new THREE.Vector3(0, 0, 0);

      const visibility1 = manager.calculateNodeVisibility("node6", position, 10);
      manager.clearCache();
      const visibility2 = manager.calculateNodeVisibility("node6", position, 10);

      // Different objects after cache clear
      expect(visibility1).not.toBe(visibility2);
      // But same values
      expect(visibility1.labelOpacity).toBe(visibility2.labelOpacity);
    });
  });

  describe("frustum culling", () => {
    let manager: Graph3DPerformanceManager;
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager({
        lod: {
          enabled: false, // Disable LOD for frustum tests
          labelFadeStart: 100,
          labelFadeEnd: 200,
          labelMinOpacity: 0,
          nodeDetailFadeStart: 150,
          nodeDetailFadeEnd: 300,
        },
        frustumCulling: {
          enabled: true,
          padding: 10,
          updateInterval: 1,
        },
      });
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      // Manually inject camera and update frustum
      (manager as any).camera = camera;
      manager.updateFrustum();
    });

    it("returns inFrustum=true for visible nodes", () => {
      const position = new THREE.Vector3(0, 0, 0);
      const visibility = manager.calculateNodeVisibility("visible1", position, 10);

      expect(visibility.inFrustum).toBe(true);
    });

    it("returns inFrustum=false for off-screen nodes", () => {
      // Node far to the side, outside camera view
      const position = new THREE.Vector3(1000, 0, 0);
      const visibility = manager.calculateNodeVisibility("offscreen1", position, 10);

      expect(visibility.inFrustum).toBe(false);
    });

    it("considers padding when culling", () => {
      // Create manager with larger padding
      const managerWithPadding = new Graph3DPerformanceManager({
        frustumCulling: {
          enabled: true,
          padding: 1000, // Large padding
          updateInterval: 1,
        },
      });
      (managerWithPadding as any).camera = camera;
      managerWithPadding.updateFrustum();

      // Node that would normally be culled
      const position = new THREE.Vector3(500, 0, 0);
      const visibility = managerWithPadding.calculateNodeVisibility("padded1", position, 10);

      // With large padding, it should be in frustum
      expect(visibility.inFrustum).toBe(true);

      managerWithPadding.destroy();
    });

    it("updates frustum based on interval", () => {
      // Frame 1
      manager.updateFrustum();
      // Frame 2 - should update (interval is 1)
      manager.updateFrustum();

      // Create manager with interval of 3
      const managerWithInterval = new Graph3DPerformanceManager({
        frustumCulling: {
          enabled: true,
          padding: 10,
          updateInterval: 3,
        },
      });

      // Should update on frame 3, 6, 9, etc.
      managerWithInterval.updateFrustum(); // frame 1 - no update
      managerWithInterval.updateFrustum(); // frame 2 - no update
      managerWithInterval.updateFrustum(); // frame 3 - update

      managerWithInterval.destroy();
    });
  });

  describe("batch visibility calculation", () => {
    let manager: Graph3DPerformanceManager;
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager();
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      camera.position.set(0, 0, 100);
      camera.updateMatrixWorld();
      (manager as any).camera = camera;
    });

    it("calculates visibility for multiple nodes", () => {
      const nodes = [
        { id: "n1", x: 0, y: 0, z: 0 },
        { id: "n2", x: 10, y: 10, z: 10 },
        { id: "n3", x: -10, y: -10, z: -10 },
      ];

      const results = manager.calculateBatchVisibility(
        nodes,
        (node) => new THREE.Vector3(node.x, node.y, node.z)
      );

      expect(results.size).toBe(3);
      expect(results.has("n1")).toBe(true);
      expect(results.has("n2")).toBe(true);
      expect(results.has("n3")).toBe(true);
    });

    it("uses custom radius function", () => {
      const nodes = [
        { id: "n1", x: 0, y: 0, z: 0, size: 5 },
        { id: "n2", x: 10, y: 10, z: 10, size: 20 },
      ];

      const results = manager.calculateBatchVisibility(
        nodes,
        (node) => new THREE.Vector3(node.x, node.y, node.z),
        (node) => node.size
      );

      expect(results.size).toBe(2);
    });
  });

  describe("FPS tracking", () => {
    let manager: Graph3DPerformanceManager;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager();
    });

    it("returns default FPS initially", () => {
      expect(manager.getFPS()).toBe(60);
    });

    it("updates FPS counter", () => {
      // Call updateFPS multiple times
      for (let i = 0; i < 60; i++) {
        manager.updateFPS();
      }

      // FPS should be calculated (value depends on actual performance)
      const fps = manager.getFPS();
      expect(typeof fps).toBe("number");
    });
  });

  describe("performance stats", () => {
    let manager: Graph3DPerformanceManager;
    let camera: THREE.PerspectiveCamera;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager();
      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      camera.position.set(0, 0, 100);
      camera.updateMatrixWorld();
      (manager as any).camera = camera;
    });

    it("returns empty stats initially", () => {
      const stats = manager.getStats();

      expect(stats.totalNodes).toBe(0);
      expect(stats.visibleNodes).toBe(0);
      expect(stats.culledNodes).toBe(0);
      expect(stats.labelsVisible).toBe(0);
    });

    it("returns stats after visibility calculations", () => {
      // Calculate some visibilities
      manager.calculateNodeVisibility("n1", new THREE.Vector3(0, 0, 0), 10);
      manager.calculateNodeVisibility("n2", new THREE.Vector3(10, 0, 0), 10);
      manager.calculateNodeVisibility("n3", new THREE.Vector3(20, 0, 0), 10);

      const stats = manager.getStats();

      expect(stats.totalNodes).toBe(3);
      expect(stats.visibleNodes).toBeGreaterThanOrEqual(0);
    });

    it("calculates culling efficiency", () => {
      manager.calculateNodeVisibility("n1", new THREE.Vector3(0, 0, 0), 10);
      manager.calculateNodeVisibility("n2", new THREE.Vector3(1000, 0, 0), 10); // Off-screen

      const stats = manager.getStats();

      expect(stats.cullingEfficiency).toBeGreaterThanOrEqual(0);
      expect(stats.cullingEfficiency).toBeLessThanOrEqual(100);
    });
  });

  describe("configuration management", () => {
    let manager: Graph3DPerformanceManager;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager();
    });

    it("returns current config", () => {
      const config = manager.getConfig();

      expect(config.lod).toBeDefined();
      expect(config.frustumCulling).toBeDefined();
      expect(config.webglRecovery).toBeDefined();
    });

    it("updates LOD config", () => {
      manager.setConfig({
        lod: { labelFadeStart: 200 },
      } as any);

      expect(manager.getConfig().lod.labelFadeStart).toBe(200);
    });

    it("updates frustum culling config", () => {
      manager.setConfig({
        frustumCulling: { padding: 100 },
      } as any);

      expect(manager.getConfig().frustumCulling.padding).toBe(100);
    });

    it("clears cache when config changes", () => {
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      (manager as any).camera = camera;

      manager.calculateNodeVisibility("n1", new THREE.Vector3(0, 0, 0), 10);
      expect(manager.getStats().totalNodes).toBe(1);

      manager.setConfig({ lod: { labelFadeStart: 200 } } as any);

      // Cache should be cleared
      expect(manager.getStats().totalNodes).toBe(0);
    });

    it("enables/disables LOD", () => {
      manager.setLODEnabled(false);
      expect(manager.getConfig().lod.enabled).toBe(false);

      manager.setLODEnabled(true);
      expect(manager.getConfig().lod.enabled).toBe(true);
    });

    it("enables/disables frustum culling", () => {
      manager.setFrustumCullingEnabled(false);
      expect(manager.getConfig().frustumCulling.enabled).toBe(false);

      manager.setFrustumCullingEnabled(true);
      expect(manager.getConfig().frustumCulling.enabled).toBe(true);
    });
  });

  describe("event system", () => {
    let manager: Graph3DPerformanceManager;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager();
    });

    it("adds and removes event listeners", () => {
      const listener = jest.fn();

      manager.on("webglContextLost", listener);
      manager.off("webglContextLost", listener);

      // Should not throw
      expect(true).toBe(true);
    });

    it("supports all event types", () => {
      const listener = jest.fn();

      const eventTypes: Array<
        | "webglContextLost"
        | "webglContextRestored"
        | "recoveryStarted"
        | "recoveryComplete"
        | "recoveryFailed"
        | "performanceUpdate"
      > = [
        "webglContextLost",
        "webglContextRestored",
        "recoveryStarted",
        "recoveryComplete",
        "recoveryFailed",
        "performanceUpdate",
      ];

      for (const eventType of eventTypes) {
        expect(() => manager.on(eventType, listener)).not.toThrow();
        expect(() => manager.off(eventType, listener)).not.toThrow();
      }
    });
  });

  describe("recovery state", () => {
    let manager: Graph3DPerformanceManager;

    beforeEach(() => {
      manager = new Graph3DPerformanceManager();
    });

    it("returns false for isInRecovery initially", () => {
      expect(manager.isInRecovery()).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("destroys without errors", () => {
      const manager = new Graph3DPerformanceManager();
      expect(() => manager.destroy()).not.toThrow();
    });

    it("is safe to destroy multiple times", () => {
      const manager = new Graph3DPerformanceManager();
      manager.destroy();
      expect(() => manager.destroy()).not.toThrow();
    });

    it("clears all state on destroy", () => {
      const manager = new Graph3DPerformanceManager();
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
      (manager as any).camera = camera;

      manager.calculateNodeVisibility("n1", new THREE.Vector3(0, 0, 0), 10);
      manager.destroy();

      expect(manager.getStats().totalNodes).toBe(0);
    });
  });

  describe("Scene3DManager integration (without initialization)", () => {
    it("accepts performance config in constructor", async () => {
      // Dynamic import to avoid circular dependency issues
      const { Scene3DManager } = await import(
        "@plugin/presentation/renderers/graph/3d/Scene3DManager"
      );

      const manager = new Scene3DManager(
        {},
        {},
        {},
        {},
        {},
        {
          lod: { enabled: true, labelFadeStart: 100 },
          frustumCulling: { enabled: true, padding: 50 },
        }
      );

      expect(manager).toBeDefined();
      expect(manager.isInitialized()).toBe(false);
      expect(manager.getLODEnabled()).toBe(true);
      expect(manager.getFrustumCullingEnabled()).toBe(true);

      manager.destroy();
    });

    it("can toggle LOD and frustum culling", async () => {
      const { Scene3DManager } = await import(
        "@plugin/presentation/renderers/graph/3d/Scene3DManager"
      );

      const manager = new Scene3DManager();

      manager.setLODEnabled(false);
      expect(manager.getLODEnabled()).toBe(false);

      manager.setFrustumCullingEnabled(false);
      expect(manager.getFrustumCullingEnabled()).toBe(false);

      manager.destroy();
    });

    it("returns null for performance stats before initialization", async () => {
      const { Scene3DManager } = await import(
        "@plugin/presentation/renderers/graph/3d/Scene3DManager"
      );

      const manager = new Scene3DManager();

      expect(manager.getPerformanceStats()).toBeNull();
      expect(manager.getPerformanceManager()).toBeNull();

      manager.destroy();
    });
  });
});

describe("LOD opacity calculation edge cases", () => {
  let manager: Graph3DPerformanceManager;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    manager = new Graph3DPerformanceManager({
      lod: {
        enabled: true,
        labelFadeStart: 100,
        labelFadeEnd: 200,
        labelMinOpacity: 0,
        nodeDetailFadeStart: 100,
        nodeDetailFadeEnd: 200,
      },
      frustumCulling: { enabled: false, padding: 50, updateInterval: 1 },
    });
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    (manager as any).camera = camera;
  });

  afterEach(() => {
    manager.destroy();
  });

  it("returns exactly 1 at labelFadeStart distance", () => {
    const position = new THREE.Vector3(0, 0, 100);
    const visibility = manager.calculateNodeVisibility("exact100", position, 5);

    expect(visibility.labelOpacity).toBe(1);
  });

  it("returns exactly minOpacity at labelFadeEnd distance", () => {
    const position = new THREE.Vector3(0, 0, 200);
    const visibility = manager.calculateNodeVisibility("exact200", position, 5);

    expect(visibility.labelOpacity).toBe(0);
  });

  it("handles zero distance", () => {
    const position = new THREE.Vector3(0, 0, 0);
    const visibility = manager.calculateNodeVisibility("origin", position, 5);

    expect(visibility.labelOpacity).toBe(1);
    expect(visibility.distanceToCamera).toBe(0);
  });

  it("uses smooth interpolation (not linear)", () => {
    // Test at midpoint (150)
    const position = new THREE.Vector3(0, 0, 150);
    const visibility = manager.calculateNodeVisibility("midpoint", position, 5);

    // With quadratic ease-out, at t=0.5, eased = 1 - 0.25 = 0.75
    // So opacity should be around 0.75, not 0.5
    expect(visibility.labelOpacity).toBeGreaterThan(0.5);
    expect(visibility.labelOpacity).toBeLessThan(1);
  });
});

describe("WebGL recovery simulation", () => {
  let manager: Graph3DPerformanceManager | null = null;

  beforeEach(() => {
    manager = new Graph3DPerformanceManager({
      webglRecovery: {
        enabled: true,
        maxAttempts: 3,
        retryDelay: 100,
        showRecoveryMessage: false, // Disable UI for tests
      },
    });
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
      manager = null;
    }
  });

  it("emits events on context loss simulation", () => {
    const contextLostListener = jest.fn();
    const recoveryStartedListener = jest.fn();

    manager!.on("webglContextLost", contextLostListener);
    manager!.on("recoveryStarted", recoveryStartedListener);

    // Manually trigger context lost handling
    (manager as any).handleContextLost();

    expect(contextLostListener).toHaveBeenCalledTimes(1);
    expect(recoveryStartedListener).toHaveBeenCalledTimes(1);
    expect(manager!.isInRecovery()).toBe(true);
  });

  it("emits events on context restore simulation", () => {
    const contextRestoredListener = jest.fn();
    const recoveryCompleteListener = jest.fn();

    manager!.on("webglContextRestored", contextRestoredListener);
    manager!.on("recoveryComplete", recoveryCompleteListener);

    // Simulate context loss first
    (manager as any).handleContextLost();

    // Then restore
    (manager as any).handleContextRestored();

    expect(contextRestoredListener).toHaveBeenCalledTimes(1);
    expect(recoveryCompleteListener).toHaveBeenCalledTimes(1);
    expect(manager!.isInRecovery()).toBe(false);
  });

  it("emits failure event after max attempts", () => {
    const recoveryFailedListener = jest.fn();
    manager!.on("recoveryFailed", recoveryFailedListener);

    // Simulate context loss
    (manager as any).handleContextLost();

    // Restore 4 times (exceeding maxAttempts of 3)
    (manager as any).handleContextRestored(); // attempt 1
    (manager as any).handleContextRestored(); // attempt 2
    (manager as any).handleContextRestored(); // attempt 3
    (manager as any).handleContextRestored(); // attempt 4 - exceeds max

    expect(recoveryFailedListener).toHaveBeenCalledTimes(1);
  });

  it("calls recovery complete callback", () => {
    const recoveryCallback = jest.fn();

    // Create new manager with callback
    const managerWithCallback = new Graph3DPerformanceManager();
    (managerWithCallback as any).onRecoveryComplete = recoveryCallback;

    (managerWithCallback as any).handleContextLost();
    (managerWithCallback as any).handleContextRestored();

    expect(recoveryCallback).toHaveBeenCalledTimes(1);

    managerWithCallback.destroy();
  });
});
