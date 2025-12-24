/**
 * ForceSimulation Unit Tests
 *
 * Comprehensive tests for the force-directed layout simulation.
 */

import {
  ForceSimulation,
  forceCenter,
  forceLink,
  forceManyBody,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  FORCE_PRESETS,
  cloneForceConfiguration,
  mergeForceConfiguration,
  validateForceConfiguration,
} from "@plugin/presentation/renderers/graph/ForceSimulation";
import type {
  SimulationNode,
  SimulationLink,
  Force,
  ForceConfiguration,
  ForcePresetName,
} from "@plugin/presentation/renderers/graph/ForceSimulation";

// ============================================================
// Test Helpers
// ============================================================

function createTestNodes(count: number): SimulationNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    index: i,
    x: Math.random() * 100 - 50,
    y: Math.random() * 100 - 50,
    vx: 0,
    vy: 0,
    mass: 1,
    radius: 8,
  }));
}

function createTestLinks(nodes: SimulationNode[]): SimulationLink<SimulationNode>[] {
  const links: SimulationLink<SimulationNode>[] = [];
  for (let i = 1; i < nodes.length; i++) {
    links.push({
      source: nodes[i - 1].id,
      target: nodes[i].id,
    });
  }
  return links;
}

// ============================================================
// ForceSimulation Tests
// ============================================================

