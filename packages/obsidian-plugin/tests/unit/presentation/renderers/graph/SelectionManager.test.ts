/**
 * Tests for SelectionManager - Node and edge selection with multi-select and box selection
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import {
  SelectionManager,
  DEFAULT_SELECTION_MANAGER_CONFIG,
  type SelectionState,
  type SelectionManagerConfig,
  type SelectionEvent,
  type SelectionEventType,
  type Rect,
  type NormalizedRect,
} from "../../../../../src/presentation/renderers/graph/SelectionManager";
import type { GraphNode } from "../../../../../src/presentation/renderers/graph/types";

// Create mock keyboard event
function createKeyboardEvent(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as unknown as KeyboardEvent;
}

// Create mock pointer/mouse event
function createPointerEvent(options: Partial<{
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}> = {}): { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } {
  return {
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  };
}

// Create mock graph nodes
function createMockNodes(count: number): GraphNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    label: `Node ${i}`,
    path: `/path/to/node-${i}.md`,
    x: i * 50,
    y: i * 30,
    size: 8,
  }));
}

describe("SelectionManager", () => {
  let selection: SelectionManager;

  beforeEach(() => {
    selection = new SelectionManager();
  });

  afterEach(() => {
    selection.destroy();
  });

  describe("initialization", () => {
    it("should initialize with empty selection", () => {
      const state = selection.getSelectionState();
      expect(state.selectedNodeIds.size).toBe(0);
      expect(state.selectedEdgeIds.size).toBe(0);
      expect(state.lastSelectedNodeId).toBeNull();
      expect(state.selectionBox).toBeNull();
    });

    it("should use default config", () => {
      const config = selection.getConfig();
      expect(config.multiSelectKey).toBe("shift");
      expect(config.boxSelectEnabled).toBe(true);
      expect(config.boxSelectMinSize).toBe(10);
      expect(config.clickThreshold).toBe(5);
      expect(config.enableSelectAll).toBe(true);
      expect(config.enableEscapeClear).toBe(true);
    });

    it("should accept custom config", () => {
      selection.destroy();
      selection = new SelectionManager({
        multiSelectKey: "ctrl",
        boxSelectMinSize: 20,
      });

      const config = selection.getConfig();
      expect(config.multiSelectKey).toBe("ctrl");
      expect(config.boxSelectMinSize).toBe(20);
    });
  });

  describe("DEFAULT_SELECTION_MANAGER_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_SELECTION_MANAGER_CONFIG.multiSelectKey).toBe("shift");
      expect(DEFAULT_SELECTION_MANAGER_CONFIG.boxSelectEnabled).toBe(true);
      expect(DEFAULT_SELECTION_MANAGER_CONFIG.boxSelectMinSize).toBe(10);
      expect(DEFAULT_SELECTION_MANAGER_CONFIG.clickThreshold).toBe(5);
      expect(DEFAULT_SELECTION_MANAGER_CONFIG.enableSelectAll).toBe(true);
      expect(DEFAULT_SELECTION_MANAGER_CONFIG.enableEscapeClear).toBe(true);
    });
  });

  describe("single-click selection", () => {
    it("should select a node on single click", () => {
      selection.handleNodeClick("node-1", createPointerEvent());

      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(1);
    });

    it("should replace selection on single click without modifier", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent());

      expect(selection.isNodeSelected("node-1")).toBe(false);
      expect(selection.isNodeSelected("node-2")).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(1);
    });

    it("should update lastSelectedNodeId on click", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      expect(selection.getSelectionState().lastSelectedNodeId).toBe("node-1");

      selection.handleNodeClick("node-2", createPointerEvent());
      expect(selection.getSelectionState().lastSelectedNodeId).toBe("node-2");
    });

    it("should emit selection:change event", () => {
      const listener = jest.fn();
      selection.on("selection:change", listener);

      selection.handleNodeClick("node-1", createPointerEvent());

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as SelectionEvent;
      expect(event.type).toBe("selection:change");
      expect(event.selectedNodeIds.has("node-1")).toBe(true);
      expect(event.addedNodeIds?.has("node-1")).toBe(true);
    });

    it("should handle edge click", () => {
      selection.handleEdgeClick("edge-1", createPointerEvent());

      expect(selection.isEdgeSelected("edge-1")).toBe(true);
      expect(selection.getSelectedEdgeCount()).toBe(1);
    });

    it("should clear node selection when clicking edge without modifier", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleEdgeClick("edge-1", createPointerEvent());

      expect(selection.getSelectedNodeCount()).toBe(0);
      expect(selection.isEdgeSelected("edge-1")).toBe(true);
    });
  });

  describe("multi-select with Shift key", () => {
    it("should add to selection with Shift+click", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent({ shiftKey: true }));

      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-2")).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(2);
    });

    it("should toggle selection with Shift+click on selected node", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent({ shiftKey: true }));
      selection.handleNodeClick("node-1", createPointerEvent({ shiftKey: true }));

      expect(selection.isNodeSelected("node-1")).toBe(false);
      expect(selection.isNodeSelected("node-2")).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(1);
    });

    it("should track removed nodes in event", () => {
      const listener = jest.fn();
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.on("selection:change", listener);

      selection.handleNodeClick("node-1", createPointerEvent({ shiftKey: true }));

      const event = listener.mock.calls[0][0] as SelectionEvent;
      expect(event.removedNodeIds?.has("node-1")).toBe(true);
    });
  });

  describe("multi-select with Ctrl key", () => {
    beforeEach(() => {
      selection.destroy();
      selection = new SelectionManager({ multiSelectKey: "ctrl" });
    });

    it("should add to selection with Ctrl+click", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent({ ctrlKey: true }));

      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-2")).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(2);
    });
  });

  describe("multi-select with Meta key", () => {
    beforeEach(() => {
      selection.destroy();
      selection = new SelectionManager({ multiSelectKey: "meta" });
    });

    it("should add to selection with Meta+click", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent({ metaKey: true }));

      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-2")).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(2);
    });
  });

  describe("background click", () => {
    it("should clear selection on background click without modifier", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent({ shiftKey: true }));

      selection.handleBackgroundClick(createPointerEvent());

      expect(selection.getSelectedNodeCount()).toBe(0);
    });

    it("should not clear selection on background click with modifier", () => {
      selection.handleNodeClick("node-1", createPointerEvent());

      selection.handleBackgroundClick(createPointerEvent({ shiftKey: true }));

      expect(selection.getSelectedNodeCount()).toBe(1);
    });
  });

  describe("box selection", () => {
    const mockNodes = createMockNodes(5);

    beforeEach(() => {
      selection.setNodes(mockNodes);
    });

    it("should start box selection", () => {
      const listener = jest.fn();
      selection.on("selection:boxstart", listener);

      selection.startBoxSelect(0, 0);

      expect(selection.isBoxSelecting()).toBe(true);
      const box = selection.getSelectionBox();
      expect(box?.x).toBe(0);
      expect(box?.y).toBe(0);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should update box selection", () => {
      const listener = jest.fn();
      selection.on("selection:boxupdate", listener);

      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(100, 100);

      const box = selection.getSelectionBox();
      expect(box?.width).toBe(100);
      expect(box?.height).toBe(100);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should preview nodes in box", () => {
      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(60, 40); // Should include node-0 (x=0, y=0) and node-1 (x=50, y=30)

      expect(selection.isNodeInBoxPreview("node-0")).toBe(true);
      expect(selection.isNodeInBoxPreview("node-1")).toBe(true);
      expect(selection.isNodeInBoxPreview("node-2")).toBe(false);
    });

    it("should select nodes in box on end", () => {
      const listener = jest.fn();
      selection.on("selection:boxend", listener);

      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(60, 40);
      selection.endBoxSelect(createPointerEvent());

      expect(selection.isNodeSelected("node-0")).toBe(true);
      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-2")).toBe(false);
      expect(selection.isBoxSelecting()).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should add to selection with Shift modifier", () => {
      selection.handleNodeClick("node-4", createPointerEvent());

      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(60, 40);
      selection.endBoxSelect(createPointerEvent({ shiftKey: true }));

      expect(selection.isNodeSelected("node-0")).toBe(true);
      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-4")).toBe(true);
    });

    it("should replace selection without Shift modifier", () => {
      selection.handleNodeClick("node-4", createPointerEvent());

      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(60, 40);
      selection.endBoxSelect(createPointerEvent());

      expect(selection.isNodeSelected("node-0")).toBe(true);
      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-4")).toBe(false);
    });

    it("should handle negative box dimensions", () => {
      selection.startBoxSelect(60, 40);
      selection.updateBoxSelect(0, 0);
      selection.endBoxSelect(createPointerEvent());

      expect(selection.isNodeSelected("node-0")).toBe(true);
      expect(selection.isNodeSelected("node-1")).toBe(true);
    });

    it("should not select if box is too small", () => {
      selection.handleNodeClick("node-0", createPointerEvent());

      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(5, 5); // Below minSize threshold
      selection.endBoxSelect(createPointerEvent());

      // Selection should be unchanged (box treated as click)
      expect(selection.isNodeSelected("node-0")).toBe(true);
    });

    it("should cancel box selection", () => {
      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(100, 100);

      selection.cancelBoxSelect();

      expect(selection.isBoxSelecting()).toBe(false);
      expect(selection.getSelectionBox()).toBeNull();
    });

    it("should respect boxSelectEnabled config", () => {
      selection.destroy();
      selection = new SelectionManager({ boxSelectEnabled: false });

      selection.startBoxSelect(0, 0);

      expect(selection.isBoxSelecting()).toBe(false);
    });
  });

  describe("normalizeRect", () => {
    it("should normalize positive dimensions", () => {
      const rect: Rect = { x: 10, y: 20, width: 100, height: 50 };
      const normalized = selection.normalizeRect(rect);

      expect(normalized.minX).toBe(10);
      expect(normalized.minY).toBe(20);
      expect(normalized.maxX).toBe(110);
      expect(normalized.maxY).toBe(70);
      expect(normalized.width).toBe(100);
      expect(normalized.height).toBe(50);
    });

    it("should normalize negative width", () => {
      const rect: Rect = { x: 100, y: 20, width: -50, height: 30 };
      const normalized = selection.normalizeRect(rect);

      expect(normalized.minX).toBe(50);
      expect(normalized.maxX).toBe(100);
      expect(normalized.width).toBe(50);
    });

    it("should normalize negative height", () => {
      const rect: Rect = { x: 10, y: 100, width: 50, height: -30 };
      const normalized = selection.normalizeRect(rect);

      expect(normalized.minY).toBe(70);
      expect(normalized.maxY).toBe(100);
      expect(normalized.height).toBe(30);
    });

    it("should normalize both negative dimensions", () => {
      const rect: Rect = { x: 100, y: 100, width: -50, height: -30 };
      const normalized = selection.normalizeRect(rect);

      expect(normalized.minX).toBe(50);
      expect(normalized.minY).toBe(70);
      expect(normalized.maxX).toBe(100);
      expect(normalized.maxY).toBe(100);
    });
  });

  describe("selectAll", () => {
    const mockNodes = createMockNodes(3);

    beforeEach(() => {
      selection.setNodes(mockNodes);
    });

    it("should select all nodes", () => {
      selection.selectAll();

      expect(selection.getSelectedNodeCount()).toBe(3);
      expect(selection.isNodeSelected("node-0")).toBe(true);
      expect(selection.isNodeSelected("node-1")).toBe(true);
      expect(selection.isNodeSelected("node-2")).toBe(true);
    });

    it("should accept nodes parameter", () => {
      selection.selectAll(mockNodes.slice(0, 2));

      expect(selection.getSelectedNodeCount()).toBe(2);
    });

    it("should respect enableSelectAll config", () => {
      selection.destroy();
      selection = new SelectionManager({ enableSelectAll: false });
      selection.setNodes(mockNodes);

      selection.selectAll();

      expect(selection.getSelectedNodeCount()).toBe(0);
    });
  });

  describe("clearSelection", () => {
    it("should clear all selections", () => {
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.handleNodeClick("node-2", createPointerEvent({ shiftKey: true }));
      selection.handleEdgeClick("edge-1", createPointerEvent({ shiftKey: true }));

      selection.clearSelection();

      expect(selection.getSelectedNodeCount()).toBe(0);
      expect(selection.getSelectedEdgeCount()).toBe(0);
      expect(selection.getSelectionState().lastSelectedNodeId).toBeNull();
    });

    it("should emit selection:clear and selection:change events", () => {
      const clearListener = jest.fn();
      const changeListener = jest.fn();
      selection.on("selection:clear", clearListener);
      selection.on("selection:change", changeListener);

      selection.handleNodeClick("node-1", createPointerEvent());
      clearListener.mockClear();
      changeListener.mockClear();

      selection.clearSelection();

      expect(clearListener).toHaveBeenCalledTimes(1);
      expect(changeListener).toHaveBeenCalledTimes(1);
    });

    it("should not emit events if already empty", () => {
      const listener = jest.fn();
      selection.on("selection:change", listener);

      selection.clearSelection();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("keyboard shortcuts", () => {
    const mockNodes = createMockNodes(3);

    beforeEach(() => {
      selection.setNodes(mockNodes);
    });

    it("should handle Ctrl+A to select all", () => {
      const event = createKeyboardEvent("a", { ctrlKey: true });
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(selection.getSelectedNodeCount()).toBe(3);
    });

    it("should handle Cmd+A on Mac", () => {
      const event = createKeyboardEvent("A", { metaKey: true });
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(3);
    });

    it("should handle Escape to clear selection", () => {
      selection.handleNodeClick("node-1", createPointerEvent());

      const event = createKeyboardEvent("Escape");
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(true);
      expect(selection.getSelectedNodeCount()).toBe(0);
    });

    it("should handle Escape to cancel box selection", () => {
      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(100, 100);

      const event = createKeyboardEvent("Escape");
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(true);
      expect(selection.isBoxSelecting()).toBe(false);
    });

    it("should return false for unhandled keys", () => {
      const event = createKeyboardEvent("x");
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(false);
    });

    it("should respect enableSelectAll config", () => {
      selection.destroy();
      selection = new SelectionManager({ enableSelectAll: false });
      selection.setNodes(mockNodes);

      const event = createKeyboardEvent("a", { ctrlKey: true });
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(false);
      expect(selection.getSelectedNodeCount()).toBe(0);
    });

    it("should respect enableEscapeClear config", () => {
      selection.destroy();
      selection = new SelectionManager({ enableEscapeClear: false });
      selection.handleNodeClick("node-1", createPointerEvent());

      const event = createKeyboardEvent("Escape");
      const handled = selection.handleKeyDown(event);

      expect(handled).toBe(false);
      expect(selection.getSelectedNodeCount()).toBe(1);
    });
  });

  describe("programmatic selection", () => {
    it("should set selected nodes", () => {
      selection.setSelectedNodes(["node-1", "node-2", "node-3"]);

      expect(selection.getSelectedNodeCount()).toBe(3);
      expect(selection.getSelectedNodeIds()).toEqual(["node-1", "node-2", "node-3"]);
    });

    it("should set selected edges", () => {
      selection.setSelectedEdges(["edge-1", "edge-2"]);

      expect(selection.getSelectedEdgeCount()).toBe(2);
      expect(selection.getSelectedEdgeIds()).toEqual(["edge-1", "edge-2"]);
    });

    it("should emit change event on setSelectedNodes", () => {
      const listener = jest.fn();
      selection.on("selection:change", listener);

      selection.setSelectedNodes(["node-1"]);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should not emit if selection is unchanged", () => {
      selection.setSelectedNodes(["node-1"]);
      const listener = jest.fn();
      selection.on("selection:change", listener);

      selection.setSelectedNodes(["node-1"]);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("event listeners", () => {
    it("should add and remove listeners", () => {
      const listener = jest.fn();

      selection.on("selection:change", listener);
      selection.handleNodeClick("node-1", createPointerEvent());
      expect(listener).toHaveBeenCalledTimes(1);

      selection.off("selection:change", listener);
      selection.handleNodeClick("node-2", createPointerEvent());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should support multiple listeners", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      selection.on("selection:change", listener1);
      selection.on("selection:change", listener2);

      selection.handleNodeClick("node-1", createPointerEvent());

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("configuration", () => {
    it("should update config", () => {
      selection.setConfig({ boxSelectMinSize: 20 });

      expect(selection.getConfig().boxSelectMinSize).toBe(20);
    });

    it("should preserve other config values", () => {
      selection.setConfig({ boxSelectMinSize: 20 });

      expect(selection.getConfig().multiSelectKey).toBe("shift");
    });
  });

  describe("destroy", () => {
    it("should clear all state on destroy", () => {
      const mockNodes = createMockNodes(3);
      selection.setNodes(mockNodes);
      selection.handleNodeClick("node-1", createPointerEvent());
      selection.startBoxSelect(0, 0);

      selection.destroy();

      expect(selection.getSelectedNodeCount()).toBe(0);
      expect(selection.isBoxSelecting()).toBe(false);
    });

    it("should clear listeners on destroy", () => {
      const listener = jest.fn();
      selection.on("selection:change", listener);

      selection.destroy();
      // Create new instance since old one is destroyed
      selection = new SelectionManager();
      selection.handleNodeClick("node-1", createPointerEvent());

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle nodes with undefined positions", () => {
      const nodesWithoutPositions: GraphNode[] = [
        { id: "node-0", label: "Node 0", path: "/path/0.md" },
        { id: "node-1", label: "Node 1", path: "/path/1.md" },
      ];
      selection.setNodes(nodesWithoutPositions);

      selection.startBoxSelect(-10, -10);
      selection.updateBoxSelect(10, 10);
      selection.endBoxSelect(createPointerEvent());

      // Nodes with undefined positions default to (0, 0)
      expect(selection.getSelectedNodeCount()).toBe(2);
    });

    it("should handle empty nodes array", () => {
      selection.setNodes([]);

      selection.startBoxSelect(0, 0);
      selection.updateBoxSelect(100, 100);
      selection.endBoxSelect(createPointerEvent());

      expect(selection.getSelectedNodeCount()).toBe(0);
    });

    it("should handle selecting non-existent nodes", () => {
      selection.handleNodeClick("nonexistent", createPointerEvent());

      // Should still add to selection (ID-based, not validated)
      expect(selection.isNodeSelected("nonexistent")).toBe(true);
    });

    it("should handle updateBoxSelect without startBoxSelect", () => {
      // Should not throw
      selection.updateBoxSelect(100, 100);

      expect(selection.isBoxSelecting()).toBe(false);
    });

    it("should handle endBoxSelect without startBoxSelect", () => {
      // Should not throw
      selection.endBoxSelect(createPointerEvent());

      expect(selection.isBoxSelecting()).toBe(false);
    });
  });
});
