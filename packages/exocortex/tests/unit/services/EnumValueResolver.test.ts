import "reflect-metadata";
import { EnumValueResolver, type EnumValue } from "../../../src/services/EnumValueResolver";
import type { ISPARQLQueryable } from "../../../src/services/PropertySchemaResolver";
import type { ILogger } from "../../../src/interfaces/ILogger";

function createMockSparql(
  resultsByQuery: Map<string, unknown>[][] = [],
): jest.Mocked<ISPARQLQueryable> {
  return {
    query: jest.fn().mockResolvedValue(resultsByQuery),
  };
}

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function buildBindings(
  rows: Array<{ instance: string; label: string; rank?: string }>,
): Map<string, unknown>[] {
  return rows.map((row) => {
    const m = new Map<string, unknown>();
    m.set("instance", row.instance);
    m.set("label", row.label);
    if (row.rank !== undefined) {
      m.set("rank", row.rank);
    }
    return m;
  });
}

describe("EnumValueResolver", () => {
  let sparql: jest.Mocked<ISPARQLQueryable>;
  let logger: jest.Mocked<ILogger>;
  let resolver: EnumValueResolver;

  beforeEach(() => {
    sparql = createMockSparql();
    logger = createMockLogger();
    resolver = new EnumValueResolver(sparql, logger);
  });

  describe("resolve", () => {
    it("should query triple store for enum instances and return values", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusBacklog",
          label: "Backlog",
        },
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDoing",
          label: "Doing",
        },
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDone",
          label: "Done",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values).toHaveLength(3);
      expect(values[0]).toEqual({
        value: "[[ems__EffortStatusBacklog]]",
        label: "Backlog",
      });
      expect(values[1]).toEqual({
        value: "[[ems__EffortStatusDoing]]",
        label: "Doing",
      });
      expect(values[2]).toEqual({
        value: "[[ems__EffortStatusDone]]",
        label: "Done",
      });
    });

    it("should return empty array when no instances found", async () => {
      sparql.query.mockResolvedValue([]);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values).toEqual([]);
    });

    it("should handle TaskSize enum class", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#TaskSize_S",
          label: "S",
        },
        {
          instance: "https://exocortex.my/ontology/ems#TaskSize_M",
          label: "M",
        },
        {
          instance: "https://exocortex.my/ontology/ems#TaskSize_L",
          label: "L",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__TaskSize");

      expect(values).toHaveLength(3);
      expect(values[0]).toEqual({
        value: "[[ems__TaskSize_S]]",
        label: "S",
      });
      expect(values[1]).toEqual({
        value: "[[ems__TaskSize_M]]",
        label: "M",
      });
      expect(values[2]).toEqual({
        value: "[[ems__TaskSize_L]]",
        label: "L",
      });
    });

    it("should use full IRI for class in the SPARQL query", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__EffortStatus");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain(
        "https://exocortex.my/ontology/ems#EffortStatus",
      );
    });

    it("should include rank property in query", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__EffortStatus");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain(
        "https://exocortex.my/ontology/ems#EffortStatus_rank",
      );
      expect(queryString).toContain("ORDER BY ?rank ?instance");
    });

    it("should deduplicate instances with same IRI", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDoing",
          label: "Doing",
        },
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDoing",
          label: "Doing Duplicate",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values).toHaveLength(1);
      expect(values[0].label).toBe("Doing");
    });

    it("should use instance IRI as label fallback when label is missing", async () => {
      const bindings: Map<string, unknown>[] = [
        new Map<string, unknown>([
          [
            "instance",
            "https://exocortex.my/ontology/ems#EffortStatusUnknown",
          ],
        ]),
      ];
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values).toHaveLength(1);
      expect(values[0].label).toBe(
        "https://exocortex.my/ontology/ems#EffortStatusUnknown",
      );
    });

    it("should strip wikilink brackets from input class name", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("[[ems__EffortStatus]]");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain(
        "https://exocortex.my/ontology/ems#EffortStatus",
      );
    });

    it("should handle classes that already have full IRI", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve(
        "https://exocortex.my/ontology/ems#EffortStatus",
      );

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain(
        "https://exocortex.my/ontology/ems#EffortStatus",
      );
    });
  });

  describe("caching", () => {
    it("should cache results for subsequent calls", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDone",
          label: "Done",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      const first = await resolver.resolve("ems__EffortStatus");
      const second = await resolver.resolve("ems__EffortStatus");

      expect(sparql.query).toHaveBeenCalledTimes(1);
      expect(first).toEqual(second);
    });

    it("should not cache empty results", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__EffortStatus");
      await resolver.resolve("ems__EffortStatus");

      expect(sparql.query).toHaveBeenCalledTimes(2);
    });

    it("should invalidate cache for specific enum class", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDone",
          label: "Done",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      await resolver.resolve("ems__EffortStatus");
      resolver.invalidateCache("ems__EffortStatus");
      await resolver.resolve("ems__EffortStatus");

      expect(sparql.query).toHaveBeenCalledTimes(2);
    });

    it("should invalidate entire cache when no argument given", async () => {
      const statusBindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDone",
          label: "Done",
        },
      ]);
      const sizeBindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#TaskSize_M",
          label: "M",
        },
      ]);
      sparql.query
        .mockResolvedValueOnce(statusBindings)
        .mockResolvedValueOnce(sizeBindings)
        .mockResolvedValueOnce(statusBindings)
        .mockResolvedValueOnce(sizeBindings);

      await resolver.resolve("ems__EffortStatus");
      await resolver.resolve("ems__TaskSize");
      resolver.invalidateCache();
      await resolver.resolve("ems__EffortStatus");
      await resolver.resolve("ems__TaskSize");

      expect(sparql.query).toHaveBeenCalledTimes(4);
    });

    it("should not invalidate other caches when invalidating specific class", async () => {
      const statusBindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDone",
          label: "Done",
        },
      ]);
      const sizeBindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#TaskSize_M",
          label: "M",
        },
      ]);
      sparql.query
        .mockResolvedValueOnce(statusBindings)
        .mockResolvedValueOnce(sizeBindings)
        .mockResolvedValueOnce(statusBindings);

      await resolver.resolve("ems__EffortStatus");
      await resolver.resolve("ems__TaskSize");

      resolver.invalidateCache("ems__EffortStatus");

      await resolver.resolve("ems__EffortStatus");
      await resolver.resolve("ems__TaskSize");

      expect(sparql.query).toHaveBeenCalledTimes(3);
    });
  });

  describe("error handling", () => {
    it("should return empty array and log warning when query fails", async () => {
      sparql.query.mockRejectedValue(new Error("SPARQL execution failed"));

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to resolve enum values for ems__EffortStatus",
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it("should not cache failed results", async () => {
      sparql.query
        .mockRejectedValueOnce(new Error("first failure"))
        .mockResolvedValueOnce(
          buildBindings([
            {
              instance:
                "https://exocortex.my/ontology/ems#EffortStatusDone",
              label: "Done",
            },
          ]),
        );

      const first = await resolver.resolve("ems__EffortStatus");
      const second = await resolver.resolve("ems__EffortStatus");

      expect(first).toEqual([]);
      expect(second).toHaveLength(1);
      expect(sparql.query).toHaveBeenCalledTimes(2);
    });

    it("should work without logger", async () => {
      const resolverNoLogger = new EnumValueResolver(sparql);
      sparql.query.mockRejectedValue(new Error("fail"));

      const values = await resolverNoLogger.resolve("ems__EffortStatus");
      expect(values).toEqual([]);
    });
  });

  describe("IRI handling", () => {
    it("should build correct rank property for ems namespace", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__TaskSize");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain(
        "https://exocortex.my/ontology/ems#TaskSize_rank",
      );
    });

    it("should build correct full IRI for exo namespace", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("exo__CustomEnum");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain(
        "https://exocortex.my/ontology/exo#CustomEnum",
      );
    });

    it("should convert full IRI instances back to short form in values", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusBacklog",
          label: "Backlog",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values[0].value).toBe("[[ems__EffortStatusBacklog]]");
    });

    it("should handle non-matching IRI formats gracefully", async () => {
      const bindings: Map<string, unknown>[] = [
        new Map<string, unknown>([
          ["instance", "http://example.org/custom#Thing"],
          ["label", "Custom Thing"],
        ]),
      ];
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values).toHaveLength(1);
      expect(values[0].value).toBe("[[http://example.org/custom#Thing]]");
      expect(values[0].label).toBe("Custom Thing");
    });
  });

  describe("ordering", () => {
    it("should preserve order from SPARQL query results", async () => {
      const bindings = buildBindings([
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusBacklog",
          label: "Backlog",
          rank: "1",
        },
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusToDo",
          label: "To Do",
          rank: "2",
        },
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDoing",
          label: "Doing",
          rank: "3",
        },
        {
          instance: "https://exocortex.my/ontology/ems#EffortStatusDone",
          label: "Done",
          rank: "4",
        },
      ]);
      sparql.query.mockResolvedValue(bindings);

      const values = await resolver.resolve("ems__EffortStatus");

      expect(values.map((v) => v.label)).toEqual([
        "Backlog",
        "To Do",
        "Doing",
        "Done",
      ]);
    });
  });

  describe("SPARQL query structure", () => {
    it("should use exo:Instance_class predicate", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__EffortStatus");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain("exo:Instance_class");
    });

    it("should use exo:Asset_label predicate", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__EffortStatus");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain("exo:Asset_label");
    });

    it("should include OPTIONAL rank clause", async () => {
      sparql.query.mockResolvedValue([]);

      await resolver.resolve("ems__EffortStatus");

      const queryString = sparql.query.mock.calls[0][0];
      expect(queryString).toContain("OPTIONAL");
      expect(queryString).toContain("?rank");
    });
  });
});
