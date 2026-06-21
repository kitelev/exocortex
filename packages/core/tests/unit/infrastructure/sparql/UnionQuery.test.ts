/**
 * End-to-end tests for SPARQL UNION operator (Issue #611)
 *
 * SPARQL 1.1 UNION combines solutions from alternative graph patterns.
 * Supports 2+ branches and is left-associative.
 */
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";

describe("UNION Query Execution (Issue #611)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    // Add test triples with different types
    await tripleStore.addAll([
      // Tasks
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Task")
      ),
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/label"),
        new Literal("First Task")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Task")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/label"),
        new Literal("Second Task")
      ),
      // Notes
      new Triple(
        new IRI("http://example.org/note1"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Note")
      ),
      new Triple(
        new IRI("http://example.org/note1"),
        new IRI("http://example.org/label"),
        new Literal("Important Note")
      ),
      // Projects
      new Triple(
        new IRI("http://example.org/project1"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Project")
      ),
      new Triple(
        new IRI("http://example.org/project1"),
        new IRI("http://example.org/label"),
        new Literal("Main Project")
      ),
      // Areas
      new Triple(
        new IRI("http://example.org/area1"),
        new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        new IRI("http://example.org/Area")
      ),
      new Triple(
        new IRI("http://example.org/area1"),
        new IRI("http://example.org/label"),
        new Literal("Work Area")
      ),
    ]);
  });

  describe("Binary UNION (2 branches)", () => {
    it("should return results from both branches", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity ?label
        WHERE {
          {
            ?entity rdf:type <http://example.org/Task> .
            ?entity <http://example.org/label> ?label
          }
          UNION
          {
            ?entity rdf:type <http://example.org/Note> .
            ?entity <http://example.org/label> ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Should get 2 tasks + 1 note = 3 results
      expect(results).toHaveLength(3);

      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("First Task");
      expect(labels).toContain("Second Task");
      expect(labels).toContain("Important Note");
    });

    it("should eliminate duplicates across branches", async () => {
      // Add a triple that makes same entity match both branches
      await tripleStore.add(
        new Triple(
          new IRI("http://example.org/task1"),
          new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          new IRI("http://example.org/Note")
        )
      );

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity
        WHERE {
          { ?entity rdf:type <http://example.org/Task> }
          UNION
          { ?entity rdf:type <http://example.org/Note> }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // task1 matches both branches but should appear once
      // task2, note1 = 3 total
      expect(results).toHaveLength(3);
    });

    it("should return empty if no branch matches", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity
        WHERE {
          { ?entity rdf:type <http://example.org/NonExistent> }
          UNION
          { ?entity rdf:type <http://example.org/AlsoNonExistent> }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(0);
    });

    it("should work with partial matches (only one branch matches)", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity
        WHERE {
          { ?entity rdf:type <http://example.org/Task> }
          UNION
          { ?entity rdf:type <http://example.org/NonExistent> }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Only Task branch matches
      expect(results).toHaveLength(2);
    });
  });

  describe("N-ary UNION (3+ branches)", () => {
    it("should handle 3-branch UNION", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity
        WHERE {
          { ?entity rdf:type <http://example.org/Task> }
          UNION
          { ?entity rdf:type <http://example.org/Note> }
          UNION
          { ?entity rdf:type <http://example.org/Project> }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // 2 tasks + 1 note + 1 project = 4 results
      expect(results).toHaveLength(4);
    });

    it("should handle 4-branch UNION", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity ?label
        WHERE {
          { ?entity rdf:type <http://example.org/Task> . ?entity <http://example.org/label> ?label }
          UNION
          { ?entity rdf:type <http://example.org/Note> . ?entity <http://example.org/label> ?label }
          UNION
          { ?entity rdf:type <http://example.org/Project> . ?entity <http://example.org/label> ?label }
          UNION
          { ?entity rdf:type <http://example.org/Area> . ?entity <http://example.org/label> ?label }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // 2 tasks + 1 note + 1 project + 1 area = 5 results
      expect(results).toHaveLength(5);

      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toContain("First Task");
      expect(labels).toContain("Second Task");
      expect(labels).toContain("Important Note");
      expect(labels).toContain("Main Project");
      expect(labels).toContain("Work Area");
    });
  });

  describe("UNION with FILTER", () => {
    it("should apply FILTER within UNION branch", async () => {
      // Add values for filtering
      await tripleStore.addAll([
        new Triple(
          new IRI("http://example.org/task1"),
          new IRI("http://example.org/priority"),
          new Literal("1", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
        ),
        new Triple(
          new IRI("http://example.org/task2"),
          new IRI("http://example.org/priority"),
          new Literal("5", new IRI("http://www.w3.org/2001/XMLSchema#integer"))
        ),
      ]);

      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity ?priority
        WHERE {
          {
            ?entity rdf:type <http://example.org/Task> .
            ?entity <http://example.org/priority> ?priority .
            FILTER(?priority > 2)
          }
          UNION
          {
            ?entity rdf:type <http://example.org/Note> .
            ?entity <http://example.org/label> ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Only task2 (priority=5 > 2) + note1 = 2 results
      expect(results).toHaveLength(2);
    });
  });

  describe("UNION with different variable bindings", () => {
    it("should handle disjoint variable sets", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?taskEntity ?noteEntity
        WHERE {
          { ?taskEntity rdf:type <http://example.org/Task> }
          UNION
          { ?noteEntity rdf:type <http://example.org/Note> }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // 2 tasks + 1 note = 3 results
      expect(results).toHaveLength(3);

      // Task results have taskEntity bound, not noteEntity
      // Note results have noteEntity bound, not taskEntity
      const taskResults = results.filter((r) => r.get("taskEntity") !== undefined);
      const noteResults = results.filter((r) => r.get("noteEntity") !== undefined);

      expect(taskResults).toHaveLength(2);
      expect(noteResults).toHaveLength(1);
    });
  });

  describe("UNION with ORDER BY and LIMIT", () => {
    it("should apply ORDER BY to combined UNION results", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity ?label
        WHERE {
          { ?entity rdf:type <http://example.org/Task> . ?entity <http://example.org/label> ?label }
          UNION
          { ?entity rdf:type <http://example.org/Note> . ?entity <http://example.org/label> ?label }
        }
        ORDER BY ?label
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(3);
      const labels = results.map((r) => (r.get("label") as Literal).value);
      expect(labels).toEqual(["First Task", "Important Note", "Second Task"]);
    });

    it("should apply LIMIT to combined UNION results", async () => {
      const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?entity ?label
        WHERE {
          { ?entity rdf:type <http://example.org/Task> . ?entity <http://example.org/label> ?label }
          UNION
          { ?entity rdf:type <http://example.org/Note> . ?entity <http://example.org/label> ?label }
        }
        LIMIT 2
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results).toHaveLength(2);
    });
  });
});
