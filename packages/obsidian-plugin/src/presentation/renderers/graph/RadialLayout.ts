/**
 * RadialLayout - Radial and circular layout algorithm with focus node
 *
 * Implements a radial layout for visualizing graphs with a central focus node,
 * concentric relationship rings, and arc-based edge routing for ontology visualization.
 *
 * The layout arranges nodes in concentric circles around a focus node:
 * - Ring 0: Center node (focus)
 * - Ring 1: Direct neighbors of focus
 * - Ring 2+: Nodes at increasing distances
 *
 * Supports multiple ring assignment algorithms, angular distribution strategies,
 * and arc-based edge routing for clean visualization.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphData, GraphNode, GraphEdge } from "./types";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Sort criteria for angular ordering of nodes within rings
 */
export type RadialSortBy = "connection" | "type" | "label" | "custom";

/**
 * Sort order direction
 */
export type SortOrder = "asc" | "desc";

/**
 * Strategy for allocating angle space to subtrees
 */
export type SubtreeAngleStrategy = "proportional" | "equal";

/**
 * Algorithm for assigning nodes to rings
 */
export type RingAssignmentAlgorithm = "bfs" | "hierarchy" | "custom";

/**
 * Edge routing style for radial layout
 */
export type EdgeRoutingStyle = "arc" | "straight" | "curved";

/**
 * Configuration options for radial layout
 */
export interface RadialLayoutOptions {
  /** Node to place at center (auto-detected if not provided) */
  centerNode?: string;

  /** Distance between rings in pixels (default: 100) */
  radiusStep: number;

  /** Starting angle in radians (default: 0) */
  startAngle: number;

  /** Ending angle in radians (default: 2π for full circle) */
  endAngle: number;

  /** Criteria for sorting nodes within rings (default: 'connection') */
  sortBy: RadialSortBy;

  /** Sort order direction (default: 'desc') */
  sortOrder: SortOrder;

  /** Whether to use equal angular spacing vs weighted (default: false) */
  equalAngle: boolean;

  /** Strategy for allocating angle space to subtrees (default: 'proportional') */
  subtreeAngle: SubtreeAngleStrategy;

  /** Algorithm for assigning nodes to rings (default: 'bfs') */
  ringAssignment: RingAssignmentAlgorithm;

  /** Minimum angle gap between adjacent nodes in radians (default: 0.1) */
  minAngleGap: number;

  /** Whether to compact empty angular space (default: true) */
  compact: boolean;

  /** Edge routing style (default: 'arc') */
  edgeRouting: EdgeRoutingStyle;

  /** Arc curvature factor for edge routing (default: 0.3) */
  arcCurvature: number;

  /** Margin around the layout in pixels (default: 50) */
  margin: number;

  /** Center offset from origin (default: { x: 0, y: 0 }) */
  centerOffset: { x: number; y: number };

  /** Custom node sorter function for 'custom' sortBy */
  customSorter?: (a: RadialNode, b: RadialNode) => number;

  /** Custom ring assignment function for 'custom' ringAssignment */
  customRingAssigner?: (
    nodeId: string,
    graph: GraphData,
    centerNode: string
  ) => number;
}

/**
 * Extended node with radial layout properties
 */
export interface RadialNode extends GraphNode {
  /** Distance from center (0 = center node) */
  ring: number;

  /** Angular position in radians */
  angle: number;

  /** Size of subtree for angle allocation */
  subtreeSize: number;

  /** Parent node ID (null for center node) */
  parent: string | null;

  /** Child node IDs */
  children: string[];

  /** Angular span allocated to this node's subtree */
  angleSpan: number;

  /** Start angle for this node's subtree */
  startAngle: number;

  /** End angle for this node's subtree */
  endAngle: number;
}

/**
 * Extended edge with radial layout properties
 */
export interface RadialEdge extends GraphEdge {
  /** Control points for arc routing */
  controlPoints?: Array<{ x: number; y: number }>;

  /** Whether edge spans multiple rings */
  isLongEdge: boolean;

  /** Number of rings spanned */
  ringSpan: number;

  /** Curvature direction (1 = clockwise, -1 = counter-clockwise) */
  curvatureDirection: number;
}

/**
 * Result of radial layout computation
 */
export interface RadialLayoutResult {
  /** Node positions indexed by node ID */
  positions: Map<string, { x: number; y: number }>;

  /** Routed edges with control points */
  edges: RadialEdge[];

