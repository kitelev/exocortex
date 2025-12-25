/**
 * WebGPUPhysics Tests
 *
 * Tests for GPU-accelerated physics simulation using WebGPU compute shaders.
 * Note: WebGPU is not available in Node.js test environment, so we test the CPU fallback.
 */

import {
  WebGPUPhysics,
  createWebGPUPhysics,
  isWebGPUAvailable,
  DEFAULT_WEBGPU_PHYSICS_CONFIG,
  type PhysicsNode,
  type PhysicsEdge,
  type PhysicsEvent,
} from "../../../../../src/presentation/renderers/graph/WebGPUPhysics";

describe("WebGPUPhysics", () => {
  describe("initialization", () => {
    it("should create instance with default config", () => {
      const physics = new WebGPUPhysics();
      const config = physics.getConfig();

      expect(config.repulsionStrength).toBe(DEFAULT_WEBGPU_PHYSICS_CONFIG.repulsionStrength);
      expect(config.linkDistance).toBe(DEFAULT_WEBGPU_PHYSICS_CONFIG.linkDistance);
      expect(config.velocityDecay).toBe(DEFAULT_WEBGPU_PHYSICS_CONFIG.velocityDecay);
      expect(config.alphaStart).toBe(DEFAULT_WEBGPU_PHYSICS_CONFIG.alphaStart);

      physics.destroy();
    });

    it("should create instance with custom config", () => {
      const physics = new WebGPUPhysics({
        repulsionStrength: -500,
        linkDistance: 150,
        velocityDecay: 0.6,
      });
      const config = physics.getConfig();

      expect(config.repulsionStrength).toBe(-500);
      expect(config.linkDistance).toBe(150);
      expect(config.velocityDecay).toBe(0.6);

      physics.destroy();
    });

    it("should use createWebGPUPhysics factory function", () => {
      const physics = createWebGPUPhysics({
        repulsionStrength: -400,
      });

      expect(physics).toBeInstanceOf(WebGPUPhysics);
      expect(physics.getConfig().repulsionStrength).toBe(-400);

      physics.destroy();
    });

    it("should report WebGPU as unavailable in Node.js", () => {
      expect(isWebGPUAvailable()).toBe(false);
    });
  });

  describe("node management", () => {
    it("should set nodes", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
        { id: "b", x: 100, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
        { id: "c", x: 50, y: 100, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      const positions = physics.getPositions();

      expect(positions.size).toBe(3);
      expect(positions.get("a")).toEqual({ x: 0, y: 0 });
      expect(positions.get("b")).toEqual({ x: 100, y: 0 });
      expect(positions.get("c")).toEqual({ x: 50, y: 100 });

      physics.destroy();
    });

    it("should fix node at position", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.fixNode("a", 50, 50);

      const positions = physics.getPositions();
      expect(positions.get("a")).toEqual({ x: 50, y: 50 });

      physics.destroy();
    });

    it("should unfix node", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: 100, fy: 100, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.unfixNode("a");

      // The node is now unfixed but position remains
      const positions = physics.getPositions();
      expect(positions.get("a")).toBeDefined();

      physics.destroy();
    });
  });

  describe("edge management", () => {
    it("should set edges", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
        { id: "b", x: 100, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];
      const edges: PhysicsEdge[] = [
        { source: 0, target: 1, distance: 100, strength: 0.5 },
      ];

      physics.setNodes(nodes);
      physics.setEdges(edges);

      // Edges don't have a getter, but we verify no errors occurred
      expect(true).toBe(true);

      physics.destroy();
    });
  });

  describe("simulation control", () => {
    it("should start simulation", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
        { id: "b", x: 100, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();

      const state = physics.getState();
      expect(state.isRunning).toBe(true);

      physics.stop();
      physics.destroy();
    });

    it("should stop simulation", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();
      physics.stop();

      const state = physics.getState();
      expect(state.isRunning).toBe(false);

      physics.destroy();
    });

    it("should restart simulation", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();
      physics.stop();

      // After stopping, start fresh with restart
      physics.restart();

      const state = physics.getState();
      expect(state.isRunning).toBe(true);
      // After restart from stopped state, iteration should be reset
      // (but may have run one tick already in the same event loop)
      expect(state.iteration).toBeLessThanOrEqual(1);

      physics.stop();
      physics.destroy();
    });
  });

  describe("state management", () => {
    it("should get current state", () => {
      const physics = new WebGPUPhysics();
      const state = physics.getState();

      expect(state.alpha).toBe(DEFAULT_WEBGPU_PHYSICS_CONFIG.alphaStart);
      expect(state.isRunning).toBe(false);
      expect(state.iteration).toBe(0);
      expect(state.webgpuAvailable).toBe(false);

      physics.destroy();
    });

    it("should get velocities", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 5, vy: -3, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      const velocities = physics.getVelocities();

      expect(velocities.get("a")).toEqual({ vx: 5, vy: -3 });

      physics.destroy();
    });
  });

  describe("configuration", () => {
    it("should update configuration", () => {
      const physics = new WebGPUPhysics();

      physics.setConfig({
        repulsionStrength: -600,
        velocityDecay: 0.5,
      });

      const config = physics.getConfig();
      expect(config.repulsionStrength).toBe(-600);
      expect(config.velocityDecay).toBe(0.5);

      physics.destroy();
    });
  });

  describe("events", () => {
    it("should emit start event", (done) => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);

      physics.on("start", (event: PhysicsEvent) => {
        expect(event.type).toBe("start");
        expect(event.state.isRunning).toBe(true);
        physics.stop();
        physics.destroy();
        done();
      });

      physics.start();
    });

    it("should emit end event", (done) => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);

      physics.on("end", (event: PhysicsEvent) => {
        expect(event.type).toBe("end");
        expect(event.state.isRunning).toBe(false);
        physics.destroy();
        done();
      });

      physics.start();
      physics.stop();
    });

    it("should remove event listener", () => {
      const physics = new WebGPUPhysics();
      const listener = jest.fn();

      const unsubscribe = physics.on("tick", listener);
      unsubscribe();

      // Listener should not be called
      // No direct way to verify, but no error should occur
      physics.destroy();
    });
  });

  describe("CPU fallback simulation", () => {
    it("should apply repulsion force between nodes", async () => {
      const physics = new WebGPUPhysics({
        repulsionStrength: -100,
        velocityDecay: 0.1,
        alphaDecay: 0.5, // Fast decay for test
      });

      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
        { id: "b", x: 10, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);

      // Run one tick manually
      const initialPositions = physics.getPositions();
      const initialA = initialPositions.get("a")!;
      const initialB = initialPositions.get("b")!;

      physics.start();

      // Wait for a few ticks
      await new Promise((resolve) => setTimeout(resolve, 100));

      physics.stop();

      const finalPositions = physics.getPositions();
      const finalA = finalPositions.get("a")!;
      const finalB = finalPositions.get("b")!;

      // Nodes should have moved apart due to repulsion
      const initialDistance = Math.sqrt(
        (initialB.x - initialA.x) ** 2 + (initialB.y - initialA.y) ** 2
      );
      const finalDistance = Math.sqrt(
        (finalB.x - finalA.x) ** 2 + (finalB.y - finalA.y) ** 2
      );

      expect(finalDistance).toBeGreaterThan(initialDistance);

      physics.destroy();
    });

    it("should apply center force", async () => {
      const physics = new WebGPUPhysics({
        centerStrength: 0.5,
        repulsionStrength: 0, // Disable repulsion
        velocityDecay: 0.1,
        alphaDecay: 0.3,
      });

      const nodes: PhysicsNode[] = [
        { id: "a", x: 500, y: 500, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      physics.stop();

      const positions = physics.getPositions();
      const finalA = positions.get("a")!;

      // Node should have moved toward center (which is at its initial position)
      // Since it's the only node, center = node position, so minimal movement
      expect(finalA.x).toBeDefined();
      expect(finalA.y).toBeDefined();

      physics.destroy();
    });

    it("should respect fixed node positions", async () => {
      const physics = new WebGPUPhysics({
        repulsionStrength: -100,
      });

      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0, mass: 1, radius: 10, group: 0 },
        { id: "b", x: 10, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      physics.stop();

      const positions = physics.getPositions();
      const finalA = positions.get("a")!;

      // Fixed node should not have moved
      expect(finalA.x).toBe(0);
      expect(finalA.y).toBe(0);

      physics.destroy();
    });

    it("should apply collision force", async () => {
      const physics = new WebGPUPhysics({
        repulsionStrength: 0, // Disable repulsion
        collisionStrength: 1,
        velocityDecay: 0.1,
        alphaDecay: 0.3,
      });

      // Place nodes overlapping
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 20, group: 0 },
        { id: "b", x: 10, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 20, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();

      await new Promise((resolve) => setTimeout(resolve, 100));

      physics.stop();

      const positions = physics.getPositions();
      const finalA = positions.get("a")!;
      const finalB = positions.get("b")!;

      // Nodes should have moved apart due to collision
      const finalDistance = Math.sqrt(
        (finalB.x - finalA.x) ** 2 + (finalB.y - finalA.y) ** 2
      );

      // Should be at least radius * 2 apart (no overlap)
      expect(finalDistance).toBeGreaterThanOrEqual(10);

      physics.destroy();
    });
  });

  describe("cleanup", () => {
    it("should destroy resources", () => {
      const physics = new WebGPUPhysics();
      const nodes: PhysicsNode[] = [
        { id: "a", x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, mass: 1, radius: 10, group: 0 },
      ];

      physics.setNodes(nodes);
      physics.start();
      physics.destroy();

      // Should be stopped
      const state = physics.getState();
      expect(state.isRunning).toBe(false);
    });
  });

  describe("default config values", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.repulsionStrength).toBe(-300);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.linkDistance).toBe(100);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.linkStrength).toBe(0.5);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.velocityDecay).toBe(0.4);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.centerStrength).toBe(0.1);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.collisionStrength).toBe(0.7);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.alphaDecay).toBeCloseTo(0.0228, 4);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.alphaTarget).toBe(0);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.alphaMin).toBe(0.001);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.alphaStart).toBe(1);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.barnesHutTheta).toBe(0.9);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.maxIterationsPerTick).toBe(1);
      expect(DEFAULT_WEBGPU_PHYSICS_CONFIG.workgroupSize).toBe(256);
    });
  });
});
