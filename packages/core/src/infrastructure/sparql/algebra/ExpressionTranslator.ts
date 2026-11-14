
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  AlgebraOperation,
  BGPOperation,
  FilterOperation,
  ExistsExpression,
  InExpression,
  ArithmeticExpression,
  Expression,
  LiteralExpression,
} from "./AlgebraOperation";
import type {
  SparqljsPattern,
  SparqljsExpression,
  SparqljsTerm,
  OperationExpression,
  FilterPattern,
} from "../SparqljsTypes";

const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";

/**
 * The binary operator that SPARQL unary arithmetic is translated with, or
 * `undefined` when `operator` is not a unary arithmetic operator.
 *
 * sparqljs parses `-?x` / `-(?x)` as `{ operator: "UMINUS", args: [?x] }` and
 * `+?x` as `{ operator: "UPLUS", args: [?x] }`; a negative numeric literal (`-5`)
 * is a literal, not an operation, and never reaches this (ems__Bug 151b98a1).
 */
export function unaryArithmeticOperator(operator: string): "-" | "+" | undefined {
  if (operator === "UMINUS") return "-";
  if (operator === "UPLUS") return "+";
  return undefined;
}

/**
 * `-A` / `+A` (SPARQL 1.1 §17.3, op:numeric-unary-minus / -plus) as `0 - A` /
 * `0 + A` — the same algebra the parser produces for the binary form, so the
 * evaluator, the SERVICE text generator and the serializer handle it with the
 * existing binary arithmetic, and `-A` answers exactly what `0 - A` answers
 * (including how a non-numeric `A` is coerced). It also inherits the binary
 * form's gaps: the optimizer's filter-variable walk and the async (EXISTS)
 * evaluator do not descend into arithmetic (ems__Bug a8012c4f). Shared by
 * BOTH operator tables — `ExpressionTranslator` (FILTER, BIND, ORDER BY,
 * function arguments) and `AggregateTranslator.transformExpressionWithAggregateVars`
 * (HAVING, SELECT expressions) — so the two cannot drift (ems__Bug 151b98a1).
 */
