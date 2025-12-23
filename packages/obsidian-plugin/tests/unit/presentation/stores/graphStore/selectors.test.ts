/**
 * Unit tests for GraphStore selectors
 */

import { renderHook, act } from "@testing-library/react";
import type { GraphNode, GraphEdge } from "exocortex";
import { useGraphStore } from "../../../../../src/presentation/stores/graphStore";
import {
  useNodes,
  useNode,
  useSelectedNodes,
  useSelectedNodeIds,
  useIsNodeSelected,
  useHoveredNode,
  useVisibleNodes,
  useFilteredNodes,
  useEdges,
  useEdge,
  useSelectedEdges,
  useIsEdgeSelected,
  useNodeEdges,
  useVisibleEdges,
  useViewport,
  useZoom,
  useFilters,
  useSearchQuery,
  useVisibleNodeTypes,
  useLayout,
  useLayoutAlgorithm,
  useIsSimulating,
  useIsFrozen,
  useUI,
  useIsSidebarOpen,
  useContextMenu,
  useTooltip,
  useMinimap,
  useGraphStats,
  useMetrics,
  useNodeTypes,
  useEdgeTypes,
  useNodeNeighbors,
  useNodeDegree,
  useBoundingBox,
} from "../../../../../src/presentation/stores/graphStore/selectors";
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
 */
