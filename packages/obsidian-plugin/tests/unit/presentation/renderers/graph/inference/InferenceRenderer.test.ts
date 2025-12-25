/**
 * InferenceRenderer Tests
 *
 * Tests for visual differentiation of inferred facts
 *
 * @module tests/presentation/renderers/graph/inference
 */

import {
  InferenceRenderer,
  createInferenceRenderer,
  INFERENCE_TYPE_BADGES,
  INFERENCE_TYPE_DESCRIPTIONS,
  DEFAULT_INFERENCE_STYLE,
  DEFAULT_INFERENCE_STATE,
  type NeighborhoodNode,
  type NeighborhoodEdge,
  type InferredFact,
  type InferenceType,
} from "../../../../../../src/presentation/renderers/graph/inference";

// ============================================================
// Test Helpers
// ============================================================

function createMockNeighborhoodNode(
  id: string,
  hopDistance: number = 0,
  reachedViaInference: boolean = false
): NeighborhoodNode {
  return {
    id,
    label: `Node ${id}`,
    path: id,
    hopDistance,
    reachedViaInference,
  };
}

function createMockNeighborhoodEdge(
  id: string,
  source: string,
  target: string,
  isInferred: boolean = false,
  inference?: InferredFact
): NeighborhoodEdge {
  return {
    id,
    source,
    target,
    property: "test:property",
    label: "property",
    isInferred,
    inference,
    hopDistance: 1,
  };
}

function createMockInferredFact(
  type: InferenceType = "owl:inverseOf"
): InferredFact {
  return {
    triple: {
      subject: "ex:A",
      predicate: "ex:prop",
      object: "ex:B",
    },
    inferenceType: type,
    rule: {
      id: "test-rule",
      name: "Test Rule",
      description: "A test rule",
      type,
      premises: [{ subject: "?X", predicate: "?P", object: "?Y" }],
      conclusion: { subject: "?Y", predicate: "?P", object: "?X" },
    },
    justification: {
      supportingFacts: [
        { subject: "ex:A", predicate: "ex:prop", object: "ex:B" },
      ],
      inferenceChain: [],
      explanation: "Test explanation",
      depth: 1,
    },
    confidence: 1.0,
    timestamp: Date.now(),
  };
}

// ============================================================
// Tests
// ============================================================