export function unaryToArithmetic(operator: "-" | "+", operand: Expression): ArithmeticExpression {
  return {
    type: "arithmetic",
    operator,
    left: { type: "literal", value: 0, datatype: XSD_INTEGER },
    right: operand,
  };
}

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
  private readonly translateWhereFn: (patterns: SparqljsPattern[]) => AlgebraOperation;
  private readonly translateBGPFn: (pattern: SparqljsPattern) => AlgebraOperation;
  private readonly translatePatternFn: (pattern: SparqljsPattern) => AlgebraOperation;

  constructor(deps: {
    translateWhere: (patterns: SparqljsPattern[]) => AlgebraOperation;
    translateBGP: (pattern: SparqljsPattern) => AlgebraOperation;
    translatePattern: (pattern: SparqljsPattern) => AlgebraOperation;
  }) {
    this.translateWhereFn = deps.translateWhere;
    this.translateBGPFn = deps.translateBGP;
    this.translatePatternFn = deps.translatePattern;
  }

  translateExpression(expr: SparqljsExpression): Expression {
    if (!expr) {
      throw new AlgebraTranslatorError("Expression cannot be null or undefined");
    }

    // Handle expressions with 'type' property (operations, function calls)
    if ("type" in expr && expr.type === "operation") {
      return this.translateOperationExpression(expr as OperationExpression);
    }

    // sparqljs uses both "functionCall" and "functioncall" at runtime
    const exprType = "type" in expr ? (expr as { type: string }).type : undefined;
    if (exprType === "functioncall" || exprType === "functionCall") {
      const funcExpr = expr as import("sparqljs").FunctionCallExpression;
      return {
        type: "functionCall",
        function: funcExpr.function,
        args: funcExpr.args.map((a: SparqljsExpression) => this.translateExpression(a)),
      };
    }

    // Handle terms with 'termType' property (variables, literals, IRIs)
    if ("termType" in expr) {
      return this.translateTermExpression(expr as SparqljsTerm);
    }

    // If neither type nor termType, throw error
    throw new AlgebraTranslatorError(`Unsupported expression structure: ${JSON.stringify(expr)}`);
  }

  translateFilter(pattern: FilterPattern): FilterOperation {
    if (!pattern.expression) {
      throw new AlgebraTranslatorError("Filter pattern must have expression");
    }

    const input: AlgebraOperation = ({ type: "bgp", triples: [] } as BGPOperation);

    return {
      type: "filter",
      expression: this.translateExpression(pattern.expression),
      input,
    };
  }

  translateTermExpression(term: SparqljsTerm): Expression {
    if (term.termType === "Variable") {
      return { type: "variable", name: term.value };
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

      const node: LiteralExpression = { type: "literal", value, datatype: term.datatype?.value };
      // Keep what JS parsing above loses — the lexical form the parser hands over
      // and the language tag — so a term function can rebuild the exact RDF term
      // (ems__Bug 290965dd). Expression evaluation still reads `value`. The
      // lexical form is kept where `value` does not print it back (`42.0`,
      // `"0"^^xsd:boolean`) and for `NaN` / `±Infinity`, which a JSON clone of the
      // plan turns into null: a canonical constant (`0`, `true`) stays exactly the
      // node an engine-made constant is, so a translation into `0 - A` compares
      // equal node for node.
      const canonical = String(value) === term.value && (typeof value === "boolean" || Number.isFinite(value));
      if (typeof value !== "string" && !canonical) node.lexical = term.value;
      if (term.language) node.language = term.language;
      // Set by SPARQLParser.restoreDirections on the very literal (ems__Bug 0b24c745).
      const direction = (term as { direction?: "ltr" | "rtl" }).direction;
      if (term.language && direction) node.direction = direction;
      return node;
    }

    const node: LiteralExpression = { type: "literal", value: String(term.value || term) };
    if (term.termType === "NamedNode") node.namedNode = true; // ems__Bug 290965dd
    return node;
  }

  private translateOperationExpression(expr: OperationExpression): Expression {
    const comparisonOps = ["=", "!=", "<", ">", "<=", ">="];
    const logicalOps = ["&&", "||", "!"];
    const arithmeticOps = ["+", "-", "*", "/"];

    // Filter to only expression args (not pattern args used in EXISTS)
    const exprArgs = expr.args.filter((a): a is SparqljsExpression =>
      !("patterns" in a) || "termType" in a
    );

    if (comparisonOps.includes(expr.operator)) {
      return {
        type: "comparison",
        operator: expr.operator as "=" | "!=" | "<" | ">" | "<=" | ">=",
        left: this.translateExpression(exprArgs[0]),
        right: this.translateExpression(exprArgs[1]),
      };
    }

    if (logicalOps.includes(expr.operator)) {
      return {
        type: "logical",
        operator: expr.operator as "&&" | "||" | "!",
        operands: exprArgs.map((a: SparqljsExpression) => this.translateExpression(a)),
      };
    }

    if (arithmeticOps.includes(expr.operator)) {
      return {
        type: "arithmetic",
        operator: expr.operator as ArithmeticExpression["operator"],
        left: this.translateExpression(exprArgs[0]),
        right: this.translateExpression(exprArgs[1]),
      };
    }

    const unaryOperator = unaryArithmeticOperator(expr.operator);
    if (unaryOperator !== undefined) {
      return unaryToArithmetic(unaryOperator, this.translateExpression(exprArgs[0]));
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
      args: exprArgs.map((a: SparqljsExpression) => this.translateExpression(a)),
    };
  }

  /**
   * Translate EXISTS or NOT EXISTS expression.
   */
  private translateExistsExpression(expr: OperationExpression): ExistsExpression {
    if (!expr.args || expr.args.length !== 1) {
      throw new AlgebraTranslatorError("EXISTS/NOT EXISTS must have exactly one pattern argument");
    }

    const patternArg = expr.args[0] as SparqljsPattern;
    let pattern: AlgebraOperation;

    if (patternArg.type === "group" && "patterns" in patternArg && patternArg.patterns) {
      pattern = this.translateWhereFn(patternArg.patterns);
    } else if (patternArg.type === "bgp") {
      pattern = this.translateBGPFn(patternArg);
    } else {
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
   */
  private translateInExpression(expr: OperationExpression): InExpression {
    if (!expr.args || expr.args.length !== 2) {
      throw new AlgebraTranslatorError("IN/NOT IN must have exactly 2 arguments (expression and list)");
    }

    const testExpr = expr.args[0] as SparqljsExpression;
    const listArg = expr.args[1];

    if (!Array.isArray(listArg)) {
      throw new AlgebraTranslatorError("IN/NOT IN second argument must be an array of values");
    }

    return {
      type: "in",
      expression: this.translateExpression(testExpr),
      list: listArg.map((item: SparqljsExpression) => this.translateExpression(item)),
      negated: expr.operator === "notin",
    };
  }
}
