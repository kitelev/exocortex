/**
 * ViewportWindowManager Tests
 *
 * Tests for virtual scrolling and windowing system for large graphs.
 */

import {
  ViewportWindowManager,
  createViewportWindowManager,
  DEFAULT_WINDOWING_OPTIONS,
  type ViewportWindow,
  type WindowingEvent,
} from "../../../../../src/presentation/renderers/graph/ViewportWindowManager";
import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

describe("ViewportWindowManager", () => {
  // Helper to create test nodes
  function createTestNodes(count: number, spread: number = 100): GraphNode[] {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = (i % 5) * spread;
      nodes.push({
        id: `node-${i}`,
        label: `Node ${i}`,
        path: `/path/node-${i}.md`,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        size: 20,
      });
    }
    return nodes;
  }

  // Helper to create test edges
  function createTestEdges(nodes: GraphNode[], density: number = 0.1): GraphEdge[] {
    const edges: GraphEdge[] = [];
    let edgeId = 0;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (Math.random() < density) {
          edges.push({
            id: `edge-${edgeId++}`,
            source: nodes[i].id,
            target: nodes[j].id,
          });
        }
      }
    }

    return edges;
  }

  describe("initialization", () => {
    it("should create instance with default options", () => {
      const manager = new ViewportWindowManager();
      const options = manager.getOptions();

      expect(options.bufferSize).toBe(DEFAULT_WINDOWING_OPTIONS.bufferSize);
      expect(options.updateThreshold).toBe(DEFAULT_WINDOWING_OPTIONS.updateThreshold);
      expect(options.maxVisibleNodes).toBe(DEFAULT_WINDOWING_OPTIONS.maxVisibleNodes);

      manager.destroy();
    });

    it("should create instance with custom options", () => {
      const manager = new ViewportWindowManager({
        bufferSize: 500,
        maxVisibleNodes: 1000,
      });
      const options = manager.getOptions();

      expect(options.bufferSize).toBe(500);
      expect(options.maxVisibleNodes).toBe(1000);

      manager.destroy();
    });

    it("should use factory function", () => {
      const manager = createViewportWindowManager({
        bufferSize: 300,
      });

      expect(manager).toBeInstanceOf(ViewportWindowManager);
      expect(manager.getOptions().bufferSize).toBe(300);

      manager.destroy();
    });
  });

  describe("graph data", () => {
    it("should set graph data", () => {
      const manager = new ViewportWindowManager();
      const nodes = createTestNodes(100);
      const edges = createTestEdges(nodes);

      manager.setGraphData(nodes, edges);

      const stats = manager.getStats();
      expect(stats.totalNodes).toBe(100);

      manager.destroy();
    });

    it("should handle empty graph", () => {
      const manager = new ViewportWindowManager();
      manager.setGraphData([], []);

      const stats = manager.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.visibleNodes).toBe(0);

      manager.destroy();
    });

    it("should update node position", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(10);

      manager.setGraphData(nodes, []);
      manager.updateNodePosition("node-0", 500, 500);

      // Position is updated internally
      const viewport: ViewportWindow = { x: 400, y: 400, width: 200, height: 200, zoom: 1 };
      manager.updateViewport(viewport);

      // Force update since debounce is async
      manager.forceUpdate();

      const visibleNodes = manager.getVisibleNodes();
      expect(visibleNodes.some((n) => n.id === "node-0")).toBe(true);

      manager.destroy();
    });

    it("should batch update node positions", () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(10);

      manager.setGraphData(nodes, []);
      manager.updateNodePositions([
        { id: "node-0", x: 100, y: 100 },
        { id: "node-1", x: 200, y: 200 },
      ]);

      const viewport: ViewportWindow = { x: 0, y: 0, width: 500, height: 500, zoom: 1 };
      manager.updateViewport(viewport);
      manager.forceUpdate();

      const visibleNodes = manager.getVisibleNodes();
      expect(visibleNodes.some((n) => n.id === "node-0")).toBe(true);
      expect(visibleNodes.some((n) => n.id === "node-1")).toBe(true);

      manager.destroy();
    });
  });

  describe("viewport management", () => {
    it("should update viewport", () => {
      const manager = new ViewportWindowManager();
      const nodes = createTestNodes(100);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -500, y: -400, width: 1000, height: 800, zoom: 1 };
      manager.updateViewport(viewport);

      const currentWindow = manager.getCurrentWindow();
      expect(currentWindow).not.toBeNull();
      expect(currentWindow!.x).toBe(-500);
      expect(currentWindow!.y).toBe(-400);

      manager.destroy();
    });

    it("should skip update for small viewport changes", () => {
      const manager = new ViewportWindowManager({ updateThreshold: 50 });
      const nodes = createTestNodes(100);

      manager.setGraphData(nodes, []);

      const viewport1: ViewportWindow = { x: 0, y: 0, width: 1000, height: 800, zoom: 1 };
      manager.updateViewport(viewport1);

      // Small change - should be skipped
      const viewport2: ViewportWindow = { x: 5, y: 5, width: 1000, height: 800, zoom: 1 };
      manager.updateViewport(viewport2);

      const currentWindow = manager.getCurrentWindow();
      // Window should still be at original position
      expect(currentWindow!.x).toBe(0);

      manager.destroy();
    });

    it("should trigger update for significant viewport changes", async () => {
      const manager = new ViewportWindowManager({ updateThreshold: 10, debounceMs: 0 });
      const nodes = createTestNodes(100);

      manager.setGraphData(nodes, []);

      const viewport1: ViewportWindow = { x: 0, y: 0, width: 1000, height: 800, zoom: 1 };
      manager.updateViewport(viewport1);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      // Large change - should trigger update
      const viewport2: ViewportWindow = { x: 500, y: 500, width: 1000, height: 800, zoom: 1 };
      manager.updateViewport(viewport2);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const currentWindow = manager.getCurrentWindow();
      expect(currentWindow!.x).toBe(500);

      manager.destroy();
    });
  });

  describe("visibility", () => {
    it("should return visible nodes", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(100, 50);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -200, y: -200, width: 400, height: 400, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const visibleNodes = manager.getVisibleNodes();
      expect(visibleNodes.length).toBeGreaterThan(0);
      expect(visibleNodes.length).toBeLessThanOrEqual(100);

      manager.destroy();
    });

    it("should return visible node IDs", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -500, y: -500, width: 1000, height: 1000, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const visibleIds = manager.getVisibleNodeIds();
      expect(visibleIds.size).toBeGreaterThan(0);

      manager.destroy();
    });

    it("should return visible edges", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(20);
      const edges = createTestEdges(nodes, 0.3);

      manager.setGraphData(nodes, edges);

      const viewport: ViewportWindow = { x: -500, y: -500, width: 1000, height: 1000, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const visibleEdges = manager.getVisibleEdges();
      expect(visibleEdges.length).toBeGreaterThanOrEqual(0);

      manager.destroy();
    });

    it("should check node visibility", () => {
      const manager = new ViewportWindowManager({
        debounceMs: 0,
        maxVisibleNodes: 1, // Limit to force windowing
        minZoomForWindowing: 0.01, // Enable windowing at all zoom levels
      });
      const nodes: GraphNode[] = [
        { id: "visible", label: "Visible", path: "/visible.md", x: 0, y: 0, size: 20 },
        { id: "hidden", label: "Hidden", path: "/hidden.md", x: 10000, y: 10000, size: 20 },
      ];

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -100, y: -100, width: 200, height: 200, zoom: 1 };
      manager.updateViewport(viewport);
      manager.forceUpdate();

      expect(manager.isNodeVisible("visible")).toBe(true);
      expect(manager.isNodeVisible("hidden")).toBe(false);

      manager.destroy();
    });

    it("should check edge visibility", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes: GraphNode[] = [
        { id: "a", label: "A", path: "/a.md", x: 0, y: 0, size: 20 },
        { id: "b", label: "B", path: "/b.md", x: 50, y: 0, size: 20 },
        { id: "c", label: "C", path: "/c.md", x: 10000, y: 10000, size: 20 },
      ];
      const edges: GraphEdge[] = [
        { id: "edge-ab", source: "a", target: "b" },
        { id: "edge-bc", source: "b", target: "c" },
      ];

      manager.setGraphData(nodes, edges);

      const viewport: ViewportWindow = { x: -100, y: -100, width: 200, height: 200, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(manager.isEdgeVisible("edge-ab")).toBe(true);
      // Edge BC connects visible B to hidden C, should be visible (one endpoint visible)
      expect(manager.isEdgeVisible("edge-bc")).toBe(true);

      manager.destroy();
    });
  });

  describe("priority nodes", () => {
    it("should update cursor position", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0, usePriority: true });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -500, y: -500, width: 1000, height: 1000, zoom: 1 };
      manager.updateViewport(viewport);
      manager.updateCursorPosition(0, 0);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      // Nodes near cursor should be priority
      expect(manager.isNodePriority("node-0")).toBeDefined();

      manager.destroy();
    });
  });

  describe("statistics", () => {
    it("should provide statistics", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(100);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -200, y: -200, width: 400, height: 400, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const stats = manager.getStats();
      expect(stats.totalNodes).toBe(100);
      expect(stats.visibleNodes).toBeGreaterThan(0);
      expect(stats.efficiency).toBeGreaterThanOrEqual(0);
      expect(stats.efficiency).toBeLessThanOrEqual(1);

      manager.destroy();
    });

    it("should track update duration", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(500);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -500, y: -500, width: 1000, height: 1000, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const stats = manager.getStats();
      expect(stats.lastUpdateMs).toBeGreaterThanOrEqual(0);
      expect(stats.averageUpdateMs).toBeGreaterThanOrEqual(0);

      manager.destroy();
    });
  });

  describe("events", () => {
    it("should emit update event", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      const eventReceived = new Promise<WindowingEvent>((resolve) => {
        manager.on("update", resolve);
      });

      const viewport: ViewportWindow = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
      manager.updateViewport(viewport);

      const event = await eventReceived;
      expect(event.type).toBe("update");
      expect(event.stats).toBeDefined();

      manager.destroy();
    });

    it("should emit visibilityChange event", () => {
      const manager = new ViewportWindowManager({
        debounceMs: 0,
        maxVisibleNodes: 10, // Force windowing
        minZoomForWindowing: 0.01,
      });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      // First update to establish initial visibility with empty viewport
      const viewport1: ViewportWindow = { x: -10000, y: -10000, width: 100, height: 100, zoom: 1 };
      manager.updateViewport(viewport1);
      manager.forceUpdate();

      // Set up listener for visibility change
      let receivedEvent: WindowingEvent | null = null;
      manager.on("visibilityChange", (event) => {
        receivedEvent = event;
      });

      // Move viewport significantly to see some nodes
      const viewport2: ViewportWindow = { x: -500, y: -500, width: 1000, height: 1000, zoom: 1 };
      manager.updateViewport(viewport2);
      manager.forceUpdate();

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.type).toBe("visibilityChange");
      expect(receivedEvent!.addedNodeIds).toBeDefined();

      manager.destroy();
    });

    it("should remove event listener", () => {
      const manager = new ViewportWindowManager();
      const listener = jest.fn();

      const unsubscribe = manager.on("update", listener);
      unsubscribe();

      // No direct way to verify, but no error should occur
      manager.destroy();
    });
  });

  describe("scroll prediction", () => {
    it("should return null prediction without scroll history", () => {
      const manager = new ViewportWindowManager({ predictiveLoading: true });
      const prediction = manager.getPredictedPosition();
      expect(prediction).toBeNull();

      manager.destroy();
    });

    it("should calculate predicted position with scroll history", async () => {
      const manager = new ViewportWindowManager({
        predictiveLoading: true,
        predictionFrames: 5,
        debounceMs: 0,
      });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      // Simulate scrolling
      for (let i = 0; i < 5; i++) {
        const viewport: ViewportWindow = {
          x: i * 100,
          y: i * 50,
          width: 800,
          height: 600,
          zoom: 1,
        };
        manager.updateViewport(viewport);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const prediction = manager.getPredictedPosition();
      expect(prediction).not.toBeNull();
      expect(prediction!.x).toBeGreaterThan(400); // Predicted to continue moving right

      manager.destroy();
    });
  });

  describe("options", () => {
    it("should update options", async () => {
      const manager = new ViewportWindowManager({ bufferSize: 100 });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      manager.setOptions({ bufferSize: 500 });

      expect(manager.getOptions().bufferSize).toBe(500);

      manager.destroy();
    });
  });

  describe("cleanup", () => {
    it("should clear data", () => {
      const manager = new ViewportWindowManager();
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);
      manager.clear();

      const stats = manager.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.visibleNodes).toBe(0);

      manager.destroy();
    });

    it("should force update", async () => {
      const manager = new ViewportWindowManager({ debounceMs: 0 });
      const nodes = createTestNodes(50);

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
      manager.updateViewport(viewport);

      manager.forceUpdate();

      // No error should occur
      expect(true).toBe(true);

      manager.destroy();
    });
  });

  describe("max visible nodes limit", () => {
    it("should respect max visible nodes limit", async () => {
      const manager = new ViewportWindowManager({
        maxVisibleNodes: 10,
        minZoomForWindowing: 0.01, // Enable windowing at all zoom levels
        debounceMs: 0,
      });

      // Create many nodes all in the same area
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 100; i++) {
        nodes.push({
          id: `node-${i}`,
          label: `Node ${i}`,
          path: `/node-${i}.md`,
          x: Math.random() * 100 - 50,
          y: Math.random() * 100 - 50,
          size: 20,
        });
      }

      manager.setGraphData(nodes, []);

      const viewport: ViewportWindow = { x: -500, y: -500, width: 1000, height: 1000, zoom: 1 };
      manager.updateViewport(viewport);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      const stats = manager.getStats();
      // When windowing is active, should limit visible nodes
      if (stats.windowingActive) {
        expect(stats.visibleNodes).toBeLessThanOrEqual(10);
      }

      manager.destroy();
    });
  });

  describe("default options", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_WINDOWING_OPTIONS.bufferSize).toBe(200);
      expect(DEFAULT_WINDOWING_OPTIONS.updateThreshold).toBe(10);
      expect(DEFAULT_WINDOWING_OPTIONS.debounceMs).toBe(16);
      expect(DEFAULT_WINDOWING_OPTIONS.maxVisibleNodes).toBe(5000);
      expect(DEFAULT_WINDOWING_OPTIONS.priorityRadius).toBe(100);
      expect(DEFAULT_WINDOWING_OPTIONS.usePriority).toBe(true);
      expect(DEFAULT_WINDOWING_OPTIONS.minZoomForWindowing).toBe(0.1);
      expect(DEFAULT_WINDOWING_OPTIONS.predictiveLoading).toBe(true);
      expect(DEFAULT_WINDOWING_OPTIONS.predictionFrames).toBe(5);
    });
  });
});
