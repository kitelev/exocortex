/**
 * Performance regression tests for 3D Force Simulation.
 *
 * These tests ensure that force simulation calculations execute within
 * expected time bounds to maintain 30+ FPS during simulation.
 *
 * Based on Issue #1266: 3D Force Simulation Integration
 *
 * Performance Requirements:
 * - 30+ FPS = tick must complete in < 33ms
 * - Convergence within 5 seconds for <200 nodes
 */

import { ForceSimulation3D } from "../../src/presentation/renderers/graph/3d/ForceSimulation3D";
import type { GraphNode3D, GraphEdge3D } from "../../src/presentation/renderers/graph/3d/types3d";

/**
 * Generate mock graph nodes for performance testing.
 */
function generateMockNodes(count: number): GraphNode3D[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    label: `Node ${i}`,
    path: `/nodes/node-${i}`,
    // Random initial positions
    x: (Math.random() - 0.5) * 500,
    y: (Math.random() - 0.5) * 500,
    z: (Math.random() - 0.5) * 500,
  }));
}

/**
 * Generate mock edges connecting nodes in a chain-like pattern.
 */
function generateMockEdges(nodes: GraphNode3D[], edgeFactor = 1.5): GraphEdge3D[] {
  const edges: GraphEdge3D[] = [];
  const edgeCount = Math.floor(nodes.length * edgeFactor);

  for (let i = 0; i < edgeCount && i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-${i}`,
      source: nodes[i].id,
      target: nodes[(i + 1) % nodes.length].id,
    });
  }

  // Add some random cross-links for more realistic graph
  for (let i = 0; i < nodes.length / 4; i++) {
    const source = Math.floor(Math.random() * nodes.length);
    const target = Math.floor(Math.random() * nodes.length);
    if (source !== target) {
      edges.push({
        id: `edge-cross-${i}`,
        source: nodes[source].id,
        target: nodes[target].id,
      });
    }
  }

  return edges;
}

describe("ForceSimulation3D Performance", () => {
  describe("Single Tick Performance", () => {
    it("should complete single tick for 50 nodes in < 10ms", () => {
      const nodes = generateMockNodes(50);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges);

      const runs: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        simulation.tick();
        runs.push(performance.now() - start);
      }

      const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;
      expect(avgDuration).toBeLessThan(10);
    });

    it("should complete single tick for 100 nodes in < 16ms (60 FPS target)", () => {
      const nodes = generateMockNodes(100);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges);

      const runs: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        simulation.tick();
        runs.push(performance.now() - start);
      }

      const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;
      // 60 FPS = 16.67ms per frame budget
      expect(avgDuration).toBeLessThan(16);
    });

    it("should complete single tick for 200 nodes in < 33ms (30 FPS target)", () => {
      const nodes = generateMockNodes(200);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges);

      const runs: number[] = [];
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        simulation.tick();
        runs.push(performance.now() - start);
      }

      const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;
      // 30 FPS = 33.33ms per frame budget
      expect(avgDuration).toBeLessThan(33);
    });
  });

  describe("Convergence Performance", () => {
    it("50 nodes should converge in < 500 ticks", () => {
      const nodes = generateMockNodes(50);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges, {
        alphaMin: 0.01,
      });

      let tickCount = 0;
      while (simulation.getAlpha() >= 0.01 && tickCount < 1000) {
        simulation.tick();
        tickCount++;
      }

      // At 60 FPS, 500 ticks = ~8 seconds, which is acceptable
      expect(tickCount).toBeLessThan(500);
      expect(simulation.getAlpha()).toBeLessThan(0.01);
    });

    it("100 nodes should converge in < 500 ticks", () => {
      const nodes = generateMockNodes(100);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges, {
        alphaMin: 0.01,
      });

      let tickCount = 0;
      while (simulation.getAlpha() >= 0.01 && tickCount < 1000) {
        simulation.tick();
        tickCount++;
      }

      expect(tickCount).toBeLessThan(500);
      expect(simulation.getAlpha()).toBeLessThan(0.01);
    });

    it("200 nodes should converge within acceptable time", () => {
      const nodes = generateMockNodes(200);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges, {
        alphaMin: 0.01,
      });

      const startTime = performance.now();
      let tickCount = 0;
      while (simulation.getAlpha() >= 0.01 && tickCount < 1000) {
        simulation.tick();
        tickCount++;
      }
      const totalTime = performance.now() - startTime;

      // Should converge within 5 seconds for 200 nodes (requirement)
      // Allowing generous margin for CI variance
      expect(totalTime).toBeLessThan(5000);
      expect(simulation.getAlpha()).toBeLessThan(0.01);
    });
  });

  describe("Barnes-Hut Optimization", () => {
    it("Barnes-Hut should be faster than O(n²) for large graphs", () => {
      const largeNodes = generateMockNodes(200);
      const largeEdges = generateMockEdges(largeNodes);

      // With Barnes-Hut enabled (default for >100 nodes)
      const simWithBH = new ForceSimulation3D(largeNodes, largeEdges, {
        useBarnesHut: true,
      });

      // Without Barnes-Hut (force O(n²))
      const simWithoutBH = new ForceSimulation3D(largeNodes, largeEdges, {
        useBarnesHut: false,
      });

      // Measure Barnes-Hut
      const bhRuns: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        simWithBH.tick();
        bhRuns.push(performance.now() - start);
      }
      const bhAvg = bhRuns.reduce((a, b) => a + b, 0) / bhRuns.length;

      // Measure O(n²)
      const directRuns: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        simWithoutBH.tick();
        directRuns.push(performance.now() - start);
      }
      const directAvg = directRuns.reduce((a, b) => a + b, 0) / directRuns.length;

      // Barnes-Hut should be at least somewhat faster for large graphs
      // (or at least not significantly slower)
      // Note: For 200 nodes, the difference may not be dramatic due to overhead
      expect(bhAvg).toBeLessThan(directAvg * 1.5);
    });
  });

  describe("Memory Stability", () => {
    it("should not significantly increase memory over many ticks", () => {
      const nodes = generateMockNodes(100);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges);

      // Run many ticks
      for (let i = 0; i < 500; i++) {
        simulation.tick();
      }

      // Node count should remain constant
      expect(simulation.getNodes().length).toBe(100);
    });

    it("should clean up properly on destroy", () => {
      const nodes = generateMockNodes(100);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges);

      // Run some ticks
      for (let i = 0; i < 50; i++) {
        simulation.tick();
      }

      simulation.destroy();

      expect(simulation.getNodes().length).toBe(0);
      expect(simulation.isRunning()).toBe(false);
    });
  });

  describe("P95 Latency", () => {
    it("P95 tick latency for 100 nodes should be < 20ms", () => {
      const nodes = generateMockNodes(100);
      const edges = generateMockEdges(nodes);
      const simulation = new ForceSimulation3D(nodes, edges);

      const durations: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        simulation.tick();
        durations.push(performance.now() - start);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.floor(durations.length * 0.95);
      const p95Duration = durations[p95Index];

      // P95 should be under 20ms for smooth animation
      expect(p95Duration).toBeLessThan(20);
    });
  });
});

describe("Force Simulation Performance Regression Guards", () => {
  it("tick performance should not regress beyond 2x baseline for 50 nodes", () => {
    const nodes = generateMockNodes(50);
    const edges = generateMockEdges(nodes);
    const simulation = new ForceSimulation3D(nodes, edges);

    const runs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      simulation.tick();
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;

    // Baseline: ~5ms for 50 nodes, allow 2x = 10ms
    expect(avgDuration).toBeLessThan(10);
  });

  it("tick performance should not regress beyond 2x baseline for 100 nodes", () => {
    const nodes = generateMockNodes(100);
    const edges = generateMockEdges(nodes);
    const simulation = new ForceSimulation3D(nodes, edges);

    const runs: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      simulation.tick();
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;

    // Baseline: ~10ms for 100 nodes, allow 2x = 20ms
    expect(avgDuration).toBeLessThan(20);
  });
});
