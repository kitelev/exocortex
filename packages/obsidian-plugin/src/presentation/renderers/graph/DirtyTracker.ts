/**
 * DirtyTracker - Efficient dirty-checking for incremental graph rendering
 *
 * Provides fine-grained tracking of what has changed in the graph to minimize
 * rendering work. Only elements that have actually changed need to be redrawn.
 *
 * Features:
 * - Multiple dirty flag types (positions, viewport, selection, filters, etc.)
 * - Per-node and per-edge dirty tracking
 * - Batch dirty marking for efficiency
 * - Clear after render cycle
 * - Statistics for performance monitoring
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

/**
 * Types of changes that can occur in the graph
 */
export type DirtyFlag =
  | "all" // Full redraw needed
  | "positions" // Node positions changed (force simulation tick)
  | "viewport" // Pan/zoom changed
  | "selection" // Selection state changed
  | "filters" // Visibility filters changed
  | "style" // Visual style changed
  | "data" // Graph data changed (nodes/edges added/removed)
  | "labels" // Label visibility changed
  | "hover"; // Hover state changed

/**
 * Dirty tracking for incremental updates
 *
 * @example
 * ```typescript
 * const tracker = new DirtyTracker();
 *
 * // Mark changes during interaction
 * tracker.markDirty('viewport');
 * tracker.markNodeDirty('node-1');
 *
 * // In render loop
 * if (tracker.isDirty('viewport')) {
 *   updateViewportTransform();
 * }
 *
 * for (const nodeId of tracker.getDirtyNodes()) {
 *   updateNodePosition(nodeId);
 * }
 *
 * // Clear after render
 * tracker.clear();
 * ```
 */
export class DirtyTracker {
  /** Active dirty flags */
  private flags: Set<DirtyFlag> = new Set();

  /** Nodes that need updating */
  private dirtyNodes: Set<string> = new Set();

  /** Edges that need updating */
  private dirtyEdges: Set<string> = new Set();

  /** Statistics tracking */
  private stats = {
    /** Total number of dirty marks since last reset */
    totalMarks: 0,
    /** Number of full redraws triggered */
    fullRedraws: 0,
    /** Number of incremental updates */
    incrementalUpdates: 0,
    /** Last render timestamp */
    lastRenderTime: 0,
    /** Last frame's dirty node count */
    lastDirtyNodeCount: 0,
    /** Last frame's dirty edge count */
    lastDirtyEdgeCount: 0,
  };

  /**
   * Mark a dirty flag
   *
   * @param flag - The type of change that occurred
   */
  markDirty(flag: DirtyFlag): void {
    this.flags.add(flag);
    this.stats.totalMarks++;

    // If marking 'all', track as full redraw
    if (flag === "all") {
      this.stats.fullRedraws++;
    }
  }

  /**
   * Mark multiple dirty flags at once
   *
   * @param flags - Array of flags to mark
   */
  markDirtyBatch(flags: DirtyFlag[]): void {
    for (const flag of flags) {
      this.markDirty(flag);
    }
  }

  /**
   * Mark a specific node as dirty
   *
   * @param nodeId - The node ID that changed
   */
  markNodeDirty(nodeId: string): void {
    this.dirtyNodes.add(nodeId);
    this.flags.add("positions");
    this.stats.totalMarks++;
  }

