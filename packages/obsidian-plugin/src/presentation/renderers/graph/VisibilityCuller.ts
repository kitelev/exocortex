/**
 * VisibilityCuller - Visibility culling for off-screen elements
 *
 * Implements efficient visibility culling to skip rendering of off-screen elements.
 * Significantly improves performance for large graphs where only a fraction is visible.
 *
 * Features:
 * - Spatial indexing using an R-tree-like structure
 * - Viewport-based visibility queries
 * - Margin-based lookahead for smooth scrolling
 * - Edge visibility based on endpoint nodes
 * - Incremental updates for position changes
 * - Statistics for performance monitoring
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "./types";

/**
 * Viewport bounds in world coordinates
 */
export interface ViewportBounds {
  /** Left edge (minimum X) */
  left: number;
  /** Top edge (minimum Y) */
  top: number;
  /** Right edge (maximum X) */
  right: number;
  /** Bottom edge (maximum Y) */
  bottom: number;
  /** Current zoom level */
  zoom: number;
}

/**
 * Bounds for a node in the spatial index
 */
export interface NodeBounds {
  /** Minimum X coordinate */
  minX: number;
  /** Minimum Y coordinate */
  minY: number;
  /** Maximum X coordinate */
  maxX: number;
  /** Maximum Y coordinate */
  maxY: number;
  /** Node identifier */
  nodeId: string;
}

/**
 * Configuration for VisibilityCuller
 */
export interface VisibilityCullerConfig {
  /**
   * Margin in screen pixels to add around viewport.
   * Larger margin = more pre-loading, smoother scrolling.
   * @default 100
   */
  margin?: number;

  /**
   * Maximum node radius to assume for bounds calculation.
   * Used when node doesn't specify explicit radius.
   * @default 20
   */
  defaultNodeRadius?: number;

  /**
   * Whether to include edges where at least one endpoint is visible.
   * If false, only edges where both endpoints are visible are included.
   * @default true
   */
  includePartialEdges?: boolean;

  /**
   * Minimum zoom level to enable culling.
   * At very low zoom levels, most nodes are visible anyway.
   * @default 0.1
   */
  minZoomForCulling?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_VISIBILITY_CULLER_CONFIG: Required<VisibilityCullerConfig> = {
  margin: 100,
  defaultNodeRadius: 20,
  includePartialEdges: true,
  minZoomForCulling: 0.1,
};

/**
 * Statistics for visibility culling
 */
export interface VisibilityCullerStats {
  /** Total nodes in index */
  totalNodes: number;
  /** Visible nodes after culling */
  visibleNodes: number;
  /** Total edges in graph */
  totalEdges: number;
  /** Visible edges after culling */
  visibleEdges: number;
  /** Culling efficiency (1 - visibleNodes/totalNodes) */
  efficiency: number;
  /** Last query duration in ms */
  lastQueryDurationMs: number;
}

/**
 * R-tree node for spatial indexing
 *
 * Uses a simple quadrant-based approach optimized for graph rendering.
 */
interface SpatialNode {
  /** Bounds of this node */
  bounds: NodeBounds;
  /** Children nodes (for internal nodes) */
  children?: SpatialNode[];
  /** Data items (for leaf nodes) */
  items?: NodeBounds[];
  /** Whether this is a leaf node */
  isLeaf: boolean;
}

/**
 * VisibilityCuller - Efficient visibility culling for graph rendering
 *
 * @example
 * ```typescript
 * const culler = new VisibilityCuller();
 *
 * // Build index from nodes
 * culler.buildIndex(nodes, positions);
 *
 * // Get visible nodes for current viewport
 * const viewport = { left: -500, top: -400, right: 500, bottom: 400, zoom: 1 };
 * const visibleNodes = culler.getVisibleNodes(viewport);
 * const visibleEdges = culler.getVisibleEdges(viewport, edges);
 *
 * // Update positions incrementally
 * culler.updatePosition(nodeId, newPosition, radius);
 *
 * // Get stats
 * console.log(culler.getStats());
 * ```
 */
export class VisibilityCuller {
  /** Spatial index root */
  private root: SpatialNode | null = null;

  /** Map of node IDs to their bounds for quick lookup */
  private nodeBoundsMap: Map<string, NodeBounds> = new Map();

