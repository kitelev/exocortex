import {
  ClassHierarchyResolver,
} from "../../src/services/ClassHierarchyResolver";
import type { ISPARQLQueryable } from "../../src/services/PropertySchemaResolver";

describe("ClassHierarchyResolver", () => {
  let mockSparqlService: jest.Mocked<ISPARQLQueryable>;
  let resolver: ClassHierarchyResolver;

  beforeEach(() => {
    mockSparqlService = {
      query: jest.fn(),
    };
    resolver = new ClassHierarchyResolver(mockSparqlService);
  });

  describe("resolve", () => {
    it("should resolve single-level hierarchy", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Area");

      expect(hierarchy).toEqual(["ems__Area", "exo__Asset"]);
    });

    it("should resolve multi-level hierarchy transitively", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/ems#Task"],
        ]),
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/ems#Effort"],
        ]),
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Meeting");

      expect(hierarchy).toEqual(["ems__Meeting", "ems__Task", "ems__Effort", "exo__Asset"]);
    });

    it("should resolve ems__Task hierarchy", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/ems#Effort"],
        ]),
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Task");

      expect(hierarchy).toEqual(["ems__Task", "ems__Effort", "exo__Asset"]);
    });

    it("should return fallback for unknown class with no ancestors", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      const hierarchy = await resolver.resolve("custom__Unknown");

      expect(hierarchy).toEqual(["custom__Unknown", "exo__Asset"]);
    });

    it("should return fallback on query error", async () => {
      mockSparqlService.query.mockRejectedValue(new Error("Connection failed"));

      const hierarchy = await resolver.resolve("ems__Task");

      expect(hierarchy).toEqual(["ems__Task", "exo__Asset"]);
    });

    it("should deduplicate ancestors", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Area");

      expect(hierarchy).toEqual(["ems__Area", "exo__Asset"]);
    });

    it("should skip bindings with no ancestor value", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([]),
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Area");

      expect(hierarchy).toEqual(["ems__Area", "exo__Asset"]);
    });

    it("should append exo__Asset if not in results", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/ems#Effort"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Task");

      expect(hierarchy).toContain("exo__Asset");
      expect(hierarchy).toEqual(["ems__Task", "ems__Effort", "exo__Asset"]);
    });

    it("should not double-add exo__Asset if already in results", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Area");

      const assetCount = hierarchy.filter((c) => c === "exo__Asset").length;
      expect(assetCount).toBe(1);
    });

    it("should use rdfs:subClassOf+ property path in query", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.resolve("ems__Task");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("rdfs:subClassOf+"),
      );
    });

    it("should convert class name to full IRI in query", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.resolve("ems__Task");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Task>"),
      );
    });

    it("should handle custom namespace prefixes", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("custom__MyClass");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/custom#MyClass>"),
      );
      expect(hierarchy).toEqual(["custom__MyClass", "exo__Asset"]);
    });

    it("should handle exo namespace prefix", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.resolve("exo__SomeClass");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/exo#SomeClass>"),
      );
    });

    it("should handle full IRI as input class name", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.resolve("https://exocortex.my/ontology/ems#Task");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<https://exocortex.my/ontology/ems#Task>"),
      );
    });

    it("should handle non-prefixed class name without namespace", async () => {
      mockSparqlService.query.mockResolvedValue([]);

      await resolver.resolve("SomeRawName");

      expect(mockSparqlService.query).toHaveBeenCalledWith(
        expect.stringContaining("<SomeRawName>"),
      );
    });

    it("should handle ancestor with non-exocortex IRI", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "http://www.w3.org/2002/07/owl#Thing"],
        ]),
      ]);

      const hierarchy = await resolver.resolve("ems__Task");

      expect(hierarchy).toContain("http://www.w3.org/2002/07/owl#Thing");
      expect(hierarchy).toContain("exo__Asset");
    });
  });

  describe("caching", () => {
    it("should cache results after first resolution", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/ems#Effort"],
        ]),
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      await resolver.resolve("ems__Task");
      await resolver.resolve("ems__Task");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(1);
    });

    it("should return copy of cached results to prevent mutation", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      const first = await resolver.resolve("ems__Area");
      first.push("mutated");

      const second = await resolver.resolve("ems__Area");
      expect(second).not.toContain("mutated");
    });

    it("should cache different classes independently", async () => {
      mockSparqlService.query
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
          ]),
        ])
        .mockResolvedValueOnce([
          new Map<string, unknown>([
            ["ancestor", "https://exocortex.my/ontology/ems#Effort"],
          ]),
          new Map<string, unknown>([
            ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
          ]),
        ]);

      const area = await resolver.resolve("ems__Area");
      const task = await resolver.resolve("ems__Task");

      expect(area).toEqual(["ems__Area", "exo__Asset"]);
      expect(task).toEqual(["ems__Task", "ems__Effort", "exo__Asset"]);
      expect(mockSparqlService.query).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidateCache", () => {
    it("should force re-query after invalidation", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      await resolver.resolve("ems__Area");
      resolver.invalidateCache();
      await resolver.resolve("ems__Area");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(2);
    });

    it("should clear all cached entries", async () => {
      mockSparqlService.query.mockResolvedValue([
        new Map<string, unknown>([
          ["ancestor", "https://exocortex.my/ontology/exo#Asset"],
        ]),
      ]);

      await resolver.resolve("ems__Area");
      await resolver.resolve("ems__Task");
      resolver.invalidateCache();
      await resolver.resolve("ems__Area");
      await resolver.resolve("ems__Task");

      expect(mockSparqlService.query).toHaveBeenCalledTimes(4);
    });
  });

  describe("with logger", () => {
    it("should log warning on query error", async () => {
      const mockLogger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
      const loggedResolver = new ClassHierarchyResolver(mockSparqlService, mockLogger as any);

      mockSparqlService.query.mockRejectedValue(new Error("SPARQL timeout"));

      await loggedResolver.resolve("ems__Task");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to resolve class hierarchy"),
        expect.objectContaining({ error: expect.stringContaining("SPARQL timeout") }),
      );
    });

    it("should still return fallback when logging error", async () => {
      const mockLogger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
      const loggedResolver = new ClassHierarchyResolver(mockSparqlService, mockLogger as any);

      mockSparqlService.query.mockRejectedValue(new Error("Connection lost"));

      const hierarchy = await loggedResolver.resolve("ems__Task");

      expect(hierarchy).toEqual(["ems__Task", "exo__Asset"]);
    });
  });
});
