/**
 * End-to-end tests for SPARQL string functions in SELECT clause (Issue #608)
 *
 * SPARQL 1.1 string functions should be evaluable in SELECT expressions:
 * - STRLEN, SUBSTR, UCASE, LCASE
 * - STRSTARTS, STRENDS, CONTAINS
 * - CONCAT, REPLACE, REGEX
 *
 * These tests verify that string functions work correctly when used as
 * (FUNCTION(?var) AS ?result) expressions in SELECT clause.
 */
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";

describe("String functions in SELECT clause (Issue #608)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    // Add test data
    await tripleStore.addAll([
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/label"),
        new Literal("Hello World")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/label"),
        new Literal("Testing")
      ),
      new Triple(
        new IRI("http://example.org/task3"),
        new IRI("http://example.org/label"),
        new Literal("foo-bar-baz")
      ),
    ]);
  });

  describe("String length and case functions", () => {
    it("should evaluate STRLEN() in SELECT clause", async () => {
      const query = `
        SELECT ?label (STRLEN(?label) AS ?len)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      // Find result with "Hello World"
      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      // STRLEN returns number, toJSON() converts to string representation
      expect(helloWorld?.len).toBe("11"); // "Hello World".length = 11
      expect("len" in helloWorld!).toBe(true); // Key exists

      // Find result with "Testing"
      const testing = results.find((r) => r.label?.includes("Testing"));
      expect(testing).toBeDefined();
      expect(testing?.len).toBe("7"); // "Testing".length = 7
    });

    it("should evaluate UCASE() in SELECT clause", async () => {
      const query = `
        SELECT ?label (UCASE(?label) AS ?upper)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      expect(helloWorld?.upper).toBe("HELLO WORLD");
    });

    it("should evaluate LCASE() in SELECT clause", async () => {
      const query = `
        SELECT ?label (LCASE(?label) AS ?lower)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      expect(helloWorld?.lower).toBe("hello world");
    });
  });

  describe("Substring functions", () => {
    it("should evaluate SUBSTR() in SELECT clause", async () => {
      const query = `
        SELECT ?label (SUBSTR(?label, 1, 5) AS ?prefix)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      expect(helloWorld?.prefix).toBe("Hello"); // First 5 characters

      const testing = results.find((r) => r.label?.includes("Testing"));
      expect(testing).toBeDefined();
      expect(testing?.prefix).toBe("Testi"); // First 5 characters
    });

    it("should evaluate STRBEFORE() in SELECT clause", async () => {
      const query = `
        SELECT ?label (STRBEFORE(?label, "-") AS ?before)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      const fooBar = results.find((r) => r.label?.includes("foo"));
      expect(fooBar).toBeDefined();
      expect(fooBar?.before).toBe("foo");
    });

    it("should evaluate STRAFTER() in SELECT clause", async () => {
      const query = `
        SELECT ?label (STRAFTER(?label, "bar-") AS ?after)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      const fooBar = results.find((r) => r.label?.includes("foo"));
      expect(fooBar).toBeDefined();
      expect(fooBar?.after).toBe("baz");
    });
  });

  describe("String matching functions", () => {
    it("should evaluate STRSTARTS() in SELECT clause", async () => {
      const query = `
        SELECT ?label (STRSTARTS(?label, "Hello") AS ?startsWithHello)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld?.startsWithHello).toBe("true");

      const testing = results.find((r) => r.label?.includes("Testing"));
      expect(testing?.startsWithHello).toBe("false");
    });

    it("should evaluate STRENDS() in SELECT clause", async () => {
      const query = `
        SELECT ?label (STRENDS(?label, "World") AS ?endsWithWorld)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld?.endsWithWorld).toBe("true");

      const testing = results.find((r) => r.label?.includes("Testing"));
      expect(testing?.endsWithWorld).toBe("false");
    });

    it("should evaluate CONTAINS() in SELECT clause", async () => {
      const query = `
        SELECT ?label (CONTAINS(?label, "llo") AS ?containsLlo)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld?.containsLlo).toBe("true");

      const testing = results.find((r) => r.label?.includes("Testing"));
      expect(testing?.containsLlo).toBe("false");
    });
  });

  describe("String manipulation functions", () => {
    it("should evaluate CONCAT() in SELECT clause", async () => {
      const query = `
        SELECT ?label (CONCAT("Task: ", ?label) AS ?formatted)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      expect(helloWorld?.formatted).toBe("Task: Hello World");
    });

    it("should evaluate CONCAT() with multiple arguments", async () => {
      const query = `
        SELECT ?label (CONCAT("[", ?label, "]") AS ?bracketed)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld?.bracketed).toBe("[Hello World]");
    });

    it("should evaluate REPLACE() in SELECT clause", async () => {
      const query = `
        SELECT ?label (REPLACE(?label, "-", "_") AS ?replaced)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      const fooBar = results.find((r) => r.label?.includes("foo"));
      expect(fooBar).toBeDefined();
      expect(fooBar?.replaced).toBe("foo_bar_baz");
    });
  });

  describe("Multiple string functions in SELECT", () => {
    it("should evaluate multiple string functions in SELECT clause", async () => {
      const query = `
        SELECT
          ?label
          (STRLEN(?label) AS ?len)
          (UCASE(?label) AS ?upper)
          (CONCAT("Task: ", ?label) AS ?formatted)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      expect(results).toHaveLength(3);

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      expect(helloWorld?.len).toBe("11"); // toJSON() converts to string
      expect(helloWorld?.upper).toBe("HELLO WORLD");
      expect(helloWorld?.formatted).toBe("Task: Hello World");
    });

    it("should chain string functions (nested calls)", async () => {
      const query = `
        SELECT ?label (UCASE(SUBSTR(?label, 1, 5)) AS ?upperPrefix)
        WHERE { ?s <http://example.org/label> ?label }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);

      const results: Record<string, any>[] = [];
      for await (const solution of executor.execute(algebra)) {
        results.push(solution.toJSON());
      }

      const helloWorld = results.find((r) => r.label?.includes("Hello"));
      expect(helloWorld).toBeDefined();
      expect(helloWorld?.upperPrefix).toBe("HELLO");
    });
  });
});
