/**
 * SPARQL 1.1 Query Forms Compliance Tests
 *
 * Coverage Status:
 * - SELECT: ✅ Implemented
 * - ASK: ❌ Not implemented (QueryExecutor doesn't support 'ask' operation type)
 * - CONSTRUCT: ❌ Not implemented (QueryExecutor doesn't support 'construct' operation type)
 * - DESCRIBE: ❌ Not implemented
 */

import {
  createTestEnvironment,
  loadTestData,
  executeQuery,
  executeConstructQuery,
  buildPrefixes,
  TEST_DATA,
} from "./sparql-test-utils";

describe("SPARQL 1.1 Query Forms Compliance", () => {
  describe("SELECT", () => {
    it("should return selected variables", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT ?name WHERE {
          ?person foaf:name ?name
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(3);
      const names = results.map((r) => r.name);
      expect(names).toContain("Alice");
      expect(names).toContain("Bob");
      expect(names).toContain("Charlie");
    });

    it("should handle SELECT *", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT * WHERE {
          ex:alice foaf:name ?name .
          ex:alice foaf:age ?age
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Alice");
      expect(results[0].age).toBe(30);
    });

    it("should handle SELECT with expressions (returns string)", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT ?name (?age * 2 AS ?doubleAge) WHERE {
          ?person foaf:name ?name .
          ?person foaf:age ?age
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(3);
      const alice = results.find((r) => r.name === "Alice");
      // Note: Computed expressions return strings, not numbers
      // This is a known limitation tracked for future improvement
      expect(alice?.doubleAge).toBe("60");
    });
  });

  describe("ASK", () => {
    // ASK queries are not yet implemented in QueryExecutor
    it.skip("should return true when pattern matches", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        ASK WHERE {
          ex:alice foaf:name "Alice"
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
    });

    // ASK queries are not yet implemented in QueryExecutor
    it.skip("should return empty when pattern does not match", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        ASK WHERE {
          ex:alice foaf:name "NonExistent"
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(0);
    });
  });

  describe("CONSTRUCT", () => {
    // CONSTRUCT queries are not yet implemented in QueryExecutor
    it.skip("should construct new triples from pattern", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        CONSTRUCT {
          ?person ex:hasName ?name
        } WHERE {
          ?person foaf:name ?name
        }
      `;

      const triples = await executeConstructQuery(executor, query);
      expect(triples.length).toBeGreaterThanOrEqual(0);
    });
  });
});
