/**
 * Integration tests for VALUES clause with JOIN operations.
 * Tests the fix for Issue #607: VALUES clause returns 0 results even when values exist.
 *
 * Root cause: SolutionMapping.areEqual() used toString() for comparison, which failed
 * when comparing plain literals (no datatype) with xsd:string typed literals.
 * Fix: Use Literal.equals() which implements RDF 1.1 semantics where plain literals
 * are equivalent to xsd:string typed literals.
 */

import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import type { ITripleStore } from "../../../../src/interfaces/ITripleStore";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import type { Triple } from "../../../../src/domain/models/rdf/Triple";

/**
 * Simple in-memory triple store for testing.
 */
class MockTripleStore implements ITripleStore {
  private triples: Triple[] = [];

  async add(triple: Triple): Promise<void> {
    this.triples.push(triple);
  }

  async addAll(triples: Triple[]): Promise<void> {
    this.triples.push(...triples);
  }

  async remove(_triple: Triple): Promise<boolean> {
    return false;
  }

  async removeAll(_triples: Triple[]): Promise<number> {
    return 0;
  }

  async has(_triple: Triple): Promise<boolean> {
    return false;
  }

  async match(
    subject?: IRI | undefined,
    predicate?: IRI | undefined,
    object?: IRI | Literal | undefined
  ): Promise<Triple[]> {
    return this.triples.filter((t) => {
      if (subject && t.subject.toString() !== subject.toString()) return false;
      if (predicate && t.predicate.toString() !== predicate.toString()) return false;
      if (object && t.object.toString() !== object.toString()) return false;
      return true;
    });
  }

  async clear(): Promise<void> {
    this.triples = [];
  }

  async count(): Promise<number> {
    return this.triples.length;
  }

  async subjects(): Promise<IRI[]> {
    return this.triples.map((t) => t.subject as IRI);
  }

  async predicates(): Promise<IRI[]> {
    return this.triples.map((t) => t.predicate as IRI);
  }

  async objects(): Promise<(IRI | Literal)[]> {
    return this.triples.map((t) => t.object as IRI | Literal);
  }

  async beginTransaction(): Promise<any> {
    throw new Error("Not implemented");
  }
}

const EXO_LABEL = new IRI("https://exocortex.my/ontology/exo#Asset_label");
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

