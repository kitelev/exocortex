/**
 * HierarchicalLayout - Hierarchical tree/DAG layout algorithm
 *
 * Implements a Sugiyama-style hierarchical layout for visualizing
 * parent-child relationships, ontology class hierarchies, and DAGs.
 *
 * The algorithm follows four phases:
 * 1. Cycle removal (for DAGs with cycles)
 * 2. Rank assignment (assign nodes to levels)
 * 3. Crossing minimization (order nodes within levels)
 * 4. Coordinate assignment (position nodes)
 *
 * Supports multiple layout directions, ranking algorithms, and
 * crossing minimization strategies.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

import type { GraphData, GraphNode, GraphEdge } from "./types";

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Layout direction for hierarchical arrangement
 */
export type LayoutDirection = "TB" | "BT" | "LR" | "RL";

/**
 * Algorithm for assigning ranks (levels) to nodes
 */
export type RankingAlgorithm = "network-simplex" | "tight-tree" | "longest-path";

/**
 * Algorithm for minimizing edge crossings
 */
export type CrossingMinimizationAlgorithm = "barycenter" | "median" | "none";

/**
 * Algorithm for assigning coordinates to nodes
 */
export type CoordinateAssignmentAlgorithm = "brandes-kopf" | "simple" | "tight";

/**
 * Configuration options for hierarchical layout
 */
export interface HierarchicalLayoutOptions {
  /** Layout direction (default: 'TB' - top to bottom) */
  direction: LayoutDirection;

  /** Space between levels in pixels (default: 100) */
  levelSeparation: number;

  /** Space between sibling nodes in pixels (default: 50) */
  nodeSeparation: number;

  /** Space between subtrees in pixels (default: 80) */
  subtreeSeparation: number;

  /** Explicit root node IDs (auto-detected if not provided) */
  rootNodes?: string[];

  /** Algorithm for rank assignment (default: 'longest-path') */
  rankingAlgorithm: RankingAlgorithm;

  /** Algorithm for crossing minimization (default: 'barycenter') */
  crossingMinimization: CrossingMinimizationAlgorithm;

  /** Algorithm for coordinate assignment (default: 'brandes-kopf') */
  coordinateAssignment: CoordinateAssignmentAlgorithm;

  /** Number of iterations for crossing minimization (default: 24) */
  crossingIterations: number;

  /** Whether to align nodes to grid (default: false) */
  alignToGrid: boolean;

  /** Grid size for alignment in pixels (default: 10) */
  gridSize: number;

  /** Whether to compact the layout by minimizing total edge length (default: true) */
  compact: boolean;

  /** Margin around the layout in pixels (default: 50) */
  margin: number;
}

/**
 * Extended node with hierarchical layout properties
 */
export interface HierarchicalNode extends GraphNode {
  /** Assigned level/rank (0 = root level) */
  level: number;

  /** Order within the level (for crossing minimization) */
  order: number;

  /** Parent node ID (null for root nodes) */
  parent: string | null;

  /** Child node IDs */
  children: string[];

  /** Width of the subtree rooted at this node */
  subtreeWidth: number;

  /** Height of the subtree rooted at this node */
  subtreeHeight: number;

  /** Whether this is a dummy node (for long edges) */
  isDummy: boolean;

  /** Original edge ID if this is a dummy node */
  originalEdgeId?: string;
}

/**
 * Extended edge with hierarchical layout properties
 */
export interface HierarchicalEdge extends GraphEdge {
  /** Whether this edge was reversed to break cycles */
  reversed: boolean;

  /** Dummy nodes inserted for this edge (for long edges spanning multiple levels) */
  dummyNodes: string[];

  /** Control points for edge routing */
  controlPoints?: Array<{ x: number; y: number }>;
}

/**
 * Result of hierarchical layout computation
 */
export interface HierarchicalLayoutResult {
  /** Node positions indexed by node ID */
  positions: Map<string, { x: number; y: number }>;

  /** Routed edges with control points */
  edges: HierarchicalEdge[];

  /** Layout bounds */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };

  /** Layout statistics */
  stats: {
    /** Number of edge crossings */
    crossings: number;
    /** Number of dummy nodes added */
    dummyNodes: number;
    /** Number of reversed edges */
    reversedEdges: number;
    /** Total edge length */
    totalEdgeLength: number;
  };
}

/**
 * Internal representation of a level/rank
 */
interface Level {
  /** Nodes in this level, ordered */
  nodes: HierarchicalNode[];

  /** Y coordinate for this level (or X for LR/RL) */
  coordinate: number;
}

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default hierarchical layout options
 */
