import type { SPARQLQuery, SelectQuery, ConstructQuery, AskQuery, ExtendedDescribeQuery } from "../SPARQLParser";
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  AlgebraOperation,
  BGPOperation,
  ConstructOperation,
  AskOperation,
  DescribeOperation,
  IRI,
  Variable,
} from "./AlgebraOperation";
import type {
  SparqljsExpression,
  Ordering,
  Variable as SparqljsVariable,
} from "../SparqljsTypes";
import { isVariableExpression, isVariableTerm } from "../SparqljsTypes";

import { TripleTranslator } from "./TripleTranslator";
import { ExpressionTranslator } from "./ExpressionTranslator";
import { PatternTranslator } from "./PatternTranslator";
import { AggregateTranslator } from "./AggregateTranslator";

export { AlgebraTranslatorError } from "./AlgebraTranslatorError";

/** Direction mappings from directional language tags */
export type DirectionMappings = Map<string, "ltr" | "rtl">;

/**
 * Orchestrator that delegates SPARQL algebra translation to specialised
 * sub-translators (Triple, Expression, Pattern, Aggregate).
 *
 * Public API is unchanged: callers use `translate()` and `setDirectionMappings()`.
 */
export class ExoQLAlgebraTranslator {
  private readonly tripleTranslator: TripleTranslator;
  private readonly expressionTranslator: ExpressionTranslator;
  private readonly patternTranslator: PatternTranslator;
  private readonly aggregateTranslator: AggregateTranslator;

  constructor() {
    // --- Triple translator (no dependencies on others) ---
    this.tripleTranslator = new TripleTranslator();

    // --- Expression translator (needs pattern callbacks for EXISTS) ---
    this.expressionTranslator = new ExpressionTranslator({
      translateWhere: (patterns) => this.patternTranslator.translateWhere(patterns),
      translateBGP: (pattern) => this.tripleTranslator.translateBGP(pattern),
      translatePattern: (pattern) => this.patternTranslator.translatePattern(pattern),
    });

    // --- Pattern translator (needs expression + select callbacks) ---
    this.patternTranslator = new PatternTranslator({
      translateExpression: (expr) => this.expressionTranslator.translateExpression(expr),
      translateSelect: (query) => this.translateSelect(query),
      translateBGP: (pattern) => this.tripleTranslator.translateBGP(pattern),
    });

    // --- Aggregate translator (needs expression callback) ---
    this.aggregateTranslator = new AggregateTranslator({
      translateExpression: (expr) => this.expressionTranslator.translateExpression(expr),
    });
  }

  /**
   * Set direction mappings from the SPARQLParser.
   * These are used to add direction information to literal elements.
   */
  setDirectionMappings(mappings: DirectionMappings): void {
    this.tripleTranslator.setDirectionMappings(mappings);
    this.patternTranslator.setDirectionMappings(mappings);
  }

  translate(query: SPARQLQuery): AlgebraOperation {
    if (query.type !== "query") {
      throw new AlgebraTranslatorError("Only query operations are supported (not updates)");
    }

    if (query.queryType === "SELECT") {
      return this.translateSelect(query as SelectQuery);
    }

    if (query.queryType === "CONSTRUCT") {
      return this.translateConstruct(query as ConstructQuery);
    }

    if (query.queryType === "ASK") {
      return this.translateAsk(query as AskQuery);
    }

    if (query.queryType === "DESCRIBE") {
      return this.translateDescribe(query as ExtendedDescribeQuery);
    }

    throw new AlgebraTranslatorError(`Query type ${String((query as Record<string, unknown>).queryType)} not yet supported`);
  }

  // ----------------------------------------------------------------
  // Query-form translators (remain in orchestrator)
  // ----------------------------------------------------------------