function resetStoreForTest(): void {
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

describe("GraphStore Selectors", () => {
  beforeEach(() => {
    act(() => {
      resetStoreForTest();
    });
    localStorageMock.clear();
  });

  describe("Node Selectors", () => {
    beforeEach(() => {
      act(() => {
        useGraphStore.getState().setGraphData({
          nodes: [
            createMockNode("n1", { assetClass: "ems__Task", x: 100, y: 100 }),
            createMockNode("n2", { assetClass: "ems__Project", x: 200, y: 200 }),
            createMockNode("n3", { assetClass: "ems__Task", x: 300, y: 300 }),
          ],
          edges: [createMockEdge("n1", "n2"), createMockEdge("n2", "n3")],
        });
      });
    });

    describe("useNodes", () => {
      it("should return all nodes as array", () => {
        const { result } = renderHook(() => useNodes());
        expect(result.current.length).toBe(3);
      });
    });

    describe("useNode", () => {
      it("should return specific node by ID", () => {
        const { result } = renderHook(() => useNode("n1"));
        expect(result.current?.id).toBe("n1");
        expect(result.current?.assetClass).toBe("ems__Task");
      });

      it("should return undefined for non-existent node", () => {
        const { result } = renderHook(() => useNode("nonexistent"));
        expect(result.current).toBeUndefined();
      });
    });

    describe("useSelectedNodes", () => {
      it("should return empty array when nothing selected", () => {
        const { result } = renderHook(() => useSelectedNodes());
        expect(result.current.length).toBe(0);
      });

      it("should return selected nodes", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1");
          useGraphStore.getState().selectNode("n2", true);
        });

        const { result } = renderHook(() => useSelectedNodes());
        expect(result.current.length).toBe(2);
        expect(result.current.map((n) => n.id)).toContain("n1");
        expect(result.current.map((n) => n.id)).toContain("n2");
      });
    });

    describe("useSelectedNodeIds", () => {
      it("should return Set of selected IDs", () => {
        act(() => {
          useGraphStore.getState().selectNodes(["n1", "n3"]);
        });

        const { result } = renderHook(() => useSelectedNodeIds());
        expect(result.current.size).toBe(2);
        expect(result.current.has("n1")).toBe(true);
        expect(result.current.has("n3")).toBe(true);
      });
    });

    describe("useIsNodeSelected", () => {
      it("should return true for selected node", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1");
        });

        const { result } = renderHook(() => useIsNodeSelected("n1"));
        expect(result.current).toBe(true);
      });

      it("should return false for unselected node", () => {
        const { result } = renderHook(() => useIsNodeSelected("n1"));
        expect(result.current).toBe(false);
      });
    });

    describe("useHoveredNode", () => {
      it("should return null when no node hovered", () => {
        const { result } = renderHook(() => useHoveredNode());
        expect(result.current).toBeNull();
      });

      it("should return hovered node", () => {
        act(() => {
          useGraphStore.getState().setHoveredNode("n2");
        });

        const { result } = renderHook(() => useHoveredNode());
        expect(result.current?.id).toBe("n2");
      });
    });

    describe("useVisibleNodes", () => {
      it("should return nodes within viewport", () => {
        act(() => {
          useGraphStore.getState().setViewport({
            width: 400,
            height: 400,
            x: 0,
            y: 0,
            zoom: 1,
          });
        });

        const { result } = renderHook(() => useVisibleNodes());
        // All nodes should be visible with this viewport
        expect(result.current.length).toBe(3);
      });

      it("should filter by search query", () => {
        act(() => {
          useGraphStore
            .getState()
            .setGraphData({
              nodes: [
                createMockNode("apple", { title: "Apple Task" }),
                createMockNode("banana", { title: "Banana Task" }),
                createMockNode("cherry", { title: "Cherry Task" }),
              ],
              edges: [],
            });
          useGraphStore.getState().setViewport({ width: 1000, height: 1000 });
          useGraphStore.getState().setFilter("searchQuery", "apple");
        });

        const { result } = renderHook(() => useVisibleNodes());
        expect(result.current.length).toBe(1);
        expect(result.current[0].id).toBe("apple");
      });

      it("should filter orphans when showOrphans is false", () => {
        act(() => {
          // n1 and n2 are connected, n3 has no edges here
          useGraphStore.getState().setGraphData({
            nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("orphan")],
            edges: [createMockEdge("n1", "n2")],
          });
          useGraphStore.getState().setViewport({ width: 1000, height: 1000 });
          useGraphStore.getState().setFilter("showOrphans", false);
        });

        const { result } = renderHook(() => useVisibleNodes());
        expect(result.current.length).toBe(2);
        expect(result.current.map((n) => n.id)).not.toContain("orphan");
      });
    });

    describe("useFilteredNodes", () => {
      it("should apply filters without viewport culling", () => {
        act(() => {
          useGraphStore.getState().setFilter("minDegree", 2);
        });

        // Only n2 has 2 connections
        const { result } = renderHook(() => useFilteredNodes());
        expect(result.current.length).toBe(1);
        expect(result.current[0].id).toBe("n2");
      });
    });
  });

  describe("Edge Selectors", () => {
    beforeEach(() => {
      act(() => {
        useGraphStore.getState().setGraphData({
          nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("n3")],
          edges: [
            createMockEdge("n1", "n2", { type: "forward-link" }),
            createMockEdge("n2", "n3", { type: "hierarchy" }),
          ],
        });
      });
    });

    describe("useEdges", () => {
      it("should return all edges as array", () => {
        const { result } = renderHook(() => useEdges());
        expect(result.current.length).toBe(2);
      });
    });

    describe("useEdge", () => {
      it("should return specific edge by ID", () => {
        const { result } = renderHook(() => useEdge("n1->n2"));
        expect(result.current?.source).toBe("n1");
        expect(result.current?.target).toBe("n2");
      });
    });

    describe("useSelectedEdges", () => {
      it("should return selected edges", () => {
        act(() => {
          useGraphStore.getState().selectEdge("n1->n2");
        });

        const { result } = renderHook(() => useSelectedEdges());
        expect(result.current.length).toBe(1);
        expect(result.current[0].id).toBe("n1->n2");
      });
    });

    describe("useIsEdgeSelected", () => {
      it("should return correct selection state", () => {
        act(() => {
          useGraphStore.getState().selectEdge("n1->n2");
        });

        const { result: r1 } = renderHook(() => useIsEdgeSelected("n1->n2"));
        const { result: r2 } = renderHook(() => useIsEdgeSelected("n2->n3"));

        expect(r1.current).toBe(true);
        expect(r2.current).toBe(false);
      });
    });

    describe("useNodeEdges", () => {
      it("should return edges connected to a node", () => {
        const { result } = renderHook(() => useNodeEdges("n2"));
        expect(result.current.length).toBe(2); // Both edges connect to n2
      });

      it("should return empty for unconnected node", () => {
        act(() => {
          useGraphStore.getState().addNode(createMockNode("isolated"));
        });

        const { result } = renderHook(() => useNodeEdges("isolated"));
        expect(result.current.length).toBe(0);
      });
    });

    describe("useVisibleEdges", () => {
      it("should return edges with visible endpoints", () => {
        const { result } = renderHook(() => useVisibleEdges());
        expect(result.current.length).toBe(2);
      });

      it("should filter by edge type", () => {
        act(() => {
          useGraphStore.getState().toggleEdgeType("forward-link");
        });

        const { result } = renderHook(() => useVisibleEdges());
        expect(result.current.length).toBe(1);
        expect(result.current[0].type).toBe("forward-link");
      });
    });
  });

  describe("Viewport Selectors", () => {
    describe("useViewport", () => {
      it("should return viewport state", () => {
        const { result } = renderHook(() => useViewport());
        expect(result.current.zoom).toBe(1);
        expect(result.current.x).toBe(0);
        expect(result.current.y).toBe(0);
      });
    });

    describe("useZoom", () => {
      it("should return current zoom level", () => {
        act(() => {
          useGraphStore.getState().setViewport({ zoom: 2.5 });
        });

        const { result } = renderHook(() => useZoom());
        expect(result.current).toBe(2.5);
      });
    });
  });

  describe("Filter Selectors", () => {
    describe("useFilters", () => {
      it("should return filter state", () => {
        const { result } = renderHook(() => useFilters());
        expect(result.current.showOrphans).toBe(true);
        expect(result.current.showLabels).toBe(true);
        expect(result.current.minDegree).toBe(0);
      });
    });

    describe("useSearchQuery", () => {
      it("should return current search query", () => {
        act(() => {
          useGraphStore.getState().setFilter("searchQuery", "test query");
        });

        const { result } = renderHook(() => useSearchQuery());
        expect(result.current).toBe("test query");
      });
    });

    describe("useVisibleNodeTypes", () => {
      it("should return Set of visible node types", () => {
        act(() => {
          useGraphStore.getState().toggleNodeType("ems__Task");
          useGraphStore.getState().toggleNodeType("ems__Project");
        });

        const { result } = renderHook(() => useVisibleNodeTypes());
        expect(result.current.size).toBe(2);
        expect(result.current.has("ems__Task")).toBe(true);
      });
    });
  });

  describe("Layout Selectors", () => {
    describe("useLayout", () => {
      it("should return layout state", () => {
        const { result } = renderHook(() => useLayout());
        expect(result.current.algorithm).toBe("force");
        expect(result.current.isSimulating).toBe(false);
      });
    });

    describe("useLayoutAlgorithm", () => {
      it("should return current algorithm", () => {
        act(() => {
          useGraphStore.getState().setLayoutAlgorithm("radial");
        });

        const { result } = renderHook(() => useLayoutAlgorithm());
        expect(result.current).toBe("radial");
      });
    });

    describe("useIsSimulating", () => {
      it("should return simulation state", () => {
        const { result: r1 } = renderHook(() => useIsSimulating());
        expect(r1.current).toBe(false);

        act(() => {
          useGraphStore.getState().startSimulation();
        });

        const { result: r2 } = renderHook(() => useIsSimulating());
        expect(r2.current).toBe(true);
      });
    });

    describe("useIsFrozen", () => {
      it("should return frozen state", () => {
        const { result: r1 } = renderHook(() => useIsFrozen());
        expect(r1.current).toBe(false);

        act(() => {
          useGraphStore.getState().toggleFreeze();
        });

        const { result: r2 } = renderHook(() => useIsFrozen());
        expect(r2.current).toBe(true);
      });
    });
  });

  describe("UI Selectors", () => {
    describe("useUI", () => {
      it("should return complete UI state", () => {
        const { result } = renderHook(() => useUI());
        expect(result.current.sidebarOpen).toBe(true);
        expect(result.current.minimap.visible).toBe(true);
      });
    });

    describe("useIsSidebarOpen", () => {
      it("should return sidebar state", () => {
        const { result } = renderHook(() => useIsSidebarOpen());
        expect(result.current).toBe(true);
      });
    });

    describe("useContextMenu", () => {
      it("should return context menu state", () => {
        act(() => {
          useGraphStore.getState().showContextMenu(100, 200, { id: "n1", type: "node" });
        });

        const { result } = renderHook(() => useContextMenu());
        expect(result.current.visible).toBe(true);
        expect(result.current.x).toBe(100);
        expect(result.current.y).toBe(200);
      });
    });

    describe("useTooltip", () => {
      it("should return tooltip state", () => {
        act(() => {
          useGraphStore.getState().showTooltip(50, 75, { title: "Test" });
        });

        const { result } = renderHook(() => useTooltip());
        expect(result.current.visible).toBe(true);
        expect(result.current.content?.title).toBe("Test");
      });
    });

    describe("useMinimap", () => {
      it("should return minimap state", () => {
        const { result } = renderHook(() => useMinimap());
        expect(result.current.visible).toBe(true);
        expect(result.current.position).toBe("bottom-right");
      });
    });
  });

  describe("Statistics Selectors", () => {
    beforeEach(() => {
      act(() => {
        useGraphStore.getState().setGraphData({
          nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("n3")],
          edges: [createMockEdge("n1", "n2")],
        });
      });
    });

    describe("useGraphStats", () => {
      it("should return graph statistics", () => {
        act(() => {
          useGraphStore.getState().selectNode("n1");
        });

        const { result } = renderHook(() => useGraphStats());
        expect(result.current.totalNodes).toBe(3);
        expect(result.current.totalEdges).toBe(1);
        expect(result.current.selectedNodeCount).toBe(1);
      });
    });

    describe("useMetrics", () => {
      it("should return performance metrics", () => {
        act(() => {
          useGraphStore.getState().updateMetrics({ fps: 60, renderTime: 16 });
        });

        const { result } = renderHook(() => useMetrics());
        expect(result.current.fps).toBe(60);
        expect(result.current.renderTime).toBe(16);
      });
    });

    describe("useNodeTypes", () => {
      it("should return unique node types", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [
              createMockNode("n1", { assetClass: "ems__Task" }),
              createMockNode("n2", { assetClass: "ems__Project" }),
              createMockNode("n3", { assetClass: "ems__Task" }),
            ],
            edges: [],
          });
        });

        const { result } = renderHook(() => useNodeTypes());
        expect(result.current.length).toBe(2);
        expect(result.current).toContain("ems__Task");
        expect(result.current).toContain("ems__Project");
      });
    });

    describe("useEdgeTypes", () => {
      it("should return unique edge types", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [createMockNode("n1"), createMockNode("n2"), createMockNode("n3")],
            edges: [
              createMockEdge("n1", "n2", { type: "forward-link" }),
              createMockEdge("n2", "n3", { type: "hierarchy" }),
              createMockEdge("n1", "n3", { type: "forward-link" }),
            ],
          });
        });

        const { result } = renderHook(() => useEdgeTypes());
        expect(result.current.length).toBe(2);
        expect(result.current).toContain("forward-link");
        expect(result.current).toContain("hierarchy");
      });
    });
  });

  describe("Computed Selectors", () => {
    beforeEach(() => {
      act(() => {
        useGraphStore.getState().setGraphData({
          nodes: [
            createMockNode("center"),
            createMockNode("neighbor1"),
            createMockNode("neighbor2"),
            createMockNode("isolated"),
          ],
          edges: [
            createMockEdge("center", "neighbor1"),
            createMockEdge("center", "neighbor2"),
          ],
        });
      });
    });

    describe("useNodeNeighbors", () => {
      it("should return neighboring nodes", () => {
        const { result } = renderHook(() => useNodeNeighbors("center"));
        expect(result.current.length).toBe(2);
        expect(result.current.map((n) => n.id)).toContain("neighbor1");
        expect(result.current.map((n) => n.id)).toContain("neighbor2");
      });

      it("should return empty for isolated node", () => {
        const { result } = renderHook(() => useNodeNeighbors("isolated"));
        expect(result.current.length).toBe(0);
      });
    });

    describe("useNodeDegree", () => {
      it("should return correct degree", () => {
        const { result: r1 } = renderHook(() => useNodeDegree("center"));
        expect(r1.current).toBe(2);

        const { result: r2 } = renderHook(() => useNodeDegree("neighbor1"));
        expect(r2.current).toBe(1);

        const { result: r3 } = renderHook(() => useNodeDegree("isolated"));
        expect(r3.current).toBe(0);
      });
    });

    describe("useBoundingBox", () => {
      it("should return bounding box of all nodes", () => {
        act(() => {
          useGraphStore.getState().setGraphData({
            nodes: [
              createMockNode("n1", { x: 0, y: 0 }),
              createMockNode("n2", { x: 100, y: 50 }),
              createMockNode("n3", { x: 50, y: 100 }),
            ],
            edges: [],
          });
        });

        const { result } = renderHook(() => useBoundingBox());
        expect(result.current.minX).toBe(0);
        expect(result.current.maxX).toBe(100);
        expect(result.current.minY).toBe(0);
        expect(result.current.maxY).toBe(100);
        expect(result.current.width).toBe(100);
        expect(result.current.height).toBe(100);
      });

      it("should return zeros for empty graph", () => {
        act(() => {
          useGraphStore.getState().reset();
        });

        const { result } = renderHook(() => useBoundingBox());
        expect(result.current.width).toBe(0);
        expect(result.current.height).toBe(0);
      });
    });
  });
});
