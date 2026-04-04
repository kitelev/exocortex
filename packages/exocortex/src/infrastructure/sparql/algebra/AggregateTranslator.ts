 
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  ArithmeticExpression,
  Expression,
  OrderComparator,
  AggregateBinding,
  AggregateExpression,
} from "./AlgebraOperation";
import type {
  SparqljsExpression,
  SparqljsAggregateExpression,
  OperationExpression,
  Grouping,
  Ordering,
} from "../SparqljsTypes";
import { isVariableExpression } from "../SparqljsTypes";
import type { Variable as SparqljsVariable } from "../SparqljsTypes";

/**
 * Translates SPARQL aggregate-related constructs from the sparqljs AST
 * into the internal algebra representation.
 *
 * This module handles:
 * - Aggregate expressions (COUNT, SUM, AVG, MIN, MAX, GROUP_CONCAT, SAMPLE)
 * - Custom aggregates (SPARQL 1.2)
 * - GROUP BY variable extraction
 * - HAVING expression extraction and transformation
 * - Nested aggregate collection within arithmetic expressions
 * - Expression transformation with pre-computed aggregate variables
 * - ORDER BY comparator translation
 */
export class AggregateTranslator {
  /**
   * Counter for generating unique aggregate variable names.
   */
  private aggregateCounter = 0;

  private readonly translateExpressionFn: (expr: SparqljsExpression) => Expression;

  constructor(deps: {
    translateExpression: (expr: SparqljsExpression) => Expression;
  }) {
    this.translateExpressionFn = deps.translateExpression;
  }

  /** Reset the aggregate counter for each query translation. */
  resetCounter(): void {
    this.aggregateCounter = 0;
  }

  /**
   * Extract all aggregate bindings from SELECT variables with mapping.
   */
  extractAggregatesWithMapping(
    variables: SparqljsVariable[],
    aggregateVarMap: Map<SparqljsExpression, string>
  ): AggregateBinding[] {
    if (!variables) return [];

    const aggregates: AggregateBinding[] = [];

    for (const v of variables) {
      if (!isVariableExpression(v)) continue;

      if ("type" in v.expression && v.expression.type === "aggregate") {
        aggregates.push({
          variable: v.variable.value,
          expression: this.translateAggregateExpression(v.expression as SparqljsAggregateExpression),
        });
        aggregateVarMap.set(v.expression, v.variable.value);
      } else {
        this.collectNestedAggregates(v.expression, aggregates, aggregateVarMap);
      }
    }

    return aggregates;
  }

  extractGroupVariables(group: Grouping[] | undefined): string[] {
    if (!group) return [];

    return group
      .filter((g: Grouping) => g.expression && "termType" in g.expression && g.expression.termType === "Variable")
      .map((g: Grouping) => (g.expression as { value: string }).value);
  }

  /**
   * Extract and translate HAVING expressions.
   */
  extractHavingExpressions(
    having: SparqljsExpression[] | undefined,
    aggregates: AggregateBinding[],
    aggregateVarMap: Map<SparqljsExpression, string>
  ): Expression[] {
    if (!having || having.length === 0) return [];

    for (const expr of having) {
      this.collectNestedAggregates(expr, aggregates, aggregateVarMap);
    }

    return having.map((expr) =>
      this.transformExpressionWithAggregateVars(expr, aggregateVarMap)
    );
  }

