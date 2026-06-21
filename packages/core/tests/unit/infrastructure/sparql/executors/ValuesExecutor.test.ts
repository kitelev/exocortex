import { ValuesExecutor } from "../../../../../src/infrastructure/sparql/executors/ValuesExecutor";
import type { ValuesOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";

describe("ValuesExecutor", () => {
  let executor: ValuesExecutor;

  beforeEach(() => {
    executor = new ValuesExecutor();
  });

  describe("Single variable VALUES", () => {
    it("should create solution mappings for each value", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["status"],
        bindings: [
          { status: { type: "literal", value: "active" } },
          { status: { type: "literal", value: "pending" } },
          { status: { type: "literal", value: "blocked" } },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(3);
      expect((results[0].get("status") as Literal).value).toBe("active");
      expect((results[1].get("status") as Literal).value).toBe("pending");
      expect((results[2].get("status") as Literal).value).toBe("blocked");
    });

    it("should handle IRI values", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["project"],
        bindings: [
          { project: { type: "iri", value: "http://example.org/proj1" } },
          { project: { type: "iri", value: "http://example.org/proj2" } },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(2);
      expect((results[0].get("project") as IRI).value).toBe("http://example.org/proj1");
      expect((results[1].get("project") as IRI).value).toBe("http://example.org/proj2");
    });

    it("should handle typed literals", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["count"],
        bindings: [
          { count: { type: "literal", value: "1", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
          { count: { type: "literal", value: "2", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(2);
      const lit1 = results[0].get("count") as Literal;
      expect(lit1.value).toBe("1");
      expect(lit1.datatype?.value).toBe("http://www.w3.org/2001/XMLSchema#integer");
    });

    it("should handle language-tagged literals", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["label"],
        bindings: [
          { label: { type: "literal", value: "Hello", language: "en" } },
          { label: { type: "literal", value: "Bonjour", language: "fr" } },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(2);
      const lit1 = results[0].get("label") as Literal;
      expect(lit1.value).toBe("Hello");
      expect(lit1.language).toBe("en");
      const lit2 = results[1].get("label") as Literal;
      expect(lit2.value).toBe("Bonjour");
      expect(lit2.language).toBe("fr");
    });
  });

  describe("Multi-variable VALUES", () => {
    it("should create solution mappings with multiple variables", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["name", "role"],
        bindings: [
          {
            name: { type: "literal", value: "Alice" },
            role: { type: "literal", value: "admin" },
          },
          {
            name: { type: "literal", value: "Bob" },
            role: { type: "literal", value: "editor" },
          },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(2);
      expect((results[0].get("name") as Literal).value).toBe("Alice");
      expect((results[0].get("role") as Literal).value).toBe("admin");
      expect((results[1].get("name") as Literal).value).toBe("Bob");
      expect((results[1].get("role") as Literal).value).toBe("editor");
    });

    it("should handle mixed IRI and Literal values", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["entity", "label"],
        bindings: [
          {
            entity: { type: "iri", value: "http://example.org/task1" },
            label: { type: "literal", value: "Task One" },
          },
          {
            entity: { type: "iri", value: "http://example.org/task2" },
            label: { type: "literal", value: "Task Two" },
          },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(2);
      expect((results[0].get("entity") as IRI).value).toBe("http://example.org/task1");
      expect((results[0].get("label") as Literal).value).toBe("Task One");
    });
  });

  describe("UNDEF values", () => {
    it("should handle UNDEF by not binding the variable", async () => {
      // UNDEF is represented by omitting the variable from the binding
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x", "y"],
        bindings: [
          {
            x: { type: "literal", value: "1", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
            y: { type: "literal", value: "2", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
          },
          {
            // x is UNDEF (omitted)
            y: { type: "literal", value: "3", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
          },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(2);
      // First row: both bound
      expect((results[0].get("x") as Literal).value).toBe("1");
      expect((results[0].get("y") as Literal).value).toBe("2");
      // Second row: x is unbound
      expect(results[1].get("x")).toBeUndefined();
      expect((results[1].get("y") as Literal).value).toBe("3");
    });

    it("should handle multiple UNDEF values in same row", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["a", "b", "c"],
        bindings: [
          {
            a: { type: "literal", value: "1" },
            // b and c are UNDEF
          },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(1);
      expect((results[0].get("a") as Literal).value).toBe("1");
      expect(results[0].get("b")).toBeUndefined();
      expect(results[0].get("c")).toBeUndefined();
    });
  });

  describe("Empty VALUES", () => {
    it("should return no solutions for empty bindings", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(0);
    });
  });

  describe("Cross-product use case", () => {
    it("should support cross-product style queries", async () => {
      // VALUES ?year { 2023 2024 }
      // VALUES ?month { 1 2 3 }
      // When joined, produces 6 combinations
      const yearsOp: ValuesOperation = {
        type: "values",
        variables: ["year"],
        bindings: [
          { year: { type: "literal", value: "2023", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
          { year: { type: "literal", value: "2024", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
        ],
      };

      const monthsOp: ValuesOperation = {
        type: "values",
        variables: ["month"],
        bindings: [
          { month: { type: "literal", value: "1", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
          { month: { type: "literal", value: "2", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
          { month: { type: "literal", value: "3", datatype: "http://www.w3.org/2001/XMLSchema#integer" } },
        ],
      };

      const yearResults = await executor.executeAll(yearsOp);
      const monthResults = await executor.executeAll(monthsOp);

      // Simulate cross-product join
      const crossProduct: SolutionMapping[] = [];
      for (const year of yearResults) {
        for (const month of monthResults) {
          const merged = year.merge(month);
          if (merged) crossProduct.push(merged);
        }
      }

      expect(crossProduct).toHaveLength(6);
      // Verify first and last combinations
      expect((crossProduct[0].get("year") as Literal).value).toBe("2023");
      expect((crossProduct[0].get("month") as Literal).value).toBe("1");
      expect((crossProduct[5].get("year") as Literal).value).toBe("2024");
      expect((crossProduct[5].get("month") as Literal).value).toBe("3");
    });
  });

  describe("Streaming execution via AsyncIterator", () => {
    it("should work correctly with async iteration", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["status"],
        bindings: [
          { status: { type: "literal", value: "active" } },
          { status: { type: "literal", value: "pending" } },
        ],
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation)) {
        results.push(solution);
      }

      expect(results).toHaveLength(2);
      expect((results[0].get("status") as Literal).value).toBe("active");
      expect((results[1].get("status") as Literal).value).toBe("pending");
    });

    it("should yield no solutions for empty VALUES via iteration", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["x"],
        bindings: [],
      };

      const results: SolutionMapping[] = [];
      for await (const solution of executor.execute(operation)) {
        results.push(solution);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("Order preservation", () => {
    it("should preserve order of bindings", async () => {
      const operation: ValuesOperation = {
        type: "values",
        variables: ["letter"],
        bindings: [
          { letter: { type: "literal", value: "c" } },
          { letter: { type: "literal", value: "a" } },
          { letter: { type: "literal", value: "b" } },
        ],
      };

      const results = await executor.executeAll(operation);

      expect(results).toHaveLength(3);
      expect((results[0].get("letter") as Literal).value).toBe("c");
      expect((results[1].get("letter") as Literal).value).toBe("a");
      expect((results[2].get("letter") as Literal).value).toBe("b");
    });
  });
});
