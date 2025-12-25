/**
 * InferenceRenderer - Visual differentiation for inferred facts
 *
 * Provides rendering functionality for:
 * - Visual differentiation between asserted and inferred edges
 * - Hop-distance based styling for neighborhood exploration
 * - Inference type indicators
 * - Justification chain visualization
 *
 * @module presentation/renderers/graph/inference
 * @since 1.0.0
 */

import type {
  InferredFact,
  InferenceType,
  InferenceVisualStyle,
  InferenceVisualizationState,
  NeighborhoodNode,
  NeighborhoodEdge,
  InferenceEvent,
  InferenceEventType,
  InferenceEventListener,
} from "./InferenceTypes";
import { DEFAULT_INFERENCE_STYLE, DEFAULT_INFERENCE_STATE } from "./InferenceTypes";

// ============================================================
// Types
// ============================================================

/**
 * Render data for an edge with inference styling
 */
export interface InferenceEdgeRenderData {
  /** Edge ID */
  id: string;

  /** Edge color */
  color: string;

  /** Edge width */
  width: number;

  /** Dash pattern [dash, gap] or null for solid */
  dashPattern: [number, number] | null;

  /** Opacity (0-1) */
  opacity: number;

  /** Edge label */
  label?: string;

  /** Whether to show glow effect */
  glow: boolean;

  /** Glow color */
  glowColor?: string;

  /** Glow blur amount */
  glowBlur?: number;

  /** Inference type badge (short code) */
  typeBadge?: string;

  /** Whether edge is highlighted */
  isHighlighted: boolean;
}

/**
 * Render data for a node with inference styling
 */
export interface InferenceNodeRenderData {
  /** Node ID */
  id: string;

  /** Border color */
  borderColor: string;

  /** Border width */
  borderWidth: number;

  /** Border dash pattern or null for solid */
  borderDash: [number, number] | null;

  /** Opacity (0-1) */
  opacity: number;

  /** Hop distance badge (for neighborhood exploration) */
  hopBadge?: number;

  /** Whether node is highlighted */
  isHighlighted: boolean;
}

/**
 * Inference type badge codes (short display names)
 */
export const INFERENCE_TYPE_BADGES: Record<InferenceType, string> = {
  "rdfs:subClassOf-transitivity": "SC",
  "rdfs:subPropertyOf-transitivity": "SP",
  "rdfs:domain": "D",
  "rdfs:range": "R",
  "owl:equivalentClass": "EC",
  "owl:sameAs": "=",
  "owl:inverseOf": "INV",
  "owl:transitiveProperty": "TR",
  "owl:symmetricProperty": "SYM",
  "owl:propertyChain": "PC",
  "owl:hasValue": "HV",
  "owl:someValuesFrom": "SVF",
  "owl:allValuesFrom": "AVF",
  "owl:functionalProperty": "FP",
  "owl:inverseFunctionalProperty": "IFP",
  "custom-rule": "CR",
};

/**
 * Inference type descriptions for tooltips
 */
export const INFERENCE_TYPE_DESCRIPTIONS: Record<InferenceType, string> = {
  "rdfs:subClassOf-transitivity": "Subclass transitivity: if A subclass B, B subclass C, then A subclass C",
  "rdfs:subPropertyOf-transitivity": "Subproperty transitivity",
  "rdfs:domain": "Property domain inference: if P has domain C, X P Y implies X is C",
  "rdfs:range": "Property range inference: if P has range C, X P Y implies Y is C",
  "owl:equivalentClass": "Equivalent class: bidirectional subclass relationship",
  "owl:sameAs": "Same identity: properties propagate between same individuals",
  "owl:inverseOf": "Inverse property: if P inverse Q, X P Y implies Y Q X",
  "owl:transitiveProperty": "Transitive property: if P transitive, X P Y, Y P Z implies X P Z",
  "owl:symmetricProperty": "Symmetric property: X P Y implies Y P X",
  "owl:propertyChain": "Property chain: P1 o P2 implies P3",
  "owl:hasValue": "Has value restriction inference",
  "owl:someValuesFrom": "Some values from restriction inference",
  "owl:allValuesFrom": "All values from restriction inference",
  "owl:functionalProperty": "Functional property: at most one value",
  "owl:inverseFunctionalProperty": "Inverse functional property: unique subject per object",
  "custom-rule": "Custom inference rule",
};

/**
 * Configuration for InferenceRenderer
 */
export interface InferenceRendererConfig {
  /** Base edge width @default 2 */
  baseEdgeWidth: number;

  /** Base node border width @default 2 */
  baseBorderWidth: number;

  /** Whether to show hop distance badges @default true */
  showHopBadges: boolean;

  /** Opacity reduction per hop @default 0.15 */
  opacityPerHop: number;

  /** Minimum opacity @default 0.3 */
  minOpacity: number;
}

/**
 * Default renderer configuration
 */
const DEFAULT_RENDERER_CONFIG: InferenceRendererConfig = {
  baseEdgeWidth: 2,
  baseBorderWidth: 2,
  showHopBadges: true,
  opacityPerHop: 0.15,
  minOpacity: 0.3,
};

