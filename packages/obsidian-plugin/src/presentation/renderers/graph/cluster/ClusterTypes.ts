/**
 * ClusterTypes - Types and interfaces for node clustering visualization
 *
 * Provides the type definitions for:
 * - SPARQL query execution with validation and caching
 * - Cluster visualization rendering
 * - Integration with CommunityDetection module
 *
 * @module presentation/renderers/graph/cluster
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "../types";
import type { Community } from "../CommunityDetection";

// ============================================================
// Query Execution Types
// ============================================================

/**
 * Options for SPARQL query execution
 */
export interface ClusterQueryOptions {
  /** Query timeout in milliseconds @default 30000 */
  timeout?: number;

  /** Maximum number of results @default undefined (no limit) */
  limit?: number;

  /** Number of results to skip @default 0 */
  offset?: number;

  /** Output format @default 'graph' */
  format?: "json" | "csv" | "graph";

  /** Whether to use query cache @default true */
  cache?: boolean;

  /** Force refresh from triple store @default false */
  forceRefresh?: boolean;
}

/**
 * Validation result for SPARQL queries
 */
export interface QueryValidationResult {
  /** Whether the query is valid */
  valid: boolean;

  /** Query type (SELECT, CONSTRUCT, ASK, DESCRIBE) */
  queryType?: "select" | "construct" | "ask" | "describe";

  /** Validation errors if any */
  errors: QueryValidationError[];

  /** Validation warnings (non-fatal issues) */
  warnings: QueryValidationWarning[];

  /** Parsed variable names for SELECT queries */
  variables?: string[];
}

/**
 * Query validation error
 */
export interface QueryValidationError {
  /** Error type */
  type: "syntax" | "semantic" | "unsupported";

  /** Error message */
  message: string;

  /** Line number where error occurred */
  line?: number;

  /** Column number where error occurred */
  column?: number;

  /** Suggestion for fixing the error */
  suggestion?: string;
}

/**
 * Query validation warning
 */
export interface QueryValidationWarning {
  /** Warning type */
  type: "performance" | "deprecated" | "compatibility";

  /** Warning message */
  message: string;

  /** Line number */
  line?: number;

  /** Column number */
  column?: number;
}

/**
 * Query execution statistics
 */
export interface ClusterQueryStats {
  /** Query execution time in milliseconds */
  executionTime: number;

  /** Number of results returned */
  resultCount: number;

  /** Approximate bytes scanned */
  bytesScanned: number;

  /** Whether result came from cache */
  cacheHit: boolean;

  /** Number of triples evaluated */
  triplesEvaluated?: number;

  /** Optimization passes applied */
  optimizations?: string[];
}

/**
 * Result of a cluster query execution
 */
export interface ClusterQueryResult<T = unknown> {
  /** Unique query identifier */
  queryId: string;

  /** Query type */
  type: "select" | "construct" | "ask" | "describe";

  /** Variable bindings for SELECT queries */
  bindings?: T[];

  /** Triples for CONSTRUCT/DESCRIBE queries */
  triples?: Array<{ subject: string; predicate: string; object: string }>;

  /** Boolean result for ASK queries */
  boolean?: boolean;

  /** Query execution statistics */
  stats: ClusterQueryStats;

  /** Whether the query was cancelled */
  cancelled?: boolean;

  /** Error message if query failed */
  error?: string;
}

/**
 * Query execution plan for debugging
 */
export interface QueryPlan {
  /** Algebra tree representation */
  algebra: string;

  /** Estimated cost */
  estimatedCost: number;

  /** Optimization notes */
  notes: string[];

  /** Execution steps */
  steps: QueryPlanStep[];
}

/**
 * Single step in query execution plan
 */
export interface QueryPlanStep {
  /** Step type */
  type: "scan" | "filter" | "join" | "project" | "aggregate" | "sort" | "limit";

  /** Step description */
  description: string;

  /** Estimated rows */
  estimatedRows: number;

  /** Input variables */
  inputVars?: string[];

  /** Output variables */
  outputVars?: string[];
}

// ============================================================
// Cluster Visualization Types
// ============================================================

/**
 * Extended node with cluster information
 */
export interface ClusterNode extends GraphNode {
  /** Community/cluster assignment */
  clusterId?: number;

  /** Confidence score for cluster assignment (0-1) */
  clusterConfidence?: number;

  /** Cluster color for visualization */
  clusterColor?: string;

  /** Whether this node is a cluster centroid/hub */
  isClusterHub?: boolean;

  /** Intra-cluster connectivity score (0-1) */
  intraClusterScore?: number;

  /** Inter-cluster bridging score (0-1) */
  bridgingScore?: number;
}

