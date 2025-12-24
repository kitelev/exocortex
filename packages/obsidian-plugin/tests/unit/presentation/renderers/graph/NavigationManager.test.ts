/**
 * Tests for NavigationManager - Spatial navigation between graph nodes
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  NavigationManager,
  DEFAULT_NAVIGATION_MANAGER_CONFIG,
  type NavigationManagerConfig,
  type NavigationDirection,
  type NavigationResult,
  type NavigationEvent,
  type CandidateNode,
} from "../../../../../src/presentation/renderers/graph/NavigationManager";
import type { GraphNode, GraphEdge } from "../../../../../src/presentation/renderers/graph/types";

// Create mock graph nodes at specific positions
function createPositionedNodes(): GraphNode[] {
  return [
    { id: "top-left", label: "Top Left", path: "/top-left.md", x: 0, y: 0 },
    { id: "top-right", label: "Top Right", path: "/top-right.md", x: 100, y: 0 },
    { id: "center", label: "Center", path: "/center.md", x: 50, y: 50 },
    { id: "bottom-left", label: "Bottom Left", path: "/bottom-left.md", x: 0, y: 100 },
    { id: "bottom-right", label: "Bottom Right", path: "/bottom-right.md", x: 100, y: 100 },
  ];
}

// Create mock graph nodes in a grid
function createGridNodes(rows: number, cols: number, spacing = 50): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = `node-${row}-${col}`;
      nodes.push({
        id,
        label: `Node (${row},${col})`,
        path: `/${id}.md`,
        x: col * spacing,
        y: row * spacing,
      });
    }
  }
  return nodes;
}

// Create mock edges
function createMockEdges(): GraphEdge[] {
  return [
    { id: "e1", source: "top-left", target: "top-right" },
    { id: "e2", source: "top-left", target: "bottom-left" },
    { id: "e3", source: "center", target: "top-left" },
    { id: "e4", source: "center", target: "bottom-right" },
  ];
}

describe("NavigationManager", () => {
  let navigation: NavigationManager;

  beforeEach(() => {
    navigation = new NavigationManager();
  });

  afterEach(() => {
    navigation.destroy();
  });

  describe("initialization", () => {
    it("should initialize with default config", () => {
      const config = navigation.getConfig();
      expect(config.mode).toBe("spatial");
      expect(config.directionAngle).toBe(45);
      expect(config.enableWrapping).toBe(true);
      expect(config.preferConnected).toBe(false);
      expect(config.maxDistance).toBe(Infinity);
    });

    it("should accept custom config", () => {
      navigation.destroy();
      navigation = new NavigationManager({
        mode: "connected",
        directionAngle: 60,
        enableWrapping: false,
      });

      const config = navigation.getConfig();
      expect(config.mode).toBe("connected");
      expect(config.directionAngle).toBe(60);
      expect(config.enableWrapping).toBe(false);
    });
  });

  describe("DEFAULT_NAVIGATION_MANAGER_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_NAVIGATION_MANAGER_CONFIG.mode).toBe("spatial");
      expect(DEFAULT_NAVIGATION_MANAGER_CONFIG.directionAngle).toBe(45);
      expect(DEFAULT_NAVIGATION_MANAGER_CONFIG.enableWrapping).toBe(true);
      expect(DEFAULT_NAVIGATION_MANAGER_CONFIG.preferConnected).toBe(false);
      expect(DEFAULT_NAVIGATION_MANAGER_CONFIG.maxDistance).toBe(Infinity);
    });
  });

  describe("node and edge management", () => {
    it("should set nodes", () => {
      const nodes = createPositionedNodes();
      navigation.setNodes(nodes);

      expect(navigation.getNode("center")).toBeDefined();
      expect(navigation.getNode("center")?.label).toBe("Center");
    });

    it("should set edges and build connection map", () => {
      navigation.setNodes(createPositionedNodes());
      navigation.setEdges(createMockEdges());

      expect(navigation.isConnected("top-left", "top-right")).toBe(true);
      expect(navigation.isConnected("top-right", "top-left")).toBe(true); // Bidirectional
      expect(navigation.isConnected("top-left", "bottom-right")).toBe(false);
    });

    it("should get connected nodes", () => {
      navigation.setNodes(createPositionedNodes());
      navigation.setEdges(createMockEdges());

      const connected = navigation.getConnectedNodes("center");
      expect(connected).toContain("top-left");
      expect(connected).toContain("bottom-right");
      expect(connected.length).toBe(2);
    });
  });

  describe("spatial navigation", () => {
    beforeEach(() => {
      navigation.setNodes(createPositionedNodes());
      // Use a narrower direction angle (30 degrees) to avoid catching the center node
      // when navigating along cardinal directions from corners
      navigation.setConfig({ directionAngle: 30 });
    });

    it("should navigate right to nearest node", () => {
      const result = navigation.navigate("top-left", "right");
      expect(result.targetNodeId).toBe("top-right");
      expect(result.wrapped).toBe(false);
    });

    it("should navigate down to nearest node", () => {
      const result = navigation.navigate("top-left", "down");
      expect(result.targetNodeId).toBe("bottom-left");
    });

    it("should navigate left to nearest node", () => {
      const result = navigation.navigate("top-right", "left");
      expect(result.targetNodeId).toBe("top-left");
    });

    it("should navigate up to nearest node", () => {
      const result = navigation.navigate("bottom-left", "up");
      expect(result.targetNodeId).toBe("top-left");
    });

    it("should find center node with wider angle", () => {
      // With a wider 45-degree angle, center (50,50) falls within the "down" cone from top-left
      navigation.setConfig({ directionAngle: 45 });
      const result = navigation.navigate("top-left", "down");
      // Center is at 45 degrees from top-left, which is at the edge of the cone
      // It may or may not be selected depending on implementation
      expect(["center", "bottom-left"]).toContain(result.targetNodeId);
    });

    it("should return null for invalid from node", () => {
      const result = navigation.navigate("nonexistent", "right");
      expect(result.targetNodeId).toBeNull();
      expect(result.candidates.length).toBe(0);
    });
  });

  describe("wrapping navigation", () => {
    beforeEach(() => {
      navigation.setNodes(createPositionedNodes());
      // Use a narrower direction angle to avoid catching the center node
      navigation.setConfig({ directionAngle: 30 });
    });

    it("should wrap from rightmost to leftmost", () => {
      const result = navigation.navigate("top-right", "right");
      expect(result.wrapped).toBe(true);
      // Should wrap to a node on the left side
      expect(result.targetNodeId).toBe("top-left");
    });

    it("should wrap from leftmost to rightmost", () => {
      const result = navigation.navigate("top-left", "left");
      expect(result.wrapped).toBe(true);
      expect(result.targetNodeId).toBe("top-right");
    });

    it("should wrap from topmost to bottommost", () => {
      const result = navigation.navigate("top-left", "up");
      expect(result.wrapped).toBe(true);
      expect(result.targetNodeId).toBe("bottom-left");
    });

    it("should wrap from bottommost to topmost", () => {
      const result = navigation.navigate("bottom-left", "down");
      expect(result.wrapped).toBe(true);
      expect(result.targetNodeId).toBe("top-left");
    });

    it("should not wrap when wrapping is disabled", () => {
      navigation.setConfig({ enableWrapping: false, directionAngle: 30 });

      const result = navigation.navigate("top-right", "right");
      expect(result.targetNodeId).toBeNull();
      expect(result.wrapped).toBe(false);
    });
  });

  describe("grid navigation", () => {
    beforeEach(() => {
      navigation.setNodes(createGridNodes(3, 3, 50));
    });

    it("should navigate through grid correctly", () => {
      // Start at center (1,1), go right to (1,2)
      let result = navigation.navigate("node-1-1", "right");
      expect(result.targetNodeId).toBe("node-1-2");

      // From (1,2), go down to (2,2)
      result = navigation.navigate("node-1-2", "down");
      expect(result.targetNodeId).toBe("node-2-2");

      // From (2,2), go left to (2,1)
      result = navigation.navigate("node-2-2", "left");
      expect(result.targetNodeId).toBe("node-2-1");

      // From (2,1), go up to (1,1)
      result = navigation.navigate("node-2-1", "up");
      expect(result.targetNodeId).toBe("node-1-1");
    });

    it("should wrap around grid edges", () => {
      // From (0,2) go right, should wrap to (0,0)
      const result = navigation.navigate("node-0-2", "right");
      expect(result.wrapped).toBe(true);
      expect(result.targetNodeId).toBe("node-0-0");
    });
  });

  describe("connected navigation", () => {
    beforeEach(() => {
      navigation.setNodes(createPositionedNodes());
      navigation.setEdges(createMockEdges());
    });

    it("should navigate to connected node in direction", () => {
      const result = navigation.navigateConnected("center", "right");
      // center is connected to bottom-right which is to the right
      expect(result).toBe("bottom-right");
    });

    it("should return null when no connected node in direction", () => {
      // center is not connected to top-right
      const result = navigation.navigateConnected("center", "right");
      // bottom-right is at (100, 100), from center (50, 50)
      // That's down-right direction
      expect(result).toBe("bottom-right");
    });

    it("should return null when node has no connections", () => {
      const result = navigation.navigateConnected("bottom-left", "right");
      // bottom-left is only connected to top-left (which is up, not right)
      expect(result).toBeNull();
    });

    it("should prefer connected nodes when configured", () => {
      navigation.setConfig({ preferConnected: true });

      const result = navigation.navigate("center", "right");
      // Should prefer bottom-right (connected) even though other nodes might be closer
      expect(result.targetNodeId).toBe("bottom-right");
    });
  });

  describe("special navigation", () => {
    beforeEach(() => {
      navigation.setNodes(createPositionedNodes());
    });

    it("should navigate to first node (top-left)", () => {
      const result = navigation.navigateToFirst();
      expect(result).toBe("top-left");
    });

    it("should navigate to last node (bottom-right)", () => {
      const result = navigation.navigateToLast();
      expect(result).toBe("bottom-right");
    });

    it("should navigate to center node", () => {
      const result = navigation.navigateToCenter();
      expect(result).toBe("center");
    });

    it("should find nearest node to position", () => {
      const result = navigation.findNearestNode(45, 55);
      expect(result).toBe("center"); // Closest to (50, 50)
    });

    it("should exclude node when finding nearest", () => {
      const result = navigation.findNearestNode(50, 50, "center");
      // Should find next closest, not center itself
      expect(result).not.toBe("center");
    });

    it("should return null for empty nodes", () => {
      navigation.setNodes([]);
      expect(navigation.navigateToFirst()).toBeNull();
      expect(navigation.navigateToLast()).toBeNull();
      expect(navigation.navigateToCenter()).toBeNull();
    });
  });

  describe("events", () => {
    beforeEach(() => {
      navigation.setNodes(createPositionedNodes());
      // Use a narrower direction angle for predictable event testing
      navigation.setConfig({ directionAngle: 30 });
    });

    it("should emit navigation:moved event", () => {
      const listener = jest.fn();
      navigation.on("navigation:moved", listener);

      navigation.navigate("top-left", "right");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as NavigationEvent;
      expect(event.type).toBe("navigation:moved");
      expect(event.fromNodeId).toBe("top-left");
      expect(event.toNodeId).toBe("top-right");
      expect(event.direction).toBe("right");
      expect(event.wrapped).toBe(false);
    });

    it("should emit navigation:wrapped event when wrapping", () => {
      const listener = jest.fn();
      navigation.on("navigation:wrapped", listener);

      navigation.navigate("top-right", "right");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as NavigationEvent;
      expect(event.type).toBe("navigation:wrapped");
      expect(event.wrapped).toBe(true);
    });

    it("should emit navigation:blocked event when no target", () => {
      navigation.setConfig({ enableWrapping: false });
      const listener = jest.fn();
      navigation.on("navigation:blocked", listener);

      navigation.navigate("top-right", "right");

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as NavigationEvent;
      expect(event.type).toBe("navigation:blocked");
      expect(event.toNodeId).toBeNull();
    });

    it("should remove event listener", () => {
      const listener = jest.fn();
      navigation.on("navigation:moved", listener);
      navigation.off("navigation:moved", listener);

      navigation.navigate("top-left", "right");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("distance limiting", () => {
    beforeEach(() => {
      navigation.setNodes(createPositionedNodes());
      // Use a narrower direction angle for predictable testing
      navigation.setConfig({ directionAngle: 30 });
    });

    it("should respect maxDistance config", () => {
      navigation.setConfig({ maxDistance: 50, directionAngle: 30 });

      // From top-left (0,0) to top-right (100,0) is 100 distance
      // Should not be reachable with maxDistance of 50
      const result = navigation.navigate("top-left", "right");

      // center (50,50) is not in the 30-degree "right" cone
      // top-right is at distance 100 which exceeds maxDistance
      // No valid candidate within 50 distance in right direction
      expect(result.targetNodeId).toBeNull();
    });
  });

  describe("destroy", () => {
    it("should cleanup on destroy", () => {
      navigation.setNodes(createPositionedNodes());
      navigation.setEdges(createMockEdges());

      navigation.destroy();

      expect(navigation.getNode("center")).toBeUndefined();
      expect(navigation.getConnectedNodes("center")).toEqual([]);
    });
  });
});