  /**
   * Transform an expression by replacing aggregate sub-expressions with
   * variable references to their pre-computed values.
   */
  transformExpressionWithAggregateVars(
    expr: SparqljsExpression,
    aggregateVarMap: Map<SparqljsExpression, string>
  ): Expression {
    const mappedVar = aggregateVarMap.get(expr);
    if (mappedVar !== undefined) {
      return { type: "variable", name: mappedVar };
    }

    if ("type" in expr && expr.type === "operation" && "args" in expr) {
      const opExpr = expr as OperationExpression;
      const transformedArgs = opExpr.args
        .filter((arg): arg is SparqljsExpression => !Array.isArray(arg) && !("patterns" in arg))
        .map((arg: SparqljsExpression) =>
          this.transformExpressionWithAggregateVars(arg, aggregateVarMap)
        );

      const comparisonOps = ["=", "!=", "<", ">", "<=", ">="];
      const logicalOps = ["&&", "||", "!"];
      const arithmeticOps = ["+", "-", "*", "/"];

      if (comparisonOps.includes(opExpr.operator)) {
        return {
          type: "comparison",
          operator: opExpr.operator as "=" | "!=" | "<" | ">" | "<=" | ">=",
          left: transformedArgs[0],
          right: transformedArgs[1],
        };
      }

      if (logicalOps.includes(opExpr.operator)) {
        return {
          type: "logical",
          operator: opExpr.operator as "&&" | "||" | "!",
          operands: transformedArgs,
        };
      }

      if (arithmeticOps.includes(opExpr.operator)) {
        return {
          type: "arithmetic",
          operator: opExpr.operator as ArithmeticExpression["operator"],
          left: transformedArgs[0],
          right: transformedArgs[1],
        };
      }

      return {
        type: "function",
        function: opExpr.operator,
        args: transformedArgs,
      };
    }

    return this.translateExpressionFn(expr);
  }

  translateOrderComparator(order: Ordering): OrderComparator {
    return {
      expression: this.translateExpressionFn(order.expression),
      descending: order.descending || false,
    };
  }

  /**
   * Translate an aggregate expression from sparqljs to our algebra format.
   */
  translateAggregateExpression(expr: SparqljsAggregateExpression): AggregateExpression {
    const aggregation = expr.aggregation;

    const translateInnerExpr = (): Expression | undefined => {
      if (!expr.expression) return undefined;
      if ("termType" in expr.expression && expr.expression.termType === "Wildcard") return undefined;
      return this.translateExpressionFn(expr.expression as SparqljsExpression);
    };

    if (typeof aggregation === "string") {
      const lowerAgg = aggregation.toLowerCase();
      const standardAggregations = ["count", "sum", "avg", "min", "max", "group_concat", "sample"];

      if (standardAggregations.includes(lowerAgg)) {
        return {
          type: "aggregate",
          aggregation: lowerAgg as AggregateExpression["aggregation"],
          expression: translateInnerExpr(),
          distinct: expr.distinct || false,
          separator: expr.separator,
        };
      }

      return {
        type: "aggregate",
        aggregation: { type: "custom", iri: aggregation },
        expression: translateInnerExpr(),
        distinct: expr.distinct || false,
        separator: expr.separator,
      };
    }

    const aggObj = aggregation as unknown;
    if (aggObj && typeof aggObj === "object") {
      let iri: string;
      const aggRecord = aggObj as Record<string, unknown>;

      if (aggRecord.termType === "NamedNode" && typeof aggRecord.value === "string") {
        iri = aggRecord.value;
      } else if ("value" in aggRecord) {
        iri = String(aggRecord.value);
      } else {
        throw new AlgebraTranslatorError(
          `Invalid custom aggregate: expected IRI but got ${JSON.stringify(aggObj)}`
        );
      }

      return {
        type: "aggregate",
        aggregation: { type: "custom", iri },
        expression: translateInnerExpr(),
        distinct: expr.distinct || false,
        separator: expr.separator,
      };
    }

    throw new AlgebraTranslatorError(
      `Unknown aggregate format: ${JSON.stringify(aggregation)}`
    );
  }

  /**
   * Recursively collect all aggregate expressions nested within an expression tree.
   */
  private collectNestedAggregates(
    expr: SparqljsExpression,
    aggregates: AggregateBinding[],
    aggregateVarMap: Map<SparqljsExpression, string>
  ): void {
    if (!expr) return;

    if ("type" in expr && expr.type === "aggregate") {
      const varName = `__agg${this.aggregateCounter++}`;
      aggregates.push({
        variable: varName,
        expression: this.translateAggregateExpression(expr as SparqljsAggregateExpression),
      });
      aggregateVarMap.set(expr, varName);
    } else if ("type" in expr && expr.type === "operation" && "args" in expr) {
      const opExpr = expr as OperationExpression;
      for (const arg of opExpr.args) {
        if (!Array.isArray(arg) && "type" in arg && !("patterns" in arg)) {
          this.collectNestedAggregates(arg as SparqljsExpression, aggregates, aggregateVarMap);
        } else if ("termType" in arg) {
          this.collectNestedAggregates(arg as SparqljsExpression, aggregates, aggregateVarMap);
        }
      }
    }
  }
}