describe("ForceSimulation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should create a simulation with default values", () => {
      const sim = new ForceSimulation();

      expect(sim.alpha()).toBe(1);
      expect(sim.alphaMin()).toBe(0.001);
      expect(sim.alphaDecay()).toBeCloseTo(0.0228, 4);
      expect(sim.alphaTarget()).toBe(0);
      expect(sim.velocityDecay()).toBe(0.4);
      expect(sim.isRunning()).toBe(false);
    });

    it("should accept configuration options", () => {
      const sim = new ForceSimulation({
        alpha: 0.5,
        alphaMin: 0.01,
        alphaDecay: 0.05,
        alphaTarget: 0.1,
        velocityDecay: 0.3,
      });

      expect(sim.alpha()).toBe(0.5);
      expect(sim.alphaMin()).toBe(0.01);
      expect(sim.alphaDecay()).toBe(0.05);
      expect(sim.alphaTarget()).toBe(0.1);
      expect(sim.velocityDecay()).toBe(0.3);
    });

    it("should accept a custom random source", () => {
      let callCount = 0;
      const customRandom = () => {
        callCount++;
        return 0.5;
      };

      const sim = new ForceSimulation({ randomSource: customRandom });
      sim.nodes([{ id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 }]);

      expect(sim.randomSource()).toBe(customRandom);
    });
  });

  describe("nodes", () => {
    it("should set and get nodes", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);

      expect(sim.nodes().length).toBe(5);
      expect(sim.nodes()[0].id).toBe("node-0");
    });

    it("should initialize node properties", () => {
      const sim = new ForceSimulation({ randomSource: () => 0.5 });
      const nodes = [
        { id: "a" } as unknown as SimulationNode,
        { id: "b", x: 100, y: 100 } as SimulationNode,
      ];

      sim.nodes(nodes);
      const result = sim.nodes();

      // First node should get random position
      expect(result[0].index).toBe(0);
      expect(result[0].vx).toBe(0);
      expect(result[0].vy).toBe(0);
      expect(result[0].mass).toBe(1);
      expect(result[0].radius).toBe(8);

      // Second node should keep its position
      expect(result[1].x).toBe(100);
      expect(result[1].y).toBe(100);
    });
  });

  describe("alpha accessors", () => {
    it("should clamp alpha values between 0 and 1", () => {
      const sim = new ForceSimulation();

      sim.alpha(-0.5);
      expect(sim.alpha()).toBe(0);

      sim.alpha(1.5);
      expect(sim.alpha()).toBe(1);
    });

    it("should allow alphaMin to be any positive value", () => {
      const sim = new ForceSimulation();

      sim.alphaMin(-0.1);
      expect(sim.alphaMin()).toBe(0);

      sim.alphaMin(0.1);
      expect(sim.alphaMin()).toBe(0.1);
    });
  });

  describe("tick", () => {
    it("should update node positions on tick", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(2);
      nodes[0].vx = 1;
      nodes[0].vy = 1;

      sim.nodes(nodes);
      const initialX = sim.nodes()[0].x;
      const initialY = sim.nodes()[0].y;

      sim.tick();

      // Position should change due to velocity (after decay)
      expect(sim.nodes()[0].x).not.toBe(initialX);
      expect(sim.nodes()[0].y).not.toBe(initialY);
    });

    it("should decay alpha on tick", () => {
      const sim = new ForceSimulation({ alpha: 1 });
      sim.nodes(createTestNodes(2));

      sim.tick();

      expect(sim.alpha()).toBeLessThan(1);
    });

    it("should execute multiple ticks when iterations > 1", () => {
      const sim = new ForceSimulation({ alpha: 1, alphaDecay: 0.1 });
      sim.nodes(createTestNodes(2));

      sim.tick(10);

      // Alpha should have decayed significantly
      expect(sim.alpha()).toBeLessThan(0.5);
    });

    it("should respect fixed node positions", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(2);
      nodes[0].fx = 0;
      nodes[0].fy = 0;
      nodes[0].vx = 100;
      nodes[0].vy = 100;

      sim.nodes(nodes);
      sim.tick(10);

      // Fixed node should stay at (0, 0)
      expect(sim.nodes()[0].x).toBe(0);
      expect(sim.nodes()[0].y).toBe(0);
    });

    it("should track performance metrics", () => {
      const sim = new ForceSimulation();
      sim.nodes(createTestNodes(10));

      sim.tick(5);

      const metrics = sim.metrics();
      expect(metrics.totalTicks).toBe(5);
      expect(metrics.totalTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("force management", () => {
    it("should add and retrieve forces", () => {
      const sim = new ForceSimulation();
      const center = forceCenter(0, 0);

      sim.force("center", center);

      expect(sim.force("center")).toBe(center);
      expect(sim.forceNames()).toContain("center");
    });

    it("should remove forces with null", () => {
      const sim = new ForceSimulation();
      const center = forceCenter(0, 0);

      sim.force("center", center);
      sim.force("center", null);

      expect(sim.force("center")).toBeUndefined();
    });

    it("should initialize forces when nodes are set", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      let initializeCalled = false;
      const testForce: Force<SimulationNode> = (alpha: number) => {};
      testForce.initialize = () => {
        initializeCalled = true;
      };

      sim.force("test", testForce);
      sim.nodes(nodes);

      expect(initializeCalled).toBe(true);
    });

    it("should apply forces during tick", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(2);

      let forceApplied = false;
      const testForce: Force<SimulationNode> = (_alpha: number) => {
        forceApplied = true;
      };

      sim.force("test", testForce);
      sim.nodes(nodes);
      sim.tick();

      expect(forceApplied).toBe(true);
    });
  });

  describe("events", () => {
    it("should emit tick events", () => {
      const sim = new ForceSimulation();
      sim.nodes(createTestNodes(2));

      let tickCount = 0;
      sim.on("tick", () => tickCount++);

      sim.tick(3);

      expect(tickCount).toBe(3);
    });

    it("should emit end event when simulation ends", () => {
      const sim = new ForceSimulation({
        alpha: 0.002,
        alphaMin: 0.001,
        alphaDecay: 1, // Instant decay
      });
      sim.nodes(createTestNodes(2));

      let endCalled = false;
      sim.on("end", () => {
        endCalled = true;
      });

      // Start and let it run until alpha < alphaMin
      sim.start();

      // Advance timers to trigger RAF
      jest.advanceTimersByTime(100);

      expect(endCalled).toBe(true);
    });

    it("should remove event callbacks with off", () => {
      const sim = new ForceSimulation();
      sim.nodes(createTestNodes(2));

      let tickCount = 0;
      const callback = () => tickCount++;

      sim.on("tick", callback);
      sim.tick(2);
      expect(tickCount).toBe(2);

      sim.off("tick", callback);
      sim.tick(2);
      expect(tickCount).toBe(2); // Should not increase
    });
  });

  describe("lifecycle", () => {
    it("should start and stop the simulation", () => {
      const sim = new ForceSimulation();
      sim.nodes(createTestNodes(2));

      expect(sim.isRunning()).toBe(false);

      sim.start();
      expect(sim.isRunning()).toBe(true);

      sim.stop();
      expect(sim.isRunning()).toBe(false);
    });

    it("should restart with full alpha", () => {
      const sim = new ForceSimulation({ alpha: 0.5 });
      sim.nodes(createTestNodes(2));

      sim.restart();

      expect(sim.alpha()).toBe(1);
      expect(sim.isRunning()).toBe(true);

      sim.stop();
    });

    it("should not start twice", () => {
      const sim = new ForceSimulation();
      sim.nodes(createTestNodes(2));

      sim.start();
      const result = sim.start(); // Should return this, not start again

      expect(result).toBe(sim);
      sim.stop();
    });
  });

  describe("find", () => {
    it("should find the closest node to a point", () => {
      const sim = new ForceSimulation();
      const nodes: SimulationNode[] = [
        { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
        { id: "b", index: 1, x: 100, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
        { id: "c", index: 2, x: 50, y: 50, vx: 0, vy: 0, mass: 1, radius: 8 },
      ];

      sim.nodes(nodes);

      const closest = sim.find(45, 45);
      expect(closest?.id).toBe("c");
    });

    it("should respect the search radius", () => {
      const sim = new ForceSimulation();
      const nodes: SimulationNode[] = [
        { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
        { id: "b", index: 1, x: 100, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
      ];

      sim.nodes(nodes);

      const found = sim.find(50, 50, 10);
      expect(found).toBeUndefined();

      const foundWithLargerRadius = sim.find(50, 50, 100);
      expect(foundWithLargerRadius).toBeDefined();
    });

    it("should return undefined for empty simulation", () => {
      const sim = new ForceSimulation();
      expect(sim.find(0, 0)).toBeUndefined();
    });
  });
});

// ============================================================
// forceCenter Tests
// ============================================================

describe("forceCenter", () => {
  it("should pull nodes toward the center", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: -100, y: -100, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 100, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const center = forceCenter(0, 0);
    center.initialize!(nodes, Math.random);

    // Center of mass is (0, 0), so no movement should occur
    const initialPositions = nodes.map((n) => ({ x: n.x, y: n.y }));

    center(1);

    // Since center of mass is already at (0,0), positions shouldn't change
    expect(nodes[0].x).toBeCloseTo(initialPositions[0].x);
    expect(nodes[0].y).toBeCloseTo(initialPositions[0].y);
  });

  it("should move nodes when center of mass differs from target", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 100, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 100, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const center = forceCenter(0, 0);
    center.initialize!(nodes, Math.random);

    center(1);

    // Both nodes should move toward (0, 0)
    expect(nodes[0].x).toBeLessThan(100);
    expect(nodes[0].y).toBeLessThan(100);
  });

  it("should have configurable x, y, and strength", () => {
    const center = forceCenter(50, 50);

    expect(center.x()).toBe(50);
    expect(center.y()).toBe(50);

    center.x(100);
    center.y(100);
    center.strength(0.5);

    expect(center.x()).toBe(100);
    expect(center.y()).toBe(100);
    expect(center.strength()).toBe(0.5);
  });

  it("should not move fixed nodes", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 100, y: 100, vx: 0, vy: 0, fx: 100, fy: 100, mass: 1, radius: 8 },
    ];

    const center = forceCenter(0, 0);
    center.initialize!(nodes, Math.random);

    center(1);

    expect(nodes[0].x).toBe(100);
    expect(nodes[0].y).toBe(100);
  });
});

