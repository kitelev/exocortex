/**
 * Regression tests for Issue #612: GROUP BY with JOIN to resolve labels
 *
 * Issue: https://github.com/kitelev/exocortex-obsidian-plugin/issues/612
 *
 * This tests the scenario where GROUP BY is used with a variable
 * that is bound to a literal value through a JOIN pattern.
 *
 * Example query that was reported to fail:
 * SELECT ?protoLabel (AVG(?duration) AS ?avgDuration)
 * WHERE {
 *   ?s exo:Asset_prototype ?proto .
 *   ?proto exo:Asset_label ?protoLabel .
 *   ?s ems:Duration ?duration .
 * }
 * GROUP BY ?protoLabel
 *
 * The expected behavior is that grouping by labels resolved through JOIN
 * should work correctly, allowing aggregation reports grouped by entity names
 * instead of URIs.
 */

import { SPARQLParser } from "../../../../src/infrastructure/sparql/SPARQLParser";
import { AlgebraTranslator } from "../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { QueryExecutor } from "../../../../src/infrastructure/sparql/executors/QueryExecutor";
import { InMemoryTripleStore } from "../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { Triple } from "../../../../src/domain/models/rdf/Triple";
import { IRI } from "../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../src/domain/models/rdf/Literal";

describe("GROUP BY with JOIN to resolve labels (Issue #612)", () => {
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
    // - Tasks with prototype references and durations
    // - Prototypes with labels
    await tripleStore.addAll([
      // Prototype 1: "Morning Shower"
      new Triple(exIRI("proto1"), exIRI("label"), new Literal("Morning Shower")),

      // Task 1: prototype=proto1, duration=20
      new Triple(exIRI("task1"), exIRI("prototype"), exIRI("proto1")),
      new Triple(exIRI("task1"), exIRI("duration"), new Literal("20")),

      // Task 2: prototype=proto1, duration=25
      new Triple(exIRI("task2"), exIRI("prototype"), exIRI("proto1")),
      new Triple(exIRI("task2"), exIRI("duration"), new Literal("25")),

      // Prototype 2: "Evening Walk"
      new Triple(exIRI("proto2"), exIRI("label"), new Literal("Evening Walk")),

      // Task 3: prototype=proto2, duration=30
      new Triple(exIRI("task3"), exIRI("prototype"), exIRI("proto2")),
      new Triple(exIRI("task3"), exIRI("duration"), new Literal("30")),

      // Task 4: prototype=proto2, duration=40
      new Triple(exIRI("task4"), exIRI("prototype"), exIRI("proto2")),
      new Triple(exIRI("task4"), exIRI("duration"), new Literal("40")),
    ]);
  });

  describe("Basic GROUP BY with resolved labels", () => {
    it("should GROUP BY a label resolved through JOIN", async () => {
      // This is the exact query pattern from Issue #612
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?protoLabel (AVG(?duration) AS ?avgDuration)
        WHERE {
          ?s ex:prototype ?proto .
          ?proto ex:label ?protoLabel .
          ?s ex:duration ?duration .
        }
        GROUP BY ?protoLabel
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2); // Two distinct labels

      // Find results by label
      const showerResult = results.find(
        (r) => (r.get("protoLabel") as Literal)?.value === "Morning Shower"
      );
      const walkResult = results.find(
        (r) => (r.get("protoLabel") as Literal)?.value === "Evening Walk"
      );

      expect(showerResult).toBeDefined();
      expect(walkResult).toBeDefined();

      // Check average durations
      // Morning Shower: (20 + 25) / 2 = 22.5
      // Evening Walk: (30 + 40) / 2 = 35
      const showerAvg = parseFloat((showerResult!.get("avgDuration") as Literal).value);
      const walkAvg = parseFloat((walkResult!.get("avgDuration") as Literal).value);

      expect(showerAvg).toBeCloseTo(22.5, 5);
      expect(walkAvg).toBeCloseTo(35, 5);
    });

    it("should GROUP BY rdfs:label resolved through JOIN", async () => {
      // Alternative syntax using rdfs:label
      const query = `
        PREFIX ex: <http://example.org/>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?categoryLabel (SUM(?value) AS ?total)
        WHERE {
          ?item ex:hasCategory ?cat .
          ?cat rdfs:label ?categoryLabel .
          ?item ex:value ?value .
        }
        GROUP BY ?categoryLabel
      `;

      // Add test data for this query
      await tripleStore.addAll([
        // Category A
        new Triple(exIRI("catA"), new IRI("http://www.w3.org/2000/01/rdf-schema#label"), new Literal("Electronics")),
        new Triple(exIRI("item1"), exIRI("hasCategory"), exIRI("catA")),
        new Triple(exIRI("item1"), exIRI("value"), new Literal("100")),
        new Triple(exIRI("item2"), exIRI("hasCategory"), exIRI("catA")),
        new Triple(exIRI("item2"), exIRI("value"), new Literal("200")),

        // Category B
        new Triple(exIRI("catB"), new IRI("http://www.w3.org/2000/01/rdf-schema#label"), new Literal("Clothing")),
        new Triple(exIRI("item3"), exIRI("hasCategory"), exIRI("catB")),
        new Triple(exIRI("item3"), exIRI("value"), new Literal("50")),
      ]);

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      const electronicsResult = results.find(
        (r) => (r.get("categoryLabel") as Literal)?.value === "Electronics"
      );
      const clothingResult = results.find(
        (r) => (r.get("categoryLabel") as Literal)?.value === "Clothing"
      );

      expect(electronicsResult).toBeDefined();
      expect(clothingResult).toBeDefined();

      const electronicsTotal = parseFloat((electronicsResult!.get("total") as Literal).value);
      const clothingTotal = parseFloat((clothingResult!.get("total") as Literal).value);

      expect(electronicsTotal).toBe(300); // 100 + 200
      expect(clothingTotal).toBe(50);
    });
  });

  describe("GROUP BY with COUNT", () => {
    it("should COUNT tasks grouped by prototype label", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?prototypeName (COUNT(?task) AS ?count)
        WHERE {
          ?task ex:prototype ?proto .
          ?proto ex:label ?prototypeName .
        }
        GROUP BY ?prototypeName
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      const showerResult = results.find(
        (r) => (r.get("prototypeName") as Literal)?.value === "Morning Shower"
      );
      const walkResult = results.find(
        (r) => (r.get("prototypeName") as Literal)?.value === "Evening Walk"
      );

      expect(showerResult).toBeDefined();
      expect(walkResult).toBeDefined();

      const showerCount = parseInt((showerResult!.get("count") as Literal).value);
      const walkCount = parseInt((walkResult!.get("count") as Literal).value);

      expect(showerCount).toBe(2); // task1, task2
      expect(walkCount).toBe(2); // task3, task4
    });
  });

  describe("GROUP BY with multiple aggregates", () => {
    it("should compute multiple aggregates grouped by label", async () => {
      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?protoLabel (COUNT(?s) AS ?count) (SUM(?duration) AS ?total) (AVG(?duration) AS ?avg)
        WHERE {
          ?s ex:prototype ?proto .
          ?proto ex:label ?protoLabel .
          ?s ex:duration ?duration .
        }
        GROUP BY ?protoLabel
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(2);

      const showerResult = results.find(
        (r) => (r.get("protoLabel") as Literal)?.value === "Morning Shower"
      );

      expect(showerResult).toBeDefined();

      const count = parseInt((showerResult!.get("count") as Literal).value);
      const total = parseFloat((showerResult!.get("total") as Literal).value);
      const avg = parseFloat((showerResult!.get("avg") as Literal).value);

      expect(count).toBe(2);
      expect(total).toBe(45); // 20 + 25
      expect(avg).toBeCloseTo(22.5, 5);
    });
  });

  describe("Edge cases", () => {
    it("should handle GROUP BY label with OPTIONAL", async () => {
      // Add a task without a prototype
      await tripleStore.add(
        new Triple(exIRI("task5"), exIRI("duration"), new Literal("15"))
      );

      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?protoLabel (COUNT(?s) AS ?count)
        WHERE {
          ?s ex:duration ?duration .
          OPTIONAL {
            ?s ex:prototype ?proto .
            ?proto ex:label ?protoLabel .
          }
        }
        GROUP BY ?protoLabel
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      // Should have results for known labels plus possibly one for unbound
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle GROUP BY with multiple join levels", async () => {
      // Add area hierarchy: task -> project -> area
      await tripleStore.addAll([
        // Area with label
        new Triple(exIRI("area1"), exIRI("label"), new Literal("Engineering")),

        // Projects belonging to area
        new Triple(exIRI("project1"), exIRI("belongsTo"), exIRI("area1")),
        new Triple(exIRI("project2"), exIRI("belongsTo"), exIRI("area1")),

        // Tasks belonging to projects with effort
        new Triple(exIRI("taskA"), exIRI("inProject"), exIRI("project1")),
        new Triple(exIRI("taskA"), exIRI("effort"), new Literal("100")),

        new Triple(exIRI("taskB"), exIRI("inProject"), exIRI("project1")),
        new Triple(exIRI("taskB"), exIRI("effort"), new Literal("150")),

        new Triple(exIRI("taskC"), exIRI("inProject"), exIRI("project2")),
        new Triple(exIRI("taskC"), exIRI("effort"), new Literal("200")),
      ]);

      const query = `
        PREFIX ex: <http://example.org/>
        SELECT ?areaLabel (SUM(?effort) AS ?totalEffort)
        WHERE {
          ?task ex:inProject ?project .
          ?project ex:belongsTo ?area .
          ?area ex:label ?areaLabel .
          ?task ex:effort ?effort .
        }
        GROUP BY ?areaLabel
      `;

      const ast = parser.parse(query);
      const algebra = translator.translate(ast);
      const results = await executor.executeAll(algebra);

      expect(results.length).toBe(1);

      const engineeringResult = results[0];
      expect((engineeringResult.get("areaLabel") as Literal).value).toBe("Engineering");

      const totalEffort = parseFloat((engineeringResult.get("totalEffort") as Literal).value);
      expect(totalEffort).toBe(450); // 100 + 150 + 200
    });
  });
});
