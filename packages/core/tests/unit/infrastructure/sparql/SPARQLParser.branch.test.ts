import { SPARQLParser, SPARQLParseError } from "../../../../src/infrastructure/sparql/SPARQLParser";

describe("SPARQLParser branch coverage", () => {
  let parser: SPARQLParser;

  beforeEach(() => {
    parser = new SPARQLParser();
  });

  describe("parse error handling", () => {
    it("wraps LateralTransformerError as SPARQLParseError", () => {
      // Invalid LATERAL syntax that the LateralTransformer will reject
      // LATERAL without proper subquery
      expect(() => parser.parse(`
        SELECT * WHERE {
          ?s ?p ?o .
          LATERAL
        }
      `)).toThrow(SPARQLParseError);
    });

    it("wraps CaseWhenTransformerError as SPARQLParseError", () => {
      // Malformed CASE WHEN without END
      expect(() => parser.parse(`
        SELECT (CASE WHEN ?x = 1 THEN "one" AS ?result) WHERE { ?s ?p ?o }
      `)).toThrow(SPARQLParseError);
    });

    it("wraps generic Error with line/column info", () => {
      // This should fail with a sparqljs parsing error that includes line/column
      expect(() => parser.parse("SELCT ?s WHERE { ?s ?p ?o }")).toThrow(SPARQLParseError);
    });

    it("wraps syntax error without line/column", () => {
      expect(() => parser.parse("NOT A QUERY")).toThrow(SPARQLParseError);
    });
  });

  describe("parseAsync", () => {
    it("parses regular query without PREFIX*", async () => {
      const result = await parser.parseAsync("SELECT * WHERE { ?s ?p ?o }");
      expect(result.type).toBe("query");
    });

    it("wraps error in parseAsync", async () => {
      await expect(parser.parseAsync("INVALID QUERY")).rejects.toThrow(SPARQLParseError);
    });

    it("handles DescribeOptionsTransformerError in parseAsync", async () => {
      // Invalid DESCRIBE options
      await expect(parser.parseAsync(
        "DESCRIBE DEPTH -1 <http://example.org/s>"
      )).rejects.toThrow(SPARQLParseError);
    });

    it("handles LateralTransformerError in parseAsync", async () => {
      await expect(parser.parseAsync(`
        SELECT * WHERE {
          ?s ?p ?o .
          LATERAL
        }
      `)).rejects.toThrow(SPARQLParseError);
    });

    it("handles CaseWhenTransformerError in parseAsync", async () => {
      await expect(parser.parseAsync(`
        SELECT (CASE WHEN ?x = 1 THEN "one" AS ?result) WHERE { ?s ?p ?o }
      `)).rejects.toThrow(SPARQLParseError);
    });
  });

  describe("parseAsyncWithOptions", () => {
    it("returns ParseResult with query and describeOptions", async () => {
      const result = await parser.parseAsyncWithOptions("SELECT * WHERE { ?s ?p ?o }");
      expect(result.query).toBeDefined();
      expect(result.query.type).toBe("query");
    });

    it("returns describeOptions for DESCRIBE query", async () => {
      const result = await parser.parseAsyncWithOptions("DESCRIBE <http://example.org/s>");
      expect(result.query.type).toBe("query");
      // describeOptions may be undefined for simple DESCRIBE
    });
  });

  describe("parseWithOptions", () => {
    it("returns ParseResult for DESCRIBE query with options", () => {
      const result = parser.parseWithOptions("DESCRIBE DEPTH 3 <http://example.org/s>");
      expect(result.query).toBeDefined();
      expect(result.describeOptions).toBeDefined();
      expect(result.describeOptions?.depth).toBe(3);
    });
  });

  describe("hasPrefixStar", () => {
    it("returns true for PREFIX* declarations", () => {
      expect(parser.hasPrefixStar("PREFIX* <http://schema.org/>\nSELECT * WHERE { ?s ?p ?o }")).toBe(true);
    });

    it("returns false for regular PREFIX", () => {
      expect(parser.hasPrefixStar("PREFIX ex: <http://example.org/>\nSELECT * WHERE { ?s ?p ?o }")).toBe(false);
    });
  });

  describe("hasLateral", () => {
    it("returns true for LATERAL keyword", () => {
      expect(parser.hasLateral("SELECT * WHERE { ?s ?p ?o . LATERAL { SELECT * WHERE { ?a ?b ?c } } }")).toBe(true);
    });

    it("returns false without LATERAL", () => {
      expect(parser.hasLateral("SELECT * WHERE { ?s ?p ?o }")).toBe(false);
    });
  });

  describe("getDirectionForLanguage", () => {
    it("returns direction after parsing directional language tags", () => {
      parser.parse(`
        SELECT * WHERE {
          ?s <http://example.org/label> "مرحبا"@ar--rtl .
        }
      `);

      expect(parser.getDirectionForLanguage("ar")).toBe("rtl");
    });

    it("returns undefined for unknown language", () => {
      parser.parse("SELECT * WHERE { ?s ?p ?o }");
      expect(parser.getDirectionForLanguage("xx")).toBeUndefined();
    });
  });

  describe("toString", () => {
    it("serializes parsed query back to string", () => {
      const query = parser.parse("SELECT * WHERE { ?s ?p ?o }");
      const result = parser.toString(query);
      expect(result).toContain("SELECT");
      expect(result).toContain("WHERE");
    });

    it("serializes various query types", () => {
      const queries = [
        "SELECT * WHERE { ?s ?p ?o }",
        "ASK WHERE { ?s ?p ?o }",
        "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }",
      ];
      for (const q of queries) {
        const parsed = parser.parse(q);
        const result = parser.toString(parsed);
        expect(typeof result).toBe("string");
      }
    });
  });

  describe("getQueryType", () => {
    it("returns SELECT for select query", () => {
      const query = parser.parse("SELECT * WHERE { ?s ?p ?o }");
      expect(parser.getQueryType(query)).toBe("SELECT");
    });

    it("returns CONSTRUCT for construct query", () => {
      const query = parser.parse("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");
      expect(parser.getQueryType(query)).toBe("CONSTRUCT");
    });

    it("throws for update query", () => {
      const query = parser.parse("INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }");
      expect(() => parser.getQueryType(query)).toThrow("Query does not have a valid queryType property");
    });
  });

  describe("query type checks", () => {
    it("isSelectQuery", () => {
      const q = parser.parse("SELECT * WHERE { ?s ?p ?o }");
      expect(parser.isSelectQuery(q)).toBe(true);
      expect(parser.isConstructQuery(q)).toBe(false);
      expect(parser.isAskQuery(q)).toBe(false);
      expect(parser.isDescribeQuery(q)).toBe(false);
    });

    it("isConstructQuery", () => {
      const q = parser.parse("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");
      expect(parser.isConstructQuery(q)).toBe(true);
    });

    it("isAskQuery", () => {
      const q = parser.parse("ASK WHERE { ?s ?p ?o }");
      expect(parser.isAskQuery(q)).toBe(true);
    });

    it("isDescribeQuery", () => {
      const q = parser.parse("DESCRIBE <http://example.org/s>");
      expect(parser.isDescribeQuery(q)).toBe(true);
    });

    it("isUpdateQuery", () => {
      const q = parser.parse("INSERT DATA { <http://example.org/s> <http://example.org/p> <http://example.org/o> }");
      expect(parser.isUpdateQuery(q)).toBe(true);
    });

    it("isInsertDataOperation", () => {
      const q = parser.parse("INSERT DATA { <http://s> <http://p> <http://o> }");
      if (parser.isUpdateQuery(q)) {
        expect(parser.isInsertDataOperation(q.updates[0])).toBe(true);
        expect(parser.isDeleteDataOperation(q.updates[0])).toBe(false);
      }
    });

    it("isDeleteDataOperation", () => {
      const q = parser.parse("DELETE DATA { <http://s> <http://p> <http://o> }");
      if (parser.isUpdateQuery(q)) {
        expect(parser.isDeleteDataOperation(q.updates[0])).toBe(true);
        expect(parser.isInsertDataOperation(q.updates[0])).toBe(false);
      }
    });
  });

  describe("vault prefix support", () => {
    it("sets vault prefixes and uses them in parsing", () => {
      const prefixes = new Map([
        ["kitelev", "http://example.org/kitelev/"],
      ]);
      parser.setVaultPrefixes(prefixes);

      // Should not throw - the prefix is resolved
      const q = parser.parse("SELECT * WHERE { kitelev:task1 ?p ?o }");
      expect(q.type).toBe("query");
    });
  });

  describe("DESCRIBE query with options attached", () => {
    it("attaches DESCRIBE options to parsed query", () => {
      const q = parser.parse("DESCRIBE DEPTH 2 SYMMETRIC <http://example.org/s>");
      expect(q.type).toBe("query");
      // describeOptions should be accessible via getLastDescribeOptions
      const options = parser.getLastDescribeOptions();
      expect(options?.depth).toBe(2);
      expect(options?.symmetric).toBe(true);
    });
  });
});
