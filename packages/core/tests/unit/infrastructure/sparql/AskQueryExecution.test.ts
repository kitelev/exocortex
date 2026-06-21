import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor, QueryExecutorError } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import type { AskOperation } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("ASK Query Execution", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  const EX_TASK = new IRI("http://example.org/Task");
  const EX_PROJECT = new IRI("http://example.org/Project");
  const EX_AREA = new IRI("http://example.org/Area");
  const EX_STATUS = new IRI("http://example.org/status");
  const EX_EFFORT = new IRI("http://example.org/effort");

  beforeEach(() => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);
  });

  describe("Basic ASK execution", () => {
    it("returns true when pattern matches at least one solution", async () => {
      // Add a task to the triple store
      const task1 = new IRI("http://example.org/task1");
      await tripleStore.add(new Triple(task1, RDF_TYPE, EX_TASK));

      const query = `
        ASK WHERE {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      expect(executor.isAskQuery(algebra)).toBe(true);
      const result = await executor.executeAsk(algebra);
      expect(result).toBe(true);
    });

    it("returns false when pattern matches no solutions", async () => {
      // Triple store is empty
      const query = `
        ASK WHERE {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(false);
    });

    it("returns false when specific pattern does not match", async () => {
      // Add a task but with different type
      const task1 = new IRI("http://example.org/task1");
      await tripleStore.add(new Triple(task1, RDF_TYPE, EX_PROJECT));

      const query = `
        ASK WHERE {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(false);
    });
  });

  describe("ASK with multiple patterns (implicit JOIN)", () => {
    it("returns true when all patterns match", async () => {
      const task1 = new IRI("http://example.org/task1");
      await tripleStore.add(new Triple(task1, RDF_TYPE, EX_TASK));
      await tripleStore.add(new Triple(task1, EX_STATUS, new Literal("done")));

      const query = `
        ASK WHERE {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> .
          ?task <http://example.org/status> "done" .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(true);
    });

    it("returns false when one pattern does not match", async () => {
      const task1 = new IRI("http://example.org/task1");
      await tripleStore.add(new Triple(task1, RDF_TYPE, EX_TASK));
      await tripleStore.add(new Triple(task1, EX_STATUS, new Literal("active")));

      const query = `
        ASK WHERE {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> .
          ?task <http://example.org/status> "done" .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(false);
    });
  });

  describe("ASK with FILTER", () => {
    it("returns true when FILTER condition is satisfied", async () => {
      const task1 = new IRI("http://example.org/task1");
      await tripleStore.add(new Triple(
        task1,
        EX_EFFORT,
        new Literal("100", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
      ));

      const query = `
        ASK WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(true);
    });

    it("returns false when FILTER condition is not satisfied", async () => {
      const task1 = new IRI("http://example.org/task1");
      await tripleStore.add(new Triple(
        task1,
        EX_EFFORT,
        new Literal("30", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
      ));

      const query = `
        ASK WHERE {
          ?task <http://example.org/effort> ?effort .
          FILTER(?effort > 60)
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(false);
    });
  });

  describe("ASK with UNION", () => {
    it("returns true when left branch matches", async () => {
      const entity1 = new IRI("http://example.org/entity1");
      await tripleStore.add(new Triple(entity1, RDF_TYPE, EX_TASK));

      const query = `
        ASK WHERE {
          { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> }
          UNION
          { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Project> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(true);
    });

    it("returns true when right branch matches", async () => {
      const entity1 = new IRI("http://example.org/entity1");
      await tripleStore.add(new Triple(entity1, RDF_TYPE, EX_PROJECT));

      const query = `
        ASK WHERE {
          { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> }
          UNION
          { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Project> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(true);
    });

    it("returns false when neither branch matches", async () => {
      const entity1 = new IRI("http://example.org/entity1");
      await tripleStore.add(new Triple(entity1, RDF_TYPE, EX_AREA));

      const query = `
        ASK WHERE {
          { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> }
          UNION
          { ?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Project> }
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      const result = await executor.executeAsk(algebra);
      expect(result).toBe(false);
    });
  });

  describe("Early termination", () => {
    it("returns true after finding first match (early termination)", async () => {
      // Add multiple matching triples
      for (let i = 0; i < 100; i++) {
        const task = new IRI(`http://example.org/task${i}`);
        await tripleStore.add(new Triple(task, RDF_TYPE, EX_TASK));
      }

      const query = `
        ASK WHERE {
          ?task <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Task> .
        }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast) as AskOperation;

      // Should return true without iterating through all 100 triples
      const result = await executor.executeAsk(algebra);
      expect(result).toBe(true);
    });
  });

  describe("isAskQuery type guard", () => {
    it("returns true for ASK operations", () => {
      const query = "ASK WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(executor.isAskQuery(algebra)).toBe(true);
    });

    it("returns false for SELECT operations", () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(executor.isAskQuery(algebra)).toBe(false);
    });

    it("returns false for CONSTRUCT operations", () => {
      const query = `
        CONSTRUCT { ?s <http://example.org/p> "value" }
        WHERE { ?s ?p ?o }
      `;
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      expect(executor.isAskQuery(algebra)).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("throws error when executeAsk is called with non-ASK operation", async () => {
      const query = "SELECT ?s WHERE { ?s ?p ?o }";
      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      await expect(executor.executeAsk(algebra as AskOperation)).rejects.toThrow(QueryExecutorError);
      await expect(executor.executeAsk(algebra as AskOperation)).rejects.toThrow("executeAsk requires an ASK operation");
    });
  });
});
