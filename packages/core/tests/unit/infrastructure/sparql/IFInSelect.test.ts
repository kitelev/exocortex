/**
 * End-to-end tests for SPARQL IF() in SELECT clause (Issue #610)
 *
 * SPARQL 1.1 IF(condition, thenExpr, elseExpr) returns thenExpr when condition is true,
 * elseExpr otherwise.
 */
import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { Namespace } from "../../../../src/domain/models/rdf/Namespace";

describe("IF() in SELECT clause (Issue #610)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    const xsdInt = Namespace.XSD.term("integer");

    // Add test data with different durations
    await tripleStore.addAll([
      // Task with duration > 420 (7 hours)
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/duration"),
        new Literal("500", xsdInt)
      ),
      // Task with duration < 420
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/duration"),
        new Literal("300", xsdInt)
      ),
    ]);
  });

  it("should evaluate IF() expression and bind result to variable", async () => {
    const query = `
      SELECT ?s ?duration (IF(?duration > 420, "good", "poor") AS ?quality)
      WHERE { ?s <http://example.org/duration> ?duration }
    `;

    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    const results: Record<string, any>[] = [];
    for await (const solution of executor.execute(algebra)) {
      results.push(solution.toJSON());
    }

    // Should have 2 results
    expect(results).toHaveLength(2);

    // Find result for task1 (duration 500 > 420)
    const task1 = results.find((r) => r.s?.includes("task1"));
    expect(task1).toBeDefined();
    expect(task1?.quality).toBe("good");

    // Find result for task2 (duration 300 < 420)
    const task2 = results.find((r) => r.s?.includes("task2"));
    expect(task2).toBeDefined();
    expect(task2?.quality).toBe("poor");
  });

  it("should support nested IF() for multi-level conditions", async () => {
    const xsdInt = Namespace.XSD.term("integer");

    // Add a third task for testing 3-level nested IF
    await tripleStore.add(
      new Triple(
        new IRI("http://example.org/task3"),
        new IRI("http://example.org/duration"),
        new Literal("100", xsdInt)
      )
    );

    // Nested IF: IF(x > 400, 'high', IF(x > 200, 'medium', 'low'))
    const query = `
      SELECT ?s ?duration (IF(?duration > 400, "high", IF(?duration > 200, "medium", "low")) AS ?level)
      WHERE { ?s <http://example.org/duration> ?duration }
    `;

    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    const results: Record<string, any>[] = [];
    for await (const solution of executor.execute(algebra)) {
      results.push(solution.toJSON());
    }

    expect(results).toHaveLength(3);

    // Task1: duration 500 > 400 => "high"
    const task1 = results.find((r) => r.s?.includes("task1"));
    expect(task1?.level).toBe("high");

    // Task2: duration 300 (200 < 300 <= 400) => "medium"
    const task2 = results.find((r) => r.s?.includes("task2"));
    expect(task2?.level).toBe("medium");

    // Task3: duration 100 <= 200 => "low"
    const task3 = results.find((r) => r.s?.includes("task3"));
    expect(task3?.level).toBe("low");
  });

  it("should support IF() with string comparison", async () => {
    // Add tasks with status strings
    await tripleStore.addAll([
      new Triple(
        new IRI("http://example.org/task1"),
        new IRI("http://example.org/status"),
        new Literal("done")
      ),
      new Triple(
        new IRI("http://example.org/task2"),
        new IRI("http://example.org/status"),
        new Literal("pending")
      ),
    ]);

    const query = `
      SELECT ?s (IF(?status = "done", "✅", "⏳") AS ?emoji)
      WHERE { ?s <http://example.org/status> ?status }
    `;

    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    const results: Record<string, any>[] = [];
    for await (const solution of executor.execute(algebra)) {
      results.push(solution.toJSON());
    }

    expect(results).toHaveLength(2);

    const task1 = results.find((r) => r.s?.includes("task1"));
    expect(task1?.emoji).toBe("✅");

    const task2 = results.find((r) => r.s?.includes("task2"));
    expect(task2?.emoji).toBe("⏳");
  });

  it("should support IF() with >= operator", async () => {
    const query = `
      SELECT ?s ?duration (IF(?duration >= 420, "good", "poor") AS ?quality)
      WHERE { ?s <http://example.org/duration> ?duration }
    `;

    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    const results: Record<string, any>[] = [];
    for await (const solution of executor.execute(algebra)) {
      results.push(solution.toJSON());
    }

    expect(results).toHaveLength(2);

    // Task1: duration 500 >= 420 => "good"
    const task1 = results.find((r) => r.s?.includes("task1"));
    expect(task1?.quality).toBe("good");

    // Task2: duration 300 < 420 => "poor"
    const task2 = results.find((r) => r.s?.includes("task2"));
    expect(task2?.quality).toBe("poor");
  });

  it("should support IF() with BOUND() function (with bound variable)", async () => {
    // Test BOUND() with a variable that is always bound
    const query = `
      SELECT ?s (IF(BOUND(?duration), "has duration", "no duration") AS ?status)
      WHERE { ?s <http://example.org/duration> ?duration }
    `;

    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    const results: Record<string, any>[] = [];
    for await (const solution of executor.execute(algebra)) {
      results.push(solution.toJSON());
    }

    expect(results).toHaveLength(2);

    // Both tasks have duration, so BOUND(?duration) is true
    const task1 = results.find((r) => r.s?.includes("task1"));
    expect(task1?.status).toBe("has duration");

    const task2 = results.find((r) => r.s?.includes("task2"));
    expect(task2?.status).toBe("has duration");
  });

  it("should work with only IF() expression in SELECT (no base variables)", async () => {
    const query = `
      SELECT (IF(?duration > 420, "good", "poor") AS ?quality)
      WHERE { ?s <http://example.org/duration> ?duration }
    `;

    const ast = parser.parse(query);
    const algebra = translator.translate(ast);

    const results: Record<string, any>[] = [];
    for await (const solution of executor.execute(algebra)) {
      results.push(solution.toJSON());
    }

    expect(results).toHaveLength(2);

    const qualities = results.map((r) => r.quality).sort();
    expect(qualities).toContain("good");
    expect(qualities).toContain("poor");
  });
});