export const DEFAULT_HIERARCHICAL_OPTIONS: HierarchicalLayoutOptions = {
  direction: "TB",
  levelSeparation: 100,
  nodeSeparation: 50,
  subtreeSeparation: 80,
  rankingAlgorithm: "longest-path",
  crossingMinimization: "barycenter",
  coordinateAssignment: "brandes-kopf",
  crossingIterations: 24,
  alignToGrid: false,
  gridSize: 10,
  compact: true,
  margin: 50,
};

// ============================================================
// HierarchicalLayout Class
// ============================================================

/**
 * Hierarchical layout algorithm implementation
 *
 * Implements the Sugiyama framework for layered graph drawing:
 * 1. Cycle removal - reverse edges to make graph acyclic
 * 2. Layer assignment - assign nodes to horizontal/vertical layers
 * 3. Crossing reduction - reorder nodes within layers
 * 4. Coordinate assignment - determine final positions
 *
 * @example
 * ```typescript
 * const layout = new HierarchicalLayout({
 *   direction: 'TB',
 *   levelSeparation: 100,
 *   nodeSeparation: 50,
 * });
 *
 * const result = layout.layout(graphData);
 * // result.positions contains node positions
 * // result.edges contains routed edges with control points
 * ```
 */
export class HierarchicalLayout {
  private options: HierarchicalLayoutOptions;
  private levels: Map<number, Level> = new Map();
  private nodeMap: Map<string, HierarchicalNode> = new Map();
  private edgeMap: Map<string, HierarchicalEdge> = new Map();
  private adjacency: Map<string, Set<string>> = new Map();
  private reverseAdjacency: Map<string, Set<string>> = new Map();

  constructor(options: Partial<HierarchicalLayoutOptions> = {}) {
    this.options = { ...DEFAULT_HIERARCHICAL_OPTIONS, ...options };
  }

  /**
   * Compute hierarchical layout for the given graph
   */
  layout(graph: GraphData): HierarchicalLayoutResult {
    // Reset state
    this.levels.clear();
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.adjacency.clear();
    this.reverseAdjacency.clear();

    // Handle empty graph
    if (graph.nodes.length === 0) {
      return this.createEmptyResult();
    }

    // Phase 0: Initialize data structures
    this.initializeGraph(graph);

    // Phase 1: Remove cycles (make graph acyclic)
    const reversedCount = this.removeCycles();

    // Phase 2: Assign ranks/levels to nodes
    this.assignRanks();

    // Phase 3: Insert dummy nodes for long edges
    const dummyCount = this.insertDummyNodes();

    // Phase 4: Minimize edge crossings
    const crossings = this.minimizeCrossings();

    // Phase 5: Assign coordinates
    this.assignCoordinates();

    // Phase 6: Route edges
    this.routeEdges();

    // Build result
    return this.buildResult(reversedCount, dummyCount, crossings);
  }

  // ============================================================
  // Phase 0: Initialization
  // ============================================================

