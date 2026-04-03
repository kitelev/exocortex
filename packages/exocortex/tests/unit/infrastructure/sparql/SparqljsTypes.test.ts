import { describe, it, expect } from "@jest/globals";
import {
  isVariableExpression,
  isVariableTerm,
  isNamedNode,
  isLiteral,
  isPropertyPath,
  isAggregateExpression,
  isOperationExpression,
  isFunctionCallExpression,
} from "../../../../src/infrastructure/sparql/SparqljsTypes";

describe("SparqljsTypes type guards", () => {
  describe("isVariableExpression", () => {
    it("should return true for object with expression and variable", () => {
      expect(
        isVariableExpression({
          expression: { type: "operation", operator: "+", args: [] },
          variable: { termType: "Variable", value: "x" },
        }),
      ).toBe(true);
    });

    it("should return false for null", () => {
      expect(isVariableExpression(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isVariableExpression(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isVariableExpression("string")).toBe(false);
    });

    it("should return false for object without expression", () => {
      expect(
        isVariableExpression({
          variable: { termType: "Variable", value: "x" },
        }),
      ).toBe(false);
    });

    it("should return false for object without variable", () => {
      expect(
        isVariableExpression({
          expression: { type: "operation" },
        }),
      ).toBe(false);
    });

    it("should return false for number", () => {
      expect(isVariableExpression(42)).toBe(false);
    });
  });

  describe("isVariableTerm", () => {
    it("should return true for Variable termType", () => {
      expect(
        isVariableTerm({ termType: "Variable", value: "x" }),
      ).toBe(true);
    });

    it("should return false for NamedNode termType", () => {
      expect(
        isVariableTerm({ termType: "NamedNode", value: "http://example.org" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isVariableTerm(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isVariableTerm(undefined)).toBe(false);
    });

    it("should return false for string", () => {
      expect(isVariableTerm("Variable")).toBe(false);
    });

    it("should return false for object without termType", () => {
      expect(isVariableTerm({ value: "x" })).toBe(false);
    });
  });

  describe("isNamedNode", () => {
    it("should return true for NamedNode termType", () => {
      expect(
        isNamedNode({ termType: "NamedNode", value: "http://example.org" }),
      ).toBe(true);
    });

    it("should return false for Variable termType", () => {
      expect(
        isNamedNode({ termType: "Variable", value: "x" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isNamedNode(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isNamedNode(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isNamedNode(123)).toBe(false);
    });

    it("should return false for object without termType", () => {
      expect(isNamedNode({ value: "http://example.org" })).toBe(false);
    });
  });

  describe("isLiteral", () => {
    it("should return true for Literal termType", () => {
      expect(
        isLiteral({ termType: "Literal", value: "hello" }),
      ).toBe(true);
    });

    it("should return false for NamedNode termType", () => {
      expect(
        isLiteral({ termType: "NamedNode", value: "http://example.org" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isLiteral(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isLiteral(undefined)).toBe(false);
    });

    it("should return false for string", () => {
      expect(isLiteral("Literal")).toBe(false);
    });

    it("should return false for object without termType", () => {
      expect(isLiteral({ value: "hello" })).toBe(false);
    });
  });

  describe("isPropertyPath", () => {
    it("should return true for path type", () => {
      expect(
        isPropertyPath({ type: "path", pathType: "/", items: [] }),
      ).toBe(true);
    });

    it("should return false for non-path type", () => {
      expect(
        isPropertyPath({ type: "operation", operator: "+" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isPropertyPath(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isPropertyPath(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isPropertyPath("path")).toBe(false);
    });

    it("should return false for object without type", () => {
      expect(isPropertyPath({ pathType: "/" })).toBe(false);
    });
  });

  describe("isAggregateExpression", () => {
    it("should return true for aggregate type", () => {
      expect(
        isAggregateExpression({
          type: "aggregate",
          aggregation: "count",
          distinct: false,
          expression: { termType: "Variable", value: "x" },
        }),
      ).toBe(true);
    });

    it("should return false for operation type", () => {
      expect(
        isAggregateExpression({ type: "operation", operator: "+" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isAggregateExpression(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isAggregateExpression(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isAggregateExpression(42)).toBe(false);
    });

    it("should return false for object without type", () => {
      expect(isAggregateExpression({ aggregation: "count" })).toBe(false);
    });
  });

  describe("isOperationExpression", () => {
    it("should return true for operation type", () => {
      expect(
        isOperationExpression({
          type: "operation",
          operator: "+",
          args: [],
        }),
      ).toBe(true);
    });

    it("should return false for aggregate type", () => {
      expect(
        isOperationExpression({ type: "aggregate" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isOperationExpression(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isOperationExpression(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isOperationExpression("operation")).toBe(false);
    });

    it("should return false for object without type", () => {
      expect(isOperationExpression({ operator: "+" })).toBe(false);
    });
  });

  describe("isFunctionCallExpression", () => {
    it("should return true for functionCall type", () => {
      expect(
        isFunctionCallExpression({
          type: "functionCall",
          function: { termType: "NamedNode", value: "http://example.org/fn" },
          args: [],
        }),
      ).toBe(true);
    });

    it("should return true for lowercase functioncall type", () => {
      expect(
        isFunctionCallExpression({
          type: "functioncall",
          function: { termType: "NamedNode", value: "http://example.org/fn" },
          args: [],
        }),
      ).toBe(true);
    });

    it("should return false for operation type", () => {
      expect(
        isFunctionCallExpression({ type: "operation" }),
      ).toBe(false);
    });

    it("should return false for null", () => {
      expect(isFunctionCallExpression(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isFunctionCallExpression(undefined)).toBe(false);
    });

    it("should return false for non-object", () => {
      expect(isFunctionCallExpression(true)).toBe(false);
    });

    it("should return false for object without type", () => {
      expect(
        isFunctionCallExpression({ function: "fn" }),
      ).toBe(false);
    });
  });
});
