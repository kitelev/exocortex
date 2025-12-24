/**
 * Path Finding Module
 *
 * Exports the path finding system for graph visualization with:
 * - PathFinder: Core path finding algorithms (BFS, Dijkstra, Bidirectional)
 * - PathFindingManager: State management and UI coordination
 * - PathFindingPanel: React component for path finding controls
 *
 * @module presentation/renderers/graph/pathfinding
 * @since 1.0.0
 */

// Core types
export type {
  PathFindingAlgorithm,
  PathDirection,
  EdgeWeightStrategy,
  PathFindingOptions,
  PathStep,
  Path,
  PathFindingResult,
  PathVisualizationStyle,
  PathFindingState,
  PathFindingEventType,
  PathFindingEvent,
  PathFindingEventListener,
  PathNode,
  AdjacencyEntry,
  PathGraph,
} from "./PathFindingTypes";

// Constants
export {
  DEFAULT_PATH_FINDING_OPTIONS,
  DEFAULT_PATH_VISUALIZATION_STYLE,
  INITIAL_PATH_FINDING_STATE,
} from "./PathFindingTypes";

// PathFinder - Core algorithm implementation
export {
  PathFinder,
  createPathFinder,
} from "./PathFinder";

// PathFindingManager - State management
export {
  PathFindingManager,
  createPathFindingManager,
  DEFAULT_PATH_FINDING_MANAGER_CONFIG,
} from "./PathFindingManager";
export type {
  PathFindingManagerConfig,
} from "./PathFindingManager";

// PathFindingPanel - React UI component
export {
  PathFindingPanel,
  PathFindingButton,
} from "./PathFindingPanel";
export type {
  PathFindingPanelProps,
  PathFindingButtonProps,
} from "./PathFindingPanel";
