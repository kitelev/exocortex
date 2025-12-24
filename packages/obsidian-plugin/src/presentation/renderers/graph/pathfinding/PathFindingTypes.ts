/**
 * Path Finding Types
 *
 * Defines the types and interfaces for path finding between nodes
 * in the graph visualization.
 *
 * @module presentation/renderers/graph/pathfinding
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "../types";

/**
 * Path finding algorithm to use
 */
export type PathFindingAlgorithm = "bfs" | "dijkstra" | "bidirectional";

/**
 * Direction constraint for path finding
 */
export type PathDirection = "outgoing" | "incoming" | "both";

/**
 * Edge weight calculation strategy
 */
export type EdgeWeightStrategy =
  | "uniform"      // All edges have weight 1
  | "property"     // Use edge.weight property
  | "predicate";   // Weight based on predicate type

/**
 * Path finding configuration options
 */
export interface PathFindingOptions {
  /** Algorithm to use for path finding */
  algorithm: PathFindingAlgorithm;
  /** Maximum path length (number of edges) */
  maxLength: number;
  /** Edge direction constraint */
  direction: PathDirection;
  /** Whether to find all shortest paths or just one */
  findAllPaths: boolean;
  /** Maximum number of paths to return when finding all paths */
  maxPaths: number;
  /** Edge weight calculation strategy */
  weightStrategy: EdgeWeightStrategy;
  /** Predicate URIs to prioritize (lower weight) */
  preferredPredicates?: string[];
  /** Predicate URIs to avoid (higher weight) */
  avoidedPredicates?: string[];
  /** Custom weight function for edges */
  customWeightFn?: (edge: GraphEdge) => number;
  /** Timeout in milliseconds for path search */
  timeoutMs: number;
}

/**
 * Default path finding options
 */
export const DEFAULT_PATH_FINDING_OPTIONS: PathFindingOptions = {
  algorithm: "bfs",
  maxLength: 10,
  direction: "both",
  findAllPaths: false,
  maxPaths: 5,
  weightStrategy: "uniform",
  timeoutMs: 5000,
};

/**
 * A single step in a path
 */
export interface PathStep {
  /** The node at this step */
  node: GraphNode;
  /** The edge taken to reach this node (null for start node) */
  edge: GraphEdge | null;
  /** Whether the edge was traversed in reverse direction */
  isReverse: boolean;
  /** Cumulative weight/distance from start */
  cumulativeWeight: number;
}

/**
 * A complete path between two nodes
 */
export interface Path {
  /** Unique identifier for this path */
  id: string;
  /** Source node where path starts */
  source: GraphNode;
  /** Target node where path ends */
  target: GraphNode;
  /** All steps in the path (including source and target) */
  steps: PathStep[];
  /** Total weight/length of the path */
  totalWeight: number;
  /** Number of edges in the path */
  length: number;
  /** All node IDs in the path */
  nodeIds: string[];
  /** All edge IDs in the path */
  edgeIds: string[];
}

/**
 * Result of a path finding operation
 */
export interface PathFindingResult {
  /** Whether a path was found */
  found: boolean;
  /** The paths found (empty if not found) */
  paths: Path[];
  /** Source node ID */
  sourceId: string;
  /** Target node ID */
  targetId: string;
  /** Algorithm used */
  algorithm: PathFindingAlgorithm;
  /** Number of nodes visited during search */
  nodesVisited: number;
  /** Search time in milliseconds */
  searchTimeMs: number;
  /** Whether search timed out */
  timedOut: boolean;
  /** Error message if search failed */
  error?: string;
}

/**
 * Path visualization style configuration
 */