/**
 * Extended edge with cluster information
 */
export interface ClusterEdge extends GraphEdge {
  /** Whether this edge is within a cluster */
  isIntraCluster?: boolean;

  /** Source cluster ID */
  sourceClusterId?: number;

  /** Target cluster ID */
  targetClusterId?: number;
}

/**
 * Cluster visualization data
 */
export interface ClusterVisualizationData {
  /** Nodes with cluster assignments */
  nodes: ClusterNode[];

  /** Edges with cluster information */
  edges: ClusterEdge[];

  /** Community detection result */
  communities: Community[];

  /** Overall modularity score */
  modularity: number;

  /** Cluster layout positions */
  clusterPositions?: Map<number, { x: number; y: number }>;
}

/**
 * Options for cluster visualization rendering
 */
export interface ClusterVisualizationOptions {
  /** Color palette for clusters @default 'categorical' */
  colorPalette?: "categorical" | "pastel" | "vibrant" | "nature";

  /** Whether to show cluster boundaries @default true */
  showClusterBoundaries?: boolean;

  /** Cluster boundary opacity @default 0.15 */
  boundaryOpacity?: number;

  /** Whether to highlight inter-cluster edges @default false */
  highlightInterClusterEdges?: boolean;

  /** Inter-cluster edge color @default '#888888' */
  interClusterEdgeColor?: string;

  /** Whether to show cluster labels @default true */
  showClusterLabels?: boolean;

  /** Cluster label font size @default 14 */
  clusterLabelFontSize?: number;

  /** Whether to animate cluster transitions @default true */
  animateTransitions?: boolean;

  /** Transition duration in milliseconds @default 500 */
  transitionDuration?: number;

  /** Whether to group nodes by cluster @default true */
  groupByCluster?: boolean;

  /** Cluster spacing multiplier @default 1.5 */
  clusterSpacing?: number;

  /** Minimum cluster size to display label @default 3 */
  minClusterSizeForLabel?: number;

  /** Whether to show cluster statistics @default false */
  showClusterStats?: boolean;
}

/**
 * Cluster boundary shape for visualization
 */
export interface ClusterBoundary {
  /** Cluster ID */
  clusterId: number;

  /** Cluster color */
  color: string;

  /** Bounding box */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };

  /** Convex hull points (for polygon boundary) */
  hull?: Array<{ x: number; y: number }>;

  /** Center point */
  center: { x: number; y: number };

  /** Cluster label */
  label?: string;
}

/**
 * Cluster selection state
 */
export interface ClusterSelectionState {
  /** Selected cluster IDs */
  selectedClusters: Set<number>;

  /** Highlighted cluster ID (hover) */
  highlightedCluster?: number;

  /** Expanded cluster IDs (showing internal structure) */
  expandedClusters: Set<number>;

  /** Collapsed cluster IDs (showing as single node) */
  collapsedClusters: Set<number>;
}

/**
 * Event types for cluster visualization
 */
export type ClusterEventType =
  | "cluster-click"
  | "cluster-hover"
  | "cluster-select"
  | "cluster-expand"
  | "cluster-collapse"
  | "cluster-updated";

/**
 * Cluster event payload
 */
export interface ClusterEvent {
  /** Event type */
  type: ClusterEventType;

  /** Cluster ID */
  clusterId: number;

  /** Cluster data */
  cluster?: Community;

  /** Mouse event (if applicable) */
  mouseEvent?: MouseEvent;

  /** Additional event data */
  data?: Record<string, unknown>;
}

/**
 * Cluster event listener
 */
export type ClusterEventListener = (event: ClusterEvent) => void;

// ============================================================
// Default Values
// ============================================================

/**
 * Default cluster query options
 */
export const DEFAULT_CLUSTER_QUERY_OPTIONS: Required<ClusterQueryOptions> = {
  timeout: 30000,
  limit: 10000,
  offset: 0,
  format: "graph",
  cache: true,
  forceRefresh: false,
};

/**
 * Default cluster visualization options
 */
export const DEFAULT_CLUSTER_VISUALIZATION_OPTIONS: Required<ClusterVisualizationOptions> = {
  colorPalette: "categorical",
  showClusterBoundaries: true,
  boundaryOpacity: 0.15,
  highlightInterClusterEdges: false,
  interClusterEdgeColor: "#888888",
  showClusterLabels: true,
  clusterLabelFontSize: 14,
  animateTransitions: true,
  transitionDuration: 500,
  groupByCluster: true,
  clusterSpacing: 1.5,
  minClusterSizeForLabel: 3,
  showClusterStats: false,
};
