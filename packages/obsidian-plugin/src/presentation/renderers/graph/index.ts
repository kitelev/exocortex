/**
 * Graph Renderer Module
 *
 * Exports the GraphLayoutRenderer component and related types for
 * force-directed graph visualization of asset relationships.
 *
 * @module presentation/renderers/graph
 * @since 1.0.0
 */

export { GraphLayoutRenderer } from "./GraphLayoutRenderer";
export { GraphNode } from "./GraphNode";
export { GraphEdge } from "./GraphEdge";

// Barnes-Hut algorithm for O(n log n) many-body force calculation
export { Quadtree } from "./Quadtree";
export type { QuadtreeNode, QuadtreeBounds, QuadtreePoint } from "./Quadtree";

export {
  BarnesHutForce,
  createBarnesHutForce,
  applyBarnesHutForce,
  benchmarkBarnesHut,
} from "./BarnesHutForce";
export type {
  SimulationNode,
  BarnesHutForceConfig,
} from "./BarnesHutForce";

export type {
  GraphNode as GraphNodeData,
  GraphEdge as GraphEdgeData,
  GraphData,
  GraphLayoutRendererProps,
  GraphLayoutOptions,
  GraphNodeProps,
  GraphEdgeProps,
} from "./types";

export {
  extractLabelFromWikilink,
  extractPathFromWikilink,
  rowsToNodes,
  extractEdges,
  buildGraphData,
} from "./types";
