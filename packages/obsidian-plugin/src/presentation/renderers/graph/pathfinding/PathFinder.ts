/**
 * PathFinder - Graph path finding algorithms
 *
 * Provides path finding functionality between nodes in the graph using:
 * - BFS (Breadth-First Search) for unweighted shortest paths
 * - Dijkstra's algorithm for weighted shortest paths
 * - Bidirectional search for faster path finding in large graphs
 *
 * @module presentation/renderers/graph/pathfinding
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "../types";
import type {
  PathFindingOptions,
  PathFindingResult,
  Path,
  PathStep,
  PathNode,
  PathGraph,
  AdjacencyEntry,
} from "./PathFindingTypes";
import { DEFAULT_PATH_FINDING_OPTIONS } from "./PathFindingTypes";

/**
 * PathFinder - Finds paths between nodes in a graph
 */
export class PathFinder {
  private graph: PathGraph;
  private options: PathFindingOptions;

  constructor(options: Partial<PathFindingOptions> = {}) {
    this.options = {
      ...DEFAULT_PATH_FINDING_OPTIONS,
      ...options,
    };
    this.graph = {
      nodes: new Map(),
      adjacency: new Map(),
      reverseAdjacency: new Map(),
    };
  }

  /**
   * Set the graph data for path finding
   *
   * @param nodes - Array of graph nodes
   * @param edges - Array of graph edges
   */
  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.graph.nodes.clear();
    this.graph.adjacency.clear();
    this.graph.reverseAdjacency.clear();

    // Index nodes by ID
    for (const node of nodes) {
      this.graph.nodes.set(node.id, node);
      this.graph.adjacency.set(node.id, []);
      this.graph.reverseAdjacency.set(node.id, []);
    }

    // Build adjacency lists
    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      // Skip edges with unknown nodes
      if (!this.graph.nodes.has(sourceId) || !this.graph.nodes.has(targetId)) {
        continue;
      }

      const weight = this.calculateEdgeWeight(edge);

      // Forward edge
      const forwardEntry: AdjacencyEntry = {
        targetId,
        edge,
        weight,
        isReverse: false,
      };
      this.graph.adjacency.get(sourceId)?.push(forwardEntry);

