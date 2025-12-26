/**
 * Edge Bundling Module
 *
 * Provides algorithms for reducing visual clutter in dense graphs
 * by routing similar edges along common paths.
 *
 * Available bundlers:
 * - StubBundler: Passthrough bundler that returns unbundled edges
 * - FDEBBundler: Force-Directed Edge Bundling algorithm
 * - HierarchicalBundler: Hierarchical Edge Bundling algorithm
 *
 * @module presentation/renderers/graph/bundling
 * @since 1.0.0
 */

// Types
export type {
  Vector2,
  BundlingAlgorithm,
  BundlingConfig,
  BundledEdge,
  EdgeSegment,
  BundlingResult,
  EdgeBundler,
  CompatibilityMeasures,
  HierarchicalBundlingConfig,
  HierarchyNode,
  EdgeBundlerFactory,
} from "./BundlingTypes";

// Constants and utilities
export {
  DEFAULT_BUNDLING_CONFIG,
  DEFAULT_HIERARCHICAL_CONFIG,
  distance,
  midpoint,
  normalize,
  dot,
  subtract,
  add,
  scale,
  lerp,
  projectOntoLine,
} from "./BundlingTypes";

// Bundlers
import { StubBundler, createStubBundler } from "./StubBundler";
import { FDEBBundler, createFDEBBundler } from "./FDEBBundler";
import {
  HierarchicalBundler,
  createHierarchicalBundler,
} from "./HierarchicalBundler";
import type { BundlingConfig, EdgeBundler } from "./BundlingTypes";

export { StubBundler, createStubBundler };
export { FDEBBundler, createFDEBBundler };
export { HierarchicalBundler, createHierarchicalBundler };

/**
 * Create an edge bundler based on algorithm name
 *
 * @param algorithm - Bundling algorithm to use
 * @param config - Optional configuration
 * @returns Edge bundler instance
 */
export function createEdgeBundler(
  algorithm: "fdeb" | "hierarchical" | "stub" = "fdeb",
  config?: Partial<BundlingConfig>
): EdgeBundler {
  switch (algorithm) {
    case "fdeb":
      return new FDEBBundler(config);
    case "hierarchical":
      return new HierarchicalBundler(config);
    case "stub":
    default:
      return new StubBundler(config);
  }
}
