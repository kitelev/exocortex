/**
 * Graph state management module.
 * Exports Zustand store, selectors, and types for graph visualization.
 */

// Store
export {
  useGraphStore,
  getTemporalStore,
  undo,
  redo,
  canUndo,
  canRedo,
  getDefaultState,
  clearHistory,
} from "./store";

// Selectors
export {
  // Node selectors
  useNodes,
  useNode,
  useSelectedNodes,
  useSelectedNodeIds,
  useIsNodeSelected,
  useHoveredNode,
  useVisibleNodes,
  useFilteredNodes,
  // Edge selectors
  useEdges,
  useEdge,
  useSelectedEdges,
  useIsEdgeSelected,
  useNodeEdges,
  useVisibleEdges,
  // Viewport selectors
  useViewport,
  useZoom,
  // Filter selectors
  useFilters,
  useSearchQuery,
  useVisibleNodeTypes,
  useVisibleEdgeTypes,
  // Layout selectors
  useLayout,
  useLayoutAlgorithm,
  useIsSimulating,
  useIsFrozen,
  // UI selectors
  useUI,
  useIsSidebarOpen,
  useContextMenu,
  useTooltip,
  useMinimap,
  // Statistics selectors
  useGraphStats,
  useMetrics,
  useNodeTypes,
  useEdgeTypes,
  // Computed selectors
  useNodeNeighbors,
  useNodeDegree,
  useBoundingBox,
} from "./selectors";

// Types
export type {
  GraphStore,
  GraphState,
  GraphActions,
  GraphData,
  ViewportState,
  FilterState,
  LayoutState,
  LayoutAlgorithm,
  GraphUIState,
  ContextMenuState,
  ContextMenuTarget,
  TooltipState,
  TooltipContent,
  MinimapState,
  MinimapPosition,
  GraphMetrics,
  Position,
  PersistedGraphState,
  UndoableGraphState,
} from "./types";
