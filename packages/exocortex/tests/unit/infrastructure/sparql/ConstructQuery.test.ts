import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import type { ConstructOperation } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("CONSTRUCT Query Support", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    // Add test triples
    await tripleStore.addAll([
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/type"),
        new IRI("http://example.org/Task")
      ),
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/status"),
        new Literal("completed")
      ),
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/label"),
        new Literal("First Task")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/type"),
        new IRI("http://example.org/Task")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/status"),
        new Literal("pending")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/label"),
        new Literal("Second Task")
      ),
    ]);
  });

  describe("AlgebraTranslator - CONSTRUCT parsing", () => {
    it("should parse simple CONSTRUCT query", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/derived> "true" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as ConstructOperation).template).toHaveLength(1);
      expect((algebra as ConstructOperation).where).toBeDefined();
    });

    it("should parse CONSTRUCT with multiple template triples", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/isTask> "true" .
          ?task <http://example.org/wasProcessed> "true" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      expect((algebra as ConstructOperation).template).toHaveLength(2);
    });

    it("should parse CONSTRUCT with PREFIX declarations", () => {
      const query = `
        PREFIX ex: <http://example.org/>
        CONSTRUCT {
          ?task ex:derived ex:processed .
        }
        WHERE {
          ?task ex:type ex:Task .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      const construct = algebra as ConstructOperation;
      expect(construct.template[0].predicate.type).toBe("iri");
      expect((construct.template[0].predicate as any).value).toBe("http://example.org/derived");
    });

    it("should parse CONSTRUCT with FILTER in WHERE clause", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/completed> "true" .
        }
        WHERE {
          ?task <http://example.org/status> ?status .
          FILTER(?status = "completed")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      const construct = algebra as ConstructOperation;
      expect(construct.where.type).toBe("filter");
    });

    it("should parse CONSTRUCT with BIND in WHERE clause", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/labelLength> ?len .
        }
        WHERE {
          ?task <http://example.org/label> ?label .
          BIND(STRLEN(?label) AS ?len)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
      const construct = algebra as ConstructOperation;
      expect(construct.where.type).toBe("extend");
    });

    it("should parse CONSTRUCT with OPTIONAL in WHERE clause", () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/hasStatus> ?status .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          OPTIONAL { ?task <http://example.org/status> ?status }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(algebra.type).toBe("construct");
    });

    it("should throw error for CONSTRUCT without WHERE clause", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/p> ?o .
        }
        WHERE { }
      `;
      const ast = parser.parse(query);
      expect(() => translator.translate(ast)).toThrow("CONSTRUCT query must have WHERE clause");
    });
  });

  describe("QueryExecutor - isConstructQuery", () => {
    it("should identify CONSTRUCT algebra as construct query", () => {
      const query = `
        CONSTRUCT { ?s <http://example.org/p> ?o . }
        WHERE { ?s <http://example.org/type> <http://example.org/Task> . }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(executor.isConstructQuery(algebra)).toBe(true);
    });

    it("should not identify SELECT algebra as construct query", () => {
      const query = `SELECT ?s WHERE { ?s <http://example.org/type> <http://example.org/Task> . }`;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(executor.isConstructQuery(algebra)).toBe(false);
    });
  });

  describe("QueryExecutor - executeConstruct", () => {
    it("should execute simple CONSTRUCT and return triples", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/isTask> "true" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(2); // 2 tasks
      triples.forEach((triple) => {
        expect(triple.predicate.value).toBe("http://example.org/isTask");
        expect((triple.object as Literal).value).toBe("true");
      });
    });

    it("should construct triples with variables substituted from WHERE results", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/hasLabel> ?label .
        }
        WHERE {
          ?task <http://example.org/label> ?label .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(2);

      const labels = triples.map((t) => (t.object as Literal).value);
      expect(labels).toContain("First Task");
      expect(labels).toContain("Second Task");
    });

    it("should deduplicate identical triples", async () => {
      // Add duplicate status values
      await tripleStore.add(
        new Triple(
          new IRI("http://example.org/task3"),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/Task")
        )
      );
      await tripleStore.add(
        new Triple(
          new IRI("http://example.org/task3"),
          new IRI("http://example.org/status"),
          new Literal("completed")
        )
      );

      const query = `
        CONSTRUCT {
          <http://example.org/status> <http://example.org/hasValue> ?status .
        }
        WHERE {
          ?task <http://example.org/status> ?status .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      // Should have 2 unique status values (completed and pending), not 3
      expect(triples).toHaveLength(2);
    });

    it("should handle CONSTRUCT with FILTER", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/isCompleted> "true" .
        }
        WHERE {
          ?task <http://example.org/status> ?status .
          FILTER(?status = "completed")
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(1);
      expect(triples[0].subject.value).toBe("http://example.org/task1");
    });

    it("should handle CONSTRUCT with BIND expression", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/uppercaseStatus> ?upperStatus .
        }
        WHERE {
          ?task <http://example.org/status> ?status .
          BIND(UCASE(?status) AS ?upperStatus)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(2);

      const statuses = triples.map((t) => (t.object as Literal).value);
      expect(statuses).toContain("COMPLETED");
      expect(statuses).toContain("PENDING");
    });

    it("should skip patterns with unbound variables", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/priority> ?priority .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          OPTIONAL { ?task <http://example.org/priority> ?priority }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      // No tasks have priority property, so no triples should be generated
      expect(triples).toHaveLength(0);
    });

    it("should return empty array when no matches found", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/found> "true" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/NonExistent> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(0);
    });

    it("should handle multiple template patterns", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/processed> "true" .
          ?task <http://example.org/processedAt> "2024-01-01" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      // 2 tasks × 2 template patterns = 4 triples
      expect(triples).toHaveLength(4);
    });
  });

  describe("Edge cases", () => {
    it("should handle CONSTRUCT with IRI as object", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/ProcessedTask> .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(2);
      triples.forEach((triple) => {
        expect(triple.object).toBeInstanceOf(IRI);
        expect((triple.object as IRI).value).toBe("http://example.org/ProcessedTask");
      });
    });

    it("should handle CONSTRUCT with literal containing language tag", async () => {
      await tripleStore.add(
        new Triple(
          new IRI("http://example.org/task1"),
          new IRI("http://example.org/labelEn"),
          new Literal("First Task", undefined, "en")
        )
      );

      const query = `
        CONSTRUCT {
          ?task <http://example.org/englishLabel> ?label .
        }
        WHERE {
          ?task <http://example.org/labelEn> ?label .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(1);
      const literal = triples[0].object as Literal;
      expect(literal.language).toBe("en");
    });

    it("should handle CONSTRUCT with typed literals", async () => {
      await tripleStore.add(
        new Triple(
          new IRI("http://example.org/task1"),
          new IRI("http://example.org/effort"),
          new Literal("60", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
        )
      );

      const query = `
        CONSTRUCT {
          ?task <http://example.org/hasEffort> ?effort .
        }
        WHERE {
          ?task <http://example.org/effort> ?effort .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      expect(triples).toHaveLength(1);
      const literal = triples[0].object as Literal;
      expect(literal.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
    });
  });
});
