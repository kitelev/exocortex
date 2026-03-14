import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import type { ConstructOperation } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("CONSTRUCT LIMIT/OFFSET", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    // Add 5 tasks
    for (let i = 1; i <= 5; i++) {
      await tripleStore.addAll([
        new Triple(
          new IRI(`http://example.org/task${i}`),
          new IRI("http://example.org/type"),
          new IRI("http://example.org/Task")
        ),
        new Triple(
          new IRI(`http://example.org/task${i}`),
          new IRI("http://example.org/label"),
          new Literal(`Task ${i}`)
        ),
      ]);
    }
  });

  describe("AlgebraTranslator - CONSTRUCT with LIMIT", () => {
    it("should translate CONSTRUCT with LIMIT into algebra with slice", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/derived> "true" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
        LIMIT 2
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;

      expect(algebra.type).toBe("construct");
      expect(algebra.where.type).toBe("slice");
      expect((algebra.where as any).limit).toBe(2);
    });

    it("should translate CONSTRUCT with OFFSET into algebra with slice", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/derived> "true" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
        OFFSET 1
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;

      expect(algebra.type).toBe("construct");
      expect(algebra.where.type).toBe("slice");
      expect((algebra.where as any).offset).toBe(1);
    });

    it("should translate CONSTRUCT with LIMIT and OFFSET", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/derived> "true" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
        LIMIT 2
        OFFSET 1
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;

      expect(algebra.type).toBe("construct");
      expect(algebra.where.type).toBe("slice");
      expect((algebra.where as any).limit).toBe(2);
      expect((algebra.where as any).offset).toBe(1);
    });

    it("should NOT add slice when no LIMIT/OFFSET specified", () => {
      const query = `
        CONSTRUCT {
          ?s <http://example.org/derived> "true" .
        }
        WHERE {
          ?s <http://example.org/type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;

      expect(algebra.type).toBe("construct");
      expect(algebra.where.type).not.toBe("slice");
    });
  });

  describe("QueryExecutor - CONSTRUCT with LIMIT execution", () => {
    it("should limit the number of output triples via LIMIT", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/isTask> "true" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
        LIMIT 2
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      // 5 tasks exist, but LIMIT 2 should limit WHERE solutions to 2
      expect(triples).toHaveLength(2);
    });

    it("should skip solutions via OFFSET", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/isTask> "true" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
        LIMIT 2
        OFFSET 3
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      // 5 tasks, skip 3, take 2 → 2 triples
      expect(triples).toHaveLength(2);
    });

    it("should return fewer triples when OFFSET + LIMIT exceeds total", async () => {
      const query = `
        CONSTRUCT {
          ?task <http://example.org/isTask> "true" .
        }
        WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
        }
        LIMIT 10
        OFFSET 4
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as ConstructOperation;
      const triples = await executor.executeConstruct(algebra);

      // 5 tasks, skip 4, take up to 10 → only 1 triple
      expect(triples).toHaveLength(1);
    });

    it("should return all triples without LIMIT", async () => {
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

      expect(triples).toHaveLength(5);
    });
  });
});
