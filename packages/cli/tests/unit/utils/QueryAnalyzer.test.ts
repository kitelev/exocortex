import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// Mock the exocortex dependencies before importing
const mockParseFn = jest.fn();
const mockParseError = class SPARQLParseError extends Error {
  public readonly line?: number;
  public readonly column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = "SPARQLParseError";
    this.line = line;
    this.column = column;
  }
};

jest.unstable_mockModule("exocortex", () => ({
  ExoQLParser: jest.fn(() => ({
    parse: mockParseFn,
  })),
  SPARQLParser: jest.fn(() => ({
    parse: mockParseFn,
  })),
  SPARQLParseError: mockParseError,
  ExoQLAlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),

  AlgebraTranslator: jest.fn(() => ({
    translate: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraOptimizer: jest.fn(() => ({
    optimize: jest.fn().mockReturnValue({ type: "bgp", patterns: [] }),
  })),
  AlgebraSerializer: jest.fn(() => ({
    toString: jest.fn().mockReturnValue("BGP()"),
  })),
}));

const { QueryAnalyzer } = await import("../../../src/utils/QueryAnalyzer.js");

describe("QueryAnalyzer", () => {
  let analyzer: InstanceType<typeof QueryAnalyzer>;

  beforeEach(() => {
    jest.clearAllMocks();
    analyzer = new QueryAnalyzer();
  });

  describe("analyze() - successful queries", () => {
    it("should extract prefixes from SELECT query", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {
          "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
          "ems": "http://example.org/ems#",
        },
        variables: [{ variable: { termType: "Variable", value: "s" } }],
        where: [],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o }");

      expect(result.valid).toBe(true);
      expect(result.prefixes).toEqual([
        { prefix: "rdf", iri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#" },
        { prefix: "ems", iri: "http://example.org/ems#" },
      ]);
    });

    it("should extract variables from SELECT query", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [
          { termType: "Variable", value: "s" },
          { termType: "Variable", value: "label" },
        ],
        where: [],
      });

      const result = await analyzer.analyze("SELECT ?s ?label WHERE { ?s ?p ?o }");

      expect(result.valid).toBe(true);
      expect(result.variables).toEqual(["?s", "?label"]);
    });

    it("should handle SELECT * (all variables)", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: ["*"],
        where: [],
      });

      const result = await analyzer.analyze("SELECT * WHERE { ?s ?p ?o }");

      expect(result.valid).toBe(true);
      expect(result.variables).toEqual(["*"]);
    });

    it("should count triple patterns", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "bgp",
            triples: [
              { subject: {}, predicate: {}, object: {} },
              { subject: {}, predicate: {}, object: {} },
              { subject: {}, predicate: {}, object: {} },
            ],
          },
        ],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o . ?s ?p2 ?o2 . ?s ?p3 ?o3 }");

      expect(result.valid).toBe(true);
      expect(result.triplePatternCount).toBe(3);
    });

    it("should count triple patterns in nested OPTIONAL", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "bgp",
            triples: [{ subject: {}, predicate: {}, object: {} }],
          },
          {
            type: "optional",
            patterns: [
              {
                type: "bgp",
                triples: [{ subject: {}, predicate: {}, object: {} }],
              },
            ],
          },
        ],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o OPTIONAL { ?s ?p2 ?o2 } }");

      expect(result.valid).toBe(true);
      expect(result.triplePatternCount).toBe(2);
    });

    it("should estimate complexity based on patterns", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "bgp",
            triples: [
              { subject: {}, predicate: {}, object: {} },
            ],
          },
        ],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o }");

      expect(result.valid).toBe(true);
      expect(result.complexity).toBeDefined();
      expect(["low", "medium", "high"]).toContain(result.complexity);
    });

    it("should mark complex queries with multiple patterns and OPTIONAL as high complexity", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "bgp",
            triples: new Array(10).fill({ subject: {}, predicate: {}, object: {} }),
          },
          {
            type: "optional",
            patterns: [
              {
                type: "bgp",
                triples: new Array(5).fill({ subject: {}, predicate: {}, object: {} }),
              },
            ],
          },
          {
            type: "union",
            patterns: [],
          },
        ],
      });

      const result = await analyzer.analyze("Complex query with many patterns");

      expect(result.valid).toBe(true);
      expect(result.complexity).toBe("high");
    });

    it("should return query type", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [],
        where: [],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o }");

      expect(result.queryType).toBe("SELECT");
    });

    it("should handle CONSTRUCT queries", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "CONSTRUCT",
        prefixes: {},
        template: [{ subject: {}, predicate: {}, object: {} }],
        where: [
          {
            type: "bgp",
            triples: [{ subject: {}, predicate: {}, object: {} }],
          },
        ],
      });

      const result = await analyzer.analyze("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");

      expect(result.valid).toBe(true);
      expect(result.queryType).toBe("CONSTRUCT");
      expect(result.triplePatternCount).toBe(1);
    });

    it("should detect FILTER patterns", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "bgp",
            triples: [{ subject: {}, predicate: {}, object: {} }],
          },
          {
            type: "filter",
            expression: { type: "operation", operator: "regex" },
          },
        ],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o FILTER(regex(?o, 'test')) }");

      expect(result.valid).toBe(true);
      expect(result.hasFilter).toBe(true);
    });

    it("should detect UNION patterns", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [
          {
            type: "union",
            patterns: [
              { type: "bgp", triples: [{ subject: {}, predicate: {}, object: {} }] },
              { type: "bgp", triples: [{ subject: {}, predicate: {}, object: {} }] },
            ],
          },
        ],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { { ?s ?p ?o } UNION { ?s ?p2 ?o2 } }");

      expect(result.valid).toBe(true);
      expect(result.hasUnion).toBe(true);
    });

    it("should include algebra plan when requested", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o }", { includeAlgebraPlan: true });

      expect(result.valid).toBe(true);
      expect(result.algebraPlan).toBeDefined();
      expect(typeof result.algebraPlan).toBe("string");
    });
  });

  describe("analyze() - syntax errors", () => {
    it("should return valid=false for syntax errors", async () => {
      mockParseFn.mockImplementation(() => {
        throw new mockParseError("Unexpected token", 3, 15);
      });

      const result = await analyzer.analyze("INVALID QUERY");

      expect(result.valid).toBe(false);
    });

    it("should include line and column for syntax errors", async () => {
      mockParseFn.mockImplementation(() => {
        throw new mockParseError("Unexpected token", 3, 15);
      });

      const result = await analyzer.analyze("INVALID QUERY");

      expect(result.valid).toBe(false);
      expect(result.error?.line).toBe(3);
      expect(result.error?.column).toBe(15);
    });

    it("should include error message", async () => {
      mockParseFn.mockImplementation(() => {
        throw new mockParseError("Expected 'WHERE' but found 'INVALID'", 1, 20);
      });

      const result = await analyzer.analyze("SELECT ?s INVALID { ?s ?p ?o }");

      expect(result.valid).toBe(false);
      expect(result.error?.message).toContain("WHERE");
    });

    it("should provide suggestions for common errors", async () => {
      mockParseFn.mockImplementation(() => {
        throw new mockParseError("Unknown prefix: rdf", 2, 5);
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s rdf:type ?o }");

      expect(result.valid).toBe(false);
      expect(result.error?.suggestions).toBeDefined();
      expect(result.error?.suggestions?.length).toBeGreaterThan(0);
    });
  });

  describe("formatAnalysis()", () => {
    it("should format successful analysis for text output", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {
          "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        },
        variables: [
          { termType: "Variable", value: "s" },
          { termType: "Variable", value: "label" },
        ],
        where: [
          {
            type: "bgp",
            triples: [
              { subject: {}, predicate: {}, object: {} },
              { subject: {}, predicate: {}, object: {} },
            ],
          },
        ],
      });

      const result = await analyzer.analyze("SELECT ?s ?label WHERE { ?s ?p ?o }");
      const formatted = analyzer.formatAnalysis(result, "text");

      expect(formatted).toContain("Query Type:");
      expect(formatted).toContain("SELECT");
      expect(formatted).toContain("Prefixes:");
      expect(formatted).toContain("Variables:");
      expect(formatted).toContain("?s");
      expect(formatted).toContain("?label");
      expect(formatted).toContain("Triple Patterns:");
      expect(formatted).toContain("Complexity:");
    });

    it("should format errors for text output", async () => {
      mockParseFn.mockImplementation(() => {
        throw new mockParseError("Syntax error at line 2", 2, 10);
      });

      const result = await analyzer.analyze("INVALID");
      const formatted = analyzer.formatAnalysis(result, "text");

      expect(formatted).toContain("Syntax Error");
      expect(formatted).toContain("line 2");
    });

    it("should return JSON for json output format", async () => {
      mockParseFn.mockReturnValue({
        type: "query",
        queryType: "SELECT",
        prefixes: {},
        variables: [{ termType: "Variable", value: "s" }],
        where: [],
      });

      const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o }");
      const formatted = analyzer.formatAnalysis(result, "json");
      const parsed = JSON.parse(formatted);

      expect(parsed.valid).toBe(true);
      expect(parsed.queryType).toBe("SELECT");
    });
  });
});

