/**
 * Tests for Issue #609: Arithmetic expressions in outer SELECT with subqueries
 *
 * Issue: https://github.com/kitelev/exocortex-obsidian-plugin/issues/609
 *
 * This tests the scenario where arithmetic expressions in the outer SELECT
 * reference variables computed by an inner subquery (with aggregates).
 *
 * Example query:
 * SELECT ?label (FLOOR(?avgSec / 60) AS ?avgMin)
 * WHERE {
 *   {
 *     SELECT ?label (AVG(?duration) AS ?avgSec)
 *     WHERE {
 *       ?s exo:Asset_label ?label .
 *       BIND((?end - ?start) AS ?duration)
 *     }
 *     GROUP BY ?label
 *   }
 * }
 *
 * Expected: ?avgMin should be computed from ?avgSec coming from the subquery
 */

import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";

describe("Arithmetic expressions in outer SELECT with subqueries (Issue #609)", () => {
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;
  let tripleStore: InMemoryTripleStore;
  let executor: QueryExecutor;

  const EX = "http://example.org/";
  const exIRI = (local: string) => new IRI(`${EX}${local}`);

  beforeEach(async () => {
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();
    tripleStore = new InMemoryTripleStore();
    executor = new QueryExecutor(tripleStore);

    // Set up test data:
    // - Tasks with labels and durations (in seconds)
    await tripleStore.addAll([
      // Task Group "Work"
      new Triple(exIRI("task1"), exIRI("label"), new Literal("Work")),
      new Triple(exIRI("task1"), exIRI("duration"), new Literal("3600")), // 60 min

      new Triple(exIRI("task2"), exIRI("label"), new Literal("Work")),
      new Triple(exIRI("task2"), exIRI("duration"), new Literal("7200")), // 120 min

      // Task Group "Sleep"
      new Triple(exIRI("task3"), exIRI("label"), new Literal("Sleep")),
      new Triple(exIRI("task3"), exIRI("duration"), new Literal("28800")), // 480 min (8 hours)

      new Triple(exIRI("task4"), exIRI("label"), new Literal("Sleep")),
      new Triple(exIRI("task4"), exIRI("duration"), new Literal("25200")), // 420 min (7 hours)
    ]);
  });

  describe("Basic arithmetic in outer SELECT", () => {
    it("should evaluate FLOOR on subquery variable", async () => {
      // Issue #609: FLOOR(?avgSec / 60) AS ?avgMin should work
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?label (FLOOR(?avgSec / 60) AS ?avgMin)
        WHERE {
          {
            SELECT ?label (AVG(?duration) AS ?avgSec)
            WHERE {
              ?s ex:label ?label .
              ?s ex:duration ?duration .
            }
            GROUP BY ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      // Verify that avgMin is present in results (Issue #609 claim: "?avgMin missing")
      const firstResult = results[0];
      const variables = firstResult.variables();
      expect(variables).toContain("avgMin"); // This should pass - the feature is working!

      // Work: AVG(3600, 7200) = 5400 sec → FLOOR(5400/60) = 90 min
      const workResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Work";
      });
      expect(workResult).toBeDefined();
      const workMin = workResult!.get("avgMin");
      expect(workMin).toBe(90);

      // Sleep: AVG(28800, 25200) = 27000 sec → FLOOR(27000/60) = 450 min
      const sleepResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Sleep";
      });
      expect(sleepResult).toBeDefined();
      const sleepMin = sleepResult!.get("avgMin");
      expect(sleepMin).toBe(450);
    });

    it("should evaluate simple division on subquery variable", async () => {
      // Simpler case: ?totalSec / 60 AS ?totalMin
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?label (?totalSec / 60 AS ?totalMin)
        WHERE {
          {
            SELECT ?label (SUM(?duration) AS ?totalSec)
            WHERE {
              ?s ex:label ?label .
              ?s ex:duration ?duration .
            }
            GROUP BY ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      // Work: SUM(3600, 7200) = 10800 sec → 10800/60 = 180 min
      const workResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Work";
      });
      expect(workResult).toBeDefined();
      const workMin = workResult!.get("totalMin");
      expect(workMin).toBe(180);
    });

    it("should evaluate multiple arithmetic expressions", async () => {
      // Multiple computed columns: minutes and hours
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?label (?totalSec / 60 AS ?totalMin) (?totalSec / 3600 AS ?totalHours)
        WHERE {
          {
            SELECT ?label (SUM(?duration) AS ?totalSec)
            WHERE {
              ?s ex:label ?label .
              ?s ex:duration ?duration .
            }
            GROUP BY ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      // Sleep: SUM(28800, 25200) = 54000 sec → 900 min → 15 hours
      const sleepResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Sleep";
      });
      expect(sleepResult).toBeDefined();
      expect(sleepResult!.get("totalMin")).toBe(900);
      expect(sleepResult!.get("totalHours")).toBe(15);
    });

    it("should evaluate nested arithmetic with FLOOR", async () => {
      // Issue #609 example with modulo: compute hours and remaining minutes
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?label (FLOOR(?totalSec / 3600) AS ?hours)
        WHERE {
          {
            SELECT ?label (SUM(?duration) AS ?totalSec)
            WHERE {
              ?s ex:label ?label .
              ?s ex:duration ?duration .
            }
            GROUP BY ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      // Sleep: SUM(28800, 25200) = 54000 sec → FLOOR(54000/3600) = 15 hours
      const sleepResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Sleep";
      });
      expect(sleepResult).toBeDefined();
      expect(sleepResult!.get("hours")).toBe(15);

      // Work: SUM(3600, 7200) = 10800 sec → FLOOR(10800/3600) = 3 hours
      const workResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Work";
      });
      expect(workResult).toBeDefined();
      expect(workResult!.get("hours")).toBe(3);
    });
  });

  describe("Edge cases", () => {
    it("should handle CEIL and ROUND functions", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?label (CEIL(?avgSec / 60) AS ?ceilMin) (ROUND(?avgSec / 60) AS ?roundMin)
        WHERE {
          {
            SELECT ?label (AVG(?duration) AS ?avgSec)
            WHERE {
              ?s ex:label ?label .
              ?s ex:duration ?duration .
            }
            GROUP BY ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      // Work: AVG(3600, 7200) = 5400 sec → 90 min (exact)
      const workResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Work";
      });
      expect(workResult).toBeDefined();
      expect(workResult!.get("ceilMin")).toBe(90);
      expect(workResult!.get("roundMin")).toBe(90);
    });

    it("should handle ABS function on arithmetic result", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?label (ABS(?avgSec - 5000) AS ?diff)
        WHERE {
          {
            SELECT ?label (AVG(?duration) AS ?avgSec)
            WHERE {
              ?s ex:label ?label .
              ?s ex:duration ?duration .
            }
            GROUP BY ?label
          }
        }
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      // Work: AVG(3600, 7200) = 5400 → ABS(5400 - 5000) = 400
      const workResult = results.find((r) => {
        const label = r.get("label") as Literal | undefined;
        return label && label.value === "Work";
      });
      expect(workResult).toBeDefined();
      expect(workResult!.get("diff")).toBe(400);
    });
  });
});
