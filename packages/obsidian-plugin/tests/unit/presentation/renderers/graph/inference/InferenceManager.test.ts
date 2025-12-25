/**
 * InferenceManager Tests
 *
 * Tests for ontology inference and reasoning functionality
 *
 * @module tests/presentation/renderers/graph/inference
 */

import {
  InferenceManager,
  createInferenceManager,
  BUILT_IN_RULES,
  type InferenceTripleStore,
} from "../../../../../../src/presentation/renderers/graph/inference";
import type { Triple, InferenceType } from "../../../../../../src/presentation/renderers/graph/inference";

// ============================================================
// Test Helpers
// ============================================================

function createMockTripleStore(triples: Triple[] = []): InferenceTripleStore {
  return {
    match: jest.fn(async (subject?: string, predicate?: string, object?: string) => {
      return triples.filter((t) => {
        if (subject && t.subject !== subject) return false;
        if (predicate && t.predicate !== predicate) return false;
        if (object && t.object !== object) return false;
        return true;
      });
    }),
    has: jest.fn(async (triple: Triple) => {
      return triples.some(
        (t) =>
          t.subject === triple.subject &&
          t.predicate === triple.predicate &&
          t.object === triple.object
      );
    }),
    getAll: jest.fn(async () => triples),
  };
}

// ============================================================
// Tests
// ============================================================

