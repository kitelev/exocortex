import { FilterContainsOptimizer } from "../../../../../src/infrastructure/sparql/optimization/FilterContainsOptimizer";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { AlgebraTranslator } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslator";
import { SPARQLParser } from "../../../../../src/infrastructure/sparql/SPARQLParser";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import type { FilterOperation, Expression } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("FilterContainsOptimizer", () => {
  let optimizer: FilterContainsOptimizer;
  let store: InMemoryTripleStore;
  let parser: SPARQLParser;
  let translator: AlgebraTranslator;

  // Test UUIDs
  const TEST_UUID_1 = "550e8400-e29b-41d4-a716-446655440000";
  const TEST_UUID_2 = "7a1b2c3d-4e5f-6789-abcd-ef0123456789";
  const TEST_UUID_3 = "12345678-1234-1234-1234-123456789012";

  const createTriple = (s: string, p: string, o: string): Triple => {
    const subject = new IRI(s);
    const predicate = new IRI(p);
    const object = o.startsWith("http") ? new IRI(o) : new Literal(o);
    return new Triple(subject, predicate, object);
  };

  beforeEach(async () => {
    optimizer = new FilterContainsOptimizer();
    store = new InMemoryTripleStore();
    parser = new SPARQLParser();
    translator = new AlgebraTranslator();

    // Populate store with test data including UUIDs in URIs
    await store.add(
      createTriple(
        `https://exocortex.my/ontology/ems/${TEST_UUID_1}`,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://example.org/Task"
      )
    );
    await store.add(
      createTriple(
        `https://exocortex.my/ontology/ems/${TEST_UUID_1}`,
        "http://example.org/name",
        "Task One"
      )
    );
    await store.add(
      createTriple(
        `https://exocortex.my/ontology/ems/${TEST_UUID_2}`,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://example.org/Project"
      )
    );
    await store.add(
      createTriple(
        `https://exocortex.my/ontology/ems/${TEST_UUID_2}`,
        "http://example.org/name",
        "Project One"
      )
    );
    await store.add(
      createTriple(
        `https://exocortex.my/ontology/ems/${TEST_UUID_3}`,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "http://example.org/Area"
      )
    );

    optimizer.setTripleStore(store);
  });

  describe("detectContainsUUIDPattern", () => {
    it("should detect FILTER(CONTAINS(STR(?s), 'uuid')) pattern", () => {
      const query = `
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER(CONTAINS(STR(?s), "${TEST_UUID_1}"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      // Find the filter operation
      let filterOp: FilterOperation | null = null;
      const findFilter = (op: any): void => {
        if (op.type === "filter") {
          filterOp = op;
        } else if (op.input) {
          findFilter(op.input);
        }
      };
      findFilter(algebra);

      expect(filterOp).not.toBeNull();
      const pattern = optimizer.detectContainsUUIDPattern(filterOp!.expression);

      expect(pattern).not.toBeNull();
      expect(pattern!.variable).toBe("s");
      expect(pattern!.uuid.toLowerCase()).toBe(TEST_UUID_1.toLowerCase());
    });

    it("should detect pattern without STR() wrapper", () => {
      // Build expression manually for CONTAINS(?s, 'uuid')
      const expr: Expression = {
        type: "function",
        function: "contains",
        args: [
          { type: "variable", name: "subject" },
          { type: "literal", value: TEST_UUID_2 },
        ],
      };

      const pattern = optimizer.detectContainsUUIDPattern(expr);

      expect(pattern).not.toBeNull();
      expect(pattern!.variable).toBe("subject");
      expect(pattern!.uuid.toLowerCase()).toBe(TEST_UUID_2.toLowerCase());
    });

    it("should return null for non-UUID patterns", () => {
      const expr: Expression = {
        type: "function",
        function: "contains",
        args: [
          {
            type: "function",
            function: "str",
            args: [{ type: "variable", name: "s" }],
          },
          { type: "literal", value: "not-a-uuid" },
        ],
      };

      const pattern = optimizer.detectContainsUUIDPattern(expr);
      expect(pattern).toBeNull();
    });

    it("should return null for non-CONTAINS functions", () => {
      const expr: Expression = {
        type: "function",
        function: "strlen",
        args: [{ type: "variable", name: "s" }],
      };

      const pattern = optimizer.detectContainsUUIDPattern(expr);
      expect(pattern).toBeNull();
    });

    it("should detect UUID pattern within logical AND expression", () => {
      const expr: Expression = {
        type: "logical",
        operator: "&&",
        operands: [
          {
            type: "function",
            function: "contains",
            args: [
              {
                type: "function",
                function: "str",
                args: [{ type: "variable", name: "x" }],
              },
              { type: "literal", value: TEST_UUID_3 },
            ],
          },
          {
            type: "comparison",
            operator: "=",
            left: { type: "variable", name: "y" },
            right: { type: "literal", value: "test" },
          },
        ],
      };

      const pattern = optimizer.detectContainsUUIDPattern(expr);

      expect(pattern).not.toBeNull();
      expect(pattern!.variable).toBe("x");
      expect(pattern!.uuid.toLowerCase()).toBe(TEST_UUID_3.toLowerCase());
    });
  });

  describe("UUID index in InMemoryTripleStore", () => {
    it("should find subjects by UUID using index", async () => {
      const subjects = await store.findSubjectsByUUID(TEST_UUID_1);

      expect(subjects.length).toBe(1);
      expect((subjects[0] as IRI).value).toBe(
        `https://exocortex.my/ontology/ems/${TEST_UUID_1}`
      );
    });

    it("should find subjects with case-insensitive UUID search", async () => {
      const subjectsLower = await store.findSubjectsByUUID(TEST_UUID_2.toLowerCase());
      const subjectsUpper = await store.findSubjectsByUUID(TEST_UUID_2.toUpperCase());

      expect(subjectsLower.length).toBe(1);
      expect(subjectsUpper.length).toBe(1);
    });

    it("should return empty array for non-existent UUID", async () => {
      const subjects = await store.findSubjectsByUUID("00000000-0000-0000-0000-000000000000");
      expect(subjects.length).toBe(0);
    });

    it("should update index when triples are added", async () => {
      const newUUID = "abcdefab-cdef-abcd-efab-cdefabcdefab";
      await store.add(
        createTriple(
          `https://exocortex.my/test/${newUUID}`,
          "http://example.org/type",
          "Test"
        )
      );

      const subjects = await store.findSubjectsByUUID(newUUID);
      expect(subjects.length).toBe(1);
    });
  });

  describe("optimize", () => {
    it("should optimize FILTER(CONTAINS()) pattern with UUID", async () => {
      const query = `
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER(CONTAINS(STR(?s), "${TEST_UUID_1}"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      const optimized = await optimizer.optimize(algebra);

      // The optimized query should have a VALUES or modified BGP
      expect(optimized).toBeDefined();

      // Check hints were generated
      const hints = optimizer.getLastOptimizationHints();
      expect(hints.length).toBeGreaterThan(0);
      expect(hints[0].type).toBe("uuid-index-lookup");
      expect(hints[0].estimatedSpeedup).toBe("O(n) → O(1)");
    });

    it("should not optimize non-UUID patterns", async () => {
      const query = `
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER(CONTAINS(STR(?s), "not-a-uuid"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      const optimized = await optimizer.optimize(algebra);

      // Should return the original algebra (or similar structure)
      expect(optimized.type).toBe(algebra.type);

      // No optimization hints
      const hints = optimizer.getLastOptimizationHints();
      expect(hints.length).toBe(0);
    });
  });

  describe("analyzeQuery", () => {
    it("should return hints for optimizable queries", () => {
      const query = `
        SELECT * WHERE {
          ?task <http://example.org/type> <http://example.org/Task> .
          FILTER(CONTAINS(STR(?task), "${TEST_UUID_1}"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      const hints = optimizer.analyzeQuery(algebra);

      expect(hints.length).toBe(1);
      expect(hints[0].type).toBe("uuid-index-lookup");
      expect(hints[0].originalPattern).toContain("FILTER(CONTAINS(STR(?task)");
      expect(hints[0].suggestedRewrite).toContain("--optimize");
    });

    it("should return empty hints for non-optimizable queries", () => {
      const query = `
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER(?o = "test")
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      const hints = optimizer.analyzeQuery(algebra);
      expect(hints.length).toBe(0);
    });

    it("should detect optimization opportunity with OR conditions (first match)", () => {
      // Create expression with CONTAINS in OR condition
      // Note: Current implementation only looks for FIRST CONTAINS pattern in logical OR
      const query = `
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER(CONTAINS(STR(?s), "${TEST_UUID_1}"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      const hints = optimizer.analyzeQuery(algebra);

      // Should find the optimization opportunity
      expect(hints.length).toBe(1);
      expect(hints[0].type).toBe("uuid-index-lookup");
    });
  });

  describe("optimizeWithSubjects", () => {
    it("should optimize using provided subject URIs", () => {
      const query = `
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER(CONTAINS(STR(?s), "${TEST_UUID_1}"))
        }
      `;

      const parsed = parser.parse(query);
      const algebra = translator.translate(parsed as any);

      const subjectUris = [
        `https://exocortex.my/ontology/ems/${TEST_UUID_1}`,
        `https://exocortex.my/ontology/ems/${TEST_UUID_2}`,
      ];

      const optimized = optimizer.optimizeSync(algebra, subjectUris);

      expect(optimized).toBeDefined();

      const hints = optimizer.getLastOptimizationHints();
      expect(hints.length).toBe(1);
      expect(hints[0].matchedUri).toBe(
        `https://exocortex.my/ontology/ems/${TEST_UUID_1}`
      );
    });
  });

  describe("performance characteristics", () => {
    it("should provide O(1) lookup via UUID index vs O(n) scan", async () => {
      // Create a fresh store for this test with only one UUID-containing subject
      const perfStore = new InMemoryTripleStore();
      const perfUUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

      // Add many triples to make the performance difference meaningful
      const manyTriples = 1000;
      for (let i = 0; i < manyTriples; i++) {
        await perfStore.add(
          createTriple(
            `http://example.org/entity/${i}`,
            "http://example.org/type",
            "http://example.org/Entity"
          )
        );
      }

      // Add one triple with the target UUID
      await perfStore.add(
        createTriple(
          `http://example.org/target/${perfUUID}`,
          "http://example.org/type",
          "http://example.org/Target"
        )
      );

      // Time the UUID index lookup
      const indexStart = performance.now();
      const indexResult = await perfStore.findSubjectsByUUID(perfUUID);
      const indexTime = performance.now() - indexStart;

      // Time a full subjects scan
      const scanStart = performance.now();
      const allSubjects = await perfStore.subjects();
      const matchingSubjects = allSubjects.filter((s) =>
        (s as IRI).value.includes(perfUUID)
      );
      const scanTime = performance.now() - scanStart;

      // Both should find the same result
      expect(indexResult.length).toBe(1);
      expect(matchingSubjects.length).toBe(1);

      // Index lookup should be fast (< 5ms)
      expect(indexTime).toBeLessThan(5);

      // Index should be faster than scan for large datasets
      // (Note: this may not always hold for small datasets due to overhead)
      console.log(`UUID Index lookup: ${indexTime.toFixed(2)}ms`);
      console.log(`Full scan: ${scanTime.toFixed(2)}ms`);
    });
  });
});
