/**
 * Edge Bundling Types
 *
 * Type definitions for edge bundling algorithms that reduce visual clutter
 * in dense graphs by routing similar edges along common paths.
 *
 * @module presentation/renderers/graph/bundling
 * @since 1.0.0
 */

import type { GraphEdge, GraphNode } from "../types";

/**
 * 2D Vector for edge bundling calculations
 */
export interface Vector2 {
  x: number;
  y: number;
}

/**
 * Available bundling algorithms
 */
export type BundlingAlgorithm = "fdeb" | "hierarchical" | "stub";

/**
 * Configuration for edge bundling
 */
export interface BundlingConfig {
  /** Algorithm to use for bundling */
  algorithm: BundlingAlgorithm;

  /** Number of iterations for force simulation (FDEB) */
  iterations: number;

  /** Step size for force simulation (FDEB) */
  stepSize: number;

  /** Minimum edge compatibility threshold (0-1) for bundling (FDEB) */
  compatibility: number;

  /** Rate at which edges are subdivided (FDEB) */
  subdivisionRate: number;

  /** Spring constant for edge attraction (FDEB) */
  springConstant: number;

  /** Strength of bundling (0-1), where 1 is maximum bundling */
  bundleStrength: number;

  /** Maximum number of subdivision points per edge */
  maxSubdivisions: number;

  /** Whether to enable adaptive step size */
  adaptiveStepSize: boolean;
}

/**
 * Default bundling configuration
 */
export const DEFAULT_BUNDLING_CONFIG: BundlingConfig = {
  algorithm: "fdeb",
  iterations: 60,
  stepSize: 0.04,
  compatibility: 0.6,
  subdivisionRate: 2,
  springConstant: 0.1,
  bundleStrength: 0.85,
  maxSubdivisions: 64,
  adaptiveStepSize: true,
};

/**
 * A bundled edge with control points for curved rendering
 */
export interface BundledEdge {
  /** Unique identifier for the edge */
  id: string;

  /** Source node ID */
  sourceId: string;

  /** Target node ID */
  targetId: string;

  /** Control points defining the bundled path (includes source and target) */
  controlPoints: Vector2[];

  /** Reference to the original edge data */
  originalEdge: GraphEdge;

  /** Compatibility score with other edges (for debugging/visualization) */
  compatibilityScore?: number;
}

/**
 * Edge segment used during FDEB bundling
 */
export interface EdgeSegment {
  /** Edge identifier */
  edgeId: string;

  /** Subdivision points along the edge */
  points: Vector2[];

  /** Pairwise compatibility scores with other edges */
  compatibility: Map<string, number>;

  /** Source node ID */
  sourceId: string;

  /** Target node ID */
  targetId: string;
}

/**
 * Result of edge bundling operation
 */
export interface BundlingResult {
  /** Bundled edges with control points */
  edges: BundledEdge[];

  /** Time taken for bundling in milliseconds */
  duration: number;

  /** Number of edges that were bundled */
  bundledCount: number;

  /** Number of edges that were left unbundled (low compatibility) */
  unbundledCount: number;

  /** Average compatibility score across all edge pairs */
  averageCompatibility: number;
}

/**
 * Interface for edge bundling algorithms
 */
export interface EdgeBundler {
  /**
   * Bundle edges to reduce visual clutter
   *
   * @param edges - Array of edges to bundle
   * @param nodes - Map of node IDs to node positions
   * @returns Array of bundled edges with control points
   */
  bundle(edges: GraphEdge[], nodes: Map<string, GraphNode>): BundledEdge[];

  /**
   * Bundle edges and return detailed result with statistics
   *
   * @param edges - Array of edges to bundle
   * @param nodes - Map of node IDs to node positions
   * @returns Bundling result with edges and statistics
   */
  bundleWithStats(
    edges: GraphEdge[],
    nodes: Map<string, GraphNode>
  ): BundlingResult;

  /**
   * Update bundling configuration
   *
   * @param config - Partial configuration to merge with current config
   */
  setConfig(config: Partial<BundlingConfig>): void;

  /**
   * Get current bundling configuration
   */
  getConfig(): BundlingConfig;

  /**
   * Get the name of the bundling algorithm
   */
  getName(): string;
}

/**
 * Compatibility measures for FDEB algorithm
 */
export interface CompatibilityMeasures {
  /** Angle compatibility (0-1) - edges with similar angles bundle better */
  angleCompatibility: number;

  /** Scale compatibility (0-1) - edges of similar length bundle better */
  scaleCompatibility: number;

