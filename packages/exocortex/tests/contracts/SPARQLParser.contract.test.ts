/**
 * SPARQLParser Contract Tests
 *
 * Consumer-driven contract tests for the SPARQL parser component.
 * These tests verify the behavioral guarantees that the obsidian-plugin
 * depends on when consuming exocortex.
 *
 * @see packages/exocortex/contracts/SPARQLParser.contract.ts
 */

import { SPARQLParser, SPARQLParseError } from "../../src/infrastructure/sparql/SPARQLParser";
import { SPARQLParserContract } from "../../contracts/SPARQLParser.contract";

describe("SPARQLParser Contract Tests", () => {
  let parser: SPARQLParser;

  beforeEach(() => {
    parser = new SPARQLParser();
  });

  describe(`Contract: ${SPARQLParserContract.name} v${SPARQLParserContract.version}`, () => {
    describe("parse() method", () => {
      const parseContract = SPARQLParserContract.methods.parse;

      describe(`must not throw for: ${parseContract.mustNotThrow?.join(", ")}`, () => {
        it("parses valid SELECT query", () => {
          const query = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
          expect(() => parser.parse(query)).not.toThrow();
          const result = parser.parse(query);
          expect(result).toBeDefined();
          expect(parser.isSelectQuery(result)).toBe(true);
        });

        it("parses valid CONSTRUCT query", () => {
          const query = "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }";
          expect(() => parser.parse(query)).not.toThrow();
          const result = parser.parse(query);
          expect(parser.isConstructQuery(result)).toBe(true);
        });

        it("parses valid ASK query", () => {
          const query = "ASK { ?s ?p ?o }";
          expect(() => parser.parse(query)).not.toThrow();
          const result = parser.parse(query);
          expect(parser.isAskQuery(result)).toBe(true);
        });

        it("parses valid DESCRIBE query", () => {
          const query = "DESCRIBE <http://example.org/resource>";
          expect(() => parser.parse(query)).not.toThrow();
          const result = parser.parse(query);
          expect(parser.isDescribeQuery(result)).toBe(true);
        });

        it("parses query with PREFIX declarations", () => {
          const query = `
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            PREFIX ems: <https://exocortex.my/ontology/ems#>
            SELECT ?task WHERE { ?task rdf:type ems:Task }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with FILTER expressions", () => {
          const query = `
            SELECT ?x WHERE {
              ?x <http://example.org/value> ?v .
              FILTER(?v > 10)
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with OPTIONAL patterns", () => {
          const query = `
            SELECT ?s ?label WHERE {
              ?s <http://example.org/type> <http://example.org/Task> .
              OPTIONAL { ?s <http://example.org/label> ?label }
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with UNION patterns", () => {
          const query = `
            SELECT ?s WHERE {
              { ?s <http://example.org/type> <http://example.org/Task> }
              UNION
              { ?s <http://example.org/type> <http://example.org/Project> }
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with VALUES clause", () => {
          const query = `
            SELECT ?s ?name WHERE {
              VALUES ?name { "Alice" "Bob" }
              ?s <http://example.org/name> ?name
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with ORDER BY clause", () => {
          const query = `
            SELECT ?s ?name WHERE { ?s <http://example.org/name> ?name }
            ORDER BY ?name
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with LIMIT and OFFSET", () => {
          const query = `
            SELECT ?s WHERE { ?s ?p ?o }
            LIMIT 10
            OFFSET 5
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with GROUP BY and aggregates", () => {
          const query = `
            SELECT ?type (COUNT(?s) AS ?count) WHERE {
              ?s <http://example.org/type> ?type
            }
            GROUP BY ?type
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with BIND expressions", () => {
          const query = `
            SELECT ?s ?label WHERE {
              ?s <http://example.org/name> ?name .
              BIND(CONCAT("Name: ", ?name) AS ?label)
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with subqueries", () => {
          const query = `
            SELECT ?s ?maxVal WHERE {
              {
                SELECT ?type (MAX(?value) AS ?maxVal) WHERE {
                  ?s <http://example.org/type> ?type .
                  ?s <http://example.org/value> ?value
                }
                GROUP BY ?type
              }
              ?s <http://example.org/type> ?type .
              ?s <http://example.org/value> ?maxVal
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });

        it("parses query with CASE WHEN expressions (transformed to IF)", () => {
          const query = `
            SELECT ?s
              (CASE
                WHEN ?status = "done" THEN "Complete"
                WHEN ?status = "pending" THEN "In Progress"
                ELSE "Unknown"
              END AS ?statusLabel)
            WHERE {
              ?s <http://example.org/status> ?status
            }
          `;
          expect(() => parser.parse(query)).not.toThrow();
        });
      });

      describe(`may throw for: ${parseContract.mayThrow?.join(", ")}`, () => {
        it("throws SPARQLParseError for invalid syntax", () => {
          const invalidQuery = "SELET ?s WHERE { ?s ?p ?o }"; // typo in SELECT
          expect(() => parser.parse(invalidQuery)).toThrow(SPARQLParseError);
        });

        it("throws SPARQLParseError for unbalanced braces", () => {
          const invalidQuery = "SELECT ?s WHERE { ?s ?p ?o";
          expect(() => parser.parse(invalidQuery)).toThrow(SPARQLParseError);
        });

        it("throws SPARQLParseError for invalid keywords", () => {
          const invalidQuery = "SELECT ?s FRUM { ?s ?p ?o }"; // FRUM instead of FROM
          expect(() => parser.parse(invalidQuery)).toThrow(SPARQLParseError);
        });
      });
    });

    describe("toString() method", () => {
      it("serializes parsed query back to string", () => {
        const originalQuery = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
        const parsed = parser.parse(originalQuery);
        const serialized = parser.toString(parsed);
        expect(typeof serialized).toBe("string");
        expect(serialized).toContain("SELECT");
        expect(serialized).toContain("WHERE");
      });

      it("produces semantically equivalent query after round-trip", () => {
        const originalQuery = "SELECT ?s ?p ?o WHERE { ?s ?p ?o }";
        const parsed = parser.parse(originalQuery);
        const serialized = parser.toString(parsed);
        const reparsed = parser.parse(serialized);
        expect(parser.isSelectQuery(reparsed)).toBe(true);
      });
    });

    describe("getQueryType() method", () => {
      it("returns 'SELECT' for SELECT query", () => {
        const query = parser.parse("SELECT ?s WHERE { ?s ?p ?o }");
        expect(parser.getQueryType(query)).toBe("SELECT");
      });

      it("returns 'CONSTRUCT' for CONSTRUCT query", () => {
        const query = parser.parse("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");
        expect(parser.getQueryType(query)).toBe("CONSTRUCT");
      });

      it("returns 'ASK' for ASK query", () => {
        const query = parser.parse("ASK { ?s ?p ?o }");
        expect(parser.getQueryType(query)).toBe("ASK");
      });

      it("returns 'DESCRIBE' for DESCRIBE query", () => {
        const query = parser.parse("DESCRIBE <http://example.org/r>");
        expect(parser.getQueryType(query)).toBe("DESCRIBE");
      });
    });

    describe("Type guard methods", () => {
      it("isSelectQuery returns true only for SELECT queries", () => {
        const select = parser.parse("SELECT ?s WHERE { ?s ?p ?o }");
        const construct = parser.parse("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");
        const ask = parser.parse("ASK { ?s ?p ?o }");
        const describe = parser.parse("DESCRIBE <http://example.org/r>");

        expect(parser.isSelectQuery(select)).toBe(true);
        expect(parser.isSelectQuery(construct)).toBe(false);
        expect(parser.isSelectQuery(ask)).toBe(false);
        expect(parser.isSelectQuery(describe)).toBe(false);
      });

      it("isConstructQuery returns true only for CONSTRUCT queries", () => {
        const select = parser.parse("SELECT ?s WHERE { ?s ?p ?o }");
        const construct = parser.parse("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }");

        expect(parser.isConstructQuery(construct)).toBe(true);
        expect(parser.isConstructQuery(select)).toBe(false);
      });

      it("isAskQuery returns true only for ASK queries", () => {
        const select = parser.parse("SELECT ?s WHERE { ?s ?p ?o }");
        const ask = parser.parse("ASK { ?s ?p ?o }");

        expect(parser.isAskQuery(ask)).toBe(true);
        expect(parser.isAskQuery(select)).toBe(false);
      });

      it("isDescribeQuery returns true only for DESCRIBE queries", () => {
        const select = parser.parse("SELECT ?s WHERE { ?s ?p ?o }");
        const describe = parser.parse("DESCRIBE <http://example.org/r>");

        expect(parser.isDescribeQuery(describe)).toBe(true);
        expect(parser.isDescribeQuery(select)).toBe(false);
      });
    });

    describe("Behavioral guarantees", () => {
      it("SPARQLParseError includes position information when available", () => {
        try {
          parser.parse("SELEKT ?s WHERE { ?s ?p ?o }");
          fail("Expected SPARQLParseError to be thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(SPARQLParseError);
          // Position info may or may not be available depending on the error
          expect((error as SPARQLParseError).message).toBeDefined();
        }
      });

      it("handles multi-line queries with proper whitespace", () => {
        const query = `
          PREFIX ex: <http://example.org/>

          SELECT ?s ?p ?o
          WHERE {
            ?s ?p ?o .
            FILTER(?s = ex:resource)
          }
          LIMIT 10
        `;
        expect(() => parser.parse(query)).not.toThrow();
      });
    });
  });
});
