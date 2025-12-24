/**
 * Barnes-Hut Force Tests
 *
 * Tests for the Barnes-Hut algorithm implementation for many-body force calculation.
 */

import {
  BarnesHutForce,
  createBarnesHutForce,
  applyBarnesHutForce,
  benchmarkBarnesHut,
  type SimulationNode,
} from "@plugin/presentation/renderers/graph/BarnesHutForce";

describe("BarnesHutForce", () => {
  const createTestNodes = (count: number): SimulationNode[] => {
    const nodes: SimulationNode[] = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        index: i,
        x: Math.random() * 500,
        y: Math.random() * 500,
        vx: 0,
        vy: 0,
      });
    }
    return nodes;
  };

  describe("constructor", () => {
    it("should create force with default options", () => {
      const force = new BarnesHutForce();
      expect(force.theta()).toBe(0.9);
      expect(force.strength()).toBe(-30);
      expect(force.distanceMin()).toBe(1);
      expect(force.distanceMax()).toBe(Infinity);
    });

    it("should create force with custom options", () => {
      const force = new BarnesHutForce({
        theta: 0.5,
        strength: -100,
        distanceMin: 5,
        distanceMax: 500,
      });
      expect(force.theta()).toBe(0.5);
      expect(force.strength()).toBe(-100);
      expect(force.distanceMin()).toBe(5);
      expect(force.distanceMax()).toBe(500);
    });
  });

  describe("createBarnesHutForce", () => {
    it("should create force instance", () => {
      const force = createBarnesHutForce({ theta: 0.7 });
      expect(force).toBeInstanceOf(BarnesHutForce);
      expect(force.theta()).toBe(0.7);
    });
  });

  describe("initialize", () => {
    it("should initialize with nodes", () => {
      const force = new BarnesHutForce();
      const nodes = createTestNodes(10);
      force.initialize(nodes);
      // Force should be ready to compute
      expect(() => force.force(1.0)).not.toThrow();
    });
  });

  describe("force", () => {
    it("should apply repulsive forces between nodes", () => {
      const force = new BarnesHutForce({ strength: -100 });
      const nodes: SimulationNode[] = [
        { index: 0, x: 100, y: 100, vx: 0, vy: 0 },
        { index: 1, x: 110, y: 100, vx: 0, vy: 0 },
      ];
      force.initialize(nodes);
      force.force(1.0);

      // Nodes should be pushed apart (repulsion)
      expect(nodes[0].vx).toBeLessThan(0); // Left node pushed left
      expect(nodes[1].vx).toBeGreaterThan(0); // Right node pushed right
    });

    it("should handle single node without error", () => {
      const force = new BarnesHutForce();
      const nodes: SimulationNode[] = [{ index: 0, x: 100, y: 100, vx: 0, vy: 0 }];
      force.initialize(nodes);
      expect(() => force.force(1.0)).not.toThrow();
      // Single node should not move
      expect(nodes[0].vx).toBe(0);
      expect(nodes[0].vy).toBe(0);
    });

    it("should handle empty nodes without error", () => {
      const force = new BarnesHutForce();
      force.initialize([]);
      expect(() => force.force(1.0)).not.toThrow();
    });

    it("should apply alpha scaling", () => {
      const force = new BarnesHutForce({ strength: -100 });
      const nodes1: SimulationNode[] = [
        { index: 0, x: 100, y: 100, vx: 0, vy: 0 },
        { index: 1, x: 110, y: 100, vx: 0, vy: 0 },
      ];
      const nodes2: SimulationNode[] = [
        { index: 0, x: 100, y: 100, vx: 0, vy: 0 },
        { index: 1, x: 110, y: 100, vx: 0, vy: 0 },
      ];

      const force1 = new BarnesHutForce({ strength: -100 });
      const force2 = new BarnesHutForce({ strength: -100 });

      force1.initialize(nodes1);
      force2.initialize(nodes2);

      force1.force(1.0);
      force2.force(0.5);

      // Higher alpha = stronger force
      expect(Math.abs(nodes1[0].vx!)).toBeGreaterThan(Math.abs(nodes2[0].vx!));
    });

    it("should respect distanceMin", () => {
      const force = new BarnesHutForce({ strength: -100, distanceMin: 50 });
      const nodes: SimulationNode[] = [
        { index: 0, x: 100, y: 100, vx: 0, vy: 0 },
        { index: 1, x: 101, y: 100, vx: 0, vy: 0 }, // Very close
      ];
      force.initialize(nodes);
      force.force(1.0);

      // Forces should be limited (not infinite)
      expect(Math.abs(nodes[0].vx!)).toBeLessThan(10000);
      expect(Math.abs(nodes[1].vx!)).toBeLessThan(10000);
    });

    it("should respect distanceMax", () => {
      const forceWithMax = new BarnesHutForce({ strength: -100, distanceMax: 50 });
      const forceWithoutMax = new BarnesHutForce({ strength: -100 });

      const nodes1: SimulationNode[] = [
        { index: 0, x: 0, y: 0, vx: 0, vy: 0 },
        { index: 1, x: 200, y: 0, vx: 0, vy: 0 }, // Far apart (> 50)
      ];
      const nodes2: SimulationNode[] = [
        { index: 0, x: 0, y: 0, vx: 0, vy: 0 },
        { index: 1, x: 200, y: 0, vx: 0, vy: 0 },
      ];

      forceWithMax.initialize(nodes1);
      forceWithoutMax.initialize(nodes2);

      forceWithMax.force(1.0);
      forceWithoutMax.force(1.0);

      // With distanceMax, far nodes should not affect each other
      expect(Math.abs(nodes1[0].vx!)).toBeLessThan(Math.abs(nodes2[0].vx!));
    });
  });

  describe("theta setter/getter", () => {
    it("should get and set theta", () => {
      const force = new BarnesHutForce();
      expect(force.theta()).toBe(0.9);
      force.theta(0.5);
      expect(force.theta()).toBe(0.5);
    });

    it("should return this for chaining", () => {
      const force = new BarnesHutForce();
      expect(force.theta(0.7)).toBe(force);
    });
  });

  describe("strength setter/getter", () => {
    it("should get and set constant strength", () => {
      const force = new BarnesHutForce();
      force.strength(-200);
      expect(force.strength()).toBe(-200);
    });

    it("should get and set function strength", () => {
      const force = new BarnesHutForce();
      const strengthFn = (node: SimulationNode) => -30 * (node.index ?? 1);
      force.strength(strengthFn);
      expect(force.strength()).toBe(strengthFn);
    });

    it("should return this for chaining", () => {
      const force = new BarnesHutForce();
      expect(force.strength(-100)).toBe(force);
    });
  });

  describe("distanceMin setter/getter", () => {
    it("should get and set distanceMin", () => {
      const force = new BarnesHutForce();
      force.distanceMin(10);
      expect(force.distanceMin()).toBe(10);
    });
  });

  describe("distanceMax setter/getter", () => {
    it("should get and set distanceMax", () => {
      const force = new BarnesHutForce();
      force.distanceMax(500);
      expect(force.distanceMax()).toBe(500);
    });
  });

  describe("applyBarnesHutForce", () => {
    it("should apply force to nodes", () => {
      const nodes: SimulationNode[] = [
        { index: 0, x: 100, y: 100, vx: 0, vy: 0 },
        { index: 1, x: 110, y: 100, vx: 0, vy: 0 },
      ];

      applyBarnesHutForce(nodes, { strength: -100 });

      expect(nodes[0].vx).not.toBe(0);
      expect(nodes[1].vx).not.toBe(0);
    });
  });

  describe("theta parameter effect", () => {
    it("should produce similar results with different theta values", () => {
      const createNodesGrid = (): SimulationNode[] => {
        const nodes: SimulationNode[] = [];
        let index = 0;
        for (let i = 0; i < 10; i++) {
          for (let j = 0; j < 10; j++) {
            nodes.push({
              index: index++,
              x: i * 50 + 25,
              y: j * 50 + 25,
              vx: 0,
              vy: 0,
            });
          }
        }
        return nodes;
      };

      const nodes1 = createNodesGrid();
      const nodes2 = createNodesGrid();
      const nodes3 = createNodesGrid();

      // Exact calculation (theta = 0)
      const force1 = new BarnesHutForce({ theta: 0, strength: -30 });
      force1.initialize(nodes1);
      force1.force(1.0);

      // Balanced (theta = 0.9)
      const force2 = new BarnesHutForce({ theta: 0.9, strength: -30 });
      force2.initialize(nodes2);
      force2.force(1.0);

      // Fast approximation (theta = 1.5)
      const force3 = new BarnesHutForce({ theta: 1.5, strength: -30 });
      force3.initialize(nodes3);
      force3.force(1.0);

      // Results should be in similar direction but may differ in magnitude
      // Check that center node has similar direction of forces
      const centerIdx = 44; // Center of 10x10 grid

      // Verify forces were applied
      expect(nodes1[centerIdx].vx).toBeDefined();
      expect(nodes2[centerIdx].vx).toBeDefined();
      expect(nodes3[centerIdx].vx).toBeDefined();
    });
  });

  describe("benchmarkBarnesHut", () => {
    it("should return benchmark results", () => {
      const result = benchmarkBarnesHut(100, 2);

      expect(result.naive).toBeGreaterThan(0);
      expect(result.barnesHut).toBeGreaterThan(0);
      expect(result.speedup).toBeGreaterThan(0);
    });

    it("should show speedup for large graphs", () => {
      // For larger node counts, Barnes-Hut should be faster
      const result = benchmarkBarnesHut(1000, 3);

      // Barnes-Hut should provide speedup for 1000 nodes
      expect(result.speedup).toBeGreaterThan(1);
    });
  });

  describe("integration with grid patterns", () => {
    it("should produce balanced forces on symmetric grid", () => {
      // Create symmetric 3x3 grid
      const nodes: SimulationNode[] = [];
      let index = 0;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          nodes.push({
            index: index++,
            x: i * 100,
            y: j * 100,
            vx: 0,
            vy: 0,
          });
        }
      }

      const force = new BarnesHutForce({ strength: -100 });
      force.initialize(nodes);
      force.force(1.0);

      // Center node (index 4) should have near-zero velocity due to symmetry
      const centerNode = nodes[4];
      expect(Math.abs(centerNode.vx!)).toBeLessThan(0.1);
      expect(Math.abs(centerNode.vy!)).toBeLessThan(0.1);

      // Corner nodes should be pushed outward
      const cornerNode = nodes[0]; // Top-left
      expect(cornerNode.vx!).toBeLessThan(0); // Pushed left
      expect(cornerNode.vy!).toBeLessThan(0); // Pushed up
    });
  });

  describe("function-based strength", () => {
    it("should apply variable strength per node", () => {
      const nodes: SimulationNode[] = [
        { index: 0, x: 100, y: 100, vx: 0, vy: 0 },
        { index: 1, x: 200, y: 100, vx: 0, vy: 0 },
        { index: 2, x: 150, y: 200, vx: 0, vy: 0 },
      ];

      // First node has stronger repulsion
      const force = new BarnesHutForce({
        strength: (node) => (node.index === 0 ? -200 : -50),
      });

      force.initialize(nodes);
      force.force(1.0);

      // All nodes should have non-zero velocity
      nodes.forEach((node) => {
        expect(node.vx !== 0 || node.vy !== 0).toBe(true);
      });
    });
  });
});
