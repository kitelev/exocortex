import { AggregateTranslator } from "../../../../../src/infrastructure/sparql/algebra/AggregateTranslator";
import { AlgebraTranslatorError } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslatorError";
import type { Expression, AggregateBinding } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import type {
  SparqljsExpression,
  SparqljsAggregateExpression,
  Grouping,
  Ordering,
  Variable as SparqljsVariable,
} from "../../../../../src/infrastructure/sparql/SparqljsTypes";

describe("AggregateTranslator", () => {
  let translator: AggregateTranslator;
  const mockTranslateExpression = jest.fn((expr: SparqljsExpression): Expression => ({
    type: "variable",
    name: "mock",
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    translator = new AggregateTranslator({
      translateExpression: mockTranslateExpression,
    });
  });

  describe("resetCounter", () => {
    it("resets the aggregate counter", () => {
      // Trigger counter increment through collectNestedAggregates
      const vars: SparqljsVariable[] = [
        {
          variable: { termType: "Variable", value: "cnt" },
          expression: { type: "aggregate", aggregation: "count", expression: { termType: "Wildcard" } },
        } as unknown as SparqljsVariable,
      ];
      const map = new Map<SparqljsExpression, string>();
      translator.extractAggregatesWithMapping(vars, map);

      translator.resetCounter();

      // After reset, counter should start from 0 again
      const vars2: SparqljsVariable[] = [
        {
          variable: { termType: "Variable", value: "cnt2" },
          expression: {
            type: "operation",
            operator: "+",
            args: [
              { type: "aggregate", aggregation: "count", expression: { termType: "Wildcard" } },
              { termType: "Literal", value: "1" },
            ],
          },
        } as unknown as SparqljsVariable,
      ];
      const map2 = new Map<SparqljsExpression, string>();
      const aggs = translator.extractAggregatesWithMapping(vars2, map2);
      expect(aggs[0].variable).toBe("__agg0");
    });
  });

  describe("extractAggregatesWithMapping", () => {
    it("returns empty array for null variables", () => {
      const result = translator.extractAggregatesWithMapping(null as unknown as SparqljsVariable[], new Map());
      expect(result).toEqual([]);
    });

    it("extracts direct aggregate expressions", () => {
      const vars: SparqljsVariable[] = [
        {
          variable: { termType: "Variable", value: "cnt" },
          expression: {
            type: "aggregate",
            aggregation: "count",
            expression: { termType: "Wildcard" },
          },
        } as unknown as SparqljsVariable,
      ];
      const map = new Map<SparqljsExpression, string>();
      const result = translator.extractAggregatesWithMapping(vars, map);

      expect(result).toHaveLength(1);
      expect(result[0].variable).toBe("cnt");
      expect(result[0].expression.aggregation).toBe("count");
    });

    it("extracts nested aggregate expressions from arithmetic", () => {
      const countExpr = {
        type: "aggregate",
        aggregation: "count",
        expression: { termType: "Variable", value: "x" },
      };
      const vars: SparqljsVariable[] = [
        {
          variable: { termType: "Variable", value: "result" },
          expression: {
            type: "operation",
            operator: "+",
            args: [
              countExpr,
              { termType: "Literal", value: "1" },
            ],
          },
        } as unknown as SparqljsVariable,
      ];
      const map = new Map<SparqljsExpression, string>();
      const result = translator.extractAggregatesWithMapping(vars, map);

      expect(result).toHaveLength(1);
      expect(result[0].variable).toMatch(/^__agg\d+$/);
    });

    it("skips non-expression variables (simple variables)", () => {
      const vars: SparqljsVariable[] = [
        { termType: "Variable", value: "x" } as unknown as SparqljsVariable,
      ];
      const map = new Map<SparqljsExpression, string>();
      const result = translator.extractAggregatesWithMapping(vars, map);
      expect(result).toEqual([]);
    });

    it("handles nested aggregates inside operation with termType args", () => {
      const vars: SparqljsVariable[] = [
        {
          variable: { termType: "Variable", value: "result" },
          expression: {
            type: "operation",
            operator: "STR",
            args: [
              { termType: "Variable", value: "x" }, // This has termType, so it goes through the else-if branch
            ],
          },
        } as unknown as SparqljsVariable,
      ];
      const map = new Map<SparqljsExpression, string>();
      const result = translator.extractAggregatesWithMapping(vars, map);
      expect(result).toEqual([]);
    });
  });

  describe("extractGroupVariables", () => {
    it("returns empty array for undefined group", () => {
      expect(translator.extractGroupVariables(undefined)).toEqual([]);
    });

    it("extracts variable names from group", () => {
      const group: Grouping[] = [
        { expression: { termType: "Variable", value: "category" } },
        { expression: { termType: "Variable", value: "status" } },
      ] as unknown as Grouping[];

      const result = translator.extractGroupVariables(group);
      expect(result).toEqual(["category", "status"]);
    });

    it("filters out non-variable groupings", () => {
      const group: Grouping[] = [
        { expression: { termType: "Variable", value: "category" } },
        { expression: { type: "operation", operator: "YEAR", args: [] } },
      ] as unknown as Grouping[];

      const result = translator.extractGroupVariables(group);
      expect(result).toEqual(["category"]);
    });
  });

  describe("extractHavingExpressions", () => {
    it("returns empty array for undefined having", () => {
      expect(translator.extractHavingExpressions(undefined, [], new Map())).toEqual([]);
    });

    it("returns empty array for empty having", () => {
      expect(translator.extractHavingExpressions([], [], new Map())).toEqual([]);
    });

    it("translates HAVING expressions and collects nested aggregates", () => {
      const countExpr = {
        type: "aggregate",
        aggregation: "count",
        expression: { termType: "Wildcard" },
      } as unknown as SparqljsExpression;

      const having = [
        {
          type: "operation",
          operator: ">",
          args: [
            countExpr,
            { termType: "Literal", value: "5", datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" } },
          ],
        } as unknown as SparqljsExpression,
      ];

      const aggregates: AggregateBinding[] = [];
      const map = new Map<SparqljsExpression, string>();

      const result = translator.extractHavingExpressions(having, aggregates, map);
      expect(result).toHaveLength(1);
      // The aggregate in HAVING should have been collected
      expect(aggregates.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("transformExpressionWithAggregateVars", () => {
    it("replaces mapped expression with variable reference", () => {
      const expr = { type: "aggregate", aggregation: "count" } as unknown as SparqljsExpression;
      const map = new Map<SparqljsExpression, string>();
      map.set(expr, "cnt");

      const result = translator.transformExpressionWithAggregateVars(expr, map);
      expect(result.type).toBe("variable");
      expect((result as any).name).toBe("cnt");
    });

    it("transforms comparison operations", () => {
      const expr = {
        type: "operation",
        operator: ">",
        args: [
          { termType: "Variable", value: "x" },
          { termType: "Literal", value: "5" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.transformExpressionWithAggregateVars(expr, new Map());
      expect(result.type).toBe("comparison");
      expect((result as any).operator).toBe(">");
    });

    it("transforms logical operations", () => {
      const expr = {
        type: "operation",
        operator: "&&",
        args: [
          { termType: "Variable", value: "x" },
          { termType: "Variable", value: "y" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.transformExpressionWithAggregateVars(expr, new Map());
      expect(result.type).toBe("logical");
    });

    it("transforms arithmetic operations", () => {
      const expr = {
        type: "operation",
        operator: "+",
        args: [
          { termType: "Literal", value: "1" },
          { termType: "Literal", value: "2" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.transformExpressionWithAggregateVars(expr, new Map());
      expect(result.type).toBe("arithmetic");
      expect((result as any).operator).toBe("+");
    });

    it("transforms unknown functions", () => {
      const expr = {
        type: "operation",
        operator: "STRLEN",
        args: [
          { termType: "Variable", value: "x" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.transformExpressionWithAggregateVars(expr, new Map());
      expect(result.type).toBe("function");
      expect((result as any).function).toBe("STRLEN");
    });

    it("filters out array and pattern args", () => {
      const expr = {
        type: "operation",
        operator: "STRLEN",
        args: [
          { termType: "Variable", value: "x" },
          [{ termType: "Literal", value: "arr" }], // array arg - should be filtered
          { patterns: [{ type: "bgp" }] }, // pattern arg - should be filtered
        ],
      } as unknown as SparqljsExpression;

      const result = translator.transformExpressionWithAggregateVars(expr, new Map());
      expect((result as any).args).toHaveLength(1);
    });

    it("falls back to translateExpressionFn for non-operation expressions", () => {
      const expr = {
        termType: "Variable",
        value: "x",
      } as unknown as SparqljsExpression;

      translator.transformExpressionWithAggregateVars(expr, new Map());
      expect(mockTranslateExpression).toHaveBeenCalledWith(expr);
    });
  });

  describe("translateOrderComparator", () => {
    it("translates ascending order", () => {
      const order: Ordering = {
        expression: { termType: "Variable", value: "x" },
        descending: false,
      } as unknown as Ordering;

      const result = translator.translateOrderComparator(order);
      expect(result.descending).toBe(false);
      expect(mockTranslateExpression).toHaveBeenCalled();
    });

    it("translates descending order", () => {
      const order: Ordering = {
        expression: { termType: "Variable", value: "x" },
        descending: true,
      } as unknown as Ordering;

      const result = translator.translateOrderComparator(order);
      expect(result.descending).toBe(true);
    });

    it("defaults descending to false when undefined", () => {
      const order: Ordering = {
        expression: { termType: "Variable", value: "x" },
      } as unknown as Ordering;

      const result = translator.translateOrderComparator(order);
      expect(result.descending).toBe(false);
    });
  });

  describe("translateAggregateExpression", () => {
    it("translates standard aggregate (count)", () => {
      const expr = {
        aggregation: "count",
        expression: { termType: "Wildcard" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.type).toBe("aggregate");
      expect(result.aggregation).toBe("count");
      expect(result.expression).toBeUndefined(); // Wildcard
    });

    it("translates standard aggregate (sum) with expression", () => {
      const expr = {
        aggregation: "sum",
        expression: { termType: "Variable", value: "amount" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.aggregation).toBe("sum");
      expect(result.expression).toBeDefined();
    });

    it("translates COUNT with DISTINCT", () => {
      const expr = {
        aggregation: "count",
        expression: { termType: "Variable", value: "x" },
        distinct: true,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.distinct).toBe(true);
    });

    it("translates GROUP_CONCAT with separator", () => {
      const expr = {
        aggregation: "group_concat",
        expression: { termType: "Variable", value: "label" },
        distinct: false,
        separator: "; ",
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.aggregation).toBe("group_concat");
      expect(result.separator).toBe("; ");
    });

    it("translates all standard aggregation types", () => {
      const types = ["count", "sum", "avg", "min", "max", "group_concat", "sample"];
      for (const agg of types) {
        const expr = {
          aggregation: agg,
          expression: { termType: "Variable", value: "x" },
          distinct: false,
        } as unknown as SparqljsAggregateExpression;

        const result = translator.translateAggregateExpression(expr);
        expect(result.aggregation).toBe(agg);
      }
    });

    it("translates custom aggregate with string IRI", () => {
      const expr = {
        aggregation: "http://example.org/customAgg",
        expression: { termType: "Variable", value: "x" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.aggregation).toEqual({ type: "custom", iri: "http://example.org/customAgg" });
    });

    it("translates custom aggregate with NamedNode object", () => {
      const expr = {
        aggregation: { termType: "NamedNode", value: "http://example.org/customAgg" },
        expression: { termType: "Variable", value: "x" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.aggregation).toEqual({ type: "custom", iri: "http://example.org/customAgg" });
    });

    it("translates custom aggregate with generic object having value property", () => {
      const expr = {
        aggregation: { value: "http://example.org/customAgg2" },
        expression: { termType: "Variable", value: "x" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.aggregation).toEqual({ type: "custom", iri: "http://example.org/customAgg2" });
    });

    it("throws for invalid custom aggregate object without value", () => {
      const expr = {
        aggregation: { something: "else" },
        expression: { termType: "Variable", value: "x" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      expect(() => translator.translateAggregateExpression(expr))
        .toThrow("Invalid custom aggregate: expected IRI");
    });

    it("throws for non-string non-object aggregate", () => {
      const expr = {
        aggregation: 42,
        expression: { termType: "Variable", value: "x" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      expect(() => translator.translateAggregateExpression(expr))
        .toThrow("Unknown aggregate format");
    });

    it("handles null aggregation object", () => {
      const expr = {
        aggregation: null,
        expression: { termType: "Variable", value: "x" },
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      expect(() => translator.translateAggregateExpression(expr))
        .toThrow("Unknown aggregate format");
    });

    it("handles aggregate without expression", () => {
      const expr = {
        aggregation: "count",
        distinct: false,
      } as unknown as SparqljsAggregateExpression;

      const result = translator.translateAggregateExpression(expr);
      expect(result.expression).toBeUndefined();
    });
  });

  describe("collectNestedAggregates", () => {
    it("handles deeply nested operation args without aggregates", () => {
      const vars: SparqljsVariable[] = [
        {
          variable: { termType: "Variable", value: "result" },
          expression: {
            type: "operation",
            operator: "+",
            args: [
              { type: "operation", operator: "*", args: [
                { termType: "Literal", value: "2" },
                { termType: "Variable", value: "x" },
              ] },
              { termType: "Literal", value: "1" },
            ],
          },
        } as unknown as SparqljsVariable,
      ];
      const map = new Map<SparqljsExpression, string>();

      const result = translator.extractAggregatesWithMapping(vars, map);
      // No aggregates found in nested operations
      expect(result).toEqual([]);
    });
  });
});