      // Reverse entry for reverse adjacency
      const reverseEntry: AdjacencyEntry = {
        targetId: sourceId,
        edge,
        weight,
        isReverse: true,
      };
      this.graph.reverseAdjacency.get(targetId)?.push(reverseEntry);
    }
  }

  /**
   * Calculate edge weight based on strategy
   */
  private calculateEdgeWeight(edge: GraphEdge): number {
    if (this.options.customWeightFn) {
      return this.options.customWeightFn(edge);
    }

    switch (this.options.weightStrategy) {
      case "uniform":
        return 1;

      case "property":
        return edge.weight ?? 1;

      case "predicate": {
        const predicate = edge.property ?? "";

        // Check preferred predicates (lower weight)
        if (this.options.preferredPredicates?.includes(predicate)) {
          return 0.5;
        }

        // Check avoided predicates (higher weight)
        if (this.options.avoidedPredicates?.includes(predicate)) {
          return 10;
        }

        return 1;
      }

      default:
        return 1;
    }
  }

  /**
   * Get neighbors based on direction settings
   */
  private getNeighbors(nodeId: string): AdjacencyEntry[] {
    const neighbors: AdjacencyEntry[] = [];

    if (this.options.direction === "outgoing" || this.options.direction === "both") {
      const outgoing = this.graph.adjacency.get(nodeId) ?? [];
      neighbors.push(...outgoing);
    }

    if (this.options.direction === "incoming" || this.options.direction === "both") {
      const incoming = this.graph.reverseAdjacency.get(nodeId) ?? [];
      neighbors.push(...incoming);
    }

    return neighbors;
  }

  /**
   * Find path(s) between source and target nodes
   *
   * @param sourceId - Source node ID
   * @param targetId - Target node ID
   * @param options - Optional override options
   * @returns Path finding result
   */
  findPath(
    sourceId: string,
    targetId: string,
    options?: Partial<PathFindingOptions>
  ): PathFindingResult {
    const opts = { ...this.options, ...options };
    const startTime = performance.now();

    // Validate nodes exist
    const sourceNode = this.graph.nodes.get(sourceId);
    const targetNode = this.graph.nodes.get(targetId);

    if (!sourceNode) {
      return this.createErrorResult(sourceId, targetId, opts, "Source node not found");
    }

    if (!targetNode) {
      return this.createErrorResult(sourceId, targetId, opts, "Target node not found");
    }

    // Same node - return trivial path
    if (sourceId === targetId) {
      const path = this.createPath([sourceNode], [], sourceNode, targetNode);
      return {
        found: true,
        paths: [path],
        sourceId,
        targetId,
        algorithm: opts.algorithm,
        nodesVisited: 1,
        searchTimeMs: performance.now() - startTime,
        timedOut: false,
      };
    }

    // Execute appropriate algorithm
    try {
      let result: PathFindingResult;

      switch (opts.algorithm) {
        case "bfs":
          result = this.bfs(sourceId, targetId, opts, startTime);
          break;

        case "dijkstra":
          result = this.dijkstra(sourceId, targetId, opts, startTime);
          break;

        case "bidirectional":
          result = this.bidirectionalBfs(sourceId, targetId, opts, startTime);
          break;

        default:
          result = this.bfs(sourceId, targetId, opts, startTime);
      }

      return result;
    } catch (error) {
      return this.createErrorResult(
        sourceId,
        targetId,
        opts,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }

  /**
   * Breadth-First Search for unweighted shortest path
   */
  private bfs(
    sourceId: string,
    targetId: string,
    opts: PathFindingOptions,
    startTime: number
  ): PathFindingResult {
    const visited = new Set<string>();
    const queue: PathNode[] = [];
    let nodesVisited = 0;

    // Initialize source node
    const sourceNode = this.graph.nodes.get(sourceId)!;
    queue.push({
      id: sourceId,
      node: sourceNode,
      distance: 0,
      previous: null,
      previousEdge: null,
      isReverse: false,
      visited: false,
    });
    visited.add(sourceId);

    while (queue.length > 0) {
      // Check timeout
      if (performance.now() - startTime > opts.timeoutMs) {
        return this.createTimeoutResult(sourceId, targetId, opts, nodesVisited, startTime);
      }

      const current = queue.shift()!;
      nodesVisited++;

      // Check max length
      if (current.distance >= opts.maxLength) {
        continue;
      }

      // Explore neighbors
      const neighbors = this.getNeighbors(current.id);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.targetId)) {
          continue;
        }

        visited.add(neighbor.targetId);

        const neighborNode = this.graph.nodes.get(neighbor.targetId)!;
        const pathNode: PathNode = {
          id: neighbor.targetId,
          node: neighborNode,
          distance: current.distance + 1,
          previous: current,
          previousEdge: neighbor.edge,
          isReverse: neighbor.isReverse,
          visited: false,
        };

        // Found target!
        if (neighbor.targetId === targetId) {
          const path = this.reconstructPath(pathNode);
          return {
            found: true,
            paths: [path],
            sourceId,
            targetId,
            algorithm: "bfs",
            nodesVisited,
            searchTimeMs: performance.now() - startTime,
            timedOut: false,
          };
        }

        queue.push(pathNode);
      }
    }

    // No path found
    return this.createNotFoundResult(sourceId, targetId, opts, nodesVisited, startTime);
  }

  /**
   * Dijkstra's algorithm for weighted shortest path
   */
  private dijkstra(
    sourceId: string,
    targetId: string,
    opts: PathFindingOptions,
    startTime: number
  ): PathFindingResult {
    const distances = new Map<string, number>();
    const pathNodes = new Map<string, PathNode>();
    const visited = new Set<string>();
    let nodesVisited = 0;

    // Initialize all distances to infinity
    for (const nodeId of this.graph.nodes.keys()) {
      distances.set(nodeId, Infinity);
    }

    // Initialize source
    distances.set(sourceId, 0);
    const sourceNode = this.graph.nodes.get(sourceId)!;
    pathNodes.set(sourceId, {
      id: sourceId,
      node: sourceNode,
      distance: 0,
      previous: null,
      previousEdge: null,
      isReverse: false,
      visited: false,
    });

    // Priority queue (simple array for now - could be optimized with heap)
    const pq: { id: string; distance: number }[] = [{ id: sourceId, distance: 0 }];

    while (pq.length > 0) {
      // Check timeout
      if (performance.now() - startTime > opts.timeoutMs) {
        return this.createTimeoutResult(sourceId, targetId, opts, nodesVisited, startTime);
      }

      // Get node with minimum distance
      pq.sort((a, b) => a.distance - b.distance);
      const current = pq.shift()!;

      if (visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);
      nodesVisited++;

      // Found target!
      if (current.id === targetId) {
        const targetPathNode = pathNodes.get(targetId)!;
        const path = this.reconstructPath(targetPathNode);
        return {
          found: true,
          paths: [path],
          sourceId,
          targetId,
          algorithm: "dijkstra",
          nodesVisited,
          searchTimeMs: performance.now() - startTime,
          timedOut: false,
        };
      }

      // Check max length
      const currentPathNode = pathNodes.get(current.id)!;
      if (this.getPathLength(currentPathNode) >= opts.maxLength) {
        continue;
      }

      // Explore neighbors
      const neighbors = this.getNeighbors(current.id);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.targetId)) {
          continue;
        }

        const newDistance = current.distance + neighbor.weight;
        const currentDistance = distances.get(neighbor.targetId) ?? Infinity;

        if (newDistance < currentDistance) {
          distances.set(neighbor.targetId, newDistance);

          const neighborNode = this.graph.nodes.get(neighbor.targetId)!;
          pathNodes.set(neighbor.targetId, {
            id: neighbor.targetId,
            node: neighborNode,
            distance: newDistance,
            previous: currentPathNode,
            previousEdge: neighbor.edge,
            isReverse: neighbor.isReverse,
            visited: false,
          });

          pq.push({ id: neighbor.targetId, distance: newDistance });
        }
      }
    }

    // No path found
    return this.createNotFoundResult(sourceId, targetId, opts, nodesVisited, startTime);
  }

  /**
   * Bidirectional BFS for faster path finding in large graphs
   */
  private bidirectionalBfs(
    sourceId: string,
    targetId: string,
    opts: PathFindingOptions,
    startTime: number
  ): PathFindingResult {
    // Forward search from source
    const forwardVisited = new Map<string, PathNode>();
    const forwardQueue: PathNode[] = [];

    // Backward search from target
    const backwardVisited = new Map<string, PathNode>();
    const backwardQueue: PathNode[] = [];

    let nodesVisited = 0;

    // Initialize source
    const sourceNode = this.graph.nodes.get(sourceId)!;
    const sourcePathNode: PathNode = {
      id: sourceId,
      node: sourceNode,
      distance: 0,
      previous: null,
      previousEdge: null,
      isReverse: false,
      visited: false,
    };
    forwardQueue.push(sourcePathNode);
    forwardVisited.set(sourceId, sourcePathNode);

    // Initialize target
    const targetNode = this.graph.nodes.get(targetId)!;
    const targetPathNode: PathNode = {
      id: targetId,
      node: targetNode,
      distance: 0,
      previous: null,
      previousEdge: null,
      isReverse: false,
      visited: false,
    };
    backwardQueue.push(targetPathNode);
    backwardVisited.set(targetId, targetPathNode);

    // Alternate between forward and backward search
    while (forwardQueue.length > 0 || backwardQueue.length > 0) {
      // Check timeout
      if (performance.now() - startTime > opts.timeoutMs) {
        return this.createTimeoutResult(sourceId, targetId, opts, nodesVisited, startTime);
      }

      // Forward step
      if (forwardQueue.length > 0) {
        const current = forwardQueue.shift()!;
        nodesVisited++;

        if (current.distance < opts.maxLength) {
          const neighbors = this.getNeighbors(current.id);

          for (const neighbor of neighbors) {
            if (forwardVisited.has(neighbor.targetId)) {
              continue;
            }

            const neighborNode = this.graph.nodes.get(neighbor.targetId)!;
            const pathNode: PathNode = {
              id: neighbor.targetId,
              node: neighborNode,
              distance: current.distance + 1,
              previous: current,
              previousEdge: neighbor.edge,
              isReverse: neighbor.isReverse,
              visited: false,
            };

            forwardVisited.set(neighbor.targetId, pathNode);

            // Check if backward search already visited this node
            if (backwardVisited.has(neighbor.targetId)) {
              const backwardNode = backwardVisited.get(neighbor.targetId)!;
              const path = this.reconstructBidirectionalPath(pathNode, backwardNode);
              return {
                found: true,
                paths: [path],
                sourceId,
                targetId,
                algorithm: "bidirectional",
                nodesVisited,
                searchTimeMs: performance.now() - startTime,
                timedOut: false,
              };
            }

            forwardQueue.push(pathNode);
          }
        }
      }

      // Backward step
      if (backwardQueue.length > 0) {
        const current = backwardQueue.shift()!;
        nodesVisited++;

        if (current.distance < opts.maxLength) {
          // For backward search, we use reverse neighbors
          const neighbors = this.getBackwardNeighbors(current.id);

          for (const neighbor of neighbors) {
            if (backwardVisited.has(neighbor.targetId)) {
              continue;
            }

            const neighborNode = this.graph.nodes.get(neighbor.targetId)!;
            const pathNode: PathNode = {
              id: neighbor.targetId,
              node: neighborNode,
              distance: current.distance + 1,
              previous: current,
              previousEdge: neighbor.edge,
              isReverse: !neighbor.isReverse, // Flip direction for backward
              visited: false,
            };

            backwardVisited.set(neighbor.targetId, pathNode);

            // Check if forward search already visited this node
            if (forwardVisited.has(neighbor.targetId)) {
              const forwardNode = forwardVisited.get(neighbor.targetId)!;
              const path = this.reconstructBidirectionalPath(forwardNode, pathNode);
              return {
                found: true,
                paths: [path],
                sourceId,
                targetId,
                algorithm: "bidirectional",
                nodesVisited,
                searchTimeMs: performance.now() - startTime,
                timedOut: false,
              };
            }

            backwardQueue.push(pathNode);
          }
        }
      }
    }

    // No path found
    return this.createNotFoundResult(sourceId, targetId, opts, nodesVisited, startTime);
  }

  /**
   * Get backward neighbors for bidirectional search
   */
  private getBackwardNeighbors(nodeId: string): AdjacencyEntry[] {
    const neighbors: AdjacencyEntry[] = [];

    // Incoming edges become outgoing for backward search
    if (this.options.direction === "outgoing" || this.options.direction === "both") {
      const incoming = this.graph.reverseAdjacency.get(nodeId) ?? [];
      neighbors.push(...incoming);
    }

    // Outgoing edges become incoming for backward search
    if (this.options.direction === "incoming" || this.options.direction === "both") {
      const outgoing = this.graph.adjacency.get(nodeId) ?? [];
      neighbors.push(...outgoing);
    }

    return neighbors;
  }

  /**
   * Reconstruct path from PathNode chain
   */
  private reconstructPath(endNode: PathNode): Path {
    const steps: PathStep[] = [];
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];

    let current: PathNode | null = endNode;

    while (current !== null) {
      const step: PathStep = {
        node: current.node,
        edge: current.previousEdge,
        isReverse: current.isReverse,
        cumulativeWeight: current.distance,
      };
      steps.unshift(step);
      nodeIds.unshift(current.id);

      if (current.previousEdge) {
        edgeIds.unshift(current.previousEdge.id);
      }

      current = current.previous;
    }

    const sourceNode = steps[0].node;
    const targetNode = steps[steps.length - 1].node;

    return this.createPath(
      steps.map(s => s.node),
      steps.slice(1).map((s) => ({
        edge: s.edge!,
        isReverse: s.isReverse,
      })),
      sourceNode,
      targetNode
    );
  }

  /**
   * Reconstruct path from bidirectional search meeting point
   */
  private reconstructBidirectionalPath(
    forwardNode: PathNode,
    backwardNode: PathNode
  ): Path {
    // Reconstruct forward path
    const forwardSteps: { node: GraphNode; edge: GraphEdge | null; isReverse: boolean }[] = [];
    let current: PathNode | null = forwardNode;

    while (current !== null) {
      forwardSteps.unshift({
        node: current.node,
        edge: current.previousEdge,
        isReverse: current.isReverse,
      });
      current = current.previous;
    }

    // Reconstruct backward path (skip the meeting node as it's in forward)
    const backwardSteps: { node: GraphNode; edge: GraphEdge | null; isReverse: boolean }[] = [];
    current = backwardNode.previous;

    while (current !== null) {
      backwardSteps.push({
        node: current.node,
        edge: backwardNode.previousEdge,
        isReverse: !backwardNode.isReverse, // Flip direction
      });
      backwardNode = current;
      current = current.previous;
    }

    // Combine paths
    const allNodes = [
      ...forwardSteps.map(s => s.node),
      ...backwardSteps.map(s => s.node),
    ];

    const allEdges = [
      ...forwardSteps.slice(1).map(s => ({ edge: s.edge!, isReverse: s.isReverse })),
      ...backwardSteps.map(s => ({ edge: s.edge!, isReverse: s.isReverse })),
    ].filter(e => e.edge);

    const sourceNode = allNodes[0];
    const targetNode = allNodes[allNodes.length - 1];

    return this.createPath(allNodes, allEdges, sourceNode, targetNode);
  }

  /**
   * Create a Path object from nodes and edges
   */
  private createPath(
    nodes: GraphNode[],
    edges: { edge: GraphEdge; isReverse: boolean }[],
    source: GraphNode,
    target: GraphNode
  ): Path {
    const steps: PathStep[] = nodes.map((node, i) => ({
      node,
      edge: i > 0 ? edges[i - 1]?.edge ?? null : null,
      isReverse: i > 0 ? edges[i - 1]?.isReverse ?? false : false,
      cumulativeWeight: i,
    }));

    const nodeIds = nodes.map(n => n.id);
    const edgeIds = edges.map(e => e.edge.id);

    return {
      id: `path-${source.id}-${target.id}-${Date.now()}`,
      source,
      target,
      steps,
      totalWeight: edges.length,
      length: edges.length,
      nodeIds,
      edgeIds,
    };
  }

  /**
   * Get path length from PathNode
   */
  private getPathLength(node: PathNode): number {
    let length = 0;
    let current: PathNode | null = node;
    while (current?.previous !== null) {
      length++;
      current = current.previous;
    }
    return length;
  }

  /**
   * Create error result
   */
  private createErrorResult(
    sourceId: string,
    targetId: string,
    opts: PathFindingOptions,
    error: string
  ): PathFindingResult {
    return {
      found: false,
      paths: [],
      sourceId,
      targetId,
      algorithm: opts.algorithm,
      nodesVisited: 0,
      searchTimeMs: 0,
      timedOut: false,
      error,
    };
  }

  /**
   * Create timeout result
   */
  private createTimeoutResult(
    sourceId: string,
    targetId: string,
    opts: PathFindingOptions,
    nodesVisited: number,
    startTime: number
  ): PathFindingResult {
    return {
      found: false,
      paths: [],
      sourceId,
      targetId,
      algorithm: opts.algorithm,
      nodesVisited,
      searchTimeMs: performance.now() - startTime,
      timedOut: true,
      error: "Search timed out",
    };
  }

  /**
   * Create not found result
   */
  private createNotFoundResult(
    sourceId: string,
    targetId: string,
    opts: PathFindingOptions,
    nodesVisited: number,
    startTime: number
  ): PathFindingResult {
    return {
      found: false,
      paths: [],
      sourceId,
      targetId,
      algorithm: opts.algorithm,
      nodesVisited,
      searchTimeMs: performance.now() - startTime,
      timedOut: false,
    };
  }

  /**
   * Update options
   */
  setOptions(options: Partial<PathFindingOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  /**
   * Get current options
   */
  getOptions(): PathFindingOptions {
    return { ...this.options };
  }
}

/**
 * Create a PathFinder instance
 */
export function createPathFinder(
  options?: Partial<PathFindingOptions>
): PathFinder {
  return new PathFinder(options);
}
