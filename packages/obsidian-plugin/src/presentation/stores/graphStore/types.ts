/**
 * Type definitions for the Graph state management store.
 * Provides complete state interface for graph visualization.
 */

import type { GraphNode } from "exocortex";
import type { GraphEdge } from "exocortex";

/**
 * Position in 2D space
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Tooltip content for graph elements
 */
export interface TooltipContent {
  title: string;
  subtitle?: string;
  properties?: Array<{ label: string; value: string }>;
  nodeType?: string;
  edgeType?: string;
}

/**
 * Context menu target information
 */
export interface ContextMenuTarget {
  id: string | null;
  type: "node" | "edge" | "canvas";
}

/**
 * Layout algorithm options
 */
export type LayoutAlgorithm = "force" | "hierarchical" | "radial" | "grid" | "temporal";

/**
 * Minimap position options
 */
export type MinimapPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Viewport state for pan/zoom
 */
export interface ViewportState {
  /** Pan offset X */
  x: number;
  /** Pan offset Y */
  y: number;
  /** Zoom level (0.1 - 10) */
  zoom: number;
  /** Container width */
  width: number;
  /** Container height */
  height: number;
}

/**
 * Filter state for graph visualization
 */
export interface FilterState {
  /** Visible node types */
  nodeTypes: Set<string>;
  /** Visible edge types */
  edgeTypes: Set<string>;
  /** Text search query */
  searchQuery: string;
  /** Show unconnected nodes */
  showOrphans: boolean;
  /** Show node labels */
  showLabels: boolean;
  /** Minimum connections to show */
  minDegree: number;
}

/**
 * Layout state for graph arrangement
 */
export interface LayoutState {
  /** Current layout algorithm */
  algorithm: LayoutAlgorithm;
  /** Physics simulation running */
  isSimulating: boolean;
  /** Simulation energy (0-1) */
  alpha: number;
  /** Manual position mode (freeze physics) */
  frozen: boolean;
  /** Center node for radial layout */
  focusNodeId: string | null;
}

/**
 * Context menu state
 */
export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetId: string | null;
  targetType: "node" | "edge" | "canvas";
}

/**
 * Tooltip state
 */
export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: TooltipContent | null;
}

/**
 * Minimap state
 */
export interface MinimapState {
  visible: boolean;
  position: MinimapPosition;
}

/**
 * UI state for graph controls
 */
export interface GraphUIState {
  /** Sidebar panel open */
  sidebarOpen: boolean;
  /** Context menu state */
  contextMenu: ContextMenuState;
  /** Tooltip state */
  tooltip: TooltipState;
  /** Minimap state */
  minimap: MinimapState;
}

/**
 * Performance metrics for graph rendering
 */
export interface GraphMetrics {
  /** Frames per second */
  fps: number;
  /** Total node count */
  nodeCount: number;
  /** Currently visible node count */
  visibleNodeCount: number;
  /** Last render time in ms */
  renderTime: number;
  /** Timestamp of last update */
  lastUpdate: number;
}

/**
 * Complete graph state interface
 */
export interface GraphState {
  // Data
  /** All nodes in the graph, keyed by ID */
  nodes: Map<string, GraphNode>;
  /** All edges in the graph, keyed by ID */
  edges: Map<string, GraphEdge>;

  // Selection
  /** IDs of currently selected nodes */
  selectedNodeIds: Set<string>;
  /** IDs of currently selected edges */
  selectedEdgeIds: Set<string>;
  /** ID of currently hovered node */
  hoveredNodeId: string | null;
  /** ID of currently hovered edge */
  hoveredEdgeId: string | null;

  // Viewport
  /** Current viewport (pan/zoom) state */
  viewport: ViewportState;

  // Filters
  /** Current filter settings */
  filters: FilterState;

  // Layout
  /** Current layout settings */
  layout: LayoutState;

  // UI
  /** UI control states */
  ui: GraphUIState;

  // Performance metrics
  /** Performance metrics */
  metrics: GraphMetrics;
}

/**
 * Graph data structure for bulk loading
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Actions for graph state mutations
 */