  /** Set of currently visible node IDs */
  private visibleNodes: Set<string> = new Set();

  /** Set of currently visible edge IDs */
  private visibleEdges: Set<string> = new Set();

  /** Configuration */
  private config: Required<VisibilityCullerConfig>;

  /** Statistics */
  private stats: VisibilityCullerStats = {
    totalNodes: 0,
    visibleNodes: 0,
    totalEdges: 0,
    visibleEdges: 0,
    efficiency: 0,
    lastQueryDurationMs: 0,
  };

  /** Max items per leaf node */
  private readonly MAX_ITEMS_PER_NODE = 16;

  constructor(config: VisibilityCullerConfig = {}) {
    this.config = {
      ...DEFAULT_VISIBILITY_CULLER_CONFIG,
      ...config,
    };
  }

  /**
   * Build the spatial index from a list of nodes
   *
   * @param nodes - Array of graph nodes
   * @param positions - Optional map of node positions (uses node.x/y if not provided)
   */
  buildIndex(
    nodes: GraphNode[],
    positions?: Map<string, { x: number; y: number }>
  ): void {
    // Clear existing index
    this.clear();

    if (nodes.length === 0) {
      return;
    }

    // Build bounds for all nodes
    const items: NodeBounds[] = [];

    for (const node of nodes) {
      const pos = positions?.get(node.id) ?? { x: node.x ?? 0, y: node.y ?? 0 };
      const radius = node.size ?? this.config.defaultNodeRadius;

      const bounds: NodeBounds = {
        minX: pos.x - radius,
        minY: pos.y - radius,
        maxX: pos.x + radius,
        maxY: pos.y + radius,
        nodeId: node.id,
      };

      items.push(bounds);
      this.nodeBoundsMap.set(node.id, bounds);
    }

    this.stats.totalNodes = nodes.length;

    // Build the spatial index using bulk loading
    this.root = this.buildTree(items);
  }

  /**
   * Build spatial tree recursively using bulk loading
   */
  private buildTree(items: NodeBounds[]): SpatialNode {
    // Calculate total bounds
    const bounds = this.calculateBounds(items);

    if (items.length <= this.MAX_ITEMS_PER_NODE) {
      // Create leaf node
      return {
        bounds,
        items: [...items],
        isLeaf: true,
      };
    }

    // Sort by center X to create balanced partitions
    const sorted = [...items].sort((a, b) => {
      const centerA = (a.minX + a.maxX) / 2;
      const centerB = (b.minX + b.maxX) / 2;
      return centerA - centerB;
    });

    // Split into quadrants
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;

    const quadrants: NodeBounds[][] = [[], [], [], []];

    for (const item of sorted) {
      const centerX = (item.minX + item.maxX) / 2;
      const centerY = (item.minY + item.maxY) / 2;

      const quadrant =
        (centerX >= midX ? 1 : 0) + (centerY >= midY ? 2 : 0);
      quadrants[quadrant].push(item);
    }

    // Create children for non-empty quadrants
    const children: SpatialNode[] = [];
    for (const quadrant of quadrants) {
      if (quadrant.length > 0) {
        children.push(this.buildTree(quadrant));
      }
    }

    return {
      bounds,
      children,
      isLeaf: false,
    };
  }

  /**
   * Calculate bounding box for a set of items
   */
  private calculateBounds(items: NodeBounds[]): NodeBounds {
    if (items.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, nodeId: "" };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of items) {
      if (item.minX < minX) minX = item.minX;
      if (item.minY < minY) minY = item.minY;
      if (item.maxX > maxX) maxX = item.maxX;
      if (item.maxY > maxY) maxY = item.maxY;
    }

    return { minX, minY, maxX, maxY, nodeId: "" };
  }

  /**
   * Update position of a single node
   *
   * @param nodeId - Node identifier
   * @param position - New position
   * @param radius - Node radius (optional)
   */
  updatePosition(
    nodeId: string,
    position: { x: number; y: number },
    radius?: number
  ): void {
    if (!this.nodeBoundsMap.has(nodeId)) return;

    const r = radius ?? this.config.defaultNodeRadius;
    const bounds: NodeBounds = {
      minX: position.x - r,
      minY: position.y - r,
      maxX: position.x + r,
      maxY: position.y + r,
      nodeId,
    };

    // Update the bounds map
    this.nodeBoundsMap.set(nodeId, bounds);

    // Rebuild tree to ensure correct spatial indexing after position change
    // This handles nodes that move between quadrants
    if (this.nodeBoundsMap.size > 0) {
      this.root = this.buildTree(Array.from(this.nodeBoundsMap.values()));
    }
  }

