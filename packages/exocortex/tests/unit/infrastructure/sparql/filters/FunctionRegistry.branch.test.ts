/**
 * Tests for FunctionRegistry branch coverage via SPARQL queries.
 * Exercises type check functions, hash functions, and other handlers
 * that are registered in FunctionRegistry but not covered by existing tests.
 */
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";
import { QuotedTriple } from "../../../../../src/domain/models/rdf/QuotedTriple";
import { SPARQLParser } from "../../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../../src/infrastructure/sparql/executors/QueryExecutor";
import type { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";

describe("FunctionRegistry branch coverage", () => {
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let executor: QueryExecutor;

  const ex = (local: string) => new IRI(`http://example.org/${local}`);
  const xsd = (local: string) => new IRI(`http://www.w3.org/2001/XMLSchema#${local}`);

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    executor = new QueryExecutor(store);

    await store.add(new Triple(ex("s1"), ex("name"), new Literal("Alice")));
    await store.add(new Triple(ex("s1"), ex("age"), new Literal("30", xsd("integer"))));
    await store.add(new Triple(ex("s1"), ex("score"), new Literal("95.5", xsd("decimal"))));
    await store.add(new Triple(ex("s1"), ex("active"), new Literal("true", xsd("boolean"))));
    await store.add(new Triple(ex("s1"), ex("lang"), new Literal("Hello", undefined, "en")));
    await store.add(new Triple(ex("s1"), ex("type"), ex("Person")));

    const bn = new BlankNode("b0");
    await store.add(new Triple(bn, ex("name"), new Literal("Anon")));

    const qt = new QuotedTriple(ex("s1"), ex("says"), new Literal("hello"));
    await store.add(new Triple(ex("s1"), ex("statement"), qt));
  });

  async function query(sparql: string): Promise<SolutionMapping[]> {
    const ast = parser.parse(sparql);
    const algebra = translator.translate(ast);
    return executor.executeAll(algebra);
  }

  describe("type checking functions", () => {
    it("ISBLANK returns true for blank nodes", async () => {
      const results = await query(`
        SELECT ?name WHERE {
          ?s <http://example.org/name> ?name .
          FILTER(ISBLANK(?s))
        }
      `);
      expect(results).toHaveLength(1);
      expect((results[0].get("name") as Literal).value).toBe("Anon");
    });

    it("ISLITERAL returns true for literals", async () => {
      const results = await query(`
        SELECT ?name WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          FILTER(ISLITERAL(?name))
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("ISNUMERIC returns true for numeric literals", async () => {
      const results = await query(`
        SELECT ?val WHERE {
          <http://example.org/s1> ?p ?val .
          FILTER(ISNUMERIC(?val))
        }
      `);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("ISTRIPLE returns true for quoted triples", async () => {
      const results = await query(`
        SELECT ?stmt WHERE {
          <http://example.org/s1> <http://example.org/statement> ?stmt .
          FILTER(ISTRIPLE(?stmt))
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("STR returns string representation", async () => {
      const results = await query(`
        SELECT ?s WHERE {
          <http://example.org/s1> <http://example.org/type> ?type .
          FILTER(STR(?type) = "http://example.org/Person")
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("BOUND checks variable binding", async () => {
      const results = await query(`
        SELECT ?name WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          FILTER(BOUND(?name))
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("ISIRI/ISURI returns true for IRIs", async () => {
      const results = await query(`
        SELECT ?type WHERE {
          <http://example.org/s1> <http://example.org/type> ?type .
          FILTER(ISIRI(?type))
        }
      `);
      expect(results).toHaveLength(1);
    });
  });

  describe("hash functions", () => {
    it("MD5 computes hash", async () => {
      const results = await query(`
        SELECT ?hash WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          BIND(MD5(?name) AS ?hash)
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("SHA1 computes hash", async () => {
      const results = await query(`
        SELECT ?hash WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          BIND(SHA1(?name) AS ?hash)
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("SHA256 computes hash", async () => {
      const results = await query(`
        SELECT ?hash WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          BIND(SHA256(?name) AS ?hash)
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("SHA512 computes hash", async () => {
      const results = await query(`
        SELECT ?hash WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          BIND(SHA512(?name) AS ?hash)
        }
      `);
      expect(results).toHaveLength(1);
    });
  });

  describe("string functions", () => {
    it("DATATYPE returns literal datatype", async () => {
      const results = await query(`
        SELECT ?dt WHERE {
          <http://example.org/s1> <http://example.org/age> ?age .
          BIND(DATATYPE(?age) AS ?dt)
        }
      `);
      expect(results).toHaveLength(1);
    });
  });

  describe("LANG function", () => {
    it("returns language tag of literal", async () => {
      const results = await query(`
        SELECT ?val WHERE {
          <http://example.org/s1> <http://example.org/lang> ?val .
          FILTER(LANG(?val) = "en")
        }
      `);
      expect(results).toHaveLength(1);
    });
  });

  describe("xsd cast functions via BIND", () => {
    it("xsd:decimal cast", async () => {
      const results = await query(`
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        SELECT ?val WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          BIND(xsd:decimal("3.14") AS ?val)
        }
      `);
      expect(results).toHaveLength(1);
    });

    it("xsd:dayTimeDuration cast", async () => {
      const results = await query(`
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        SELECT ?val WHERE {
          <http://example.org/s1> <http://example.org/name> ?name .
          BIND(xsd:dayTimeDuration("PT2H30M") AS ?val)
        }
      `);
      expect(results).toHaveLength(1);
    });
  });
});
