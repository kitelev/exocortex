import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  AlgebraOperation,
  BGPOperation,
  FilterOperation,
  ExistsExpression,
  InExpression,
  ArithmeticExpression,
  Expression,
} from "./AlgebraOperation";

/**
 * Translates SPARQL expressions, filters, and function calls
 * from the sparqljs AST into the internal algebra representation.
 *
 * This module handles:
 * - Comparison, logical, and arithmetic operators
 * - EXISTS and NOT EXISTS sub-patterns
 * - IN and NOT IN value lists
 * - Function calls
 * - Term expressions (variables, literals, IRIs)
 * - Filter patterns
 */
export class ExpressionTranslator {
  /**
   * Callback to delegate pattern translation (BGP, group, etc.)
   * back to the pattern layer. This avoids a circular dependency.
   */
  private readonly translateWhereFn: (patterns: unknown[]) => AlgebraOperation;
  private readonly translateBGPFn: (pattern: unknown) => AlgebraOperation;
  private readonly translatePatternFn: (pattern: unknown) => AlgebraOperation;

  constructor(deps: {
    translateWhere: (patterns: unknown[]) => AlgebraOperation;
    translateBGP: (pattern: unknown) => AlgebraOperation;
    translatePattern: (pattern: unknown) => AlgebraOperation;
  }) {
    this.translateWhereFn = deps.translateWhere;
    this.translateBGPFn = deps.translateBGP;
    this.translatePatternFn = deps.translatePattern;
  }

  translateExpression(expr: unknown): Expression {
    if (!expr) {
      throw new AlgebraTranslatorError("Expression cannot be null or undefined");
    }

    // Handle expressions with 'type' property (operations, function calls)
    if (expr.type === "operation") {
      return this.translateOperationExpression(expr);
    }

    if (expr.type === "functioncall" || expr.type === "functionCall") {
      return {
        type: "functionCall",
        function: expr.function,
        args: expr.args.map((a: unknown) => this.translateExpression(a)),
      };
    }

    // Handle terms with 'termType' property (variables, literals, IRIs)
    if (expr.termType) {
      return this.translateTermExpression(expr);
    }

    // If neither type nor termType, throw error
    throw new AlgebraTranslatorError(`Unsupported expression structure: ${JSON.stringify(expr)}`);
  }

  translateFilter(pattern: unknown): FilterOperation {
    if (!pattern.expression) {
      throw new AlgebraTranslatorError("Filter pattern must have expression");
    }

    const input: AlgebraOperation = pattern.patterns
      ? this.translateWhereFn(pattern.patterns)
      : ({ type: "bgp", triples: [] } as BGPOperation);

    return {
      type: "filter",
      expression: this.translateExpression(pattern.expression),
      input,
    };
  }

  private translateOperationExpression(expr: unknown): Expression {
    const comparisonOps = ["=", "!=", "<", ">", "<=", ">="];
    const logicalOps = ["&&", "||", "!"];
    const arithmeticOps = ["+", "-", "*", "/"];

    if (comparisonOps.includes(expr.operator)) {
      return {
        type: "comparison",
        operator: expr.operator,
        left: this.translateExpression(expr.args[0]),
        right: this.translateExpression(expr.args[1]),
      };
    }

    if (logicalOps.includes(expr.operator)) {
      return {
        type: "logical",
        operator: expr.operator,
        operands: expr.args.map((a: unknown) => this.translateExpression(a)),
      };
    }

    // Handle arithmetic operators (+, -, *, /)
    if (arithmeticOps.includes(expr.operator)) {
      return {
        type: "arithmetic",
        operator: expr.operator as ArithmeticExpression["operator"],
        left: this.translateExpression(expr.args[0]),
        right: this.translateExpression(expr.args[1]),
      };
    }

    // Handle EXISTS and NOT EXISTS
    if (expr.operator === "exists" || expr.operator === "notexists") {
      return this.translateExistsExpression(expr);
    }

    // Handle IN and NOT IN operators (SPARQL 1.1 Section 17.4.1.5)
    if (expr.operator === "in" || expr.operator === "notin") {
      return this.translateInExpression(expr);
    }

    return {
      type: "function",
      function: expr.operator,
      args: expr.args.map((a: unknown) => this.translateExpression(a)),
    };
  }

  /**
   * Translate EXISTS or NOT EXISTS expression.
   * sparqljs AST: { type: "operation", operator: "exists"|"notexists", args: [pattern] }
   * The pattern is a graph pattern (BGP, group, etc.) that needs to be evaluated.
   */
  private translateExistsExpression(expr: unknown): ExistsExpression {
    if (!expr.args || expr.args.length !== 1) {
      throw new AlgebraTranslatorError("EXISTS/NOT EXISTS must have exactly one pattern argument");
    }

    const patternArg = expr.args[0];
    let pattern: AlgebraOperation;

    // Handle group pattern (most common for EXISTS)
    if (patternArg.type === "group" && patternArg.patterns) {
      pattern = this.translateWhereFn(patternArg.patterns);
    } else if (patternArg.type === "bgp") {
      pattern = this.translateBGPFn(patternArg);
    } else {
      // Try to translate as a generic pattern
      pattern = this.translatePatternFn(patternArg);
    }

    return {
      type: "exists",
      negated: expr.operator === "notexists",
      pattern,
    };
  }

  /**
   * Translate IN or NOT IN expression.
   * sparqljs AST format:
   * {
   *   type: "operation",
   *   operator: "in" | "notin",
   *   args: [expression, [value1, value2, ...]]
   * }
   *
   * SPARQL 1.1 Section 17.4.1.5:
   * - expr IN (val1, val2, ...) returns true if expr = val_i for any value
   * - expr NOT IN (val1, val2, ...) returns true if expr != val_i for all values
   */
  private translateInExpression(expr: unknown): InExpression {
    if (!expr.args || expr.args.length !== 2) {
      throw new AlgebraTranslatorError("IN/NOT IN must have exactly 2 arguments (expression and list)");
    }

    const testExpr = expr.args[0];
    const listArg = expr.args[1];

    if (!Array.isArray(listArg)) {
      throw new AlgebraTranslatorError("IN/NOT IN second argument must be an array of values");
    }

    return {
      type: "in",
      expression: this.translateExpression(testExpr),
      list: listArg.map((item: unknown) => this.translateExpression(item)),
      negated: expr.operator === "notin",
    };
  }

  translateTermExpression(term: unknown): Expression {
    if (term.termType === "Variable") {
      return {
        type: "variable",
        name: term.value,
      };
    }

    if (term.termType === "Literal") {
      let value: string | number | boolean = term.value;
      if (term.datatype) {
        if (term.datatype.value.includes("#integer") || term.datatype.value.includes("#decimal")) {
          value = parseFloat(term.value);
        } else if (term.datatype.value.includes("#boolean")) {
          value = term.value === "true";
        }
      }

      return {
        type: "literal",
        value,
        datatype: term.datatype?.value,
      };
    }

    return {
      type: "literal",
      value: String(term.value || term),
    };
  }
}
