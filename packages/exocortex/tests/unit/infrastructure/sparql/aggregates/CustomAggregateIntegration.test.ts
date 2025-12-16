import { AggregateExecutor } from "../../../../../src/infrastructure/sparql/executors/AggregateExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import {
  CustomAggregateRegistry,
  type CustomAggregate,
  type AggregateState,
} from "../../../../../src/infrastructure/sparql/aggregates/CustomAggregateRegistry";
import { EXO_AGGREGATE_NS } from "../../../../../src/infrastructure/sparql/aggregates/BuiltInAggregates";
import type { GroupOperation, AggregateExpression } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

const XSD_DECIMAL = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
const XSD_INTEGER = new IRI("http://www.w3.org/2001/XMLSchema#integer");

describe("Custom Aggregate Integration", () => {
  let executor: AggregateExecutor;

  beforeEach(() => {
    executor = new AggregateExecutor();
    CustomAggregateRegistry.resetInstance();
  });

  afterAll(() => {
    CustomAggregateRegistry.resetInstance();
  });

  const createSolution = (bindings: Record<string, any>): SolutionMapping => {
    const solution = new SolutionMapping();
    for (const [key, value] of Object.entries(bindings)) {
      if (value instanceof Literal || value instanceof IRI) {
        solution.set(key, value);
      } else if (typeof value === "number") {
        solution.set(key, new Literal(String(value), XSD_DECIMAL));
      } else {
        solution.set(key, new Literal(String(value)));
      }
    }
    return solution;
  };

  describe("built-in custom aggregates", () => {
    it("should compute median aggregate", () => {
      const solutions = [
        createSolution({ category: "A", price: 10 }),
        createSolution({ category: "A", price: 30 }),
        createSolution({ category: "A", price: 20 }),
      ];

      const operation: GroupOperation = {
        type: "group",
        variables: ["category"],
        aggregates: [
          {
            variable: "medianPrice",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}median` },
              expression: { type: "variable", name: "price" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const medianPrice = results[0].get("medianPrice") as Literal;
      expect(parseFloat(medianPrice.value)).toBe(20); // Median of [10, 20, 30] = 20
    });

    it("should compute variance aggregate", () => {
      // Values: 2, 4, 4, 4, 5, 5, 7, 9
      // Mean: 5, Variance: 4
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const solutions = values.map((v) => createSolution({ group: "A", value: v }));

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "variance",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}variance` },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const variance = results[0].get("variance") as Literal;
      expect(parseFloat(variance.value)).toBeCloseTo(4, 5);
    });

    it("should compute stddev aggregate", () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const solutions = values.map((v) => createSolution({ group: "A", value: v }));

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "stddev",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}stddev` },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const stddev = results[0].get("stddev") as Literal;
      expect(parseFloat(stddev.value)).toBeCloseTo(2, 5); // sqrt(4) = 2
    });

    it("should compute mode aggregate", () => {
      const solutions = [
        createSolution({ group: "A", status: "active" }),
        createSolution({ group: "A", status: "pending" }),
        createSolution({ group: "A", status: "active" }),
        createSolution({ group: "A", status: "active" }),
        createSolution({ group: "A", status: "done" }),
      ];

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "mostCommon",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}mode` },
              expression: { type: "variable", name: "status" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const mode = results[0].get("mostCommon") as Literal;
      expect(mode.value).toBe("active");
    });

    it("should compute percentile aggregate", () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const solutions = values.map((v) => createSolution({ group: "A", value: v }));

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "p90",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}percentile90` },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const p90 = results[0].get("p90") as Literal;
      // 90th percentile of 1-10 = 9.1 (interpolated)
      expect(parseFloat(p90.value)).toBeCloseTo(9.1, 1);
    });
  });

  describe("user-registered custom aggregates", () => {
    it("should execute user-registered aggregate", () => {
      // Register a custom "product" aggregate that multiplies all values
      interface ProductState extends AggregateState {
        product: number;
      }

      const productAggregate: CustomAggregate = {
        init: (): ProductState => ({ product: 1 }),
        step: (state: AggregateState, value) => {
          const num = typeof value === "number" ? value : parseFloat(String(value));
          if (!isNaN(num)) {
            (state as ProductState).product *= num;
          }
        },
        finalize: (state: AggregateState) => {
          return new Literal(String((state as ProductState).product), XSD_DECIMAL);
        },
      };

      const registry = CustomAggregateRegistry.getInstance();
      registry.register("http://example.org/agg/product", productAggregate);

      const solutions = [
        createSolution({ group: "A", value: 2 }),
        createSolution({ group: "A", value: 3 }),
        createSolution({ group: "A", value: 4 }),
      ];

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "product",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: "http://example.org/agg/product" },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const product = results[0].get("product") as Literal;
      expect(parseFloat(product.value)).toBe(24); // 2 * 3 * 4 = 24
    });

    it("should prefer user-registered aggregate over built-in with same IRI", () => {
      // Register a custom aggregate with same IRI as built-in (would be unusual but possible)
      const registry = CustomAggregateRegistry.getInstance();
      registry.register(`${EXO_AGGREGATE_NS}median`, {
        init: () => ({ values: [] }),
        step: () => {}, // No-op
        finalize: () => new Literal("CUSTOM", XSD_DECIMAL), // Always returns "CUSTOM"
      });

      const solutions = [
        createSolution({ group: "A", value: 10 }),
        createSolution({ group: "A", value: 20 }),
      ];

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "median",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}median` },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const median = results[0].get("median") as Literal;
      expect(median.value).toBe("CUSTOM"); // User-registered takes precedence
    });
  });

  describe("error handling", () => {
    it("should throw error for unknown custom aggregate", () => {
      const solutions = [createSolution({ group: "A", value: 10 })];

      const operation: GroupOperation = {
        type: "group",
        variables: ["group"],
        aggregates: [
          {
            variable: "result",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: "http://example.org/agg/nonexistent" },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      expect(() => executor.execute(operation, solutions)).toThrow(
        /Unknown custom aggregate function: http:\/\/example\.org\/agg\/nonexistent/
      );
    });
  });

  describe("GROUP BY with custom aggregates", () => {
    it("should group by multiple categories and compute aggregates per group", () => {
      const solutions = [
        createSolution({ category: "A", subcategory: "X", price: 10 }),
        createSolution({ category: "A", subcategory: "X", price: 20 }),
        createSolution({ category: "A", subcategory: "Y", price: 30 }),
        createSolution({ category: "B", subcategory: "X", price: 5 }),
        createSolution({ category: "B", subcategory: "X", price: 15 }),
      ];

      const operation: GroupOperation = {
        type: "group",
        variables: ["category", "subcategory"],
        aggregates: [
          {
            variable: "medianPrice",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}median` },
              expression: { type: "variable", name: "price" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(3); // A-X, A-Y, B-X

      // Find each group's result
      const groupAX = results.find(
        (r) =>
          (r.get("category") as Literal)?.value === "A" &&
          (r.get("subcategory") as Literal)?.value === "X"
      );
      const groupAY = results.find(
        (r) =>
          (r.get("category") as Literal)?.value === "A" &&
          (r.get("subcategory") as Literal)?.value === "Y"
      );
      const groupBX = results.find(
        (r) =>
          (r.get("category") as Literal)?.value === "B" &&
          (r.get("subcategory") as Literal)?.value === "X"
      );

      expect(groupAX).toBeDefined();
      expect(groupAY).toBeDefined();
      expect(groupBX).toBeDefined();

      // A-X: median of [10, 20] = 15
      expect(parseFloat((groupAX!.get("medianPrice") as Literal).value)).toBe(15);

      // A-Y: median of [30] = 30
      expect(parseFloat((groupAY!.get("medianPrice") as Literal).value)).toBe(30);

      // B-X: median of [5, 15] = 10
      expect(parseFloat((groupBX!.get("medianPrice") as Literal).value)).toBe(10);
    });

    it("should handle empty group result for custom aggregates", () => {
      const solutions: SolutionMapping[] = [];

      const operation: GroupOperation = {
        type: "group",
        variables: [],
        aggregates: [
          {
            variable: "median",
            expression: {
              type: "aggregate",
              aggregation: { type: "custom", iri: `${EXO_AGGREGATE_NS}median` },
              expression: { type: "variable", name: "value" },
              distinct: false,
            },
          },
        ],
        input: { type: "bgp", triples: [] },
      };

      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      const median = results[0].get("median") as Literal;
      expect(median.value).toBe("0"); // Empty group returns 0
    });
  });
});
