/**
 * InferenceTypes - Types and interfaces for ontology inference visualization
 *
 * Provides type definitions for:
 * - Inferred facts with justification chains
 * - RDFS and OWL inference rules
 * - Visual differentiation between asserted and inferred triples
 * - Neighborhood exploration with multi-hop support
 *
 * Based on RDFS and OWL 2 RL entailment rules.
 *
 * @module presentation/renderers/graph/inference
 * @since 1.0.0
 */

import type { GraphNode, GraphEdge } from "../types";

// ============================================================
// Core Triple Types
// ============================================================

/**
 * RDF Triple representation for inference
 */
export interface Triple {
  /** Subject URI or blank node */
  subject: string;

  /** Predicate URI */
  predicate: string;

  /** Object URI, blank node, or literal */
  object: string;

  /** Whether object is a literal value */
  isLiteral?: boolean;

  /** Literal datatype if applicable */
  datatype?: string;

  /** Language tag for literals */
  language?: string;
}

/**
 * Triple pattern for rule matching (with optional wildcards)
 */
export interface TriplePattern {
  /** Subject pattern (variable if starts with ?) */
  subject?: string;

  /** Predicate pattern */
  predicate?: string;

  /** Object pattern */
  object?: string;
}

// ============================================================
// Inference Rule Types
// ============================================================

/**
 * Types of ontology inference supported
 */
export type InferenceType =
  | "rdfs:subClassOf-transitivity"
  | "rdfs:subPropertyOf-transitivity"
  | "rdfs:domain"
  | "rdfs:range"
  | "owl:equivalentClass"
  | "owl:sameAs"
  | "owl:inverseOf"
  | "owl:transitiveProperty"
  | "owl:symmetricProperty"
  | "owl:propertyChain"
  | "owl:hasValue"
  | "owl:someValuesFrom"
  | "owl:allValuesFrom"
  | "owl:functionalProperty"
  | "owl:inverseFunctionalProperty"
  | "custom-rule";

/**
 * Inference rule definition
 */
export interface InferenceRule {
  /** Unique rule identifier */
  id: string;

  /** Human-readable rule name */
  name: string;

  /** Detailed description of what the rule does */
  description: string;

  /** Triple patterns that must match for rule to fire */
  premises: TriplePattern[];

  /** Triple pattern produced by the rule */
  conclusion: TriplePattern;

  /** Rule priority (higher = applied first) @default 0 */
  priority?: number;

  /** Whether rule is enabled @default true */
  enabled?: boolean;

  /** Inference type category */
  type: InferenceType;
}

/**
 * Single step in an inference chain
 */
export interface InferenceStep {
  /** Rule that was applied */
  rule: InferenceRule;

  /** Input triples that matched the rule premises */
  premises: Triple[];

  /** Output triple produced by the rule */
  conclusion: Triple;

  /** Step number in the chain (0-indexed) */
  stepNumber: number;
}

/**
 * Complete justification for an inferred fact
 */
export interface Justification {
  /** Ground facts (asserted triples) that support the inference */
  supportingFacts: Triple[];

  /** Ordered sequence of inference steps */
  inferenceChain: InferenceStep[];

  /** Human-readable explanation of the inference */
  explanation: string;

  /** Total depth of the inference chain */
  depth: number;
}

// ============================================================
// Inferred Fact Types
// ============================================================

/**
 * An inferred triple with its justification
 */
export interface InferredFact {
  /** The inferred triple */
  triple: Triple;

  /** Type of inference that produced this fact */
  inferenceType: InferenceType;

  /** Rule that produced this inference */
  rule: InferenceRule;

  /** Complete justification chain */
  justification: Justification;

  /** Confidence score (0-1) for probabilistic inference @default 1.0 */
  confidence?: number;

  /** Timestamp when inference was computed */
  timestamp: number;

  /** Whether this fact has been verified/validated */
  verified?: boolean;
}

/**
 * A triple that may be asserted or inferred
 */
export interface AnnotatedTriple {
  /** The triple data */
  triple: Triple;

  /** Whether this triple is asserted (true) or inferred (false) */
  isAsserted: boolean;

  /** Inference details if inferred */
  inference?: InferredFact;
}

// ============================================================
// Neighborhood Exploration Types
// ============================================================

/**
 * Direction for neighborhood exploration
 */
export type NeighborhoodDirection = "incoming" | "outgoing" | "both";

/**
 * Options for neighborhood exploration
 */
export interface NeighborhoodExplorationOptions {
  /** Maximum number of hops from center node @default 2 */
  maxHops: number;

  /** Direction to explore @default "both" */
  direction: NeighborhoodDirection;

  /** Whether to include inferred relationships @default true */
  includeInferred: boolean;

  /** Predicate URIs to filter (include only these) */
  predicateFilter?: string[];

  /** Predicate URIs to exclude */
  excludePredicates?: string[];

  /** Maximum nodes to return @default 100 */
  maxNodes: number;

  /** Maximum edges to return @default 500 */
  maxEdges: number;

  /** Timeout in milliseconds @default 10000 */
  timeout: number;

  /** Whether to expand inferred nodes further @default false */
  expandInferred: boolean;

  /** Class types to filter (include only instances of these classes) */
  classFilter?: string[];
}

/**
 * A node in the exploration neighborhood
 */
export interface NeighborhoodNode extends GraphNode {
  /** Distance (hops) from the center node */
  hopDistance: number;

  /** Whether this node was reached via inference */
  reachedViaInference: boolean;

  /** Node class/type URIs */
  types?: string[];

  /** Whether this node is the center of exploration */
  isCenter?: boolean;
}

/**
 * An edge in the exploration neighborhood
 */
