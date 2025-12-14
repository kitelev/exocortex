import { FilterExecutor } from "../../../../../src/infrastructure/sparql/executors/FilterExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { InMemoryTripleStore } from "../../../../../src/infrastructure/rdf/InMemoryTripleStore";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { Triple } from "../../../../../src/domain/models/rdf/Triple";
import type { FilterOperation, Expression } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("exo:byUUID() Function", () => {
  let executor: FilterExecutor;
  let store: InMemoryTripleStore;

  const UUID_1 = "550e8400-e29b-41d4-a716-446655440000";
  const UUID_2 = "7a1b2c3d-4e5f-6789-abcd-ef0123456789";
  const SUBJECT_URI_1 = `obsidian://vault/03%20Knowledge/kitelev/${UUID_1}.md`;
  const SUBJECT_URI_2 = `obsidian://vault/03%20Knowledge/kitelev/${UUID_2}.md`;

  const createTriple = (s: string, p: string, o: string): Triple => {
    const subject = new IRI(s);
    const predicate = new IRI(p);
    const object = o.startsWith("http") || o.startsWith("obsidian://")
      ? new IRI(o)
      : new Literal(o);
    return new Triple(subject, predicate, object);
  };

  beforeEach(async () => {
    store = new InMemoryTripleStore();
    executor = new FilterExecutor();
    executor.setTripleStore(store);

    // Add test triples
    await store.add(
      createTriple(
        SUBJECT_URI_1,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "https://exocortex.my/ontology/ems#Task"
      )
    );
    await store.add(
      createTriple(SUBJECT_URI_1, "https://exocortex.my/ontology/exo#Asset_label", "Test Task")
    );
    await store.add(
      createTriple(
        SUBJECT_URI_2,
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        "https://exocortex.my/ontology/ems#Project"
      )
    );
  });

  /**
   * Helper to create a byUUID function call expression.
   */
  function createByUUIDCall(uuidArg: Expression): Expression {
    return {
      type: "function",
      function: "byUUID",
      args: [uuidArg],
    } as Expression;
  }

  /**
   * Helper to create a literal expression.
   */
  function createLiteral(value: string): Expression {
    return {
      type: "literal",
      value,
    } as Expression;
  }

  describe("Basic UUID Resolution", () => {
    it("should resolve valid UUID to full obsidian:// URI", () => {
      const expr = createByUUIDCall(createLiteral(UUID_1));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeInstanceOf(IRI);
      expect((result as IRI).value).toBe(SUBJECT_URI_1);
    });

    it("should resolve UUID case-insensitively (lowercase input)", () => {
      const expr = createByUUIDCall(createLiteral(UUID_1.toLowerCase()));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeInstanceOf(IRI);
      expect((result as IRI).value).toBe(SUBJECT_URI_1);
    });

    it("should resolve UUID case-insensitively (uppercase input)", () => {
      const expr = createByUUIDCall(createLiteral(UUID_1.toUpperCase()));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeInstanceOf(IRI);
      expect((result as IRI).value).toBe(SUBJECT_URI_1);
    });

    it("should return undefined for non-existent UUID", () => {
      const nonExistentUUID = "00000000-0000-0000-0000-000000000000";
      const expr = createByUUIDCall(createLiteral(nonExistentUUID));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeUndefined();
    });

    it("should return undefined for empty UUID argument", () => {
      const expr = createByUUIDCall(createLiteral(""));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeUndefined();
    });

    it("should return undefined for invalid UUID format", () => {
      const expr = createByUUIDCall(createLiteral("not-a-valid-uuid"));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeUndefined();
    });
  });

  describe("Variable Argument Support", () => {
    it("should resolve UUID from variable binding", () => {
      const expr = createByUUIDCall({
        type: "variable",
        name: "uuidVar",
      } as Expression);

      const solution = new SolutionMapping();
      solution.set("uuidVar", new Literal(UUID_1));

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeInstanceOf(IRI);
      expect((result as IRI).value).toBe(SUBJECT_URI_1);
    });

    it("should return undefined for unbound UUID variable", () => {
      const expr = createByUUIDCall({
        type: "variable",
        name: "unboundVar",
      } as Expression);

      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeUndefined();
    });
  });

  describe("Filter Expression Usage", () => {
    async function* generateSolutions(solutions: SolutionMapping[]) {
      for (const solution of solutions) {
        yield solution;
      }
    }

    it("should filter solutions where subject equals byUUID result", async () => {
      // FILTER(?s = exo:byUUID('uuid'))
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "s" },
          right: createByUUIDCall(createLiteral(UUID_1)),
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("s", new IRI(SUBJECT_URI_1));

      const solution2 = new SolutionMapping();
      solution2.set("s", new IRI(SUBJECT_URI_2));

      const results = await executor.executeAll(operation, [solution1, solution2]);

      expect(results).toHaveLength(1);
      expect((results[0].get("s") as IRI).value).toBe(SUBJECT_URI_1);
    });

    it("should filter out all solutions for non-existent UUID", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "s" },
          right: createByUUIDCall(createLiteral("00000000-0000-0000-0000-000000000000")),
        },
        input: { type: "bgp", triples: [] },
      };

      const solution1 = new SolutionMapping();
      solution1.set("s", new IRI(SUBJECT_URI_1));

      const results = await executor.executeAll(operation, [solution1]);

      expect(results).toHaveLength(0);
    });
  });

  describe("BIND Usage Pattern", () => {
    it("should be usable in BIND context (via evaluateExpression)", () => {
      // Simulating: BIND(exo:byUUID('uuid') AS ?subject)
      const expr = createByUUIDCall(createLiteral(UUID_1));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeInstanceOf(IRI);
      expect((result as IRI).value).toBe(SUBJECT_URI_1);

      // The result can be bound to a variable
      solution.set("subject", result as IRI);
      expect((solution.get("subject") as IRI).value).toBe(SUBJECT_URI_1);
    });
  });

  describe("Caching", () => {
    it("should cache UUID lookup results", () => {
      const expr = createByUUIDCall(createLiteral(UUID_1));
      const solution = new SolutionMapping();

      // First call - populates cache
      const result1 = executor.evaluateExpression(expr, solution);

      // Second call - uses cache
      const result2 = executor.evaluateExpression(expr, solution);

      expect(result1).toBe(result2); // Same cached object
    });

    it("should cache negative results (not found)", () => {
      const nonExistentUUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const expr = createByUUIDCall(createLiteral(nonExistentUUID));
      const solution = new SolutionMapping();

      // First call
      const result1 = executor.evaluateExpression(expr, solution);
      expect(result1).toBeUndefined();

      // Verify it's cached as null
      const cached = executor.getCachedUUID(nonExistentUUID);
      expect(cached).toBeNull();
    });

    it("should support manual cache population", () => {
      const manualUUID = "abcdefab-cdef-abcd-efab-cdefabcdefab";
      const manualURI = "http://example.org/manual";

      // Manually cache a result
      executor.cacheUUIDResult(manualUUID, new IRI(manualURI));

      const expr = createByUUIDCall(createLiteral(manualUUID));
      const solution = new SolutionMapping();

      const result = executor.evaluateExpression(expr, solution);

      expect(result).toBeInstanceOf(IRI);
      expect((result as IRI).value).toBe(manualURI);
    });

    it("should clear cache when triple store is reset", () => {
      // First lookup populates cache
      const expr = createByUUIDCall(createLiteral(UUID_1));
      const solution = new SolutionMapping();
      executor.evaluateExpression(expr, solution);

      // Create new store and set it (should clear cache)
      const newStore = new InMemoryTripleStore();
      executor.setTripleStore(newStore);

      // Cache should be cleared
      const cached = executor.getCachedUUID(UUID_1);
      expect(cached).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should throw error for missing arguments", () => {
      const expr = {
        type: "function",
        function: "byUUID",
        args: [], // No arguments
      } as Expression;

      const solution = new SolutionMapping();

      expect(() => executor.evaluateExpression(expr, solution)).toThrow(
        "exo:byUUID requires exactly 1 argument"
      );
    });

    it("should throw error for too many arguments", () => {
      const expr = {
        type: "function",
        function: "byUUID",
        args: [createLiteral(UUID_1), createLiteral(UUID_2)],
      } as Expression;

      const solution = new SolutionMapping();

      expect(() => executor.evaluateExpression(expr, solution)).toThrow(
        "exo:byUUID requires exactly 1 argument"
      );
    });
  });

  describe("No Triple Store", () => {
    it("should return undefined when no triple store is set", () => {
      const noStoreExecutor = new FilterExecutor();
      // Don't set triple store

      const expr = createByUUIDCall(createLiteral(UUID_1));
      const solution = new SolutionMapping();

      const result = noStoreExecutor.evaluateExpression(expr, solution);

      expect(result).toBeUndefined();
    });
  });

  describe("Performance", () => {
    it("should resolve UUID in <10ms even with many triples", async () => {
      // Add many triples
      for (let i = 0; i < 1000; i++) {
        await store.add(
          createTriple(
            `http://example.org/entity/${i}`,
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
            "http://example.org/Entity"
          )
        );
      }

      const expr = createByUUIDCall(createLiteral(UUID_1));
      const solution = new SolutionMapping();

      const start = performance.now();
      const result = executor.evaluateExpression(expr, solution);
      const elapsed = performance.now() - start;

      expect(result).toBeInstanceOf(IRI);
      expect(elapsed).toBeLessThan(10); // <10ms requirement
    });
  });
});
