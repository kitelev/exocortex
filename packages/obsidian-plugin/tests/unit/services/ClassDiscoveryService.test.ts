import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import { ClassDiscoveryService } from "../../../src/application/services/ClassDiscoveryService";
import { DomainLiteral as Literal } from "exocortex";

jest.mock("../../../src/application/services/SPARQLQueryService");

describe("ClassDiscoveryService", () => {
  let mockSparqlService: jest.Mocked<SPARQLQueryService>;
  let service: ClassDiscoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSparqlService = {
      query: jest.fn(),
    } as unknown as jest.Mocked<SPARQLQueryService>;
    service = new ClassDiscoveryService(mockSparqlService);
  });

  // Helper: mock the three sequential SPARQL calls discoverClasses fires in
  // Promise.all order — classQuery, labelQuery, uidQuery (#3384 H3 PR2 added
  // the uid query). uidBindings defaults to [] so pre-existing tests that don't
  // assert classUid keep working (→ classUid undefined → label-form fallback).
  function mockDiscoveryQueries(
    mock: jest.Mock,
    classBindings: Map<string, unknown>[],
    labelBindings: Map<string, unknown>[],
    uidBindings: Map<string, unknown>[] = [],
  ): void {
    mock
      .mockResolvedValueOnce(classBindings)
      .mockResolvedValueOnce(labelBindings)
      .mockResolvedValueOnce(uidBindings);
  }

  describe("discoverClasses (Issue #2807 + #2810)", () => {
    it("should use exo:Asset_label to resolve className for UUID file IRIs", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        // classQuery results
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md",
            ],
          ]),
        ],
        // labelQuery results
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
            ["label", "ems__Task"],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md",
            ],
            ["label", "ems__Area"],
          ]),
        ],
      );

      const classes = await service.discoverClasses();

      const taskClass = classes.find((c) => c.className === "ems__Task");
      const areaClass = classes.find((c) => c.className === "ems__Area");

      expect(taskClass).toBeDefined();
      expect(taskClass!.label).toBe("Task");
      expect(taskClass!.canCreateInstance).toBe(true);

      expect(areaClass).toBeDefined();
      expect(areaClass!.label).toBe("Area");
    });

    // #3384 H3 PR2 — the uid query populates DiscoveredClass.classUid so the
    // Create-asset flow can emit `exo__Instance_class: [[<uuid>]]` strip-canon.
    it("should populate classUid from the uid query, joined by class IRI", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md",
            ],
          ]),
        ],
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
            ["label", "ems__Task"],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md",
            ],
            ["label", "ems__Area"],
          ]),
        ],
        // uidQuery results — the uid binding is a production-shaped RDF Literal,
        // NOT a bare string. Literal.toString() serializes to the quoted
        // N-Triples form (`"<uid>"`), so this fixture is what guards against the
        // class ref being corrupted to `[[\"<uid>\"]]` — discoverClasses must
        // read the lexical `.value`, not `.toString()`.
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
            ["uid", new Literal("1b20a8f0-d745-4e93-91db-4531b3df120e")],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md",
            ],
            ["uid", new Literal("7138261c-f964-4f10-a44e-cb153f14c217")],
          ]),
        ],
      );

      const classes = await service.discoverClasses();

      // Must be the bare uuid (no surrounding quotes from Literal.toString()).
      expect(classes.find((c) => c.className === "ems__Task")!.classUid).toBe(
        "1b20a8f0-d745-4e93-91db-4531b3df120e",
      );
      expect(classes.find((c) => c.className === "ems__Area")!.classUid).toBe(
        "7138261c-f964-4f10-a44e-cb153f14c217",
      );
    });

    it("should leave classUid undefined when the uid query has no matching binding", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
          ]),
        ],
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
            ["label", "ems__Task"],
          ]),
        ],
        [], // no uid bindings → fall back to label form downstream
      );

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].classUid).toBeUndefined();
    });

    it("should sort classes alphabetically by display label", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
          new Map([["class", "obsidian://vault/ems/uuid-area.md"]]),
          new Map([["class", "obsidian://vault/ems/uuid-project.md"]]),
        ],
        [
          new Map([
            ["class", "obsidian://vault/ems/uuid-task.md"],
            ["label", "ems__Task"],
          ]),
          new Map([
            ["class", "obsidian://vault/ems/uuid-area.md"],
            ["label", "ems__Area"],
          ]),
          new Map([
            ["class", "obsidian://vault/ems/uuid-project.md"],
            ["label", "ems__Project"],
          ]),
        ],
      );

      const classes = await service.discoverClasses();

      expect(classes.map((c) => c.label)).toEqual(["Area", "Project", "Task"]);
    });

    it("should handle exo:Asset_label stored as namespace IRI (#2810)", async () => {
      // NoteToRDFConverter stores "ems__Task" as namespace IRI via isClassReference()
      mockDiscoveryQueries(
        mockSparqlService.query,
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/82c74542-1b14-4217-b852-d84730484b25.md",
            ],
          ]),
        ],
        [
          new Map([
            [
              "class",
              "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md",
            ],
            ["label", "https://exocortex.my/ontology/ems#Task"],
          ]),
          new Map([
            [
              "class",
              "obsidian://vault/ems/82c74542-1b14-4217-b852-d84730484b25.md",
            ],
            ["label", "https://exocortex.my/ontology/ems#Area"],
          ]),
        ],
      );

      const classes = await service.discoverClasses();

      const taskClass = classes.find((c) => c.className === "ems__Task");
      const areaClass = classes.find((c) => c.className === "ems__Area");

      expect(taskClass).toBeDefined();
      expect(taskClass!.label).toBe("Task");
      expect(areaClass).toBeDefined();
      expect(areaClass!.label).toBe("Area");
    });

    it("should fall back to toClassName when no label exists", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [new Map([["class", "https://exocortex.my/ontology/ems#Task"]])],
        [], // no labels
      );

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Task");
      expect(classes[0].label).toBe("Task");
    });

    it("should ignore a label value that is not a prefixed class name", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [new Map([["class", "https://exocortex.my/ontology/ems#Task"]])],
        [
          new Map([
            ["class", "https://exocortex.my/ontology/ems#Task"],
            ["label", "My Task Type"],
          ]),
        ],
      );

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Task");
    });

    it("should dedupe duplicate classes emitted by UNION", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
        ],
        [
          new Map([
            ["class", "obsidian://vault/ems/uuid-task.md"],
            ["label", "ems__Task"],
          ]),
        ],
      );

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
    });

    it("should return defaults when SPARQL query throws", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("boom"));

      const classes = await service.discoverClasses();

      expect(classes.length).toBeGreaterThan(0);
      expect(classes.map((c) => c.className)).toContain("ems__Task");
    });
  });

  describe("getCreatableClasses", () => {
    it("should exclude non-instantiable meta-classes", async () => {
      mockDiscoveryQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
          new Map([["class", "obsidian://vault/exo/uuid-class.md"]]),
        ],
        [
          new Map([
            ["class", "obsidian://vault/ems/uuid-task.md"],
            ["label", "ems__Task"],
          ]),
          new Map([
            ["class", "obsidian://vault/exo/uuid-class.md"],
            ["label", "exo__Class"],
          ]),
        ],
      );

      const classes = await service.getCreatableClasses();

      expect(classes.map((c) => c.className)).toEqual(["ems__Task"]);
    });
  });
});
