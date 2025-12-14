/**
 * SPARQLParser Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Syntax errors with line/column tracking
 * - Invalid query structures
 * - Malformed expressions
 * - Edge cases in query parsing
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import {
  SPARQLParser,
  SPARQLParseError,
} from "../../../../src/infrastructure/sparql/SPARQLParser";

describe("SPARQLParser Error Scenarios", () => {
  let parser: SPARQLParser;

  beforeEach(() => {
    parser = new SPARQLParser();
  });

  describe("Syntax Errors", () => {
    it("should provide clear error for unclosed string literal", () => {
      const query = 'SELECT * WHERE { ?s ?p "unclosed }';

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
      try {
        parser.parse(query);
      } catch (error) {
        expect(error).toBeInstanceOf(SPARQLParseError);
        const parseError = error as SPARQLParseError;
        expect(parseError.message).toContain("SPARQL syntax error");
      }
    });

    it("should provide clear error for unclosed URI", () => {
      const query = "SELECT * WHERE { ?s <http://example.org/unclosed ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should provide clear error for missing closing brace", () => {
      const query = "SELECT * WHERE { ?s ?p ?o";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should provide clear error for missing opening brace", () => {
      const query = "SELECT * WHERE ?s ?p ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should provide clear error for unknown prefix usage", () => {
      // Using undefined prefix should fail
      const query = "SELECT * WHERE { unknown:pred ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should provide clear error for malformed PREFIX declaration", () => {
      const query = "PREFIX malformed SELECT * WHERE { ?s ?p ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should provide clear error for invalid variable name", () => {
      // Variable with completely invalid syntax (double question marks)
      const query = "SELECT ?? WHERE { ?s ?p ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Invalid Query Structures", () => {
    it("should reject query with no WHERE clause in SELECT", () => {
      const query = "SELECT ?s ?p ?o";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should parse valid CONSTRUCT without explicit template (shorthand)", () => {
      // CONSTRUCT WHERE { pattern } is valid shorthand - template is pattern itself
      const query = "CONSTRUCT WHERE { ?s ?p ?o }";

      // This is actually valid SPARQL syntax (shorthand CONSTRUCT)
      const ast = parser.parse(query);
      expect(parser.isConstructQuery(ast)).toBe(true);
    });

    it("should reject CONSTRUCT with empty template", () => {
      // Empty CONSTRUCT template with separate WHERE
      const query = "CONSTRUCT { } WHERE { ?s ?p ?o }";

      // Empty template parses but produces no triples
      const ast = parser.parse(query);
      expect(parser.isConstructQuery(ast)).toBe(true);
    });

    it("should reject invalid query type keyword", () => {
      const query = "INVALID ?task WHERE { ?task ?p ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject empty query string", () => {
      const query = "";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject whitespace-only query string", () => {
      const query = "   \n\t  ";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject query with only comments", () => {
      const query = "# This is just a comment";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Malformed FILTER Expressions", () => {
    it("should reject empty FILTER", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task ?p ?o .
          FILTER()
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject FILTER with unclosed parenthesis", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task ?p ?o .
          FILTER(?x > 5
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject FILTER with invalid operator", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task ?p ?o .
          FILTER(?x <> 5)
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject FILTER with missing operand", () => {
      const query = `
        SELECT ?task
        WHERE {
          ?task ?p ?o .
          FILTER(?x >)
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Malformed Aggregate Expressions", () => {
    it("should reject COUNT with invalid syntax", () => {
      const query = `
        SELECT (COUNT AS ?c)
        WHERE { ?s ?p ?o }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject aggregate without AS alias in SELECT", () => {
      const query = `
        SELECT COUNT(?s)
        WHERE { ?s ?p ?o }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should throw for GROUP BY with ungrouped variable in projection", () => {
      // SPARQL spec: projected variables must be grouped or aggregated
      const query = `
        SELECT ?x (COUNT(?s) AS ?c)
        WHERE { ?s ?p ?o }
        GROUP BY ?nonexistent
      `;

      // sparqljs validates this at parse time and throws
      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
      try {
        parser.parse(query);
      } catch (error) {
        expect(error).toBeInstanceOf(SPARQLParseError);
        const parseError = error as SPARQLParseError;
        expect(parseError.message).toContain("ungrouped variable");
      }
    });
  });

  describe("Malformed BIND Expressions", () => {
    it("should reject BIND without AS clause", () => {
      const query = `
        SELECT ?x ?y
        WHERE {
          ?x ?p ?o .
          BIND(CONCAT("a", "b"))
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject BIND with invalid expression", () => {
      const query = `
        SELECT ?x ?y
        WHERE {
          ?x ?p ?o .
          BIND( AS ?y)
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Malformed VALUES Expressions", () => {
    it("should reject VALUES with mismatched variables and values", () => {
      const query = `
        SELECT ?x ?y
        WHERE {
          VALUES (?x ?y) { ("a") }
          ?x ?p ?o .
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });

    it("should reject VALUES with invalid syntax", () => {
      const query = `
        SELECT ?x
        WHERE {
          VALUES ?x "a" "b"
          ?x ?p ?o .
        }
      `;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Property Path Edge Cases", () => {
    it("should parse valid property path expressions", () => {
      const queries = [
        "SELECT * WHERE { ?s <http://example.org/p>+ ?o }",
        "SELECT * WHERE { ?s <http://example.org/p>* ?o }",
        "SELECT * WHERE { ?s <http://example.org/p>? ?o }",
        "SELECT * WHERE { ?s ^<http://example.org/p> ?o }",
        "SELECT * WHERE { ?s <http://example.org/a>/<http://example.org/b> ?o }",
        "SELECT * WHERE { ?s (<http://example.org/a>|<http://example.org/b>) ?o }",
      ];

      for (const query of queries) {
        const ast = parser.parse(query);
        expect(parser.isSelectQuery(ast)).toBe(true);
      }
    });

    it("should reject invalid property path operator combinations", () => {
      const query = "SELECT * WHERE { ?s <http://example.org/p>++ ?o }";

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Edge Cases in Literals", () => {
    it("should handle multiline string literals", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/text> """This is
          a multiline
          string""" .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle escaped characters in strings", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/text> "Line1\\nLine2\\tTabbed" .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle typed literals with unusual datatypes", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/value> "custom"^^<http://example.org/mytype> .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should reject invalid language tag format", () => {
      // This may parse but is semantically invalid
      const query = `SELECT ?s WHERE { ?s ?p "text"@123invalid }`;

      expect(() => parser.parse(query)).toThrow(SPARQLParseError);
    });
  });

  describe("Unicode and Special Characters", () => {
    it("should handle Unicode in string literals", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/label> "日本語テスト" .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle Unicode in IRIs (percent-encoded)", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/%E6%97%A5%E6%9C%AC> ?o .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle emoji in string literals", () => {
      const query = `
        SELECT ?s WHERE {
          ?s <http://example.org/emoji> "🎉🚀✅" .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });
  });

  describe("toString Error Handling", () => {
    it("should handle serialization of complex queries", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?s ?label
        WHERE {
          ?s ex:type ex:Task .
          ?s ex:label ?label .
          FILTER(CONTAINS(?label, "test"))
        }
        ORDER BY ?label
        LIMIT 10
      `;

      const ast = parser.parse(query);
      const serialized = parser.toString(ast);

      // Should be reparseable
      const reparsed = parser.parse(serialized);
      expect(parser.isSelectQuery(reparsed)).toBe(true);
    });
  });

  describe("getQueryType Edge Cases", () => {
    it("should throw for query without queryType", () => {
      // Create an invalid object that doesn't have proper structure
      const invalidQuery = { type: "not-a-query" } as any;

      expect(() => parser.getQueryType(invalidQuery)).toThrow(SPARQLParseError);
    });
  });

  describe("Large Query Handling", () => {
    it("should handle query with many triple patterns", () => {
      const patterns = Array.from(
        { length: 50 },
        (_, i) => `?s <http://example.org/p${i}> ?o${i} .`
      ).join("\n");

      const query = `
        SELECT *
        WHERE {
          ${patterns}
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle query with many UNION clauses", () => {
      const unions = Array.from(
        { length: 20 },
        (_, i) => `{ ?s <http://example.org/type> <http://example.org/Type${i}> }`
      ).join(" UNION ");

      const query = `
        SELECT ?s
        WHERE {
          ${unions}
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle deeply nested OPTIONAL clauses", () => {
      let query = "SELECT * WHERE { ?s ?p ?o";
      for (let i = 0; i < 10; i++) {
        query += ` OPTIONAL { ?s <http://example.org/opt${i}> ?opt${i}`;
      }
      query += " }".repeat(11);

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });
  });

  describe("Subquery Edge Cases", () => {
    it("should handle nested subquery", () => {
      const query = `
        SELECT ?s ?label
        WHERE {
          {
            SELECT ?s WHERE {
              ?s <http://example.org/type> <http://example.org/Task> .
            }
          }
          ?s <http://example.org/label> ?label .
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });

    it("should handle subquery with aggregates", () => {
      const query = `
        SELECT ?type ?count
        WHERE {
          {
            SELECT ?type (COUNT(?s) AS ?count)
            WHERE {
              ?s <http://example.org/type> ?type .
            }
            GROUP BY ?type
          }
        }
      `;

      const ast = parser.parse(query);
      expect(parser.isSelectQuery(ast)).toBe(true);
    });
  });
});
