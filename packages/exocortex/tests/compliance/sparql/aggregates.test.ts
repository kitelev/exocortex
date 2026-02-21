/**
 * SPARQL 1.1 Aggregates Compliance Tests
 *
 * Coverage Status:
 * - COUNT: ✅ Implemented
 * - COUNT DISTINCT: ✅ Implemented
 * - SUM: ✅ Implemented
 * - AVG: ✅ Implemented
 * - MIN: ✅ Implemented
 * - MAX: ✅ Implemented
 * - GROUP BY: ✅ Implemented
 * - HAVING: ✅ Implemented
 * - GROUP_CONCAT: ❌ Not tested
 * - SAMPLE: ❌ Not tested
 */

import {
  createTestEnvironment,
  loadTestData,
  executeQuery,
  buildPrefixes,
  TEST_DATA,
} from "./sparql-test-utils";

describe("SPARQL 1.1 Aggregates Compliance", () => {
  describe("COUNT", () => {
    it("should count all results", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT (COUNT(*) AS ?count) WHERE {
          ?person foaf:name ?name
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].count).toBe(3);
    });

    it("should count distinct values", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT (COUNT(DISTINCT ?category) AS ?count) WHERE {
          ?item ex:category ?category
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].count).toBe(2);
    });
  });

  describe("SUM", () => {
    it("should sum numeric values", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT (SUM(?value) AS ?total) WHERE {
          ?item ex:value ?value
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].total).toBe(150);
    });
  });

  describe("AVG", () => {
    it("should calculate average", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT (AVG(?value) AS ?average) WHERE {
          ?item ex:value ?value
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].average).toBe(30);
    });
  });

  describe("MIN", () => {
    it("should find minimum value", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT (MIN(?value) AS ?min) WHERE {
          ?item ex:value ?value
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].min).toBe(10);
    });
  });

  describe("MAX", () => {
    it("should find maximum value", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT (MAX(?value) AS ?max) WHERE {
          ?item ex:value ?value
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].max).toBe(50);
    });
  });

  describe("GROUP BY", () => {
    it("should group results by variable", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT ?category (SUM(?value) AS ?total) WHERE {
          ?item ex:category ?category .
          ?item ex:value ?value
        }
        GROUP BY ?category
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(2);
      const catA = results.find((r) => r.category === "A");
      const catB = results.find((r) => r.category === "B");
      expect(catA?.total).toBe(30);
      expect(catB?.total).toBe(120);
    });
  });

  describe("HAVING", () => {
    it("should filter grouped results", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT ?category (SUM(?value) AS ?total) WHERE {
          ?item ex:category ?category .
          ?item ex:value ?value
        }
        GROUP BY ?category
        HAVING (SUM(?value) > 50)
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].category).toBe("B");
    });

    it("should filter by aggregate count", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.numericData());

      const query = `
        ${buildPrefixes("ex")}
        SELECT ?category (COUNT(?item) AS ?count) WHERE {
          ?item ex:category ?category
        }
        GROUP BY ?category
        HAVING (COUNT(?item) >= 2)
      `;

      const results = await executeQuery(executor, query);
      // Both A and B have at least 2 items
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