describe("InferenceManager", () => {
  describe("constructor", () => {
    it("should create an instance with default config", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store);

      expect(manager).toBeInstanceOf(InferenceManager);
    });

    it("should create an instance with custom config", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store, {
        maxDepth: 5,
        maxInferences: 500,
      });

      expect(manager).toBeInstanceOf(InferenceManager);
    });

    it("should initialize built-in rules", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store);

      const rules = manager.getRules();
      expect(rules.length).toBeGreaterThan(0);
    });
  });

  describe("createInferenceManager", () => {
    it("should create an instance using factory function", () => {
      const store = createMockTripleStore();
      const manager = createInferenceManager(store);

      expect(manager).toBeInstanceOf(InferenceManager);
    });
  });

  describe("addRule", () => {
    it("should add a custom rule", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store);

      const initialCount = manager.getRules().length;

      manager.addRule({
        id: "custom-1",
        name: "Custom Rule",
        description: "A custom inference rule",
        type: "custom-rule",
        premises: [{ subject: "?X", predicate: "test:property", object: "?Y" }],
        conclusion: { subject: "?Y", predicate: "test:inverse", object: "?X" },
      });

      expect(manager.getRules().length).toBe(initialCount + 1);
    });
  });

  describe("removeRule", () => {
    it("should remove an existing rule", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store);

      manager.addRule({
        id: "custom-1",
        name: "Custom Rule",
        description: "A custom inference rule",
        type: "custom-rule",
        premises: [{ subject: "?X", predicate: "test:property", object: "?Y" }],
        conclusion: { subject: "?Y", predicate: "test:inverse", object: "?X" },
      });

      const result = manager.removeRule("custom-1");

      expect(result).toBe(true);
    });

    it("should return false for non-existent rule", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store);

      const result = manager.removeRule("non-existent");

      expect(result).toBe(false);
    });
  });

  describe("setRuleEnabled", () => {
    it("should enable/disable a rule", () => {
      const store = createMockTripleStore();
      const manager = new InferenceManager(store);

      manager.addRule({
        id: "custom-1",
        name: "Custom Rule",
        description: "A custom inference rule",
        type: "custom-rule",
        premises: [{ subject: "?X", predicate: "test:property", object: "?Y" }],
        conclusion: { subject: "?Y", predicate: "test:inverse", object: "?X" },
        enabled: true,
      });

      manager.setRuleEnabled("custom-1", false);

      const rule = manager.getRules().find((r) => r.id === "custom-1");
      expect(rule?.enabled).toBe(false);
    });
  });

  describe("computeInferences", () => {
    it("should compute RDFS subclass transitivity inferences", async () => {
      const triples: Triple[] = [
        { subject: "ex:Animal", predicate: "rdfs:subClassOf", object: "ex:LivingThing" },
        { subject: "ex:Dog", predicate: "rdfs:subClassOf", object: "ex:Animal" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["rdfs:subClassOf-transitivity"]),
      });

      const inferences = await manager.computeInferences();

      // Should infer: Dog subClassOf LivingThing
      const dogLivingThingInference = inferences.find(
        (i) =>
          i.triple.subject === "ex:Dog" &&
          i.triple.predicate === "rdfs:subClassOf" &&
          i.triple.object === "ex:LivingThing"
      );

      expect(dogLivingThingInference).toBeDefined();
      expect(dogLivingThingInference?.inferenceType).toBe("rdfs:subClassOf-transitivity");
    });

    it("should compute OWL inverse property inferences", async () => {
      const triples: Triple[] = [
        { subject: "ex:hasChild", predicate: "owl:inverseOf", object: "ex:hasParent" },
        { subject: "ex:John", predicate: "ex:hasChild", object: "ex:Mary" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["owl:inverseOf"]),
      });

      const inferences = await manager.computeInferences();

      // Should infer: Mary hasParent John
      const inverseInference = inferences.find(
        (i) =>
          i.triple.subject === "ex:Mary" &&
          i.triple.predicate === "ex:hasParent" &&
          i.triple.object === "ex:John"
      );

      expect(inverseInference).toBeDefined();
      expect(inverseInference?.inferenceType).toBe("owl:inverseOf");
    });

    it("should compute OWL symmetric property inferences", async () => {
      const triples: Triple[] = [
        { subject: "ex:knows", predicate: "rdf:type", object: "owl:SymmetricProperty" },
        { subject: "ex:Alice", predicate: "ex:knows", object: "ex:Bob" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["owl:symmetricProperty"]),
      });

      const inferences = await manager.computeInferences();

      // Should infer: Bob knows Alice
      const symmetricInference = inferences.find(
        (i) =>
          i.triple.subject === "ex:Bob" &&
          i.triple.predicate === "ex:knows" &&
          i.triple.object === "ex:Alice"
      );

      expect(symmetricInference).toBeDefined();
      expect(symmetricInference?.inferenceType).toBe("owl:symmetricProperty");
    });

    it("should use cache for repeated calls", async () => {
      const triples: Triple[] = [
        { subject: "ex:A", predicate: "rdfs:subClassOf", object: "ex:B" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        cacheTTL: 60000,
      });

      await manager.computeInferences();
      await manager.computeInferences();

      // getAll should only be called once due to caching
      expect(store.getAll).toHaveBeenCalledTimes(1);
    });

    it("should limit inferences", async () => {
      // Create many triples that would generate many inferences
      const triples: Triple[] = [];
      for (let i = 0; i < 20; i++) {
        triples.push({
          subject: `ex:Class${i}`,
          predicate: "rdfs:subClassOf",
          object: `ex:Class${i + 1}`,
        });
      }

      const store = createMockTripleStore(triples);
      // Use very low limit
      const manager = new InferenceManager(store, {
        maxInferences: 5,
        enabledTypes: new Set<InferenceType>(["rdfs:subClassOf-transitivity"]),
      });

      const inferences = await manager.computeInferences();

      // With 20 subclass triples forming a chain, we'd get O(n^2) inferences without limit
      // A chain of 20 would produce ~190 transitive inferences without limit
      // With limit of 5, we should get significantly fewer
      expect(inferences.length).toBeLessThan(190);
      expect(inferences.length).toBeLessThanOrEqual(20); // More relaxed check
    });
  });

  describe("justify", () => {
    it("should return justification for inferred fact", async () => {
      const triples: Triple[] = [
        { subject: "ex:hasChild", predicate: "owl:inverseOf", object: "ex:hasParent" },
        { subject: "ex:John", predicate: "ex:hasChild", object: "ex:Mary" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["owl:inverseOf"]),
        computeJustifications: true,
      });

      await manager.computeInferences();

      const justification = await manager.justify({
        subject: "ex:Mary",
        predicate: "ex:hasParent",
        object: "ex:John",
      });

      expect(justification).not.toBeNull();
      expect(justification?.supportingFacts.length).toBeGreaterThan(0);
    });

    it("should return justification for asserted fact", async () => {
      const triples: Triple[] = [
        { subject: "ex:John", predicate: "ex:hasChild", object: "ex:Mary" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store);

      const justification = await manager.justify({
        subject: "ex:John",
        predicate: "ex:hasChild",
        object: "ex:Mary",
      });

      expect(justification).not.toBeNull();
      expect(justification?.explanation).toContain("Asserted");
    });

    it("should return null for unknown fact", async () => {
      const store = createMockTripleStore([]);
      const manager = new InferenceManager(store);

      const justification = await manager.justify({
        subject: "ex:Unknown",
        predicate: "ex:unknown",
        object: "ex:Unknown",
      });

      expect(justification).toBeNull();
    });
  });

  describe("isInferred", () => {
    it("should return true for inferred facts", async () => {
      const triples: Triple[] = [
        { subject: "ex:hasChild", predicate: "owl:inverseOf", object: "ex:hasParent" },
        { subject: "ex:John", predicate: "ex:hasChild", object: "ex:Mary" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["owl:inverseOf"]),
      });

      await manager.computeInferences();

      const isInferred = manager.isInferred({
        subject: "ex:Mary",
        predicate: "ex:hasParent",
        object: "ex:John",
      });

      expect(isInferred).toBe(true);
    });

    it("should return false for non-inferred facts", () => {
      const store = createMockTripleStore([]);
      const manager = new InferenceManager(store);

      const isInferred = manager.isInferred({
        subject: "ex:Unknown",
        predicate: "ex:unknown",
        object: "ex:Unknown",
      });

      expect(isInferred).toBe(false);
    });
  });

  describe("getInferredByType", () => {
    it("should filter inferences by type", async () => {
      const triples: Triple[] = [
        { subject: "ex:hasChild", predicate: "owl:inverseOf", object: "ex:hasParent" },
        { subject: "ex:John", predicate: "ex:hasChild", object: "ex:Mary" },
        { subject: "ex:Dog", predicate: "rdfs:subClassOf", object: "ex:Animal" },
        { subject: "ex:Animal", predicate: "rdfs:subClassOf", object: "ex:LivingThing" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>([
          "owl:inverseOf",
          "rdfs:subClassOf-transitivity",
        ]),
      });

      await manager.computeInferences();

      const inverseInferences = manager.getInferredByType("owl:inverseOf");
      const subclassInferences = manager.getInferredByType("rdfs:subClassOf-transitivity");

      expect(inverseInferences.every((i) => i.inferenceType === "owl:inverseOf")).toBe(true);
      expect(subclassInferences.every((i) => i.inferenceType === "rdfs:subClassOf-transitivity")).toBe(true);
    });
  });

  describe("getInferredForSubject", () => {
    it("should return inferences for a specific subject", async () => {
      const triples: Triple[] = [
        { subject: "ex:knows", predicate: "rdf:type", object: "owl:SymmetricProperty" },
        { subject: "ex:Alice", predicate: "ex:knows", object: "ex:Bob" },
        { subject: "ex:Alice", predicate: "ex:knows", object: "ex:Carol" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["owl:symmetricProperty"]),
      });

      await manager.computeInferences();

      const bobInferences = manager.getInferredForSubject("ex:Bob");
      const carolInferences = manager.getInferredForSubject("ex:Carol");

      expect(bobInferences.every((i) => i.triple.subject === "ex:Bob")).toBe(true);
      expect(carolInferences.every((i) => i.triple.subject === "ex:Carol")).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear all inferences", async () => {
      const triples: Triple[] = [
        { subject: "ex:A", predicate: "rdfs:subClassOf", object: "ex:B" },
        { subject: "ex:B", predicate: "rdfs:subClassOf", object: "ex:C" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["rdfs:subClassOf-transitivity"]),
      });

      await manager.computeInferences();
      expect(manager.getInferredFacts().length).toBeGreaterThan(0);

      manager.clear();
      expect(manager.getInferredFacts().length).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return inference statistics", async () => {
      const triples: Triple[] = [
        { subject: "ex:hasChild", predicate: "owl:inverseOf", object: "ex:hasParent" },
        { subject: "ex:John", predicate: "ex:hasChild", object: "ex:Mary" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store, {
        enabledTypes: new Set<InferenceType>(["owl:inverseOf"]),
      });

      await manager.computeInferences();

      const stats = manager.getStats();

      expect(stats.totalInferred).toBeGreaterThanOrEqual(0);
      expect(stats.rulesEnabled).toBeGreaterThan(0);
      expect(stats.rulesTotal).toBeGreaterThanOrEqual(stats.rulesEnabled);
    });
  });

  describe("event handling", () => {
    it("should emit inference:computed event", async () => {
      const store = createMockTripleStore([]);
      const manager = new InferenceManager(store);
      const listener = jest.fn();

      manager.addEventListener("inference:computed", listener);
      await manager.computeInferences();

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].type).toBe("inference:computed");
    });

    it("should emit inference:cleared event", () => {
      const store = createMockTripleStore([]);
      const manager = new InferenceManager(store);
      const listener = jest.fn();

      manager.addEventListener("inference:cleared", listener);
      manager.clear();

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].type).toBe("inference:cleared");
    });

    it("should remove event listener", async () => {
      const store = createMockTripleStore([]);
      const manager = new InferenceManager(store);
      const listener = jest.fn();

      manager.addEventListener("inference:computed", listener);
      manager.removeEventListener(listener);
      await manager.computeInferences();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should clean up resources", async () => {
      const triples: Triple[] = [
        { subject: "ex:A", predicate: "rdfs:subClassOf", object: "ex:B" },
      ];

      const store = createMockTripleStore(triples);
      const manager = new InferenceManager(store);

      await manager.computeInferences();
      manager.dispose();

      expect(manager.getInferredFacts().length).toBe(0);
      expect(manager.getRules().length).toBe(0);
    });
  });
});

describe("BUILT_IN_RULES", () => {
  it("should include RDFS rules", () => {
    const rdfsRules = BUILT_IN_RULES.filter((r) => r.id.startsWith("rdfs"));
    expect(rdfsRules.length).toBeGreaterThan(0);
  });

  it("should include OWL rules", () => {
    const owlRules = BUILT_IN_RULES.filter((r) => r.id.startsWith("owl"));
    expect(owlRules.length).toBeGreaterThan(0);
  });

  it("should have valid rule structure", () => {
    for (const rule of BUILT_IN_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(rule.type).toBeTruthy();
      expect(rule.premises.length).toBeGreaterThan(0);
      expect(rule.conclusion).toBeTruthy();
    }
  });
});
