/**
 * HierarchicalBundler - Hierarchical Edge Bundling
 *
 * Implements hierarchical edge bundling based on Holten (2006).
 * This algorithm routes edges through a hierarchy (tree structure)
 * to create smooth, bundled curves between leaf nodes.
 *
 * Key features:
 * - Automatic hierarchy construction from graph structure
 * - Beta parameter for controlling bundle tightness
 * - Smooth B-spline interpolation through ancestor nodes
 * - Support for radial layout
 *
 * Reference:
 * Holten, D., 2006. Hierarchical Edge Bundles: Visualization of Adjacency
 * Relations in Hierarchical Data. IEEE Transactions on Visualization and
 * Computer Graphics, 12(5), pp.741-748.
 *
 * @module presentation/renderers/graph/bundling
 * @since 1.0.0
 */

import type { GraphEdge, GraphNode } from "../types";
import type {
  BundledEdge,
  BundlingConfig,
  BundlingResult,
  EdgeBundler,
  HierarchicalBundlingConfig,
  HierarchyNode,
  Vector2,
} from "./BundlingTypes";
import {
  DEFAULT_HIERARCHICAL_CONFIG,
  lerp,
} from "./BundlingTypes";

/**
 * HierarchicalBundler - Hierarchical Edge Bundling implementation
 *
 * Routes edges through a hierarchical tree structure, bundling edges
 * that share common ancestors.
 */
export class HierarchicalBundler implements EdgeBundler {
  private config: HierarchicalBundlingConfig;
  private hierarchy: Map<string, HierarchyNode> = new Map();
  private rootId: string | null = null;

  /**
   * Create a new HierarchicalBundler
   *
   * @param config - Optional partial configuration
   */
  constructor(config?: Partial<HierarchicalBundlingConfig>) {
    this.config = {
      ...DEFAULT_HIERARCHICAL_CONFIG,
      ...config,
    };
  }

  /**
   * Bundle edges using hierarchical edge bundling
   *
   * @param edges - Array of edges to bundle
   * @param nodes - Map of node IDs to node positions
   * @returns Array of bundled edges with control points
   */
  bundle(edges: GraphEdge[], nodes: Map<string, GraphNode>): BundledEdge[] {
    return this.bundleWithStats(edges, nodes).edges;
  }

  /**
   * Bundle edges with detailed statistics
   *
   * @param edges - Array of edges to bundle
   * @param nodes - Map of node IDs to node positions
   * @returns Bundling result with edges and statistics
   */
  bundleWithStats(
    edges: GraphEdge[],
    nodes: Map<string, GraphNode>
  ): BundlingResult {
    const startTime = performance.now();

    // Clear hierarchy
    this.hierarchy.clear();
    this.rootId = null;

    // Filter edges with valid nodes
    const validEdges = edges.filter((edge) => {
      const sourceId =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === "string" ? edge.target : edge.target.id;
      return nodes.has(sourceId) && nodes.has(targetId);
    });

    if (validEdges.length === 0) {
      return {
        edges: [],
        duration: performance.now() - startTime,
        bundledCount: 0,
        unbundledCount: 0,
        averageCompatibility: 0,
      };
    }

    // Build hierarchy from graph structure
    this.buildHierarchy(validEdges, nodes);

    // Create bundled edges
    const bundledEdges: BundledEdge[] = [];
    let bundledCount = 0;

    for (const edge of validEdges) {
      const bundledEdge = this.bundleEdge(edge, nodes);
      bundledEdges.push(bundledEdge);

      if (bundledEdge.controlPoints.length > 2) {
        bundledCount++;
      }
    }

    return {
      edges: bundledEdges,
      duration: performance.now() - startTime,
      bundledCount,
      unbundledCount: bundledEdges.length - bundledCount,
      averageCompatibility: bundledCount > 0 ? this.config.beta : 0,
    };
  }

