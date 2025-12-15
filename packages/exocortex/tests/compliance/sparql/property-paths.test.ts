/**
 * SPARQL 1.1 Property Paths Compliance Tests
 *
 * Coverage Status:
 * - Sequence Path (/): ✅ Implemented
 * - Alternative Path (|): ✅ Implemented
 * - Inverse Path (^): ✅ Implemented
 * - Zero or More (*): ✅ Implemented
 * - One or More (+): ✅ Implemented
 * - Zero or One (?): ✅ Implemented
 * - Negated Property Set (!): ❌ Not implemented
 */

import {
  createTestEnvironment,
  loadTestData,
  executeQuery,
  buildPrefixes,
  TEST_DATA,
} from "./sparql-test-utils";

describe("SPARQL 1.1 Property Paths Compliance", () => {
  describe("Sequence Path (/)", () => {
    it("should follow sequence of properties", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT ?friend WHERE {
          ex:alice foaf:knows/foaf:name ?friend
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].friend).toBe("Bob");
    });
  });

  describe("Alternative Path (|)", () => {
    it("should match either property", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT ?value WHERE {
          ex:alice (foaf:name|foaf:mbox) ?value
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(2);
    });
  });

  describe("Inverse Path (^)", () => {
    it("should follow property in reverse direction", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT ?knower WHERE {
          ex:bob ^foaf:knows ?knower
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBe(1);
      expect(results[0].knower).toBe("http://example.org/alice");
    });
  });

  describe("Zero or More (*)", () => {
    it("should match transitive closure", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.hierarchy());

      const query = `
        ${buildPrefixes("ex", "rdfs")}
        SELECT ?class WHERE {
          ex:Dog rdfs:subClassOf* ?class
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("One or More (+)", () => {
    it("should match at least one step", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.hierarchy());

      const query = `
        ${buildPrefixes("ex", "rdfs")}
        SELECT ?class WHERE {
          ex:Dog rdfs:subClassOf+ ?class
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const classes = results.map((r) => r.class);
      expect(classes).not.toContain("http://example.org/Dog");
    });
  });

  describe("Zero or One (?)", () => {
    it("should match zero or one step", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.hierarchy());

      const query = `
        ${buildPrefixes("ex", "rdfs")}
        SELECT ?class WHERE {
          ex:Dog rdfs:subClassOf? ?class
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const classes = results.map((r) => r.class);
      expect(classes).toContain("http://example.org/Dog");
    });
  });

  describe("Negated Property Set (!)", () => {
    // Negated property sets are not yet implemented in AlgebraTranslator
    it.skip("should match properties not in set", async () => {
      const { store, executor } = createTestEnvironment();
      await loadTestData(store, TEST_DATA.foafPersons());

      const query = `
        ${buildPrefixes("foaf", "ex")}
        SELECT ?p ?o WHERE {
          ex:alice !foaf:name ?o
        }
      `;

      const results = await executeQuery(executor, query);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const hasName = results.some(
        (r) => r.o === "Alice"
      );
      expect(hasName).toBe(false);
    });
  });
});