// ============================================================
// forceLink Tests
// ============================================================

describe("forceLink", () => {
  it("should pull connected nodes toward target distance", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 200, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];
    const links: SimulationLink<SimulationNode>[] = [{ source: "a", target: "b" }];

    const link = forceLink(links, { distance: 100 });
    link.initialize!(nodes, Math.random);

    // Current distance is 200, target is 100
    const initialDistance = Math.sqrt(
      Math.pow(nodes[1].x - nodes[0].x, 2) + Math.pow(nodes[1].y - nodes[0].y, 2)
    );
    expect(initialDistance).toBe(200);

    link(1);

    const newDistance = Math.sqrt(
      Math.pow(nodes[1].x - nodes[0].x, 2) + Math.pow(nodes[1].y - nodes[0].y, 2)
    );

    // Nodes should be closer together
    expect(newDistance).toBeLessThan(initialDistance);
  });

  it("should handle multiple iterations", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 200, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];
    const links: SimulationLink<SimulationNode>[] = [{ source: "a", target: "b" }];

    const link = forceLink(links, { distance: 100, iterations: 3 });
    link.initialize!(nodes, Math.random);

    const initialDistance = Math.abs(nodes[1].x - nodes[0].x);
    link(1);
    const afterIterations = Math.abs(nodes[1].x - nodes[0].x);

    // More iterations should result in more convergence
    expect(afterIterations).toBeLessThan(initialDistance);
  });

  it("should support function-based distance", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 200, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];
    const links: SimulationLink<SimulationNode>[] = [{ source: "a", target: "b" }];

    const link = forceLink(links, {
      distance: (_link, _index, _links) => 50,
    });
    link.initialize!(nodes, Math.random);

    link(1);

    // Should try to move toward distance of 50
    expect(Math.abs(nodes[1].x - nodes[0].x)).toBeLessThan(200);
  });

  it("should update links dynamically", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 100, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "c", index: 2, x: 100, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];
    const links: SimulationLink<SimulationNode>[] = [{ source: "a", target: "b" }];

    const link = forceLink(links);
    link.initialize!(nodes, Math.random);

    expect(link.links().length).toBe(1);

    // Add a new link
    link.links([
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ]);

    expect(link.links().length).toBe(2);
  });

  it("should skip links with invalid node references", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];
    const links: SimulationLink<SimulationNode>[] = [
      { source: "a", target: "nonexistent" },
    ];

    const link = forceLink(links);
    link.initialize!(nodes, Math.random);

    // Should not throw
    expect(() => link(1)).not.toThrow();
  });
});

// ============================================================
// forceManyBody Tests
// ============================================================

describe("forceManyBody", () => {
  it("should apply repulsion with negative strength", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 10, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const manyBody = forceManyBody({ strength: -100 });
    manyBody.initialize!(nodes, Math.random);

    manyBody(1);

    // Nodes should have velocities pushing them apart
    // Node A should be pushed left (negative vx)
    // Node B should be pushed right (positive vx)
    expect(nodes[0].vx).toBeLessThan(0);
    expect(nodes[1].vx).toBeGreaterThan(0);
  });

  it("should apply attraction with positive strength", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 100, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const manyBody = forceManyBody({ strength: 100 });
    manyBody.initialize!(nodes, Math.random);

    manyBody(1);

    // Nodes should have velocities pulling them together
    expect(nodes[0].vx).toBeGreaterThan(0);
    expect(nodes[1].vx).toBeLessThan(0);
  });

  it("should have configurable parameters", () => {
    const manyBody = forceManyBody({
      strength: -50,
      distanceMin: 5,
      distanceMax: 500,
      theta: 0.5,
    });

    expect(manyBody.strength()).toBe(-50);
    expect(manyBody.distanceMin()).toBe(5);
    expect(manyBody.distanceMax()).toBe(500);
    expect(manyBody.theta()).toBe(0.5);

    // Test setters
    manyBody.strength(-100);
    manyBody.distanceMin(10);
    manyBody.distanceMax(1000);
    manyBody.theta(0.8);

    expect(manyBody.strength()).toBe(-100);
    expect(manyBody.distanceMin()).toBe(10);
    expect(manyBody.distanceMax()).toBe(1000);
    expect(manyBody.theta()).toBe(0.8);
  });

  it("should not apply force to fixed nodes", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 10, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const manyBody = forceManyBody({ strength: -100 });
    manyBody.initialize!(nodes, Math.random);

    manyBody(1);

    // Fixed node should not have velocity changed
    expect(nodes[0].vx).toBe(0);
    expect(nodes[0].vy).toBe(0);
  });

  it("should handle empty node list", () => {
    const manyBody = forceManyBody();
    manyBody.initialize!([], Math.random);

    expect(() => manyBody(1)).not.toThrow();
  });
});