describe("QueryAnalyzer complexity estimation", () => {
  let analyzer: InstanceType<typeof QueryAnalyzer>;

  beforeEach(() => {
    jest.clearAllMocks();
    analyzer = new QueryAnalyzer();
  });

  it("should classify simple BGP as low complexity", async () => {
    mockParseFn.mockReturnValue({
      type: "query",
      queryType: "SELECT",
      prefixes: {},
      variables: [{ termType: "Variable", value: "s" }],
      where: [
        {
          type: "bgp",
          triples: [{ subject: {}, predicate: {}, object: {} }],
        },
      ],
    });

    const result = await analyzer.analyze("SELECT ?s WHERE { ?s ?p ?o }");
    expect(result.complexity).toBe("low");
  });

  it("should classify medium-sized query as medium complexity", async () => {
    mockParseFn.mockReturnValue({
      type: "query",
      queryType: "SELECT",
      prefixes: {},
      variables: [{ termType: "Variable", value: "s" }],
      where: [
        {
          type: "bgp",
          triples: new Array(5).fill({ subject: {}, predicate: {}, object: {} }),
        },
        {
          type: "optional",
          patterns: [
            { type: "bgp", triples: [{ subject: {}, predicate: {}, object: {} }] },
          ],
        },
      ],
    });

    const result = await analyzer.analyze("Medium complexity query");
    expect(result.complexity).toBe("medium");
  });

  it("should classify query with UNION and many patterns as high complexity", async () => {
    mockParseFn.mockReturnValue({
      type: "query",
      queryType: "SELECT",
      prefixes: {},
      variables: [{ termType: "Variable", value: "s" }],
      where: [
        {
          type: "bgp",
          triples: new Array(8).fill({ subject: {}, predicate: {}, object: {} }),
        },
        {
          type: "union",
          patterns: [
            { type: "bgp", triples: new Array(3).fill({ subject: {}, predicate: {}, object: {} }) },
            { type: "bgp", triples: new Array(3).fill({ subject: {}, predicate: {}, object: {} }) },
          ],
        },
        {
          type: "filter",
          expression: {},
        },
      ],
    });

    const result = await analyzer.analyze("Complex query");
    expect(result.complexity).toBe("high");
  });
});