// ============================================================
// InferenceRenderer Implementation
// ============================================================

/**
 * Renders visual differentiation for inferred facts
 *
 * @example
 * ```typescript
 * const renderer = new InferenceRenderer();
 *
 * // Get render data for an edge
 * const edgeData = renderer.getEdgeRenderData(edge, visualState);
 *
 * // Apply to edge element
 * edgeElement.style.stroke = edgeData.color;
 * edgeElement.style.strokeWidth = edgeData.width;
 *
 * // Toggle inference type visibility
 * renderer.toggleInferenceType("owl:inverseOf", true);
 * ```
 */
export class InferenceRenderer {
  private state: InferenceVisualizationState;
  private readonly config: InferenceRendererConfig;
  private readonly listeners: Set<InferenceEventListener>;

  constructor(
    initialState?: Partial<InferenceVisualizationState>,
    config?: Partial<InferenceRendererConfig>
  ) {
    this.state = {
      ...DEFAULT_INFERENCE_STATE,
      ...initialState,
      style: {
        ...DEFAULT_INFERENCE_STYLE,
        ...initialState?.style,
      },
      selectedTypes: new Set(initialState?.selectedTypes ?? DEFAULT_INFERENCE_STATE.selectedTypes),
    };
    this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };
    this.listeners = new Set();
  }

  // ============================================================
  // Edge Rendering
  // ============================================================

  /**
   * Get render data for a neighborhood edge
   */
  getEdgeRenderData(edge: NeighborhoodEdge): InferenceEdgeRenderData {
    const style = this.state.style;
    const isHighlighted = this.isEdgeHighlighted(edge);

    if (edge.isInferred && edge.inference) {
      // Check if this inference type is selected
      if (!this.state.selectedTypes.has(edge.inference.inferenceType)) {
        return this.createHiddenEdgeData(edge.id);
      }

      // Check confidence threshold
      const confidence = edge.inference.confidence ?? 1.0;
      if (confidence < this.state.minConfidence) {
        return this.createHiddenEdgeData(edge.id);
      }

      return {
        id: edge.id,
        color: style.inferredEdgeColor,
        width: this.config.baseEdgeWidth * style.inferredEdgeWidthMultiplier,
        dashPattern: style.inferredEdgeDash,
        opacity: this.calculateOpacity(edge.hopDistance, style.inferredOpacity),
        label: this.state.style.showInferenceLabels
          ? edge.label
          : undefined,
        glow: style.inferredGlowEnabled && isHighlighted,
        glowColor: style.inferredGlowColor,
        glowBlur: style.inferredGlowBlur,
        typeBadge: INFERENCE_TYPE_BADGES[edge.inference.inferenceType],
        isHighlighted,
      };
    }

    // Asserted edge
    return {
      id: edge.id,
      color: style.assertedEdgeColor,
      width: this.config.baseEdgeWidth,
      dashPattern: null,
      opacity: this.calculateOpacity(edge.hopDistance, 1.0),
      label: edge.label,
      glow: false,
      isHighlighted,
    };
  }

  /**
   * Create hidden edge render data
   */
  private createHiddenEdgeData(id: string): InferenceEdgeRenderData {
    return {
      id,
      color: "transparent",
      width: 0,
      dashPattern: null,
      opacity: 0,
      glow: false,
      isHighlighted: false,
    };
  }

  // ============================================================
  // Node Rendering
  // ============================================================

  /**
   * Get render data for a neighborhood node
   */
  getNodeRenderData(node: NeighborhoodNode): InferenceNodeRenderData {
    const style = this.state.style;
    const isHighlighted = this.isNodeHighlighted(node);

    if (node.reachedViaInference) {
      return {
        id: node.id,
        borderColor: style.inferredNodeBorderColor,
        borderWidth: this.config.baseBorderWidth,
        borderDash: style.inferredNodeBorderDash,
        opacity: this.calculateOpacity(node.hopDistance, style.inferredOpacity),
        hopBadge: this.config.showHopBadges ? node.hopDistance : undefined,
        isHighlighted,
      };
    }

    // Asserted/direct node
    return {
      id: node.id,
      borderColor: style.assertedEdgeColor,
      borderWidth: this.config.baseBorderWidth,
      borderDash: null,
      opacity: this.calculateOpacity(node.hopDistance, 1.0),
      hopBadge: this.config.showHopBadges && node.hopDistance > 0
        ? node.hopDistance
        : undefined,
      isHighlighted,
    };
  }

  // ============================================================
  // State Management
  // ============================================================

  /**
   * Enable or disable inference visualization
   */
  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
    this.emit({
      type: "inference:style-change",
      data: { enabled },
    });
  }

  /**
   * Check if visualization is enabled
   */
  isEnabled(): boolean {
    return this.state.enabled;
  }

  /**
   * Toggle visibility of an inference type
   */
  toggleInferenceType(type: InferenceType, visible?: boolean): void {
    const isVisible = visible ?? !this.state.selectedTypes.has(type);

    if (isVisible) {
      this.state.selectedTypes.add(type);
    } else {
      this.state.selectedTypes.delete(type);
    }

    this.emit({
      type: "inference:toggle-type",
      inferenceType: type,
      data: { visible: isVisible },
    });
  }

  /**
   * Check if an inference type is visible
   */
  isTypeVisible(type: InferenceType): boolean {
    return this.state.selectedTypes.has(type);
  }

  /**
   * Get all selected inference types
   */
  getSelectedTypes(): InferenceType[] {
    return Array.from(this.state.selectedTypes);
  }

  /**
   * Set the minimum confidence threshold
   */
  setMinConfidence(threshold: number): void {
    this.state.minConfidence = Math.max(0, Math.min(1, threshold));
    this.emit({
      type: "inference:style-change",
      data: { minConfidence: this.state.minConfidence },
    });
  }

  /**
   * Highlight an inference chain
   */
  highlightChain(inference: InferredFact | undefined): void {
    const previousChain = this.state.highlightedChain;
    this.state.highlightedChain = inference;

    if (previousChain) {
      this.emit({
        type: "inference:unhighlight",
        fact: previousChain,
      });
    }

    if (inference) {
      this.emit({
        type: "inference:highlight",
        fact: inference,
      });
    }
  }

  /**
   * Clear highlighted chain
   */
  clearHighlight(): void {
    this.highlightChain(undefined);
  }

  /**
   * Update visual style
   */
  setStyle(style: Partial<InferenceVisualStyle>): void {
    this.state.style = {
      ...this.state.style,
      ...style,
    };
    this.emit({
      type: "inference:style-change",
      data: { style: this.state.style },
    });
  }

  /**
   * Get current visual style
   */
  getStyle(): InferenceVisualStyle {
    return { ...this.state.style };
  }

  /**
   * Get full visualization state
   */
  getState(): InferenceVisualizationState {
    return {
      ...this.state,
      selectedTypes: new Set(this.state.selectedTypes),
      style: { ...this.state.style },
    };
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Calculate opacity based on hop distance
   */
  private calculateOpacity(hopDistance: number, baseOpacity: number): number {
    if (hopDistance === 0) {
      return baseOpacity;
    }

    const reduction = hopDistance * this.config.opacityPerHop;
    return Math.max(this.config.minOpacity, baseOpacity - reduction);
  }

  /**
   * Check if an edge is highlighted
   */
  private isEdgeHighlighted(edge: NeighborhoodEdge): boolean {
    if (!this.state.highlightedChain) {
      return false;
    }

    // Check if edge is part of the highlighted chain
    const chain = this.state.highlightedChain;

    // Check if the edge triple matches
    if (edge.isInferred && edge.inference) {
      return edge.inference.triple.subject === chain.triple.subject &&
        edge.inference.triple.predicate === chain.triple.predicate &&
        edge.inference.triple.object === chain.triple.object;
    }

    // Check supporting facts
    for (const fact of chain.justification.supportingFacts) {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;

      if (
        (fact.subject === sourceId && fact.object === targetId) ||
        (fact.subject === targetId && fact.object === sourceId)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a node is highlighted
   */
  private isNodeHighlighted(node: NeighborhoodNode): boolean {
    if (!this.state.highlightedChain) {
      return false;
    }

    const chain = this.state.highlightedChain;

    // Check if node is subject or object of the inferred triple
    if (
      chain.triple.subject === node.id ||
      chain.triple.object === node.id
    ) {
      return true;
    }

    // Check supporting facts
    for (const fact of chain.justification.supportingFacts) {
      if (fact.subject === node.id || fact.object === node.id) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get tooltip content for an inference
   */
  getInferenceTooltip(inference: InferredFact): string {
    const lines: string[] = [];

    lines.push(`Type: ${INFERENCE_TYPE_DESCRIPTIONS[inference.inferenceType]}`);
    lines.push(`Rule: ${inference.rule.name}`);

    if (inference.confidence !== undefined && inference.confidence < 1.0) {
      lines.push(`Confidence: ${(inference.confidence * 100).toFixed(1)}%`);
    }

    lines.push("");
    lines.push("Justification:");
    lines.push(inference.justification.explanation);

    if (inference.justification.supportingFacts.length > 0) {
      lines.push("");
      lines.push("Supporting facts:");
      for (const fact of inference.justification.supportingFacts) {
        lines.push(`  ${fact.subject} ${fact.predicate} ${fact.object}`);
      }
    }

    return lines.join("\n");
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
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in inference renderer event listener:", error);
      }
    }
  }

  /**
   * Dispose of renderer resources
   */
  dispose(): void {
    this.listeners.clear();
  }
}

/**
 * Create an InferenceRenderer instance
 */
export function createInferenceRenderer(
  initialState?: Partial<InferenceVisualizationState>,
  config?: Partial<InferenceRendererConfig>
): InferenceRenderer {
  return new InferenceRenderer(initialState, config);
}
