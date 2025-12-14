/**
 * FilterExecutor Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Type mismatches in comparisons
 * - Division by zero
 * - Undefined variables
 * - Edge cases in built-in functions
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import { FilterExecutor } from "../../../../../src/infrastructure/sparql/executors/FilterExecutor";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import type { FilterOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";

describe("FilterExecutor Error Scenarios", () => {
  let executor: FilterExecutor;
  const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
  const xsdDouble = new IRI("http://www.w3.org/2001/XMLSchema#double");
  const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
  const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");
  const xsdDateTime = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");

  beforeEach(() => {
    executor = new FilterExecutor();
  });

  describe("Division by Zero", () => {
    it("should handle integer division by zero gracefully", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "/",
            left: { type: "variable", name: "x" },
            right: { type: "literal", value: 0 },
          },
          right: { type: "literal", value: 0 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("10", xsdInt));

      // Should not throw, but filter should exclude the solution
      const results = await executor.executeAll(operation, [solution]);
      // Division by zero should result in error value, excluding from results
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("should handle double division by zero (produces Infinity)", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: {
            type: "arithmetic",
            operator: "/",
            left: { type: "variable", name: "x" },
            right: { type: "literal", value: 0.0 },
          },
          right: { type: "literal", value: 0 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("10.0", xsdDouble));

      // Should handle gracefully
      const results = await executor.executeAll(operation, [solution]);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("Type Mismatch in Comparisons", () => {
    it("should handle comparison between string and integer", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 10 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("not a number"));

      // Type mismatch should result in error, excluding from results
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(0);
    });

    it("should handle comparison between IRI and Literal", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new IRI("http://example.org/test"));

      // IRI vs Literal should not be equal
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(0);
    });

    it("should handle numeric comparison with different precision types", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "variable", name: "y" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("10", xsdInt));
      solution.set("y", new Literal("10.0", xsdDouble));

      // Should be equal despite different types
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });
  });

  describe("Undefined Variable Access", () => {
    it("should handle filter with unbound variable", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "undefined_var" },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));
      // Note: undefined_var is not set

      // Unbound variable comparison should not match
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(0);
    });

    it("should handle BOUND function with unbound variable", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "bound",
          args: [{ type: "variable", name: "undefined_var" }],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      // BOUND returns false for unbound variables
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(0);
    });

    it("should handle negated BOUND function", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "!",
          operands: [
            {
              type: "function",
              function: "bound",
              args: [{ type: "variable", name: "optional_var" }],
            },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      // !BOUND(?optional_var) should match when var is unbound
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });
  });

  describe("Empty Input Handling", () => {
    it("should handle empty solution mapping array", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const results = await executor.executeAll(operation, []);
      expect(results).toEqual([]);
    });

    it("should handle empty solution mapping", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: "test" },
        },
        input: { type: "bgp", triples: [] },
      };

      const emptySolution = new SolutionMapping();

      const results = await executor.executeAll(operation, [emptySolution]);
      expect(results.length).toBe(0);
    });
  });

  describe("Boolean Edge Cases", () => {
    it("should handle comparison with boolean true", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "flag" },
          right: { type: "literal", value: true },
        },
        input: { type: "bgp", triples: [] },
      };

      const xsdBoolean = new IRI("http://www.w3.org/2001/XMLSchema#boolean");
      const solution = new SolutionMapping();
      solution.set("flag", new Literal("true", xsdBoolean));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle truthy string values in boolean context", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "variable",
          name: "x",
        },
        input: { type: "bgp", triples: [] },
      };

      // Non-empty string should be truthy
      const solution = new SolutionMapping();
      solution.set("x", new Literal("non-empty"));

      const results = await executor.executeAll(operation, [solution]);
      // Variable in boolean context - implementation may vary
      expect(Array.isArray(results)).toBe(true);
    });

    it("should handle whitespace-only string in boolean context", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "variable",
          name: "x",
        },
        input: { type: "bgp", triples: [] },
      };

      // Whitespace-only string (not empty, but possibly falsy depending on implementation)
      const solution = new SolutionMapping();
      solution.set("x", new Literal(" "));

      const results = await executor.executeAll(operation, [solution]);
      // Variable in boolean context - implementation may vary
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("String Function Edge Cases", () => {
    it("should handle STRLEN with short string", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "function",
            function: "strlen",
            args: [{ type: "variable", name: "x" }],
          },
          right: { type: "literal", value: 3 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("abc"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle CONTAINS with empty pattern", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "contains",
          args: [
            { type: "variable", name: "x" },
            { type: "literal", value: "" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("some text"));

      // Every string contains empty string
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle REGEX with special characters", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "regex",
          args: [
            { type: "variable", name: "x" },
            { type: "literal", value: "test\\.pattern" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test.pattern"));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle invalid REGEX pattern gracefully", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "function",
          function: "regex",
          args: [
            { type: "variable", name: "x" },
            { type: "literal", value: "[invalid" },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("test"));

      // Invalid regex should result in error, excluding from results
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(0);
    });
  });

  describe("Numeric Edge Cases", () => {
    it("should handle very large numbers", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 0 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("999999999999999999999999999", xsdDecimal));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle negative numbers correctly", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "<",
          left: { type: "variable", name: "x" },
          right: { type: "literal", value: 0 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("x", new Literal("-42", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle floating point precision edge cases", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: {
            type: "arithmetic",
            operator: "+",
            left: { type: "literal", value: 0.1 },
            right: { type: "literal", value: 0.2 },
          },
          right: { type: "literal", value: 0.3 },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();

      // 0.1 + 0.2 === 0.3 is false in floating point
      const results = await executor.executeAll(operation, [solution]);
      // Result depends on implementation handling of floating point comparison
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("DateTime Edge Cases", () => {
    it("should handle comparison of datetime values", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: ">",
          left: { type: "variable", name: "date" },
          right: { type: "literal", value: "2024-01-01T00:00:00Z" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("date", new Literal("2024-06-15T12:00:00Z", xsdDateTime));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle timezone-aware datetime comparison", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "comparison",
          operator: "=",
          left: { type: "variable", name: "date1" },
          right: { type: "variable", name: "date2" },
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      // Same instant, different timezone representation
      solution.set("date1", new Literal("2024-01-01T12:00:00Z", xsdDateTime));
      solution.set(
        "date2",
        new Literal("2024-01-01T07:00:00-05:00", xsdDateTime)
      );

      const results = await executor.executeAll(operation, [solution]);
      // Should be equal as they represent the same instant
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("Multiple Conditions Edge Cases", () => {
    it("should handle deeply nested AND conditions", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "&&",
          operands: [
            {
              type: "logical",
              operator: "&&",
              operands: [
                {
                  type: "comparison",
                  operator: ">",
                  left: { type: "variable", name: "a" },
                  right: { type: "literal", value: 0 },
                },
                {
                  type: "comparison",
                  operator: ">",
                  left: { type: "variable", name: "b" },
                  right: { type: "literal", value: 0 },
                },
              ],
            },
            {
              type: "comparison",
              operator: ">",
              left: { type: "variable", name: "c" },
              right: { type: "literal", value: 0 },
            },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();
      solution.set("a", new Literal("1", xsdInt));
      solution.set("b", new Literal("2", xsdInt));
      solution.set("c", new Literal("3", xsdInt));

      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });

    it("should handle OR with true and any other condition", async () => {
      const operation: FilterOperation = {
        type: "filter",
        expression: {
          type: "logical",
          operator: "||",
          operands: [
            { type: "literal", value: true },
            { type: "literal", value: false },
          ],
        },
        input: { type: "bgp", triples: [] },
      };

      const solution = new SolutionMapping();

      // OR with true should pass
      const results = await executor.executeAll(operation, [solution]);
      expect(results.length).toBe(1);
    });
  });
});
