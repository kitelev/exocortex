/**
 * NeighborhoodExplorer - Multi-hop graph exploration
 *
 * Provides functionality for:
 * - BFS-based neighborhood exploration from a center node
 * - Multi-hop relationship discovery
 * - Integration with inference system for inferred relationships
 * - Configurable depth, direction, and filtering
 *
 * @module presentation/renderers/graph/inference
 * @since 1.0.0
 */

// import type { GraphNode, GraphEdge } from "../types";
import type {
  Triple,
  InferredFact,
  NeighborhoodExplorationOptions,
  NeighborhoodNode,
  NeighborhoodEdge,
  NeighborhoodResult,
  NeighborhoodStats,
  InferenceEvent,
  InferenceEventType,
  InferenceEventListener,
} from "./InferenceTypes";
import { DEFAULT_NEIGHBORHOOD_OPTIONS } from "./InferenceTypes";
import type { InferenceManager } from "./InferenceManager";

// ============================================================
// Types
// ============================================================

/**
 * Triple store adapter for neighborhood queries
 */
export interface NeighborhoodTripleStore {
  /** Get outgoing triples from a subject */
  getOutgoing(subject: string): Promise<Triple[]>;

  /** Get incoming triples to an object */
  getIncoming(object: string): Promise<Triple[]>;

  /** Get node metadata (label, types, etc.) */
  getNodeMetadata?(nodeId: string): Promise<Record<string, unknown> | null>;
}

/**
 * Configuration for NeighborhoodExplorer
 */
export interface NeighborhoodExplorerConfig {
  /** Default exploration options */
  defaultOptions: Partial<NeighborhoodExplorationOptions>;

  /** Whether to emit progress events @default true */
  emitProgress: boolean;

  /** Batch size for processing nodes @default 50 */
  batchSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: NeighborhoodExplorerConfig = {
  defaultOptions: {},
  emitProgress: true,
  batchSize: 50,
};

// ============================================================
// NeighborhoodExplorer Implementation
// ============================================================

/**
 * Multi-hop neighborhood exploration
 *
 * @example
 * ```typescript
 * const explorer = new NeighborhoodExplorer(tripleStore, inferenceManager);
 *
 * // Explore 2 hops from a node
 * const result = await explorer.explore("node:123", {
 *   maxHops: 2,
 *   direction: "both",
 *   includeInferred: true,
 * });
 *
 * // Get nodes at each hop distance
 * const hop1Nodes = result.nodes.filter((n) => n.hopDistance === 1);
 * const hop2Nodes = result.nodes.filter((n) => n.hopDistance === 2);
 * ```
 */
export class NeighborhoodExplorer {
  private readonly store: NeighborhoodTripleStore;
  private readonly inferenceManager?: InferenceManager;
  private readonly config: NeighborhoodExplorerConfig;
  private readonly listeners: Set<InferenceEventListener>;
  private abortController: AbortController | null = null;

  constructor(
    store: NeighborhoodTripleStore,
    inferenceManager?: InferenceManager,
    config: Partial<NeighborhoodExplorerConfig> = {}
  ) {
    this.store = store;
    this.inferenceManager = inferenceManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.listeners = new Set();
  }