// ============================================================
// forceCollide Tests
// ============================================================

describe("forceCollide", () => {
  it("should separate overlapping nodes", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 10 },
      { id: "b", index: 1, x: 5, y: 0, vx: 0, vy: 0, mass: 1, radius: 10 },
    ];

    // Nodes overlap (distance 5, but combined radius is 20)
    const collide = forceCollide(10);
    collide.initialize!(nodes, Math.random);

    const initialDistance = Math.abs(nodes[1].x - nodes[0].x);

    collide(1);

    const newDistance = Math.abs(nodes[1].x - nodes[0].x);

    // Nodes should be pushed apart
    expect(newDistance).toBeGreaterThan(initialDistance);
  });

  it("should not affect non-overlapping nodes", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 10 },
      { id: "b", index: 1, x: 100, y: 0, vx: 0, vy: 0, mass: 1, radius: 10 },
    ];

    const collide = forceCollide(10);
    collide.initialize!(nodes, Math.random);

    const initialX0 = nodes[0].x;
    const initialX1 = nodes[1].x;

    collide(1);

    expect(nodes[0].x).toBe(initialX0);
    expect(nodes[1].x).toBe(initialX1);
  });

  it("should support function-based radius", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 5 },
      { id: "b", index: 1, x: 10, y: 0, vx: 0, vy: 0, mass: 1, radius: 15 },
    ];

    const collide = forceCollide((node) => node.radius);
    collide.initialize!(nodes, Math.random);

    // Combined radius is 20, distance is 10, so they overlap
    const initialDistance = Math.abs(nodes[1].x - nodes[0].x);

    collide(1);

    const newDistance = Math.abs(nodes[1].x - nodes[0].x);
    expect(newDistance).toBeGreaterThan(initialDistance);
  });

  it("should have configurable strength and iterations", () => {
    const collide = forceCollide(10, { strength: 0.5, iterations: 3 });

    expect(collide.radius()).toBe(10);
    expect(collide.strength()).toBe(0.5);
    expect(collide.iterations()).toBe(3);
  });
});

// ============================================================
// forceRadial Tests
// ============================================================

describe("forceRadial", () => {
  it("should push nodes toward target radius", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 10, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    // Target radius is 100, node is at distance 10
    const radial = forceRadial(100, 0, 0);
    radial.initialize!(nodes, Math.random);

    radial(1);

    // Node should have positive vx (pushing outward)
    expect(nodes[0].vx).toBeGreaterThan(0);
  });

  it("should pull nodes inward when beyond radius", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 200, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    // Target radius is 100, node is at distance 200
    const radial = forceRadial(100, 0, 0);
    radial.initialize!(nodes, Math.random);

    radial(1);

    // Node should have negative vx (pulling inward)
    expect(nodes[0].vx).toBeLessThan(0);
  });

  it("should have configurable parameters", () => {
    const radial = forceRadial(100, 50, 50, { strength: 0.5 });

    expect(radial.radius()).toBe(100);
    expect(radial.x()).toBe(50);
    expect(radial.y()).toBe(50);
    expect(radial.strength()).toBe(0.5);

    radial.radius(200);
    radial.x(0);
    radial.y(0);
    radial.strength(0.1);

    expect(radial.radius()).toBe(200);
    expect(radial.x()).toBe(0);
    expect(radial.y()).toBe(0);
    expect(radial.strength()).toBe(0.1);
  });
});

// ============================================================
// forceX Tests
// ============================================================

describe("forceX", () => {
  it("should push nodes toward target X", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: -100, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 100, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const fx = forceX(0);
    fx.initialize!(nodes, Math.random);

    fx(1);

    // First node should move right (positive vx)
    expect(nodes[0].vx).toBeGreaterThan(0);
    // Second node should move left (negative vx)
    expect(nodes[1].vx).toBeLessThan(0);
  });

  it("should support function-based target", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: -100, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const fx = forceX((node, index) => index * 50);
    fx.initialize!(nodes, Math.random);

    expect(fx.x()).toBeDefined();
  });

  it("should have configurable strength", () => {
    const fx = forceX(0, { strength: 0.5 });

    expect(fx.strength()).toBe(0.5);

    fx.strength(0.2);
    expect(fx.strength()).toBe(0.2);
  });
});

