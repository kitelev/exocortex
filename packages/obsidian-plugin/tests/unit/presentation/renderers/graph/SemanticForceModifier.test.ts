/**
 * SemanticForceModifier Unit Tests
 *
 * Tests for ontology-driven force modifiers that affect graph physics
 * based on RDF/OWL predicates and type relationships.
 */

import {
  SemanticForceModifier,
  DEFAULT_SEMANTIC_PHYSICS_CONFIG,
  type SemanticLink,
  type SemanticNode,
  type ForceModifier,
} from "@plugin/presentation/renderers/graph/SemanticForceModifier";
import type { SemanticPhysicsConfig } from "@plugin/presentation/stores/graphConfigStore/types";

// ============================================================
// Test Helpers
// ============================================================

function createSemanticNode(
  id: string,
  types: string[] = []
): SemanticNode {
  return {
    id,
    index: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    mass: 1,
    radius: 8,
    types,
  };
}

function createSemanticLink(
  source: string | SemanticNode,
  target: string | SemanticNode,
  predicate?: string
): SemanticLink {
  return {
    source,
    target,
    predicate,
  };
}

function createTestConfig(
  overrides?: Partial<SemanticPhysicsConfig>
): SemanticPhysicsConfig {
  return {
    enabled: true,
    predicates: [
      { predicate: "rdfs:subClassOf", attractionMultiplier: 2.0, repulsionMultiplier: 1.0 },
      { predicate: "owl:disjointWith", attractionMultiplier: 1.0, repulsionMultiplier: 3.0 },
      { predicate: "dcterms:isPartOf", attractionMultiplier: 1.5, repulsionMultiplier: 1.0 },
    ],
    defaultAttractionMultiplier: 1.0,
    defaultRepulsionMultiplier: 1.0,
    typeBasedRepulsion: true,
    differentTypeRepulsionMultiplier: 1.3,
    ...overrides,
  };
}

// ============================================================
// SemanticForceModifier Tests
// ============================================================

