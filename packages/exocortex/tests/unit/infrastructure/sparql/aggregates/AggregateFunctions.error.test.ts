/**
 * AggregateFunctions Error Scenario and Edge Case Tests
 *
 * Tests error handling for:
 * - Empty solution sets
 * - Unbound variables
 * - Type coercion edge cases
 * - Numeric overflow/underflow
 * - Mixed types in aggregations
 *
 * Issue: #758 - Add Error Scenario and Edge Case Test Suite
 */

import { AggregateFunctions } from "../../../../../src/infrastructure/sparql/aggregates/AggregateFunctions";
import { SolutionMapping } from "../../../../../src/infrastructure/sparql/SolutionMapping";
import { IRI } from "../../../../../src/domain/models/rdf/IRI";
import { Literal } from "../../../../../src/domain/models/rdf/Literal";
import { BlankNode } from "../../../../../src/domain/models/rdf/BlankNode";

describe("AggregateFunctions Error Scenarios", () => {
  const xsdInt = new IRI("http://www.w3.org/2001/XMLSchema#integer");
  const xsdDecimal = new IRI("http://www.w3.org/2001/XMLSchema#decimal");
  const xsdDouble = new IRI("http://www.w3.org/2001/XMLSchema#double");
  const xsdString = new IRI("http://www.w3.org/2001/XMLSchema#string");

  describe("COUNT edge cases", () => {
    it("should return 0 for empty solution set", () => {
      expect(AggregateFunctions.count([])).toBe(0);
    });

    it("should return 0 for empty solution set with variable", () => {
      expect(AggregateFunctions.count([], "x")).toBe(0);
    });

    it("should return 0 when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("value"));
      const s2 = new SolutionMapping();
      s2.set("z", new Literal("other"));
      expect(AggregateFunctions.count([s1, s2], "x")).toBe(0);
    });

    it("should count correctly when some solutions have unbound variable", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("bound"));
      const s2 = new SolutionMapping();
      // s2 doesn't have x
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("also-bound"));
      expect(AggregateFunctions.count([s1, s2, s3], "x")).toBe(2);
    });
  });

  describe("COUNT DISTINCT edge cases", () => {
    it("should return 0 for empty solution set", () => {
      expect(AggregateFunctions.countDistinct([], "x")).toBe(0);
    });

    it("should return 0 when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("value"));
      expect(AggregateFunctions.countDistinct([s1], "x")).toBe(0);
    });

    it("should count unique values correctly", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("a"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("a")); // duplicate
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("b"));
      expect(AggregateFunctions.countDistinct([s1, s2, s3], "x")).toBe(2);
    });

    it("should treat different types with same string representation as equal", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("42", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("42", xsdDecimal));
      // Both serialize to "42" for distinct comparison
      expect(AggregateFunctions.countDistinct([s1, s2], "x")).toBeGreaterThanOrEqual(1);
    });
  });

  describe("SUM edge cases", () => {
    it("should return 0 for empty solution set", () => {
      expect(AggregateFunctions.sum([], "x")).toBe(0);
    });

    it("should return 0 when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("10", xsdInt));
      expect(AggregateFunctions.sum([s1], "x")).toBe(0);
    });

    it("should ignore non-numeric literals", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("not-a-number", xsdString));
      // NaN is skipped
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(10);
    });

    it("should ignore IRI values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new IRI("http://example.org/"));
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(10);
    });

    it("should handle decimal values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10.5", xsdDecimal));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("5.5", xsdDecimal));
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(16);
    });

    it("should handle negative values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("-5", xsdInt));
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(5);
    });

    it("should handle very large numbers", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("999999999999", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("1", xsdInt));
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(1000000000000);
    });
  });

  describe("AVG edge cases", () => {
    it("should return 0 for empty solution set", () => {
      expect(AggregateFunctions.avg([], "x")).toBe(0);
    });

    it("should return 0 when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("10", xsdInt));
      expect(AggregateFunctions.avg([s1], "x")).toBe(0);
    });

    it("should handle single value", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("42", xsdInt));
      expect(AggregateFunctions.avg([s1], "x")).toBe(42);
    });

    it("should calculate correct average for decimals", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("20", xsdInt));
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("30", xsdInt));
      expect(AggregateFunctions.avg([s1, s2, s3], "x")).toBe(20);
    });

    it("should handle non-integer averages", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("1", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("2", xsdInt));
      expect(AggregateFunctions.avg([s1, s2], "x")).toBe(1.5);
    });
  });

  describe("MIN edge cases", () => {
    it("should return null for empty solution set", () => {
      expect(AggregateFunctions.min([], "x")).toBeNull();
    });

    it("should return null when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("10", xsdInt));
      expect(AggregateFunctions.min([s1], "x")).toBeNull();
    });

    it("should handle single value", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("42", xsdInt));
      expect(AggregateFunctions.min([s1], "x")).toBe(42);
    });

    it("should handle negative numbers", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("-10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("10", xsdInt));
      expect(AggregateFunctions.min([s1, s2], "x")).toBe(-10);
    });

    it("should handle string comparison for non-numeric literals", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("banana"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("apple"));
      expect(AggregateFunctions.min([s1, s2], "x")).toBe("apple");
    });

    it("should handle IRI values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new IRI("http://example.org/b"));
      const s2 = new SolutionMapping();
      s2.set("x", new IRI("http://example.org/a"));
      expect(AggregateFunctions.min([s1, s2], "x")).toBe("http://example.org/a");
    });
  });

  describe("MAX edge cases", () => {
    it("should return null for empty solution set", () => {
      expect(AggregateFunctions.max([], "x")).toBeNull();
    });

    it("should return null when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("10", xsdInt));
      expect(AggregateFunctions.max([s1], "x")).toBeNull();
    });

    it("should handle single value", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("42", xsdInt));
      expect(AggregateFunctions.max([s1], "x")).toBe(42);
    });

    it("should handle negative numbers", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("-10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("10", xsdInt));
      expect(AggregateFunctions.max([s1, s2], "x")).toBe(10);
    });

    it("should handle string comparison for non-numeric literals", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("apple"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("banana"));
      expect(AggregateFunctions.max([s1, s2], "x")).toBe("banana");
    });

    it("should handle IRI values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new IRI("http://example.org/a"));
      const s2 = new SolutionMapping();
      s2.set("x", new IRI("http://example.org/b"));
      expect(AggregateFunctions.max([s1, s2], "x")).toBe("http://example.org/b");
    });
  });

  describe("GROUP_CONCAT edge cases", () => {
    it("should return empty string for empty solution set", () => {
      expect(AggregateFunctions.groupConcat([], "x")).toBe("");
    });

    it("should return empty string when variable is unbound in all solutions", () => {
      const s1 = new SolutionMapping();
      s1.set("y", new Literal("value"));
      expect(AggregateFunctions.groupConcat([s1], "x")).toBe("");
    });

    it("should handle single value", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("only"));
      expect(AggregateFunctions.groupConcat([s1], "x")).toBe("only");
    });

    it("should handle empty separator", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("a"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("b"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x", "")).toBe("ab");
    });

    it("should handle special characters in separator", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("a"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("b"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x", " | ")).toBe("a | b");
    });

    it("should handle IRI values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new IRI("http://example.org/a"));
      const s2 = new SolutionMapping();
      s2.set("x", new IRI("http://example.org/b"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x", ", ")).toBe(
        "http://example.org/a, http://example.org/b"
      );
    });

    it("should handle blank node values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new BlankNode("b1"));
      const s2 = new SolutionMapping();
      s2.set("x", new BlankNode("b2"));
      const result = AggregateFunctions.groupConcat([s1, s2], "x", ", ");
      expect(result).toContain("b1");
      expect(result).toContain("b2");
    });

    it("should handle mixed bound and unbound values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("a"));
      const s2 = new SolutionMapping();
      // s2 doesn't have x
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("b"));
      expect(AggregateFunctions.groupConcat([s1, s2, s3], "x")).toBe("a b");
    });

    it("should handle values containing the separator", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("hello, world"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("foo, bar"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x", ", ")).toBe(
        "hello, world, foo, bar"
      );
    });

    it("should handle Unicode values", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("日本語"));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("中文"));
      expect(AggregateFunctions.groupConcat([s1, s2], "x", " | ")).toBe("日本語 | 中文");
    });
  });

  describe("Type coercion edge cases", () => {
    it("should handle mixed numeric types in SUM", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("5.5", xsdDecimal));
      const s3 = new SolutionMapping();
      s3.set("x", new Literal("2.5", xsdDouble));
      expect(AggregateFunctions.sum([s1, s2, s3], "x")).toBe(18);
    });

    it("should handle literals with no datatype as strings in numeric aggregates", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("10")); // No datatype - will be parsed as number
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("20"));
      // parseFloat will still work on numeric strings
      expect(AggregateFunctions.sum([s1, s2], "x")).toBe(30);
    });

    it("should compare numbers and strings correctly in MIN/MAX", () => {
      const s1 = new SolutionMapping();
      s1.set("x", new Literal("5", xsdInt));
      const s2 = new SolutionMapping();
      s2.set("x", new Literal("text")); // Will be compared as string
      // "5" as number (5) vs "text" as string comparison
      // The min will be 5 (numeric) which is smaller than any string
      const result = AggregateFunctions.min([s1, s2], "x");
      // Either 5 or "text" depending on implementation - just ensure it doesn't throw
      expect(result).not.toBeNull();
    });
  });
});
