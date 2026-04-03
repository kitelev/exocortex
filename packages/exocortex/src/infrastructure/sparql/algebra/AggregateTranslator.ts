/* eslint-disable @typescript-eslint/no-explicit-any -- sparqljs AST is untyped */
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  ArithmeticExpression,
  Expression,
  OrderComparator,
  AggregateBinding,
  AggregateExpression,
} from "./AlgebraOperation";

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
   * Used when aggregates are nested inside arithmetic expressions.
   */
  private aggregateCounter = 0;

  private readonly translateExpressionFn: (expr: any) => Expression;

  constructor(deps: {
    translateExpression: (expr: any) => Expression;
  }) {
    this.translateExpressionFn = deps.translateExpression;
  }

  /**
   * Reset the aggregate counter for each query translation.
   */
  resetCounter(): void {
    this.aggregateCounter = 0;
  }

  /**
   * Extract all aggregate bindings from SELECT variables with mapping.
   * This handles both simple aggregates like (SUM(?x) AS ?total) and
   * complex expressions with aggregates like (SUM(?x) / COUNT(?x) AS ?avg).
   *
   * The aggregateVarMap is populated with mappings from the original aggregate
   * expression objects to their assigned variable names, so that later we can
   * transform the containing expression to reference these variables.
   */
  extractAggregatesWithMapping(
    variables: any[],
    aggregateVarMap: Map<any, string>
  ): AggregateBinding[] {
    if (!variables) return [];

    const aggregates: AggregateBinding[] = [];

    for (const v of variables) {
      if (!v.expression || !v.variable) continue;

      if (v.expression.type === "aggregate") {
        // Simple case: (SUM(?x) AS ?total)
        aggregates.push({
          variable: v.variable.value,
          expression: this.translateAggregateExpression(v.expression),
        });
        aggregateVarMap.set(v.expression, v.variable.value);
      } else {
        // Complex case: expression contains aggregates (e.g., SUM(?x) / COUNT(?x))
        this.collectNestedAggregates(v.expression, aggregates, aggregateVarMap);
      }
    }

    return aggregates;
  }

  extractGroupVariables(group: any[] | undefined): string[] {
    if (!group) return [];

    return group
      .filter((g: any) => g.expression && g.expression.termType === "Variable")
      .map((g: any) => g.expression.value);
  }

  /**
   * Extract and translate HAVING expressions.
   *
   * HAVING expressions can contain aggregate functions that may or may not
   * appear in the SELECT clause. We need to:
   * 1. Find any aggregate functions in HAVING
   * 2. Create bindings for them (if not already in aggregates list)
   * 3. Transform the HAVING expression to reference the computed aggregate variables
   */
  extractHavingExpressions(
    having: any[] | undefined,
    aggregates: AggregateBinding[],
    aggregateVarMap: Map<any, string>
  ): Expression[] {
    if (!having || having.length === 0) return [];

    // First, collect any aggregates in HAVING that aren't already tracked
    for (const expr of having) {
      this.collectNestedAggregates(expr, aggregates, aggregateVarMap);
    }

    // Then transform HAVING expressions to reference aggregate variable bindings
    return having.map((expr) =>
      this.transformExpressionWithAggregateVars(expr, aggregateVarMap)
    );
  }

  /**
   * Transform an expression by replacing aggregate sub-expressions with
   * variable references to their pre-computed values.
   *
   * For example, given the expression "SUM(?x) / COUNT(?x)" and a mapping
   * { SUM(?x) -> "__agg0", COUNT(?x) -> "__agg1" }, this returns the
   * translated expression "?__agg0 / ?__agg1".
   */
  transformExpressionWithAggregateVars(
    expr: any,
    aggregateVarMap: Map<any, string>
  ): Expression {
    // Check if this exact expression object has a variable mapping
    const mappedVar = aggregateVarMap.get(expr);
    if (mappedVar !== undefined) {
      return {
        type: "variable",
        name: mappedVar,
      };
    }

    // For operations, recursively transform arguments
    if (expr.type === "operation" && expr.args) {
      const transformedArgs = expr.args.map((arg: any) =>
        this.transformExpressionWithAggregateVars(arg, aggregateVarMap)
      );

      const comparisonOps = ["=", "!=", "<", ">", "<=", ">="];
      const logicalOps = ["&&", "||", "!"];
      const arithmeticOps = ["+", "-", "*", "/"];

      if (comparisonOps.includes(expr.operator)) {
        return {
          type: "comparison",
          operator: expr.operator,
          left: transformedArgs[0],
          right: transformedArgs[1],
        };
      }

      if (logicalOps.includes(expr.operator)) {
        return {
          type: "logical",
          operator: expr.operator,
          operands: transformedArgs,
        };
      }

      if (arithmeticOps.includes(expr.operator)) {
        return {
          type: "arithmetic",
          operator: expr.operator as ArithmeticExpression["operator"],
          left: transformedArgs[0],
          right: transformedArgs[1],
        };
      }

      // Function call
      return {
        type: "function",
        function: expr.operator,
        args: transformedArgs,
      };
    }

    // For other expression types, use the standard translation
    return this.translateExpressionFn(expr);
  }

  translateOrderComparator(order: any): OrderComparator {
    return {
      expression: this.translateExpressionFn(order.expression),
      descending: order.descending || false,
    };
  }

  /**
   * Translate an aggregate expression from sparqljs to our algebra format.
   *
   * Handles both standard SPARQL 1.1 aggregates and SPARQL 1.2 custom aggregates.
   */
  private translateAggregateExpression(expr: any): AggregateExpression {
    const aggregation = expr.aggregation;

    if (typeof aggregation === "string") {
      const lowerAgg = aggregation.toLowerCase();
      const standardAggregations = ["count", "sum", "avg", "min", "max", "group_concat", "sample"];

      if (standardAggregations.includes(lowerAgg)) {
        return {
          type: "aggregate",
          aggregation: lowerAgg as AggregateExpression["aggregation"],
          expression: expr.expression ? this.translateExpressionFn(expr.expression) : undefined,
          distinct: expr.distinct || false,
          separator: expr.separator,
        };
      }

      // String but not a standard aggregation - treat as custom aggregate IRI
      return {
        type: "aggregate",
        aggregation: { type: "custom", iri: aggregation },
        expression: expr.expression ? this.translateExpressionFn(expr.expression) : undefined,
        distinct: expr.distinct || false,
        separator: expr.separator,
      };
    }

    // Custom aggregate as IRI object (NamedNode from sparqljs)
    if (aggregation && typeof aggregation === "object") {
      let iri: string;

      if (aggregation.termType === "NamedNode" && aggregation.value) {
        iri = aggregation.value;
      } else if ("value" in aggregation) {
        iri = String(aggregation.value);
      } else {
        throw new AlgebraTranslatorError(
          `Invalid custom aggregate: expected IRI but got ${JSON.stringify(aggregation)}`
        );
      }

      return {
        type: "aggregate",
        aggregation: { type: "custom", iri },
        expression: expr.expression ? this.translateExpressionFn(expr.expression) : undefined,
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
    expr: any,
    aggregates: AggregateBinding[],
    aggregateVarMap: Map<any, string>
  ): void {
    if (!expr) return;

    if (expr.type === "aggregate") {
      const varName = `__agg${this.aggregateCounter++}`;
      aggregates.push({
        variable: varName,
        expression: this.translateAggregateExpression(expr),
      });
      aggregateVarMap.set(expr, varName);
    } else if (expr.type === "operation" && expr.args) {
      for (const arg of expr.args) {
        this.collectNestedAggregates(arg, aggregates, aggregateVarMap);
      }
    }
  }
}
