import "reflect-metadata";
import {
  AutocompleteService,
  DEFAULT_AUTOCOMPLETE_CONFIG,
} from "../../src/services/AutocompleteService";
import type { ITripleStore } from "../../src/interfaces/ITripleStore";
import { InMemoryTripleStore } from "../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../src/domain/models/rdf/Triple";
import { IRI } from "../../src/domain/models/rdf/IRI";
import { Literal } from "../../src/domain/models/rdf/Literal";
import { Namespace } from "../../src/domain/models/rdf/Namespace";

describe("AutocompleteService", () => {
  let tripleStore: ITripleStore;
  let autocompleteService: AutocompleteService;

  /**
   * Helper to create asset triples in the store.
   */
  function addAsset(options: {
    uri: string;
    label: string;
    assetClass: string;
    isActive?: boolean;
  }): void {
    const assetIri = new IRI(options.uri);
    const classIri = new IRI(
      `https://exocortex.my/ontology/ems#${options.assetClass.replace("ems__", "")}`
    );

    // Add type triple
    tripleStore.add(new Triple(assetIri, Namespace.RDF.term("type"), classIri));

    // Add label triple
    tripleStore.add(
      new Triple(
        assetIri,
        Namespace.EXO.term("Asset_label"),
        new Literal(options.label)
      )
    );

    // Add status triple if active
    if (options.isActive) {
      tripleStore.add(
        new Triple(
          assetIri,
          Namespace.EMS.term("Effort_status"),
          new IRI("https://exocortex.my/ontology/ems#EffortStatus_Active")
        )
      );
    }
  }

  /**
   * Helper to add property range definition.
   */
  function addPropertyRange(propertyUri: string, rangeClass: string): void {
    const propIri = new IRI(propertyUri);
    const rangeIri = new IRI(rangeClass);

    tripleStore.add(new Triple(propIri, Namespace.RDFS.term("range"), rangeIri));
  }

  beforeEach(() => {
    tripleStore = new InMemoryTripleStore();
    autocompleteService = new AutocompleteService(tripleStore);
  });

  describe("constructor", () => {
    it("should use default config when none provided", () => {
      const service = new AutocompleteService(tripleStore);
      expect(service).toBeDefined();
    });

    it("should merge custom config with defaults", () => {
      const service = new AutocompleteService(tripleStore, { limit: 5 });
      expect(service).toBeDefined();
    });
  });

  describe("getSuggestions", () => {
    beforeEach(() => {
      // Add property range definition
      addPropertyRange(
        "https://exocortex.my/ontology/ems#Effort_project",
        "https://exocortex.my/ontology/ems#Project"
      );

      // Add some projects
      addAsset({
        uri: "obsidian://vault/test/project-1.md",
        label: "Active Project",
        assetClass: "ems__Project",
        isActive: true,
      });
      addAsset({
        uri: "obsidian://vault/test/project-2.md",
        label: "Completed Project",
        assetClass: "ems__Project",
        isActive: false,
      });
      addAsset({
        uri: "obsidian://vault/test/project-3.md",
        label: "My Special Project",
        assetClass: "ems__Project",
        isActive: true,
      });
    });

    it("should return suggestions filtered by property range", async () => {
      const suggestions = await autocompleteService.getSuggestions(
        "ems__Effort_project",
        "proj"
      );

      expect(suggestions.length).toBeGreaterThan(0);
      suggestions.forEach((s) => {
        expect(s.assetClass).toBe("ems__Project");
      });
    });

    it("should return empty array when no matches found", async () => {
      const suggestions = await autocompleteService.getSuggestions(
        "ems__Effort_project",
        "nonexistent"
      );

      expect(suggestions).toEqual([]);
    });

    it("should rank active assets higher", async () => {
      const suggestions = await autocompleteService.getSuggestions(
        "ems__Effort_project",
        "project"
      );

      // Active projects should have higher scores
      const activeScores = suggestions
        .filter((s) => s.isActive)
        .map((s) => s.matchScore);
      const inactiveScores = suggestions
        .filter((s) => !s.isActive)
        .map((s) => s.matchScore);

      if (activeScores.length > 0 && inactiveScores.length > 0) {
        expect(Math.min(...activeScores)).toBeGreaterThan(
          Math.max(...inactiveScores)
        );
      }
    });

    it("should respect limit configuration", async () => {
      // Add more projects to exceed default limit
      for (let i = 4; i <= 15; i++) {
        addAsset({
          uri: `obsidian://vault/test/project-${i}.md`,
          label: `Project ${i}`,
          assetClass: "ems__Project",
        });
      }

      const suggestions = await autocompleteService.getSuggestions(
        "ems__Effort_project",
        "project",
        { limit: 5 }
      );

      expect(suggestions.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getSuggestionsByClass", () => {
    beforeEach(() => {
      addAsset({
        uri: "obsidian://vault/test/area-1.md",
        label: "Personal Area",
        assetClass: "ems__Area",
        isActive: true,
      });
      addAsset({
        uri: "obsidian://vault/test/area-2.md",
        label: "Work Area",
        assetClass: "ems__Area",
      });
      addAsset({
        uri: "obsidian://vault/test/project-1.md",
        label: "Some Project",
        assetClass: "ems__Project",
      });
    });

    it("should filter by specified class", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Area"],
        "area"
      );

      expect(suggestions.length).toBe(2);
      suggestions.forEach((s) => {
        expect(s.assetClass).toBe("ems__Area");
      });
    });

    it("should support multiple classes", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Area", "ems__Project"],
        ""
      );

      const classes = new Set(suggestions.map((s) => s.assetClass));
      expect(classes.has("ems__Area")).toBe(true);
      expect(classes.has("ems__Project")).toBe(true);
    });

    it("should support empty query (show all matching class)", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Area"],
        ""
      );

      expect(suggestions.length).toBe(2);
    });
  });

  describe("fuzzy matching", () => {
    beforeEach(() => {
      addAsset({
        uri: "obsidian://vault/test/task-1.md",
        label: "Написать документацию",
        assetClass: "ems__Task",
      });
      addAsset({
        uri: "obsidian://vault/test/task-2.md",
        label: "Review code changes",
        assetClass: "ems__Task",
      });
    });

    it("should match Russian text with fuzzy search", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Task"],
        "напис"
      );

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].label).toBe("Написать документацию");
    });

    it("should match English text with fuzzy search", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Task"],
        "review"
      );

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].label).toBe("Review code changes");
    });

    it("should perform case-insensitive matching", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Task"],
        "REVIEW"
      );

      expect(suggestions.length).toBe(1);
    });
  });

  describe("scoring", () => {
    beforeEach(() => {
      addAsset({
        uri: "obsidian://vault/test/1.md",
        label: "Test",
        assetClass: "ems__Task",
      });
      addAsset({
        uri: "obsidian://vault/test/2.md",
        label: "Testing",
        assetClass: "ems__Task",
      });
      addAsset({
        uri: "obsidian://vault/test/3.md",
        label: "Unit Test Runner",
        assetClass: "ems__Task",
      });
      addAsset({
        uri: "obsidian://vault/test/4.md",
        label: "Contest",
        assetClass: "ems__Task",
      });
    });

    it("should score exact matches highest", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Task"],
        "test"
      );

      expect(suggestions[0].label).toBe("Test");
    });

    it("should score 'starts with' higher than 'contains'", async () => {
      const suggestions = await autocompleteService.getSuggestionsByClass(
        ["ems__Task"],
        "test"
      );

      // "Testing" starts with "test", "Contest" contains "test"
      const testingIndex = suggestions.findIndex((s) => s.label === "Testing");
      const contestIndex = suggestions.findIndex((s) => s.label === "Contest");

      expect(testingIndex).toBeLessThan(contestIndex);
    });
  });

  describe("DEFAULT_AUTOCOMPLETE_CONFIG", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_AUTOCOMPLETE_CONFIG.limit).toBe(10);
      expect(DEFAULT_AUTOCOMPLETE_CONFIG.activeBoost).toBe(20);
      expect(DEFAULT_AUTOCOMPLETE_CONFIG.recencyBoost).toBe(10);
      expect(DEFAULT_AUTOCOMPLETE_CONFIG.recencyDays).toBe(7);
    });
  });

  describe("property range inference", () => {
    beforeEach(() => {
      addAsset({
        uri: "obsidian://vault/test/project-1.md",
        label: "Inferred Project",
        assetClass: "ems__Project",
      });
    });

    it("should infer ems__Project from property name containing 'project'", async () => {
      // No explicit range defined, should infer from property name
      const suggestions = await autocompleteService.getSuggestions(
        "ems__Effort_project",
        "infer"
      );

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].assetClass).toBe("ems__Project");
    });

    it("should infer ems__Area from property name containing 'area'", async () => {
      addAsset({
        uri: "obsidian://vault/test/area-1.md",
        label: "Test Area",
        assetClass: "ems__Area",
      });

      const suggestions = await autocompleteService.getSuggestions(
        "ems__Task_area",
        "test"
      );

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].assetClass).toBe("ems__Area");
    });
  });
});