export interface GraphActions {
  // Data mutations
  /** Set complete graph data (replaces existing) */
  setGraphData: (data: GraphData) => void;
  /** Add a single node */
  addNode: (node: GraphNode) => void;
  /** Update node properties */
  updateNode: (id: string, updates: Partial<GraphNode>) => void;
  /** Remove a node and its connected edges */
  removeNode: (id: string) => void;
  /** Add a single edge */
  addEdge: (edge: GraphEdge) => void;
  /** Remove an edge */
  removeEdge: (id: string) => void;

  // Batch operations
  /** Update multiple node positions at once (optimized for animations) */
  updateNodePositions: (positions: Map<string, Position>) => void;

  // Selection
  /** Select a node (optionally additive) */
  selectNode: (id: string, additive?: boolean) => void;
  /** Select multiple nodes */
  selectNodes: (ids: string[]) => void;
  /** Select an edge (optionally additive) */
  selectEdge: (id: string, additive?: boolean) => void;
  /** Clear all selection */
  clearSelection: () => void;
  /** Select all visible nodes */
  selectAll: () => void;
  /** Select neighbors of a node up to specified depth */
  selectNeighbors: (nodeId: string, depth?: number) => void;

  // Hover
  /** Set hovered node */
  setHoveredNode: (id: string | null) => void;
  /** Set hovered edge */
  setHoveredEdge: (id: string | null) => void;

  // Viewport
  /** Update viewport state */
  setViewport: (viewport: Partial<ViewportState>) => void;
  /** Zoom in by one step */
  zoomIn: () => void;
  /** Zoom out by one step */
  zoomOut: () => void;
  /** Fit all nodes in viewport */
  zoomToFit: () => void;
  /** Center viewport on a specific node */
  zoomToNode: (nodeId: string) => void;
  /** Pan to specific coordinates */
  panTo: (x: number, y: number) => void;

  // Filters
  /** Set a specific filter value */
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  /** Toggle visibility of a node type */
  toggleNodeType: (type: string) => void;
  /** Toggle visibility of an edge type */
  toggleEdgeType: (type: string) => void;
  /** Reset all filters to defaults */
  resetFilters: () => void;

  // Layout
  /** Change layout algorithm */
  setLayoutAlgorithm: (algorithm: LayoutAlgorithm) => void;
  /** Start physics simulation */
  startSimulation: () => void;
  /** Stop physics simulation */
  stopSimulation: () => void;
  /** Toggle freeze mode (manual positioning) */
  toggleFreeze: () => void;
  /** Set focus node for radial layout */
  setFocusNode: (nodeId: string | null) => void;
  /** Update simulation alpha (energy) */
  setSimulationAlpha: (alpha: number) => void;

  // UI
  /** Toggle sidebar visibility */
  toggleSidebar: () => void;
  /** Show context menu */
  showContextMenu: (x: number, y: number, target: ContextMenuTarget) => void;
  /** Hide context menu */
  hideContextMenu: () => void;
  /** Show tooltip */
  showTooltip: (x: number, y: number, content: TooltipContent) => void;
  /** Hide tooltip */
  hideTooltip: () => void;
  /** Toggle minimap visibility */
  toggleMinimap: () => void;
  /** Set minimap position */
  setMinimapPosition: (position: MinimapPosition) => void;

  // Metrics
  /** Update performance metrics */
  updateMetrics: (metrics: Partial<GraphMetrics>) => void;

  // Reset
  /** Reset entire store to initial state */
  reset: () => void;
}

/**
 * Complete graph store type (state + actions)
 */
export type GraphStore = GraphState & GraphActions;

/**
 * State that should be persisted to localStorage
 */
export interface PersistedGraphState {
  filters: {
    showOrphans: boolean;
    showLabels: boolean;
    minDegree: number;
  };
  layout: {
    algorithm: LayoutAlgorithm;
  };
  ui: {
    minimap: MinimapState;
    sidebarOpen: boolean;
  };
}

/**
 * State tracked for undo/redo
 */
export interface UndoableGraphState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
}