  /** Layout bounds */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    radius: number;
  };

  /** Layout statistics */
  stats: {
    /** Number of rings */
    ringCount: number;
    /** Maximum ring radius */
    maxRadius: number;
    /** Number of long edges (spanning multiple rings) */
    longEdges: number;
    /** Center node ID */
    centerNode: string;
    /** Nodes per ring */
    nodesPerRing: number[];
  };
}

/**
 * Internal representation of a ring
 */
interface Ring {
  /** Nodes in this ring, ordered by angle */
  nodes: RadialNode[];

  /** Radius of this ring */
  radius: number;

  /** Ring index (0 = center) */
  index: number;
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default radial layout options
 */
export const DEFAULT_RADIAL_OPTIONS: RadialLayoutOptions = {
  radiusStep: 100,
  startAngle: 0,
  endAngle: Math.PI * 2,
  sortBy: "connection",
  sortOrder: "desc",
  equalAngle: false,
  subtreeAngle: "proportional",
  ringAssignment: "bfs",
  minAngleGap: 0.1,
  compact: true,
  edgeRouting: "arc",
  arcCurvature: 0.3,
  margin: 50,
  centerOffset: { x: 0, y: 0 },
};

// ============================================================
// RadialLayout Class
// ============================================================

/**
 * Radial layout algorithm implementation
 *
 * Implements a circular/radial layout with:
 * - Center node selection (automatic or explicit)
 * - Ring assignment based on graph distance
 * - Angular positioning with subtree-aware allocation
 * - Arc-based edge routing
 *
 * @example
 * ```typescript
 * const layout = new RadialLayout({
 *   centerNode: 'root-node-id',
 *   radiusStep: 100,
 *   subtreeAngle: 'proportional',
 * });
 *
 * const result = layout.layout(graphData);
 * // result.positions contains node positions in polar coordinates converted to x,y
 * // result.edges contains routed edges with arc control points
 * ```
 */
export class RadialLayout {
  private options: RadialLayoutOptions;
  private rings: Map<number, Ring> = new Map();
  private nodeMap: Map<string, RadialNode> = new Map();
  private edgeMap: Map<string, RadialEdge> = new Map();
  private adjacency: Map<string, Set<string>> = new Map();
  private reverseAdjacency: Map<string, Set<string>> = new Map();
  private centerNodeId: string | null = null;

  constructor(options: Partial<RadialLayoutOptions> = {}) {
    this.options = { ...DEFAULT_RADIAL_OPTIONS, ...options };
  }

  /**
   * Compute radial layout for the given graph
   */
  layout(graph: GraphData): RadialLayoutResult {
    // Reset state
    this.rings.clear();
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.adjacency.clear();
    this.reverseAdjacency.clear();
    this.centerNodeId = null;

    // Handle empty graph
    if (graph.nodes.length === 0) {
      return this.createEmptyResult();
    }

    // Phase 0: Initialize data structures
    this.initializeGraph(graph);

    // Phase 1: Select center node
    this.centerNodeId = this.selectCenterNode(graph);

    // Phase 2: Assign rings (distance from center)
    this.assignRings();

    // Phase 3: Calculate subtree sizes for angle allocation
    this.calculateSubtreeSizes();

    // Phase 4: Assign angular positions
    this.assignAngles();

    // Phase 5: Convert polar to Cartesian coordinates
    this.convertToCartesian();

    // Phase 6: Route edges
    this.routeEdges();

    // Build result
    return this.buildResult();
  }

  // ============================================================
  // Phase 0: Initialization
  // ============================================================

  private initializeGraph(graph: GraphData): void {
    // Create radial nodes
    for (const node of graph.nodes) {
      const rNode: RadialNode = {
        ...node,
        ring: -1,
        angle: 0,
        subtreeSize: 1,
        parent: null,
        children: [],
        angleSpan: 0,
        startAngle: 0,
        endAngle: 0,
        x: 0,
        y: 0,
      };
      this.nodeMap.set(node.id, rNode);
      this.adjacency.set(node.id, new Set());
      this.reverseAdjacency.set(node.id, new Set());
    }

    // Create edges and build adjacency (bidirectional for radial layout)
    for (const edge of graph.edges) {
      const sourceId =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === "string" ? edge.target : edge.target.id;

      // Skip edges with missing nodes
      if (!this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId)) {
        continue;
      }

      const rEdge: RadialEdge = {
        ...edge,
        source: sourceId,
        target: targetId,
        isLongEdge: false,
        ringSpan: 0,
        curvatureDirection: 1,
      };
      this.edgeMap.set(edge.id, rEdge);

      // Build bidirectional adjacency for distance calculation
      this.adjacency.get(sourceId)!.add(targetId);
      this.adjacency.get(targetId)!.add(sourceId);
      this.reverseAdjacency.get(targetId)!.add(sourceId);
      this.reverseAdjacency.get(sourceId)!.add(targetId);
    }
  }

