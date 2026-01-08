/**
 * Tests for LayoutSelector - RDF-driven layout selection service
 *
 * Issue #1459: Implement LayoutSelector service in ActionInterpreter
 * Issue #1462: Comprehensive unit tests for LayoutSelector
 * @see https://github.com/kitelev/exocortex/issues/1459
 * @see https://github.com/kitelev/exocortex/issues/1462
 *
 * Tests for:
 * - selectLayout() - Select layout based on asset's rdf:type classes
 * - loadLayout() - Load layout definition with blocks from RDF
 * - Caching behavior for layout definitions
 * - Class priority (most specific → parent → default)
 * - Edge cases (empty types, unknown types, multiple applicable layouts)
 * - Error handling (triple store failures, malformed data)
 */

import { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Triple, Subject } from "../../../../src/domain/models/rdf/Triple";
import { BlankNode } from "../../../../src/domain/models/rdf/BlankNode";
import { LayoutSelector } from "../../../../src/domain/services/LayoutSelector";
import type { Layout, LayoutBlock } from "../../../../src/domain/services/LayoutSelector";

describe("LayoutSelector", () => {
  let mockTripleStore: jest.Mocked<ITripleStore>;

  /**
   * Extract string representation from a subject (IRI or BlankNode).
   */
  const getSubjectString = (subject: Subject | undefined): string => {
    if (!subject) return "";
    if (subject instanceof IRI) return subject.value;
    if (subject instanceof BlankNode) return subject.toString(); // Returns _:id
    if ("value" in subject) return String((subject as { value: unknown }).value);
    return String(subject);
  };

  /**
   * Create a mock triple for testing.
   */
  const createTriple = (
    subject: string,
    predicate: string,
    object: string | number | boolean
  ): Triple => {
    // Handle blank node subjects
    let subjectTerm: Subject;
    if (subject.startsWith("_:")) {
      subjectTerm = new BlankNode(subject.substring(2));
    } else {
      subjectTerm = new IRI(subject);
    }
    const predicateIRI = new IRI(predicate);

    // Handle blank node objects
    let objectTerm;
    if (typeof object === "string" && object.startsWith("_:")) {
      objectTerm = new BlankNode(object.substring(2));
    } else if (typeof object === "string" && object.startsWith("http")) {
      objectTerm = new IRI(object);
    } else {
      objectTerm = new Literal(String(object));
    }

    return new Triple(subjectTerm, predicateIRI, objectTerm);
  };

  beforeEach(() => {
    mockTripleStore = {
      add: jest.fn(),
      remove: jest.fn(),
      has: jest.fn(),
      match: jest.fn(),
      addAll: jest.fn(),
      removeAll: jest.fn(),
      clear: jest.fn(),
      count: jest.fn(),
      subjects: jest.fn(),
      predicates: jest.fn(),
      objects: jest.fn(),
      beginTransaction: jest.fn(),
    } as jest.Mocked<ITripleStore>;
  });

  describe("constructor", () => {
    it("should create instance with triple store", () => {
      const selector = new LayoutSelector(mockTripleStore);
      expect(selector).toBeInstanceOf(LayoutSelector);
    });
  });

  describe("selectLayout() method", () => {
    const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
    const EXO_NS = "https://exocortex.my/ontology/exo#";
    const EMS_NS = "https://exocortex.my/ontology/ems#";
    const PN_NS = "https://exocortex.my/ontology/pn#";

    it("should return AreaLayout for Area asset", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/area-123";

      // Asset has rdf:type ems:Area
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query 1: Get asset's classes
        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [
            createTriple(assetUri, RDF_TYPE, `${EMS_NS}Area`),
          ];
        }

        // Query 2: Find layout for ems:Area class
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(`${EXO_UI_NS}AreaLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EMS_NS}Area`),
          ];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}AreaLayout`);
    });

    it("should return DailyNoteLayout for DailyNote asset", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/daily-note-2025-01-08";

      // Asset has rdf:type pn:DailyNote
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query 1: Get asset's classes
        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [
            createTriple(assetUri, RDF_TYPE, `${PN_NS}DailyNote`),
          ];
        }

        // Query 2: Find layout for pn:DailyNote class
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(`${EXO_UI_NS}DailyNoteLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${PN_NS}DailyNote`),
          ];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DailyNoteLayout`);
    });

    it("should return DefaultAssetLayout for unknown class", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/unknown-123";

      // Asset has rdf:type exo:UnknownClass (no specific layout defined)
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query 1: Get asset's classes
        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [
            createTriple(assetUri, RDF_TYPE, `${EXO_NS}UnknownClass`),
          ];
        }

        // Query 2: No layout for UnknownClass, but DefaultAssetLayout applies to exo:Asset
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(`${EXO_UI_NS}DefaultAssetLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EXO_NS}Asset`),
          ];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DefaultAssetLayout`);
    });

    it("should prioritize most specific class layout", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/daily-note-123";

      // Asset has multiple rdf:type: pn:DailyNote AND ems:Effort
      // Should choose pn:DailyNote (more specific) over ems:Effort (parent class)
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query 1: Get asset's classes - ordered by specificity
        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [
            createTriple(assetUri, RDF_TYPE, `${PN_NS}DailyNote`),
            createTriple(assetUri, RDF_TYPE, `${EMS_NS}Effort`),
            createTriple(assetUri, RDF_TYPE, `${EXO_NS}Asset`),
          ];
        }

        // Query 2: Find layouts
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(`${EXO_UI_NS}DailyNoteLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${PN_NS}DailyNote`),
            createTriple(`${EXO_UI_NS}EffortLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EMS_NS}Effort`),
            createTriple(`${EXO_UI_NS}DefaultAssetLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EXO_NS}Asset`),
          ];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DailyNoteLayout`);
    });
  });

  describe("edge cases", () => {
    const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
    const EXO_NS = "https://exocortex.my/ontology/exo#";
    const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";

    it("should handle asset with empty types array", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/no-types-123";

      // Asset has no rdf:type triples
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query 1: Get asset's classes - returns empty
        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [];
        }

        // Query 2: Layout_appliesTo for DefaultAssetLayout
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [];
        }

        // Label for DefaultAssetLayout
        if (subjectStr === `${EXO_UI_NS}DefaultAssetLayout` && predStr === `${RDFS_NS}label`) {
          return [createTriple(`${EXO_UI_NS}DefaultAssetLayout`, `${RDFS_NS}label`, "Default Asset Layout")];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      // Should fallback to DefaultAssetLayout
      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DefaultAssetLayout`);
    });

    it("should handle asset with only owl:NamedIndividual type", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/named-individual-123";
      const OWL_NS = "http://www.w3.org/2002/07/owl#";

      // Asset has only owl:NamedIndividual type (no specific layout)
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [
            createTriple(assetUri, RDF_TYPE, `${OWL_NS}NamedIndividual`),
          ];
        }

        // No layout for owl:NamedIndividual, fallback to DefaultAssetLayout
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(`${EXO_UI_NS}DefaultAssetLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EXO_NS}Asset`),
          ];
        }

        if (subjectStr === `${EXO_UI_NS}DefaultAssetLayout` && predStr === `${RDFS_NS}label`) {
          return [createTriple(`${EXO_UI_NS}DefaultAssetLayout`, `${RDFS_NS}label`, "Default Asset Layout")];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DefaultAssetLayout`);
    });

    it("should handle multiple applicable layouts and choose first match", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/multi-layout-123";

      // Asset has types that could match multiple layouts
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [
            createTriple(assetUri, RDF_TYPE, `${EXO_NS}Task`),
            createTriple(assetUri, RDF_TYPE, `${EXO_NS}Effort`),
          ];
        }

        // Both Task and Effort have layouts
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(`${EXO_UI_NS}TaskLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EXO_NS}Task`),
            createTriple(`${EXO_UI_NS}EffortLayout`, `${EXO_UI_NS}Layout_appliesTo`, `${EXO_NS}Effort`),
          ];
        }

        if (subjectStr === `${EXO_UI_NS}TaskLayout` && predStr === `${RDFS_NS}label`) {
          return [createTriple(`${EXO_UI_NS}TaskLayout`, `${RDFS_NS}label`, "Task Layout")];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      // Should choose first matching layout (TaskLayout, since Task is first in types)
      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}TaskLayout`);
    });

    it("should handle layout with no blocks", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}EmptyLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Empty Layout")];
        }

        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return []; // No blocks
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(layoutUri);
      expect(layout!.label).toBe("Empty Layout");
      expect(layout!.blocks).toHaveLength(0);
    });

    it("should handle layout with missing label", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}NoLabelLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // No label triple
        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [];
        }

        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [];
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(layoutUri);
      expect(layout!.label).toBe("Unnamed Layout"); // Default label
    });

    it("should handle block with missing properties", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}MinimalBlockLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Minimal Block Layout")];
        }

        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}MinimalBlock`)];
        }

        // Block has no properties set
        if (subjectStr === `${EXO_UI_NS}MinimalBlock`) {
          return [];
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      expect(layout!.blocks).toHaveLength(1);
      // Should have default values
      expect(layout!.blocks[0].uri).toBe(`${EXO_UI_NS}MinimalBlock`);
      expect(layout!.blocks[0].order).toBe(0); // Default
      expect(layout!.blocks[0].query).toBe(""); // Default
      expect(layout!.blocks[0].renderer).toBe("text"); // Default
      expect(layout!.blocks[0].headless).toBe(true); // Default
    });
  });

  describe("error handling", () => {
    const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
    const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
    const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

    it("should handle triple store errors gracefully in loadLayout", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}ErrorLayout`;

      // Simulate triple store error
      mockTripleStore.match.mockRejectedValue(new Error("Triple store connection failed"));

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeNull();
    });

    it("should cache null result for failed layout loads", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}FailingLayout`;

      // First call throws error
      mockTripleStore.match.mockRejectedValueOnce(new Error("First error"));

      const layout1 = await selector.loadLayout(layoutUri);
      expect(layout1).toBeNull();

      // Second call should use cached null value (no new error thrown)
      const layout2 = await selector.loadLayout(layoutUri);
      expect(layout2).toBeNull();
      // Should only have 1 call (cached after first failure)
      expect(mockTripleStore.match).toHaveBeenCalledTimes(1);
    });

    it("should handle block loading errors gracefully", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}BlockErrorLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Block Error Layout")];
        }

        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}GoodBlock`),
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}BadBlock`),
          ];
        }

        // GoodBlock succeeds
        if (subjectStr === `${EXO_UI_NS}GoodBlock`) {
          if (predStr === `${EXO_UI_NS}LayoutBlock_order`) {
            return [createTriple(`${EXO_UI_NS}GoodBlock`, predStr, 1)];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
            return [createTriple(`${EXO_UI_NS}GoodBlock`, predStr, "good-renderer")];
          }
          return [];
        }

        // BadBlock throws error
        if (subjectStr === `${EXO_UI_NS}BadBlock`) {
          throw new Error("Block loading failed");
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      // Should have only the good block, bad block silently fails
      expect(layout!.blocks).toHaveLength(1);
      expect(layout!.blocks[0].uri).toBe(`${EXO_UI_NS}GoodBlock`);
    });

    it("should handle selectLayout when triple store returns undefined", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/undefined-123";

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return []; // No types
        }

        if (subjectStr === `${EXO_UI_NS}DefaultAssetLayout` && predStr === `${RDFS_NS}label`) {
          return [createTriple(`${EXO_UI_NS}DefaultAssetLayout`, `${RDFS_NS}label`, "Default")];
        }

        return [];
      });

      const layout = await selector.selectLayout(assetUri);

      // Should still return DefaultAssetLayout
      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DefaultAssetLayout`);
    });

    it("should handle RDF list with circular reference", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}CircularListLayout`;
      const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = getSubjectString(subject as Subject);
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Circular Layout")];
        }

        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, "_:circular1")];
        }

        // Circular reference: _:circular1 -> _:circular2 -> _:circular1
        if (subjectStr === "_:circular1") {
          if (predStr === `${RDF_NS}first`) {
            return [createTriple("_:circular1", `${RDF_NS}first`, `${EXO_UI_NS}Block1`)];
          }
          if (predStr === `${RDF_NS}rest`) {
            return [createTriple("_:circular1", `${RDF_NS}rest`, "_:circular2")];
          }
        }

        if (subjectStr === "_:circular2") {
          if (predStr === `${RDF_NS}first`) {
            return [createTriple("_:circular2", `${RDF_NS}first`, `${EXO_UI_NS}Block2`)];
          }
          if (predStr === `${RDF_NS}rest`) {
            return [createTriple("_:circular2", `${RDF_NS}rest`, "_:circular1")]; // Circular!
          }
        }

        // Block properties
        if (subjectStr === `${EXO_UI_NS}Block1` && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(`${EXO_UI_NS}Block1`, predStr, 1)];
        }
        if (subjectStr === `${EXO_UI_NS}Block2` && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(`${EXO_UI_NS}Block2`, predStr, 2)];
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      // Should handle circular reference without infinite loop
      expect(layout).toBeDefined();
      expect(layout!.blocks.length).toBeLessThanOrEqual(2);
    });
  });

  describe("loadLayout() method", () => {
    const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
    const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
    const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

    it("should load layout with blocks in correct order", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}DefaultAssetLayout`;

      // Mock layout definition with blocks
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Layout label
        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Default Asset Layout")];
        }

        // Layout blocks (RDF list - simplified)
        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}IdentityBlock`),
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}ClassificationBlock`),
          ];
        }

        // Block 1 properties
        if (subjectStr === `${EXO_UI_NS}IdentityBlock`) {
          if (predStr === `${EXO_UI_NS}LayoutBlock_order`) {
            return [createTriple(`${EXO_UI_NS}IdentityBlock`, predStr, 1)];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_query`) {
            return [createTriple(`${EXO_UI_NS}IdentityBlock`, predStr, "SELECT ?label WHERE { ?asset rdfs:label ?label }")];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
            return [createTriple(`${EXO_UI_NS}IdentityBlock`, predStr, "identity")];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_headless`) {
            return [createTriple(`${EXO_UI_NS}IdentityBlock`, predStr, true)];
          }
        }

        // Block 2 properties
        if (subjectStr === `${EXO_UI_NS}ClassificationBlock`) {
          if (predStr === `${EXO_UI_NS}LayoutBlock_order`) {
            return [createTriple(`${EXO_UI_NS}ClassificationBlock`, predStr, 2)];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_query`) {
            return [createTriple(`${EXO_UI_NS}ClassificationBlock`, predStr, "SELECT ?class WHERE { ?asset rdf:type ?class }")];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
            return [createTriple(`${EXO_UI_NS}ClassificationBlock`, predStr, "classification")];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_headless`) {
            return [createTriple(`${EXO_UI_NS}ClassificationBlock`, predStr, false)];
          }
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(layoutUri);
      expect(layout!.label).toBe("Default Asset Layout");
      expect(layout!.blocks).toHaveLength(2);

      // Verify blocks are ordered correctly
      expect(layout!.blocks[0].order).toBe(1);
      expect(layout!.blocks[0].renderer).toBe("identity");
      expect(layout!.blocks[1].order).toBe(2);
      expect(layout!.blocks[1].renderer).toBe("classification");
    });

    it("should correctly traverse RDF list for blocks", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}TestLayout`;

      // RDF list structure: layoutUri -> _:list1 -> _:list2 -> rdf:nil
      // This tests rdf:rest*/rdf:first property path
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = getSubjectString(subject as Subject);
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Layout label
        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Test Layout")];
        }

        // Layout_blocks points to head of RDF list
        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, "_:list1")];
        }

        // RDF list node 1: first = Block1, rest = _:list2
        if (subjectStr === "_:list1") {
          if (predStr === `${RDF_NS}first`) {
            return [createTriple("_:list1", `${RDF_NS}first`, `${EXO_UI_NS}Block1`)];
          }
          if (predStr === `${RDF_NS}rest`) {
            return [createTriple("_:list1", `${RDF_NS}rest`, "_:list2")];
          }
        }

        // RDF list node 2: first = Block2, rest = rdf:nil
        if (subjectStr === "_:list2") {
          if (predStr === `${RDF_NS}first`) {
            return [createTriple("_:list2", `${RDF_NS}first`, `${EXO_UI_NS}Block2`)];
          }
          if (predStr === `${RDF_NS}rest`) {
            return [createTriple("_:list2", `${RDF_NS}rest`, `${RDF_NS}nil`)];
          }
        }

        // Block properties
        if (subjectStr === `${EXO_UI_NS}Block1`) {
          if (predStr === `${EXO_UI_NS}LayoutBlock_order`) {
            return [createTriple(`${EXO_UI_NS}Block1`, predStr, 1)];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
            return [createTriple(`${EXO_UI_NS}Block1`, predStr, "block1-renderer")];
          }
        }

        if (subjectStr === `${EXO_UI_NS}Block2`) {
          if (predStr === `${EXO_UI_NS}LayoutBlock_order`) {
            return [createTriple(`${EXO_UI_NS}Block2`, predStr, 2)];
          }
          if (predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
            return [createTriple(`${EXO_UI_NS}Block2`, predStr, "block2-renderer")];
          }
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      expect(layout!.blocks).toHaveLength(2);
      expect(layout!.blocks[0].renderer).toBe("block1-renderer");
      expect(layout!.blocks[1].renderer).toBe("block2-renderer");
    });

    it("should return blocks sorted by order", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}OrderTestLayout`;

      // Blocks returned in wrong order - should be sorted by LayoutBlock_order
      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Order Test")];
        }

        // Blocks in reverse order
        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}Block3`),
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}Block1`),
            createTriple(layoutUri, `${EXO_UI_NS}Layout_blocks`, `${EXO_UI_NS}Block2`),
          ];
        }

        // Block orders
        if (subjectStr === `${EXO_UI_NS}Block1` && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(`${EXO_UI_NS}Block1`, predStr, 1)];
        }
        if (subjectStr === `${EXO_UI_NS}Block2` && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(`${EXO_UI_NS}Block2`, predStr, 2)];
        }
        if (subjectStr === `${EXO_UI_NS}Block3` && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(`${EXO_UI_NS}Block3`, predStr, 3)];
        }

        return [];
      });

      const layout = await selector.loadLayout(layoutUri);

      expect(layout).toBeDefined();
      expect(layout!.blocks).toHaveLength(3);
      expect(layout!.blocks[0].uri).toContain("Block1");
      expect(layout!.blocks[0].order).toBe(1);
      expect(layout!.blocks[1].uri).toContain("Block2");
      expect(layout!.blocks[1].order).toBe(2);
      expect(layout!.blocks[2].uri).toContain("Block3");
      expect(layout!.blocks[2].order).toBe(3);
    });
  });

  describe("caching behavior", () => {
    const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
    const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";

    it("should cache loaded layouts", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}CachedLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Cached Layout")];
        }
        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [];
        }
        return [];
      });

      // First call - loads from triple store
      const layout1 = await selector.loadLayout(layoutUri);
      const matchCallCount1 = mockTripleStore.match.mock.calls.length;

      // Second call - should use cache
      const layout2 = await selector.loadLayout(layoutUri);
      const matchCallCount2 = mockTripleStore.match.mock.calls.length;

      expect(layout1).toBeDefined();
      expect(layout2).toBeDefined();
      expect(layout1).toEqual(layout2);
      // No additional calls to triple store
      expect(matchCallCount2).toBe(matchCallCount1);
    });

    it("should allow clearing the cache", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const layoutUri = `${EXO_UI_NS}ClearableLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        if (subjectStr === layoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(layoutUri, `${RDFS_NS}label`, "Clearable Layout")];
        }
        if (subjectStr === layoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [];
        }
        return [];
      });

      // First call
      await selector.loadLayout(layoutUri);
      const matchCallCount1 = mockTripleStore.match.mock.calls.length;

      // Clear cache
      selector.clearCache();

      // Second call - should query again
      await selector.loadLayout(layoutUri);
      const matchCallCount2 = mockTripleStore.match.mock.calls.length;

      // Should have made more calls after cache clear
      expect(matchCallCount2).toBeGreaterThan(matchCallCount1);
    });
  });
});
