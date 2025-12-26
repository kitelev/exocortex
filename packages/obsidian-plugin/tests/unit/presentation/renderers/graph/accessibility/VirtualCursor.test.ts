/**
 * VirtualCursor Tests
 *
 * Tests for virtual cursor navigation functionality.
 */

import {
  VirtualCursor,
  createVirtualCursor,
  DEFAULT_VIRTUAL_CURSOR_CONFIG,
} from "../../../../../../src/presentation/renderers/graph/accessibility";
import type { GraphNode } from "../../../../../../src/presentation/renderers/graph/types";

describe("VirtualCursor", () => {
  // Sample nodes for testing
  const createSampleNodes = (): GraphNode[] => [
    { id: "node1", label: "Node 1", path: "/node1.md", x: 0, y: 0, group: "Task" },
    { id: "node2", label: "Node 2", path: "/node2.md", x: 100, y: 0, group: "Project" },
    { id: "node3", label: "Node 3", path: "/node3.md", x: 0, y: 100, group: "Task" },
    { id: "node4", label: "Node 4", path: "/node4.md", x: 100, y: 100, group: "Area" },
    { id: "node5", label: "Node 5", path: "/node5.md", x: 50, y: 50, group: "Task" },
  ];

  describe("DEFAULT_VIRTUAL_CURSOR_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_VIRTUAL_CURSOR_CONFIG.maxHistorySize).toBe(50);
      expect(DEFAULT_VIRTUAL_CURSOR_CONFIG.wrapAround).toBe(true);
      expect(DEFAULT_VIRTUAL_CURSOR_CONFIG.defaultMode).toBe("spatial");
      expect(DEFAULT_VIRTUAL_CURSOR_CONFIG.directionTolerance).toBe(45);
    });
  });

  describe("createVirtualCursor", () => {
    it("should create a VirtualCursor instance", () => {
      const cursor = createVirtualCursor();
      expect(cursor).toBeInstanceOf(VirtualCursor);
    });

    it("should accept custom configuration", () => {
      const cursor = createVirtualCursor({
        maxHistorySize: 100,
        wrapAround: false,
        defaultMode: "linear",
      });
      expect(cursor.getMode()).toBe("linear");
    });
  });

  describe("constructor", () => {
    it("should initialize with default mode", () => {
      const cursor = new VirtualCursor();
      expect(cursor.getMode()).toBe("spatial");
    });

    it("should start without a current position", () => {
      const cursor = new VirtualCursor();
      expect(cursor.getCurrentNodeId()).toBeNull();
    });

    it("should start inactive", () => {
      const cursor = new VirtualCursor();
      expect(cursor.isActive()).toBe(false);
    });
  });

  describe("setNodes", () => {
    it("should set nodes for navigation", () => {
      const cursor = new VirtualCursor();
      const nodes = createSampleNodes();
      cursor.setNodes(nodes);

      const a11yNodes = cursor.getA11yNodes();
      expect(a11yNodes).toHaveLength(5);
    });

    it("should create A11yNode representations", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());

      const a11yNodes = cursor.getA11yNodes();
      expect(a11yNodes[0].label).toBe("Node 1");
      expect(a11yNodes[0].type).toBe("Task");
      expect(a11yNodes[0].index).toBe(0);
    });
  });

  describe("setPosition", () => {
    it("should set cursor position", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node2");

      expect(cursor.getCurrentNodeId()).toBe("node2");
    });

    it("should emit cursor:move event", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());

      const listener = jest.fn();
      cursor.on("cursor:move", listener);
      cursor.setPosition("node2");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cursor:move",
          nodeId: "node2",
          previousNodeId: null,
        })
      );
    });

    it("should not emit if position unchanged", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node2");

      const listener = jest.fn();
      cursor.on("cursor:move", listener);
      cursor.setPosition("node2"); // Same position

      expect(listener).not.toHaveBeenCalled();
    });

    it("should add to history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");
      cursor.setPosition("node2");
      cursor.setPosition("node3");

      expect(cursor.canGoBack()).toBe(true);
    });
  });

  describe("getCurrentNode", () => {
    it("should return null when no position set", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      expect(cursor.getCurrentNode()).toBeNull();
    });

    it("should return A11yNode for current position", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node2");

      const node = cursor.getCurrentNode();
      expect(node).not.toBeNull();
      expect(node?.label).toBe("Node 2");
      expect(node?.type).toBe("Project");
    });
  });

  describe("setMode", () => {
    it("should change navigation mode", () => {
      const cursor = new VirtualCursor();
      cursor.setMode("linear");
      expect(cursor.getMode()).toBe("linear");
    });

    it("should emit cursor:mode:change event", () => {
      const cursor = new VirtualCursor();
      const listener = jest.fn();
      cursor.on("cursor:mode:change", listener);

      cursor.setMode("semantic");

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "cursor:mode:change",
          mode: "semantic",
        })
      );
    });
  });

  describe("navigate - linear mode", () => {
    it("should navigate to next node", () => {
      const cursor = new VirtualCursor({ defaultMode: "linear" });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");

      const result = cursor.navigate("next");
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node2");
    });

    it("should navigate to previous node", () => {
      const cursor = new VirtualCursor({ defaultMode: "linear" });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node2");

      const result = cursor.navigate("previous");
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node1");
    });

    it("should navigate to first node", () => {
      const cursor = new VirtualCursor({ defaultMode: "linear" });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node3");

      const result = cursor.navigate("first");
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node1");
    });

    it("should navigate to last node", () => {
      const cursor = new VirtualCursor({ defaultMode: "linear" });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");

      const result = cursor.navigate("last");
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node5");
    });

    it("should wrap around when at end", () => {
      const cursor = new VirtualCursor({ defaultMode: "linear", wrapAround: true });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node5");

      const result = cursor.navigate("next");
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node1");
    });

    it("should not wrap when wrapAround is false", () => {
      const cursor = new VirtualCursor({ defaultMode: "linear", wrapAround: false });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node5");

      const result = cursor.navigate("next");
      expect(result.nodeId).toBe("node5"); // Stay at current
    });
  });

  describe("navigate - spatial mode", () => {
    it("should navigate right to nearest node", () => {
      const cursor = new VirtualCursor({ defaultMode: "spatial" });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1"); // at (0, 0)

      const result = cursor.navigate("right");
      expect(result.success).toBe(true);
      // node2 is at (100, 0), directly right
      // node5 is at (50, 50), diagonal
      // node2 should be selected as it's more directly to the right
      expect(["node2", "node5"]).toContain(result.nodeId);
    });

    it("should navigate down to nearest node", () => {
      const cursor = new VirtualCursor({ defaultMode: "spatial" });
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1"); // at (0, 0)

      const result = cursor.navigate("down");
      expect(result.success).toBe(true);
      // node3 is at (0, 100), directly down
      expect(["node3", "node5"]).toContain(result.nodeId);
    });

    it("should start at first node when no position set", () => {
      const cursor = new VirtualCursor({ defaultMode: "spatial" });
      cursor.setNodes(createSampleNodes());

      const result = cursor.navigate("right");
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node1");
    });
  });

  describe("navigateToType", () => {
    it("should navigate to next node of specified type", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1"); // Task

      const result = cursor.navigateToType("Project", true);
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node2"); // Only Project node
    });

    it("should navigate to previous node of type", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node5"); // Last Task

      const result = cursor.navigateToType("Task", false);
      expect(result.success).toBe(true);
    });

    it("should fail if no nodes of type exist", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());

      const result = cursor.navigateToType("NonexistentType", true);
      expect(result.success).toBe(false);
    });
  });

  describe("history navigation", () => {
    it("should track navigation history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");
      cursor.setPosition("node2");
      cursor.setPosition("node3");

      expect(cursor.canGoBack()).toBe(true);
      expect(cursor.canGoForward()).toBe(false);
    });

    it("should go back in history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");
      cursor.setPosition("node2");
      cursor.setPosition("node3");

      const result = cursor.goBack();
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node2");
    });

    it("should go forward in history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");
      cursor.setPosition("node2");
      cursor.setPosition("node3");
      cursor.goBack();

      const result = cursor.goForward();
      expect(result.success).toBe(true);
      expect(result.nodeId).toBe("node3");
    });

    it("should not go back at start of history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");

      const result = cursor.goBack();
      expect(result.success).toBe(false);
    });

    it("should not go forward at end of history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");

      const result = cursor.goForward();
      expect(result.success).toBe(false);
    });

    it("should clear forward history when navigating from middle", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");
      cursor.setPosition("node2");
      cursor.setPosition("node3");
      cursor.goBack(); // At node2
      cursor.setPosition("node4"); // New navigation from middle

      expect(cursor.canGoForward()).toBe(false);
    });
  });

  describe("activate/deactivate", () => {
    it("should activate cursor", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.activate();

      expect(cursor.isActive()).toBe(true);
    });

    it("should focus first node when activating without position", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.activate();

      expect(cursor.getCurrentNodeId()).toBe("node1");
    });

    it("should emit cursor:activate event", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      const listener = jest.fn();
      cursor.on("cursor:activate", listener);

      cursor.activate();

      expect(listener).toHaveBeenCalled();
    });

    it("should deactivate cursor", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.activate();
      cursor.deactivate();

      expect(cursor.isActive()).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset cursor state", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node2");
      cursor.setMode("linear");
      cursor.activate();

      cursor.reset();

      expect(cursor.getCurrentNodeId()).toBeNull();
      expect(cursor.getMode()).toBe("spatial"); // Back to default
      expect(cursor.isActive()).toBe(false);
      expect(cursor.canGoBack()).toBe(false);
    });
  });

  describe("clearHistory", () => {
    it("should clear navigation history", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");
      cursor.setPosition("node2");
      cursor.setPosition("node3");

      cursor.clearHistory();

      expect(cursor.canGoBack()).toBe(false);
      expect(cursor.canGoForward()).toBe(false);
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node2");

      const state = cursor.getState();

      expect(state.currentNodeId).toBe("node2");
      expect(state.mode).toBe("spatial");
      expect(state.isActive).toBe(false);
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      const listener = jest.fn();

      cursor.on("cursor:move", listener);
      cursor.setPosition("node1");
      expect(listener).toHaveBeenCalledTimes(1);

      cursor.off("cursor:move", listener);
      cursor.setPosition("node2");
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe("destroy", () => {
    it("should clean up resources", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());
      cursor.setPosition("node1");

      cursor.destroy();

      expect(cursor.getCurrentNodeId()).toBeNull();
      expect(cursor.getA11yNodes()).toHaveLength(0);
    });
  });

  describe("updateConnections", () => {
    it("should update node connection information", () => {
      const cursor = new VirtualCursor();
      cursor.setNodes(createSampleNodes());

      cursor.updateConnections([
        { source: "node1", target: "node2" },
        { source: "node1", target: "node3" },
        { source: "node2", target: "node4" },
      ]);

      cursor.setPosition("node1");
      const node = cursor.getCurrentNode();

      expect(node?.connectionCount).toBe(2);
      expect(node?.connectedTo).toContain("Node 2");
      expect(node?.connectedTo).toContain("Node 3");
    });
  });
});