export interface NeighborhoodEdge extends GraphEdge {
  /** Whether this edge represents an inferred relationship */
  isInferred: boolean;

  /** Inference details if inferred */
  inference?: InferredFact;

  /** Hop distance where this edge was discovered */
  hopDistance: number;
}

/**
 * Result of neighborhood exploration
 */
export interface NeighborhoodResult {
  /** Center node ID */
  centerId: string;

  /** All discovered nodes */
  nodes: NeighborhoodNode[];

  /** All discovered edges */
  edges: NeighborhoodEdge[];

  /** Statistics about the exploration */
  stats: NeighborhoodStats;

  /** Exploration options used */
  options: NeighborhoodExplorationOptions;

  /** Whether exploration was truncated due to limits */
  truncated: boolean;
}

/**
 * Statistics from neighborhood exploration
 */
export interface NeighborhoodStats {
  /** Total nodes discovered */
  totalNodes: number;

  /** Total edges discovered */
  totalEdges: number;

  /** Nodes at each hop distance */
  nodesPerHop: number[];

  /** Number of inferred edges found */
  inferredEdgeCount: number;

  /** Number of asserted edges found */
  assertedEdgeCount: number;

  /** Exploration time in milliseconds */
  explorationTimeMs: number;

  /** Maximum hop distance reached */
  maxHopReached: number;
}

// ============================================================
// Visualization Types
// ============================================================

/**
 * Visual style for inferred facts
 */
export interface InferenceVisualStyle {
  /** Edge color for inferred relationships */
  inferredEdgeColor: string;

  /** Edge dash pattern for inferred edges [dash, gap] */
  inferredEdgeDash: [number, number];

  /** Edge width multiplier for inferred edges */
  inferredEdgeWidthMultiplier: number;

  /** Node border style for nodes reached via inference */
  inferredNodeBorderDash: [number, number];

  /** Node border color for inferred nodes */
  inferredNodeBorderColor: string;

  /** Opacity for inferred elements (0-1) */
  inferredOpacity: number;

  /** Color for asserted (ground truth) edges */
  assertedEdgeColor: string;

  /** Show inference type labels on edges */
  showInferenceLabels: boolean;

  /** Glow effect for inferred edges */
  inferredGlowEnabled: boolean;

  /** Glow color for inferred edges */
  inferredGlowColor: string;

  /** Glow blur amount */
  inferredGlowBlur: number;
}

/**
 * State for inference visualization
 */
export interface InferenceVisualizationState {
  /** Whether inference visualization is enabled */
  enabled: boolean;

  /** Currently selected inference types to show */
  selectedTypes: Set<InferenceType>;

  /** Whether to show justification tooltips */
  showJustifications: boolean;

  /** Currently highlighted inference chain */
  highlightedChain?: InferredFact;

  /** Minimum confidence threshold to display (0-1) */
  minConfidence: number;

  /** Visual style settings */
  style: InferenceVisualStyle;
}

// ============================================================
// Event Types
// ============================================================

/**
 * Event types for inference visualization
 */
export type InferenceEventType =
  | "inference:computed"
  | "inference:cleared"
  | "inference:highlight"
  | "inference:unhighlight"
  | "inference:toggle-type"
  | "inference:style-change"
  | "neighborhood:explore-start"
  | "neighborhood:explore-complete"
  | "neighborhood:explore-error"
  | "neighborhood:hop-expand";

/**
 * Inference event payload
 */
export interface InferenceEvent {
  /** Event type */
  type: InferenceEventType;

  /** Affected inferred fact (if applicable) */
  fact?: InferredFact;

  /** Affected inference type (if applicable) */
  inferenceType?: InferenceType;

  /** Neighborhood exploration result (if applicable) */
  neighborhood?: NeighborhoodResult;

  /** Error message (if applicable) */
  error?: string;

  /** Additional event data */
  data?: Record<string, unknown>;
}

/**
 * Inference event listener callback
 */
export type InferenceEventListener = (event: InferenceEvent) => void;

// ============================================================
// Default Values
// ============================================================

/**
 * Default neighborhood exploration options
 */
export const DEFAULT_NEIGHBORHOOD_OPTIONS: Required<NeighborhoodExplorationOptions> = {
  maxHops: 2,
  direction: "both",
  includeInferred: true,
  predicateFilter: undefined as unknown as string[],
  excludePredicates: undefined as unknown as string[],
  maxNodes: 100,
  maxEdges: 500,
  timeout: 10000,
  expandInferred: false,
  classFilter: undefined as unknown as string[],
};

/**
 * Default inference visual style
 */
export const DEFAULT_INFERENCE_STYLE: InferenceVisualStyle = {
  inferredEdgeColor: "#9333ea", // Purple for inferred
  inferredEdgeDash: [5, 5],
  inferredEdgeWidthMultiplier: 0.8,
  inferredNodeBorderDash: [3, 3],
  inferredNodeBorderColor: "#9333ea",
  inferredOpacity: 0.85,
  assertedEdgeColor: "#3b82f6", // Blue for asserted
  showInferenceLabels: true,
  inferredGlowEnabled: true,
  inferredGlowColor: "#9333ea",
  inferredGlowBlur: 4,
};

/**
 * Default inference visualization state
 */
export const DEFAULT_INFERENCE_STATE: InferenceVisualizationState = {
  enabled: true,
  selectedTypes: new Set<InferenceType>([
    "rdfs:subClassOf-transitivity",
    "rdfs:domain",
    "rdfs:range",
    "owl:inverseOf",
    "owl:transitiveProperty",
    "owl:symmetricProperty",
  ]),
  showJustifications: true,
  highlightedChain: undefined,
  minConfidence: 0,
  style: DEFAULT_INFERENCE_STYLE,
};