  // ============================================================
  // Phase 1: Center Node Selection
  // ============================================================

  /**
   * Select the center node for the radial layout
   * Priority: explicit option > highest degree > first node
   */
  private selectCenterNode(graph: GraphData): string {
    // Use explicit center node if provided and valid
    if (this.options.centerNode && this.nodeMap.has(this.options.centerNode)) {
      return this.options.centerNode;
    }

    // Find node with highest degree (most connections)
    let maxDegree = -1;
    let centerNode = graph.nodes[0]?.id || "";

    for (const nodeId of this.nodeMap.keys()) {
      const degree =
        (this.adjacency.get(nodeId)?.size || 0) +
        (this.reverseAdjacency.get(nodeId)?.size || 0);
      if (degree > maxDegree) {
        maxDegree = degree;
        centerNode = nodeId;
      }
    }

    return centerNode;
  }

  // ============================================================
  // Phase 2: Ring Assignment
  // ============================================================

  /**
   * Assign nodes to rings based on distance from center
   */
  private assignRings(): void {
    switch (this.options.ringAssignment) {
      case "hierarchy":
        this.assignRingsHierarchy();
        break;
      case "custom":
        this.assignRingsCustom();
        break;
      case "bfs":
      default:
        this.assignRingsBFS();
        break;
    }
  }

  /**
   * BFS-based ring assignment (shortest path from center)
   */
  private assignRingsBFS(): void {
    if (!this.centerNodeId) return;

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; ring: number; parent: string | null }> =
      [];

    // Start from center node
    const centerNode = this.nodeMap.get(this.centerNodeId)!;
    centerNode.ring = 0;
    centerNode.parent = null;
    visited.add(this.centerNodeId);
    queue.push({ nodeId: this.centerNodeId, ring: 0, parent: null });

