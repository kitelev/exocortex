import { BGPExecutor, BGPExecutorError } from "../../../../../src/infrastructure/sparql/executors/BGPExecutor";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import type { BGPOperation, PropertyPath } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("BGPExecutor", () => {
  let tripleStore: InMemoryTripleStore;
  let executor: BGPExecutor;

  // Test IRIs
  const ex = (local: string) => new IRI(`http://example.org/${local}`);
  const rdfType = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");

  beforeEach(async () => {
    tripleStore = new InMemoryTripleStore();
    executor = new BGPExecutor(tripleStore);

    // Add test data
    await tripleStore.add(new Triple(ex("task1"), rdfType, ex("Task")));
    await tripleStore.add(new Triple(ex("task1"), ex("label"), new Literal("Task 1")));
    await tripleStore.add(new Triple(ex("task1"), ex("effort"), new Literal("60")));

    await tripleStore.add(new Triple(ex("task2"), rdfType, ex("Task")));
    await tripleStore.add(new Triple(ex("task2"), ex("label"), new Literal("Task 2")));
    await tripleStore.add(new Triple(ex("task2"), ex("effort"), new Literal("120")));

    await tripleStore.add(new Triple(ex("project1"), rdfType, ex("Project")));
    await tripleStore.add(new Triple(ex("project1"), ex("label"), new Literal("Project 1")));
  });

  describe("Empty BGP", () => {
    it("should return one empty solution for empty BGP", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].size()).toBe(0);
    });
  });

  describe("Single Triple Pattern", () => {
    it("should match triple pattern with all variables", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "variable", value: "p" },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results.length).toBeGreaterThan(0);

      // Check first result has all three variables bound
      expect(results[0].has("s")).toBe(true);
      expect(results[0].has("p")).toBe(true);
      expect(results[0].has("o")).toBe(true);
    });

    it("should match triple pattern with fixed subject", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/task1" },
            predicate: { type: "variable", value: "p" },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(3); // task1 has 3 properties
      expect(results.every((r) => r.has("p"))).toBe(true);
      expect(results.every((r) => r.has("o"))).toBe(true);
    });

    it("should match triple pattern with fixed predicate", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(3); // 2 tasks + 1 project
      expect(results.every((r) => r.has("s"))).toBe(true);
      expect(results.every((r) => r.has("o"))).toBe(true);
    });

    it("should match triple pattern with fixed object", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "variable", value: "p" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2); // 2 tasks
      expect(results.every((r) => r.has("s"))).toBe(true);
      expect(results.every((r) => r.has("p"))).toBe(true);
    });

    it("should match triple pattern with literal", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "literal", value: "Task 1" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("s")?.toString()).toContain("task1");
    });

    // RDF 1.1 semantics: plain literals and xsd:string literals are equivalent
    // https://www.w3.org/TR/rdf11-concepts/#section-Graph-Literal
    // This tests Issue #613: Instance_class literal matching inconsistency
    it("should match xsd:string literal against plain literal (RDF 1.1)", async () => {
      // Data is stored with plain literals (no datatype)
      // SPARQL parser creates xsd:string typed literals from '...' syntax

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://example.org/label" },
            // This mimics how sparqljs parses: '[[ems__Task]]' becomes xsd:string typed
            object: {
              type: "literal",
              value: "Task 1",
              datatype: "http://www.w3.org/2001/XMLSchema#string",
            },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("s")?.toString()).toContain("task1");
    });

    it("should return empty results when no matches", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/nonexistent" },
            predicate: { type: "variable", value: "p" },
            object: { type: "variable", value: "o" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(0);
    });
  });

  describe("Multiple Triple Patterns (Joins)", () => {
    it("should join two triple patterns with shared variable", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "label" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2); // 2 tasks with labels
      expect(results.every((r) => r.has("task"))).toBe(true);
      expect(results.every((r) => r.has("label"))).toBe(true);
    });

    it("should join three triple patterns", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "label" },
          },
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://example.org/effort" },
            object: { type: "variable", value: "effort" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2); // 2 tasks with all properties
      expect(results.every((r) => r.has("task"))).toBe(true);
      expect(results.every((r) => r.has("label"))).toBe(true);
      expect(results.every((r) => r.has("effort"))).toBe(true);
    });

    it("should handle cartesian product when no shared variables", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "project" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Project" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2); // 2 tasks × 1 project = 2 combinations
      expect(results.every((r) => r.has("task"))).toBe(true);
      expect(results.every((r) => r.has("project"))).toBe(true);
    });

    it("should return empty when join produces no results", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "x" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "x" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Project" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(0); // No resource is both Task and Project
    });
  });

  describe("Streaming API", () => {
    it("should support streaming iteration", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "s" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
        ],
      };

      const results: any[] = [];
      for await (const solution of executor.execute(bgp)) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);
    });

    it("should handle streaming with multiple patterns", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "label" },
          },
        ],
      };

      let count = 0;
      for await (const solution of executor.execute(bgp)) {
        expect(solution.has("task")).toBe(true);
        expect(solution.has("label")).toBe(true);
        count++;
      }

      expect(count).toBe(2);
    });
  });

  describe("Variable Binding Consistency", () => {
    it("should ensure consistent variable bindings across patterns", async () => {
      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "x" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "literal", value: "Task 1" },
          },
          {
            subject: { type: "variable", value: "x" },
            predicate: { type: "iri", value: "http://example.org/effort" },
            object: { type: "variable", value: "effort" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("x")?.toString()).toContain("task1");
      expect((results[0].get("effort") as Literal).value).toBe("60");
    });

    it("should handle same variable in multiple positions", async () => {
      // Add a self-referential triple for testing
      await tripleStore.add(new Triple(ex("task1"), ex("relatedTo"), ex("task1")));

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "x" },
            predicate: { type: "iri", value: "http://example.org/relatedTo" },
            object: { type: "variable", value: "x" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("x")?.toString()).toContain("task1");
    });
  });

  describe("Performance", () => {
    it("should handle large BGP efficiently", async () => {
      // Add more test data
      for (let i = 3; i <= 100; i++) {
        await tripleStore.add(new Triple(ex(`task${i}`), rdfType, ex("Task")));
        await tripleStore.add(new Triple(ex(`task${i}`), ex("label"), new Literal(`Task ${i}`)));
      }

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "label" },
          },
        ],
      };

      const startTime = Date.now();
      const results = await executor.executeAll(bgp);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(100); // Should be fast with indexes
    });
  });

  describe("Property Path Integration", () => {
    beforeEach(async () => {
      // Add hierarchical data for property path tests
      // task1 -> parent -> project1 -> parent -> area1
      await tripleStore.add(new Triple(ex("task1"), ex("parent"), ex("project1")));
      await tripleStore.add(new Triple(ex("project1"), ex("parent"), ex("area1")));
      await tripleStore.add(new Triple(ex("area1"), ex("label"), new Literal("Engineering Area")));
      // Chain: task2 -> task3 -> task4
      await tripleStore.add(new Triple(ex("task2"), ex("depends"), ex("task3")));
      await tripleStore.add(new Triple(ex("task3"), ex("depends"), ex("task4")));
    });

    it("should execute sequence path (/) to navigate relationships", async () => {
      // Path: parent/parent - get grandparent
      const sequencePath: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [
          { type: "iri", value: "http://example.org/parent" },
          { type: "iri", value: "http://example.org/parent" },
        ],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/task1" },
            predicate: sequencePath,
            object: { type: "variable", value: "grandparent" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("grandparent")?.toString()).toContain("area1");
    });

    it("should execute sequence path and then get label of target", async () => {
      // Combined: get grandparent, then its label
      const sequencePath: PropertyPath = {
        type: "path",
        pathType: "/",
        items: [
          { type: "iri", value: "http://example.org/parent" },
          { type: "iri", value: "http://example.org/parent" },
        ],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/task1" },
            predicate: sequencePath,
            object: { type: "variable", value: "grandparent" },
          },
          {
            subject: { type: "variable", value: "grandparent" },
            predicate: { type: "iri", value: "http://example.org/label" },
            object: { type: "variable", value: "gpLabel" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("grandparent")?.toString()).toContain("area1");
      expect((results[0].get("gpLabel") as Literal).value).toBe("Engineering Area");
    });

    it("should execute oneOrMore path (+) for transitive closure", async () => {
      // Path: parent+ - get all ancestors
      const oneOrMorePath: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [{ type: "iri", value: "http://example.org/parent" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/task1" },
            predicate: oneOrMorePath,
            object: { type: "variable", value: "ancestor" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2); // project1 and area1
      const ancestors = results.map((r) => r.get("ancestor")?.toString());
      expect(ancestors).toContain("http://example.org/project1");
      expect(ancestors).toContain("http://example.org/area1");
    });

    it("should execute zeroOrMore path (*) including start node", async () => {
      // Path: depends* - get self and all dependencies
      const zeroOrMorePath: PropertyPath = {
        type: "path",
        pathType: "*",
        items: [{ type: "iri", value: "http://example.org/depends" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/task2" },
            predicate: zeroOrMorePath,
            object: { type: "variable", value: "dep" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(3); // task2 (self), task3, task4
      const deps = results.map((r) => r.get("dep")?.toString());
      expect(deps).toContain("http://example.org/task2"); // Self (zero steps)
      expect(deps).toContain("http://example.org/task3");
      expect(deps).toContain("http://example.org/task4");
    });

    it("should execute inverse path (^) for reverse navigation", async () => {
      // Path: ^parent - get children (reverse of parent)
      const inversePath: PropertyPath = {
        type: "path",
        pathType: "^",
        items: [{ type: "iri", value: "http://example.org/parent" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/project1" },
            predicate: inversePath,
            object: { type: "variable", value: "child" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(1);
      expect(results[0].get("child")?.toString()).toContain("task1");
    });

    it("should execute alternative path (|) for multiple predicates", async () => {
      // Add an alternative relationship
      await tripleStore.add(new Triple(ex("task1"), ex("blockedBy"), ex("blocker1")));

      // Path: parent|blockedBy - get either parent or blocker
      const alternativePath: PropertyPath = {
        type: "path",
        pathType: "|",
        items: [
          { type: "iri", value: "http://example.org/parent" },
          { type: "iri", value: "http://example.org/blockedBy" },
        ],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "iri", value: "http://example.org/task1" },
            predicate: alternativePath,
            object: { type: "variable", value: "related" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      expect(results).toHaveLength(2);
      const related = results.map((r) => r.get("related")?.toString());
      expect(related).toContain("http://example.org/project1");
      expect(related).toContain("http://example.org/blocker1");
    });

    it("should combine property path with variable subject", async () => {
      // Use path with all tasks as subject
      const oneOrMorePath: PropertyPath = {
        type: "path",
        pathType: "+",
        items: [{ type: "iri", value: "http://example.org/parent" }],
      };

      const bgp: BGPOperation = {
        type: "bgp",
        triples: [
          {
            subject: { type: "variable", value: "task" },
            predicate: { type: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
            object: { type: "iri", value: "http://example.org/Task" },
          },
          {
            subject: { type: "variable", value: "task" },
            predicate: oneOrMorePath,
            object: { type: "variable", value: "ancestor" },
          },
        ],
      };

      const results = await executor.executeAll(bgp);
      // task1 has 2 ancestors (project1, area1)
      // task2 has 0 ancestors via parent predicate
      expect(results.length).toBeGreaterThanOrEqual(2);

      // Verify task1 results
      const task1Results = results.filter((r) => r.get("task")?.toString().includes("task1"));
      expect(task1Results).toHaveLength(2);
    });
  });
});