  /**
   * Mark multiple nodes as dirty at once
   *
   * @param nodeIds - Array of node IDs that changed
   */
  markNodesDirty(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.dirtyNodes.add(nodeId);
    }
    if (nodeIds.length > 0) {
      this.flags.add("positions");
      this.stats.totalMarks += nodeIds.length;
    }
  }

  /**
   * Mark all nodes as dirty (e.g., after force simulation tick)
   *
   * @param nodeIds - All node IDs in the graph
   */
  markAllNodesDirty(nodeIds: string[]): void {
    this.markNodesDirty(nodeIds);
  }

  /**
   * Mark a specific edge as dirty
   *
   * @param edgeId - The edge ID that changed
   */
  markEdgeDirty(edgeId: string): void {
    this.dirtyEdges.add(edgeId);
    this.stats.totalMarks++;
  }

  /**
   * Mark multiple edges as dirty at once
   *
   * @param edgeIds - Array of edge IDs that changed
   */
  markEdgesDirty(edgeIds: string[]): void {
    for (const edgeId of edgeIds) {
      this.dirtyEdges.add(edgeId);
    }
    this.stats.totalMarks += edgeIds.length;
  }

  /**
   * Mark edges connected to a node as dirty
   *
   * @param nodeId - Node ID whose edges should be marked dirty
   * @param edgeIndex - Map from node ID to connected edge IDs
   */
  markNodeEdgesDirty(
    nodeId: string,
    edgeIndex: Map<string, Set<string>>
  ): void {
    const edges = edgeIndex.get(nodeId);
    if (edges) {
      for (const edgeId of edges) {
        this.dirtyEdges.add(edgeId);
      }
      this.stats.totalMarks += edges.size;
    }
  }

  /**
   * Check if a specific flag is dirty
   *
   * @param flag - The flag to check
   * @returns True if the flag is set or 'all' is set
   */
  isDirty(flag: DirtyFlag): boolean {
    return this.flags.has("all") || this.flags.has(flag);
  }

  /**
   * Check if a specific node is dirty
   *
   * @param nodeId - The node ID to check
   * @returns True if the node is dirty or 'all' is set
   */
  isNodeDirty(nodeId: string): boolean {
    return this.flags.has("all") || this.dirtyNodes.has(nodeId);
  }

  /**
   * Check if a specific edge is dirty
   *
   * @param edgeId - The edge ID to check
   * @returns True if the edge is dirty or 'all' is set
   */
  isEdgeDirty(edgeId: string): boolean {
    return this.flags.has("all") || this.dirtyEdges.has(edgeId);
  }

  /**
   * Check if anything is dirty
   *
   * @returns True if any dirty state exists
   */
  hasAnyDirty(): boolean {
    return (
      this.flags.size > 0 ||
      this.dirtyNodes.size > 0 ||
      this.dirtyEdges.size > 0
    );
  }

  /**
   * Check if a full redraw is required
   *
   * @returns True if 'all' flag is set
   */
  needsFullRedraw(): boolean {
    return this.flags.has("all");
  }

  /**
   * Get all dirty nodes
   *
   * @returns Set of dirty node IDs (empty if 'all' is set - indicates all need update)
   */
  getDirtyNodes(): Set<string> {
    return this.flags.has("all") ? new Set<string>() : new Set(this.dirtyNodes);
  }

  /**
   * Get all dirty edges
   *
   * @returns Set of dirty edge IDs (empty if 'all' is set - indicates all need update)
   */
  getDirtyEdges(): Set<string> {
    return this.flags.has("all") ? new Set<string>() : new Set(this.dirtyEdges);
  }

  /**
   * Get all active dirty flags
   *
   * @returns Set of active flags
   */
  getDirtyFlags(): Set<DirtyFlag> {
    return new Set(this.flags);
  }

  /**
   * Get count of dirty nodes
   *
   * @returns Number of dirty nodes
   */
  getDirtyNodeCount(): number {
    return this.dirtyNodes.size;
  }

  /**
   * Get count of dirty edges
   *
   * @returns Number of dirty edges
   */
  getDirtyEdgeCount(): number {
    return this.dirtyEdges.size;
  }

  /**
   * Clear all dirty state after render
   */
  clear(): void {
    // Track stats before clearing
    this.stats.lastDirtyNodeCount = this.dirtyNodes.size;
    this.stats.lastDirtyEdgeCount = this.dirtyEdges.size;
    this.stats.lastRenderTime = Date.now();

    if (this.hasAnyDirty()) {
      if (!this.flags.has("all")) {
        this.stats.incrementalUpdates++;
      }
    }

    this.flags.clear();
    this.dirtyNodes.clear();
    this.dirtyEdges.clear();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalMarks: 0,
      fullRedraws: 0,
      incrementalUpdates: 0,
      lastRenderTime: 0,
      lastDirtyNodeCount: 0,
      lastDirtyEdgeCount: 0,
    };
  }

  /**
   * Get current statistics
   *
   * @returns Statistics object
   */
  getStats(): Readonly<typeof this.stats> {
    return { ...this.stats };
  }

  /**
   * Get efficiency ratio (incremental vs full redraws)
   *
   * @returns Ratio of incremental updates to total updates (0-1)
   */
  getEfficiencyRatio(): number {
    const total = this.stats.incrementalUpdates + this.stats.fullRedraws;
    if (total === 0) return 1;
    return this.stats.incrementalUpdates / total;
  }
}

/**
 * Edge index for efficient lookup of edges by connected node
 *
 * @example
 * ```typescript
 * const index = new NodeEdgeIndex();
 *
 * // Build index from edges
 * index.addEdge('edge-1', 'node-a', 'node-b');
 * index.addEdge('edge-2', 'node-a', 'node-c');
 *
 * // Find edges connected to a node
 * const edges = index.getEdgesForNode('node-a');
 * // Returns: Set { 'edge-1', 'edge-2' }
 * ```
 */
