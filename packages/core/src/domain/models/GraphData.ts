import type { GraphNode, GraphNodeData } from "./GraphNode";
import type { GraphEdge, GraphEdgeType } from "./GraphEdge";

/**
 * Statistics about the graph data.
 */
export interface GraphStats {
  /** Total number of nodes */
  nodeCount: number;
  /** Total number of edges */
  edgeCount: number;
  /** Breakdown by node class */
  nodesByClass: Record<string, number>;
  /** Breakdown by edge type */
  edgesByType: Record<GraphEdgeType, number>;
  /** Timestamp when stats were computed */
  computedAt: number;
}

/**
 * Options for loading graph data incrementally.
 */
export interface GraphLoadOptions {
  /** Maximum number of nodes to load */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by asset classes */
  classes?: string[];
  /** Filter by edge types */
  edgeTypes?: GraphEdgeType[];
  /** Root node for traversal (load connected nodes) */
  rootId?: string;
  /** Maximum depth for traversal from root */
  depth?: number;
  /** Include archived nodes */
  includeArchived?: boolean;
  /** Minimum edge weight threshold */
  minWeight?: number;
}

/**
 * Result of an incremental graph load operation.
 */
export interface GraphLoadResult {
  /** Loaded nodes */
  nodes: GraphNode[];
  /** Loaded edges (only edges between loaded nodes) */
  edges: GraphEdge[];
  /** Whether more data is available */
  hasMore: boolean;
  /** Total count of matching nodes (if available) */
  totalCount?: number;
  /** Cursor for next page (if applicable) */
  cursor?: string;
}

/**
 * Complete graph data structure for visualization.
 */
export interface GraphData {
  /** All nodes in the graph */
  nodes: GraphNode[];
  /** All edges in the graph */
  edges: GraphEdge[];
  /** Optional statistics */
  stats?: GraphStats;
  /** Timestamp of last update */
  lastUpdated?: number;
  /** Version for optimistic concurrency */
  version?: number;
}

/**
 * Event types for graph data changes.
 */
export type GraphChangeType = "node-added" | "node-updated" | "node-removed" | "edge-added" | "edge-removed" | "bulk-update";

/**
 * Event emitted when graph data changes.
 */
export interface GraphChangeEvent {
  /** Type of change */
  type: GraphChangeType;
  /** Affected node (for node events) */
  node?: GraphNodeData;
  /** Affected edge (for edge events) */
  edge?: GraphEdge;
  /** Multiple nodes (for bulk updates) */
  nodes?: GraphNodeData[];
  /** Multiple edges (for bulk updates) */
  edges?: GraphEdge[];
  /** Timestamp of the change */
  timestamp: number;
  /** Source of the change (e.g., "triple-store", "vault", "user") */
  source?: string;
}

/**
 * Callback for graph change subscriptions.
 */
export type GraphChangeCallback = (event: GraphChangeEvent) => void;

/**
 * Subscription handle for unsubscribing from changes.
 */
export interface GraphSubscription {
  /** Unsubscribe from changes */
  unsubscribe(): void;
}

/**
 * Create an empty GraphData object
 */
export function createEmptyGraphData(): GraphData {
  return {
    nodes: [],
    edges: [],
    lastUpdated: Date.now(),
    version: 0,
  };
}

/**
 * Merge two GraphData objects, deduplicating by ID
 */
export function mergeGraphData(base: GraphData, update: GraphData): GraphData {
  const nodeMap = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  // Add base nodes
  for (const node of base.nodes) {
    nodeMap.set(node.id, node);
  }

  // Add/update with new nodes
  for (const node of update.nodes) {
    nodeMap.set(node.id, node);
  }

  // Add base edges
  for (const edge of base.edges) {
    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }

  // Add new edges
  for (const edge of update.edges) {
    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    lastUpdated: Date.now(),
    version: Math.max(base.version ?? 0, update.version ?? 0) + 1,
  };
}
