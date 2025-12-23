/**
 * Zustand store for graph state management.
 * Provides reactive state with persistence and devtools support.
 */

import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { GraphNode, GraphEdge } from "exocortex";

// Enable Immer's MapSet plugin for Map and Set support
enableMapSet();

import type {
  GraphStore,
  GraphState,
  GraphData,
  ViewportState,
  FilterState,
  LayoutAlgorithm,
  ContextMenuTarget,
  TooltipContent,
  MinimapPosition,
  Position,
  GraphMetrics,
} from "./types";

/**
 * Default viewport state
 */
const DEFAULT_VIEWPORT: ViewportState = {
  x: 0,
  y: 0,
  zoom: 1,
  width: 800,
  height: 600,
};

/**
 * Default filter state
 */
const DEFAULT_FILTERS: FilterState = {
  nodeTypes: new Set<string>(),
  edgeTypes: new Set<string>(),
  searchQuery: "",
  showOrphans: true,
  showLabels: true,
  minDegree: 0,
};

/**
 * Default initial state
 */
const DEFAULT_STATE: GraphState = {
  // Data
  nodes: new Map(),
  edges: new Map(),

  // Selection
  selectedNodeIds: new Set(),
  selectedEdgeIds: new Set(),
  hoveredNodeId: null,
  hoveredEdgeId: null,

  // Viewport
  viewport: { ...DEFAULT_VIEWPORT },

  // Filters
  filters: { ...DEFAULT_FILTERS },

  // Layout
  layout: {
    algorithm: "force",
    isSimulating: false,
    alpha: 0,
    frozen: false,
    focusNodeId: null,
  },

  // UI
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

  // Metrics
  metrics: {
    fps: 0,
    nodeCount: 0,
    visibleNodeCount: 0,
    renderTime: 0,
    lastUpdate: 0,
  },
};

/**
 * Zoom step multiplier
 */
const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

/**
 * Simple undo/redo history management
 */
interface HistoryState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
}

const historyStack: HistoryState[] = [];
const futureStack: HistoryState[] = [];
const MAX_HISTORY = 50;

function captureState(state: GraphState): HistoryState {
  return {
    nodes: new Map(state.nodes),
    edges: new Map(state.edges),
    selectedNodeIds: new Set(state.selectedNodeIds),
    selectedEdgeIds: new Set(state.selectedEdgeIds),
  };
}

function pushHistory(state: GraphState): void {
  historyStack.push(captureState(state));
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  }
  // Clear redo stack on new action
  futureStack.length = 0;
}

/**
 * Create the graph store with middleware
 */