// ============================================================
// forceY Tests
// ============================================================

describe("forceY", () => {
  it("should push nodes toward target Y", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: -100, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 0, y: 100, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const fy = forceY(0);
    fy.initialize!(nodes, Math.random);

    fy(1);

    // First node should move down (positive vy)
    expect(nodes[0].vy).toBeGreaterThan(0);
    // Second node should move up (negative vy)
    expect(nodes[1].vy).toBeLessThan(0);
  });

  it("should support function-based target", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: 0, y: -100, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const fy = forceY((node, index) => index * 50);
    fy.initialize!(nodes, Math.random);

    expect(fy.y()).toBeDefined();
  });

  it("should have configurable strength", () => {
    const fy = forceY(0, { strength: 0.5 });

    expect(fy.strength()).toBe(0.5);

    fy.strength(0.2);
    expect(fy.strength()).toBe(0.2);
  });
});

// ============================================================
// Integration Tests
// ============================================================

describe("ForceSimulation Integration", () => {
  it("should work with multiple forces combined", () => {
    const nodes = createTestNodes(10);
    const links = createTestLinks(nodes);

    // Store initial positions
    const initialPositions = nodes.map((n) => ({ x: n.x, y: n.y }));

    const simulation = new ForceSimulation()
      .nodes(nodes)
      .force("center", forceCenter(0, 0))
      .force("charge", forceManyBody({ strength: -100 }))
      .force("link", forceLink(links, { distance: 30 }))
      .force("collide", forceCollide(8));

    // Run some ticks
    simulation.tick(50);

    // Nodes should have moved (check positions, not velocities since they decay)
    const hasMovement = simulation.nodes().some((node, i) => {
      const dx = Math.abs(node.x - initialPositions[i].x);
      const dy = Math.abs(node.y - initialPositions[i].y);
      return dx > 0.1 || dy > 0.1;
    });
    expect(hasMovement).toBe(true);
  });

  it("should converge to stable state", () => {
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: -50, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 50, y: 0, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const simulation = new ForceSimulation({ alphaDecay: 0.1 })
      .nodes(nodes)
      .force("link", forceLink([{ source: "a", target: "b" }], { distance: 50 }));

    // Run until alpha decays
    let ticks = 0;
    while (simulation.alpha() > simulation.alphaMin() && ticks < 1000) {
      simulation.tick();
      ticks++;
    }

    // Simulation should have ended
    expect(simulation.alpha()).toBeLessThan(simulation.alphaMin());
  });

  it("should handle dynamic force updates", () => {
    // Create nodes positioned around (0, 0)
    const nodes: SimulationNode[] = [
      { id: "a", index: 0, x: -10, y: -10, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "b", index: 1, x: 10, y: -10, vx: 0, vy: 0, mass: 1, radius: 8 },
      { id: "c", index: 2, x: 0, y: 10, vx: 0, vy: 0, mass: 1, radius: 8 },
    ];

    const simulation = new ForceSimulation()
      .nodes(nodes)
      .force("center", forceCenter(0, 0));

    // Initial center of mass is at (0, 0), so center force has no effect
    simulation.tick(10);

    // Get center of mass after first phase
    let simNodes = simulation.nodes();
    const avgXBefore = simNodes.reduce((sum, n) => sum + n.x, 0) / simNodes.length;
    const avgYBefore = simNodes.reduce((sum, n) => sum + n.y, 0) / simNodes.length;

    // Update center position to (100, 100)
    const center = simulation.force("center") as ReturnType<typeof forceCenter>;
    center.x(100);
    center.y(100);

    // Run more ticks - center force should shift nodes toward (100, 100)
    simulation.tick(50);

    // Get new center of mass
    simNodes = simulation.nodes();
    const avgXAfter = simNodes.reduce((sum, n) => sum + n.x, 0) / simNodes.length;
    const avgYAfter = simNodes.reduce((sum, n) => sum + n.y, 0) / simNodes.length;

    // Center of mass should have moved toward (100, 100)
    expect(avgXAfter).toBeGreaterThan(avgXBefore);
    expect(avgYAfter).toBeGreaterThan(avgYBefore);
  });
});

// ============================================================
// Configurable Force Parameters Tests
// ============================================================