  /**
   * Update bundling configuration
   *
   * @param config - Partial configuration to merge
   */
  setConfig(config: Partial<BundlingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      algorithm: "hierarchical",
    } as HierarchicalBundlingConfig;
  }

  /**
   * Get current bundling configuration
   */
  getConfig(): BundlingConfig {
    return { ...this.config };
  }

  /**
   * Get the name of the bundling algorithm
   */
  getName(): string {
    return "hierarchical";
  }

  /**
   * Build a hierarchy from the graph structure
   *
   * Uses a simple clustering approach: group nodes by their connections
   * to create virtual parent nodes.
   */
  private buildHierarchy(
    edges: GraphEdge[],
    nodes: Map<string, GraphNode>
  ): void {
    // Build adjacency lists
    const neighbors = new Map<string, Set<string>>();
    for (const node of nodes.keys()) {
      neighbors.set(node, new Set());
    }

    for (const edge of edges) {
      const sourceId =
        typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId =
        typeof edge.target === "string" ? edge.target : edge.target.id;

      neighbors.get(sourceId)?.add(targetId);
      neighbors.get(targetId)?.add(sourceId);
    }

    // Create leaf nodes for all graph nodes
    for (const [nodeId, node] of nodes) {
      this.hierarchy.set(nodeId, {
        id: nodeId,
        parentId: null,
        childIds: [],
        depth: 0,
        position: { x: node.x ?? 0, y: node.y ?? 0 },
        isLeaf: true,
      });
    }

    // Simple clustering: group nodes by their connection patterns
    // This creates a 2-level hierarchy
    const clusters = this.clusterNodes(neighbors, nodes);

    // Create cluster nodes and connect to leaves
    let clusterId = 0;
    for (const cluster of clusters) {
      if (cluster.nodeIds.length === 0) continue;

      const clusterNodeId = `__cluster_${clusterId++}`;

      // Calculate cluster center position
      const centerPos = this.calculateCentroid(cluster.nodeIds, nodes);

      // Create cluster node
      const clusterNode: HierarchyNode = {
        id: clusterNodeId,
        parentId: null, // Will be set to root
        childIds: [...cluster.nodeIds],
        depth: 1,
        position: centerPos,
        isLeaf: false,
      };

      this.hierarchy.set(clusterNodeId, clusterNode);

      // Update leaf nodes to point to cluster
      for (const nodeId of cluster.nodeIds) {
        const leafNode = this.hierarchy.get(nodeId);
        if (leafNode) {
          leafNode.parentId = clusterNodeId;
          leafNode.depth = 2;
        }
      }
    }

    // Create root node
    this.rootId = "__root";
    const clusterIds = Array.from(this.hierarchy.values())
      .filter((n) => !n.isLeaf && n.id !== this.rootId)
      .map((n) => n.id);

    // Calculate root position (center of all nodes)
    const allNodeIds = Array.from(nodes.keys());
    const rootPos = this.calculateCentroid(allNodeIds, nodes);

    const rootNode: HierarchyNode = {
      id: this.rootId,
      parentId: null,
      childIds: clusterIds,
      depth: 0,
      position: rootPos,
      isLeaf: false,
    };

    this.hierarchy.set(this.rootId, rootNode);

    // Update cluster nodes to point to root
    for (const clusterId of clusterIds) {
      const clusterNode = this.hierarchy.get(clusterId);
      if (clusterNode) {
        clusterNode.parentId = this.rootId;
      }
    }
  }

  /**
   * Cluster nodes based on their connections
   */
  private clusterNodes(
    neighbors: Map<string, Set<string>>,
    nodes: Map<string, GraphNode>
  ): Array<{ nodeIds: string[] }> {
    const clusters: Array<{ nodeIds: string[] }> = [];
    const assigned = new Set<string>();
    const nodeIds = Array.from(nodes.keys());

    // Use simple greedy clustering
    for (const nodeId of nodeIds) {
      if (assigned.has(nodeId)) continue;

      const cluster: string[] = [nodeId];
      assigned.add(nodeId);

      // Add neighbors that share many connections
      const nodeNeighbors = neighbors.get(nodeId) || new Set();

      for (const neighborId of nodeNeighbors) {
        if (assigned.has(neighborId)) continue;

        // Check if neighbor is well-connected to existing cluster members
        const neighborNeighbors = neighbors.get(neighborId) || new Set();
        const sharedConnections = [...nodeNeighbors].filter((n) =>
          neighborNeighbors.has(n)
        ).length;

        // Add to cluster if they share connections
        if (sharedConnections >= 1 || cluster.length < 5) {
          cluster.push(neighborId);
          assigned.add(neighborId);
        }

        // Limit cluster size
        if (cluster.length >= 10) break;
      }

      clusters.push({ nodeIds: cluster });
    }

    return clusters;
  }

  /**
   * Calculate centroid of a set of nodes
   */
  private calculateCentroid(
    nodeIds: string[],
    nodes: Map<string, GraphNode>
  ): Vector2 {
    if (nodeIds.length === 0) {
      return { x: 0, y: 0 };
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (const nodeId of nodeIds) {
      const node = nodes.get(nodeId);
      if (node) {
        sumX += node.x ?? 0;
        sumY += node.y ?? 0;
        count++;
      }
    }

    return count > 0 ? { x: sumX / count, y: sumY / count } : { x: 0, y: 0 };
  }

  /**
   * Bundle a single edge through the hierarchy
   */
  private bundleEdge(
    edge: GraphEdge,
    nodes: Map<string, GraphNode>
  ): BundledEdge {
    const sourceId =
      typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId =
      typeof edge.target === "string" ? edge.target : edge.target.id;

    const sourceNode = nodes.get(sourceId);
    const targetNode = nodes.get(targetId);

    if (!sourceNode || !targetNode) {
      return {
        id: edge.id,
        sourceId,
        targetId,
        controlPoints: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        originalEdge: edge,
      };
    }

    // Get hierarchy nodes
    const sourceHierarchy = this.hierarchy.get(sourceId);
    const targetHierarchy = this.hierarchy.get(targetId);

    if (!sourceHierarchy || !targetHierarchy) {
      // No hierarchy, return straight edge
      return {
        id: edge.id,
        sourceId,
        targetId,
        controlPoints: [
          { x: sourceNode.x ?? 0, y: sourceNode.y ?? 0 },
          { x: targetNode.x ?? 0, y: targetNode.y ?? 0 },
        ],
        originalEdge: edge,
      };
    }

    // Find path through hierarchy (source -> LCA -> target)
    const sourcePath = this.getPathToRoot(sourceId);
    const targetPath = this.getPathToRoot(targetId);

    // Find lowest common ancestor
    const sourceSet = new Set(sourcePath);
    let lcaIndex = 0;
    for (let i = 0; i < targetPath.length; i++) {
      if (sourceSet.has(targetPath[i])) {
        lcaIndex = i;
        break;
      }
    }

    // Build control points path
    const pathNodeIds = [
      ...sourcePath.slice(0, sourcePath.indexOf(targetPath[lcaIndex]) + 1),
      ...targetPath.slice(0, lcaIndex).reverse(),
    ];

    // Get positions for path nodes
    const pathPositions: Vector2[] = pathNodeIds.map((nodeId) => {
      const hierNode = this.hierarchy.get(nodeId);
      return hierNode ? hierNode.position : { x: 0, y: 0 };
    });

    // Apply beta parameter for bundling strength
    const { beta } = this.config;
    const controlPoints = this.applyBeta(pathPositions, beta);

    // Smooth the path with additional control points
    const smoothedPoints = this.smoothPath(controlPoints);

    return {
      id: edge.id,
      sourceId,
      targetId,
      controlPoints: smoothedPoints,
      originalEdge: edge,
      compatibilityScore: beta,
    };
  }

  /**
   * Get path from a node to the root
   */
  private getPathToRoot(nodeId: string): string[] {
    const path: string[] = [];
    let currentId: string | null = nodeId;

    while (currentId !== null) {
      path.push(currentId);
      const node = this.hierarchy.get(currentId);
      currentId = node?.parentId ?? null;
    }

    return path;
  }

  /**
   * Apply beta parameter to control bundling tightness
   *
   * Beta = 0: straight line between source and target
   * Beta = 1: follow hierarchy path exactly
   */
  private applyBeta(positions: Vector2[], beta: number): Vector2[] {
    if (positions.length < 2) return positions;

    const source = positions[0];
    const target = positions[positions.length - 1];

    return positions.map((pos, i) => {
      const t = i / (positions.length - 1);
      const straightPos = lerp(source, target, t);
      return lerp(straightPos, pos, beta);
    });
  }

  /**
   * Smooth the path by adding interpolated points
   */
  private smoothPath(points: Vector2[]): Vector2[] {
    if (points.length <= 2) return points;

    const { tension } = this.config;
    const result: Vector2[] = [];

    // Use Catmull-Rom spline interpolation
    for (let i = 0; i < points.length; i++) {
      result.push(points[i]);

      if (i < points.length - 1) {
        // Add intermediate points using Catmull-Rom
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        // Add 3 intermediate points
        for (let j = 1; j <= 3; j++) {
          const t = j / 4;
          const interpolated = this.catmullRom(p0, p1, p2, p3, t, tension);
          result.push(interpolated);
        }
      }
    }

    return result;
  }

  /**
   * Catmull-Rom spline interpolation
   */
  private catmullRom(
    p0: Vector2,
    p1: Vector2,
    p2: Vector2,
    p3: Vector2,
    t: number,
    tension: number
  ): Vector2 {
    const t2 = t * t;
    const t3 = t2 * t;

    // Tension parameter (0.5 is standard Catmull-Rom)
    const s = (1 - tension) / 2;

    const x =
      (2 * p1.x) +
      s * (p2.x - p0.x) * t +
      (2 * s * p0.x - 5 * p1.x + 4 * p2.x - s * p3.x + s * p0.x) * t2 +
      (3 * p1.x - s * p0.x - 3 * p2.x + s * p3.x - s * p0.x + s * p2.x) * t3;

    const y =
      (2 * p1.y) +
      s * (p2.y - p0.y) * t +
      (2 * s * p0.y - 5 * p1.y + 4 * p2.y - s * p3.y + s * p0.y) * t2 +
      (3 * p1.y - s * p0.y - 3 * p2.y + s * p3.y - s * p0.y + s * p2.y) * t3;

    return { x: x / 2, y: y / 2 };
  }
}

/**
 * Factory function to create a HierarchicalBundler
 *
 * @param config - Optional partial configuration
 * @returns New HierarchicalBundler instance
 */
export function createHierarchicalBundler(
  config?: Partial<HierarchicalBundlingConfig>
): HierarchicalBundler {
  return new HierarchicalBundler(config);
}
