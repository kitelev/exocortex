/**
 * LayoutManager Tests
 *
 * Tests for the layout manager with transitions between different
 * graph layout algorithms.
 */

import {
  LayoutManager,
  createLayoutManager,
  getEasingFunction,
  interpolatePoint,
  EASING_FUNCTIONS,
  DEFAULT_TRANSITION_OPTIONS,
  DEFAULT_LAYOUT_MANAGER_CONFIG,
  type LayoutAlgorithm,
  type LayoutResult,
  type LayoutManagerEvent,
  type Point,
} from "../../../../../src/presentation/renderers/graph/LayoutManager";
import type { GraphData } from "../../../../../src/presentation/renderers/graph/types";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create a simple test graph
 */
function createTestGraph(nodeCount: number = 5): GraphData {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node-${i}`,
      label: `Node ${i}`,
      path: `/path/to/node-${i}.md`,
    });
  }

  const edges = [];
  for (let i = 1; i < nodeCount; i++) {
    edges.push({
      id: `edge-${i - 1}-${i}`,
      source: `node-${i - 1}`,
      target: `node-${i}`,
    });
  }

  return { nodes, edges };
}

/**
 * Wait for specified milliseconds
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock requestAnimationFrame for testing
 */
function mockRAF(): {
  advance: (frames: number) => void;
  restore: () => void;
} {
  const originalRAF = global.requestAnimationFrame;
  const originalCAF = global.cancelAnimationFrame;

  let frameId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let currentTime = 0;

  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const id = ++frameId;
    callbacks.set(id, callback);
    return id;
  };

  global.cancelAnimationFrame = (id: number): void => {
    callbacks.delete(id);
  };

  return {
    advance: (frames: number) => {
      for (let i = 0; i < frames; i++) {
        currentTime += 16.67; // ~60fps
        const callbacksToRun = Array.from(callbacks.entries());
        callbacks.clear();
        for (const [, callback] of callbacksToRun) {
          callback(currentTime);
        }
      }
    },
    restore: () => {
      global.requestAnimationFrame = originalRAF;
      global.cancelAnimationFrame = originalCAF;
    },
  };
}

// ============================================================
// Easing Functions Tests
// ============================================================

describe("EASING_FUNCTIONS", () => {
  describe("linear", () => {
    it("should return input unchanged", () => {
      expect(EASING_FUNCTIONS.linear(0)).toBe(0);
      expect(EASING_FUNCTIONS.linear(0.5)).toBe(0.5);
      expect(EASING_FUNCTIONS.linear(1)).toBe(1);
    });
  });

  describe("easeIn", () => {
    it("should accelerate from zero", () => {
      expect(EASING_FUNCTIONS.easeIn(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeIn(0.5)).toBe(0.25);
      expect(EASING_FUNCTIONS.easeIn(1)).toBe(1);
    });
  });

  describe("easeOut", () => {
    it("should decelerate to zero", () => {
      expect(EASING_FUNCTIONS.easeOut(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeOut(0.5)).toBe(0.75);
      expect(EASING_FUNCTIONS.easeOut(1)).toBe(1);
    });
  });

  describe("easeInOut", () => {
    it("should accelerate then decelerate", () => {
      expect(EASING_FUNCTIONS.easeInOut(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeInOut(0.5)).toBe(0.5);
      expect(EASING_FUNCTIONS.easeInOut(1)).toBe(1);

      // First half accelerates
      expect(EASING_FUNCTIONS.easeInOut(0.25)).toBeLessThan(0.25);
      // Second half decelerates
      expect(EASING_FUNCTIONS.easeInOut(0.75)).toBeGreaterThan(0.75);
    });
  });

  describe("easeInCubic", () => {
    it("should have cubic acceleration", () => {
      expect(EASING_FUNCTIONS.easeInCubic(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeInCubic(0.5)).toBe(0.125);
      expect(EASING_FUNCTIONS.easeInCubic(1)).toBe(1);
    });
  });

  describe("easeOutCubic", () => {
    it("should have cubic deceleration", () => {
      expect(EASING_FUNCTIONS.easeOutCubic(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeOutCubic(0.5)).toBe(0.875);
      expect(EASING_FUNCTIONS.easeOutCubic(1)).toBe(1);
    });
  });

  describe("easeInOutCubic", () => {
    it("should have smooth S-curve", () => {
      expect(EASING_FUNCTIONS.easeInOutCubic(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeInOutCubic(0.5)).toBe(0.5);
      expect(EASING_FUNCTIONS.easeInOutCubic(1)).toBe(1);
    });
  });

  describe("easeOutElastic", () => {
    it("should overshoot then settle", () => {
      expect(EASING_FUNCTIONS.easeOutElastic(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeOutElastic(1)).toBe(1);

      // Should overshoot
      const mid = EASING_FUNCTIONS.easeOutElastic(0.3);
      expect(mid).toBeGreaterThan(0.3);
    });
  });

  describe("easeOutBounce", () => {
    it("should bounce at the end", () => {
      expect(EASING_FUNCTIONS.easeOutBounce(0)).toBe(0);
      expect(EASING_FUNCTIONS.easeOutBounce(1)).toBeCloseTo(1, 5);

      // Multiple bounces create varying values
      const v1 = EASING_FUNCTIONS.easeOutBounce(0.5);
      const v2 = EASING_FUNCTIONS.easeOutBounce(0.7);
      expect(v1).toBeLessThan(v2);
    });
  });

  describe("spring", () => {
    it("should have spring-like motion", () => {
      expect(EASING_FUNCTIONS.spring(0)).toBe(0);
      expect(EASING_FUNCTIONS.spring(1)).toBe(1);

      // Should oscillate
      const mid = EASING_FUNCTIONS.spring(0.3);
      expect(mid).toBeGreaterThan(0.3);
    });
  });
});

describe("getEasingFunction", () => {
  it("should return the correct easing function", () => {
    expect(getEasingFunction("linear")).toBe(EASING_FUNCTIONS.linear);
    expect(getEasingFunction("easeInOutCubic")).toBe(EASING_FUNCTIONS.easeInOutCubic);
  });
});

describe("interpolatePoint", () => {
  it("should interpolate between two points", () => {
    const start: Point = { x: 0, y: 0 };
    const end: Point = { x: 100, y: 200 };

    expect(interpolatePoint(start, end, 0)).toEqual({ x: 0, y: 0 });
    expect(interpolatePoint(start, end, 0.5)).toEqual({ x: 50, y: 100 });
    expect(interpolatePoint(start, end, 1)).toEqual({ x: 100, y: 200 });
  });

  it("should handle negative coordinates", () => {
    const start: Point = { x: -50, y: 100 };
    const end: Point = { x: 50, y: -100 };

    expect(interpolatePoint(start, end, 0.5)).toEqual({ x: 0, y: 0 });
  });
});

// ============================================================
// LayoutManager Tests
// ============================================================

describe("LayoutManager", () => {
  describe("constructor", () => {
    it("should create with default config", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      expect(manager.getCurrentLayout()).toBe("force");
      expect(manager.isTransitioning()).toBe(false);
      expect(manager.getTransitionProgress()).toBe(0);
    });

    it("should create with custom config", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph, {
        defaultLayout: "grid",
        autoLayout: false,
      });

      expect(manager.getCurrentLayout()).toBe("grid");
    });

    it("should auto-layout on creation", () => {
      const graph = createTestGraph(5);
      const manager = new LayoutManager(graph, { autoLayout: true });

      const positions = manager.getPositions();
      expect(positions.size).toBe(5);
    });

    it("should not auto-layout when disabled", () => {
      const graph = createTestGraph(5);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const positions = manager.getPositions();
      expect(positions.size).toBe(0);
    });
  });

  describe("getRegisteredLayouts", () => {
    it("should return built-in layouts", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const layouts = manager.getRegisteredLayouts();
      expect(layouts).toContain("force");
      expect(layouts).toContain("hierarchical");
      expect(layouts).toContain("radial");
      expect(layouts).toContain("circular");
      expect(layouts).toContain("grid");
    });
  });

  describe("registerLayout", () => {
    it("should register custom layout", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const customLayout: LayoutAlgorithm = {
        name: "temporal" as const,
        layout: (g: GraphData): LayoutResult => {
          const positions = new Map<string, Point>();
          g.nodes.forEach((node, i) => {
            positions.set(node.id, { x: i * 100, y: 0 });
          });
          return {
            positions,
            bounds: { minX: 0, minY: 0, maxX: 400, maxY: 0, width: 400, height: 0 },
          };
        },
      };

      manager.registerLayout(customLayout);
      expect(manager.getRegisteredLayouts()).toContain("temporal");
    });
  });

  describe("applyLayout", () => {
    it("should apply layout immediately", () => {
      const graph = createTestGraph(5);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const result = manager.applyLayout("grid");

      expect(result.positions.size).toBe(5);
      expect(manager.getCurrentLayout()).toBe("grid");
      expect(manager.isTransitioning()).toBe(false);
    });

    it("should throw for unknown layout", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      expect(() => {
        manager.applyLayout("unknown" as any);
      }).toThrow('Layout "unknown" is not registered');
    });

    it("should emit layoutChange event", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const events: LayoutManagerEvent[] = [];
      manager.on("layoutChange", (e) => events.push(e));

      manager.applyLayout("circular");

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("layoutChange");
      expect(events[0].previousLayout).toBe("force");
      expect(events[0].currentLayout).toBe("circular");
    });
  });

  describe("getNodePosition", () => {
    it("should return position for existing node", () => {
      const graph = createTestGraph(3);
      const manager = new LayoutManager(graph);

      const pos = manager.getNodePosition("node-0");
      expect(pos).toBeDefined();
      expect(typeof pos!.x).toBe("number");
      expect(typeof pos!.y).toBe("number");
    });

    it("should return undefined for non-existent node", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const pos = manager.getNodePosition("non-existent");
      expect(pos).toBeUndefined();
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const state = manager.getState();
      expect(state.currentLayout).toBe("force");
      expect(state.isTransitioning).toBe(false);
      expect(state.transitionProgress).toBe(0);
      expect(state.currentPositions).toBeInstanceOf(Map);
    });

    it("should return a copy of positions", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const state = manager.getState();
      state.currentPositions.clear();

      // Original should be unchanged
      expect(manager.getPositions().size).toBeGreaterThan(0);
    });
  });

  describe("updateGraphData", () => {
    it("should update graph and re-apply layout", () => {
      const graph1 = createTestGraph(3);
      const manager = new LayoutManager(graph1);

      expect(manager.getPositions().size).toBe(3);

      const graph2 = createTestGraph(5);
      manager.updateGraphData(graph2);

      expect(manager.getPositions().size).toBe(5);
    });

    it("should not re-apply layout when disabled", () => {
      const graph1 = createTestGraph(3);
      const manager = new LayoutManager(graph1, { autoLayout: false });
      manager.applyLayout("grid");

      expect(manager.getPositions().size).toBe(3);

      const graph2 = createTestGraph(5);
      manager.updateGraphData(graph2, false);

      // Positions unchanged
      expect(manager.getPositions().size).toBe(3);
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const events: LayoutManagerEvent[] = [];
      const listener = (e: LayoutManagerEvent) => events.push(e);

      manager.on("layoutChange", listener);
      manager.applyLayout("grid");
      expect(events.length).toBe(1);

      manager.off("layoutChange", listener);
      manager.applyLayout("circular");
      expect(events.length).toBe(1); // No new events
    });

    it("should handle errors in listeners gracefully", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const errorSpy = jest.spyOn(console, "error").mockImplementation();

      manager.on("layoutChange", () => {
        throw new Error("Test error");
      });

      // Should not throw
      expect(() => manager.applyLayout("grid")).not.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      manager.destroy();

      expect(manager.getPositions().size).toBe(0);
      expect(manager.getRegisteredLayouts().length).toBe(0);
    });
  });
});

// ============================================================
// Layout Algorithm Tests
// ============================================================

describe("Built-in Layouts", () => {
  describe("force layout", () => {
    it("should arrange nodes in a circle initially", () => {
      const graph = createTestGraph(4);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const result = manager.applyLayout("force");

      expect(result.positions.size).toBe(4);

      // Nodes should be roughly equidistant from center
      const positions = Array.from(result.positions.values());
      const distances = positions.map((p) => Math.sqrt(p.x * p.x + p.y * p.y));
      const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;

      for (const d of distances) {
        expect(Math.abs(d - avgDistance)).toBeLessThan(1); // All same distance
      }
    });
  });

  describe("hierarchical layout", () => {
    it("should compute hierarchical positions", () => {
      const graph = createTestGraph(5);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const result = manager.applyLayout("hierarchical");

      expect(result.positions.size).toBe(5);
    });
  });

  describe("radial layout", () => {
    it("should compute radial positions", () => {
      const graph = createTestGraph(5);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const result = manager.applyLayout("radial");

      expect(result.positions.size).toBe(5);
    });
  });

  describe("circular layout", () => {
    it("should arrange nodes in a circle", () => {
      const graph = createTestGraph(8);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const result = manager.applyLayout("circular");

      expect(result.positions.size).toBe(8);

      // All nodes should be at the same radius
      const positions = Array.from(result.positions.values());
      const distances = positions.map((p) => Math.sqrt(p.x * p.x + p.y * p.y));
      const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;

      for (const d of distances) {
        expect(Math.abs(d - avgDistance)).toBeLessThan(0.1);
      }
    });
  });

  describe("grid layout", () => {
    it("should arrange nodes in a grid", () => {
      const graph = createTestGraph(9);
      const manager = new LayoutManager(graph, { autoLayout: false });

      const result = manager.applyLayout("grid");

      expect(result.positions.size).toBe(9);

      // Check grid structure
      const positions = Array.from(result.positions.values());
      const xValues = new Set(positions.map((p) => p.x));
      const yValues = new Set(positions.map((p) => p.y));

      // 9 nodes should form 3x3 grid
      expect(xValues.size).toBe(3);
      expect(yValues.size).toBe(3);
    });
  });
});

// ============================================================
// Transition Tests (with mocked RAF)
// ============================================================

describe("Layout Transitions", () => {
  let rafMock: ReturnType<typeof mockRAF>;

  beforeEach(() => {
    rafMock = mockRAF();
    jest.useFakeTimers();
  });

  afterEach(() => {
    rafMock.restore();
    jest.useRealTimers();
  });

  describe("switchLayout", () => {
    it("should throw for unknown layout", async () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      await expect(manager.switchLayout("unknown" as any)).rejects.toThrow(
        'Layout "unknown" is not registered'
      );
    });

    it("should do nothing when switching to same layout", async () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      const events: LayoutManagerEvent[] = [];
      manager.on("transitionStart", (e) => events.push(e));

      await manager.switchLayout("force");

      expect(events.length).toBe(0);
    });
  });

  describe("interruptTransition", () => {
    it("should not throw when no transition active", () => {
      const graph = createTestGraph();
      const manager = new LayoutManager(graph);

      expect(() => manager.interruptTransition()).not.toThrow();
    });
  });
});

// ============================================================
// Default Values Tests
// ============================================================

describe("Default Values", () => {
  it("DEFAULT_TRANSITION_OPTIONS should have correct defaults", () => {
    expect(DEFAULT_TRANSITION_OPTIONS.duration).toBe(500);
    expect(DEFAULT_TRANSITION_OPTIONS.easing).toBe("easeInOutCubic");
    expect(DEFAULT_TRANSITION_OPTIONS.staggerDelay).toBe(0);
    expect(DEFAULT_TRANSITION_OPTIONS.maxStaggerTime).toBe(200);
    expect(DEFAULT_TRANSITION_OPTIONS.preserveViewport).toBe(true);
  });

  it("DEFAULT_LAYOUT_MANAGER_CONFIG should have correct defaults", () => {
    expect(DEFAULT_LAYOUT_MANAGER_CONFIG.autoLayout).toBe(true);
    expect(DEFAULT_LAYOUT_MANAGER_CONFIG.defaultLayout).toBe("force");
    expect(DEFAULT_LAYOUT_MANAGER_CONFIG.defaultTransitionOptions).toBe(DEFAULT_TRANSITION_OPTIONS);
  });
});

// ============================================================
// Factory Function Tests
// ============================================================

describe("createLayoutManager", () => {
  it("should create manager with defaults", () => {
    const graph = createTestGraph();
    const manager = createLayoutManager(graph);

    expect(manager).toBeInstanceOf(LayoutManager);
    expect(manager.getCurrentLayout()).toBe("force");
  });

  it("should create manager with custom config", () => {
    const graph = createTestGraph();
    const manager = createLayoutManager(graph, { defaultLayout: "grid" });

    expect(manager.getCurrentLayout()).toBe("grid");
  });
});

// ============================================================
// Edge Cases Tests
// ============================================================

describe("Edge Cases", () => {
  it("should handle empty graph", () => {
    const graph: GraphData = { nodes: [], edges: [] };
    const manager = new LayoutManager(graph);

    expect(manager.getPositions().size).toBe(0);

    const result = manager.applyLayout("grid");
    expect(result.positions.size).toBe(0);
    expect(result.bounds.width).toBe(0);
    expect(result.bounds.height).toBe(0);
  });

  it("should handle single node graph", () => {
    const graph: GraphData = {
      nodes: [{ id: "single", label: "Single", path: "/single.md" }],
      edges: [],
    };
    const manager = new LayoutManager(graph);

    const positions = manager.getPositions();
    expect(positions.size).toBe(1);
    expect(positions.has("single")).toBe(true);
  });

  it("should handle disconnected nodes", () => {
    const graph: GraphData = {
      nodes: [
        { id: "a", label: "A", path: "/a.md" },
        { id: "b", label: "B", path: "/b.md" },
        { id: "c", label: "C", path: "/c.md" },
      ],
      edges: [],
    };
    const manager = new LayoutManager(graph);

    const positions = manager.getPositions();
    expect(positions.size).toBe(3);

    // All nodes should have positions
    expect(positions.has("a")).toBe(true);
    expect(positions.has("b")).toBe(true);
    expect(positions.has("c")).toBe(true);
  });
});
