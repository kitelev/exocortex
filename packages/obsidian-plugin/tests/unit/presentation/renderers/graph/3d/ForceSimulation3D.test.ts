/**
 * ForceSimulation3D Unit Tests
 *
 * Tests for the 3D force-directed layout simulation.
 */

import {
  ForceSimulation3D,
  createForceSimulation3D,
} from "@plugin/presentation/renderers/graph/3d/ForceSimulation3D";
import type {
  GraphNode3D,
  GraphEdge3D,
} from "@plugin/presentation/renderers/graph/3d/types3d";

describe("ForceSimulation3D", () => {
  describe("constructor and factory", () => {
    it("creates instance with default config", () => {
      const simulation = new ForceSimulation3D();
      expect(simulation).toBeDefined();
      expect(simulation.isRunning()).toBe(false);
    });

    it("creates instance with custom config", () => {
      const simulation = new ForceSimulation3D([], [], {
        chargeStrength: -500,
        linkDistance: 150,
      });
      expect(simulation).toBeDefined();
    });

    it("creates instance via factory function", () => {
      const simulation = createForceSimulation3D();
      expect(simulation).toBeDefined();
      expect(simulation.isRunning()).toBe(false);
    });
  });

  describe("setData", () => {
    it("initializes nodes with positions", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
        { id: "n2", label: "Node 2", path: "/n2" },
      ];

      const simulation = new ForceSimulation3D(nodes);
      const resultNodes = simulation.getNodes();

      expect(resultNodes.length).toBe(2);
      for (const node of resultNodes) {
        expect(typeof node.x).toBe("number");
        expect(typeof node.y).toBe("number");
        expect(typeof node.z).toBe("number");
        expect(isFinite(node.x!)).toBe(true);
        expect(isFinite(node.y!)).toBe(true);
        expect(isFinite(node.z!)).toBe(true);
      }
    });

    it("preserves existing node positions", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 100, y: 200, z: 300 },
      ];

      const simulation = new ForceSimulation3D(nodes);
      const resultNodes = simulation.getNodes();

      expect(resultNodes[0].x).toBe(100);
      expect(resultNodes[0].y).toBe(200);
      expect(resultNodes[0].z).toBe(300);
    });

    it("creates links between nodes", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
        { id: "n2", label: "Node 2", path: "/n2" },
      ];
      const edges: GraphEdge3D[] = [
        { id: "e1", source: "n1", target: "n2" },
      ];

      const simulation = new ForceSimulation3D(nodes, edges);
      expect(simulation).toBeDefined();
      // Links are internal, but we can verify simulation works
    });

    it("handles edges with node references", () => {
      const node1: GraphNode3D = { id: "n1", label: "Node 1", path: "/n1" };
      const node2: GraphNode3D = { id: "n2", label: "Node 2", path: "/n2" };
      const edges: GraphEdge3D[] = [
        { id: "e1", source: node1, target: node2 },
      ];

      const simulation = new ForceSimulation3D([node1, node2], edges);
      expect(simulation).toBeDefined();
    });
  });

  describe("getNode", () => {
    it("returns node by ID", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
        { id: "n2", label: "Node 2", path: "/n2" },
      ];

      const simulation = new ForceSimulation3D(nodes);
      const node = simulation.getNode("n1");

      expect(node).toBeDefined();
      expect(node?.id).toBe("n1");
      expect(node?.label).toBe("Node 1");
    });

    it("returns undefined for non-existent node", () => {
      const simulation = new ForceSimulation3D([]);
      const node = simulation.getNode("nonexistent");

      expect(node).toBeUndefined();
    });
  });

  describe("pinNode and unpinNode", () => {
    it("pins node at specified position", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
      ];

      const simulation = new ForceSimulation3D(nodes);
      simulation.pinNode("n1", { x: 50, y: 60, z: 70 });

      const node = simulation.getNode("n1");
      expect(node?.x).toBe(50);
      expect(node?.y).toBe(60);
      expect(node?.z).toBe(70);
      expect(node?.fx).toBe(50);
      expect(node?.fy).toBe(60);
      expect(node?.fz).toBe(70);
    });

    it("unpins node", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
      ];

      const simulation = new ForceSimulation3D(nodes);
      simulation.pinNode("n1", { x: 50, y: 60, z: 70 });
      simulation.unpinNode("n1");

      const node = simulation.getNode("n1");
      expect(node?.fx).toBeNull();
      expect(node?.fy).toBeNull();
      expect(node?.fz).toBeNull();
    });
  });

  describe("alpha management", () => {
    it("returns initial alpha", () => {
      const simulation = new ForceSimulation3D();
      expect(simulation.getAlpha()).toBe(1);
    });

    it("sets alpha value", () => {
      const simulation = new ForceSimulation3D();
      simulation.setAlpha(0.5);
      expect(simulation.getAlpha()).toBe(0.5);
    });
  });

  describe("tick", () => {
    it("updates node positions", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 0, y: 0, z: 0 },
        { id: "n2", label: "Node 2", path: "/n2", x: 10, y: 0, z: 0 },
      ];
      const edges: GraphEdge3D[] = [
        { id: "e1", source: "n1", target: "n2" },
      ];

      const simulation = new ForceSimulation3D(nodes, edges);
      const initialPositions = simulation.getNodes().map((n) => ({ x: n.x, y: n.y, z: n.z }));

      // Run a few ticks
      for (let i = 0; i < 10; i++) {
        simulation.tick();
      }

      const newPositions = simulation.getNodes().map((n) => ({ x: n.x, y: n.y, z: n.z }));

      // Positions should have changed (unless perfectly balanced, which is unlikely)
      const positionsChanged = newPositions.some((pos, i) =>
        pos.x !== initialPositions[i].x ||
        pos.y !== initialPositions[i].y ||
        pos.z !== initialPositions[i].z
      );
      expect(positionsChanged).toBe(true);
    });

    it("decays alpha over time", () => {
      const simulation = new ForceSimulation3D();
      const initialAlpha = simulation.getAlpha();

      simulation.tick();

      expect(simulation.getAlpha()).toBeLessThan(initialAlpha);
    });

    it("respects fixed node positions", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 0, y: 0, z: 0 },
        { id: "n2", label: "Node 2", path: "/n2", x: 100, y: 100, z: 100 },
      ];

      const simulation = new ForceSimulation3D(nodes);
      simulation.pinNode("n1", { x: 0, y: 0, z: 0 });

      for (let i = 0; i < 10; i++) {
        simulation.tick();
      }

      const node = simulation.getNode("n1");
      expect(node?.x).toBe(0);
      expect(node?.y).toBe(0);
      expect(node?.z).toBe(0);
    });
  });

  describe("start and stop", () => {
    it("starts and stops simulation", () => {
      const simulation = new ForceSimulation3D();

      expect(simulation.isRunning()).toBe(false);

      simulation.start();
      expect(simulation.isRunning()).toBe(true);

      simulation.stop();
      expect(simulation.isRunning()).toBe(false);
    });

    it("does not start if already running", () => {
      const simulation = new ForceSimulation3D();

      simulation.start();
      simulation.start(); // Should not throw

      expect(simulation.isRunning()).toBe(true);
      simulation.stop();
    });
  });

  describe("restart", () => {
    it("restarts with specified alpha", () => {
      const simulation = new ForceSimulation3D();

      // Manually decay alpha
      simulation.setAlpha(0.1);

      simulation.restart(0.8);
      expect(simulation.getAlpha()).toBe(0.8);
      expect(simulation.isRunning()).toBe(true);

      simulation.stop();
    });

    it("restarts with default alpha if not specified", () => {
      const simulation = new ForceSimulation3D();
      simulation.setAlpha(0.1);

      simulation.restart();
      expect(simulation.getAlpha()).toBe(1);
      expect(simulation.isRunning()).toBe(true);

      simulation.stop();
    });
  });

  describe("event listeners", () => {
    it("emits tick events", (done) => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
      ];

      const simulation = new ForceSimulation3D(nodes);

      simulation.on("tick", (event) => {
        expect(event.type).toBe("tick");
        expect(event.alpha).toBeDefined();
        expect(event.nodes.length).toBe(1);
        simulation.stop();
        done();
      });

      simulation.start();
    });

    it("emits end event when alpha reaches alphaMin threshold", (done) => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
      ];

      // Use high alphaDecay for faster convergence in test
      const simulation = new ForceSimulation3D(nodes, [], {
        alphaDecay: 0.5, // Very fast decay for test
        alphaMin: 0.01,
      });

      simulation.on("end", (event) => {
        expect(event.type).toBe("end");
        expect(event.alpha).toBeLessThan(0.01);
        expect(event.nodes.length).toBe(1);
        done();
      });

      simulation.start();
    }, 10000); // Increase timeout for convergence

    it("removes event listeners", () => {
      const simulation = new ForceSimulation3D();
      const listener = jest.fn();

      simulation.on("tick", listener);
      simulation.off("tick", listener);

      simulation.tick();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("convergence", () => {
    it("converges when alpha drops below alphaMin (0.01)", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
        { id: "n2", label: "Node 2", path: "/n2" },
      ];

      const simulation = new ForceSimulation3D(nodes, [], {
        alphaMin: 0.01,
        alphaDecay: 0.1, // Fast decay for test
      });

      // Run ticks until alpha < alphaMin
      let tickCount = 0;
      while (simulation.getAlpha() >= 0.01 && tickCount < 100) {
        simulation.tick();
        tickCount++;
      }

      expect(simulation.getAlpha()).toBeLessThan(0.01);
    });

    it("simulation stops automatically when converged", (done) => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1" },
      ];

      const simulation = new ForceSimulation3D(nodes, [], {
        alphaDecay: 0.5, // Very fast decay
        alphaMin: 0.01,
      });

      simulation.on("end", () => {
        // Simulation should have stopped
        expect(simulation.isRunning()).toBe(false);
        done();
      });

      simulation.start();
    }, 10000);
  });

  describe("updateConfig", () => {
    it("updates configuration", () => {
      const simulation = new ForceSimulation3D();

      simulation.updateConfig({
        chargeStrength: -500,
        linkDistance: 200,
      });

      // Config is private, but we can verify it doesn't throw
      expect(simulation).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("cleans up resources", () => {
      const simulation = new ForceSimulation3D([
        { id: "n1", label: "Node 1", path: "/n1" },
      ]);

      simulation.start();
      simulation.destroy();

      expect(simulation.isRunning()).toBe(false);
      expect(simulation.getNodes().length).toBe(0);
    });
  });

  describe("force calculations", () => {
    it("applies repulsion between nodes", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 0, y: 0, z: 0 },
        { id: "n2", label: "Node 2", path: "/n2", x: 1, y: 0, z: 0 },
      ];

      const simulation = new ForceSimulation3D(nodes, [], {
        chargeStrength: -300,
        centerStrength: 0,
      });

      for (let i = 0; i < 50; i++) {
        simulation.tick();
      }

      const n1 = simulation.getNode("n1")!;
      const n2 = simulation.getNode("n2")!;

      // Nodes should have moved apart due to repulsion
      const distance = Math.sqrt(
        (n2.x! - n1.x!) ** 2 + (n2.y! - n1.y!) ** 2 + (n2.z! - n1.z!) ** 2
      );
      expect(distance).toBeGreaterThan(1);
    });

    it("applies link attraction", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 0, y: 0, z: 0 },
        { id: "n2", label: "Node 2", path: "/n2", x: 500, y: 0, z: 0 },
      ];
      const edges: GraphEdge3D[] = [
        { id: "e1", source: "n1", target: "n2" },
      ];

      const simulation = new ForceSimulation3D(nodes, edges, {
        chargeStrength: 0,
        centerStrength: 0,
        linkDistance: 100,
      });

      for (let i = 0; i < 100; i++) {
        simulation.tick();
      }

      const n1 = simulation.getNode("n1")!;
      const n2 = simulation.getNode("n2")!;

      // Nodes should have moved closer due to link force
      const distance = Math.sqrt(
        (n2.x! - n1.x!) ** 2 + (n2.y! - n1.y!) ** 2 + (n2.z! - n1.z!) ** 2
      );
      expect(distance).toBeLessThan(500);
    });

    it("applies center force", () => {
      const nodes: GraphNode3D[] = [
        { id: "n1", label: "Node 1", path: "/n1", x: 1000, y: 1000, z: 1000 },
      ];

      const simulation = new ForceSimulation3D(nodes, [], {
        chargeStrength: 0,
        centerStrength: 0.5,
      });

      for (let i = 0; i < 100; i++) {
        simulation.tick();
      }

      const n1 = simulation.getNode("n1")!;

      // Node should have moved toward center
      const distanceFromCenter = Math.sqrt(n1.x! ** 2 + n1.y! ** 2 + n1.z! ** 2);
      expect(distanceFromCenter).toBeLessThan(1000 * Math.sqrt(3));
    });
  });
});