  /** Position compatibility (0-1) - edges that are close together bundle better */
  positionCompatibility: number;

  /** Visibility compatibility (0-1) - edges that don't cross nodes bundle better */
  visibilityCompatibility: number;
}

/**
 * Hierarchical bundling configuration
 */
export interface HierarchicalBundlingConfig extends BundlingConfig {
  /** Beta parameter for hierarchical bundling (0-1) */
  beta: number;

  /** Whether to use radial layout for hierarchy */
  radialLayout: boolean;

  /** Tension for the bundled curves (0-1) */
  tension: number;
}

/**
 * Default hierarchical bundling configuration
 */
export const DEFAULT_HIERARCHICAL_CONFIG: HierarchicalBundlingConfig = {
  ...DEFAULT_BUNDLING_CONFIG,
  algorithm: "hierarchical",
  beta: 0.85,
  radialLayout: false,
  tension: 0.85,
};

/**
 * Hierarchy node for hierarchical edge bundling
 */
export interface HierarchyNode {
  /** Node ID */
  id: string;

  /** Parent node ID (null for root) */
  parentId: string | null;

  /** Child node IDs */
  childIds: string[];

  /** Depth in the hierarchy (0 for root) */
  depth: number;

  /** Position of the node */
  position: Vector2;

  /** Whether this is a leaf node (actual graph node) */
  isLeaf: boolean;
}

/**
 * Factory function type for creating edge bundlers
 */
export type EdgeBundlerFactory = (
  config?: Partial<BundlingConfig>
) => EdgeBundler;

/**
 * Calculate the Euclidean distance between two points
 *
 * @param p1 - First point
 * @param p2 - Second point
 * @returns Distance between points
 */
export function distance(p1: Vector2, p2: Vector2): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the midpoint between two points
 *
 * @param p1 - First point
 * @param p2 - Second point
 * @returns Midpoint
 */
export function midpoint(p1: Vector2, p2: Vector2): Vector2 {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

/**
 * Normalize a vector to unit length
 *
 * @param v - Vector to normalize
 * @returns Normalized vector (or zero vector if input is zero)
 */
export function normalize(v: Vector2): Vector2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / len, y: v.y / len };
}

/**
 * Calculate dot product of two vectors
 *
 * @param v1 - First vector
 * @param v2 - Second vector
 * @returns Dot product
 */
export function dot(v1: Vector2, v2: Vector2): number {
  return v1.x * v2.x + v1.y * v2.y;
}

/**
 * Subtract two vectors
 *
 * @param v1 - First vector
 * @param v2 - Second vector
 * @returns Result of v1 - v2
 */
export function subtract(v1: Vector2, v2: Vector2): Vector2 {
  return { x: v1.x - v2.x, y: v1.y - v2.y };
}

/**
 * Add two vectors
 *
 * @param v1 - First vector
 * @param v2 - Second vector
 * @returns Result of v1 + v2
 */
export function add(v1: Vector2, v2: Vector2): Vector2 {
  return { x: v1.x + v2.x, y: v1.y + v2.y };
}

/**
 * Scale a vector by a scalar
 *
 * @param v - Vector to scale
 * @param s - Scalar value
 * @returns Scaled vector
 */
export function scale(v: Vector2, s: number): Vector2 {
  return { x: v.x * s, y: v.y * s };
}

/**
 * Linear interpolation between two points
 *
 * @param p1 - Start point
 * @param p2 - End point
 * @param t - Interpolation parameter (0 = p1, 1 = p2)
 * @returns Interpolated point
 */
export function lerp(p1: Vector2, p2: Vector2, t: number): Vector2 {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

/**
 * Project a point onto a line segment
 *
 * @param point - Point to project
 * @param lineStart - Start of line segment
 * @param lineEnd - End of line segment
 * @returns Projected point and parameter t (0-1 if on segment)
 */
export function projectOntoLine(
  point: Vector2,
  lineStart: Vector2,
  lineEnd: Vector2
): { point: Vector2; t: number } {
  const lineVec = subtract(lineEnd, lineStart);
  const pointVec = subtract(point, lineStart);
  const lineLenSq = dot(lineVec, lineVec);

  if (lineLenSq === 0) {
    return { point: lineStart, t: 0 };
  }

  const t = Math.max(0, Math.min(1, dot(pointVec, lineVec) / lineLenSq));
  return {
    point: add(lineStart, scale(lineVec, t)),
    t,
  };
}
