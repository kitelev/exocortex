/**
 * StubBundler - Passthrough Edge Bundler
 *
 * A minimal edge bundler implementation that returns unbundled edges
 * with only source and target points. Useful for:
 * - Disabling bundling while maintaining the bundler interface
 * - Testing and benchmarking
 * - Simple graphs where bundling is not needed
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
  Vector2,
} from "./BundlingTypes";
import { DEFAULT_BUNDLING_CONFIG } from "./BundlingTypes";

/**
 * StubBundler - Returns edges without bundling
 *
 * This bundler simply passes through edges with control points at only
 * the source and target positions, resulting in straight edges.
 */
export class StubBundler implements EdgeBundler {
  private config: BundlingConfig;

  /**
   * Create a new StubBundler
   *
   * @param config - Optional partial configuration (mostly ignored for stub)
   */
  constructor(config?: Partial<BundlingConfig>) {
    this.config = {
      ...DEFAULT_BUNDLING_CONFIG,
      algorithm: "stub",
      ...config,
    };
  }

  /**
   * Bundle edges (passthrough - no actual bundling)
   *
   * @param edges - Array of edges to "bundle"
   * @param nodes - Map of node IDs to node positions
   * @returns Array of bundled edges with only source/target control points
   */
  bundle(edges: GraphEdge[], nodes: Map<string, GraphNode>): BundledEdge[] {
    return edges.map((edge) => this.createBundledEdge(edge, nodes));
  }

  /**
   * Bundle edges with statistics
   *
   * @param edges - Array of edges to "bundle"
   * @param nodes - Map of node IDs to node positions
   * @returns Bundling result with edges and statistics
   */
  bundleWithStats(
    edges: GraphEdge[],
    nodes: Map<string, GraphNode>
  ): BundlingResult {
    const startTime = performance.now();

    const bundledEdges = this.bundle(edges, nodes);

    return {
      edges: bundledEdges,
      duration: performance.now() - startTime,
      bundledCount: 0, // No edges are actually bundled
      unbundledCount: bundledEdges.length,
      averageCompatibility: 0,
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
      algorithm: "stub", // Always keep algorithm as stub
    };
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
    return "stub";
  }

  /**
   * Create a bundled edge with only source and target control points
   *
   * @param edge - Original edge
   * @param nodes - Map of node IDs to positions
   * @returns Bundled edge with two control points
   */
  private createBundledEdge(
    edge: GraphEdge,
    nodes: Map<string, GraphNode>
  ): BundledEdge {
    const sourceId =
      typeof edge.source === "string" ? edge.source : edge.source.id;
    const targetId =
      typeof edge.target === "string" ? edge.target : edge.target.id;

    const sourceNode = nodes.get(sourceId);
    const targetNode = nodes.get(targetId);

    // Default positions if nodes not found
    const sourcePos: Vector2 = sourceNode
      ? { x: sourceNode.x ?? 0, y: sourceNode.y ?? 0 }
      : { x: 0, y: 0 };

    const targetPos: Vector2 = targetNode
      ? { x: targetNode.x ?? 0, y: targetNode.y ?? 0 }
      : { x: 0, y: 0 };

    return {
      id: edge.id,
      sourceId,
      targetId,
      controlPoints: [sourcePos, targetPos],
      originalEdge: edge,
      compatibilityScore: 0,
    };
  }
}

/**
 * Factory function to create a StubBundler
 *
 * @param config - Optional partial configuration
 * @returns New StubBundler instance
 */
export function createStubBundler(
  config?: Partial<BundlingConfig>
): StubBundler {
  return new StubBundler(config);
}