  /**
   * Explore the neighborhood of a node
   */
  async explore(
    centerId: string,
    options: Partial<NeighborhoodExplorationOptions> = {}
  ): Promise<NeighborhoodResult> {
    const opts: NeighborhoodExplorationOptions = {
      ...DEFAULT_NEIGHBORHOOD_OPTIONS,
      ...this.config.defaultOptions,
      ...options,
    };

    const startTime = performance.now();
    this.abortController = new AbortController();

    this.emit({
      type: "neighborhood:explore-start",
      data: { centerId, options: opts },
    });

    try {
      const result = await this.exploreWithTimeout(centerId, opts, startTime);

      this.emit({
        type: "neighborhood:explore-complete",
        neighborhood: result,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit({
        type: "neighborhood:explore-error",
        error: errorMessage,
      });

      // Return empty result on error
      return this.createEmptyResult(centerId, opts, startTime, errorMessage);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Cancel ongoing exploration
   */
  cancel(): void {
    this.abortController?.abort();
  }

  /**
   * Main exploration logic with timeout handling
   */
  private async exploreWithTimeout(
    centerId: string,
    options: NeighborhoodExplorationOptions,
    startTime: number
  ): Promise<NeighborhoodResult> {
    const nodes = new Map<string, NeighborhoodNode>();
    const edges = new Map<string, NeighborhoodEdge>();
    const nodesPerHop: number[] = [];

    // Track visited nodes per direction to handle bidirectional exploration
    const visited = new Set<string>();

    // Initialize with center node
    const centerNode = await this.createNeighborhoodNode(centerId, 0, false);
    centerNode.isCenter = true;
    nodes.set(centerId, centerNode);
    visited.add(centerId);
    nodesPerHop[0] = 1;

    // BFS exploration
    let currentHop: string[] = [centerId];

    for (let hop = 1; hop <= options.maxHops; hop++) {
      // Check timeout
      if (this.isTimeout(startTime, options.timeout)) {
        break;
      }

      // Check abort
      if (this.abortController?.signal.aborted) {
        break;
      }

      const nextHop: string[] = [];
      let nodesAtThisHop = 0;

      // Process current hop nodes
      for (const nodeId of currentHop) {
        // Check limits
        if (nodes.size >= options.maxNodes) {
          break;
        }

        // Get neighbors
        const neighbors = await this.getNeighbors(
          nodeId,
          options,
          hop
        );

        for (const neighbor of neighbors) {
          // Check limits
          if (nodes.size >= options.maxNodes || edges.size >= options.maxEdges) {
            break;
          }

          // Skip if already visited
          if (visited.has(neighbor.targetId)) {
            // But still add the edge if it's new
            if (!edges.has(neighbor.edge.id)) {
              edges.set(neighbor.edge.id, neighbor.edge);
            }
            continue;
          }

          // Add node
          visited.add(neighbor.targetId);
          const newNode = await this.createNeighborhoodNode(
            neighbor.targetId,
            hop,
            neighbor.edge.isInferred
          );

          // Apply class filter if specified
          if (options.classFilter && options.classFilter.length > 0) {
            if (!this.matchesClassFilter(newNode, options.classFilter)) {
              continue;
            }
          }

          nodes.set(neighbor.targetId, newNode);
          edges.set(neighbor.edge.id, neighbor.edge);
          nodesAtThisHop++;

          // Queue for next hop if we should expand further
          if (hop < options.maxHops) {
            // Skip expanding inferred nodes unless configured to do so
            if (neighbor.edge.isInferred && !options.expandInferred) {
              continue;
            }
            nextHop.push(neighbor.targetId);
          }
        }
      }

      nodesPerHop[hop] = nodesAtThisHop;
      currentHop = nextHop;

      // Emit progress event
      this.emit({
        type: "neighborhood:hop-expand",
        data: {
          hop,
          nodesDiscovered: nodesAtThisHop,
          totalNodes: nodes.size,
          totalEdges: edges.size,
        },
      });

      // Stop if no more nodes to explore
      if (currentHop.length === 0) {
        break;
      }
    }

    // Build result
    const nodesArray = Array.from(nodes.values());
    const edgesArray = Array.from(edges.values());
    const inferredEdgeCount = edgesArray.filter((e) => e.isInferred).length;

    const stats: NeighborhoodStats = {
      totalNodes: nodesArray.length,
      totalEdges: edgesArray.length,
      nodesPerHop,
      inferredEdgeCount,
      assertedEdgeCount: edgesArray.length - inferredEdgeCount,
      explorationTimeMs: performance.now() - startTime,
      maxHopReached: Math.max(...nodesPerHop.map((_, i) => i).filter((i) => nodesPerHop[i] > 0), 0),
    };

    return {
      centerId,
      nodes: nodesArray,
      edges: edgesArray,
      stats,
      options,
      truncated: nodes.size >= options.maxNodes || edges.size >= options.maxEdges,
    };
  }

  /**
   * Get neighbors for a node based on exploration options
   */
  private async getNeighbors(
    nodeId: string,
    options: NeighborhoodExplorationOptions,
    hop: number
  ): Promise<Array<{ targetId: string; edge: NeighborhoodEdge }>> {
    const results: Array<{ targetId: string; edge: NeighborhoodEdge }> = [];
    let edgeCounter = 0;

    // Get outgoing edges
    if (options.direction === "outgoing" || options.direction === "both") {
      const outgoing = await this.store.getOutgoing(nodeId);

      for (const triple of outgoing) {
        // Apply predicate filter
        if (!this.matchesPredicateFilter(triple.predicate, options)) {
          continue;
        }

        results.push({
          targetId: triple.object,
          edge: this.createNeighborhoodEdge(
            `edge-${nodeId}-${triple.object}-${edgeCounter++}`,
            nodeId,
            triple.object,
            triple.predicate,
            false,
            hop
          ),
        });
      }
    }

    // Get incoming edges
    if (options.direction === "incoming" || options.direction === "both") {
      const incoming = await this.store.getIncoming(nodeId);

      for (const triple of incoming) {
        // Apply predicate filter
        if (!this.matchesPredicateFilter(triple.predicate, options)) {
          continue;
        }

        results.push({
          targetId: triple.subject,
          edge: this.createNeighborhoodEdge(
            `edge-${triple.subject}-${nodeId}-${edgeCounter++}`,
            triple.subject,
            nodeId,
            triple.predicate,
            false,
            hop
          ),
        });
      }
    }

    // Add inferred edges if enabled
    if (options.includeInferred && this.inferenceManager) {
      const inferredResults = await this.getInferredNeighbors(nodeId, options, hop);
      results.push(...inferredResults);
    }

    return results;
  }

  /**
   * Get inferred neighbors from the inference manager
   */
  private async getInferredNeighbors(
    nodeId: string,
    options: NeighborhoodExplorationOptions,
    hop: number
  ): Promise<Array<{ targetId: string; edge: NeighborhoodEdge }>> {
    if (!this.inferenceManager) {
      return [];
    }

    const results: Array<{ targetId: string; edge: NeighborhoodEdge }> = [];
    const inferredFacts = this.inferenceManager.getInferredForSubject(nodeId);
    let edgeCounter = 0;

    for (const fact of inferredFacts) {
      // Apply predicate filter
      if (!this.matchesPredicateFilter(fact.triple.predicate, options)) {
        continue;
      }

      // Outgoing inferred edges
      if (options.direction === "outgoing" || options.direction === "both") {
        if (fact.triple.subject === nodeId) {
          results.push({
            targetId: fact.triple.object,
            edge: this.createInferredNeighborhoodEdge(
              `inferred-${nodeId}-${fact.triple.object}-${edgeCounter++}`,
              nodeId,
              fact.triple.object,
              fact.triple.predicate,
              hop,
              fact
            ),
          });
        }
      }
    }

    // Also check for inferred edges where nodeId is the object (incoming)
    if (options.direction === "incoming" || options.direction === "both") {
      const allInferred = this.inferenceManager.getInferredFacts();
      for (const fact of allInferred) {
        if (fact.triple.object === nodeId) {
          if (!this.matchesPredicateFilter(fact.triple.predicate, options)) {
            continue;
          }

          results.push({
            targetId: fact.triple.subject,
            edge: this.createInferredNeighborhoodEdge(
              `inferred-${fact.triple.subject}-${nodeId}-${edgeCounter++}`,
              fact.triple.subject,
              nodeId,
              fact.triple.predicate,
              hop,
              fact
            ),
          });
        }
      }
    }

    return results;
  }

  /**
   * Check if a predicate matches the filter options
   */
  private matchesPredicateFilter(
    predicate: string,
    options: NeighborhoodExplorationOptions
  ): boolean {
    // Check exclusion list first
    if (options.excludePredicates && options.excludePredicates.length > 0) {
      if (options.excludePredicates.includes(predicate)) {
        return false;
      }
    }

    // Check inclusion list
    if (options.predicateFilter && options.predicateFilter.length > 0) {
      return options.predicateFilter.includes(predicate);
    }

    return true;
  }

  /**
   * Check if a node matches the class filter
   */
  private matchesClassFilter(
    node: NeighborhoodNode,
    classFilter: string[]
  ): boolean {
    if (!node.types || node.types.length === 0) {
      return false;
    }

    return node.types.some((type) => classFilter.includes(type));
  }

  /**
   * Create a neighborhood node
   */
  private async createNeighborhoodNode(
    id: string,
    hopDistance: number,
    reachedViaInference: boolean
  ): Promise<NeighborhoodNode> {
    // Try to get metadata from store
    let metadata: Record<string, unknown> = {};
    let label = this.extractLabel(id);
    let types: string[] | undefined;

    if (this.store.getNodeMetadata) {
      const nodeMetadata = await this.store.getNodeMetadata(id);
      if (nodeMetadata) {
        metadata = nodeMetadata;
        if (typeof nodeMetadata.label === "string") {
          label = nodeMetadata.label;
        }
        if (Array.isArray(nodeMetadata.types)) {
          types = nodeMetadata.types as string[];
        }
      }
    }

    return {
      id,
      label,
      path: id, // Use ID as path for now
      hopDistance,
      reachedViaInference,
      types,
      metadata,
    };
  }

  /**
   * Create a neighborhood edge
   */
  private createNeighborhoodEdge(
    id: string,
    source: string,
    target: string,
    property: string,
    isInferred: boolean,
    hopDistance: number
  ): NeighborhoodEdge {
    return {
      id,
      source,
      target,
      property,
      label: this.extractLabel(property),
      isInferred,
      hopDistance,
    };
  }

  /**
   * Create an inferred neighborhood edge
   */
  private createInferredNeighborhoodEdge(
    id: string,
    source: string,
    target: string,
    property: string,
    hopDistance: number,
    inference: InferredFact
  ): NeighborhoodEdge {
    return {
      id,
      source,
      target,
      property,
      label: `${this.extractLabel(property)} (inferred)`,
      isInferred: true,
      inference,
      hopDistance,
    };
  }

  /**
   * Extract a label from a URI
   */
  private extractLabel(uri: string): string {
    // Try to get fragment
    const fragmentIndex = uri.lastIndexOf("#");
    if (fragmentIndex !== -1) {
      return uri.substring(fragmentIndex + 1);
    }

    // Try to get last path segment
    const pathIndex = uri.lastIndexOf("/");
    if (pathIndex !== -1) {
      return uri.substring(pathIndex + 1);
    }

    return uri;
  }

  /**
   * Check if timeout has been exceeded
   */
  private isTimeout(startTime: number, timeout: number): boolean {
    return performance.now() - startTime > timeout;
  }

  /**
   * Create an empty result for error cases
   */
  private createEmptyResult(
    centerId: string,
    options: NeighborhoodExplorationOptions,
    startTime: number,
    _error?: string
  ): NeighborhoodResult {
    return {
      centerId,
      nodes: [],
      edges: [],
      stats: {
        totalNodes: 0,
        totalEdges: 0,
        nodesPerHop: [],
        inferredEdgeCount: 0,
        assertedEdgeCount: 0,
        explorationTimeMs: performance.now() - startTime,
        maxHopReached: 0,
      },
      options,
      truncated: false,
    };
  }

  // ============================================================
  // Event Handling
  // ============================================================

  /**
   * Add event listener
   */
  addEventListener(
    _type: InferenceEventType,
    listener: InferenceEventListener
  ): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: InferenceEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event
   */
  private emit(event: InferenceEvent): void {
    if (!this.config.emitProgress && event.type === "neighborhood:hop-expand") {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in neighborhood event listener:", error);
      }
    }
  }

  /**
   * Dispose of explorer resources
   */
  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }
}

/**
 * Create a NeighborhoodExplorer instance
 */
export function createNeighborhoodExplorer(
  store: NeighborhoodTripleStore,
  inferenceManager?: InferenceManager,
  config?: Partial<NeighborhoodExplorerConfig>
): NeighborhoodExplorer {
  return new NeighborhoodExplorer(store, inferenceManager, config);
}