describe("ForceConfiguration Interfaces", () => {
  describe("FORCE_PRESETS", () => {
    it("should have all expected presets", () => {
      const expectedPresets: ForcePresetName[] = ["default", "dense", "sparse", "clustered", "radial"];
      for (const preset of expectedPresets) {
        expect(FORCE_PRESETS[preset]).toBeDefined();
      }
    });

    it("should have valid default preset", () => {
      const preset = FORCE_PRESETS.default;

      expect(preset.center.enabled).toBe(true);
      expect(preset.center.strength).toBe(0.1);
      expect(preset.charge.enabled).toBe(true);
      expect(preset.charge.strength).toBe(-300);
      expect(preset.link.enabled).toBe(true);
      expect(preset.link.distance).toBe(100);
      expect(preset.collision.enabled).toBe(true);
      expect(preset.velocityDecay).toBe(0.4);
    });

    it("should have dense preset with tighter layout", () => {
      const preset = FORCE_PRESETS.dense;

      expect(preset.charge.strength).toBe(-50); // Light repulsion
      expect(preset.link.distance).toBe(30);    // Tight clusters
      expect(preset.link.strength).toBe(1.5);   // Stronger links
    });

    it("should have sparse preset with expanded layout", () => {
      const preset = FORCE_PRESETS.sparse;

      expect(preset.charge.strength).toBe(-800); // Strong repulsion
      expect(preset.link.distance).toBe(200);    // Loose layout
      expect(preset.link.strength).toBe(0.5);    // Weaker links
    });

    it("should have clustered preset emphasizing community structure", () => {
      const preset = FORCE_PRESETS.clustered;

      expect(preset.link.strength).toBe(2);      // Very strong links
      expect(preset.link.iterations).toBe(3);    // More iterations
      expect(preset.charge.distanceMax).toBe(300); // Limited range
    });
  });

  describe("cloneForceConfiguration", () => {
    it("should create a deep copy of configuration", () => {
      const original = FORCE_PRESETS.default;
      const clone = cloneForceConfiguration(original);

      // Check it's equal
      expect(clone.center.strength).toBe(original.center.strength);
      expect(clone.charge.strength).toBe(original.charge.strength);
      expect(clone.link.distance).toBe(original.link.distance);

      // Check it's a different object
      clone.center.strength = 0.5;
      expect(original.center.strength).toBe(0.1); // Original unchanged
    });

    it("should clone all nested properties", () => {
      const original: ForceConfiguration = {
        center: { enabled: true, strength: 0.2, x: 100, y: 200 },
        charge: { enabled: true, strength: -500, distanceMin: 5, distanceMax: 500, theta: 0.8 },
        link: { enabled: true, distance: 50, strength: 1.5, iterations: 2 },
        collision: { enabled: true, radius: 10, strength: 0.9, iterations: 3 },
        velocityDecay: 0.5,
      };

      const clone = cloneForceConfiguration(original);

      expect(clone.center.x).toBe(100);
      expect(clone.center.y).toBe(200);
      expect(clone.charge.distanceMax).toBe(500);
      expect(clone.collision.radius).toBe(10);
    });
  });

  describe("mergeForceConfiguration", () => {
    it("should merge partial config with defaults", () => {
      const partial: Partial<ForceConfiguration> = {
        charge: { enabled: true, strength: -500, distanceMin: 1, distanceMax: Infinity, theta: 0.9 },
      };

      const merged = mergeForceConfiguration(partial);

      // Overridden values
      expect(merged.charge.strength).toBe(-500);

      // Default values preserved
      expect(merged.center.strength).toBe(0.1);
      expect(merged.link.distance).toBe(100);
    });

    it("should use custom base configuration", () => {
      const partial: Partial<ForceConfiguration> = {
        velocityDecay: 0.6,
      };

      const merged = mergeForceConfiguration(partial, FORCE_PRESETS.dense);

      expect(merged.velocityDecay).toBe(0.6);
      expect(merged.charge.strength).toBe(-50); // From dense preset
    });

    it("should handle deeply nested partial overrides", () => {
      const partial: Partial<ForceConfiguration> = {
        center: { enabled: true, strength: 0.3, x: 0, y: 0 },
      };

      const merged = mergeForceConfiguration(partial);

      expect(merged.center.strength).toBe(0.3);
      expect(merged.center.x).toBe(0);
    });
  });

  describe("validateForceConfiguration", () => {
    it("should return empty array for valid configuration", () => {
      const errors = validateForceConfiguration(FORCE_PRESETS.default);
      expect(errors).toHaveLength(0);
    });

    it("should detect invalid center.strength", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.center.strength = 1.5; // Out of range

      const errors = validateForceConfiguration(config);
      expect(errors).toContain("center.strength must be between 0 and 1");
    });

    it("should detect positive charge.strength (attraction instead of repulsion)", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.charge.strength = 100; // Should be negative

      const errors = validateForceConfiguration(config);
      expect(errors).toContain("charge.strength should be negative for repulsion (positive creates attraction)");
    });

    it("should detect invalid charge.theta", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.charge.theta = 3; // Out of range

      const errors = validateForceConfiguration(config);
      expect(errors).toContain("charge.theta should be between 0 and 2");
    });

    it("should detect invalid link.distance", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.link.distance = 5; // Too small

      const errors = validateForceConfiguration(config);
      expect(errors).toContain("link.distance should be between 10 and 500");
    });

    it("should detect invalid collision.strength", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.collision.strength = 1.5; // Out of range

      const errors = validateForceConfiguration(config);
      expect(errors).toContain("collision.strength should be between 0 and 1");
    });

    it("should detect invalid velocityDecay", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.velocityDecay = -0.1; // Out of range

      const errors = validateForceConfiguration(config);
      expect(errors).toContain("velocityDecay should be between 0 and 1");
    });

    it("should allow 'auto' for collision.radius", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.collision.radius = "auto";

      const errors = validateForceConfiguration(config);
      const radiusError = errors.find((e) => e.includes("collision.radius"));
      expect(radiusError).toBeUndefined();
    });

    it("should detect multiple errors", () => {
      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.center.strength = 2;
      config.charge.strength = 100;
      config.link.distance = 1;

      const errors = validateForceConfiguration(config);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("ForceSimulation Configuration Methods", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("applyConfiguration", () => {
    it("should apply a complete configuration", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);
      const links = createTestLinks(nodes);

      sim.nodes(nodes);
      sim.applyConfiguration(FORCE_PRESETS.default, links);

      expect(sim.force("center")).toBeDefined();
      expect(sim.force("charge")).toBeDefined();
      expect(sim.force("link")).toBeDefined();
      expect(sim.force("collision")).toBeDefined();
      expect(sim.velocityDecay()).toBe(0.4);
    });

    it("should disable forces when enabled is false", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      const config: ForceConfiguration = {
        center: { enabled: false, strength: 0.1, x: 0, y: 0 },
        charge: { enabled: false, strength: -300, distanceMin: 1, distanceMax: Infinity, theta: 0.9 },
        link: { enabled: false, distance: 100, strength: 1, iterations: 1 },
        collision: { enabled: false, radius: "auto", strength: 0.7, iterations: 1 },
        velocityDecay: 0.4,
      };

      sim.nodes(nodes);
      sim.applyConfiguration(config);

      expect(sim.force("center")).toBeUndefined();
      expect(sim.force("charge")).toBeUndefined();
      expect(sim.force("link")).toBeUndefined();
      expect(sim.force("collision")).toBeUndefined();
    });

    it("should apply configuration with numeric collision radius", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.collision.radius = 15;

      sim.nodes(nodes);
      sim.applyConfiguration(config);

      const collision = sim.force("collision") as ReturnType<typeof forceCollide>;
      expect(collision).toBeDefined();
      expect(collision.radius()).toBe(15);
    });

    it("should apply configuration with auto collision radius", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      const config = cloneForceConfiguration(FORCE_PRESETS.default);
      config.collision.radius = "auto";

      sim.nodes(nodes);
      sim.applyConfiguration(config);

      const collision = sim.force("collision") as ReturnType<typeof forceCollide>;
      expect(collision).toBeDefined();
      expect(typeof collision.radius()).toBe("function");
    });

    it("should be chainable", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);
      const links = createTestLinks(nodes);

      const result = sim.nodes(nodes).applyConfiguration(FORCE_PRESETS.default, links);

      expect(result).toBe(sim);
    });
  });

  describe("applyPreset", () => {
    it("should apply named presets", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);
      const links = createTestLinks(nodes);

      sim.nodes(nodes);

      // Test each preset
      const presets: ForcePresetName[] = ["default", "dense", "sparse", "clustered", "radial"];
      for (const preset of presets) {
        sim.applyPreset(preset, links);

        expect(sim.velocityDecay()).toBe(FORCE_PRESETS[preset].velocityDecay);
        expect(sim.force("center")).toBeDefined();
      }
    });

    it("should apply dense preset correctly", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);
      const links = createTestLinks(nodes);

      sim.nodes(nodes).applyPreset("dense", links);

      expect(sim.velocityDecay()).toBe(0.5);

      const charge = sim.force("charge") as ReturnType<typeof forceManyBody>;
      expect(charge.strength()).toBe(-50);

      const link = sim.force("link") as ReturnType<typeof forceLink>;
      expect(link.distance()).toBe(30);
    });
  });

  describe("getConfiguration", () => {
    it("should return current configuration", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);
      const links = createTestLinks(nodes);

      sim.nodes(nodes).applyConfiguration(FORCE_PRESETS.default, links);

      const config = sim.getConfiguration();

      expect(config.velocityDecay).toBe(0.4);
      expect(config.center?.enabled).toBe(true);
      expect(config.center?.strength).toBe(0.1);
      expect(config.charge?.enabled).toBe(true);
      expect(config.charge?.strength).toBe(-300);
      expect(config.link?.enabled).toBe(true);
      expect(config.link?.distance).toBe(100);
      expect(config.collision?.enabled).toBe(true);
    });

    it("should return disabled for missing forces", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      // Don't apply any forces

      const config = sim.getConfiguration();

      expect(config.center?.enabled).toBe(false);
      expect(config.charge?.enabled).toBe(false);
      expect(config.link?.enabled).toBe(false);
      expect(config.collision?.enabled).toBe(false);
    });

    it("should detect auto radius for collision", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      sim.force("collision", forceCollide((node) => node.radius));

      const config = sim.getConfiguration();

      expect(config.collision?.radius).toBe("auto");
    });

    it("should detect numeric radius for collision", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      sim.force("collision", forceCollide(12));

      const config = sim.getConfiguration();

      expect(config.collision?.radius).toBe(12);
    });
  });

  describe("updateForceParam", () => {
    it("should update center force parameters", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes).applyPreset("default");

      sim.updateForceParam("center", "strength", 0.5);
      sim.updateForceParam("center", "x", 100);
      sim.updateForceParam("center", "y", 200);

      const center = sim.force("center") as ReturnType<typeof forceCenter>;
      expect(center.strength()).toBe(0.5);
      expect(center.x()).toBe(100);
      expect(center.y()).toBe(200);
    });

    it("should update charge force parameters", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes).applyPreset("default");

      sim.updateForceParam("charge", "strength", -500);
      sim.updateForceParam("charge", "distanceMin", 10);
      sim.updateForceParam("charge", "distanceMax", 500);
      sim.updateForceParam("charge", "theta", 0.5);

      const charge = sim.force("charge") as ReturnType<typeof forceManyBody>;
      expect(charge.strength()).toBe(-500);
      expect(charge.distanceMin()).toBe(10);
      expect(charge.distanceMax()).toBe(500);
      expect(charge.theta()).toBe(0.5);
    });

    it("should update link force parameters", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);
      const links = createTestLinks(nodes);

      sim.nodes(nodes).applyPreset("default", links);

      sim.updateForceParam("link", "distance", 150);
      sim.updateForceParam("link", "strength", 0.8);
      sim.updateForceParam("link", "iterations", 3);

      const link = sim.force("link") as ReturnType<typeof forceLink>;
      expect(link.distance()).toBe(150);
      expect(link.strength()).toBe(0.8);
      expect(link.iterations()).toBe(3);
    });

    it("should update collision force parameters", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes).applyPreset("default");

      sim.updateForceParam("collision", "strength", 0.9);
      sim.updateForceParam("collision", "iterations", 2);
      sim.updateForceParam("collision", "radius", 20);

      const collision = sim.force("collision") as ReturnType<typeof forceCollide>;
      expect(collision.strength()).toBe(0.9);
      expect(collision.iterations()).toBe(2);
      expect(collision.radius()).toBe(20);
    });

    it("should handle missing force gracefully", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      // Don't apply any forces

      // Should not throw
      expect(() => sim.updateForceParam("center", "strength", 0.5)).not.toThrow();
    });

    it("should be chainable", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes).applyPreset("default");

      const result = sim
        .updateForceParam("center", "strength", 0.2)
        .updateForceParam("charge", "strength", -400);

      expect(result).toBe(sim);
    });
  });

  describe("reheat", () => {
    it("should set alpha to specified value", () => {
      const sim = new ForceSimulation({ alpha: 0.1 });
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      sim.reheat(0.5);

      expect(sim.alpha()).toBe(0.5);
    });

    it("should use default alpha of 0.3", () => {
      const sim = new ForceSimulation({ alpha: 0.01 });
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      sim.reheat();

      expect(sim.alpha()).toBe(0.3);
    });

    it("should start simulation if not running", () => {
      const sim = new ForceSimulation({ alpha: 0.1 });
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      expect(sim.isRunning()).toBe(false);

      sim.reheat();

      expect(sim.isRunning()).toBe(true);
      sim.stop();
    });

    it("should clamp alpha to valid range", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);

      sim.reheat(1.5);
      expect(sim.alpha()).toBe(1);

      sim.stop();
      sim.reheat(-0.5);
      expect(sim.alpha()).toBe(sim.alphaMin());

      sim.stop();
    });

    it("should be chainable", () => {
      const sim = new ForceSimulation();
      const nodes = createTestNodes(5);

      sim.nodes(nodes);
      const result = sim.reheat();

      expect(result).toBe(sim);
      sim.stop();
    });
  });
});