describe("InferenceRenderer", () => {
  describe("constructor", () => {
    it("should create an instance with default state", () => {
      const renderer = new InferenceRenderer();

      expect(renderer).toBeInstanceOf(InferenceRenderer);
      expect(renderer.isEnabled()).toBe(true);
    });

    it("should create an instance with custom initial state", () => {
      const renderer = new InferenceRenderer({
        enabled: false,
        minConfidence: 0.5,
      });

      expect(renderer.isEnabled()).toBe(false);
    });
  });

  describe("createInferenceRenderer", () => {
    it("should create an instance using factory function", () => {
      const renderer = createInferenceRenderer();

      expect(renderer).toBeInstanceOf(InferenceRenderer);
    });
  });

  describe("getEdgeRenderData", () => {
    it("should return asserted edge style for non-inferred edges", () => {
      const renderer = new InferenceRenderer();
      const edge = createMockNeighborhoodEdge("e1", "A", "B", false);

      const data = renderer.getEdgeRenderData(edge);

      expect(data.color).toBe(DEFAULT_INFERENCE_STYLE.assertedEdgeColor);
      expect(data.dashPattern).toBeNull();
      expect(data.glow).toBe(false);
    });

    it("should return inferred edge style for inferred edges", () => {
      const renderer = new InferenceRenderer();
      const inference = createMockInferredFact("owl:inverseOf");
      const edge = createMockNeighborhoodEdge("e1", "A", "B", true, inference);

      const data = renderer.getEdgeRenderData(edge);

      expect(data.color).toBe(DEFAULT_INFERENCE_STYLE.inferredEdgeColor);
      expect(data.dashPattern).toEqual(DEFAULT_INFERENCE_STYLE.inferredEdgeDash);
      expect(data.typeBadge).toBe(INFERENCE_TYPE_BADGES["owl:inverseOf"]);
    });

    it("should hide edges for disabled inference types", () => {
      const renderer = new InferenceRenderer();
      renderer.toggleInferenceType("owl:inverseOf", false);

      const inference = createMockInferredFact("owl:inverseOf");
      const edge = createMockNeighborhoodEdge("e1", "A", "B", true, inference);

      const data = renderer.getEdgeRenderData(edge);

      expect(data.opacity).toBe(0);
      expect(data.color).toBe("transparent");
    });

    it("should hide edges below confidence threshold", () => {
      const renderer = new InferenceRenderer();
      renderer.setMinConfidence(0.8);

      const inference = createMockInferredFact("owl:inverseOf");
      inference.confidence = 0.5;
      const edge = createMockNeighborhoodEdge("e1", "A", "B", true, inference);

      const data = renderer.getEdgeRenderData(edge);

      expect(data.opacity).toBe(0);
    });

    it("should reduce opacity based on hop distance", () => {
      const renderer = new InferenceRenderer();
      const edge1 = createMockNeighborhoodEdge("e1", "A", "B", false);
      edge1.hopDistance = 0;

      const edge2 = createMockNeighborhoodEdge("e2", "B", "C", false);
      edge2.hopDistance = 2;

      const data1 = renderer.getEdgeRenderData(edge1);
      const data2 = renderer.getEdgeRenderData(edge2);

      expect(data2.opacity).toBeLessThan(data1.opacity);
    });
  });

  describe("getNodeRenderData", () => {
    it("should return asserted node style for non-inferred nodes", () => {
      const renderer = new InferenceRenderer();
      const node = createMockNeighborhoodNode("A", 0, false);

      const data = renderer.getNodeRenderData(node);

      expect(data.borderColor).toBe(DEFAULT_INFERENCE_STYLE.assertedEdgeColor);
      expect(data.borderDash).toBeNull();
    });

    it("should return inferred node style for inferred nodes", () => {
      const renderer = new InferenceRenderer();
      const node = createMockNeighborhoodNode("A", 1, true);

      const data = renderer.getNodeRenderData(node);

      expect(data.borderColor).toBe(DEFAULT_INFERENCE_STYLE.inferredNodeBorderColor);
      expect(data.borderDash).toEqual(DEFAULT_INFERENCE_STYLE.inferredNodeBorderDash);
    });

    it("should include hop badge for non-center nodes", () => {
      const renderer = new InferenceRenderer();
      const node = createMockNeighborhoodNode("A", 2, false);

      const data = renderer.getNodeRenderData(node);

      expect(data.hopBadge).toBe(2);
    });

    it("should not include hop badge for center node", () => {
      const renderer = new InferenceRenderer();
      const node = createMockNeighborhoodNode("A", 0, false);

      const data = renderer.getNodeRenderData(node);

      expect(data.hopBadge).toBeUndefined();
    });

    it("should reduce opacity based on hop distance", () => {
      const renderer = new InferenceRenderer();
      const node1 = createMockNeighborhoodNode("A", 0, false);
      const node2 = createMockNeighborhoodNode("B", 3, false);

      const data1 = renderer.getNodeRenderData(node1);
      const data2 = renderer.getNodeRenderData(node2);

      expect(data2.opacity).toBeLessThan(data1.opacity);
    });
  });

  describe("setEnabled", () => {
    it("should enable/disable visualization", () => {
      const renderer = new InferenceRenderer();

      renderer.setEnabled(false);
      expect(renderer.isEnabled()).toBe(false);

      renderer.setEnabled(true);
      expect(renderer.isEnabled()).toBe(true);
    });

    it("should emit style-change event", () => {
      const renderer = new InferenceRenderer();
      const listener = jest.fn();

      renderer.addEventListener("inference:style-change", listener);
      renderer.setEnabled(false);

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].type).toBe("inference:style-change");
    });
  });

  describe("toggleInferenceType", () => {
    it("should toggle inference type visibility", () => {
      const renderer = new InferenceRenderer();

      // Initially enabled
      expect(renderer.isTypeVisible("owl:inverseOf")).toBe(true);

      // Toggle off
      renderer.toggleInferenceType("owl:inverseOf", false);
      expect(renderer.isTypeVisible("owl:inverseOf")).toBe(false);

      // Toggle on
      renderer.toggleInferenceType("owl:inverseOf", true);
      expect(renderer.isTypeVisible("owl:inverseOf")).toBe(true);
    });

    it("should toggle without explicit value", () => {
      const renderer = new InferenceRenderer();

      const initial = renderer.isTypeVisible("owl:inverseOf");
      renderer.toggleInferenceType("owl:inverseOf");
      expect(renderer.isTypeVisible("owl:inverseOf")).toBe(!initial);
    });

    it("should emit toggle-type event", () => {
      const renderer = new InferenceRenderer();
      const listener = jest.fn();

      renderer.addEventListener("inference:toggle-type", listener);
      renderer.toggleInferenceType("owl:inverseOf", false);

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].type).toBe("inference:toggle-type");
      expect(listener.mock.calls[0][0].inferenceType).toBe("owl:inverseOf");
    });
  });

  describe("getSelectedTypes", () => {
    it("should return all selected inference types", () => {
      const renderer = new InferenceRenderer();

      const types = renderer.getSelectedTypes();

      expect(types).toContain("owl:inverseOf");
      expect(types).toContain("rdfs:subClassOf-transitivity");
    });
  });

  describe("setMinConfidence", () => {
    it("should set minimum confidence threshold", () => {
      const renderer = new InferenceRenderer();

      renderer.setMinConfidence(0.7);

      const state = renderer.getState();
      expect(state.minConfidence).toBe(0.7);
    });

    it("should clamp value to [0, 1]", () => {
      const renderer = new InferenceRenderer();

      renderer.setMinConfidence(-0.5);
      expect(renderer.getState().minConfidence).toBe(0);

      renderer.setMinConfidence(1.5);
      expect(renderer.getState().minConfidence).toBe(1);
    });
  });

  describe("highlightChain", () => {
    it("should highlight an inference chain", () => {
      const renderer = new InferenceRenderer();
      const inference = createMockInferredFact();

      renderer.highlightChain(inference);

      const state = renderer.getState();
      expect(state.highlightedChain).toBe(inference);
    });

    it("should emit highlight event", () => {
      const renderer = new InferenceRenderer();
      const listener = jest.fn();
      const inference = createMockInferredFact();

      renderer.addEventListener("inference:highlight", listener);
      renderer.highlightChain(inference);

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].fact).toBe(inference);
    });

    it("should emit unhighlight event when replacing", () => {
      const renderer = new InferenceRenderer();
      const listener = jest.fn();
      const inference1 = createMockInferredFact();
      const inference2 = createMockInferredFact();

      renderer.highlightChain(inference1);
      renderer.addEventListener("inference:unhighlight", listener);
      renderer.highlightChain(inference2);

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].fact).toBe(inference1);
    });
  });

  describe("clearHighlight", () => {
    it("should clear highlighted chain", () => {
      const renderer = new InferenceRenderer();
      const inference = createMockInferredFact();

      renderer.highlightChain(inference);
      renderer.clearHighlight();

      const state = renderer.getState();
      expect(state.highlightedChain).toBeUndefined();
    });
  });

  describe("setStyle", () => {
    it("should update visual style", () => {
      const renderer = new InferenceRenderer();

      renderer.setStyle({
        inferredEdgeColor: "#ff0000",
        inferredOpacity: 0.5,
      });

      const style = renderer.getStyle();
      expect(style.inferredEdgeColor).toBe("#ff0000");
      expect(style.inferredOpacity).toBe(0.5);
    });

    it("should preserve other style properties", () => {
      const renderer = new InferenceRenderer();
      const originalStyle = renderer.getStyle();

      renderer.setStyle({
        inferredEdgeColor: "#ff0000",
      });

      const newStyle = renderer.getStyle();
      expect(newStyle.assertedEdgeColor).toBe(originalStyle.assertedEdgeColor);
    });
  });

  describe("getInferenceTooltip", () => {
    it("should generate tooltip content", () => {
      const renderer = new InferenceRenderer();
      const inference = createMockInferredFact("owl:inverseOf");

      const tooltip = renderer.getInferenceTooltip(inference);

      // Check for human-readable description (Type header shows description, not raw type)
      expect(tooltip).toContain("Inverse");
      expect(tooltip).toContain("Test Rule");
      expect(tooltip).toContain("Justification");
    });

    it("should include confidence for non-1.0 values", () => {
      const renderer = new InferenceRenderer();
      const inference = createMockInferredFact();
      inference.confidence = 0.75;

      const tooltip = renderer.getInferenceTooltip(inference);

      expect(tooltip).toContain("Confidence");
      expect(tooltip).toContain("75");
    });
  });

  describe("getState", () => {
    it("should return a copy of the state", () => {
      const renderer = new InferenceRenderer();

      const state1 = renderer.getState();
      const state2 = renderer.getState();

      // Should be equal but not same reference
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
      expect(state1.selectedTypes).not.toBe(state2.selectedTypes);
    });
  });

  describe("event handling", () => {
    it("should add and remove event listeners", () => {
      const renderer = new InferenceRenderer();
      const listener = jest.fn();

      renderer.addEventListener("inference:style-change", listener);
      renderer.setEnabled(false);
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      renderer.removeEventListener(listener);
      renderer.setEnabled(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should clean up resources", () => {
      const renderer = new InferenceRenderer();
      const listener = jest.fn();

      renderer.addEventListener("inference:style-change", listener);
      renderer.dispose();
      renderer.setEnabled(false);

      // Listener should not be called after dispose
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe("INFERENCE_TYPE_BADGES", () => {
  it("should have a badge for each inference type", () => {
    const types: InferenceType[] = [
      "rdfs:subClassOf-transitivity",
      "rdfs:subPropertyOf-transitivity",
      "rdfs:domain",
      "rdfs:range",
      "owl:equivalentClass",
      "owl:sameAs",
      "owl:inverseOf",
      "owl:transitiveProperty",
      "owl:symmetricProperty",
      "owl:propertyChain",
      "owl:hasValue",
      "owl:someValuesFrom",
      "owl:allValuesFrom",
      "owl:functionalProperty",
      "owl:inverseFunctionalProperty",
      "custom-rule",
    ];

    for (const type of types) {
      expect(INFERENCE_TYPE_BADGES[type]).toBeDefined();
      expect(typeof INFERENCE_TYPE_BADGES[type]).toBe("string");
    }
  });

  it("should have short badges (max 3 chars)", () => {
    for (const badge of Object.values(INFERENCE_TYPE_BADGES)) {
      expect(badge.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("INFERENCE_TYPE_DESCRIPTIONS", () => {
  it("should have a description for each inference type", () => {
    const types = Object.keys(INFERENCE_TYPE_BADGES) as InferenceType[];

    for (const type of types) {
      expect(INFERENCE_TYPE_DESCRIPTIONS[type]).toBeDefined();
      expect(typeof INFERENCE_TYPE_DESCRIPTIONS[type]).toBe("string");
      expect(INFERENCE_TYPE_DESCRIPTIONS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("DEFAULT_INFERENCE_STYLE", () => {
  it("should have valid color values", () => {
    expect(DEFAULT_INFERENCE_STYLE.inferredEdgeColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_INFERENCE_STYLE.assertedEdgeColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_INFERENCE_STYLE.inferredNodeBorderColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("should have valid opacity value", () => {
    expect(DEFAULT_INFERENCE_STYLE.inferredOpacity).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_INFERENCE_STYLE.inferredOpacity).toBeLessThanOrEqual(1);
  });

  it("should have valid dash patterns", () => {
    expect(DEFAULT_INFERENCE_STYLE.inferredEdgeDash).toHaveLength(2);
    expect(DEFAULT_INFERENCE_STYLE.inferredNodeBorderDash).toHaveLength(2);
  });
});

describe("DEFAULT_INFERENCE_STATE", () => {
  it("should be enabled by default", () => {
    expect(DEFAULT_INFERENCE_STATE.enabled).toBe(true);
  });

  it("should have common inference types selected", () => {
    expect(DEFAULT_INFERENCE_STATE.selectedTypes.has("rdfs:subClassOf-transitivity")).toBe(true);
    expect(DEFAULT_INFERENCE_STATE.selectedTypes.has("owl:inverseOf")).toBe(true);
  });

  it("should show justifications by default", () => {
    expect(DEFAULT_INFERENCE_STATE.showJustifications).toBe(true);
  });
});
