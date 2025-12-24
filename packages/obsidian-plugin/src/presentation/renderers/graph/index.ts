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

// Force-directed layout simulation (d3-force compatible)
export { ForceSimulation } from "./ForceSimulation";
export type {
  SimulationNode as ForceSimulationNode,
  SimulationLink,
  Force,
  SimulationEvent,
  SimulationEventCallback,
  ForceSimulationConfig,
  SimulationMetrics,
} from "./ForceSimulation";

// Built-in forces
export {
  forceCenter,
  forceLink,
  forceManyBody,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
} from "./ForceSimulation";

export type {
  ForceCenterConfig,
  ForceLinkConfig,
  ForceManyBodyConfig,
  ForceCollideConfig,
  ForceRadialConfig,
  ForceXConfig,
  ForceYConfig,
} from "./ForceSimulation";

// Configurable force parameters
export type {
  CenterForceParams,
  ChargeForceParams,
  LinkForceParams,
  CollisionForceParams,
  VelocityDecayParams,
  ForceConfiguration,
  ForcePresetName,
} from "./ForceSimulation";

export {
  FORCE_PRESETS,
  cloneForceConfiguration,
  mergeForceConfiguration,
  validateForceConfiguration,
} from "./ForceSimulation";

// PixiJS WebGL2 renderer for high-performance graph rendering
export { PixiGraphRenderer } from "./PixiGraphRenderer";
export type {
  PixiGraphRendererOptions,
  ViewportState,
} from "./PixiGraphRenderer";

// Node rendering with customizable shapes
export {
  NodeRenderer,
  NodeStyleResolver,
  SHAPE_DRAWERS,
  DEFAULT_NODE_STYLE,
  DEFAULT_NODE_TYPE_CONFIGS,
  calculateNodeRadius,
} from "./NodeRenderer";
export type {
  NodeShape,
  NodeVisualStyle,
  NodeTypeConfig,
  OntologyClass,
  RadiusScalingMode,
  RenderedNode,
} from "./NodeRenderer";

// Edge rendering with curved paths
export {
  EdgeRenderer,
  EdgeStyleResolver,
  DEFAULT_EDGE_STYLE,
  DEFAULT_EDGE_TYPE_CONFIGS,
  calculateEdgeEndpoints,
} from "./EdgeRenderer";
export type {
  Position,
  CurveType,
  ArrowType,
  ArrowPosition,
  EdgeVisualStyle,
  PredicateType,
  EdgeTypeConfig,
  CurvePoints,
  RenderedEdge,
} from "./EdgeRenderer";

// Label rendering with text sprites
export {
  LabelRenderer,
  LabelStyleResolver,
  DEFAULT_LABEL_STYLE,
  calculateOptimalLabelPosition,
} from "./LabelRenderer";
export type {
  LabelAnchor,
  LabelVisualStyle,
  RenderedLabel,
  ViewportInfo,
} from "./LabelRenderer";