    while (queue.length > 0) {
      const { nodeId, ring, parent } = queue.shift()!;
      const node = this.nodeMap.get(nodeId)!;
      node.ring = ring;
      node.parent = parent;

      // Get parent node to set up child relationship
      if (parent) {
        const parentNode = this.nodeMap.get(parent);
        if (parentNode) {
          parentNode.children.push(nodeId);
        }
      }

      // Add neighbors to queue
      const neighbors = this.adjacency.get(nodeId) || new Set();
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ nodeId: neighborId, ring: ring + 1, parent: nodeId });
        }
      }
    }

    // Handle disconnected nodes (place in outermost ring)
    const maxRing = Math.max(...[...this.nodeMap.values()].map((n) => n.ring));
    for (const node of this.nodeMap.values()) {
      if (node.ring === -1) {
        node.ring = maxRing + 1;
      }
    }

    this.buildRings();
  }

  /**
   * Hierarchy-based ring assignment (respects parent-child relationships)
   */
  private assignRingsHierarchy(): void {
    // Similar to BFS but follows directed edges only
    if (!this.centerNodeId) return;

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; ring: number; parent: string | null }> =
      [];

    const centerNode = this.nodeMap.get(this.centerNodeId)!;
    centerNode.ring = 0;
    centerNode.parent = null;
    visited.add(this.centerNodeId);
    queue.push({ nodeId: this.centerNodeId, ring: 0, parent: null });

    while (queue.length > 0) {
      const { nodeId, ring, parent } = queue.shift()!;
      const node = this.nodeMap.get(nodeId)!;
      node.ring = ring;
      node.parent = parent;

      if (parent) {
        const parentNode = this.nodeMap.get(parent);
        if (parentNode) {
          parentNode.children.push(nodeId);
        }
      }

      // Only follow outgoing edges for hierarchy
      const outgoing = new Set<string>();
      for (const edge of this.edgeMap.values()) {
        const sourceId =
          typeof edge.source === "string" ? edge.source : edge.source.id;
        if (sourceId === nodeId) {
          const targetId =
            typeof edge.target === "string" ? edge.target : edge.target.id;
          outgoing.add(targetId);
        }
      }

      for (const neighborId of outgoing) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ nodeId: neighborId, ring: ring + 1, parent: nodeId });
        }
      }
    }

    // Handle disconnected nodes
    const maxRing = Math.max(
      0,
      ...[...this.nodeMap.values()].map((n) => n.ring).filter((r) => r >= 0)
    );
    for (const node of this.nodeMap.values()) {
      if (node.ring === -1) {
        node.ring = maxRing + 1;
      }
    }

    this.buildRings();
  }

  /**
   * Custom ring assignment using provided function
   */
  private assignRingsCustom(): void {
    if (!this.options.customRingAssigner || !this.centerNodeId) {
      // Fall back to BFS
      this.assignRingsBFS();
      return;
    }

    const graphData: GraphData = {
      nodes: [...this.nodeMap.values()],
      edges: [...this.edgeMap.values()],
    };

    for (const node of this.nodeMap.values()) {
      node.ring = this.options.customRingAssigner(
        node.id,
        graphData,
        this.centerNodeId
      );
    }

    this.buildRings();
  }

  /**
   * Build ring data structures from assigned ring values
   */
  private buildRings(): void {
    this.rings.clear();

    for (const node of this.nodeMap.values()) {
      if (!this.rings.has(node.ring)) {
        this.rings.set(node.ring, {
          nodes: [],
          radius: node.ring * this.options.radiusStep,
          index: node.ring,
        });
      }
      this.rings.get(node.ring)!.nodes.push(node);
    }
  }

  // ============================================================
  // Phase 3: Subtree Size Calculation
  // ============================================================

  /**
   * Calculate subtree sizes for angle allocation
   */
  private calculateSubtreeSizes(): void {
    // Process rings from outermost to innermost
    const sortedRings = [...this.rings.keys()].sort((a, b) => b - a);

    for (const ringIndex of sortedRings) {
      const ring = this.rings.get(ringIndex)!;
      for (const node of ring.nodes) {
        // Leaf nodes have subtree size 1
        if (node.children.length === 0) {
          node.subtreeSize = 1;
        } else {
          // Parent nodes have subtree size = sum of children's subtree sizes
          node.subtreeSize = node.children.reduce((sum, childId) => {
            const child = this.nodeMap.get(childId);
            return sum + (child?.subtreeSize || 0);
          }, 0);
        }
      }
    }
  }

  // ============================================================
  // Phase 4: Angular Position Assignment
  // ============================================================

  /**
   * Assign angular positions to nodes
   */
  private assignAngles(): void {
    if (!this.centerNodeId) return;

    const totalAngle = this.options.endAngle - this.options.startAngle;
    const centerNode = this.nodeMap.get(this.centerNodeId)!;

    // Center node is at angle 0 (doesn't matter, it's at radius 0)
    centerNode.angle = 0;
    centerNode.startAngle = this.options.startAngle;
    centerNode.endAngle = this.options.endAngle;
    centerNode.angleSpan = totalAngle;

    // Sort nodes within rings before assigning angles
    this.sortNodesInRings();

    // Assign angles starting from ring 1
    if (centerNode.children.length > 0) {
      this.assignAnglesRecursive(
        this.centerNodeId,
        this.options.startAngle,
        this.options.endAngle
      );
    } else {
      // No children - distribute all nodes in ring 1 evenly
      this.distributeNodesEvenly();
    }
  }

  /**
   * Sort nodes within each ring based on sortBy option
   */
  private sortNodesInRings(): void {
    for (const ring of this.rings.values()) {
      ring.nodes.sort((a, b) => {
        if (this.options.sortBy === "custom" && this.options.customSorter) {
          return this.options.customSorter(a, b);
        }

        let comparison = 0;

        switch (this.options.sortBy) {
          case "connection": {
            // Sort by number of connections
            const aDegree =
              (this.adjacency.get(a.id)?.size || 0) +
              (this.reverseAdjacency.get(a.id)?.size || 0);
            const bDegree =
              (this.adjacency.get(b.id)?.size || 0) +
              (this.reverseAdjacency.get(b.id)?.size || 0);
            comparison = aDegree - bDegree;
            break;
          }

          case "type":
            // Sort by node group/type
            comparison = (a.group || "").localeCompare(b.group || "");
            break;

          case "label":
            // Sort by label
            comparison = a.label.localeCompare(b.label);
            break;
        }

        return this.options.sortOrder === "desc" ? -comparison : comparison;
      });
    }
  }

  /**
   * Recursively assign angles to subtrees
   */
  private assignAnglesRecursive(
    nodeId: string,
    startAngle: number,
    endAngle: number
  ): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const totalAngle = endAngle - startAngle;
    node.startAngle = startAngle;
    node.endAngle = endAngle;
    node.angleSpan = totalAngle;

    // Position this node at the center of its angle span
    node.angle = startAngle + totalAngle / 2;

    // Distribute angle among children
    if (node.children.length === 0) return;

    // Get total subtree size of children
    const totalSubtreeSize = node.children.reduce((sum, childId) => {
      const child = this.nodeMap.get(childId);
      return sum + (child?.subtreeSize || 1);
    }, 0);

    let currentAngle = startAngle;
    const angleGap = this.options.minAngleGap;

    for (const childId of node.children) {
      const child = this.nodeMap.get(childId);
      if (!child) continue;

      let childAngleSpan: number;

      if (this.options.subtreeAngle === "equal" || this.options.equalAngle) {
        // Equal distribution
        childAngleSpan =
          (totalAngle - angleGap * (node.children.length - 1)) /
          node.children.length;
      } else {
        // Proportional distribution based on subtree size
        const proportion = child.subtreeSize / totalSubtreeSize;
        childAngleSpan =
          proportion * (totalAngle - angleGap * (node.children.length - 1));
      }

      // Ensure minimum angle gap
      childAngleSpan = Math.max(childAngleSpan, angleGap);

      this.assignAnglesRecursive(
        childId,
        currentAngle,
        currentAngle + childAngleSpan
      );

      currentAngle += childAngleSpan + angleGap;
    }
  }

  /**
   * Distribute all nodes evenly when there's no parent-child structure
   */
  private distributeNodesEvenly(): void {
    const totalAngle = this.options.endAngle - this.options.startAngle;

    for (const ring of this.rings.values()) {
      if (ring.index === 0) continue; // Skip center node

      const nodeCount = ring.nodes.length;
      if (nodeCount === 0) continue;

      const angleStep = totalAngle / nodeCount;

      ring.nodes.forEach((node, index) => {
        node.angle = this.options.startAngle + angleStep * (index + 0.5);
        node.startAngle = this.options.startAngle + angleStep * index;
        node.endAngle = this.options.startAngle + angleStep * (index + 1);
        node.angleSpan = angleStep;
      });
    }
  }

  // ============================================================
  // Phase 5: Coordinate Conversion
  // ============================================================

  /**
   * Convert polar coordinates (ring, angle) to Cartesian (x, y)
   */
  private convertToCartesian(): void {
    const { centerOffset, margin } = this.options;

    for (const node of this.nodeMap.values()) {
      const radius = node.ring * this.options.radiusStep;

      // Convert polar to Cartesian
      node.x = radius * Math.cos(node.angle) + centerOffset.x;
      node.y = radius * Math.sin(node.angle) + centerOffset.y;
    }

    // Apply margin by shifting all nodes
    let minX = Infinity;
    let minY = Infinity;

    for (const node of this.nodeMap.values()) {
      minX = Math.min(minX, node.x ?? 0);
      minY = Math.min(minY, node.y ?? 0);
    }

    const shiftX = margin - minX;
    const shiftY = margin - minY;

    for (const node of this.nodeMap.values()) {
      node.x = (node.x ?? 0) + shiftX;
      node.y = (node.y ?? 0) + shiftY;
    }
  }

  // ============================================================
  // Phase 6: Edge Routing
  // ============================================================

  /**
   * Route edges with arc-based paths
   */
  private routeEdges(): void {
    for (const edge of this.edgeMap.values()) {
      const sourceId =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === "string" ? edge.target : edge.target.id;

      const source = this.nodeMap.get(sourceId);
      const target = this.nodeMap.get(targetId);

      if (!source || !target) continue;

      // Calculate ring span
      edge.ringSpan = Math.abs(source.ring - target.ring);
      edge.isLongEdge = edge.ringSpan > 1;

      // Determine curvature direction based on angular positions
      const angleDiff = target.angle - source.angle;
      edge.curvatureDirection = angleDiff >= 0 ? 1 : -1;

      // Generate control points based on routing style
      edge.controlPoints = this.generateEdgeControlPoints(source, target, edge);
    }
  }

  /**
   * Generate control points for edge routing
   */
  private generateEdgeControlPoints(
    source: RadialNode,
    target: RadialNode,
    edge: RadialEdge
  ): Array<{ x: number; y: number }> {
    const sourceX = source.x ?? 0;
    const sourceY = source.y ?? 0;
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;

    switch (this.options.edgeRouting) {
      case "straight":
        // Direct line between source and target
        return [
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
        ];

      case "curved":
        // Single bezier curve through midpoint with offset
        return this.generateCurvedPath(source, target, edge);

      case "arc":
      default:
        // Arc-based routing following the radial structure
        return this.generateArcPath(source, target, edge);
    }
  }

  /**
   * Generate curved path with bezier control points
   */
  private generateCurvedPath(
    source: RadialNode,
    target: RadialNode,
    edge: RadialEdge
  ): Array<{ x: number; y: number }> {
    const sourceX = source.x ?? 0;
    const sourceY = source.y ?? 0;
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;

    // Calculate midpoint
    const midX = (sourceX + targetX) / 2;
    const midY = (sourceY + targetY) / 2;

    // Calculate perpendicular offset
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len === 0) {
      return [
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      ];
    }

    // Perpendicular vector
    const perpX = -dy / len;
    const perpY = dx / len;

    // Offset based on curvature and direction
    const offset =
      len * this.options.arcCurvature * edge.curvatureDirection;

    // Control point
    const ctrlX = midX + perpX * offset;
    const ctrlY = midY + perpY * offset;

    return [
      { x: sourceX, y: sourceY },
      { x: ctrlX, y: ctrlY },
      { x: targetX, y: targetY },
    ];
  }

  /**
   * Generate arc-based path following radial structure
   */
  private generateArcPath(
    source: RadialNode,
    target: RadialNode,
    edge: RadialEdge
  ): Array<{ x: number; y: number }> {
    // For same-ring edges, route along the arc
    if (source.ring === target.ring && source.ring > 0) {
      return this.generateSameRingArc(source, target);
    }

    // For adjacent rings, use simple curve
    if (edge.ringSpan <= 1) {
      return this.generateCurvedPath(source, target, edge);
    }

    // For long edges spanning multiple rings, route through intermediate rings
    return this.generateMultiRingPath(source, target, edge);
  }

  /**
   * Generate arc path for edges within the same ring
   */
  private generateSameRingArc(
    source: RadialNode,
    target: RadialNode
  ): Array<{ x: number; y: number }> {
    const sourceX = source.x ?? 0;
    const sourceY = source.y ?? 0;
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;

    const centerX = this.options.centerOffset.x;
    const centerY = this.options.centerOffset.y;

    // Find the margin offset (same for all nodes)
    const anyNode = [...this.nodeMap.values()][0];
    const marginX = (anyNode?.x ?? 0) - (anyNode?.ring ?? 0) * this.options.radiusStep * Math.cos(anyNode?.angle ?? 0) - this.options.centerOffset.x;
    const marginY = (anyNode?.y ?? 0) - (anyNode?.ring ?? 0) * this.options.radiusStep * Math.sin(anyNode?.angle ?? 0) - this.options.centerOffset.y;

    const adjustedCenterX = centerX + marginX;
    const adjustedCenterY = centerY + marginY;

    const radius = source.ring * this.options.radiusStep;

    // Calculate intermediate arc points
    const numPoints = 5;
    const points: Array<{ x: number; y: number }> = [];

    const startAngle = source.angle;
    let endAngle = target.angle;

    // Ensure we take the shorter arc path
    const angleDiff = endAngle - startAngle;
    if (Math.abs(angleDiff) > Math.PI) {
      if (angleDiff > 0) {
        endAngle -= 2 * Math.PI;
      } else {
        endAngle += 2 * Math.PI;
      }
    }

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const angle = startAngle + t * (endAngle - startAngle);
      points.push({
        x: adjustedCenterX + radius * Math.cos(angle),
        y: adjustedCenterY + radius * Math.sin(angle),
      });
    }

    // Override first and last points with actual node positions
    points[0] = { x: sourceX, y: sourceY };
    points[points.length - 1] = { x: targetX, y: targetY };

    return points;
  }

  /**
   * Generate path for edges spanning multiple rings
   */
  private generateMultiRingPath(
    source: RadialNode,
    target: RadialNode,
    edge: RadialEdge
  ): Array<{ x: number; y: number }> {
    const sourceX = source.x ?? 0;
    const sourceY = source.y ?? 0;
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;

    const points: Array<{ x: number; y: number }> = [];
    points.push({ x: sourceX, y: sourceY });

    // Add intermediate control points at each ring boundary
    const minRing = Math.min(source.ring, target.ring);
    const maxRing = Math.max(source.ring, target.ring);

    // Find the margin offset
    const anyNode = [...this.nodeMap.values()][0];
    const marginX = (anyNode?.x ?? 0) - (anyNode?.ring ?? 0) * this.options.radiusStep * Math.cos(anyNode?.angle ?? 0) - this.options.centerOffset.x;
    const marginY = (anyNode?.y ?? 0) - (anyNode?.ring ?? 0) * this.options.radiusStep * Math.sin(anyNode?.angle ?? 0) - this.options.centerOffset.y;

    const adjustedCenterX = this.options.centerOffset.x + marginX;
    const adjustedCenterY = this.options.centerOffset.y + marginY;

    for (let ring = minRing + 1; ring < maxRing; ring++) {
      // Interpolate angle between source and target
      const t = (ring - source.ring) / (target.ring - source.ring);
      const angle = source.angle + t * (target.angle - source.angle);
      const radius = ring * this.options.radiusStep;

      // Add slight curve based on curvature setting
      const curveOffset = this.options.arcCurvature * 20 * edge.curvatureDirection;
      const curveAngle = angle + curveOffset * (Math.PI / 180);

      points.push({
        x: adjustedCenterX + radius * Math.cos(curveAngle),
        y: adjustedCenterY + radius * Math.sin(curveAngle),
      });
    }

    points.push({ x: targetX, y: targetY });

    return points;
  }

  // ============================================================
  // Result Building
  // ============================================================

  private buildResult(): RadialLayoutResult {
    const positions = new Map<string, { x: number; y: number }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxRing = 0;
    let longEdgeCount = 0;

    // Collect node positions
    for (const node of this.nodeMap.values()) {
      positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      minX = Math.min(minX, node.x ?? 0);
      minY = Math.min(minY, node.y ?? 0);
      maxX = Math.max(maxX, node.x ?? 0);
      maxY = Math.max(maxY, node.y ?? 0);
      maxRing = Math.max(maxRing, node.ring);
    }

    // Count long edges
    for (const edge of this.edgeMap.values()) {
      if (edge.isLongEdge) {
        longEdgeCount++;
      }
    }

    // Calculate nodes per ring
    const nodesPerRing: number[] = [];
    for (let r = 0; r <= maxRing; r++) {
      nodesPerRing.push(this.rings.get(r)?.nodes.length || 0);
    }

    const maxRadius = maxRing * this.options.radiusStep;

    return {
      positions,
      edges: [...this.edgeMap.values()],
      bounds: {
        minX: minX === Infinity ? 0 : minX,
        minY: minY === Infinity ? 0 : minY,
        maxX: maxX === -Infinity ? 0 : maxX,
        maxY: maxY === -Infinity ? 0 : maxY,
        width: maxX === -Infinity ? 0 : maxX - minX,
        height: maxY === -Infinity ? 0 : maxY - minY,
        radius: maxRadius,
      },
      stats: {
        ringCount: this.rings.size,
        maxRadius,
        longEdges: longEdgeCount,
        centerNode: this.centerNodeId || "",
        nodesPerRing,
      },
    };
  }

  private createEmptyResult(): RadialLayoutResult {
    return {
      positions: new Map(),
      edges: [],
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
        radius: 0,
      },
      stats: {
        ringCount: 0,
        maxRadius: 0,
        longEdges: 0,
        centerNode: "",
        nodesPerRing: [],
      },
    };
  }

  // ============================================================
  // Configuration Methods
  // ============================================================

  /**
   * Get current options
   */
  getOptions(): RadialLayoutOptions {
    return { ...this.options };
  }

  /**
   * Update options
   */
  setOptions(options: Partial<RadialLayoutOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get or set center node
   */
  centerNode(): string | undefined;
  centerNode(value: string): this;
  centerNode(value?: string): string | undefined | this {
    if (value === undefined) return this.options.centerNode;
    this.options.centerNode = value;
    return this;
  }

  /**
   * Get or set radius step
   */
  radiusStep(): number;
  radiusStep(value: number): this;
  radiusStep(value?: number): number | this {
    if (value === undefined) return this.options.radiusStep;
    this.options.radiusStep = value;
    return this;
  }

  /**
   * Get or set start angle
   */
  startAngle(): number;
  startAngle(value: number): this;
  startAngle(value?: number): number | this {
    if (value === undefined) return this.options.startAngle;
    this.options.startAngle = value;
    return this;
  }

  /**
   * Get or set end angle
   */
  endAngle(): number;
  endAngle(value: number): this;
  endAngle(value?: number): number | this {
    if (value === undefined) return this.options.endAngle;
    this.options.endAngle = value;
    return this;
  }

  /**
   * Get or set sort by criteria
   */
  sortBy(): RadialSortBy;
  sortBy(value: RadialSortBy): this;
  sortBy(value?: RadialSortBy): RadialSortBy | this {
    if (value === undefined) return this.options.sortBy;
    this.options.sortBy = value;
    return this;
  }

  /**
   * Get or set equal angle mode
   */
  equalAngle(): boolean;
  equalAngle(value: boolean): this;
  equalAngle(value?: boolean): boolean | this {
    if (value === undefined) return this.options.equalAngle;
    this.options.equalAngle = value;
    return this;
  }

  /**
   * Get or set subtree angle strategy
   */
  subtreeAngle(): SubtreeAngleStrategy;
  subtreeAngle(value: SubtreeAngleStrategy): this;
  subtreeAngle(value?: SubtreeAngleStrategy): SubtreeAngleStrategy | this {
    if (value === undefined) return this.options.subtreeAngle;
    this.options.subtreeAngle = value;
    return this;
  }

  /**
   * Get or set ring assignment algorithm
   */
  ringAssignment(): RingAssignmentAlgorithm;
  ringAssignment(value: RingAssignmentAlgorithm): this;
  ringAssignment(value?: RingAssignmentAlgorithm): RingAssignmentAlgorithm | this {
    if (value === undefined) return this.options.ringAssignment;
    this.options.ringAssignment = value;
    return this;
  }

  /**
   * Get or set edge routing style
   */
  edgeRouting(): EdgeRoutingStyle;
  edgeRouting(value: EdgeRoutingStyle): this;
  edgeRouting(value?: EdgeRoutingStyle): EdgeRoutingStyle | this {
    if (value === undefined) return this.options.edgeRouting;
    this.options.edgeRouting = value;
    return this;
  }
}

