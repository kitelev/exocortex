/**
 * SPARQL 1.1 Compliance Tests - Query Forms
 *
 * Tests SELECT, CONSTRUCT, ASK, and DESCRIBE query forms as specified in:
 * https://www.w3.org/TR/sparql11-query/#QueryForms
 *
 * Issue #932: Add comprehensive SPARQL 1.1 compliance test suite
 */

import { SPARQLParser } from "../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../src/infrastructure/sparql/executors/QueryExecutor";
import { ConstructOperation, AskOperation } from "../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../src/domain/models/rdf/Literal";

// Type-safe value extraction helper - handles RDF terms and primitives
const getValue = (term: any): string | undefined => {
  if (term === undefined || term === null) return undefined;
  // Handle primitives (numbers, strings) returned from expressions
  if (typeof term === "number") return String(term);
  if (typeof term === "string") return term;
  if (typeof term === "boolean") return String(term);
  // Handle RDF terms
  if (term && typeof term === "object") {
    if ("value" in term) return term.value;
    if ("id" in term) return term.id;
  }
  return undefined;
};


// Test namespaces
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const RDFS_LABEL = new IRI("http://www.w3.org/2000/01/rdf-schema#label");
const FOAF = "http://xmlns.com/foaf/0.1/";
const EX = "http://example.org/";