  /**
   * Convert viewport to world bounds with margin
   */
  private viewportToWorldBounds(viewport: ViewportBounds): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    // Calculate margin in world coordinates
    const margin = this.config.margin / viewport.zoom;

    return {
      minX: viewport.left - margin,
      minY: viewport.top - margin,
      maxX: viewport.right + margin,
      maxY: viewport.bottom + margin,
    };
  }

  /**
   * Check if two axis-aligned boxes intersect
   */
  private boundsIntersect(
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number }
  ): boolean {
    return (
      a.minX <= b.maxX &&
      a.maxX >= b.minX &&
      a.minY <= b.maxY &&
      a.maxY >= b.minY
    );
  }

  /**
   * Query visible nodes for current viewport
   *
   * @param viewport - Current viewport bounds in world coordinates
   * @returns Set of visible node IDs
   */
  getVisibleNodes(viewport: ViewportBounds): Set<string> {
    const startTime = performance.now();

    // At very low zoom, return all nodes (culling overhead not worth it)
    if (viewport.zoom < this.config.minZoomForCulling) {
      this.visibleNodes = new Set(this.nodeBoundsMap.keys());
      this.updateStats(startTime);
      return this.visibleNodes;
    }

    const worldBounds = this.viewportToWorldBounds(viewport);
    const visible = new Set<string>();

    if (this.root) {
      this.queryTree(this.root, worldBounds, visible);
    }

    this.visibleNodes = visible;
    this.updateStats(startTime);
    return visible;
  }

  /**
   * Recursively query the spatial tree
   */
  private queryTree(
    node: SpatialNode,
    queryBounds: { minX: number; minY: number; maxX: number; maxY: number },
    result: Set<string>
  ): void {
    // Check if this node's bounds intersect the query
    if (!this.boundsIntersect(node.bounds, queryBounds)) {
      return;
    }

    if (node.isLeaf && node.items) {
      // Check each item in the leaf
      for (const item of node.items) {
        if (this.boundsIntersect(item, queryBounds)) {
          result.add(item.nodeId);
        }
      }
    } else if (node.children) {
      // Recurse into children
      for (const child of node.children) {
        this.queryTree(child, queryBounds, result);
      }
    }
  }

  /**
   * Query visible edges based on visible nodes
   *
   * @param viewport - Current viewport bounds
   * @param edges - All edges in the graph
   * @returns Set of visible edge IDs
   */
  getVisibleEdges(
    viewport: ViewportBounds,
    edges: GraphEdge[]
  ): Set<string> {
    // First ensure we have visible nodes
    if (this.visibleNodes.size === 0) {
      this.getVisibleNodes(viewport);
    }

    const visible = new Set<string>();

    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const sourceVisible = this.visibleNodes.has(sourceId);
      const targetVisible = this.visibleNodes.has(targetId);

      if (this.config.includePartialEdges) {
        // Include if either endpoint is visible
        if (sourceVisible || targetVisible) {
          visible.add(edge.id);
        }
      } else {
        // Include only if both endpoints are visible
        if (sourceVisible && targetVisible) {
          visible.add(edge.id);
        }
      }
    }

    this.visibleEdges = visible;
    this.stats.totalEdges = edges.length;
    this.stats.visibleEdges = visible.size;

    return visible;
  }

  /**
   * Check if a specific node is visible
   *
   * @param nodeId - Node identifier
   * @returns True if the node is currently visible
   */
  isNodeVisible(nodeId: string): boolean {
    return this.visibleNodes.has(nodeId);
  }

  /**
   * Check if a specific edge is visible
   *
   * @param edgeId - Edge identifier
   * @returns True if the edge is currently visible
   */
  isEdgeVisible(edgeId: string): boolean {
    return this.visibleEdges.has(edgeId);
  }

  /**
   * Get all visible node IDs
   *
   * @returns Set of visible node IDs
   */
  getVisibleNodeIds(): Set<string> {
    return new Set(this.visibleNodes);
  }

  /**
   * Get all visible edge IDs
   *
   * @returns Set of visible edge IDs
   */
  getVisibleEdgeIds(): Set<string> {
    return new Set(this.visibleEdges);
  }

  /**
   * Update statistics after a query
   */
  private updateStats(startTime: number): void {
    this.stats.visibleNodes = this.visibleNodes.size;
    this.stats.lastQueryDurationMs = performance.now() - startTime;
    this.stats.efficiency =
      this.stats.totalNodes > 0
        ? 1 - this.stats.visibleNodes / this.stats.totalNodes
        : 0;
  }

  /**
   * Get visibility culling statistics
   *
   * @returns Current statistics
   */
  getStats(): VisibilityCullerStats {
    return { ...this.stats };
  }

  /**
   * Clear all data and reset state
   */
  clear(): void {
    this.root = null;
    this.nodeBoundsMap.clear();
    this.visibleNodes.clear();
    this.visibleEdges.clear();
    this.stats = {
      totalNodes: 0,
      visibleNodes: 0,
      totalEdges: 0,
      visibleEdges: 0,
      efficiency: 0,
      lastQueryDurationMs: 0,
    };
  }

  /**
   * Add a single node to the index
   *
   * @param node - Node to add
   * @param position - Optional position (uses node.x/y if not provided)
   */
  addNode(node: GraphNode, position?: { x: number; y: number }): void {
    const pos = position ?? { x: node.x ?? 0, y: node.y ?? 0 };
    const radius = node.size ?? this.config.defaultNodeRadius;

    const bounds: NodeBounds = {
      minX: pos.x - radius,
      minY: pos.y - radius,
      maxX: pos.x + radius,
      maxY: pos.y + radius,
      nodeId: node.id,
    };

    this.nodeBoundsMap.set(node.id, bounds);
    this.stats.totalNodes++;

    // For simplicity, rebuild tree when adding nodes
    // A proper R-tree would do incremental insert
    if (this.nodeBoundsMap.size > 0) {
      this.root = this.buildTree(Array.from(this.nodeBoundsMap.values()));
    }
  }

  /**
   * Remove a node from the index
   *
   * @param nodeId - Node identifier to remove
   */
  removeNode(nodeId: string): void {
    if (!this.nodeBoundsMap.has(nodeId)) return;

    this.nodeBoundsMap.delete(nodeId);
    this.visibleNodes.delete(nodeId);
    this.stats.totalNodes--;

    // Rebuild tree
    if (this.nodeBoundsMap.size > 0) {
      this.root = this.buildTree(Array.from(this.nodeBoundsMap.values()));
    } else {
      this.root = null;
    }
  }

  /**
   * Batch update positions for multiple nodes
   *
   * @param updates - Array of position updates
   */
  updatePositions(
    updates: Array<{ nodeId: string; x: number; y: number; radius?: number }>
  ): void {
    for (const update of updates) {
      const r = update.radius ?? this.config.defaultNodeRadius;
      const bounds: NodeBounds = {
        minX: update.x - r,
        minY: update.y - r,
        maxX: update.x + r,
        maxY: update.y + r,
        nodeId: update.nodeId,
      };
      this.nodeBoundsMap.set(update.nodeId, bounds);
    }

    // Rebuild tree after batch update
    if (this.nodeBoundsMap.size > 0) {
      this.root = this.buildTree(Array.from(this.nodeBoundsMap.values()));
    }
  }

  /**
   * Get the count of nodes in the index
   *
   * @returns Number of nodes
   */
  size(): number {
    return this.nodeBoundsMap.size;
  }

  /**
   * Check if the index has any nodes
   *
   * @returns True if index is not empty
   */
  hasNodes(): boolean {
    return this.nodeBoundsMap.size > 0;
  }

  /**
   * Get the bounds of the entire graph
   *
   * @returns Bounding box of all nodes, or null if empty
   */
  getGraphBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (!this.root) return null;
    return {
      minX: this.root.bounds.minX,
      minY: this.root.bounds.minY,
      maxX: this.root.bounds.maxX,
      maxY: this.root.bounds.maxY,
    };
  }
}