describe("Configuration Integration Tests", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should allow real-time configuration updates during simulation", () => {
    const nodes = createTestNodes(10);
    const links = createTestLinks(nodes);

    const sim = new ForceSimulation()
      .nodes(nodes)
      .applyPreset("default", links);

    // Run initial ticks
    sim.tick(10);

    // Update configuration while running
    sim.updateForceParam("charge", "strength", -500);
    sim.updateForceParam("link", "distance", 50);

    // Continue simulation
    sim.tick(10);

    // Verify parameters were updated
    const charge = sim.force("charge") as ReturnType<typeof forceManyBody>;
    expect(charge.strength()).toBe(-500);

    const link = sim.force("link") as ReturnType<typeof forceLink>;
    expect(link.distance()).toBe(50);
  });

  it("should switch presets mid-simulation", () => {
    const nodes = createTestNodes(10);
    const links = createTestLinks(nodes);

    const sim = new ForceSimulation()
      .nodes(nodes)
      .applyPreset("default", links);

    sim.tick(20);

    // Switch to dense preset
    sim.applyPreset("dense", links);
    sim.reheat();

    sim.tick(20);

    // Verify dense preset parameters
    expect(sim.velocityDecay()).toBe(0.5);
    const charge = sim.force("charge") as ReturnType<typeof forceManyBody>;
    expect(charge.strength()).toBe(-50);
  });

  it("should round-trip configuration through get/apply", () => {
    const nodes = createTestNodes(5);
    const links = createTestLinks(nodes);

    const sim1 = new ForceSimulation()
      .nodes(nodes)
      .applyPreset("clustered", links);

    const config = sim1.getConfiguration() as ForceConfiguration;

    const sim2 = new ForceSimulation()
      .nodes(nodes)
      .applyConfiguration(config, links);

    const config2 = sim2.getConfiguration() as ForceConfiguration;

    expect(config2.velocityDecay).toBe(config.velocityDecay);
    expect(config2.center?.strength).toBe(config.center?.strength);
    expect(config2.charge?.strength).toBe(config.charge?.strength);
    expect(config2.link?.distance).toBe(config.link?.distance);
  });
});