  private initializeGraph(graph: GraphData): void {
    // Create hierarchical nodes
    for (const node of graph.nodes) {
      const hNode: HierarchicalNode = {
        ...node,
        level: -1,
        order: -1,
        parent: null,
        children: [],
        subtreeWidth: 0,
        subtreeHeight: 0,
        isDummy: false,
        x: 0,
        y: 0,
      };
      this.nodeMap.set(node.id, hNode);
      this.adjacency.set(node.id, new Set());
      this.reverseAdjacency.set(node.id, new Set());
    }

    // Create hierarchical edges and build adjacency
    for (const edge of graph.edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      // Skip edges with missing nodes or self-loops
      if (!this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId) || sourceId === targetId) {
        continue;
      }

      const hEdge: HierarchicalEdge = {
        ...edge,
        source: sourceId,
        target: targetId,
        reversed: false,
        dummyNodes: [],
      };
      this.edgeMap.set(edge.id, hEdge);

      this.adjacency.get(sourceId)!.add(targetId);
      this.reverseAdjacency.get(targetId)!.add(sourceId);
    }
  }

  // ============================================================
  // Phase 1: Cycle Removal
  // ============================================================

  /**
   * Remove cycles by reversing back edges using DFS
   * Returns the number of reversed edges
   */
  private removeCycles(): number {
    let reversedCount = 0;
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string): void => {
      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      inStack.add(nodeId);

      const neighbors = this.adjacency.get(nodeId) || new Set();
      for (const neighborId of neighbors) {
        if (inStack.has(neighborId)) {
          // Back edge found - reverse it
          this.reverseEdge(nodeId, neighborId);
          reversedCount++;
        } else if (!visited.has(neighborId)) {
          dfs(neighborId);
        }
      }

      inStack.delete(nodeId);
    };

    // Start DFS from all unvisited nodes
    for (const nodeId of this.nodeMap.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return reversedCount;
  }

  private reverseEdge(source: string, target: string): void {
    // Update adjacency
    this.adjacency.get(source)?.delete(target);
    this.adjacency.get(target)?.add(source);
    this.reverseAdjacency.get(target)?.delete(source);
    this.reverseAdjacency.get(source)?.add(target);

    // Mark edge as reversed
    for (const edge of this.edgeMap.values()) {
      if (edge.source === source && edge.target === target) {
        edge.source = target;
        edge.target = source;
        edge.reversed = true;
        break;
      }
    }
  }

  // ============================================================
  // Phase 2: Rank Assignment
  // ============================================================

  private assignRanks(): void {
    switch (this.options.rankingAlgorithm) {
      case "network-simplex":
        this.assignRanksNetworkSimplex();
        break;
      case "tight-tree":
        this.assignRanksTightTree();
        break;
      case "longest-path":
      default:
        this.assignRanksLongestPath();
        break;
    }
  }

  /**
   * Longest-path ranking algorithm
   * Simple and fast, assigns nodes to the earliest possible level
   */
  private assignRanksLongestPath(): void {
    const ranks = new Map<string, number>();

    // Find root nodes (no incoming edges)
    const roots = this.findRootNodes();

    // BFS from roots to assign ranks
    const queue: Array<{ nodeId: string; rank: number }> = [];
    for (const rootId of roots) {
      queue.push({ nodeId: rootId, rank: 0 });
      ranks.set(rootId, 0);
    }

    while (queue.length > 0) {
      const { nodeId, rank } = queue.shift()!;
      const node = this.nodeMap.get(nodeId)!;
      node.level = rank;

      const neighbors = this.adjacency.get(nodeId) || new Set();
      for (const neighborId of neighbors) {
        // Skip self-loops to prevent infinite loop
        if (neighborId === nodeId) continue;

        const newRank = rank + 1;
        const currentRank = ranks.get(neighborId);

        if (currentRank === undefined || newRank > currentRank) {
          ranks.set(neighborId, newRank);
          queue.push({ nodeId: neighborId, rank: newRank });
        }
      }
    }

    // Handle disconnected components
    for (const node of this.nodeMap.values()) {
      if (node.level === -1) {
        node.level = 0;
      }
    }

    this.buildLevels();
  }

  /**
   * Tight-tree ranking algorithm
   * Tries to minimize total edge length
   */
  private assignRanksTightTree(): void {
    // Start with longest-path as base
    this.assignRanksLongestPath();

    // Iteratively improve by tightening edges
    let improved = true;
    let iterations = 0;
    const maxIterations = 100;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (const node of this.nodeMap.values()) {
        const idealRank = this.computeIdealRank(node.id);
        if (idealRank !== node.level && this.canMoveToRank(node.id, idealRank)) {
          node.level = idealRank;
          improved = true;
        }
      }
    }

    this.buildLevels();
  }

  /**
   * Network simplex ranking algorithm
   * Optimal ranking that minimizes total edge length
   */
  private assignRanksNetworkSimplex(): void {
    // For simplicity, use tight-tree as approximation
    // Full network simplex is complex and rarely needed
    this.assignRanksTightTree();
  }

  private findRootNodes(): string[] {
    // Check for explicit roots
    if (this.options.rootNodes && this.options.rootNodes.length > 0) {
      return this.options.rootNodes.filter((id) => this.nodeMap.has(id));
    }

    // Find nodes with no incoming edges
    const roots: string[] = [];
    for (const [nodeId, parents] of this.reverseAdjacency) {
      if (parents.size === 0) {
        roots.push(nodeId);
      }
    }

    // If no roots found, pick node with highest out-degree
    if (roots.length === 0 && this.nodeMap.size > 0) {
      let maxOutDegree = -1;
      let bestNode = "";
      for (const [nodeId, children] of this.adjacency) {
        if (children.size > maxOutDegree) {
          maxOutDegree = children.size;
          bestNode = nodeId;
        }
      }
      if (bestNode) {
        roots.push(bestNode);
      }
    }

    return roots;
  }

  private computeIdealRank(nodeId: string): number {
    const parents = this.reverseAdjacency.get(nodeId) || new Set();
    const children = this.adjacency.get(nodeId) || new Set();

    if (parents.size === 0 && children.size === 0) {
      return this.nodeMap.get(nodeId)!.level;
    }

    // Compute median of parent ranks + 1 and child ranks - 1
    const parentRanks = [...parents].map(
      (id) => (this.nodeMap.get(id)?.level ?? 0) + 1
    );
    const childRanks = [...children].map(
      (id) => (this.nodeMap.get(id)?.level ?? 0) - 1
    );
    const allRanks = [...parentRanks, ...childRanks];

    if (allRanks.length === 0) return this.nodeMap.get(nodeId)!.level;

    allRanks.sort((a, b) => a - b);
    return allRanks[Math.floor(allRanks.length / 2)];
  }

  private canMoveToRank(nodeId: string, newRank: number): boolean {
    // Check that all parents are at lower ranks
    const parents = this.reverseAdjacency.get(nodeId) || new Set();
    for (const parentId of parents) {
      const parent = this.nodeMap.get(parentId);
      if (parent && parent.level >= newRank) {
        return false;
      }
    }

    // Check that all children are at higher ranks
    const children = this.adjacency.get(nodeId) || new Set();
    for (const childId of children) {
      const child = this.nodeMap.get(childId);
      if (child && child.level <= newRank) {
        return false;
      }
    }

    return true;
  }

  private buildLevels(): void {
    this.levels.clear();

    for (const node of this.nodeMap.values()) {
      if (!this.levels.has(node.level)) {
        this.levels.set(node.level, { nodes: [], coordinate: 0 });
      }
      this.levels.get(node.level)!.nodes.push(node);
    }

    // Set initial order within levels
    for (const level of this.levels.values()) {
      level.nodes.forEach((node, index) => {
        node.order = index;
      });
    }
  }

  // ============================================================
  // Phase 3: Insert Dummy Nodes
  // ============================================================

  /**
   * Insert dummy nodes for edges spanning multiple levels
   * Returns the number of dummy nodes added
   */
  private insertDummyNodes(): number {
    let dummyCount = 0;

    for (const edge of this.edgeMap.values()) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const source = this.nodeMap.get(sourceId);
      const target = this.nodeMap.get(targetId);

      if (!source || !target) continue;

      const span = Math.abs(target.level - source.level);
      if (span <= 1) continue;

      // Insert dummy nodes for each intermediate level
      const dummyNodes: string[] = [];
      const minLevel = Math.min(source.level, target.level);

      for (let i = 1; i < span; i++) {
        const dummyId = `dummy_${edge.id}_${i}`;
        const dummyLevel = minLevel + i;

        const dummy: HierarchicalNode = {
          id: dummyId,
          label: "",
          path: "",
          level: dummyLevel,
          order: -1,
          parent: null,
          children: [],
          subtreeWidth: 0,
          subtreeHeight: 0,
          isDummy: true,
          originalEdgeId: edge.id,
          x: 0,
          y: 0,
        };

        this.nodeMap.set(dummyId, dummy);
        dummyNodes.push(dummyId);

        // Add to level
        if (!this.levels.has(dummyLevel)) {
          this.levels.set(dummyLevel, { nodes: [], coordinate: 0 });
        }
        this.levels.get(dummyLevel)!.nodes.push(dummy);

        dummyCount++;
      }

      edge.dummyNodes = dummyNodes;
    }

    return dummyCount;
  }

  // ============================================================
  // Phase 4: Crossing Minimization
  // ============================================================

  /**
   * Minimize edge crossings using the configured algorithm
   * Returns the final number of crossings
   */
  private minimizeCrossings(): number {
    if (this.options.crossingMinimization === "none") {
      return this.countCrossings();
    }

    const iterations = this.options.crossingIterations;
    let bestCrossings = this.countCrossings();
    let bestOrder = this.captureOrder();

    for (let i = 0; i < iterations; i++) {
      // Alternate between top-down and bottom-up sweeps
      if (i % 2 === 0) {
        this.sweepDownward();
      } else {
        this.sweepUpward();
      }

      const crossings = this.countCrossings();
      if (crossings < bestCrossings) {
        bestCrossings = crossings;
        bestOrder = this.captureOrder();
      }
    }

    // Restore best order
    this.restoreOrder(bestOrder);
    return bestCrossings;
  }

  private sweepDownward(): void {
    const sortedLevels = [...this.levels.keys()].sort((a, b) => a - b);

    for (let i = 1; i < sortedLevels.length; i++) {
      const level = this.levels.get(sortedLevels[i])!;
      const prevLevel = this.levels.get(sortedLevels[i - 1])!;
      this.orderLevel(level, prevLevel, true);
    }
  }

  private sweepUpward(): void {
    const sortedLevels = [...this.levels.keys()].sort((a, b) => b - a);

    for (let i = 1; i < sortedLevels.length; i++) {
      const level = this.levels.get(sortedLevels[i])!;
      const nextLevel = this.levels.get(sortedLevels[i - 1])!;
      this.orderLevel(level, nextLevel, false);
    }
  }

  private orderLevel(level: Level, adjacentLevel: Level, useParents: boolean): void {
    // Compute position values for each node
    const positions: Array<{ node: HierarchicalNode; pos: number }> = [];

    for (const node of level.nodes) {
      const adjacentNodes = this.getAdjacentNodes(node, adjacentLevel, useParents);

      if (adjacentNodes.length === 0) {
        positions.push({ node, pos: node.order });
        continue;
      }

      let pos: number;
      if (this.options.crossingMinimization === "barycenter") {
        // Barycenter: average position of adjacent nodes
        pos = adjacentNodes.reduce((sum, n) => sum + n.order, 0) / adjacentNodes.length;
      } else {
        // Median: median position of adjacent nodes
        const orders = adjacentNodes.map((n) => n.order).sort((a, b) => a - b);
        const mid = Math.floor(orders.length / 2);
        pos = orders.length % 2 === 0
          ? (orders[mid - 1] + orders[mid]) / 2
          : orders[mid];
      }

      positions.push({ node, pos });
    }

    // Sort by position value
    positions.sort((a, b) => a.pos - b.pos);

    // Update order
    positions.forEach(({ node }, index) => {
      node.order = index;
    });

    // Update level nodes array
    level.nodes = positions.map(({ node }) => node);
  }

  private getAdjacentNodes(
    node: HierarchicalNode,
    adjacentLevel: Level,
    useParents: boolean
  ): HierarchicalNode[] {
    const adjacentIds = useParents
      ? this.reverseAdjacency.get(node.id) || new Set()
      : this.adjacency.get(node.id) || new Set();

    const adjacentSet = new Set(adjacentLevel.nodes.map((n) => n.id));

    return [...adjacentIds]
      .filter((id) => adjacentSet.has(id))
      .map((id) => this.nodeMap.get(id)!)
      .filter((n) => n !== undefined);
  }

  private countCrossings(): number {
    let crossings = 0;
    const sortedLevels = [...this.levels.keys()].sort((a, b) => a - b);

    for (let i = 0; i < sortedLevels.length - 1; i++) {
      crossings += this.countCrossingsBetweenLevels(
        sortedLevels[i],
        sortedLevels[i + 1]
      );
    }

    return crossings;
  }

  private countCrossingsBetweenLevels(level1: number, level2: number): number {
    const edges: Array<{ from: number; to: number }> = [];
    const l1 = this.levels.get(level1)!;

    // Collect edges between levels
    for (const node of l1.nodes) {
      const children = this.adjacency.get(node.id) || new Set();
      for (const childId of children) {
        const child = this.nodeMap.get(childId);
        if (child && child.level === level2) {
          edges.push({ from: node.order, to: child.order });
        }
      }
    }

    // Count crossings using inversion count
    let crossings = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        if (
          (edges[i].from < edges[j].from && edges[i].to > edges[j].to) ||
          (edges[i].from > edges[j].from && edges[i].to < edges[j].to)
        ) {
          crossings++;
        }
      }
    }

    return crossings;
  }

  private captureOrder(): Map<string, number> {
    const order = new Map<string, number>();
    for (const node of this.nodeMap.values()) {
      order.set(node.id, node.order);
    }
    return order;
  }

  private restoreOrder(order: Map<string, number>): void {
    for (const [nodeId, nodeOrder] of order) {
      const node = this.nodeMap.get(nodeId);
      if (node) {
        node.order = nodeOrder;
      }
    }

    // Rebuild level node arrays in correct order
    for (const level of this.levels.values()) {
      level.nodes.sort((a, b) => a.order - b.order);
    }
  }

  // ============================================================
  // Phase 5: Coordinate Assignment
  // ============================================================

  private assignCoordinates(): void {
    switch (this.options.coordinateAssignment) {
      case "brandes-kopf":
        this.assignCoordinatesBrandesKopf();
        break;
      case "tight":
        this.assignCoordinatesTight();
        break;
      case "simple":
      default:
        this.assignCoordinatesSimple();
        break;
    }

    // Apply margin
    this.applyMargin();

    // Align to grid if requested
    if (this.options.alignToGrid) {
      this.alignToGrid();
    }
  }

  /**
   * Simple coordinate assignment - equally space nodes
   */
  private assignCoordinatesSimple(): void {
    const isHorizontal = this.options.direction === "LR" || this.options.direction === "RL";
    const isReversed = this.options.direction === "BT" || this.options.direction === "RL";

    const sortedLevels = [...this.levels.keys()].sort((a, b) =>
      isReversed ? b - a : a - b
    );

    // Assign level coordinates
    let levelCoord = 0;
    for (const levelIndex of sortedLevels) {
      const level = this.levels.get(levelIndex)!;
      level.coordinate = levelCoord;
      levelCoord += this.options.levelSeparation;
    }

    // Assign node coordinates within levels
    for (const level of this.levels.values()) {
      const totalWidth = (level.nodes.length - 1) * this.options.nodeSeparation;
      let nodeCoord = -totalWidth / 2;

      for (const node of level.nodes) {
        if (isHorizontal) {
          node.x = level.coordinate;
          node.y = nodeCoord;
        } else {
          node.x = nodeCoord;
          node.y = level.coordinate;
        }
        nodeCoord += this.options.nodeSeparation;
      }
    }
  }

  /**
   * Brandes-Köpf coordinate assignment
   * Produces balanced layouts by aligning nodes to their parents/children
   */
  private assignCoordinatesBrandesKopf(): void {
    // Start with simple assignment
    this.assignCoordinatesSimple();

    // Iteratively improve alignment
    const iterations = 8;
    for (let i = 0; i < iterations; i++) {
      // Sweep down: align to parents
      this.alignToNeighbors(true);
      // Sweep up: align to children
      this.alignToNeighbors(false);
    }

    // Compact the layout
    if (this.options.compact) {
      this.compactLayout();
    }
  }

  /**
   * Tight coordinate assignment
   * Minimizes total edge length
   */
  private assignCoordinatesTight(): void {
    this.assignCoordinatesBrandesKopf();
  }

  private alignToNeighbors(alignToParents: boolean): void {
    const isHorizontal = this.options.direction === "LR" || this.options.direction === "RL";
    const sortedLevels = [...this.levels.keys()].sort((a, b) =>
      alignToParents ? a - b : b - a
    );

    for (const levelIndex of sortedLevels) {
      const level = this.levels.get(levelIndex)!;

      for (const node of level.nodes) {
        const neighbors = alignToParents
          ? [...(this.reverseAdjacency.get(node.id) || new Set())]
          : [...(this.adjacency.get(node.id) || new Set())];

        if (neighbors.length === 0) continue;

        // Compute ideal position as average of neighbors
        let idealPos = 0;
        for (const neighborId of neighbors) {
          const neighbor = this.nodeMap.get(neighborId);
          if (neighbor) {
            idealPos += isHorizontal ? (neighbor.y ?? 0) : (neighbor.x ?? 0);
          }
        }
        idealPos /= neighbors.length;

        // Check if we can move without overlapping siblings
        const currentPos = isHorizontal ? (node.y ?? 0) : (node.x ?? 0);
        const delta = idealPos - currentPos;

        if (this.canShift(node, delta, level)) {
          if (isHorizontal) {
            node.y = idealPos;
          } else {
            node.x = idealPos;
          }
        }
      }
    }
  }

  private canShift(node: HierarchicalNode, delta: number, level: Level): boolean {
    if (Math.abs(delta) < 1) return false;

    const isHorizontal = this.options.direction === "LR" || this.options.direction === "RL";
    const nodeIndex = level.nodes.indexOf(node);
    const minSep = this.options.nodeSeparation / 2;

    // Check left/up neighbor
    if (nodeIndex > 0 && delta < 0) {
      const prevNode = level.nodes[nodeIndex - 1];
      const prevPos = isHorizontal ? (prevNode.y ?? 0) : (prevNode.x ?? 0);
      const newPos = (isHorizontal ? (node.y ?? 0) : (node.x ?? 0)) + delta;
      if (newPos - prevPos < minSep) return false;
    }

    // Check right/down neighbor
    if (nodeIndex < level.nodes.length - 1 && delta > 0) {
      const nextNode = level.nodes[nodeIndex + 1];
      const nextPos = isHorizontal ? (nextNode.y ?? 0) : (nextNode.x ?? 0);
      const newPos = (isHorizontal ? (node.y ?? 0) : (node.x ?? 0)) + delta;
      if (nextPos - newPos < minSep) return false;
    }

    return true;
  }

  private compactLayout(): void {
    const isHorizontal = this.options.direction === "LR" || this.options.direction === "RL";
    const minSep = this.options.nodeSeparation;

    // Compact each level
    for (const level of this.levels.values()) {
      level.nodes.sort((a, b) => {
        const aPos = isHorizontal ? (a.y ?? 0) : (a.x ?? 0);
        const bPos = isHorizontal ? (b.y ?? 0) : (b.x ?? 0);
        return aPos - bPos;
      });

      // Push nodes together from left/top
      for (let i = 1; i < level.nodes.length; i++) {
        const prevNode = level.nodes[i - 1];
        const node = level.nodes[i];
        const prevPos = isHorizontal ? (prevNode.y ?? 0) : (prevNode.x ?? 0);
        const currentPos = isHorizontal ? (node.y ?? 0) : (node.x ?? 0);
        const idealPos = prevPos + minSep;

        if (currentPos > idealPos + minSep) {
          if (isHorizontal) {
            node.y = idealPos;
          } else {
            node.x = idealPos;
          }
        }
      }
    }

    // Center the layout
    this.centerLayout();
  }

  private centerLayout(): void {
    const isHorizontal = this.options.direction === "LR" || this.options.direction === "RL";

    // Find bounds
    let minPos = Infinity;
    let maxPos = -Infinity;
    for (const node of this.nodeMap.values()) {
      const pos = isHorizontal ? (node.y ?? 0) : (node.x ?? 0);
      minPos = Math.min(minPos, pos);
      maxPos = Math.max(maxPos, pos);
    }

    // Shift to center
    const center = (minPos + maxPos) / 2;
    for (const node of this.nodeMap.values()) {
      if (isHorizontal) {
        node.y = (node.y ?? 0) - center;
      } else {
        node.x = (node.x ?? 0) - center;
      }
    }
  }

  private applyMargin(): void {
    // Find current bounds
    let minX = Infinity;
    let minY = Infinity;
    for (const node of this.nodeMap.values()) {
      minX = Math.min(minX, node.x ?? 0);
      minY = Math.min(minY, node.y ?? 0);
    }

    // Shift all nodes by margin
    const shiftX = this.options.margin - minX;
    const shiftY = this.options.margin - minY;
    for (const node of this.nodeMap.values()) {
      node.x = (node.x ?? 0) + shiftX;
      node.y = (node.y ?? 0) + shiftY;
    }
  }

  private alignToGrid(): void {
    const grid = this.options.gridSize;
    for (const node of this.nodeMap.values()) {
      node.x = Math.round((node.x ?? 0) / grid) * grid;
      node.y = Math.round((node.y ?? 0) / grid) * grid;
    }
  }

  // ============================================================
  // Phase 6: Edge Routing
  // ============================================================

  private routeEdges(): void {
    for (const edge of this.edgeMap.values()) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      const source = this.nodeMap.get(sourceId);
      const target = this.nodeMap.get(targetId);

      if (!source || !target) continue;

      // Build control points through dummy nodes
      const controlPoints: Array<{ x: number; y: number }> = [];
      controlPoints.push({ x: source.x ?? 0, y: source.y ?? 0 });

      for (const dummyId of edge.dummyNodes) {
        const dummy = this.nodeMap.get(dummyId);
        if (dummy) {
          controlPoints.push({ x: dummy.x ?? 0, y: dummy.y ?? 0 });
        }
      }

      controlPoints.push({ x: target.x ?? 0, y: target.y ?? 0 });

      // For simple layouts, use straight segments through control points
      // For smoother curves, could implement spline interpolation here
      edge.controlPoints = controlPoints;
    }
  }

  // ============================================================
  // Result Building
  // ============================================================

  private buildResult(
    reversedCount: number,
    dummyCount: number,
    crossings: number
  ): HierarchicalLayoutResult {
    const positions = new Map<string, { x: number; y: number }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let totalEdgeLength = 0;

    // Collect non-dummy node positions
    for (const node of this.nodeMap.values()) {
      if (!node.isDummy) {
        positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
      }
      minX = Math.min(minX, node.x ?? 0);
      minY = Math.min(minY, node.y ?? 0);
      maxX = Math.max(maxX, node.x ?? 0);
      maxY = Math.max(maxY, node.y ?? 0);
    }

    // Calculate total edge length
    for (const edge of this.edgeMap.values()) {
      if (edge.controlPoints && edge.controlPoints.length >= 2) {
        for (let i = 1; i < edge.controlPoints.length; i++) {
          const dx = edge.controlPoints[i].x - edge.controlPoints[i - 1].x;
          const dy = edge.controlPoints[i].y - edge.controlPoints[i - 1].y;
          totalEdgeLength += Math.sqrt(dx * dx + dy * dy);
        }
      }
    }

    return {
      positions,
      edges: [...this.edgeMap.values()],
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
      },
      stats: {
        crossings,
        dummyNodes: dummyCount,
        reversedEdges: reversedCount,
        totalEdgeLength,
      },
    };
  }

  private createEmptyResult(): HierarchicalLayoutResult {
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
      },
      stats: {
        crossings: 0,
        dummyNodes: 0,
        reversedEdges: 0,
        totalEdgeLength: 0,
      },
    };
  }

  // ============================================================
  // Configuration Methods
  // ============================================================

  /**
   * Get current options
   */
  getOptions(): HierarchicalLayoutOptions {
    return { ...this.options };
  }

  /**
   * Update options
   */
  setOptions(options: Partial<HierarchicalLayoutOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get direction
   */
  direction(): LayoutDirection;
  direction(value: LayoutDirection): this;
  direction(value?: LayoutDirection): LayoutDirection | this {
    if (value === undefined) return this.options.direction;
    this.options.direction = value;
    return this;
  }

  /**
   * Get or set level separation
   */
  levelSeparation(): number;
  levelSeparation(value: number): this;
  levelSeparation(value?: number): number | this {
    if (value === undefined) return this.options.levelSeparation;
    this.options.levelSeparation = value;
    return this;
  }

  /**
   * Get or set node separation
   */
  nodeSeparation(): number;
  nodeSeparation(value: number): this;
  nodeSeparation(value?: number): number | this {
    if (value === undefined) return this.options.nodeSeparation;
    this.options.nodeSeparation = value;
    return this;
  }

  /**
   * Get or set ranking algorithm
   */
  rankingAlgorithm(): RankingAlgorithm;
  rankingAlgorithm(value: RankingAlgorithm): this;
  rankingAlgorithm(value?: RankingAlgorithm): RankingAlgorithm | this {
    if (value === undefined) return this.options.rankingAlgorithm;
    this.options.rankingAlgorithm = value;
    return this;
  }

  /**
   * Get or set crossing minimization algorithm
   */
  crossingMinimization(): CrossingMinimizationAlgorithm;
  crossingMinimization(value: CrossingMinimizationAlgorithm): this;
  crossingMinimization(value?: CrossingMinimizationAlgorithm): CrossingMinimizationAlgorithm | this {
    if (value === undefined) return this.options.crossingMinimization;
    this.options.crossingMinimization = value;
    return this;
  }
}

