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

  describe("discoverClasses (Issue #2807)", () => {
    it("should use frontmatter label as className when ?class is a UUID file IRI", async () => {
      // Starter-kit reality: class-def files are UUID-named, so SPARQL returns
      // a file IRI for ?class. The label comes from exo__Asset_label (now also
      // emitted as rdfs:label). The service must prefer the prefixed label
      // over the file IRI for className.
      const taskClassBinding = new Map<string, unknown>([
        ["class", "obsidian://vault/ems/1b20a8f0-d745-4e93-91db-4531b3df120e.md"],
        ["label", "ems__Task"],
      ]);
      const areaClassBinding = new Map<string, unknown>([
        ["class", "obsidian://vault/ems/7138261c-f964-4f10-a44e-cb153f14c217.md"],
        ["label", "ems__Area"],
      ]);

      mockSparqlService.query.mockResolvedValue([taskClassBinding, areaClassBinding]);

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
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-task.md"],
          ["label", "ems__Task"],
        ]),
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-area.md"],
          ["label", "ems__Area"],
        ]),
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-project.md"],
          ["label", "ems__Project"],
        ]),
      ]);

      const classes = await service.discoverClasses();

      expect(classes.map((c) => c.label)).toEqual(["Area", "Project", "Task"]);
    });

    it("should fall back to toClassName when label is absent", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["class", "https://exocortex.my/ontology/ems#Task"],
        ]),
      ]);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Task");
      expect(classes[0].label).toBe("Task");
    });

    it("should filter out deprecated classes", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-task.md"],
          ["label", "ems__Task"],
          ["deprecated", "false"],
        ]),
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-old.md"],
          ["label", "ems__Deprecated"],
          ["deprecated", "true"],
        ]),
      ]);

      const classes = await service.discoverClasses();

      expect(classes.map((c) => c.className)).toEqual(["ems__Task"]);
    });

    it("should ignore a label value that is not a prefixed class name", async () => {
      // Defensive: if someone labels a class with free text like "My Task Type",
      // that is NOT a valid className, so we must fall back to the IRI path.
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["class", "https://exocortex.my/ontology/ems#Task"],
          ["label", "My Task Type"],
        ]),
      ]);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Task");
    });

    it("should dedupe duplicate classes emitted by UNION", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-task.md"],
          ["label", "ems__Task"],
        ]),
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-task.md"],
          ["label", "ems__Task"],
        ]),
      ]);

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
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["class", "obsidian://vault/ems/uuid-task.md"],
          ["label", "ems__Task"],
        ]),
        new Map<string, unknown>([
          ["class", "obsidian://vault/exo/uuid-class.md"],
          ["label", "exo__Class"],
        ]),
      ]);

      const classes = await service.getCreatableClasses();

      expect(classes.map((c) => c.className)).toEqual(["ems__Task"]);
    });
  });
});
