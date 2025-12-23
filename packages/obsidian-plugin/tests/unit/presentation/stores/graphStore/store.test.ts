/**
 * Unit tests for GraphStore
 */

import { act, renderHook } from "@testing-library/react";
import type { GraphNode, GraphEdge } from "exocortex";
import {
  useGraphStore,
  getDefaultState,
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
} from "../../../../../src/presentation/stores/graphStore";
import type { GraphData } from "../../../../../src/presentation/stores/graphStore";

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: jest.fn((key: string) => localStorageMock.store[key] || null),
  setItem: jest.fn((key: string, value: string) => {
    localStorageMock.store[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete localStorageMock.store[key];
  }),
  clear: jest.fn(() => {
    localStorageMock.store = {};
  }),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Helper to create mock nodes
function createMockNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    path: `${id}.md`,
    title: `Node ${id}`,
    label: `Node ${id}`,
    isArchived: false,
    x: 0,
    y: 0,
    ...overrides,
  };
}

// Helper to create mock edges
function createMockEdge(
  source: string,
  target: string,
  overrides: Partial<GraphEdge> = {}
): GraphEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: "forward-link",
    ...overrides,
  };
}

/**
 * Helper to reset the store to default state for testing.
 * Uses setState to set new Maps/Sets (Immer freezes existing ones).
 * Also clears temporal history.
 */
function resetStoreForTest(): void {
  // Clear temporal history
  clearHistory();

  // Reset store state
  useGraphStore.setState({
    nodes: new Map(),
    edges: new Map(),
    selectedNodeIds: new Set(),
    selectedEdgeIds: new Set(),
    hoveredNodeId: null,
    hoveredEdgeId: null,
    viewport: {
      x: 0,
      y: 0,
      zoom: 1,
      width: 800,
      height: 600,
    },
    filters: {
      nodeTypes: new Set(),
      edgeTypes: new Set(),
      searchQuery: "",
      showOrphans: true,
      showLabels: true,
      minDegree: 0,
    },
    layout: {
      algorithm: "force",
      isSimulating: false,
      alpha: 0,
      frozen: false,
      focusNodeId: null,
    },
    ui: {
      sidebarOpen: true,
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        targetId: null,
        targetType: "canvas",
      },
      tooltip: {
        visible: false,
        x: 0,
        y: 0,
        content: null,
      },
      minimap: {
        visible: true,
        position: "bottom-right",
      },
    },
    metrics: {
      fps: 0,
      nodeCount: 0,
      visibleNodeCount: 0,
      renderTime: 0,
      lastUpdate: 0,
    },
  });
}