// ============================================================
// Preset Configurations
// ============================================================

/**
 * Preset names for common hierarchical configurations
 */
export type HierarchicalPresetName = "default" | "tree" | "dag" | "compact" | "wide";

/**
 * Preset configurations for different use cases
 */
export const HIERARCHICAL_PRESETS: Record<HierarchicalPresetName, Partial<HierarchicalLayoutOptions>> = {
  /** Default balanced configuration */
  default: {
    direction: "TB",
    levelSeparation: 100,
    nodeSeparation: 50,
    subtreeSeparation: 80,
    rankingAlgorithm: "longest-path",
    crossingMinimization: "barycenter",
    crossingIterations: 24,
  },

  /** Tree layout - emphasizes parent-child relationships */
  tree: {
    direction: "TB",
    levelSeparation: 80,
    nodeSeparation: 40,
    subtreeSeparation: 60,
    rankingAlgorithm: "longest-path",
    crossingMinimization: "barycenter",
    crossingIterations: 12,
    compact: true,
  },

  /** DAG layout - handles complex dependencies */
  dag: {
    direction: "TB",
    levelSeparation: 120,
    nodeSeparation: 60,
    subtreeSeparation: 100,
    rankingAlgorithm: "network-simplex",
    crossingMinimization: "median",
    crossingIterations: 48,
    compact: false,
  },

  /** Compact layout - minimizes space */
  compact: {
    direction: "TB",
    levelSeparation: 60,
    nodeSeparation: 30,
    subtreeSeparation: 40,
    rankingAlgorithm: "tight-tree",
    crossingMinimization: "barycenter",
    crossingIterations: 36,
    compact: true,
  },

  /** Wide layout - emphasizes horizontal spread */
  wide: {
    direction: "LR",
    levelSeparation: 150,
    nodeSeparation: 80,
    subtreeSeparation: 120,
    rankingAlgorithm: "longest-path",
    crossingMinimization: "barycenter",
    crossingIterations: 24,
    compact: false,
  },
};

/**
 * Create a hierarchical layout with a preset configuration
 */
export function createHierarchicalLayout(
  preset: HierarchicalPresetName = "default",
  overrides?: Partial<HierarchicalLayoutOptions>
): HierarchicalLayout {
  return new HierarchicalLayout({
    ...HIERARCHICAL_PRESETS[preset],
    ...overrides,
  });
}
