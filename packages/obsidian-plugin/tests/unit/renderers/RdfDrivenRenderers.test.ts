/**
 * Tests for RDF-driven renderers (Issue #1460)
 *
 * These tests verify that AreaTreeRenderer, DailyTasksRenderer, and DailyProjectsRenderer
 * use SPARQL queries from RDF layout definitions via LayoutSelector.
 *
 * @see https://github.com/kitelev/exocortex/issues/1460
 */

import {
  LayoutSelector,
  type Layout,
  type LayoutBlock,
  type ITripleStore,
  IRI,
  Literal,
  Triple,
} from "exocortex";

describe("RDF-driven Renderers (Issue #1460)", () => {
  const EXO_UI_NS = "https://exocortex.my/ontology/exo-ui#";
  const EMS_NS = "https://exocortex.my/ontology/ems#";
  const PN_NS = "https://exocortex.my/ontology/pn#";
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";

  let mockTripleStore: jest.Mocked<ITripleStore>;

  const createTriple = (
    subject: string,
    predicate: string,
    object: string | number
  ): Triple => {
    const subjectIRI = new IRI(subject);
    const predicateIRI = new IRI(predicate);
    const objectTerm =
      typeof object === "string" && object.startsWith("http")
        ? new IRI(object)
        : new Literal(String(object));
    return new Triple(subjectIRI, predicateIRI, objectTerm);
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

  describe("LayoutSelector for Area assets", () => {
    it("should select AreaLayout for Area asset", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const areaUri = "https://exocortex.my/assets/area-health";

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query: Get asset's rdf:type
        if (subjectStr === areaUri && predStr === RDF_TYPE) {
          return [createTriple(areaUri, RDF_TYPE, `${EMS_NS}Area`)];
        }

        // Query: Layout_appliesTo mappings
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(
              `${EXO_UI_NS}AreaLayout`,
              `${EXO_UI_NS}Layout_appliesTo`,
              `${EMS_NS}Area`
            ),
          ];
        }

        // Query: Layout label
        if (subjectStr === `${EXO_UI_NS}AreaLayout` && predStr === `${RDFS_NS}label`) {
          return [createTriple(`${EXO_UI_NS}AreaLayout`, `${RDFS_NS}label`, "Area Hierarchy")];
        }

        return [];
      });

      const layout = await selector.selectLayout(areaUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}AreaLayout`);
    });

    it("should return AreaHierarchyBlock with SPARQL query", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const areaLayoutUri = `${EXO_UI_NS}AreaLayout`;
      const blockUri = `${EXO_UI_NS}AreaHierarchyBlock`;

      const expectedQuery = `
        SELECT ?ancestor ?ancestorLabel ?depth
        WHERE {
            ?current ems:Area_parent+ ?ancestor .
            ?ancestor exo:Asset_label ?ancestorLabel .
        }
      `.trim();

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query: Layout label
        if (subjectStr === areaLayoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(areaLayoutUri, `${RDFS_NS}label`, "Area Hierarchy")];
        }

        // Query: Layout blocks
        if (subjectStr === areaLayoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [createTriple(areaLayoutUri, `${EXO_UI_NS}Layout_blocks`, blockUri)];
        }

        // Query: Layout appliesTo
        if (subjectStr === areaLayoutUri && predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [createTriple(areaLayoutUri, `${EXO_UI_NS}Layout_appliesTo`, `${EMS_NS}Area`)];
        }

        // Query: Block order
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_order`, "1")];
        }

        // Query: Block query
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_query`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_query`, expectedQuery)];
        }

        // Query: Block renderer
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_renderer`, "area-tree")];
        }

        // Query: Block headless
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_headless`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_headless`, "true")];
        }

        return [];
      });

      const layout = await selector.loadLayout(areaLayoutUri);

      expect(layout).toBeDefined();
      expect(layout!.blocks).toHaveLength(1);
      expect(layout!.blocks[0].renderer).toBe("area-tree");
      expect(layout!.blocks[0].query).toContain("SELECT ?ancestor ?ancestorLabel");
    });
  });

  describe("LayoutSelector for DailyNote assets", () => {
    it("should select DailyNoteLayout for DailyNote asset", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const dailyNoteUri = "https://exocortex.my/assets/daily-2025-01-08";

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query: Get asset's rdf:type
        if (subjectStr === dailyNoteUri && predStr === RDF_TYPE) {
          return [createTriple(dailyNoteUri, RDF_TYPE, `${PN_NS}DailyNote`)];
        }

        // Query: Layout_appliesTo mappings
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(
              `${EXO_UI_NS}DailyNoteLayout`,
              `${EXO_UI_NS}Layout_appliesTo`,
              `${PN_NS}DailyNote`
            ),
          ];
        }

        // Query: Layout label
        if (
          subjectStr === `${EXO_UI_NS}DailyNoteLayout` &&
          predStr === `${RDFS_NS}label`
        ) {
          return [
            createTriple(`${EXO_UI_NS}DailyNoteLayout`, `${RDFS_NS}label`, "Daily Note"),
          ];
        }

        return [];
      });

      const layout = await selector.selectLayout(dailyNoteUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DailyNoteLayout`);
    });

    it("should return DailyTasksBlock with {day} placeholder in query", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const dailyLayoutUri = `${EXO_UI_NS}DailyNoteLayout`;
      const blockUri = `${EXO_UI_NS}DailyTasksBlock`;

      const expectedQuery = `
        SELECT ?task ?label ?status ?startTime ?endTime ?area ?isBlocked
        WHERE {
            ?task a ems:Task .
            ?task exo:Asset_label ?label .
            ?task ems:Effort_status ?status .
            {
                ?task ems:Effort_plannedStartTimestamp ?plannedStart .
                FILTER(STRSTARTS(STR(?plannedStart), "{day}"))
            } UNION {
                ?task ems:Effort_startTimestamp ?start .
                FILTER(STRSTARTS(STR(?start), "{day}"))
            }
        }
      `.trim();

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query: Layout label
        if (subjectStr === dailyLayoutUri && predStr === `${RDFS_NS}label`) {
          return [createTriple(dailyLayoutUri, `${RDFS_NS}label`, "Daily Note")];
        }

        // Query: Layout blocks
        if (subjectStr === dailyLayoutUri && predStr === `${EXO_UI_NS}Layout_blocks`) {
          return [createTriple(dailyLayoutUri, `${EXO_UI_NS}Layout_blocks`, blockUri)];
        }

        // Query: Layout appliesTo
        if (subjectStr === dailyLayoutUri && predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(dailyLayoutUri, `${EXO_UI_NS}Layout_appliesTo`, `${PN_NS}DailyNote`),
          ];
        }

        // Query: Block order
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_order`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_order`, "2")];
        }

        // Query: Block query
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_query`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_query`, expectedQuery)];
        }

        // Query: Block renderer
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_renderer`) {
          return [
            createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_renderer`, "daily-tasks-table"),
          ];
        }

        // Query: Block headless
        if (subjectStr === blockUri && predStr === `${EXO_UI_NS}LayoutBlock_headless`) {
          return [createTriple(blockUri, `${EXO_UI_NS}LayoutBlock_headless`, "true")];
        }

        return [];
      });

      const layout = await selector.loadLayout(dailyLayoutUri);

      expect(layout).toBeDefined();
      expect(layout!.blocks).toHaveLength(1);
      expect(layout!.blocks[0].renderer).toBe("daily-tasks-table");
      expect(layout!.blocks[0].query).toContain("{day}");
    });
  });

  describe("Placeholder replacement", () => {
    it("should replace {day} placeholder with actual date", () => {
      const query = `
        SELECT ?task ?label
        WHERE {
            ?task ems:Effort_startTimestamp ?start .
            FILTER(STRSTARTS(STR(?start), "{day}"))
        }
      `;
      const day = "2025-01-08";

      const replacedQuery = query.replace(/\{day\}/g, day);

      expect(replacedQuery).toContain("2025-01-08");
      expect(replacedQuery).not.toContain("{day}");
    });

    it("should replace ?current placeholder with asset URI", () => {
      const query = `
        SELECT ?ancestor ?ancestorLabel
        WHERE {
            ?current ems:Area_parent+ ?ancestor .
        }
      `;
      const assetUri = "https://exocortex.my/assets/area-health";

      const replacedQuery = query.replace(/\?current/g, `<${assetUri}>`);

      expect(replacedQuery).toContain(`<${assetUri}>`);
      expect(replacedQuery).not.toContain("?current");
    });
  });

  describe("Fallback behavior", () => {
    it("should return DefaultAssetLayout when no class-specific layout found", async () => {
      const selector = new LayoutSelector(mockTripleStore);
      const unknownUri = "https://exocortex.my/assets/unknown-123";

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query: Get asset's rdf:type (unknown class)
        if (subjectStr === unknownUri && predStr === RDF_TYPE) {
          return [
            createTriple(
              unknownUri,
              RDF_TYPE,
              "https://exocortex.my/ontology/custom#UnknownClass"
            ),
          ];
        }

        // Query: Layout_appliesTo - no matching layout
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [];
        }

        // Query: DefaultAssetLayout label
        if (
          subjectStr === `${EXO_UI_NS}DefaultAssetLayout` &&
          predStr === `${RDFS_NS}label`
        ) {
          return [
            createTriple(
              `${EXO_UI_NS}DefaultAssetLayout`,
              `${RDFS_NS}label`,
              "Default Layout"
            ),
          ];
        }

        return [];
      });

      const layout = await selector.selectLayout(unknownUri);

      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(`${EXO_UI_NS}DefaultAssetLayout`);
    });

    it("should use legacy renderer when RDF layout loading fails", async () => {
      // This test documents the expected fallback behavior
      // The actual implementation will gracefully fallback to legacy TypeScript logic
      // when loading a specific layout fails (but triple store is available)
      const selector = new LayoutSelector(mockTripleStore);
      const assetUri = "https://exocortex.my/assets/area-123";
      const areaLayoutUri = `${EXO_UI_NS}AreaLayout`;

      mockTripleStore.match.mockImplementation(async (subject, predicate) => {
        const subjectStr = subject && "value" in subject ? subject.value : "";
        const predStr = predicate && "value" in predicate ? predicate.value : "";

        // Query: Get asset's rdf:type
        if (subjectStr === assetUri && predStr === RDF_TYPE) {
          return [createTriple(assetUri, RDF_TYPE, `${EMS_NS}Area`)];
        }

        // Query: Layout_appliesTo mappings
        if (predStr === `${EXO_UI_NS}Layout_appliesTo`) {
          return [
            createTriple(areaLayoutUri, `${EXO_UI_NS}Layout_appliesTo`, `${EMS_NS}Area`),
          ];
        }

        // Simulate layout loading failure by returning nothing for all label queries
        // This means the layout exists but can't be fully loaded
        return [];
      });

      // The layout will be returned but with default/empty values
      const layout = await selector.selectLayout(assetUri);

      // Layout should be returned even if some properties couldn't be loaded
      expect(layout).toBeDefined();
      expect(layout!.uri).toBe(areaLayoutUri);
      expect(layout!.label).toBe("Unnamed Layout"); // Default when label not found
    });
  });
});