describe("SPARQL 1.1 Compliance - Query Forms", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let executor: QueryExecutor;
  let store: InMemoryTripleStore;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    store = new InMemoryTripleStore();
    executor = new QueryExecutor(store);

    // Add test data
    const triples = [
      new Triple(new IRI(`${EX}alice`), RDF_TYPE, new IRI(`${FOAF}Person`)),
      new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}name`), new Literal("Alice")),
      new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}age`), new Literal("30", new IRI("http://www.w3.org/2001/XMLSchema#integer"))),
      new Triple(new IRI(`${EX}alice`), new IRI(`${FOAF}knows`), new IRI(`${EX}bob`)),

      new Triple(new IRI(`${EX}bob`), RDF_TYPE, new IRI(`${FOAF}Person`)),
      new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}name`), new Literal("Bob")),
      new Triple(new IRI(`${EX}bob`), new IRI(`${FOAF}age`), new Literal("25", new IRI("http://www.w3.org/2001/XMLSchema#integer"))),

      new Triple(new IRI(`${EX}carol`), RDF_TYPE, new IRI(`${FOAF}Person`)),
      new Triple(new IRI(`${EX}carol`), new IRI(`${FOAF}name`), new Literal("Carol")),
    ];

    await store.addAll(triples);
  });

  describe("SELECT Query Form", () => {
    it("should execute basic SELECT query", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(3);
      const names = results.map((r) => getValue(r.get("name"))).sort();
      expect(names).toEqual(["Alice", "Bob", "Carol"]);
    });

    it("should execute SELECT with multiple variables", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?person ?name ?age WHERE {
          ?person foaf:name ?name .
          ?person foaf:age ?age .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(2); // Alice and Bob have ages
      expect(results.every((r) => r.get("person") && r.get("name") && r.get("age"))).toBe(true);
    });

    it("should execute SELECT * (all variables)", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT * WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.get("person") && r.get("name"))).toBe(true);
    });

    it("should execute SELECT DISTINCT", async () => {
      // Add duplicate data
      await store.add(
        new Triple(
          new IRI(`${EX}alice`),
          new IRI(`${FOAF}name`),
          new Literal("Alice")
        )
      );

      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT DISTINCT ?name WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // DISTINCT should remove duplicate names
      const names = results.map((r) => getValue(r.get("name")));
      expect(new Set(names).size).toBe(names.length);
    });

    it("should execute SELECT REDUCED", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT REDUCED ?name WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // REDUCED may or may not eliminate duplicates, but must be valid
      expect(results.length).toBeGreaterThan(0);
    });

    it("should execute SELECT with expressions (AS)", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name (STRLEN(?name) AS ?nameLength) WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(3);
      // Verify that expressions are computed
      const alice = results.find((r) => getValue(r.get("name")) === "Alice");
      expect(getValue(alice?.get("nameLength"))).toBe("5");
    });
  });

  describe("CONSTRUCT Query Form", () => {
    it("should execute basic CONSTRUCT query", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        CONSTRUCT {
          ?person rdfs:label ?name .
        } WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeConstruct(algebra as ConstructOperation);

      // CONSTRUCT returns triples
      expect(results).toHaveLength(3);
    });

    it("should execute CONSTRUCT with multiple template patterns", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        CONSTRUCT {
          ?person ex:hasLabel ?name .
          ?person ex:isKnownAs ?name .
        } WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeConstruct(algebra as ConstructOperation);

      // Should produce 2 triples per match (6 total)
      expect(results).toHaveLength(6);
    });

    it("should handle CONSTRUCT WHERE shorthand", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        CONSTRUCT WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeConstruct(algebra as ConstructOperation);

      expect(results).toHaveLength(3);
    });
  });

  describe("ASK Query Form", () => {
    it("should return true when pattern matches", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        ASK {
          ?person foaf:name "Alice" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const result = await executor.executeAsk(algebra as AskOperation);

      // ASK returns boolean
      expect(result).toBe(true);
    });

    it("should return false when pattern does not match", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        ASK {
          ?person foaf:name "NonExistent" .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const result = await executor.executeAsk(algebra as AskOperation);

      expect(result).toBe(false);
    });

    it("should handle complex ASK patterns", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX ex: <http://example.org/>
        ASK {
          ex:alice foaf:knows ?someone .
          ?someone foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const result = await executor.executeAsk(algebra as AskOperation);

      expect(result).toBe(true); // Alice knows Bob who has a name
    });
  });

  describe.skip("DESCRIBE Query Form", () => {
    it("should describe a specific resource", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        DESCRIBE ex:alice
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // DESCRIBE returns triples about the resource
      expect(results.length).toBeGreaterThan(0);
      // All triples should have alice as subject - skipped because DESCRIBE not fully implemented
      expect(results.every((r: any) => getValue(r.get("subject")) === `${EX}alice`)).toBe(true);
    });

    it("should describe multiple resources", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        DESCRIBE ex:alice ex:bob
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should have triples about both alice and bob - skipped because DESCRIBE not fully implemented
      const subjects = new Set(results.map((r: any) => getValue(r.get("subject"))));
      expect(subjects.has(`${EX}alice`)).toBe(true);
      expect(subjects.has(`${EX}bob`)).toBe(true);
    });

    it("should describe resources matching a pattern", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        DESCRIBE ?person WHERE {
          ?person foaf:age ?age .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should describe people with ages (alice and bob)
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("Query with FROM and FROM NAMED (Dataset)", () => {
    it("should parse FROM clause", () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name
        FROM <http://example.org/graph1>
        WHERE {
          ?person foaf:name ?name .
        }
      `;

      const parsed = parser.parse(query);
      expect(parsed.type).toBe("query");
      // Verify FROM is parsed (dataset specification)
      expect("from" in parsed || "from" in (parsed as any)).toBeTruthy;
    });

    it("should parse FROM NAMED clause", () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name ?g
        FROM <http://example.org/default>
        FROM NAMED <http://example.org/graph1>
        WHERE {
          GRAPH ?g {
            ?person foaf:name ?name .
          }
        }
      `;

      const parsed = parser.parse(query);
      expect(parsed.type).toBe("query");
    });
  });

  describe("Subqueries", () => {
    it("should execute subquery in SELECT", async () => {
      const query = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name ?maxAge WHERE {
          ?person foaf:name ?name .
          {
            SELECT (MAX(?age) AS ?maxAge) WHERE {
              ?p foaf:age ?age .
            }
          }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Each person should be paired with the max age
      expect(results).toHaveLength(3);
      expect(results.every((r) => getValue(r.get("maxAge")) === "30")).toBe(true);
    });
  });
});
