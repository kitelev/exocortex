/**
 * Memoized selectors for the graph store.
 * Provides efficient derived state computation with automatic caching.
 */

import { useShallow } from "zustand/react/shallow";
import type { GraphNode, GraphEdge } from "exocortex";
import { useGraphStore } from "./store";

// ============================================================
// Node Selectors
// ============================================================

/**
 * Get all nodes as an array
 */
export const useNodes = () =>
  useGraphStore(useShallow((state) => Array.from(state.nodes.values())));

/**
 * Get a specific node by ID
 */
export const useNode = (id: string) =>
  useGraphStore((state) => state.nodes.get(id));

/**
 * Get selected nodes
 */
export const useSelectedNodes = (): GraphNode[] =>
  useGraphStore(
    useShallow((state) => {
      const selected: GraphNode[] = [];
      for (const id of state.selectedNodeIds) {
        const node = state.nodes.get(id);
        if (node) selected.push(node);
      }
      return selected;
    })
  );

/**
 * Get selected node IDs
 */
export const useSelectedNodeIds = (): Set<string> =>
  useGraphStore((state) => state.selectedNodeIds);

/**
 * Check if a node is selected
 */
export const useIsNodeSelected = (id: string): boolean =>
  useGraphStore((state) => state.selectedNodeIds.has(id));

/**
 * Get hovered node
 */
export const useHoveredNode = (): GraphNode | null =>
  useGraphStore((state) =>
    state.hoveredNodeId ? state.nodes.get(state.hoveredNodeId) ?? null : null
  );

/**
 * Get visible nodes (filtered and within viewport)
 */
export const useVisibleNodes = (): GraphNode[] =>
  useGraphStore(
    useShallow((state) => {
      const { nodes, filters, viewport } = state;
      const visible: GraphNode[] = [];

      for (const node of nodes.values()) {
        // Type filter - if filter set is not empty, node type must be in it
        if (filters.nodeTypes.size > 0) {
          const nodeType = node.assetClass ?? "unknown";
          if (!filters.nodeTypes.has(nodeType)) continue;
        }

        // Calculate degree (connections)
        let degree = 0;
        for (const edge of state.edges.values()) {
          if (edge.source === node.id || edge.target === node.id) {
            degree++;
          }
        }

        // Orphan filter
        if (!filters.showOrphans && degree === 0) continue;

        // Minimum degree filter
        if (degree < filters.minDegree) continue;

        // Search filter
        if (filters.searchQuery) {
          const query = filters.searchQuery.toLowerCase();
          const label = (node.label ?? node.title ?? "").toLowerCase();
          const title = (node.title ?? "").toLowerCase();
          if (!label.includes(query) && !title.includes(query)) {
            continue;
          }
        }

        // Viewport culling (with margin for smooth panning)
        const nodeX = node.x ?? 0;
        const nodeY = node.y ?? 0;
        const screenX = nodeX * viewport.zoom + viewport.x;
        const screenY = nodeY * viewport.zoom + viewport.y;
        const margin = 100;

        if (
          screenX < -margin ||
          screenX > viewport.width + margin ||
          screenY < -margin ||
          screenY > viewport.height + margin
        ) {
          continue;
        }

        visible.push(node);
      }

      return visible;
    })
  );

/**
 * Get nodes filtered by search (without viewport culling)
 */
export const useFilteredNodes = (): GraphNode[] =>
  useGraphStore(
    useShallow((state) => {
      const { nodes, filters } = state;
      const filtered: GraphNode[] = [];

      for (const node of nodes.values()) {
        // Type filter
        if (filters.nodeTypes.size > 0) {
          const nodeType = node.assetClass ?? "unknown";
          if (!filters.nodeTypes.has(nodeType)) continue;
        }

        // Calculate degree
        let degree = 0;
        for (const edge of state.edges.values()) {
          if (edge.source === node.id || edge.target === node.id) {
            degree++;
          }
        }

        // Orphan filter
        if (!filters.showOrphans && degree === 0) continue;

        // Minimum degree filter
        if (degree < filters.minDegree) continue;

        // Search filter
        if (filters.searchQuery) {
          const query = filters.searchQuery.toLowerCase();
          const label = (node.label ?? node.title ?? "").toLowerCase();
          const title = (node.title ?? "").toLowerCase();
          if (!label.includes(query) && !title.includes(query)) {
            continue;
          }
        }

        filtered.push(node);
      }

      return filtered;
    })
  );

// ============================================================
// Edge Selectors
// ============================================================

/**
 * Get all edges as an array
 */
export const useEdges = (): GraphEdge[] =>
  useGraphStore(useShallow((state) => Array.from(state.edges.values())));

/**
 * Get a specific edge by ID
 */
export const useEdge = (id: string) =>
  useGraphStore((state) => state.edges.get(id));

/**
 * Get selected edges
 */
export const useSelectedEdges = (): GraphEdge[] =>
  useGraphStore(
    useShallow((state) => {
      const selected: GraphEdge[] = [];
      for (const id of state.selectedEdgeIds) {
        const edge = state.edges.get(id);
        if (edge) selected.push(edge);
      }
      return selected;
    })
  );

/**
 * Check if an edge is selected
 */
export const useIsEdgeSelected = (id: string): boolean =>
  useGraphStore((state) => state.selectedEdgeIds.has(id));

/**
 * Get edges for a specific node
 */
export const useNodeEdges = (nodeId: string): GraphEdge[] =>
  useGraphStore(
    useShallow((state) => {
      const edges: GraphEdge[] = [];
      for (const edge of state.edges.values()) {
        if (edge.source === nodeId || edge.target === nodeId) {
          edges.push(edge);
        }
      }
      return edges;
    })
  );

