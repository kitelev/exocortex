import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";
import { ClassDiscoveryService } from "../../../src/application/services/ClassDiscoveryService";

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

  // Helper: mock two sequential SPARQL calls (classQuery, labelQuery)
  function mockTwoQueries(
    mock: jest.Mock,
    classBindings: Map<string, unknown>[],
    labelBindings: Map<string, unknown>[],
  ): void {
    mock.mockResolvedValueOnce(classBindings).mockResolvedValueOnce(labelBindings);
  }

  describe("discoverClasses (Issue #2807 + #2810)", () => {
    it("should use exo:Asset_label to resolve className for UUID file IRIs", async () => {
      mockTwoQueries(
        mockSparqlService.query,
        // classQuery results
        [
          new Map([["class", "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md"]]),
          new Map([["class", "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md"]]),
        ],
        // labelQuery results
        [
          new Map([["class", "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md"], ["label", "ems__Task"]]),
          new Map([["class", "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md"], ["label", "ems__Area"]]),
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

    it("should sort classes alphabetically by display label", async () => {
      mockTwoQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
          new Map([["class", "obsidian://vault/ems/uuid-area.md"]]),
          new Map([["class", "obsidian://vault/ems/uuid-project.md"]]),
        ],
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"], ["label", "ems__Task"]]),
          new Map([["class", "obsidian://vault/ems/uuid-area.md"], ["label", "ems__Area"]]),
          new Map([["class", "obsidian://vault/ems/uuid-project.md"], ["label", "ems__Project"]]),
        ],
      );

      const classes = await service.discoverClasses();

      expect(classes.map((c) => c.label)).toEqual(["Area", "Project", "Task"]);
    });

    it("should handle exo:Asset_label stored as namespace IRI (#2810)", async () => {
      // NoteToRDFConverter stores "ems__Task" as namespace IRI via isClassReference()
      mockTwoQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md"]]),
          new Map([["class", "obsidian://vault/ems/82c74542-1b14-4217-b852-d84730484b25.md"]]),
        ],
        [
          new Map([["class", "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md"], ["label", "https://exocortex.my/ontology/ems#Task"]]),
          new Map([["class", "obsidian://vault/ems/82c74542-1b14-4217-b852-d84730484b25.md"], ["label", "https://exocortex.my/ontology/ems#Area"]]),
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
      mockTwoQueries(
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
      mockTwoQueries(
        mockSparqlService.query,
        [new Map([["class", "https://exocortex.my/ontology/ems#Task"]])],
        [new Map([["class", "https://exocortex.my/ontology/ems#Task"], ["label", "My Task Type"]])],
      );

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Task");
    });

    it("should dedupe duplicate classes emitted by UNION", async () => {
      mockTwoQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
        ],
        [new Map([["class", "obsidian://vault/ems/uuid-task.md"], ["label", "ems__Task"]])],
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
      mockTwoQueries(
        mockSparqlService.query,
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"]]),
          new Map([["class", "obsidian://vault/exo/uuid-class.md"]]),
        ],
        [
          new Map([["class", "obsidian://vault/ems/uuid-task.md"], ["label", "ems__Task"]]),
          new Map([["class", "obsidian://vault/exo/uuid-class.md"], ["label", "exo__Class"]]),
        ],
      );

      const classes = await service.getCreatableClasses();

      expect(classes.map((c) => c.className)).toEqual(["ems__Task"]);
    });
  });
});
