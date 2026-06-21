import { PatternTranslator } from "../../../../../src/infrastructure/sparql/algebra/PatternTranslator";
import { AlgebraTranslatorError } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslatorError";
import type { AlgebraOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import type {
  SparqljsPattern,
  SparqljsExpression,
} from "../../../../../src/infrastructure/sparql/SparqljsTypes";
import type { SelectQuery } from "../../../../../src/infrastructure/sparql/SPARQLParser";

describe("PatternTranslator", () => {
  let translator: PatternTranslator;
  const mockTranslateExpression = jest.fn((expr: SparqljsExpression) => ({
    type: "literal" as const,
    value: "mock",
  }));
  const mockTranslateSelect = jest.fn((_query: SelectQuery) => ({
    type: "bgp" as const,
    triples: [],
  } as AlgebraOperation));
  const mockTranslateBGP = jest.fn((pattern: SparqljsPattern) => ({
    type: "bgp" as const,
    triples: [],
  } as AlgebraOperation));

  beforeEach(() => {
    jest.clearAllMocks();
    translator = new PatternTranslator({
      translateExpression: mockTranslateExpression,
      translateSelect: mockTranslateSelect,
      translateBGP: mockTranslateBGP,
    });
  });

  describe("translateWhere", () => {
    it("throws on empty patterns", () => {
      expect(() => translator.translateWhere([])).toThrow("Empty WHERE clause");
    });

    it("returns empty BGP when only filters and binds are present", () => {
      const patterns = [
        {
          type: "filter",
          expression: { termType: "Variable", value: "x" },
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      expect(result.type).toBe("filter");
    });

    it("wraps single OPTIONAL in leftjoin with empty BGP left", () => {
      const patterns = [
        {
          type: "optional",
          patterns: [
            { type: "bgp", triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }] },
          ],
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      expect(result.type).toBe("leftjoin");
      expect((result as any).left.type).toBe("bgp");
      expect((result as any).left.triples).toHaveLength(0);
    });

    it("wraps leading OPTIONAL in leftjoin when multiple patterns", () => {
      const patterns = [
        {
          type: "optional",
          patterns: [
            { type: "bgp", triples: [] },
          ],
        },
        {
          type: "bgp",
          triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }],
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      // Should be a join of leftjoin (from OPTIONAL) and bgp
      expect(result.type).toBe("join");
    });

    it("handles OPTIONAL with expression", () => {
      const patterns = [
        {
          type: "optional",
          patterns: [
            { type: "bgp", triples: [] },
          ],
          expression: { termType: "Variable", value: "filterVar" },
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      expect(result.type).toBe("leftjoin");
      expect((result as any).expression).toBeDefined();
      expect(mockTranslateExpression).toHaveBeenCalled();
    });

    it("handles BIND patterns", () => {
      const patterns = [
        {
          type: "bgp",
          triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }],
        },
        {
          type: "bind",
          variable: { value: "bound" },
          expression: { termType: "Variable", value: "x" },
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      expect(result.type).toBe("extend");
      expect((result as any).variable).toBe("bound");
    });

    it("handles multiple filter patterns", () => {
      const patterns = [
        {
          type: "bgp",
          triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }],
        },
        {
          type: "filter",
          expression: { termType: "Variable", value: "x" },
        },
        {
          type: "filter",
          expression: { termType: "Variable", value: "y" },
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      // Two nested filter operations
      expect(result.type).toBe("filter");
      expect((result as any).input.type).toBe("filter");
    });
  });

  describe("translatePattern", () => {
    it("throws on null pattern", () => {
      expect(() => translator.translatePattern(null as unknown as SparqljsPattern))
        .toThrow("Invalid pattern: missing type");
    });

    it("throws on pattern without type", () => {
      expect(() => translator.translatePattern({} as unknown as SparqljsPattern))
        .toThrow("Invalid pattern: missing type");
    });

    it("translates bgp pattern", () => {
      const pattern = { type: "bgp", triples: [] } as unknown as SparqljsPattern;
      translator.translatePattern(pattern);
      expect(mockTranslateBGP).toHaveBeenCalledWith(pattern);
    });

    it("translates filter pattern", () => {
      const pattern = {
        type: "filter",
        expression: { termType: "Variable", value: "x" },
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("filter");
    });

    it("translates optional pattern", () => {
      const pattern = {
        type: "optional",
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("leftjoin");
    });

    it("translates union pattern", () => {
      const pattern = {
        type: "union",
        patterns: [
          { type: "group", patterns: [{ type: "bgp", triples: [] }] },
          { type: "group", patterns: [{ type: "bgp", triples: [] }] },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("union");
    });

    it("translates minus pattern", () => {
      const pattern = {
        type: "minus",
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("minus");
    });

    it("translates values pattern", () => {
      const pattern = {
        type: "values",
        values: [
          { "?x": { termType: "NamedNode", value: "http://ex.org/a" } },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("values");
    });

    it("translates group pattern", () => {
      const pattern = {
        type: "group",
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      // group delegates to translateWhere which expects non-empty
      // provide at least one translateable pattern
      translator.translatePattern(pattern);
      expect(mockTranslateBGP).toHaveBeenCalled();
    });

    it("translates query (subquery) pattern", () => {
      const pattern = {
        type: "query",
        queryType: "SELECT",
        variables: [{ termType: "Wildcard", value: "*" }],
        where: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("subquery");
    });

    it("translates service pattern", () => {
      const pattern = {
        type: "service",
        name: { termType: "NamedNode", value: "http://ex.org/endpoint" },
        patterns: [{ type: "bgp", triples: [] }],
        silent: false,
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("service");
    });

    it("translates graph pattern", () => {
      const pattern = {
        type: "graph",
        name: { termType: "NamedNode", value: "http://ex.org/graph" },
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("graph");
    });

    it("throws for unsupported pattern type", () => {
      const pattern = { type: "unsupported" } as unknown as SparqljsPattern;
      expect(() => translator.translatePattern(pattern)).toThrow("Unsupported pattern type: unsupported");
    });
  });

  describe("translateOptional (via translatePattern)", () => {
    it("throws for OPTIONAL with empty patterns", () => {
      const pattern = {
        type: "optional",
        patterns: [],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("OPTIONAL pattern must have patterns");
    });

    it("throws for OPTIONAL without patterns", () => {
      const pattern = {
        type: "optional",
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("OPTIONAL pattern must have patterns");
    });
  });

  describe("translateUnion (via translatePattern)", () => {
    it("throws for UNION with less than 2 patterns", () => {
      const pattern = {
        type: "union",
        patterns: [{ type: "group", patterns: [{ type: "bgp", triples: [] }] }],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("UNION pattern must have at least 2 patterns");
    });

    it("handles UNION with more than 2 patterns (chained)", () => {
      const pattern = {
        type: "union",
        patterns: [
          { type: "group", patterns: [{ type: "bgp", triples: [] }] },
          { type: "group", patterns: [{ type: "bgp", triples: [] }] },
          { type: "group", patterns: [{ type: "bgp", triples: [] }] },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("union");
      expect((result as any).left.type).toBe("union");
    });

    it("handles UNION branches that are graph patterns", () => {
      const pattern = {
        type: "union",
        patterns: [
          {
            type: "graph",
            name: { termType: "NamedNode", value: "http://ex.org/g1" },
            patterns: [{ type: "bgp", triples: [] }],
          },
          {
            type: "graph",
            name: { termType: "NamedNode", value: "http://ex.org/g2" },
            patterns: [{ type: "bgp", triples: [] }],
          },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("union");
      expect((result as any).left.type).toBe("graph");
    });

    it("handles UNION branches that are service patterns", () => {
      const pattern = {
        type: "union",
        patterns: [
          {
            type: "service",
            name: { termType: "NamedNode", value: "http://ex.org/endpoint" },
            patterns: [{ type: "bgp", triples: [] }],
            silent: false,
          },
          { type: "group", patterns: [{ type: "bgp", triples: [] }] },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("union");
    });

    it("handles UNION branch without patterns array (falls through to translateWhere([branch]))", () => {
      const pattern = {
        type: "union",
        patterns: [
          { type: "bgp", triples: [] },
          { type: "bgp", triples: [] },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("union");
    });
  });

  describe("translateMinus (via translatePattern)", () => {
    it("throws for MINUS with empty patterns", () => {
      const pattern = {
        type: "minus",
        patterns: [],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("MINUS pattern must have patterns");
    });
  });

  describe("translateValues (via translatePattern)", () => {
    it("throws for VALUES without values array", () => {
      const pattern = {
        type: "values",
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("VALUES pattern must have values array");
    });

    it("handles VALUES with Literal terms", () => {
      const pattern = {
        type: "values",
        values: [
          {
            "?x": {
              termType: "Literal",
              value: "hello",
              datatype: { value: "http://www.w3.org/2001/XMLSchema#string" },
              language: "",
            },
          },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("values");
      const bindings = (result as any).bindings;
      expect(bindings[0].x).toHaveProperty("type", "literal");
    });

    it("handles VALUES with null/undefined term values", () => {
      const pattern = {
        type: "values",
        values: [
          { "?x": null },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect(result.type).toBe("values");
      const bindings = (result as any).bindings;
      expect(bindings[0]).toEqual({});
    });

    it("handles VALUES with Literal terms that have language with direction", () => {
      translator.setDirectionMappings(new Map([["ar", "rtl"]]));
      const pattern = {
        type: "values",
        values: [
          {
            "?x": {
              termType: "Literal",
              value: "مرحبا",
              datatype: { value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString" },
              language: "ar",
            },
          },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      const bindings = (result as any).bindings;
      expect(bindings[0].x).toHaveProperty("direction", "rtl");
    });

    it("throws for VALUES with unsupported term type", () => {
      const pattern = {
        type: "values",
        values: [
          {
            "?x": { termType: "BlankNode", value: "b0" },
          },
        ],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("Unsupported VALUES term type: BlankNode");
    });

    it("handles variable names with ? prefix", () => {
      const pattern = {
        type: "values",
        values: [
          { "?x": { termType: "NamedNode", value: "http://ex.org/a" } },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect((result as any).variables).toContain("x");
    });

    it("handles variable names without ? prefix", () => {
      const pattern = {
        type: "values",
        values: [
          { "x": { termType: "NamedNode", value: "http://ex.org/a" } },
        ],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect((result as any).variables).toContain("x");
    });
  });

  describe("translateBind (via translateWhere)", () => {
    it("throws for BIND without variable", () => {
      const patterns = [
        {
          type: "bgp",
          triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }],
        },
        {
          type: "bind",
          expression: { termType: "Variable", value: "x" },
        },
      ] as unknown as SparqljsPattern[];

      expect(() => translator.translateWhere(patterns)).toThrow("BIND pattern must have variable and expression");
    });

    it("throws for BIND without expression", () => {
      const patterns = [
        {
          type: "bgp",
          triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }],
        },
        {
          type: "bind",
          variable: { value: "y" },
        },
      ] as unknown as SparqljsPattern[];

      expect(() => translator.translateWhere(patterns)).toThrow("BIND pattern must have variable and expression");
    });
  });

  describe("translateSubquery (via translatePattern)", () => {
    it("throws for non-SELECT subquery", () => {
      const pattern = {
        type: "query",
        queryType: "CONSTRUCT",
        variables: [],
        where: [],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern))
        .toThrow("Only SELECT subqueries are supported");
    });
  });

  describe("translateService (via translatePattern)", () => {
    it("throws for SERVICE without NamedNode endpoint", () => {
      const pattern = {
        type: "service",
        name: { termType: "Variable", value: "endpoint" },
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern))
        .toThrow("SERVICE pattern must have a NamedNode endpoint");
    });

    it("throws for SERVICE without patterns", () => {
      const pattern = {
        type: "service",
        name: { termType: "NamedNode", value: "http://ex.org/endpoint" },
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern))
        .toThrow("SERVICE pattern must have patterns array");
    });

    it("handles SERVICE with silent flag", () => {
      const pattern = {
        type: "service",
        name: { termType: "NamedNode", value: "http://ex.org/endpoint" },
        patterns: [{ type: "bgp", triples: [] }],
        silent: true,
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect((result as any).silent).toBe(true);
    });
  });

  describe("translateGraph (via translatePattern)", () => {
    it("throws for GRAPH without name", () => {
      const pattern = {
        type: "graph",
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern))
        .toThrow("GRAPH pattern must have a name");
    });

    it("throws for GRAPH without patterns", () => {
      const pattern = {
        type: "graph",
        name: { termType: "NamedNode", value: "http://ex.org/g" },
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern))
        .toThrow("GRAPH pattern must have patterns array");
    });

    it("handles GRAPH with Variable name", () => {
      const pattern = {
        type: "graph",
        name: { termType: "Variable", value: "g" },
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      const result = translator.translatePattern(pattern);
      expect((result as any).name).toEqual({ type: "variable", value: "g" });
    });

    it("throws for GRAPH with unsupported name type", () => {
      const pattern = {
        type: "graph",
        name: { termType: "Literal", value: "not-valid" },
        patterns: [{ type: "bgp", triples: [] }],
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern))
        .toThrow("GRAPH pattern name must be NamedNode or Variable, got: Literal");
    });
  });

  describe("translateFilter (via translatePattern)", () => {
    it("throws for filter without expression", () => {
      const pattern = {
        type: "filter",
      } as unknown as SparqljsPattern;

      expect(() => translator.translatePattern(pattern)).toThrow("Filter pattern must have expression");
    });
  });

  describe("lateral join detection", () => {
    it("handles lateral subquery in group wrapper", () => {
      // A lateral subquery is a query with a LATERAL_MARKER variable
      const lateralSubquery = {
        type: "query",
        queryType: "SELECT",
        variables: [
          { termType: "Variable", value: "__LATERAL_JOIN__" },
          { termType: "Variable", value: "result" },
        ],
        where: [{ type: "bgp", triples: [] }],
      };

      const patterns = [
        {
          type: "bgp",
          triples: [{ subject: { termType: "Variable", value: "s" }, predicate: { termType: "NamedNode", value: "http://ex.org/p" }, object: { termType: "Variable", value: "o" } }],
        },
        {
          type: "group",
          patterns: [lateralSubquery],
        },
      ] as unknown as SparqljsPattern[];

      const result = translator.translateWhere(patterns);
      // Should detect lateral and create lateraljoin
      expect(result.type).toBe("lateraljoin");
      expect(mockTranslateSelect).toHaveBeenCalled();
    });
  });
});