/**
 * Get visible edges (connected to visible nodes)
 */
export const useVisibleEdges = (): GraphEdge[] =>
  useGraphStore(
    useShallow((state) => {
      const { edges, filters } = state;
      const visible: GraphEdge[] = [];

      // Get visible node IDs (simplified check without viewport culling)
      const visibleNodeIds = new Set<string>();
      for (const node of state.nodes.values()) {
        if (filters.nodeTypes.size > 0) {
          const nodeType = node.assetClass ?? "unknown";
          if (!filters.nodeTypes.has(nodeType)) continue;
        }
        visibleNodeIds.add(node.id);
      }

      for (const edge of edges.values()) {
        // Edge type filter
        if (filters.edgeTypes.size > 0 && !filters.edgeTypes.has(edge.type)) {
          continue;
        }

        // Both endpoints must be visible
        if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
          continue;
        }

        visible.push(edge);
      }

      return visible;
    })
  );

// ============================================================
// Viewport Selectors
// ============================================================

/**
 * Get current viewport state
 */
export const useViewport = () =>
  useGraphStore(useShallow((state) => state.viewport));

/**
 * Get current zoom level
 */
export const useZoom = (): number =>
  useGraphStore((state) => state.viewport.zoom);

// ============================================================
// Filter Selectors
// ============================================================

/**
 * Get current filter state
 */
export const useFilters = () =>
  useGraphStore(useShallow((state) => state.filters));

/**
 * Get search query
 */
export const useSearchQuery = (): string =>
  useGraphStore((state) => state.filters.searchQuery);

/**
 * Get visible node types
 */
export const useVisibleNodeTypes = (): Set<string> =>
  useGraphStore((state) => state.filters.nodeTypes);

/**
 * Get visible edge types
 */
export const useVisibleEdgeTypes = (): Set<string> =>
  useGraphStore((state) => state.filters.edgeTypes);

// ============================================================
// Layout Selectors
// ============================================================

/**
 * Get current layout state
 */
export const useLayout = () =>
  useGraphStore(useShallow((state) => state.layout));

/**
 * Get current layout algorithm
 */
export const useLayoutAlgorithm = () =>
  useGraphStore((state) => state.layout.algorithm);

/**
 * Check if simulation is running
 */
export const useIsSimulating = (): boolean =>
  useGraphStore((state) => state.layout.isSimulating);

/**
 * Check if layout is frozen
 */
export const useIsFrozen = (): boolean =>
  useGraphStore((state) => state.layout.frozen);

// ============================================================
// UI Selectors
// ============================================================

/**
 * Get UI state
 */
export const useUI = () => useGraphStore(useShallow((state) => state.ui));

/**
 * Check if sidebar is open
 */
export const useIsSidebarOpen = (): boolean =>
  useGraphStore((state) => state.ui.sidebarOpen);

/**
 * Get context menu state
 */
export const useContextMenu = () =>
  useGraphStore(useShallow((state) => state.ui.contextMenu));

/**
 * Get tooltip state
 */
export const useTooltip = () =>
  useGraphStore(useShallow((state) => state.ui.tooltip));

/**
 * Get minimap state
 */
export const useMinimap = () =>
  useGraphStore(useShallow((state) => state.ui.minimap));

// ============================================================
// Statistics Selectors
// ============================================================

/**
 * Get graph statistics
 */
export const useGraphStats = () =>
  useGraphStore(
    useShallow((state) => ({
      totalNodes: state.nodes.size,
      totalEdges: state.edges.size,
      selectedNodeCount: state.selectedNodeIds.size,
      selectedEdgeCount: state.selectedEdgeIds.size,
      visibleNodeCount: state.metrics.visibleNodeCount,
      fps: state.metrics.fps,
      renderTime: state.metrics.renderTime,
    }))
  );

/**
 * Get performance metrics
 */
export const useMetrics = () =>
  useGraphStore(useShallow((state) => state.metrics));

/**
 * Get unique node types in the graph
 */
export const useNodeTypes = (): string[] =>
  useGraphStore(
    useShallow((state) => {
      const types = new Set<string>();
      for (const node of state.nodes.values()) {
        if (node.assetClass) {
          types.add(node.assetClass);
        }
      }
      return Array.from(types).sort();
    })
  );

/**
 * Get unique edge types in the graph
 */
export const useEdgeTypes = (): string[] =>
  useGraphStore(
    useShallow((state) => {
      const types = new Set<string>();
      for (const edge of state.edges.values()) {
        types.add(edge.type);
      }
      return Array.from(types).sort();
    })
  );

// ============================================================
// Computed Selectors
// ============================================================

/**
 * Get neighbors of a node
 */
export const useNodeNeighbors = (nodeId: string): GraphNode[] =>
  useGraphStore(
    useShallow((state) => {
      const neighborIds = new Set<string>();
      for (const edge of state.edges.values()) {
        if (edge.source === nodeId) {
          neighborIds.add(edge.target);
        }
        if (edge.target === nodeId) {
          neighborIds.add(edge.source);
        }
      }

      const neighbors: GraphNode[] = [];
      for (const id of neighborIds) {
        const node = state.nodes.get(id);
        if (node) neighbors.push(node);
      }
      return neighbors;
    })
  );

/**
 * Get degree (connection count) for a node
 */
export const useNodeDegree = (nodeId: string): number =>
  useGraphStore((state) => {
    let degree = 0;
    for (const edge of state.edges.values()) {
      if (edge.source === nodeId || edge.target === nodeId) {
        degree++;
      }
    }
    return degree;
  });

/**
 * Get the bounding box of all nodes
 */
export const useBoundingBox = () =>
  useGraphStore(
    useShallow((state) => {
      if (state.nodes.size === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
      }

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

      return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      };
    })
  );
