import { AggregateExecutor } from "../../../../src/infrastructure/sparql/executors/AggregateExecutor";
import { SolutionMapping } from "../../../../src/infrastructure/sparql/SolutionMapping";
import type { GroupOperation, AggregateBinding, AggregateExpression } from "../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import { Literal } from "../../../../src/domain/models/rdf/Literal";
import { IRI } from "../../../../src/domain/models/rdf/IRI";

describe("AggregateExecutor", () => {
  let executor: AggregateExecutor;

  beforeEach(() => {
    executor = new AggregateExecutor();
  });

  const createSolution = (bindings: Record<string, any>): SolutionMapping => {
    const solution = new SolutionMapping();
    for (const [key, value] of Object.entries(bindings)) {
      solution.set(key, value);
    }
    return solution;
  };

  /**
   * Helper to get aggregate result value - aggregate results are now RDF Literals
   */
  const getAggregateValue = (solution: SolutionMapping, variable: string): any => {
    const term = solution.get(variable);
    if (term instanceof Literal) {
      const rawValue = term.value;
      // Try to parse as number if it looks like one
      const num = parseFloat(rawValue);
      if (!isNaN(num) && rawValue === String(num)) {
        return num;
      }
      return rawValue;
    }
    return term;
  };

  const createGroupOperation = (
    variables: string[],
    aggregates: AggregateBinding[],
    input: any = { type: "bgp", patterns: [] }
  ): GroupOperation => ({
    type: "group",
    variables,
    aggregates,
    input,
  });

  const createCountAggregate = (variable: string, distinct = false): AggregateBinding => ({
    variable,
    expression: {
      type: "aggregate",
      aggregation: "count",
      distinct,
    },
  });

  const createSumAggregate = (variable: string, varName: string): AggregateBinding => ({
    variable,
    expression: {
      type: "aggregate",
      aggregation: "sum",
      expression: { type: "variable", name: varName },
      distinct: false,
    },
  });

  const createAvgAggregate = (variable: string, varName: string): AggregateBinding => ({
    variable,
    expression: {
      type: "aggregate",
      aggregation: "avg",
      expression: { type: "variable", name: varName },
      distinct: false,
    },
  });

  const createMinAggregate = (variable: string, varName: string): AggregateBinding => ({
    variable,
    expression: {
      type: "aggregate",
      aggregation: "min",
      expression: { type: "variable", name: varName },
      distinct: false,
    },
  });

  const createMaxAggregate = (variable: string, varName: string): AggregateBinding => ({
    variable,
    expression: {
      type: "aggregate",
      aggregation: "max",
      expression: { type: "variable", name: varName },
      distinct: false,
    },
  });

  const createGroupConcatAggregate = (
    variable: string,
    varName: string,
    separator = " ",
    distinct = false
  ): AggregateBinding => ({
    variable,
    expression: {
      type: "aggregate",
      aggregation: "group_concat",
      expression: { type: "variable", name: varName },
      separator,
      distinct,
    },
  });

  describe("COUNT", () => {
    it("should count all solutions without grouping", () => {
      const solutions = [
        createSolution({ x: "a" }),
        createSolution({ x: "b" }),
        createSolution({ x: "c" }),
      ];

      const operation = createGroupOperation([], [createCountAggregate("count")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "count")).toBe(3);
    });

    it("should count with GROUP BY", () => {
      const solutions = [
        createSolution({ class: "Task", x: "1" }),
        createSolution({ class: "Task", x: "2" }),
        createSolution({ class: "Project", x: "3" }),
      ];

      const operation = createGroupOperation(["class"], [createCountAggregate("count")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(2);

      // Use toJSON() for string comparison since get() returns RDF terms
      const taskResult = results.find((r) => r.toJSON()["class"] === "Task");
      const projectResult = results.find((r) => r.toJSON()["class"] === "Project");

      expect(getAggregateValue(taskResult!, "count")).toBe(2);
      expect(getAggregateValue(projectResult!, "count")).toBe(1);
    });

    it("should count distinct values", () => {
      const solutions = [
        createSolution({ x: "a" }),
        createSolution({ x: "a" }),
        createSolution({ x: "b" }),
      ];

      // COUNT(DISTINCT ?x) - must specify expression for distinct
      const operation = createGroupOperation([], [{
        variable: "count",
        expression: {
          type: "aggregate",
          aggregation: "count",
          expression: { type: "variable", name: "x" },
          distinct: true,
        },
      }]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "count")).toBe(2); // distinct: 'a' and 'b'
    });
  });

  describe("SUM", () => {
    it("should sum numeric values", () => {
      const solutions = [
        createSolution({ value: 10 }),
        createSolution({ value: 20 }),
        createSolution({ value: 30 }),
      ];

      const operation = createGroupOperation([], [createSumAggregate("total", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "total")).toBe(60);
    });

    it("should handle string numbers", () => {
      const solutions = [
        createSolution({ value: "10" }),
        createSolution({ value: "20" }),
      ];

      const operation = createGroupOperation([], [createSumAggregate("total", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "total")).toBe(30);
    });
  });

  describe("AVG", () => {
    it("should compute average", () => {
      const solutions = [
        createSolution({ value: 10 }),
        createSolution({ value: 20 }),
        createSolution({ value: 30 }),
      ];

      const operation = createGroupOperation([], [createAvgAggregate("avg", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "avg")).toBe(20);
    });

    it("should return 0 for empty input", () => {
      const solutions: SolutionMapping[] = [];

      const operation = createGroupOperation([], [createAvgAggregate("avg", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "avg")).toBe(0);
    });
  });

  describe("MIN", () => {
    it("should find minimum numeric value", () => {
      const solutions = [
        createSolution({ value: 30 }),
        createSolution({ value: 10 }),
        createSolution({ value: 20 }),
      ];

      const operation = createGroupOperation([], [createMinAggregate("min", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "min")).toBe(10);
    });

    it("should find minimum string value", () => {
      const solutions = [
        createSolution({ value: "charlie" }),
        createSolution({ value: "alpha" }),
        createSolution({ value: "bravo" }),
      ];

      const operation = createGroupOperation([], [createMinAggregate("min", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "min")).toBe("alpha");
    });
  });

  describe("MAX", () => {
    it("should find maximum numeric value", () => {
      const solutions = [
        createSolution({ value: 10 }),
        createSolution({ value: 30 }),
        createSolution({ value: 20 }),
      ];

      const operation = createGroupOperation([], [createMaxAggregate("max", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "max")).toBe(30);
    });
  });

  describe("GROUP_CONCAT", () => {
    it("should concatenate values with default separator", () => {
      const solutions = [
        createSolution({ name: "Alice" }),
        createSolution({ name: "Bob" }),
        createSolution({ name: "Charlie" }),
      ];

      const operation = createGroupOperation([], [createGroupConcatAggregate("names", "name")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "names")).toBe("Alice Bob Charlie");
    });

    it("should concatenate values with custom separator", () => {
      const solutions = [
        createSolution({ name: "Alice" }),
        createSolution({ name: "Bob" }),
      ];

      const operation = createGroupOperation([], [createGroupConcatAggregate("names", "name", ", ")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "names")).toBe("Alice, Bob");
    });

    it("should handle distinct values", () => {
      const solutions = [
        createSolution({ name: "Alice" }),
        createSolution({ name: "Alice" }),
        createSolution({ name: "Bob" }),
      ];

      const operation = createGroupOperation([], [createGroupConcatAggregate("names", "name", " ", true)]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "names")).toBe("Alice Bob");
    });
  });

  describe("Multiple aggregates", () => {
    it("should compute multiple aggregates in one query", () => {
      const solutions = [
        createSolution({ value: 10 }),
        createSolution({ value: 20 }),
        createSolution({ value: 30 }),
      ];

      const operation = createGroupOperation([], [
        createCountAggregate("count"),
        createSumAggregate("total", "value"),
        createAvgAggregate("average", "value"),
        createMinAggregate("minimum", "value"),
        createMaxAggregate("maximum", "value"),
      ]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "count")).toBe(3);
      expect(getAggregateValue(results[0], "total")).toBe(60);
      expect(getAggregateValue(results[0], "average")).toBe(20);
      expect(getAggregateValue(results[0], "minimum")).toBe(10);
      expect(getAggregateValue(results[0], "maximum")).toBe(30);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty input with COUNT returning 0", () => {
      const solutions: SolutionMapping[] = [];

      const operation = createGroupOperation([], [createCountAggregate("count")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "count")).toBe(0);
    });

    it("should handle missing values in aggregation", () => {
      const solutions = [
        createSolution({ value: 10 }),
        createSolution({}), // missing 'value'
        createSolution({ value: 20 }),
      ];

      const operation = createGroupOperation([], [createSumAggregate("total", "value")]);
      const results = executor.execute(operation, solutions);

      expect(results).toHaveLength(1);
      expect(getAggregateValue(results[0], "total")).toBe(30); // Only valid values summed
    });
  });

  /**
   * Tests for BIND expressions in aggregate functions (Issue #582).
   * Verifies that aggregates work correctly with:
   * - BIND-computed values (variables set to computed numbers)
   * - Inline arithmetic expressions in aggregates
   * - Function calls in aggregates
   */
  describe("BIND expressions in aggregates", () => {
    describe("BIND-computed numeric values", () => {
      it("should compute AVG with BIND-computed duration values", () => {
        // Simulates: BIND((?end - ?start) / 60000 AS ?duration), then AVG(?duration)
        // Values: 10, 20, 30 minutes -> AVG = 20
        const solutions = [
          createSolution({ duration: 10 }),  // raw number from BIND
          createSolution({ duration: 20 }),
          createSolution({ duration: 30 }),
        ];

        const operation = createGroupOperation([], [createAvgAggregate("avgDuration", "duration")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "avgDuration")).toBe(20);
      });

      it("should compute SUM with BIND-computed values", () => {
        // Total of BIND-computed durations
        const solutions = [
          createSolution({ durationSec: 1200 }),  // 20 minutes
          createSolution({ durationSec: 1800 }),  // 30 minutes
          createSolution({ durationSec: 2400 }),  // 40 minutes
        ];

        const operation = createGroupOperation([], [createSumAggregate("totalSec", "durationSec")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "totalSec")).toBe(5400);
      });

      it("should compute COUNT with BIND-computed values", () => {
        const solutions = [
          createSolution({ duration: 10 }),
          createSolution({ duration: 20 }),
          createSolution({ duration: 30 }),
        ];

        const operation = createGroupOperation([], [createCountAggregate("cnt")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "cnt")).toBe(3);
      });

      it("should compute MIN/MAX with BIND-computed values", () => {
        const solutions = [
          createSolution({ duration: 15 }),
          createSolution({ duration: 25 }),
          createSolution({ duration: 35 }),
        ];

        const operation = createGroupOperation([], [
          createMinAggregate("minDuration", "duration"),
          createMaxAggregate("maxDuration", "duration"),
        ]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "minDuration")).toBe(15);
        expect(getAggregateValue(results[0], "maxDuration")).toBe(35);
      });
    });

    describe("Inline arithmetic expressions in aggregates", () => {
      it("should compute SUM with inline arithmetic expression", () => {
        // SUM(?end - ?start) - aggregate contains arithmetic expression
        const solutions = [
          createSolution({ start: 100, end: 200 }),  // diff = 100
          createSolution({ start: 150, end: 300 }),  // diff = 150
          createSolution({ start: 200, end: 450 }),  // diff = 250
        ];

        const operation = createGroupOperation([], [{
          variable: "totalDiff",
          expression: {
            type: "aggregate",
            aggregation: "sum",
            expression: {
              type: "arithmetic",
              operator: "-",
              left: { type: "variable", name: "end" },
              right: { type: "variable", name: "start" },
            },
            distinct: false,
          },
        }]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "totalDiff")).toBe(500);  // 100 + 150 + 250
      });

      it("should compute AVG with inline division expression", () => {
        // AVG((?end - ?start) / 60) - convert ms to minutes inline
        const solutions = [
          createSolution({ start: 0, end: 600 }),     // 600/60 = 10
          createSolution({ start: 0, end: 1200 }),    // 1200/60 = 20
          createSolution({ start: 0, end: 1800 }),    // 1800/60 = 30
        ];

        const operation = createGroupOperation([], [{
          variable: "avgMinutes",
          expression: {
            type: "aggregate",
            aggregation: "avg",
            expression: {
              type: "arithmetic",
              operator: "/",
              left: {
                type: "arithmetic",
                operator: "-",
                left: { type: "variable", name: "end" },
                right: { type: "variable", name: "start" },
              },
              right: { type: "literal", value: 60 },
            },
            distinct: false,
          },
        }]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "avgMinutes")).toBe(20);  // (10+20+30)/3
      });

      it("should handle multiplication in aggregate expressions", () => {
        // SUM(?quantity * ?price)
        const solutions = [
          createSolution({ quantity: 2, price: 10 }),  // 20
          createSolution({ quantity: 3, price: 15 }),  // 45
          createSolution({ quantity: 1, price: 25 }),  // 25
        ];

        const operation = createGroupOperation([], [{
          variable: "totalValue",
          expression: {
            type: "aggregate",
            aggregation: "sum",
            expression: {
              type: "arithmetic",
              operator: "*",
              left: { type: "variable", name: "quantity" },
              right: { type: "variable", name: "price" },
            },
            distinct: false,
          },
        }]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "totalValue")).toBe(90);  // 20 + 45 + 25
      });
    });

    describe("Real-world duration calculations", () => {
      it("should compute average shower duration from timestamps", () => {
        // Simulates: BIND(xsd:integer(?end) - xsd:integer(?start)) / 60000 AS ?durationMin)
        // Then AVG(?durationMin)
        // This is the exact use case from Issue #582

        // Shower durations in minutes (already computed by BIND)
        const solutions = [
          createSolution({ durationMin: 18.5 }),
          createSolution({ durationMin: 22.0 }),
          createSolution({ durationMin: 19.5 }),
          createSolution({ durationMin: 21.0 }),
          createSolution({ durationMin: 20.0 }),
        ];

        const operation = createGroupOperation([], [createAvgAggregate("avgMinutes", "durationMin")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        // (18.5 + 22.0 + 19.5 + 21.0 + 20.0) / 5 = 101 / 5 = 20.2
        expect(getAggregateValue(results[0], "avgMinutes")).toBeCloseTo(20.2, 5);
      });

      it("should compute SUM and COUNT for manual average verification", () => {
        // This tests the workaround mentioned in Issue #582:
        // SELECT (SUM(?durationSec) AS ?totalSec) (COUNT(?s) AS ?count)
        const solutions = [
          createSolution({ s: "task1", durationSec: 1110 }),
          createSolution({ s: "task2", durationSec: 1320 }),
          createSolution({ s: "task3", durationSec: 1170 }),
          createSolution({ s: "task4", durationSec: 1260 }),
          createSolution({ s: "task5", durationSec: 1200 }),
        ];

        const operation = createGroupOperation([], [
          createSumAggregate("totalSec", "durationSec"),
          createCountAggregate("count"),
        ]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "totalSec")).toBe(6060);  // Sum of all seconds
        expect(getAggregateValue(results[0], "count")).toBe(5);
        // Manual verification: 6060 / 5 / 60 = 20.2 minutes average
      });
    });

    describe("Mixed types and edge cases", () => {
      it("should handle mix of BIND-computed and direct values", () => {
        // Some solutions have computed values, others have Literals
        const solutions = [
          createSolution({ value: 10 }),  // raw number
          createSolution({ value: new Literal("20", new IRI("http://www.w3.org/2001/XMLSchema#integer")) }),
          createSolution({ value: 30 }),  // raw number
        ];

        const operation = createGroupOperation([], [createSumAggregate("total", "value")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "total")).toBe(60);
      });

      it("should handle floating point BIND-computed values", () => {
        const solutions = [
          createSolution({ duration: 10.5 }),
          createSolution({ duration: 20.25 }),
          createSolution({ duration: 30.75 }),
        ];

        const operation = createGroupOperation([], [createAvgAggregate("avg", "duration")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        // (10.5 + 20.25 + 30.75) / 3 = 61.5 / 3 = 20.5
        expect(getAggregateValue(results[0], "avg")).toBeCloseTo(20.5, 5);
      });

      it("should skip undefined values from failed BIND expressions", () => {
        // Some BIND expressions may fail (e.g., division by zero, missing values)
        // These should result in undefined and be skipped in aggregation
        const solutions = [
          createSolution({ duration: 10 }),
          createSolution({ duration: undefined }),  // Failed BIND
          createSolution({ duration: 20 }),
          createSolution({}),  // Missing duration entirely
          createSolution({ duration: 30 }),
        ];

        const operation = createGroupOperation([], [createSumAggregate("total", "duration")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "total")).toBe(60);  // 10 + 20 + 30
      });

      it("should return 0 for AVG when all expressions fail", () => {
        const solutions = [
          createSolution({}),  // Missing duration
          createSolution({ other: 10 }),  // Wrong variable
        ];

        const operation = createGroupOperation([], [createAvgAggregate("avg", "duration")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);
        expect(getAggregateValue(results[0], "avg")).toBe(0);
      });
    });

    describe("Issue #534: Aggregate results should only contain GROUP BY and aggregate variables", () => {
      it("should NOT include extra variables from input solutions (Blocker 1)", () => {
        // This test verifies that aggregate results contain ONLY:
        // 1. Variables from GROUP BY clause
        // 2. Variables bound to aggregate expressions
        // NOT the original solution variables like ?x, ?extra, etc.
        const solutions = [
          createSolution({ class: "Task", x: "value1", extra: "ignored1" }),
          createSolution({ class: "Task", x: "value2", extra: "ignored2" }),
          createSolution({ class: "Project", x: "value3", extra: "ignored3" }),
        ];

        const operation = createGroupOperation(["class"], [createCountAggregate("count")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(2);

        // Each result should ONLY have 'class' (GROUP BY) and 'count' (aggregate)
        for (const result of results) {
          const vars = result.variables();
          expect(vars).toContain("class");
          expect(vars).toContain("count");
          // Should NOT contain extra variables from input solutions
          expect(vars).not.toContain("x");
          expect(vars).not.toContain("extra");
          // Exactly 2 variables: class + count
          expect(vars.length).toBe(2);
        }
      });

      it("should work correctly for global aggregates (no GROUP BY)", () => {
        // When there's no GROUP BY, result should only have aggregate variables
        const solutions = [
          createSolution({ value: 10, extra: "ignored1", other: "data1" }),
          createSolution({ value: 20, extra: "ignored2", other: "data2" }),
          createSolution({ value: 30, extra: "ignored3", other: "data3" }),
        ];

        const operation = createGroupOperation([], [
          createSumAggregate("total", "value"),
          createCountAggregate("count"),
        ]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);

        const result = results[0];
        const vars = result.variables();
        // Should ONLY have 'total' and 'count', NOT 'value', 'extra', 'other'
        expect(vars).toContain("total");
        expect(vars).toContain("count");
        expect(vars).not.toContain("value");
        expect(vars).not.toContain("extra");
        expect(vars).not.toContain("other");
        // Exactly 2 variables
        expect(vars.length).toBe(2);
      });

      it("should return clean results for sleep analysis query pattern (Issue #534)", () => {
        // Simulates: SELECT (AVG(?duration) AS ?avgSleepMinutes) WHERE { ... BIND(...) }
        // Previously would return extra variables like ?start, ?end, ?s alongside ?avgSleepMinutes
        const solutions = [
          createSolution({ s: "sleep1", start: "2025-12-01T23:00", end: "2025-12-02T07:00", duration: 480 }),
          createSolution({ s: "sleep2", start: "2025-12-02T22:30", end: "2025-12-03T06:30", duration: 480 }),
          createSolution({ s: "sleep3", start: "2025-12-03T23:30", end: "2025-12-04T07:00", duration: 450 }),
        ];

        const operation = createGroupOperation([], [createAvgAggregate("avgSleepMinutes", "duration")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(1);

        const result = results[0];
        const vars = result.variables();

        // Should ONLY contain 'avgSleepMinutes', not ?s, ?start, ?end, ?duration
        expect(vars).toEqual(["avgSleepMinutes"]);
        expect(getAggregateValue(result, "avgSleepMinutes")).toBeCloseTo(470, 0); // (480+480+450)/3
      });
    });

    describe("GROUP BY with BIND-computed values", () => {
      it("should compute per-group averages with BIND values", () => {
        // GROUP BY ?prototype, then AVG(?duration) per group
        const solutions = [
          createSolution({ prototype: "shower", duration: 20 }),
          createSolution({ prototype: "shower", duration: 22 }),
          createSolution({ prototype: "commute", duration: 45 }),
          createSolution({ prototype: "commute", duration: 50 }),
          createSolution({ prototype: "commute", duration: 55 }),
        ];

        const operation = createGroupOperation(["prototype"], [createAvgAggregate("avgDuration", "duration")]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(2);

        const showerResult = results.find((r) => r.toJSON()["prototype"] === "shower");
        const commuteResult = results.find((r) => r.toJSON()["prototype"] === "commute");

        expect(getAggregateValue(showerResult!, "avgDuration")).toBe(21);  // (20+22)/2
        expect(getAggregateValue(commuteResult!, "avgDuration")).toBe(50);  // (45+50+55)/3
      });

      it("should compute SUM with inline expression and GROUP BY", () => {
        // GROUP BY category, SUM(quantity * price) per category
        const solutions = [
          createSolution({ category: "A", quantity: 2, price: 10 }),
          createSolution({ category: "A", quantity: 3, price: 10 }),
          createSolution({ category: "B", quantity: 1, price: 50 }),
          createSolution({ category: "B", quantity: 2, price: 50 }),
        ];

        const operation = createGroupOperation(["category"], [{
          variable: "totalValue",
          expression: {
            type: "aggregate",
            aggregation: "sum",
            expression: {
              type: "arithmetic",
              operator: "*",
              left: { type: "variable", name: "quantity" },
              right: { type: "variable", name: "price" },
            },
            distinct: false,
          },
        }]);
        const results = executor.execute(operation, solutions);

        expect(results).toHaveLength(2);

        const resultA = results.find((r) => r.toJSON()["category"] === "A");
        const resultB = results.find((r) => r.toJSON()["category"] === "B");

        expect(getAggregateValue(resultA!, "totalValue")).toBe(50);   // 2*10 + 3*10
        expect(getAggregateValue(resultB!, "totalValue")).toBe(150);  // 1*50 + 2*50
      });
    });
  });
});