export interface PathVisualizationStyle {
  /** Color for highlighted path edges */
  edgeColor: string;
  /** Color for highlighted path nodes */
  nodeColor: string;
  /** Edge width for path edges */
  edgeWidth: number;
  /** Node border width for path nodes */
  nodeBorderWidth: number;
  /** Whether to animate the path */
  animated: boolean;
  /** Animation duration in ms */
  animationDuration: number;
  /** Animation type */
  animationType: "flow" | "pulse" | "dash";
  /** Opacity for non-path elements when path is displayed */
  dimOpacity: number;
  /** Glow effect for path edges */
  glowEnabled: boolean;
  /** Glow color */
  glowColor: string;
  /** Glow blur amount */
  glowBlur: number;
}

/**
 * Default path visualization style
 */
export const DEFAULT_PATH_VISUALIZATION_STYLE: PathVisualizationStyle = {
  edgeColor: "#22c55e",    // Green
  nodeColor: "#22c55e",
  edgeWidth: 4,
  nodeBorderWidth: 4,
  animated: true,
  animationDuration: 1500,
  animationType: "flow",
  dimOpacity: 0.2,
  glowEnabled: true,
  glowColor: "#22c55e",
  glowBlur: 6,
};

/**
 * Path finding state for tracking current search
 */
export interface PathFindingState {
  /** Whether path finding mode is active */
  isActive: boolean;
  /** Source node (null if not selected) */
  sourceNode: GraphNode | null;
  /** Target node (null if not selected) */
  targetNode: GraphNode | null;
  /** Current selection step */
  selectionStep: "source" | "target" | "complete";
  /** The found paths */
  result: PathFindingResult | null;
  /** Currently displayed path index (when multiple paths found) */
  currentPathIndex: number;
  /** Whether search is in progress */
  isSearching: boolean;
  /** Current options */
  options: PathFindingOptions;
}

/**
 * Initial path finding state
 */
export const INITIAL_PATH_FINDING_STATE: PathFindingState = {
  isActive: false,
  sourceNode: null,
  targetNode: null,
  selectionStep: "source",
  result: null,
  currentPathIndex: 0,
  isSearching: false,
  options: DEFAULT_PATH_FINDING_OPTIONS,
};

/**
 * Events emitted by path finding system
 */
export type PathFindingEventType =
  | "pathfinding:start"
  | "pathfinding:source-selected"
  | "pathfinding:target-selected"
  | "pathfinding:searching"
  | "pathfinding:found"
  | "pathfinding:not-found"
  | "pathfinding:error"
  | "pathfinding:path-change"
  | "pathfinding:clear"
  | "pathfinding:cancel";

/**
 * Path finding event payload
 */
export interface PathFindingEvent {
  type: PathFindingEventType;
  state?: PathFindingState;
  result?: PathFindingResult;
  path?: Path;
  error?: string;
}

/**
 * Path finding event listener callback
 */
export type PathFindingEventListener = (event: PathFindingEvent) => void;

/**
 * Node information for path finding algorithms
 */
export interface PathNode {
  /** Node ID */
  id: string;
  /** Original graph node */
  node: GraphNode;
  /** Distance from source (for Dijkstra) */
  distance: number;
  /** Previous node in shortest path */
  previous: PathNode | null;
  /** Edge used to reach this node */
  previousEdge: GraphEdge | null;
  /** Whether edge was traversed in reverse */
  isReverse: boolean;
  /** Whether node has been visited */
  visited: boolean;
}

/**
 * Adjacency list entry for path finding
 */
export interface AdjacencyEntry {
  /** Target node ID */
  targetId: string;
  /** The edge connecting to target */
  edge: GraphEdge;
  /** Weight of the edge */
  weight: number;
  /** Whether this is a reverse edge */
  isReverse: boolean;
}

/**
 * Graph representation for path finding algorithms
 */
export interface PathGraph {
  /** All nodes by ID */
  nodes: Map<string, GraphNode>;
  /** Adjacency list (node ID -> outgoing edges) */
  adjacency: Map<string, AdjacencyEntry[]>;
  /** Reverse adjacency (node ID -> incoming edges) */
  reverseAdjacency: Map<string, AdjacencyEntry[]>;
}
