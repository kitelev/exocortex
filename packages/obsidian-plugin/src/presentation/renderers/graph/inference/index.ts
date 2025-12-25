/**
 * Inference Module
 *
 * Provides ontology inference visualization and neighborhood exploration:
 * - RDFS/OWL 2 RL inference rules
 * - Visual differentiation between asserted and inferred facts
 * - Multi-hop neighborhood exploration
 * - Justification chain visualization
 *
 * @module presentation/renderers/graph/inference
 * @since 1.0.0
 */

// Types
export type {
  Triple,
  TriplePattern,
  InferenceType,
  InferenceRule,
  InferenceStep,
  Justification,
  InferredFact,
  AnnotatedTriple,
  NeighborhoodDirection,
  NeighborhoodExplorationOptions,
  NeighborhoodNode,
  NeighborhoodEdge,
  NeighborhoodResult,
  NeighborhoodStats,
  InferenceVisualStyle,
  InferenceVisualizationState,
  InferenceEventType,
  InferenceEvent,
  InferenceEventListener,
} from "./InferenceTypes";

// Constants
export {
  DEFAULT_NEIGHBORHOOD_OPTIONS,
  DEFAULT_INFERENCE_STYLE,
  DEFAULT_INFERENCE_STATE,
} from "./InferenceTypes";

// InferenceManager
export {
  InferenceManager,
  createInferenceManager,
  BUILT_IN_RULES,
} from "./InferenceManager";
export type {
  InferenceTripleStore,
  InferenceManagerConfig,
} from "./InferenceManager";

// NeighborhoodExplorer
export {
  NeighborhoodExplorer,
  createNeighborhoodExplorer,
} from "./NeighborhoodExplorer";
export type {
  NeighborhoodTripleStore,
  NeighborhoodExplorerConfig,
} from "./NeighborhoodExplorer";

// InferenceRenderer
export {
  InferenceRenderer,
  createInferenceRenderer,
  INFERENCE_TYPE_BADGES,
  INFERENCE_TYPE_DESCRIPTIONS,
} from "./InferenceRenderer";
export type {
  InferenceEdgeRenderData,
  InferenceNodeRenderData,
  InferenceRendererConfig,
} from "./InferenceRenderer";
