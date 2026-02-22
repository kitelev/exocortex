import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Import the module to test - it will fail initially since it doesn't exist
const { SPARQLErrorEnhancer, levenshteinDistance, findSimilarPrefixes, getQueryContext } = await import("../../../src/utils/SPARQLErrorEnhancer.js");

describe("SPARQLErrorEnhancer", () => {
  let enhancer: InstanceType<typeof SPARQLErrorEnhancer>;

  beforeEach(() => {
    enhancer = new SPARQLErrorEnhancer();
  });

  describe("enhanceError() - Unknown prefix errors", () => {
    it("should enhance unknown prefix error with suggestions", () => {
      const originalError = new Error("Unknown prefix: em");
      const query = `PREFIX ems: <http://exocortex.local/ems#>
SELECT ?s WHERE { ?s em:status ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.message).toContain("Unknown prefix 'em'");
      expect(enhanced.message).toContain("Did you mean: ems");
    });

    it("should show available prefixes in suggestion", () => {
      const originalError = new Error("Unknown prefix: rd");
      const query = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?s WHERE { ?s rd:type ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.message).toContain("Did you mean: rdf");
    });

    it("should suggest multiple similar prefixes when available", () => {
      const originalError = new Error("Unknown prefix: em");
      const query = `PREFIX ems: <http://exocortex.local/ems#>
PREFIX exo: <http://exocortex.local/exo#>
PREFIX ims: <http://exocortex.local/ims#>
SELECT ?s WHERE { ?s em:status ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.message).toContain("Unknown prefix 'em'");
      // Should suggest ems, ims (sorted by similarity)
      expect(enhanced.message).toMatch(/Did you mean:.*ems/);
    });

    it("should show all declared prefixes when no close match found", () => {
      const originalError = new Error("Unknown prefix: xyz");
      const query = `PREFIX ems: <http://exocortex.local/ems#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?s WHERE { ?s xyz:status ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.message).toContain("Unknown prefix 'xyz'");
      expect(enhanced.message).toContain("Available prefixes:");
    });
  });

  describe("enhanceError() - Syntax errors with position", () => {
    it("should show context around syntax error", () => {
      const originalError = new Error("Parse error at line 3, column 10: Expected 'WHERE'");
      const query = `PREFIX ems: <http://exocortex.local/ems#>
SELECT ?s ?label
INVALID_KEYWORD { ?s ems:status ?o }
ORDER BY ?label`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.message).toContain("Syntax error at line 3, column 10");
      // Should include context lines
      expect(enhanced.context).toBeDefined();
      expect(enhanced.context?.lines?.length).toBeGreaterThan(0);
    });

    it("should show ±2 lines around error position", () => {
      const originalError = new Error("Parse error at line 5, column 5: Unexpected token");
      const query = `PREFIX ems: <http://exocortex.local/ems#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?s ?label
WHERE {
  ?s INVALID
  ?s ems:label ?label
}
ORDER BY ?label`;

      const enhanced = enhancer.enhanceError(originalError, query);

      // Should show lines 3-7 (±2 from line 5)
      expect(enhanced.context?.startLine).toBe(3);
      expect(enhanced.context?.endLine).toBe(7);
    });

    it("should handle errors at beginning of query", () => {
      const originalError = new Error("Parse error at line 1, column 1: Expected PREFIX or SELECT");
      const query = `INVALID QUERY
SELECT ?s WHERE { ?s ?p ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.context?.startLine).toBe(1);
    });

    it("should handle errors at end of query", () => {
      const originalError = new Error("Parse error at line 4, column 1: Unexpected end of input");
      const query = `SELECT ?s WHERE {
  ?s ?p ?o
  FILTER (
`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.context?.endLine).toBe(4);
    });
  });

  describe("enhanceError() - Timeout errors", () => {
    it("should enhance timeout error with user-friendly message", () => {
      const originalError = new Error("Query timeout after 30000ms");
      const query = `SELECT ?s WHERE { ?s ?p ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.message).toContain("Query timed out after 30 seconds");
      // Should suggest LIMIT-related optimization
      expect(enhanced.suggestions?.some(s => s.includes("LIMIT"))).toBe(true);
    });

    it("should suggest optimizations for timeout errors", () => {
      const originalError = new Error("Query execution exceeded timeout: 60000ms");
      const query = `SELECT * WHERE { ?s ?p ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.suggestions).toBeDefined();
      expect(enhanced.suggestions?.length).toBeGreaterThan(0);
      // Should suggest adding LIMIT
      expect(enhanced.suggestions?.some(s => s.includes("LIMIT"))).toBe(true);
    });
  });

  describe("enhanceError() - Preserves original error info", () => {
    it("should preserve original error message in details", () => {
      const originalError = new Error("Original error message from Fuseki");
      const query = `SELECT ?s WHERE { ?s ?p ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.originalMessage).toBe("Original error message from Fuseki");
    });

    it("should preserve stack trace from original error", () => {
      const originalError = new Error("Some error");
      originalError.stack = "Error: Some error\n  at someFunction (file.ts:10:5)";
      const query = `SELECT ?s WHERE { ?s ?p ?o }`;

      const enhanced = enhancer.enhanceError(originalError, query);

      expect(enhanced.originalStack).toBe(originalError.stack);
    });
  });

  describe("classifyError()", () => {
    it("should classify unknown prefix errors", () => {
      const error = new Error("Unknown prefix: foo");

      const type = enhancer.classifyError(error);

      expect(type).toBe("unknown_prefix");
    });

    it("should classify parse/syntax errors", () => {
      const error = new Error("Parse error at line 3, column 5");

      const type = enhancer.classifyError(error);

      expect(type).toBe("syntax");
    });

    it("should classify timeout errors", () => {
      const error = new Error("Query timeout after 30000ms");

      const type = enhancer.classifyError(error);

      expect(type).toBe("timeout");
    });

    it("should classify connection errors", () => {
      const error = new Error("ECONNREFUSED: Connection refused");

      const type = enhancer.classifyError(error);

      expect(type).toBe("connection");
    });

    it("should classify unknown errors", () => {
      const error = new Error("Some random error");

      const type = enhancer.classifyError(error);

      expect(type).toBe("unknown");
    });
  });
});

describe("levenshteinDistance()", () => {
  it("should return 0 for identical strings", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("should return correct distance for single character difference", () => {
    expect(levenshteinDistance("abc", "abd")).toBe(1);
  });

  it("should return correct distance for insertion", () => {
    expect(levenshteinDistance("abc", "abcd")).toBe(1);
  });

  it("should return correct distance for deletion", () => {
    expect(levenshteinDistance("abcd", "abc")).toBe(1);
  });

  it("should return correct distance for substitution", () => {
    expect(levenshteinDistance("abc", "axc")).toBe(1);
  });

  it("should handle empty strings", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("should handle case sensitivity", () => {
    expect(levenshteinDistance("ABC", "abc")).toBe(3);
  });

  it("should work for realistic prefix typos", () => {
    expect(levenshteinDistance("em", "ems")).toBe(1);
    expect(levenshteinDistance("rd", "rdf")).toBe(1);
    expect(levenshteinDistance("rdf", "rdfs")).toBe(1);
  });
});

describe("findSimilarPrefixes()", () => {
  it("should find similar prefixes sorted by similarity", () => {
    const knownPrefixes = ["ems", "ims", "rdf", "rdfs", "exo"];

    const similar = findSimilarPrefixes("em", knownPrefixes);

    expect(similar[0]).toBe("ems"); // Distance 1
    expect(similar).toContain("ims"); // Distance 2
  });

  it("should return top N suggestions", () => {
    const knownPrefixes = ["ems", "ims", "rdf", "rdfs", "exo", "owl", "xsd"];

    const similar = findSimilarPrefixes("em", knownPrefixes, 3);

    expect(similar.length).toBeLessThanOrEqual(3);
  });

  it("should filter out suggestions with distance > threshold", () => {
    const knownPrefixes = ["ems", "completely_different"];

    const similar = findSimilarPrefixes("em", knownPrefixes, 5, 2);

    expect(similar).toContain("ems");
    expect(similar).not.toContain("completely_different");
  });

  it("should return empty array when no similar prefixes found", () => {
    const knownPrefixes = ["ems", "rdf"];

    const similar = findSimilarPrefixes("xyz", knownPrefixes, 3, 1);

    expect(similar.length).toBe(0);
  });
});

describe("getQueryContext()", () => {
  it("should return ±2 lines around error position", () => {
    const query = `line 1
line 2
line 3
line 4
line 5
line 6
line 7`;

    const context = getQueryContext(query, 4, 2);

    expect(context.startLine).toBe(2);
    expect(context.endLine).toBe(6);
    expect(context.lines.length).toBe(5);
  });

  it("should handle error at first line", () => {
    const query = `line 1
line 2
line 3`;

    const context = getQueryContext(query, 1, 2);

    expect(context.startLine).toBe(1);
    expect(context.endLine).toBe(3);
  });

  it("should handle error at last line", () => {
    const query = `line 1
line 2
line 3`;

    const context = getQueryContext(query, 3, 2);

    expect(context.startLine).toBe(1);
    expect(context.endLine).toBe(3);
  });

  it("should mark the error line", () => {
    const query = `SELECT ?s
WHERE {
  INVALID
}`;

    const context = getQueryContext(query, 3, 2);

    expect(context.errorLine).toBe(3);
    expect(context.lines.find(l => l.isError)).toBeDefined();
  });

  it("should include line numbers", () => {
    const query = `line 1
line 2
line 3`;

    const context = getQueryContext(query, 2, 1);

    expect(context.lines[0].number).toBe(1);
    expect(context.lines[1].number).toBe(2);
    expect(context.lines[2].number).toBe(3);
  });

  it("should include column pointer for error line", () => {
    const query = `SELECT ?s WHERE { ?s ?p INVALID }`;

    const context = getQueryContext(query, 1, 0, 25);

    expect(context.errorColumn).toBe(25);
  });
});

describe("SPARQLErrorEnhancer - error message formatting", () => {
  let enhancer: InstanceType<typeof SPARQLErrorEnhancer>;

  beforeEach(() => {
    enhancer = new SPARQLErrorEnhancer();
  });

  it("should format enhanced error for text output", () => {
    const originalError = new Error("Unknown prefix: em");
    const query = `PREFIX ems: <http://exocortex.local/ems#>
SELECT ?s WHERE { ?s em:status ?o }`;

    const enhanced = enhancer.enhanceError(originalError, query);
    const formatted = enhancer.formatForText(enhanced);

    expect(formatted).toContain("❌");
    expect(formatted).toContain("Unknown prefix");
    expect(formatted).toContain("Did you mean");
  });

  it("should format enhanced error for JSON output", () => {
    const originalError = new Error("Unknown prefix: em");
    const query = `PREFIX ems: <http://exocortex.local/ems#>
SELECT ?s WHERE { ?s em:status ?o }`;

    const enhanced = enhancer.enhanceError(originalError, query);
    const json = enhancer.formatForJSON(enhanced);

    expect(json.type).toBe("unknown_prefix");
    expect(json.message).toBeDefined();
    expect(json.suggestions).toBeDefined();
    expect(json.originalMessage).toBeDefined();
  });
});
