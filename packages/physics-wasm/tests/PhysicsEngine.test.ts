/**
 * Unit tests for PhysicsEngine
 *
 * Tests the JavaScript fallback implementation since WASM requires
 * actual compilation. The interface is the same for both implementations.
 */

import { PhysicsEngine, DEFAULT_PHYSICS_PARAMS } from "../src";
import type { PhysicsNode, PhysicsEdge } from "../src";

describe("PhysicsEngine", () => {
  let engine: PhysicsEngine;

  beforeEach(() => {
    engine = new PhysicsEngine();
  });

  describe("initialization", () => {
    it("should create engine without WASM", () => {
      expect(engine).toBeDefined();
      expect(engine.isWasmReady()).toBe(false);
    });

    it("should initialize with nodes and edges", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 100, y: 100 },
      ];
      const edges: PhysicsEdge[] = [{ source: 0, target: 1 }];

      engine.initialize(nodes, edges);

      expect(engine.getNodeCount()).toBe(2);
      expect(engine.getEdgeCount()).toBe(1);
    });

    it("should initialize with empty arrays", () => {
      engine.initialize([], []);

      expect(engine.getNodeCount()).toBe(0);
      expect(engine.getEdgeCount()).toBe(0);
    });

    it("should preserve initial positions", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 50, y: 75 },
        { index: 1, x: 200, y: 300 },
      ];

      engine.initialize(nodes, []);

      const pos0 = engine.getNodePosition(0);
      const pos1 = engine.getNodePosition(1);

      expect(pos0.x).toBe(50);
      expect(pos0.y).toBe(75);
      expect(pos1.x).toBe(200);
      expect(pos1.y).toBe(300);
    });
  });

  describe("simulation parameters", () => {
    it("should apply default parameters", () => {
      const nodes: PhysicsNode[] = [{ index: 0, x: 0, y: 0 }];
      engine.initialize(nodes, []);

      // Should not throw
      expect(() => engine.tick()).not.toThrow();
    });

    it("should apply custom parameters", () => {
      const nodes: PhysicsNode[] = [{ index: 0, x: 0, y: 0 }];
      engine.initialize(nodes, []);

      engine.setParams({
        chargeStrength: -500,
        linkDistance: 200,
        alpha: 0.5,
      });

      expect(engine.getAlpha()).toBe(0.5);
    });
  });

  describe("simulation tick", () => {
    it("should reduce alpha on each tick", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 100, y: 0 },
      ];
      engine.initialize(nodes, []);

      const initialAlpha = engine.getAlpha();
      engine.tick();
      const newAlpha = engine.getAlpha();

      expect(newAlpha).toBeLessThan(initialAlpha);
    });

    it("should eventually stop (alpha approaches 0)", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 100, y: 0 },
      ];
      engine.initialize(nodes, []);

      // Run many iterations
      for (let i = 0; i < 1000; i++) {
        if (!engine.isActive()) break;
        engine.tick();
      }

      expect(engine.isActive()).toBe(false);
      expect(engine.getAlpha()).toBeLessThanOrEqual(0.001);
    });

    it("should move nodes based on forces", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 10, y: 0 }, // Very close - should repel
      ];
      engine.initialize(nodes, []);
      engine.setParams({ chargeStrength: -300 });

      const initialDist = Math.abs(
        engine.getNodePosition(1).x - engine.getNodePosition(0).x
      );

      // Run several ticks
      for (let i = 0; i < 50; i++) {
        engine.tick();
      }

      const finalDist = Math.abs(
        engine.getNodePosition(1).x - engine.getNodePosition(0).x
      );

      // Nodes should have moved apart due to repulsion
      expect(finalDist).toBeGreaterThan(initialDist);
    });

    it("should respect link forces", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 500, y: 0 }, // Far apart
      ];
      const edges: PhysicsEdge[] = [{ source: 0, target: 1, strength: 1 }];

      engine.initialize(nodes, edges);
      engine.setParams({
        linkDistance: 100,
        linkStrength: 1,
        chargeStrength: 0, // Disable charge to test link only
      });

      const initialDist = Math.abs(
        engine.getNodePosition(1).x - engine.getNodePosition(0).x
      );

      // Run several ticks
      for (let i = 0; i < 100; i++) {
        engine.tick();
      }

      const finalDist = Math.abs(
        engine.getNodePosition(1).x - engine.getNodePosition(0).x
      );

      // Nodes should have moved closer due to link attraction
      expect(finalDist).toBeLessThan(initialDist);
    });
  });

  describe("node manipulation", () => {
    it("should set node position", () => {
      const nodes: PhysicsNode[] = [{ index: 0, x: 0, y: 0 }];
      engine.initialize(nodes, []);

      engine.setNodePosition(0, 123, 456);

      const pos = engine.getNodePosition(0);
      expect(pos.x).toBe(123);
      expect(pos.y).toBe(456);
    });

    it("should fix node at position", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 10, y: 0 },
      ];
      engine.initialize(nodes, []);

      // Fix node 0 at origin
      engine.fixNode(0, 0, 0);

      // Run simulation
      for (let i = 0; i < 50; i++) {
        engine.tick();
      }

      // Node 0 should still be at origin
      const pos = engine.getNodePosition(0);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });

    it("should unfix node", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 10, y: 0 },
      ];
      engine.initialize(nodes, []);

      engine.fixNode(0, 0, 0);
      engine.unfixNode(0);

      // Run simulation
      for (let i = 0; i < 50; i++) {
        engine.tick();
      }

      // Node 0 should have moved (due to repulsion from node 1)
      const pos = engine.getNodePosition(0);
      expect(pos.x !== 0 || pos.y !== 0).toBe(true);
    });
  });

  describe("getPositions", () => {
    it("should return all positions", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 10, y: 20 },
        { index: 1, x: 30, y: 40 },
        { index: 2, x: 50, y: 60 },
      ];
      engine.initialize(nodes, []);

      const positions = engine.getPositions();

      expect(positions).toHaveLength(3);
      expect(positions[0].x).toBe(10);
      expect(positions[0].y).toBe(20);
      expect(positions[1].x).toBe(30);
      expect(positions[1].y).toBe(40);
      expect(positions[2].x).toBe(50);
      expect(positions[2].y).toBe(60);
    });
  });

  describe("alpha control", () => {
    it("should set alpha directly", () => {
      const nodes: PhysicsNode[] = [{ index: 0, x: 0, y: 0 }];
      engine.initialize(nodes, []);

      engine.setAlpha(0.5);
      expect(engine.getAlpha()).toBe(0.5);
    });

    it("should reheat simulation", () => {
      const nodes: PhysicsNode[] = [{ index: 0, x: 0, y: 0 }];
      engine.initialize(nodes, []);

      engine.setAlpha(0);
      expect(engine.isActive()).toBe(false);

      engine.reheat();
      expect(engine.isActive()).toBe(true);
      expect(engine.getAlpha()).toBe(1);
    });

    it("should stop simulation", () => {
      const nodes: PhysicsNode[] = [{ index: 0, x: 0, y: 0 }];
      engine.initialize(nodes, []);

      expect(engine.isActive()).toBe(true);

      engine.stop();
      expect(engine.isActive()).toBe(false);
      expect(engine.getAlpha()).toBe(0);
    });
  });

  describe("findNodeAt", () => {
    it("should find node at position", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 100, y: 100 },
        { index: 1, x: 200, y: 200 },
      ];
      engine.initialize(nodes, []);

      expect(engine.findNodeAt(100, 100)).toBe(0);
      expect(engine.findNodeAt(200, 200)).toBe(1);
      expect(engine.findNodeAt(105, 105, 10)).toBe(0);
    });

    it("should return -1 if no node found", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 100, y: 100 },
        { index: 1, x: 200, y: 200 },
      ];
      engine.initialize(nodes, []);

      expect(engine.findNodeAt(0, 0, 10)).toBe(-1);
      expect(engine.findNodeAt(1000, 1000)).toBe(-1);
    });
  });

  describe("getBoundingBox", () => {
    it("should calculate bounding box", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 10, y: 20 },
        { index: 1, x: 100, y: 50 },
        { index: 2, x: 50, y: 80 },
      ];
      engine.initialize(nodes, []);

      const bb = engine.getBoundingBox();

      expect(bb.minX).toBe(10);
      expect(bb.minY).toBe(20);
      expect(bb.maxX).toBe(100);
      expect(bb.maxY).toBe(80);
    });

    it("should return zero box for empty graph", () => {
      engine.initialize([], []);

      const bb = engine.getBoundingBox();

      expect(bb.minX).toBe(0);
      expect(bb.minY).toBe(0);
      expect(bb.maxX).toBe(0);
      expect(bb.maxY).toBe(0);
    });
  });

  describe("center force", () => {
    it("should center nodes around specified point", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 1000, y: 1000 },
        { index: 1, x: 1100, y: 1100 },
      ];
      engine.initialize(nodes, []);
      engine.setParams({
        centerX: 0,
        centerY: 0,
        centerStrength: 1,
        chargeStrength: 0, // Disable other forces
        linkStrength: 0,
      });

      // Run many ticks
      for (let i = 0; i < 100; i++) {
        engine.tick();
      }

      // Center of mass should be closer to origin
      const positions = engine.getPositions();
      const centerX = (positions[0].x + positions[1].x) / 2;
      const centerY = (positions[0].y + positions[1].y) / 2;

      // Should have moved toward center
      expect(Math.abs(centerX)).toBeLessThan(1000);
      expect(Math.abs(centerY)).toBeLessThan(1000);
    });
  });

  describe("collision force", () => {
    it("should prevent node overlap", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0, radius: 20 },
        { index: 1, x: 5, y: 0, radius: 20 }, // Overlapping
      ];
      engine.initialize(nodes, []);
      engine.setParams({
        collisionStrength: 1,
        collisionRadius: 20,
        chargeStrength: 0, // Disable other forces
        linkStrength: 0,
        centerStrength: 0,
      });

      // Initial overlap
      const initialDist = Math.abs(
        engine.getNodePosition(1).x - engine.getNodePosition(0).x
      );
      expect(initialDist).toBeLessThan(40); // Less than combined radii

      // Run collision resolution
      for (let i = 0; i < 50; i++) {
        engine.tick();
      }

      // Should have separated
      const finalDist = Math.abs(
        engine.getNodePosition(1).x - engine.getNodePosition(0).x
      );
      expect(finalDist).toBeGreaterThan(initialDist);
    });
  });

  describe("multiple iterations per tick", () => {
    it("should run multiple iterations", () => {
      const nodes: PhysicsNode[] = [
        { index: 0, x: 0, y: 0 },
        { index: 1, x: 100, y: 0 },
      ];
      engine.initialize(nodes, []);

      const alpha1 = engine.getAlpha();
      engine.tick(10); // 10 iterations
      const alpha2 = engine.getAlpha();

      // More iterations = more alpha decay
      expect(alpha2).toBeLessThan(alpha1 * 0.9);
    });
  });
});

describe("DEFAULT_PHYSICS_PARAMS", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_PHYSICS_PARAMS.alpha).toBe(1.0);
    expect(DEFAULT_PHYSICS_PARAMS.alphaDecay).toBe(0.0228);
    expect(DEFAULT_PHYSICS_PARAMS.velocityDecay).toBe(0.4);
    expect(DEFAULT_PHYSICS_PARAMS.chargeStrength).toBe(-300);
    expect(DEFAULT_PHYSICS_PARAMS.linkDistance).toBe(100);
    expect(DEFAULT_PHYSICS_PARAMS.collisionRadius).toBe(8);
  });
});
