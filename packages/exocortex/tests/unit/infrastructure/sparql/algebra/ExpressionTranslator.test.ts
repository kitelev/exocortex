import { ExpressionTranslator } from "../../../../../src/infrastructure/sparql/algebra/ExpressionTranslator";
import { AlgebraTranslatorError } from "../../../../../src/infrastructure/sparql/algebra/AlgebraTranslatorError";
import type { AlgebraOperation } from "../../../../../src/infrastructure/sparql/algebra/AlgebraOperation";
import type {
  SparqljsPattern,
  SparqljsExpression,
  OperationExpression,
} from "../../../../../src/infrastructure/sparql/SparqljsTypes";

describe("ExpressionTranslator", () => {
  let translator: ExpressionTranslator;
  const mockTranslateWhere = jest.fn((_patterns: SparqljsPattern[]) => ({
    type: "bgp" as const,
    triples: [],
  } as AlgebraOperation));
  const mockTranslateBGP = jest.fn((_pattern: SparqljsPattern) => ({
    type: "bgp" as const,
    triples: [],
  } as AlgebraOperation));
  const mockTranslatePattern = jest.fn((_pattern: SparqljsPattern) => ({
    type: "bgp" as const,
    triples: [],
  } as AlgebraOperation));

  beforeEach(() => {
    jest.clearAllMocks();
    translator = new ExpressionTranslator({
      translateWhere: mockTranslateWhere,
      translateBGP: mockTranslateBGP,
      translatePattern: mockTranslatePattern,
    });
  });

  describe("translateExpression", () => {
    it("throws on null expression", () => {
      expect(() => translator.translateExpression(null as unknown as SparqljsExpression))
        .toThrow("Expression cannot be null or undefined");
    });

    it("throws on undefined expression", () => {
      expect(() => translator.translateExpression(undefined as unknown as SparqljsExpression))
        .toThrow("Expression cannot be null or undefined");
    });

    it("translates operation expression", () => {
      const expr = {
        type: "operation",
        operator: "=",
        args: [
          { termType: "Variable", value: "x" },
          { termType: "Literal", value: "5", datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" } },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("comparison");
    });

    it("translates functionCall expression", () => {
      const expr = {
        type: "functionCall",
        function: "http://example.org/func",
        args: [
          { termType: "Variable", value: "x" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("functionCall");
      expect((result as any).function).toBe("http://example.org/func");
    });

    it("translates functioncall (lowercase) expression", () => {
      const expr = {
        type: "functioncall",
        function: "http://example.org/func",
        args: [
          { termType: "Variable", value: "x" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("functionCall");
    });

    it("translates term expression (Variable)", () => {
      const expr = {
        termType: "Variable",
        value: "x",
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("variable");
      expect((result as any).name).toBe("x");
    });

    it("translates term expression (Literal)", () => {
      const expr = {
        termType: "Literal",
        value: "hello",
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("literal");
      expect((result as any).value).toBe("hello");
    });

    it("translates Literal with integer datatype", () => {
      const expr = {
        termType: "Literal",
        value: "42",
        datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" },
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("literal");
      expect((result as any).value).toBe(42);
    });

    it("translates Literal with decimal datatype", () => {
      const expr = {
        termType: "Literal",
        value: "3.14",
        datatype: { value: "http://www.w3.org/2001/XMLSchema#decimal" },
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect((result as any).value).toBeCloseTo(3.14);
    });

    it("translates Literal with boolean datatype", () => {
      const expr = {
        termType: "Literal",
        value: "true",
        datatype: { value: "http://www.w3.org/2001/XMLSchema#boolean" },
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect((result as any).value).toBe(true);
    });

    it("translates Literal with boolean false", () => {
      const expr = {
        termType: "Literal",
        value: "false",
        datatype: { value: "http://www.w3.org/2001/XMLSchema#boolean" },
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect((result as any).value).toBe(false);
    });

    it("translates NamedNode as literal string", () => {
      const expr = {
        termType: "NamedNode",
        value: "http://example.org/resource",
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("literal");
    });

    it("throws for unsupported expression structure", () => {
      const expr = { something: "random" } as unknown as SparqljsExpression;
      expect(() => translator.translateExpression(expr)).toThrow("Unsupported expression structure");
    });
  });

  describe("translateFilter", () => {
    it("translates filter pattern with expression", () => {
      const pattern = {
        type: "filter",
        expression: { termType: "Variable", value: "x" },
      } as unknown as import("../../../../../src/infrastructure/sparql/SparqljsTypes").FilterPattern;

      const result = translator.translateFilter(pattern);
      expect(result.type).toBe("filter");
      expect(result.input.type).toBe("bgp");
    });

    it("throws for filter without expression", () => {
      const pattern = {
        type: "filter",
      } as unknown as import("../../../../../src/infrastructure/sparql/SparqljsTypes").FilterPattern;

      expect(() => translator.translateFilter(pattern)).toThrow("Filter pattern must have expression");
    });
  });

  describe("operation expressions", () => {
    it("translates comparison operators", () => {
      for (const op of ["=", "!=", "<", ">", "<=", ">="]) {
        const expr = {
          type: "operation",
          operator: op,
          args: [
            { termType: "Variable", value: "x" },
            { termType: "Literal", value: "5" },
          ],
        } as unknown as SparqljsExpression;

        const result = translator.translateExpression(expr);
        expect(result.type).toBe("comparison");
        expect((result as any).operator).toBe(op);
      }
    });

    it("translates logical operators", () => {
      for (const op of ["&&", "||"]) {
        const expr = {
          type: "operation",
          operator: op,
          args: [
            { termType: "Variable", value: "x" },
            { termType: "Variable", value: "y" },
          ],
        } as unknown as SparqljsExpression;

        const result = translator.translateExpression(expr);
        expect(result.type).toBe("logical");
        expect((result as any).operator).toBe(op);
      }
    });

    it("translates NOT (!) operator", () => {
      const expr = {
        type: "operation",
        operator: "!",
        args: [
          { termType: "Variable", value: "x" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("logical");
      expect((result as any).operator).toBe("!");
    });

    it("translates arithmetic operators", () => {
      for (const op of ["+", "-", "*", "/"]) {
        const expr = {
          type: "operation",
          operator: op,
          args: [
            { termType: "Literal", value: "10", datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" } },
            { termType: "Literal", value: "3", datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" } },
          ],
        } as unknown as SparqljsExpression;

        const result = translator.translateExpression(expr);
        expect(result.type).toBe("arithmetic");
        expect((result as any).operator).toBe(op);
      }
    });

    it("translates EXISTS expression with group pattern", () => {
      const expr = {
        type: "operation",
        operator: "exists",
        args: [
          {
            type: "group",
            patterns: [{ type: "bgp", triples: [] }],
          },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("exists");
      expect((result as any).negated).toBe(false);
      expect(mockTranslateWhere).toHaveBeenCalled();
    });

    it("translates NOT EXISTS expression", () => {
      const expr = {
        type: "operation",
        operator: "notexists",
        args: [
          {
            type: "group",
            patterns: [{ type: "bgp", triples: [] }],
          },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("exists");
      expect((result as any).negated).toBe(true);
    });

    it("translates EXISTS with BGP pattern", () => {
      const expr = {
        type: "operation",
        operator: "exists",
        args: [
          { type: "bgp", triples: [] },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("exists");
      expect(mockTranslateBGP).toHaveBeenCalled();
    });

    it("translates EXISTS with other pattern types", () => {
      const expr = {
        type: "operation",
        operator: "exists",
        args: [
          { type: "union", patterns: [] },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("exists");
      expect(mockTranslatePattern).toHaveBeenCalled();
    });

    it("throws for EXISTS with wrong number of args", () => {
      const expr = {
        type: "operation",
        operator: "exists",
        args: [],
      } as unknown as SparqljsExpression;

      expect(() => translator.translateExpression(expr))
        .toThrow("EXISTS/NOT EXISTS must have exactly one pattern argument");
    });

    it("translates IN expression", () => {
      const expr = {
        type: "operation",
        operator: "in",
        args: [
          { termType: "Variable", value: "x" },
          [
            { termType: "Literal", value: "a" },
            { termType: "Literal", value: "b" },
          ],
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("in");
      expect((result as any).negated).toBe(false);
      expect((result as any).list).toHaveLength(2);
    });

    it("translates NOT IN expression", () => {
      const expr = {
        type: "operation",
        operator: "notin",
        args: [
          { termType: "Variable", value: "x" },
          [
            { termType: "Literal", value: "a" },
          ],
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("in");
      expect((result as any).negated).toBe(true);
    });

    it("throws for IN with wrong number of args", () => {
      const expr = {
        type: "operation",
        operator: "in",
        args: [
          { termType: "Variable", value: "x" },
        ],
      } as unknown as SparqljsExpression;

      expect(() => translator.translateExpression(expr))
        .toThrow("IN/NOT IN must have exactly 2 arguments");
    });

    it("throws for IN with non-array second arg", () => {
      const expr = {
        type: "operation",
        operator: "in",
        args: [
          { termType: "Variable", value: "x" },
          { termType: "Literal", value: "not-array" },
        ],
      } as unknown as SparqljsExpression;

      expect(() => translator.translateExpression(expr))
        .toThrow("IN/NOT IN second argument must be an array of values");
    });

    it("translates unknown function operators as function type", () => {
      const expr = {
        type: "operation",
        operator: "STRLEN",
        args: [
          { termType: "Variable", value: "x" },
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("function");
      expect((result as any).function).toBe("STRLEN");
    });

    it("filters out pattern args from expression args", () => {
      // When an operation has a mix of expression and pattern args,
      // only expression args should be passed to operator logic
      const expr = {
        type: "operation",
        operator: "BOUND",
        args: [
          { termType: "Variable", value: "x" },
          { patterns: [{ type: "bgp" }] }, // this is a pattern arg, should be filtered
        ],
      } as unknown as SparqljsExpression;

      const result = translator.translateExpression(expr);
      expect(result.type).toBe("function");
      expect((result as any).args).toHaveLength(1);
    });
  });

  describe("translateTermExpression", () => {
    it("translates term without known termType as literal string", () => {
      const term = {
        termType: "NamedNode",
        value: "http://example.org/resource",
      } as unknown as import("../../../../../src/infrastructure/sparql/SparqljsTypes").SparqljsTerm;

      const result = translator.translateTermExpression(term);
      expect(result.type).toBe("literal");
      expect((result as any).value).toBe("http://example.org/resource");
    });

    it("handles term without value", () => {
      const term = {
        termType: "SomeOtherType",
      } as unknown as import("../../../../../src/infrastructure/sparql/SparqljsTypes").SparqljsTerm;

      const result = translator.translateTermExpression(term);
      expect(result.type).toBe("literal");
    });
  });
});