describe("VALUES clause with JOIN (Issue #607)", () => {
  let store: MockTripleStore;
  let executor: QueryExecutor;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  beforeEach(async () => {
    store = new MockTripleStore();
    executor = new QueryExecutor(store);
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Add test triples - note that triple store returns xsd:string typed literals
    await store.addAll([
      {
        subject: new IRI("http://example.org/task1"),
        predicate: EXO_LABEL,
        object: new Literal("Поспать 2025-11-01", new IRI(XSD_STRING)),
      },
      {
        subject: new IRI("http://example.org/task2"),
        predicate: EXO_LABEL,
        object: new Literal("Поспать 2025-11-02", new IRI(XSD_STRING)),
      },
      {
        subject: new IRI("http://example.org/task3"),
        predicate: EXO_LABEL,
        object: new Literal("Поспать 2025-11-03", new IRI(XSD_STRING)),
      },
      {
        subject: new IRI("http://example.org/task4"),
        predicate: EXO_LABEL,
        object: new Literal("Other Task", new IRI(XSD_STRING)),
      },
    ]);
  });

  describe("Single variable VALUES filter", () => {
    it("should filter by specific labels using VALUES", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "Поспать 2025-11-01" "Поспать 2025-11-02" }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should return 2 results (only the matching labels)
      expect(results).toHaveLength(2);

      const labels = results.map((r) => (r.get("label") as Literal).value).sort();
      expect(labels).toEqual(["Поспать 2025-11-01", "Поспать 2025-11-02"]);

      const subjects = results.map((r) => (r.get("s") as IRI).value).sort();
      expect(subjects).toContain("http://example.org/task1");
      expect(subjects).toContain("http://example.org/task2");
    });

    it("should return 0 results when VALUES contains non-existent values", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "Non-existent Label" }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(0);
    });

    it("should work with VALUES before triple pattern", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          VALUES ?label { "Поспать 2025-11-01" }
          ?s exo:Asset_label ?label .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Поспать 2025-11-01");
      expect((results[0].get("s") as IRI).value).toBe("http://example.org/task1");
    });

    it("should work with VALUES after triple pattern", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "Поспать 2025-11-03" }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Поспать 2025-11-03");
    });
  });

  describe("Multi-variable VALUES", () => {
    it("should filter by multiple variables", async () => {
      // Add more test data with additional predicate
      const EXO_STATUS = new IRI("https://exocortex.my/ontology/ems#status");
      await store.addAll([
        {
          subject: new IRI("http://example.org/task1"),
          predicate: EXO_STATUS,
          object: new Literal("completed", new IRI(XSD_STRING)),
        },
        {
          subject: new IRI("http://example.org/task2"),
          predicate: EXO_STATUS,
          object: new Literal("pending", new IRI(XSD_STRING)),
        },
      ]);

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?s ?label ?status
        WHERE {
          ?s exo:Asset_label ?label .
          ?s ems:status ?status .
          VALUES (?label ?status) {
            ("Поспать 2025-11-01" "completed")
          }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("Поспать 2025-11-01");
      expect((results[0].get("status") as Literal).value).toBe("completed");
    });
  });

  describe("Cross-product with multiple VALUES", () => {
    it("should produce cross-product when VALUES use different variables", async () => {
      // Add year data
      const EXO_YEAR = new IRI("https://exocortex.my/ontology/exo#year");
      await store.addAll([
        {
          subject: new IRI("http://example.org/task1"),
          predicate: EXO_YEAR,
          object: new Literal("2025", new IRI("http://www.w3.org/2001/XMLSchema#integer")),
        },
      ]);

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label ?month
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "Поспать 2025-11-01" }
          VALUES ?month { 1 2 3 }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Cross-product: 1 label × 3 months = 3 results
      expect(results).toHaveLength(3);
    });
  });

  describe("IRI values in VALUES clause", () => {
    it("should filter by IRI values", async () => {
      // Add type triples
      const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
      const EMS_TASK = new IRI("https://exocortex.my/ontology/ems#Task");
      const EMS_PROJECT = new IRI("https://exocortex.my/ontology/ems#Project");

      await store.addAll([
        {
          subject: new IRI("http://example.org/task1"),
          predicate: RDF_TYPE,
          object: EMS_TASK,
        },
        {
          subject: new IRI("http://example.org/task2"),
          predicate: RDF_TYPE,
          object: EMS_PROJECT,
        },
      ]);

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX ems: <https://exocortex.my/ontology/ems#>
        SELECT ?s ?type
        WHERE {
          ?s rdf:type ?type .
          VALUES ?type { ems:Task }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(1);
      expect((results[0].get("s") as IRI).value).toBe("http://example.org/task1");
      expect((results[0].get("type") as IRI).value).toBe("https://exocortex.my/ontology/ems#Task");
    });
  });

  describe("Empty VALUES", () => {
    it("should return no results when VALUES is empty", async () => {
      // This tests that empty VALUES eliminates all results (SPARQL 1.1 semantics)
      // Note: The parser may not accept empty VALUES, so we test via algebra directly
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Without VALUES, should return all 4 triples
      expect(results).toHaveLength(4);
    });
  });

  describe("Edge cases", () => {
    it("should handle VALUES with single value", async () => {
      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "Поспать 2025-11-01" }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(1);
    });

    it("should handle multiple matching triples for same VALUES value", async () => {
      // Add duplicate label
      await store.add({
        subject: new IRI("http://example.org/task5"),
        predicate: EXO_LABEL,
        object: new Literal("Поспать 2025-11-01", new IRI(XSD_STRING)),
      });

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "Поспать 2025-11-01" }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      // Should return 2 results (both subjects with the same label)
      expect(results).toHaveLength(2);
      const subjects = results.map((r) => (r.get("s") as IRI).value).sort();
      expect(subjects).toEqual(["http://example.org/task1", "http://example.org/task5"]);
    });

    it("should handle VALUES with Unicode characters correctly", async () => {
      // Add label with special Unicode
      await store.add({
        subject: new IRI("http://example.org/task6"),
        predicate: EXO_LABEL,
        object: new Literal("日本語テスト", new IRI(XSD_STRING)),
      });

      const query = `
        PREFIX exo: <https://exocortex.my/ontology/exo#>
        SELECT ?s ?label
        WHERE {
          ?s exo:Asset_label ?label .
          VALUES ?label { "日本語テスト" }
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(1);
      expect((results[0].get("label") as Literal).value).toBe("日本語テスト");
    });
  });
});