// ============================================================
// Preset Configurations
// ============================================================

/**
 * Preset names for common radial configurations
 */
export type RadialPresetName =
  | "default"
  | "tree"
  | "network"
  | "compact"
  | "wide"
  | "semicircle";

/**
 * Preset configurations for different use cases
 */
export const RADIAL_PRESETS: Record<
  RadialPresetName,
  Partial<RadialLayoutOptions>
> = {
  /** Default balanced configuration */
  default: {
    radiusStep: 100,
    startAngle: 0,
    endAngle: Math.PI * 2,
    sortBy: "connection",
    sortOrder: "desc",
    equalAngle: false,
    subtreeAngle: "proportional",
    ringAssignment: "bfs",
    edgeRouting: "arc",
    arcCurvature: 0.3,
    compact: true,
  },

  /** Tree layout - emphasizes parent-child hierarchy */
  tree: {
    radiusStep: 80,
    startAngle: 0,
    endAngle: Math.PI * 2,
    sortBy: "connection",
    sortOrder: "desc",
    equalAngle: false,
    subtreeAngle: "proportional",
    ringAssignment: "hierarchy",
    edgeRouting: "curved",
    arcCurvature: 0.2,
    compact: true,
  },

  /** Network layout - for dense interconnected graphs */
  network: {
    radiusStep: 120,
    startAngle: 0,
    endAngle: Math.PI * 2,
    sortBy: "connection",
    sortOrder: "desc",
    equalAngle: true,
    subtreeAngle: "equal",
    ringAssignment: "bfs",
    edgeRouting: "arc",
    arcCurvature: 0.4,
    compact: false,
  },

  /** Compact layout - minimizes space */
  compact: {
    radiusStep: 60,
    startAngle: 0,
    endAngle: Math.PI * 2,
    sortBy: "label",
    sortOrder: "asc",
    equalAngle: false,
    subtreeAngle: "proportional",
    ringAssignment: "bfs",
    edgeRouting: "straight",
    arcCurvature: 0.1,
    compact: true,
    margin: 30,
  },

  /** Wide layout - emphasizes radial spread */
  wide: {
    radiusStep: 150,
    startAngle: 0,
    endAngle: Math.PI * 2,
    sortBy: "connection",
    sortOrder: "desc",
    equalAngle: false,
    subtreeAngle: "proportional",
    ringAssignment: "bfs",
    edgeRouting: "arc",
    arcCurvature: 0.5,
    compact: false,
    margin: 80,
  },

  /** Semicircle layout - half-circle arrangement */
  semicircle: {
    radiusStep: 100,
    startAngle: -Math.PI / 2,
    endAngle: Math.PI / 2,
    sortBy: "connection",
    sortOrder: "desc",
    equalAngle: false,
    subtreeAngle: "proportional",
    ringAssignment: "bfs",
    edgeRouting: "arc",
    arcCurvature: 0.3,
    compact: true,
  },
};

/**
 * Create a radial layout with a preset configuration
 */
export function createRadialLayout(
  preset: RadialPresetName = "default",
  overrides?: Partial<RadialLayoutOptions>
): RadialLayout {
  return new RadialLayout({
    ...RADIAL_PRESETS[preset],
    ...overrides,
  });
}