export class NodeEdgeIndex {
  /** Map from node ID to set of connected edge IDs */
  private nodeToEdges: Map<string, Set<string>> = new Map();

  /** Map from edge ID to [sourceId, targetId] */
  private edgeToNodes: Map<string, [string, string]> = new Map();

  /**
   * Add an edge to the index
   *
   * @param edgeId - Edge identifier
   * @param sourceId - Source node ID
   * @param targetId - Target node ID
   */
  addEdge(edgeId: string, sourceId: string, targetId: string): void {
    // Add to source node's edge set
    let sourceEdges = this.nodeToEdges.get(sourceId);
    if (!sourceEdges) {
      sourceEdges = new Set();
      this.nodeToEdges.set(sourceId, sourceEdges);
    }
    sourceEdges.add(edgeId);

    // Add to target node's edge set
    let targetEdges = this.nodeToEdges.get(targetId);
    if (!targetEdges) {
      targetEdges = new Set();
      this.nodeToEdges.set(targetId, targetEdges);
    }
    targetEdges.add(edgeId);

    // Store edge to node mapping
    this.edgeToNodes.set(edgeId, [sourceId, targetId]);
  }

  /**
   * Remove an edge from the index
   *
   * @param edgeId - Edge identifier to remove
   */
  removeEdge(edgeId: string): void {
    const nodes = this.edgeToNodes.get(edgeId);
    if (!nodes) return;

    const [sourceId, targetId] = nodes;

    // Remove from source node's edge set
    const sourceEdges = this.nodeToEdges.get(sourceId);
    if (sourceEdges) {
      sourceEdges.delete(edgeId);
      if (sourceEdges.size === 0) {
        this.nodeToEdges.delete(sourceId);
      }
    }

    // Remove from target node's edge set
    const targetEdges = this.nodeToEdges.get(targetId);
    if (targetEdges) {
      targetEdges.delete(edgeId);
      if (targetEdges.size === 0) {
        this.nodeToEdges.delete(targetId);
      }
    }

    this.edgeToNodes.delete(edgeId);
  }

  /**
   * Get all edges connected to a node
   *
   * @param nodeId - Node identifier
   * @returns Set of connected edge IDs (empty set if node not found)
   */
  getEdgesForNode(nodeId: string): Set<string> {
    return this.nodeToEdges.get(nodeId) ?? new Set();
  }

  /**
   * Get the nodes connected by an edge
   *
   * @param edgeId - Edge identifier
   * @returns [sourceId, targetId] or undefined if edge not found
   */
  getNodesForEdge(edgeId: string): [string, string] | undefined {
    return this.edgeToNodes.get(edgeId);
  }

  /**
   * Check if a node has any edges
   *
   * @param nodeId - Node identifier
   * @returns True if node has at least one edge
   */
  hasEdges(nodeId: string): boolean {
    const edges = this.nodeToEdges.get(nodeId);
    return edges !== undefined && edges.size > 0;
  }

  /**
   * Get the edge count for a node (degree)
   *
   * @param nodeId - Node identifier
   * @returns Number of edges connected to the node
   */
  getDegree(nodeId: string): number {
    return this.nodeToEdges.get(nodeId)?.size ?? 0;
  }

  /**
   * Get the underlying node-to-edges map for batch operations
   *
   * @returns The node-to-edges map
   */
  getNodeEdgesMap(): Map<string, Set<string>> {
    return this.nodeToEdges;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.nodeToEdges.clear();
    this.edgeToNodes.clear();
  }

  /**
   * Get statistics
   *
   * @returns Object with nodeCount and edgeCount
   */
  getStats(): { nodeCount: number; edgeCount: number } {
    return {
      nodeCount: this.nodeToEdges.size,
      edgeCount: this.edgeToNodes.size,
    };
  }
}

/**
 * Configuration for DirtyTracker thresholds
 */
export interface DirtyTrackerConfig {
  /**
   * Maximum number of dirty nodes before triggering full redraw
   * @default 0.5 (50% of total nodes)
   */
  fullRedrawThreshold?: number;

  /**
   * Enable automatic batching of rapid changes
   * @default true
   */
  enableBatching?: boolean;

  /**
   * Batch window in milliseconds
   * @default 16 (one frame at 60fps)
   */
  batchWindowMs?: number;
}

/**
 * Default dirty tracker configuration
 */
export const DEFAULT_DIRTY_TRACKER_CONFIG: Required<DirtyTrackerConfig> = {
  fullRedrawThreshold: 0.5,
  enableBatching: true,
  batchWindowMs: 16,
};