  private translateSelect(query: SelectQuery): AlgebraOperation {
    if (!query.where || query.where.length === 0) {
      throw new AlgebraTranslatorError("SELECT query must have WHERE clause");
    }

    let operation: AlgebraOperation = this.patternTranslator.translateWhere(query.where);

    this.aggregateTranslator.resetCounter();

    const aggregateVarMap = new Map<SparqljsExpression, string>();

    const selectVars = Array.isArray(query.variables)
      ? query.variables.filter((v): v is SparqljsVariable => !("termType" in v && v.termType === "Wildcard"))
      : [];
    const aggregates = this.aggregateTranslator.extractAggregatesWithMapping(selectVars, aggregateVarMap);
    const groupVars = this.aggregateTranslator.extractGroupVariables(query.group);

    const havingExpressions = this.aggregateTranslator.extractHavingExpressions(
      query.having,
      aggregates,
      aggregateVarMap
    );

    if (aggregates.length > 0 || groupVars.length > 0 || havingExpressions.length > 0) {
      operation = {
        type: "group",
        variables: groupVars,
        aggregates,
        having: havingExpressions.length > 0 ? havingExpressions : undefined,
        input: operation,
      };
    }

    if (selectVars.length > 0) {
      for (const v of selectVars) {
        if (isVariableExpression(v)) {
          if ("type" in v.expression && v.expression.type === "aggregate") {
            continue;
          }

          const transformedExpr = this.aggregateTranslator.transformExpressionWithAggregateVars(
            v.expression,
            aggregateVarMap
          );

          operation = {
            type: "extend",
            variable: v.variable.value,
            expression: transformedExpr,
            input: operation,
          };
        }
      }

      const varNames = selectVars
        .filter((v: SparqljsVariable) => isVariableTerm(v) || isVariableExpression(v))
        .map((v: SparqljsVariable) => isVariableTerm(v) ? v.value : (v as import("sparqljs").VariableExpression).variable.value);

      if (varNames.length > 0) {
        operation = { type: "project", variables: varNames, input: operation };
      }
    }

    if (query.distinct) {
      operation = { type: "distinct", input: operation };
    }

    if (query.reduced) {
      operation = { type: "reduced", input: operation };
    }

    if (query.order && query.order.length > 0) {
      operation = {
        type: "orderby",
        comparators: query.order.map((o: Ordering) => this.aggregateTranslator.translateOrderComparator(o)),
        input: operation,
      };
    }

    if (query.limit !== undefined || query.offset !== undefined) {
      operation = { type: "slice", limit: query.limit, offset: query.offset, input: operation };
    }

    return operation;
  }

  private translateConstruct(query: ConstructQuery): ConstructOperation {
    const template = this.tripleTranslator.translateConstructTemplate(query.template ?? []);

    if (!query.where || query.where.length === 0) {
      throw new AlgebraTranslatorError("CONSTRUCT query must have WHERE clause");
    }
    let where: AlgebraOperation = this.patternTranslator.translateWhere(query.where);

    const queryAny = query as unknown as { limit?: number; offset?: number };
    if (queryAny.limit !== undefined || queryAny.offset !== undefined) {
      where = { type: "slice", limit: queryAny.limit, offset: queryAny.offset, input: where };
    }

    return { type: "construct", template, where };
  }

  private translateAsk(query: AskQuery): AskOperation {
    const where = query.where && query.where.length > 0
      ? this.patternTranslator.translateWhere(query.where)
      : ({ type: "bgp", triples: [] } as BGPOperation);

    return { type: "ask", where };
  }

  private translateDescribe(query: ExtendedDescribeQuery): DescribeOperation {
    const resources: (IRI | Variable)[] = [];

    if (query.variables && Array.isArray(query.variables)) {
      const descVars = query.variables as Array<{ termType: string; value: string }>;
      for (const v of descVars) {
        if (v.termType === "Wildcard" || v.value === "*") continue;

        if (v.termType === "Variable") {
          resources.push({ type: "variable", value: v.value });
        } else if (v.termType === "NamedNode") {
          resources.push({ type: "iri", value: v.value });
        }
      }
    }

    let where: AlgebraOperation | undefined;
    if (query.where && query.where.length > 0) {
      where = this.patternTranslator.translateWhere(query.where);
    }

    const options = query.describeOptions;

    return {
      type: "describe",
      resources,
      where,
      depth: options?.depth,
      symmetric: options?.symmetric,
    };
  }
}

/** @deprecated Use ExoQLAlgebraTranslator instead. Will be removed in a future release. */
export { ExoQLAlgebraTranslator as AlgebraTranslator };