export const useGraphStore = create<GraphStore>()(
  persist(
    subscribeWithSelector(
      immer<GraphStore>((set, get) => ({
        // Initial state
        ...DEFAULT_STATE,

        // ============================================================
        // Data Mutations
        // ============================================================

        setGraphData: (data: GraphData) =>
          set((state: GraphState) => {
            pushHistory(state);
            state.nodes = new Map(data.nodes.map((n) => [n.id, n]));
            state.edges = new Map(
              data.edges.map((e) => [e.id ?? `${e.source}->${e.target}`, e])
            );
            state.metrics.nodeCount = data.nodes.length;
            state.metrics.lastUpdate = Date.now();
            // Clear selection when data changes
            state.selectedNodeIds = new Set();
            state.selectedEdgeIds = new Set();
          }),

        addNode: (node: GraphNode) =>
          set((state: GraphState) => {
            pushHistory(state);
            state.nodes.set(node.id, node);
            state.metrics.nodeCount = state.nodes.size;
            state.metrics.lastUpdate = Date.now();
          }),

        updateNode: (id: string, updates: Partial<GraphNode>) =>
          set((state: GraphState) => {
            const node = state.nodes.get(id);
            if (node) {
              pushHistory(state);
              state.nodes.set(id, { ...node, ...updates });
              state.metrics.lastUpdate = Date.now();
            }
          }),

        removeNode: (id: string) =>
          set((state: GraphState) => {
            pushHistory(state);
            state.nodes.delete(id);
            // Remove connected edges
            for (const [edgeId, edge] of state.edges) {
              if (edge.source === id || edge.target === id) {
                state.edges.delete(edgeId);
              }
            }
            // Remove from selection
            state.selectedNodeIds.delete(id);
            if (state.hoveredNodeId === id) {
              state.hoveredNodeId = null;
            }
            state.metrics.nodeCount = state.nodes.size;
            state.metrics.lastUpdate = Date.now();
          }),

        addEdge: (edge: GraphEdge) =>
          set((state: GraphState) => {
            pushHistory(state);
            const edgeId = edge.id ?? `${edge.source}->${edge.target}`;
            state.edges.set(edgeId, { ...edge, id: edgeId });
            state.metrics.lastUpdate = Date.now();
          }),

        removeEdge: (id: string) =>
          set((state: GraphState) => {
            pushHistory(state);
            state.edges.delete(id);
            state.selectedEdgeIds.delete(id);
            if (state.hoveredEdgeId === id) {
              state.hoveredEdgeId = null;
            }
            state.metrics.lastUpdate = Date.now();
          }),

        // ============================================================
        // Batch Operations
        // ============================================================

        updateNodePositions: (positions: Map<string, Position>) =>
          set((state: GraphState) => {
            // Don't capture history for position updates (too frequent)
            for (const [id, pos] of positions) {
              const node = state.nodes.get(id);
              if (node) {
                node.x = pos.x;
                node.y = pos.y;
              }
            }
            state.metrics.lastUpdate = Date.now();
          }),

        // ============================================================
        // Selection
        // ============================================================

        selectNode: (id: string, additive = false) =>
          set((state: GraphState) => {
            if (!additive) {
              state.selectedNodeIds = new Set();
              state.selectedEdgeIds = new Set();
            }
            if (state.nodes.has(id)) {
              state.selectedNodeIds.add(id);
            }
          }),

        selectNodes: (ids: string[]) =>
          set((state: GraphState) => {
            state.selectedNodeIds = new Set(ids.filter((id) => state.nodes.has(id)));
            state.selectedEdgeIds = new Set();
          }),

        selectEdge: (id: string, additive = false) =>
          set((state: GraphState) => {
            if (!additive) {
              state.selectedNodeIds = new Set();
              state.selectedEdgeIds = new Set();
            }
            if (state.edges.has(id)) {
              state.selectedEdgeIds.add(id);
            }
          }),

        clearSelection: () =>
          set((state: GraphState) => {
            state.selectedNodeIds = new Set();
            state.selectedEdgeIds = new Set();
          }),

        selectAll: () =>
          set((state: GraphState) => {
            state.selectedNodeIds = new Set(state.nodes.keys());
            state.selectedEdgeIds = new Set();
          }),

        selectNeighbors: (nodeId: string, depth = 1) =>
          set((state: GraphState) => {
            const neighbors = new Set<string>([nodeId]);
            const visited = new Set<string>();
            const queue = [{ id: nodeId, currentDepth: 0 }];

            while (queue.length > 0) {
              const item = queue.shift();
              if (!item) break;
              const { id, currentDepth } = item;
              if (visited.has(id) || currentDepth > depth) continue;
              visited.add(id);
              neighbors.add(id);

              // Find connected nodes via edges
              for (const edge of state.edges.values()) {
                if (edge.source === id && !visited.has(edge.target)) {
                  queue.push({ id: edge.target, currentDepth: currentDepth + 1 });
                }
                if (edge.target === id && !visited.has(edge.source)) {
                  queue.push({ id: edge.source, currentDepth: currentDepth + 1 });
                }
              }
            }

            state.selectedNodeIds = neighbors;
          }),

        // ============================================================
        // Hover
        // ============================================================

        setHoveredNode: (id: string | null) =>
          set((state: GraphState) => {
            state.hoveredNodeId = id;
          }),

        setHoveredEdge: (id: string | null) =>
          set((state: GraphState) => {
            state.hoveredEdgeId = id;
          }),

        // ============================================================
        // Viewport
        // ============================================================

        setViewport: (viewport: Partial<ViewportState>) =>
          set((state: GraphState) => {
            state.viewport = { ...state.viewport, ...viewport };
          }),

        zoomIn: () =>
          set((state: GraphState) => {
            const newZoom = Math.min(state.viewport.zoom * ZOOM_STEP, MAX_ZOOM);
            // Zoom towards center
            const centerX = state.viewport.width / 2;
            const centerY = state.viewport.height / 2;
            const scale = newZoom / state.viewport.zoom;
            state.viewport.x = centerX - (centerX - state.viewport.x) * scale;
            state.viewport.y = centerY - (centerY - state.viewport.y) * scale;
            state.viewport.zoom = newZoom;
          }),

        zoomOut: () =>
          set((state: GraphState) => {
            const newZoom = Math.max(state.viewport.zoom / ZOOM_STEP, MIN_ZOOM);
            // Zoom towards center
            const centerX = state.viewport.width / 2;
            const centerY = state.viewport.height / 2;
            const scale = newZoom / state.viewport.zoom;
            state.viewport.x = centerX - (centerX - state.viewport.x) * scale;
            state.viewport.y = centerY - (centerY - state.viewport.y) * scale;
            state.viewport.zoom = newZoom;
          }),

        zoomToFit: () => {
          const state = get();
          if (state.nodes.size === 0) return;

          // Calculate bounding box
          let minX = Infinity,
            maxX = -Infinity;
          let minY = Infinity,
            maxY = -Infinity;

          for (const node of state.nodes.values()) {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }

          const padding = 50;
          const contentWidth = maxX - minX + padding * 2;
          const contentHeight = maxY - minY + padding * 2;

          const zoom = Math.min(
            Math.max(state.viewport.width / contentWidth, MIN_ZOOM),
            Math.max(state.viewport.height / contentHeight, MIN_ZOOM),
            2 // Max zoom when fitting
          );

          set((s: GraphState) => {
            s.viewport.zoom = zoom;
            s.viewport.x = (-(minX + maxX) / 2) * zoom + s.viewport.width / 2;
            s.viewport.y = (-(minY + maxY) / 2) * zoom + s.viewport.height / 2;
          });
        },

        zoomToNode: (nodeId: string) => {
          const state = get();
          const node = state.nodes.get(nodeId);
          if (!node) return;

          const x = node.x ?? 0;
          const y = node.y ?? 0;

          set((s: GraphState) => {
            s.viewport.x = -x * s.viewport.zoom + s.viewport.width / 2;
            s.viewport.y = -y * s.viewport.zoom + s.viewport.height / 2;
          });
        },

        panTo: (x: number, y: number) =>
          set((state: GraphState) => {
            state.viewport.x = x;
            state.viewport.y = y;
          }),

        // ============================================================
        // Filters
        // ============================================================

        setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
          set((state: GraphState) => {
            state.filters[key] = value;
          }),

        toggleNodeType: (type: string) =>
          set((state: GraphState) => {
            if (state.filters.nodeTypes.has(type)) {
              state.filters.nodeTypes.delete(type);
            } else {
              state.filters.nodeTypes.add(type);
            }
          }),

        toggleEdgeType: (type: string) =>
          set((state: GraphState) => {
            if (state.filters.edgeTypes.has(type)) {
              state.filters.edgeTypes.delete(type);
            } else {
              state.filters.edgeTypes.add(type);
            }
          }),

        resetFilters: () =>
          set((state: GraphState) => {
            state.filters = {
              nodeTypes: new Set(),
              edgeTypes: new Set(),
              searchQuery: "",
              showOrphans: true,
              showLabels: true,
              minDegree: 0,
            };
          }),

        // ============================================================
        // Layout
        // ============================================================

        setLayoutAlgorithm: (algorithm: LayoutAlgorithm) =>
          set((state: GraphState) => {
            state.layout.algorithm = algorithm;
          }),

        startSimulation: () =>
          set((state: GraphState) => {
            state.layout.isSimulating = true;
            state.layout.alpha = 1;
          }),

        stopSimulation: () =>
          set((state: GraphState) => {
            state.layout.isSimulating = false;
            state.layout.alpha = 0;
          }),

        toggleFreeze: () =>
          set((state: GraphState) => {
            state.layout.frozen = !state.layout.frozen;
            if (state.layout.frozen) {
              state.layout.isSimulating = false;
            }
          }),

        setFocusNode: (nodeId: string | null) =>
          set((state: GraphState) => {
            state.layout.focusNodeId = nodeId;
          }),

        setSimulationAlpha: (alpha: number) =>
          set((state: GraphState) => {
            state.layout.alpha = Math.max(0, Math.min(1, alpha));
            if (alpha <= 0) {
              state.layout.isSimulating = false;
            }
          }),

        // ============================================================
        // UI
        // ============================================================

        toggleSidebar: () =>
          set((state: GraphState) => {
            state.ui.sidebarOpen = !state.ui.sidebarOpen;
          }),

        showContextMenu: (x: number, y: number, target: ContextMenuTarget) =>
          set((state: GraphState) => {
            state.ui.contextMenu = {
              visible: true,
              x,
              y,
              targetId: target.id,
              targetType: target.type,
            };
          }),

        hideContextMenu: () =>
          set((state: GraphState) => {
            state.ui.contextMenu.visible = false;
          }),

        showTooltip: (x: number, y: number, content: TooltipContent) =>
          set((state: GraphState) => {
            state.ui.tooltip = {
              visible: true,
              x,
              y,
              content,
            };
          }),

        hideTooltip: () =>
          set((state: GraphState) => {
            state.ui.tooltip.visible = false;
          }),

        toggleMinimap: () =>
          set((state: GraphState) => {
            state.ui.minimap.visible = !state.ui.minimap.visible;
          }),

        setMinimapPosition: (position: MinimapPosition) =>
          set((state: GraphState) => {
            state.ui.minimap.position = position;
          }),

        // ============================================================
        // Metrics
        // ============================================================

        updateMetrics: (metrics: Partial<GraphMetrics>) =>
          set((state: GraphState) => {
            state.metrics = { ...state.metrics, ...metrics };
          }),

        // ============================================================
        // Reset
        // ============================================================

        reset: () =>
          set(
            () => ({
              ...DEFAULT_STATE,
              nodes: new Map(),
              edges: new Map(),
              selectedNodeIds: new Set(),
              selectedEdgeIds: new Set(),
              filters: {
                nodeTypes: new Set(),
                edgeTypes: new Set(),
                searchQuery: "",
                showOrphans: true,
                showLabels: true,
                minDegree: 0,
              },
            }),
            true // replace state
          ),
      }))
    ),
    // Persist configuration
    {
      name: "exocortex-graph-v1",
      partialize: (state) => ({
        filters: {
          showOrphans: state.filters.showOrphans,
          showLabels: state.filters.showLabels,
          minDegree: state.filters.minDegree,
        },
        layout: {
          algorithm: state.layout.algorithm,
        },
        ui: {
          minimap: state.ui.minimap,
          sidebarOpen: state.ui.sidebarOpen,
        },
      }),
      // Custom storage to handle Set serialization
      storage: {
        getItem: (name) => {
          const item = localStorage.getItem(name);
          if (!item) return null;
          return JSON.parse(item);
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);

/**
 * Undo last change using simple history stack
 */
export const undo = (): void => {
  if (historyStack.length === 0) return;
  const previous = historyStack.pop()!;
  const current = captureState(useGraphStore.getState());
  futureStack.push(current);
  useGraphStore.setState(previous);
};

/**
 * Redo last undone change
 */
export const redo = (): void => {
  if (futureStack.length === 0) return;
  const next = futureStack.pop()!;
  const current = captureState(useGraphStore.getState());
  historyStack.push(current);
  useGraphStore.setState(next);
};

/**
 * Check if undo is available
 */
export const canUndo = (): boolean => historyStack.length > 0;

/**
 * Check if redo is available
 */
export const canRedo = (): boolean => futureStack.length > 0;

/**
 * Clear history (for testing)
 */
export const clearHistory = (): void => {
  historyStack.length = 0;
  futureStack.length = 0;
};

/**
 * Get temporal store placeholder for API compatibility
 * @deprecated Use undo/redo/canUndo/canRedo functions directly
 */
export const getTemporalStore = (): {
  getState: () => {
    undo: () => void;
    redo: () => void;
    clear: () => void;
    pastStates: unknown[];
    futureStates: unknown[];
  };
} => ({
  getState: () => ({
    undo,
    redo,
    clear: clearHistory,
    pastStates: historyStack,
    futureStates: futureStack,
  }),
});

/**
 * Get default state for testing
 */
export const getDefaultState = (): GraphState => ({
  ...DEFAULT_STATE,
  nodes: new Map(),
  edges: new Map(),
  selectedNodeIds: new Set(),
  selectedEdgeIds: new Set(),
  filters: {
    nodeTypes: new Set(),
    edgeTypes: new Set(),
    searchQuery: "",
    showOrphans: true,
    showLabels: true,
    minDegree: 0,
  },
});