describe("GraphStore", () => {
  beforeEach(() => {
    // Reset store to default state
    act(() => {
      resetStoreForTest();
    });
    // Clear localStorage mock
    localStorageMock.clear();
  });

  describe("Initial State", () => {
    it("should have empty nodes and edges", () => {
      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(0);
      expect(state.edges.size).toBe(0);
    });

    it("should have empty selection", () => {
      const state = useGraphStore.getState();
      expect(state.selectedNodeIds.size).toBe(0);
      expect(state.selectedEdgeIds.size).toBe(0);
    });

    it("should have default viewport", () => {
      const state = useGraphStore.getState();
      expect(state.viewport.zoom).toBe(1);
      expect(state.viewport.x).toBe(0);
      expect(state.viewport.y).toBe(0);
    });

    it("should have default filters", () => {
      const state = useGraphStore.getState();
      expect(state.filters.showOrphans).toBe(true);
      expect(state.filters.showLabels).toBe(true);
      expect(state.filters.minDegree).toBe(0);
      expect(state.filters.searchQuery).toBe("");
    });

    it("should have default layout", () => {
      const state = useGraphStore.getState();
      expect(state.layout.algorithm).toBe("force");
      expect(state.layout.isSimulating).toBe(false);
      expect(state.layout.frozen).toBe(false);
    });
  });

  describe("Data Mutations", () => {
    describe("setGraphData", () => {
      it("should set nodes and edges from GraphData", () => {
        const data: GraphData = {
          nodes: [createMockNode("node1"), createMockNode("node2")],
          edges: [createMockEdge("node1", "node2")],
        };

        act(() => {
          useGraphStore.getState().setGraphData(data);
        });

        const state = useGraphStore.getState();
        expect(state.nodes.size).toBe(2);
        expect(state.edges.size).toBe(1);
        expect(state.nodes.get("node1")).toBeDefined();
        expect(state.nodes.get("node2")).toBeDefined();
      });

      it("should clear selection when setting new data", () => {
        // First set some data and select a node
        act(() => {
          useGraphStore.getState().addNode(createMockNode("node1"));
          useGraphStore.getState().selectNode("node1");
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(1);

        // Set new data
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [createMockNode("node2")],
            edges: [],
          });
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(0);
      });

      it("should update metrics when setting data", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("n3")],
            edges: [],
          });
        });

        expect(useGraphStore.getState().metrics.nodeCount).toBe(3);
        expect(useGraphStore.getState().metrics.lastUpdate).toBeGreaterThan(0);
      });
    });

    describe("addNode", () => {
      it("should add a node to the store", () => {
        const node = createMockNode("test-node");

        act(() => {
          useGraphStore.getState().addNode(node);
        });

        expect(useGraphStore.getState().nodes.size).toBe(1);
        expect(useGraphStore.getState().nodes.get("test-node")).toEqual(node);
      });

      it("should update nodeCount metric", () => {
        act(() => {
          useGraphStore.getState().addNode(createMockNode("n1"));
          useGraphStore.getState().addNode(createMockNode("n2"));
        });

        expect(useGraphStore.getState().metrics.nodeCount).toBe(2);
      });
    });

    describe("updateNode", () => {
      it("should update node properties", () => {
        act(() => {
          useGraphStore.getState().addNode(createMockNode("node1", { x: 0, y: 0 }));
          useGraphStore.getState().updateNode("node1", { x: 100, y: 200 });
        });

        const node = useGraphStore.getState().nodes.get("node1");
        expect(node?.x).toBe(100);
        expect(node?.y).toBe(200);
      });

      it("should not modify other properties", () => {
        act(() => {
          useGraphStore.getState().addNode(
            createMockNode("node1", { title: "Original", label: "Original" })
          );
          useGraphStore.getState().updateNode("node1", { x: 100 });
        });

        const node = useGraphStore.getState().nodes.get("node1");
        expect(node?.title).toBe("Original");
        expect(node?.label).toBe("Original");
      });

      it("should do nothing if node does not exist", () => {
        const initialCount = useGraphStore.getState().nodes.size;

        act(() => {
          useGraphStore.getState().updateNode("nonexistent", { x: 100 });
        });

        expect(useGraphStore.getState().nodes.size).toBe(initialCount);
      });
    });

    describe("removeNode", () => {
      it("should remove a node", () => {
        act(() => {
          useGraphStore.getState().addNode(createMockNode("node1"));
          useGraphStore.getState().removeNode("node1");
        });

        expect(useGraphStore.getState().nodes.size).toBe(0);
      });

      it("should remove connected edges when removing a node", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("n3")],
            edges: [
              createMockEdge("n1", "n2"),
              createMockEdge("n2", "n3"),
              createMockEdge("n1", "n3"),
            ],
          });
          useGraphStore.getState().removeNode("n1");
        });

        const state = useGraphStore.getState();
        expect(state.nodes.size).toBe(2);
        expect(state.edges.size).toBe(1); // Only n2->n3 should remain
      });

      it("should remove from selection when removing a node", () => {
        act(() => {
          useGraphStore.getState().addNode(createMockNode("node1"));
          useGraphStore.getState().selectNode("node1");
          useGraphStore.getState().removeNode("node1");
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(0);
      });

      it("should clear hover when removing hovered node", () => {
        act(() => {
          useGraphStore.getState().addNode(createMockNode("node1"));
          useGraphStore.getState().setHoveredNode("node1");
          useGraphStore.getState().removeNode("node1");
        });

        expect(useGraphStore.getState().hoveredNodeId).toBeNull();
      });
    });

    describe("addEdge", () => {
      it("should add an edge", () => {
        const edge = createMockEdge("node1", "node2");

        act(() => {
          useGraphStore.getState().addEdge(edge);
        });

        expect(useGraphStore.getState().edges.size).toBe(1);
      });

      it("should generate ID if not provided", () => {
        act(() => {
          useGraphStore.getState().addEdge({
            source: "a",
            target: "b",
            type: "forward-link",
          });
        });

        const edges = Array.from(useGraphStore.getState().edges.values());
        expect(edges[0].id).toBe("a->b");
      });
    });

    describe("removeEdge", () => {
      it("should remove an edge", () => {
        act(() => {
          useGraphStore.getState().addEdge(createMockEdge("n1", "n2"));
          useGraphStore.getState().removeEdge("n1->n2");
        });

        expect(useGraphStore.getState().edges.size).toBe(0);
      });

      it("should remove from selection when removing an edge", () => {
        act(() => {
          useGraphStore.getState().addEdge(createMockEdge("n1", "n2"));
          useGraphStore.getState().selectEdge("n1->n2");
          useGraphStore.getState().removeEdge("n1->n2");
        });

        expect(useGraphStore.getState().selectedEdgeIds.size).toBe(0);
      });
    });

    describe("updateNodePositions", () => {
      it("should batch update multiple node positions", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [
              createMockNode("n1", { x: 0, y: 0 }),
              createMockNode("n2", { x: 0, y: 0 }),
              createMockNode("n3", { x: 0, y: 0 }),
            ],
            edges: [],
          });

          const positions = new Map([
            ["n1", { x: 100, y: 100 }],
            ["n2", { x: 200, y: 200 }],
          ]);
          useGraphStore.getState().updateNodePositions(positions);
        });

        const state = useGraphStore.getState();
        expect(state.nodes.get("n1")?.x).toBe(100);
        expect(state.nodes.get("n1")?.y).toBe(100);
        expect(state.nodes.get("n2")?.x).toBe(200);
        expect(state.nodes.get("n2")?.y).toBe(200);
        expect(state.nodes.get("n3")?.x).toBe(0); // Unchanged
      });
    });
  });

  describe("Selection", () => {
    beforeEach(() => {
      act(() => {
        useGraphStore.getState().setGraphData({
          nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("n3")],
          edges: [createMockEdge("n1", "n2"), createMockEdge("n2", "n3")],
        });
      });
    });

    describe("selectNode", () => {
      it("should select a single node", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1");
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(1);
        expect(useGraphStore.getState().selectedNodeIds.has("n1")).toBe(true);
      });

      it("should replace selection when not additive", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1");
          useGraphStore.getState().selectNode("n2");
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(1);
        expect(useGraphStore.getState().selectedNodeIds.has("n2")).toBe(true);
      });

      it("should add to selection when additive", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1");
          useGraphStore.getState().selectNode("n2", true);
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(2);
        expect(useGraphStore.getState().selectedNodeIds.has("n1")).toBe(true);
        expect(useGraphStore.getState().selectedNodeIds.has("n2")).toBe(true);
      });

      it("should not select non-existent nodes", () => {
        act(() => {
          useGraphStore.getState().selectNode("nonexistent");
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(0);
      });
    });

    describe("selectNodes", () => {
      it("should select multiple nodes", () => {
        act(() => {
          useGraphStore.getState().selectNodes(["n1", "n2"]);
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(2);
      });

      it("should only select existing nodes", () => {
        act(() => {
          useGraphStore.getState().selectNodes(["n1", "nonexistent", "n2"]);
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(2);
      });
    });

    describe("clearSelection", () => {
      it("should clear all selection", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1", true);
          useGraphStore.getState().selectNode("n2", true);
          useGraphStore.getState().selectEdge("n1->n2", true);
          useGraphStore.getState().clearSelection();
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(0);
        expect(useGraphStore.getState().selectedEdgeIds.size).toBe(0);
      });
    });

    describe("selectAll", () => {
      it("should select all nodes", () => {
        act(() => {
          useGraphStore.getState().selectAll();
        });

        expect(useGraphStore.getState().selectedNodeIds.size).toBe(3);
      });
    });

    describe("selectNeighbors", () => {
      it("should select immediate neighbors at depth 1", () => {
        act(() => {
          useGraphStore.getState().selectNeighbors("n2", 1);
        });

        const selected = useGraphStore.getState().selectedNodeIds;
        expect(selected.has("n2")).toBe(true); // The node itself
        expect(selected.has("n1")).toBe(true); // Neighbor
        expect(selected.has("n3")).toBe(true); // Neighbor
      });

      it("should limit depth correctly", () => {
        // Create a longer chain
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [
              createMockNode("a"),
              createMockNode("b"),
              createMockNode("c"),
              createMockNode("d"),
            ],
            edges: [
              createMockEdge("a", "b"),
              createMockEdge("b", "c"),
              createMockEdge("c", "d"),
            ],
          });
          useGraphStore.getState().selectNeighbors("a", 1);
        });

        const selected = useGraphStore.getState().selectedNodeIds;
        expect(selected.has("a")).toBe(true);
        expect(selected.has("b")).toBe(true);
        expect(selected.has("c")).toBe(false); // Beyond depth 1
        expect(selected.has("d")).toBe(false); // Beyond depth 1
      });
    });
  });

  describe("Viewport", () => {
    describe("setViewport", () => {
      it("should update viewport state", () => {
        act(() => {
          useGraphStore.getState().setViewport({ x: 100, y: 200 });
        });

        expect(useGraphStore.getState().viewport.x).toBe(100);
        expect(useGraphStore.getState().viewport.y).toBe(200);
      });

      it("should merge with existing viewport", () => {
        act(() => {
          useGraphStore.getState().setViewport({ zoom: 2 });
        });

        const viewport = useGraphStore.getState().viewport;
        expect(viewport.zoom).toBe(2);
        expect(viewport.x).toBe(0); // Unchanged
      });
    });

    describe("zoomIn", () => {
      it("should increase zoom level", () => {
        const initialZoom = useGraphStore.getState().viewport.zoom;

        act(() => {
          useGraphStore.getState().zoomIn();
        });

        expect(useGraphStore.getState().viewport.zoom).toBeGreaterThan(initialZoom);
      });

      it("should not exceed max zoom", () => {
        act(() => {
          // Zoom in many times
          for (let i = 0; i < 20; i++) {
            useGraphStore.getState().zoomIn();
          }
        });

        expect(useGraphStore.getState().viewport.zoom).toBeLessThanOrEqual(10);
      });
    });

    describe("zoomOut", () => {
      it("should decrease zoom level", () => {
        const initialZoom = useGraphStore.getState().viewport.zoom;

        act(() => {
          useGraphStore.getState().zoomOut();
        });

        expect(useGraphStore.getState().viewport.zoom).toBeLessThan(initialZoom);
      });

      it("should not go below min zoom", () => {
        act(() => {
          // Zoom out many times
          for (let i = 0; i < 20; i++) {
            useGraphStore.getState().zoomOut();
          }
        });

        expect(useGraphStore.getState().viewport.zoom).toBeGreaterThanOrEqual(0.1);
      });
    });

    describe("zoomToFit", () => {
      it("should fit all nodes in viewport", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [
              createMockNode("n1", { x: 0, y: 0 }),
              createMockNode("n2", { x: 500, y: 500 }),
            ],
            edges: [],
          });
          useGraphStore.getState().setViewport({ width: 800, height: 600 });
          useGraphStore.getState().zoomToFit();
        });

        // After fit, zoom should be adjusted
        const zoom = useGraphStore.getState().viewport.zoom;
        expect(zoom).toBeGreaterThan(0);
        expect(zoom).toBeLessThanOrEqual(2); // Max fit zoom
      });

      it("should do nothing when no nodes", () => {
        const initialViewport = { ...useGraphStore.getState().viewport };

        act(() => {
          useGraphStore.getState().zoomToFit();
        });

        expect(useGraphStore.getState().viewport.zoom).toBe(initialViewport.zoom);
      });
    });

    describe("zoomToNode", () => {
      it("should center on a specific node", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [createMockNode("n1", { x: 500, y: 300 })],
            edges: [],
          });
          useGraphStore.getState().setViewport({ width: 800, height: 600 });
          useGraphStore.getState().zoomToNode("n1");
        });

        // Node should be centered (viewport adjusted)
        const viewport = useGraphStore.getState().viewport;
        // With zoom=1, centering on (500, 300) with 800x600 viewport:
        // x = -500 * 1 + 400 = -100
        // y = -300 * 1 + 300 = 0
        expect(viewport.x).toBe(-100);
        expect(viewport.y).toBe(0);
      });

      it("should do nothing for non-existent node", () => {
        const initialViewport = { ...useGraphStore.getState().viewport };

        act(() => {
          useGraphStore.getState().zoomToNode("nonexistent");
        });

        expect(useGraphStore.getState().viewport.x).toBe(initialViewport.x);
      });
    });

    describe("panTo", () => {
      it("should pan to specific coordinates", () => {
        act(() => {
          useGraphStore.getState().panTo(150, 250);
        });

        expect(useGraphStore.getState().viewport.x).toBe(150);
        expect(useGraphStore.getState().viewport.y).toBe(250);
      });
    });
  });

  describe("Filters", () => {
    describe("setFilter", () => {
      it("should update a specific filter", () => {
        act(() => {
          useGraphStore.getState().setFilter("searchQuery", "test");
        });

        expect(useGraphStore.getState().filters.searchQuery).toBe("test");
      });

      it("should update numeric filters", () => {
        act(() => {
          useGraphStore.getState().setFilter("minDegree", 3);
        });

        expect(useGraphStore.getState().filters.minDegree).toBe(3);
      });
    });

    describe("toggleNodeType", () => {
      it("should add type when not present", () => {
        act(() => {
          useGraphStore.getState().toggleNodeType("ems__Task");
        });

        expect(useGraphStore.getState().filters.nodeTypes.has("ems__Task")).toBe(true);
      });

      it("should remove type when present", () => {
        act(() => {
          useGraphStore.getState().toggleNodeType("ems__Task");
          useGraphStore.getState().toggleNodeType("ems__Task");
        });

        expect(useGraphStore.getState().filters.nodeTypes.has("ems__Task")).toBe(false);
      });
    });

    describe("resetFilters", () => {
      it("should reset all filters to defaults", () => {
        act(() => {
          useGraphStore.getState().setFilter("searchQuery", "test");
          useGraphStore.getState().setFilter("minDegree", 5);
          useGraphStore.getState().toggleNodeType("ems__Task");
          useGraphStore.getState().resetFilters();
        });

        const filters = useGraphStore.getState().filters;
        expect(filters.searchQuery).toBe("");
        expect(filters.minDegree).toBe(0);
        expect(filters.nodeTypes.size).toBe(0);
      });
    });
  });

  describe("Layout", () => {
    describe("setLayoutAlgorithm", () => {
      it("should change layout algorithm", () => {
        act(() => {
          useGraphStore.getState().setLayoutAlgorithm("hierarchical");
        });

        expect(useGraphStore.getState().layout.algorithm).toBe("hierarchical");
      });
    });

    describe("startSimulation", () => {
      it("should start simulation and set alpha to 1", () => {
        act(() => {
          useGraphStore.getState().startSimulation();
        });

        expect(useGraphStore.getState().layout.isSimulating).toBe(true);
        expect(useGraphStore.getState().layout.alpha).toBe(1);
      });
    });

    describe("stopSimulation", () => {
      it("should stop simulation and set alpha to 0", () => {
        act(() => {
          useGraphStore.getState().startSimulation();
          useGraphStore.getState().stopSimulation();
        });

        expect(useGraphStore.getState().layout.isSimulating).toBe(false);
        expect(useGraphStore.getState().layout.alpha).toBe(0);
      });
    });

    describe("toggleFreeze", () => {
      it("should toggle frozen state", () => {
        expect(useGraphStore.getState().layout.frozen).toBe(false);

        act(() => {
          useGraphStore.getState().toggleFreeze();
        });

        expect(useGraphStore.getState().layout.frozen).toBe(true);
      });

      it("should stop simulation when freezing", () => {
        act(() => {
          useGraphStore.getState().startSimulation();
          useGraphStore.getState().toggleFreeze();
        });

        expect(useGraphStore.getState().layout.isSimulating).toBe(false);
      });
    });

    describe("setSimulationAlpha", () => {
      it("should clamp alpha between 0 and 1", () => {
        act(() => {
          useGraphStore.getState().setSimulationAlpha(1.5);
        });

        expect(useGraphStore.getState().layout.alpha).toBe(1);

        act(() => {
          useGraphStore.getState().setSimulationAlpha(-0.5);
        });

        expect(useGraphStore.getState().layout.alpha).toBe(0);
      });

      it("should stop simulation when alpha reaches 0", () => {
        act(() => {
          useGraphStore.getState().startSimulation();
          useGraphStore.getState().setSimulationAlpha(0);
        });

        expect(useGraphStore.getState().layout.isSimulating).toBe(false);
      });
    });
  });

  describe("UI", () => {
    describe("toggleSidebar", () => {
      it("should toggle sidebar visibility", () => {
        expect(useGraphStore.getState().ui.sidebarOpen).toBe(true);

        act(() => {
          useGraphStore.getState().toggleSidebar();
        });

        expect(useGraphStore.getState().ui.sidebarOpen).toBe(false);
      });
    });

    describe("Context Menu", () => {
      it("should show context menu", () => {
        act(() => {
          useGraphStore.getState().showContextMenu(100, 200, { id: "n1", type: "node" });
        });

        const contextMenu = useGraphStore.getState().ui.contextMenu;
        expect(contextMenu.visible).toBe(true);
        expect(contextMenu.x).toBe(100);
        expect(contextMenu.y).toBe(200);
        expect(contextMenu.targetId).toBe("n1");
        expect(contextMenu.targetType).toBe("node");
      });

      it("should hide context menu", () => {
        act(() => {
          useGraphStore.getState().showContextMenu(100, 200, { id: null, type: "canvas" });
          useGraphStore.getState().hideContextMenu();
        });

        expect(useGraphStore.getState().ui.contextMenu.visible).toBe(false);
      });
    });

    describe("Tooltip", () => {
      it("should show tooltip with content", () => {
        const content = { title: "Test Node", subtitle: "Description" };

        act(() => {
          useGraphStore.getState().showTooltip(50, 100, content);
        });

        const tooltip = useGraphStore.getState().ui.tooltip;
        expect(tooltip.visible).toBe(true);
        expect(tooltip.x).toBe(50);
        expect(tooltip.y).toBe(100);
        expect(tooltip.content).toEqual(content);
      });

      it("should hide tooltip", () => {
        act(() => {
          useGraphStore.getState().showTooltip(50, 100, { title: "Test" });
          useGraphStore.getState().hideTooltip();
        });

        expect(useGraphStore.getState().ui.tooltip.visible).toBe(false);
      });
    });

    describe("Minimap", () => {
      it("should toggle minimap visibility", () => {
        expect(useGraphStore.getState().ui.minimap.visible).toBe(true);

        act(() => {
          useGraphStore.getState().toggleMinimap();
        });

        expect(useGraphStore.getState().ui.minimap.visible).toBe(false);
      });

      it("should change minimap position", () => {
        act(() => {
          useGraphStore.getState().setMinimapPosition("top-left");
        });

        expect(useGraphStore.getState().ui.minimap.position).toBe("top-left");
      });
    });
  });

  describe("Reset", () => {
    it("should reset entire store to initial state using setState", () => {
      // Set up various state
      act(() => {
        useGraphStore.getState().setGraphData({
          nodes: [createMockNode("n1")],
          edges: [],
        });
        useGraphStore.getState().selectNode("n1");
        useGraphStore.getState().setFilter("searchQuery", "test");
        useGraphStore.getState().setLayoutAlgorithm("hierarchical");
        // Reset via setState (similar to resetStoreForTest)
        resetStoreForTest();
      });

      const state = useGraphStore.getState();
      expect(state.nodes.size).toBe(0);
      expect(state.edges.size).toBe(0);
      expect(state.selectedNodeIds.size).toBe(0);
      expect(state.filters.searchQuery).toBe("");
    });
  });

  describe("Undo/Redo", () => {
    it("should support undo after data changes", () => {
      act(() => {
        useGraphStore.getState().addNode(createMockNode("n1"));
      });

      expect(useGraphStore.getState().nodes.size).toBe(1);

      act(() => {
        undo();
      });

      // After undo, node should be removed
      expect(useGraphStore.getState().nodes.size).toBe(0);
    });

    it("should support redo after undo", () => {
      act(() => {
        useGraphStore.getState().addNode(createMockNode("n1"));
        undo();
        redo();
      });

      expect(useGraphStore.getState().nodes.size).toBe(1);
    });

    it("should report canUndo and canRedo correctly after explicit clear", () => {
      // Clear temporal history explicitly before this test
      act(() => {
        clearHistory();
      });

      expect(canUndo()).toBe(false);
      expect(canRedo()).toBe(false);

      act(() => {
        useGraphStore.getState().addNode(createMockNode("n1"));
      });

      expect(canUndo()).toBe(true);
      expect(canRedo()).toBe(false);

      act(() => {
        undo();
      });

      // After undo of the addNode, we're at initial state
      expect(canUndo()).toBe(false);
      expect(canRedo()).toBe(true);
    });
  });

  describe("getDefaultState", () => {
    it("should return default state object", () => {
      const defaultState = getDefaultState();
      expect(defaultState.nodes.size).toBe(0);
      expect(defaultState.edges.size).toBe(0);
      expect(defaultState.viewport.zoom).toBe(1);
      expect(defaultState.filters.showOrphans).toBe(true);
    });
  });
});