describe("SemanticForceModifier", () => {
  describe("constructor", () => {
    it("should create modifier with given configuration", () => {
      const config = createTestConfig();
      const modifier = new SemanticForceModifier(config);

      expect(modifier.isEnabled()).toBe(true);
      expect(modifier.getConfig()).toEqual(config);
    });

    it("should handle disabled configuration", () => {
      const config = createTestConfig({ enabled: false });
      const modifier = new SemanticForceModifier(config);

      expect(modifier.isEnabled()).toBe(false);
    });
  });

  describe("getLinkModifier", () => {
    it("should return default modifier when disabled", () => {
      const config = createTestConfig({ enabled: false });
      const modifier = new SemanticForceModifier(config);
      const link = createSemanticLink("a", "b", "rdfs:subClassOf");

      const result = modifier.getLinkModifier(link);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should return configured multiplier for matching predicate", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const link = createSemanticLink("a", "b", "rdfs:subClassOf");

      const result = modifier.getLinkModifier(link);

      expect(result.attraction).toBe(2.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should return repulsion multiplier for disjoint predicate", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const link = createSemanticLink("a", "b", "owl:disjointWith");

      const result = modifier.getLinkModifier(link);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(3.0);
    });

    it("should return default multipliers for unconfigured predicate", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const link = createSemanticLink("a", "b", "unknown:predicate");

      const result = modifier.getLinkModifier(link);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should return default multipliers for link without predicate", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const link = createSemanticLink("a", "b");

      const result = modifier.getLinkModifier(link);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should match predicate by local name", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const link = createSemanticLink("a", "b", "http://www.w3.org/2000/01/rdf-schema#subClassOf");

      // The extractLocalName should match "subClassOf" with the configured "rdfs:subClassOf"
      const result = modifier.getLinkModifier(link);

      // Should match because local name "subClassOf" is checked
      expect(result.attraction).toBe(2.0);
    });
  });

  describe("getNodePairModifier", () => {
    it("should return default modifier when disabled", () => {
      const config = createTestConfig({ enabled: false });
      const modifier = new SemanticForceModifier(config);
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);

      const result = modifier.getNodePairModifier(nodeA, nodeB);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should return default modifier when typeBasedRepulsion is disabled", () => {
      const config = createTestConfig({ typeBasedRepulsion: false });
      const modifier = new SemanticForceModifier(config);
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);

      const result = modifier.getNodePairModifier(nodeA, nodeB);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should return default modifier for nodes with same type", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1", "Type2"]);
      const nodeB = createSemanticNode("b", ["Type1", "Type3"]);

      const result = modifier.getNodePairModifier(nodeA, nodeB);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should return increased repulsion for nodes with different types", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);

      const result = modifier.getNodePairModifier(nodeA, nodeB);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.3);
    });

    it("should return default modifier when either node has no types", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", []);

      const result = modifier.getNodePairModifier(nodeA, nodeB);

      expect(result.attraction).toBe(1.0);
      expect(result.repulsion).toBe(1.0);
    });

    it("should cache node pair results", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);

      // First call
      const result1 = modifier.getNodePairModifier(nodeA, nodeB);
      // Second call with same nodes (should use cache)
      const result2 = modifier.getNodePairModifier(nodeA, nodeB);
      // Reversed order (should use same cache entry)
      const result3 = modifier.getNodePairModifier(nodeB, nodeA);

      expect(result1).toEqual(result2);
      expect(result1).toEqual(result3);
    });
  });

  describe("computeLinkStrength", () => {
    it("should apply attraction multiplier to base strength", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const link = createSemanticLink("a", "b", "rdfs:subClassOf");
      const baseStrength = 1.0;

      const result = modifier.computeLinkStrength(baseStrength, link);

      expect(result).toBe(2.0); // baseStrength * attractionMultiplier
    });

    it("should return base strength when disabled", () => {
      const config = createTestConfig({ enabled: false });
      const modifier = new SemanticForceModifier(config);
      const link = createSemanticLink("a", "b", "rdfs:subClassOf");
      const baseStrength = 1.0;

      const result = modifier.computeLinkStrength(baseStrength, link);

      expect(result).toBe(1.0);
    });
  });

  describe("computeRepulsionStrength", () => {
    it("should apply repulsion multiplier for different types", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);
      const baseStrength = -300;

      const result = modifier.computeRepulsionStrength(baseStrength, nodeA, nodeB);

      expect(result).toBe(-390); // baseStrength * differentTypeRepulsionMultiplier (1.3)
    });

    it("should return base strength for same types", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type1"]);
      const baseStrength = -300;

      const result = modifier.computeRepulsionStrength(baseStrength, nodeA, nodeB);

      expect(result).toBe(-300);
    });
  });

  describe("getCombinedLinkModifier", () => {
    it("should combine link and node pair modifiers", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      nodeA.index = 0;
      const nodeB = createSemanticNode("b", ["Type2"]);
      nodeB.index = 1;
      const link: SemanticLink<SemanticNode> = {
        source: nodeA,
        target: nodeB,
        predicate: "rdfs:subClassOf",
      };

      const result = modifier.getCombinedLinkModifier(link);

      expect(result.attraction).toBe(2.0); // From predicate
      expect(result.repulsion).toBe(1.3); // From different types (max of 1.0 and 1.3)
    });
  });

  describe("updateConfig", () => {
    it("should update configuration and clear caches", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);

      // Prime the cache
      modifier.getNodePairModifier(nodeA, nodeB);

      // Update config with higher multiplier
      const newConfig = createTestConfig({ differentTypeRepulsionMultiplier: 2.0 });
      modifier.updateConfig(newConfig);

      // Should use new config value
      const result = modifier.getNodePairModifier(nodeA, nodeB);
      expect(result.repulsion).toBe(2.0);
    });
  });

  describe("clearCache", () => {
    it("should clear the type pair cache", () => {
      const modifier = new SemanticForceModifier(createTestConfig());
      const nodeA = createSemanticNode("a", ["Type1"]);
      const nodeB = createSemanticNode("b", ["Type2"]);

      // Prime the cache
      modifier.getNodePairModifier(nodeA, nodeB);

      // Clear cache
      modifier.clearCache();

      // Next call should compute again (no way to verify directly, but no error)
      const result = modifier.getNodePairModifier(nodeA, nodeB);
      expect(result.repulsion).toBe(1.3);
    });
  });

  describe("getConfiguredPredicates", () => {
    it("should return list of configured predicates", () => {
      const modifier = new SemanticForceModifier(createTestConfig());

      const predicates = modifier.getConfiguredPredicates();

      expect(predicates).toContain("rdfs:subClassOf");
      expect(predicates).toContain("owl:disjointWith");
      expect(predicates).toContain("dcterms:isPartOf");
      expect(predicates).toHaveLength(3);
    });
  });

  describe("hasPredicateConfig", () => {
    it("should return true for configured predicate", () => {
      const modifier = new SemanticForceModifier(createTestConfig());

      expect(modifier.hasPredicateConfig("rdfs:subClassOf")).toBe(true);
      expect(modifier.hasPredicateConfig("owl:disjointWith")).toBe(true);
    });

    it("should return false for unconfigured predicate", () => {
      const modifier = new SemanticForceModifier(createTestConfig());

      expect(modifier.hasPredicateConfig("unknown:predicate")).toBe(false);
    });
  });
});

describe("DEFAULT_SEMANTIC_PHYSICS_CONFIG", () => {
  it("should have semantic physics enabled by default", () => {
    expect(DEFAULT_SEMANTIC_PHYSICS_CONFIG.enabled).toBe(true);
  });

  it("should include standard ontology predicates", () => {
    const predicates = DEFAULT_SEMANTIC_PHYSICS_CONFIG.predicates.map(p => p.predicate);

    expect(predicates).toContain("rdfs:subClassOf");
    expect(predicates).toContain("exo:Asset_prototype");
    expect(predicates).toContain("dcterms:isPartOf");
    expect(predicates).toContain("owl:disjointWith");
  });

  it("should have rdfs:subClassOf with 2x attraction", () => {
    const subClassConfig = DEFAULT_SEMANTIC_PHYSICS_CONFIG.predicates.find(
      p => p.predicate === "rdfs:subClassOf"
    );

    expect(subClassConfig?.attractionMultiplier).toBe(2.0);
    expect(subClassConfig?.repulsionMultiplier).toBe(1.0);
  });

  it("should have owl:disjointWith with 3x repulsion", () => {
    const disjointConfig = DEFAULT_SEMANTIC_PHYSICS_CONFIG.predicates.find(
      p => p.predicate === "owl:disjointWith"
    );

    expect(disjointConfig?.attractionMultiplier).toBe(1.0);
    expect(disjointConfig?.repulsionMultiplier).toBe(3.0);
  });

  it("should enable type-based repulsion by default", () => {
    expect(DEFAULT_SEMANTIC_PHYSICS_CONFIG.typeBasedRepulsion).toBe(true);
    expect(DEFAULT_SEMANTIC_PHYSICS_CONFIG.differentTypeRepulsionMultiplier).toBe(1.3);
  });
});
