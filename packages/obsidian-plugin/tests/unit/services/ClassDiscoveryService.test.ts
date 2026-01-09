import { ClassDiscoveryService, DiscoveredClass } from "../../../src/application/services/ClassDiscoveryService";
import { SPARQLQueryService } from "../../../src/application/services/SPARQLQueryService";

// Mock LoggerFactory
jest.mock("@plugin/adapters/logging/LoggerFactory", () => ({
  LoggerFactory: {
    create: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("ClassDiscoveryService", () => {
  let service: ClassDiscoveryService;
  let mockSparqlService: jest.Mocked<SPARQLQueryService>;

  beforeEach(() => {
    mockSparqlService = {
      query: jest.fn(),
    } as unknown as jest.Mocked<SPARQLQueryService>;

    service = new ClassDiscoveryService(mockSparqlService);
  });

  describe("discoverClasses", () => {
    it("should return discovered classes from SPARQL query results", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Task"],
          ["label", "Task"],
          ["comment", "A unit of work"],
          ["deprecated", "false"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Project"],
          ["label", "Project"],
          ["comment", "A collection of tasks"],
          ["deprecated", "false"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(2);
      expect(classes[0].className).toBe("ems__Project"); // Sorted alphabetically
      expect(classes[0].label).toBe("Project");
      expect(classes[1].className).toBe("ems__Task");
      expect(classes[1].label).toBe("Task");
    });

    it("should filter out deprecated classes", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#ActiveClass"],
          ["label", "Active"],
          ["deprecated", "false"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#DeprecatedClass"],
          ["label", "Deprecated"],
          ["deprecated", "true"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__ActiveClass");
    });

    it("should skip duplicate classes from UNION query", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Task"],
          ["label", "Task"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Task"], // Duplicate
          ["label", "Task"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
    });

    it("should handle missing label by extracting from class name", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#TaskPrototype"],
          // No label provided
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].label).toBe("Task Prototype"); // Extracted and formatted
    });

    it("should handle superClass relationships", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Task"],
          ["label", "Task"],
          ["superClass", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].superClass).toBe("exo__Asset");
    });

    it("should skip results without class URI", async () => {
      const mockResults = [
        new Map([
          ["label", "Orphan Label"], // No class field
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Valid"],
          ["label", "Valid"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Valid");
    });

    it("should return default classes on SPARQL query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("SPARQL error"));

      const classes = await service.discoverClasses();

      expect(classes.length).toBeGreaterThan(0);
      expect(classes.some(c => c.className === "ems__Task")).toBe(true);
      expect(classes.some(c => c.className === "ems__Project")).toBe(true);
      expect(classes.some(c => c.className === "ems__Area")).toBe(true);
    });

    it("should sort classes alphabetically by label", async () => {
      const mockResults = [
        new Map([["class", "https://exocortex.my/ontology/ems#Zebra"], ["label", "Zebra"]]),
        new Map([["class", "https://exocortex.my/ontology/ems#Alpha"], ["label", "Alpha"]]),
        new Map([["class", "https://exocortex.my/ontology/ems#Middle"], ["label", "Middle"]]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes[0].label).toBe("Alpha");
      expect(classes[1].label).toBe("Middle");
      expect(classes[2].label).toBe("Zebra");
    });

    it("should handle prefixed class names that are already converted", async () => {
      const mockResults = [
        new Map([
          ["class", "ems__PreConvertedClass"],
          ["label", "Pre Converted"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__PreConvertedClass");
    });

    it("should handle URIs with hash fragments", async () => {
      const mockResults = [
        new Map([
          ["class", "http://example.org/ontology#SomeClass"],
          ["label", "Some Class"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("SomeClass");
    });

    it("should handle URIs with slash fragments", async () => {
      const mockResults = [
        new Map([
          ["class", "http://example.org/ontology/AnotherClass"],
          ["label", "Another Class"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("AnotherClass");
    });
  });

  describe("getCreatableClasses", () => {
    it("should filter classes that can create instances", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Task"],
          ["label", "Task"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/exo#Class"], // Meta-class
          ["label", "Class"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/pn#DailyNote"], // Special creation flow
          ["label", "Daily Note"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.getCreatableClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].className).toBe("ems__Task");
    });
  });

  describe("getDefaultClasses", () => {
    it("should return a list of default classes", () => {
      const defaults = service.getDefaultClasses();

      expect(defaults).toHaveLength(6);
      expect(defaults.map(c => c.className)).toEqual([
        "ems__Task",
        "ems__Project",
        "ems__Area",
        "ems__Meeting",
        "exo__Event",
        "ims__Concept",
      ]);
    });

    it("should return classes with proper structure", () => {
      const defaults = service.getDefaultClasses();

      for (const cls of defaults) {
        expect(cls).toHaveProperty("className");
        expect(cls).toHaveProperty("label");
        expect(cls).toHaveProperty("description");
        expect(cls).toHaveProperty("deprecated");
        expect(cls).toHaveProperty("canCreateInstance");
        expect(cls.deprecated).toBe(false);
        expect(cls.canCreateInstance).toBe(true);
      }
    });
  });

  describe("canCreateInstance (via discovered classes)", () => {
    it("should mark meta-classes as non-instantiable", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/exo#Class"],
          ["label", "Class"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].canCreateInstance).toBe(false);
    });

    it("should mark system event classes as non-instantiable", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#SessionStartEvent"],
          ["label", "Session Start"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#SessionEndEvent"],
          ["label", "Session End"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(2);
      expect(classes.every(c => c.canCreateInstance === false)).toBe(true);
    });

    it("should mark DailyNote as non-instantiable (special creation flow)", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/pn#DailyNote"],
          ["label", "Daily Note"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0].canCreateInstance).toBe(false);
    });

    it("should mark Prototype classes as instantiable", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#TaskPrototype"],
          ["label", "Task Prototype"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#MeetingPrototype"],
          ["label", "Meeting Prototype"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(2);
      expect(classes.every(c => c.canCreateInstance === true)).toBe(true);
    });

    it("should mark regular classes as instantiable", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Task"],
          ["label", "Task"],
        ]),
        new Map([
          ["class", "https://exocortex.my/ontology/ems#Project"],
          ["label", "Project"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(2);
      expect(classes.every(c => c.canCreateInstance === true)).toBe(true);
    });
  });

  describe("extractLabel (via discovered classes)", () => {
    it("should convert camelCase to spaces", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#TaskPrototype"],
          // No label - will use extracted label
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes[0].label).toBe("Task Prototype");
    });

    it("should remove prefix and capitalize", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/exo#lowercaseStart"],
          // No label
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes[0].label).toBe("Lowercase Start");
    });
  });

  describe("edge cases", () => {
    it("should handle empty SPARQL results", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(0);
    });

    it("should handle classes with all optional fields", async () => {
      const mockResults = [
        new Map([
          ["class", "https://exocortex.my/ontology/ems#FullClass"],
          ["label", "Full Class"],
          ["comment", "A fully documented class"],
          ["superClass", "https://exocortex.my/ontology/exo#BaseClass"],
          ["deprecated", "false"],
        ]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(1);
      expect(classes[0]).toEqual({
        className: "ems__FullClass",
        label: "Full Class",
        description: "A fully documented class",
        superClass: "exo__BaseClass",
        deprecated: false,
        canCreateInstance: true,
      });
    });

    it("should handle different ontology prefixes", async () => {
      const mockResults = [
        new Map([["class", "ems__EmsClass"], ["label", "EMS"]]),
        new Map([["class", "exo__ExoClass"], ["label", "EXO"]]),
        new Map([["class", "ims__ImsClass"], ["label", "IMS"]]),
        new Map([["class", "pn__PnClass"], ["label", "PN"]]),
      ];

      mockSparqlService.query.mockResolvedValue(mockResults);

      const classes = await service.discoverClasses();

      expect(classes).toHaveLength(4);
      expect(classes.map(c => c.className)).toContain("ems__EmsClass");
      expect(classes.map(c => c.className)).toContain("exo__ExoClass");
      expect(classes.map(c => c.className)).toContain("ims__ImsClass");
      expect(classes.map(c => c.className)).toContain("pn__PnClass");
    });
  });
});
