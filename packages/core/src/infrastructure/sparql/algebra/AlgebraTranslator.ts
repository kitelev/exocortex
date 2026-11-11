import type { SPARQLQuery, SelectQuery, ConstructQuery, AskQuery, ExtendedDescribeQuery } from "../SPARQLParser";
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  AlgebraOperation,
  BGPOperation,
  ConstructOperation,
  AskOperation,
  DescribeOperation,
  AggregateBinding,
  OrderComparator,
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

    // One aggregate-name counter per query, reset HERE only: a nested level
    // (subquery in WHERE or in EXISTS) is translated by `translateSelect` while
    // the outer level is still collecting, and a reset there handed an outer
    // ORDER BY aggregate an `__agg` name already taken (ems__Bug 2653916f).
    this.aggregateTranslator.resetCounter();

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
    const orderComparators = this.translateOrderWithAggregates(query.order, aggregates, aggregateVarMap, true);
    const explicitGroup = (query.group?.length ?? 0) > 0;

    if (aggregates.length > 0 || groupVars.length > 0 || (explicitGroup && havingExpressions.length > 0)) {
      operation = {
        type: "group",
        ...(explicitGroup ? { explicit: true } : {}),
        variables: groupVars,
        aggregates,
        having: havingExpressions.length > 0 ? havingExpressions : undefined,
        input: operation,
      };
    } else {
      operation = this.havingAsFilter(operation, query.having);
    }

    // SELECT expressions (Extend) — computed bindings (e.g. `(?a + ?b AS ?sum)`)
    // must be materialised BEFORE ORDER BY (which may sort by them) and BEFORE
    // projection drops non-selected variables.
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
    }

    // ORDER BY — applied on the full (pre-projection) solution sequence so it can
    // sort by variables that are NOT in the SELECT list (e.g. a subquery
    // `SELECT ?person … ORDER BY ?age`). SPARQL 1.1 §18.2.4.2 places OrderBy
    // strictly before Project. Projecting first would drop the sort key and
    // silently turn ORDER BY into a no-op — the rows then leak through in
    // triple-store insertion order, which surfaces most visibly when the
    // subquery is joined with an outer pattern (kitelev/exocortex#3542).
    if (orderComparators.length > 0) {
      operation = {
        type: "orderby",
        comparators: orderComparators,
        input: operation,
      };
    }

    // Projection — AFTER ORDER BY, so the sort key stays visible to OrderBy.
    if (selectVars.length > 0) {
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

  /**
   * ASK = "does the solution sequence have at least one member", and SPARQL 1.1
   * (§16.3, §18.2.4) gives ASK the same solution modifiers as SELECT minus the
   * projection. GROUP BY / HAVING and LIMIT / OFFSET decide which solutions
   * survive, so they wrap WHERE here in the same order as `translateSelect`:
   * the grouping step (Group with HAVING, or HAVING as a Filter when nothing
   * groups) first, Slice last — ASK answers "the SELECT with the same modifiers
   * has a row". The grouping step is deliberately the SAME one `translateSelect`
   * uses, gaps included — among them 38328fcc (GROUP BY by expression) and
   * 2f27f300 (IN and an aggregate inside a function call in HAVING); fixing them
   * in the shared step fixes both forms (ems__Bug 2653916f fixed four there).
   * ORDER BY is not translated into a sort: it only reorders, so it never changes
   * whether a solution survives (no sort cost). Its aggregates are still
   * collected — an aggregate in ORDER BY groups the query level here as in
   * SELECT (ems__Bug 2653916f).
   * `@types/sparqljs` types AskQuery without the modifiers, but the parser
   * fills them for ASK as for SELECT (vault-exodev ems__Bug 14fb9cb2).
   */
  private translateAsk(query: AskQuery): AskOperation {
    let where: AlgebraOperation = query.where && query.where.length > 0
      ? this.patternTranslator.translateWhere(query.where)
      : ({ type: "bgp", triples: [] } as BGPOperation);

    const modifiers = query as unknown as Pick<SelectQuery, "group" | "having" | "order" | "limit" | "offset">;

    const aggregateVarMap = new Map<SparqljsExpression, string>();
    const aggregates: AggregateBinding[] = [];
    const groupVars = this.aggregateTranslator.extractGroupVariables(modifiers.group);
    const havingExpressions = this.aggregateTranslator.extractHavingExpressions(
      modifiers.having,
      aggregates,
      aggregateVarMap
    );
    this.translateOrderWithAggregates(modifiers.order, aggregates, aggregateVarMap, false);
    const explicitGroup = (modifiers.group?.length ?? 0) > 0;

    if (aggregates.length > 0 || groupVars.length > 0 || (explicitGroup && havingExpressions.length > 0)) {
      where = {
        type: "group",
        ...(explicitGroup ? { explicit: true } : {}),
        variables: groupVars,
        aggregates,
        having: havingExpressions.length > 0 ? havingExpressions : undefined,
        input: where,
      };
    } else {
      where = this.havingAsFilter(where, modifiers.having);
    }

    if (modifiers.limit !== undefined || modifiers.offset !== undefined) {
      where = { type: "slice", limit: modifiers.limit, offset: modifiers.offset, input: where };
    }

    return { type: "ask", where };
  }

  /**
   * ORDER BY of one query level (SPARQL 1.1 §18.2.4.1). A condition holding an
   * aggregate has it collected into `aggregates` — an aggregate in ORDER BY
   * groups the level, as one in SELECT or HAVING does — and reads its group's
   * value; any other condition is an ordinary expression. With `translate`
   * false (ASK, which does not sort) only the aggregates are collected and no
   * comparator is built (ems__Bug 2653916f).
   */
  private translateOrderWithAggregates(
    order: Ordering[] | undefined,
    aggregates: AggregateBinding[],
    aggregateVarMap: Map<SparqljsExpression, string>,
    translate: boolean
  ): OrderComparator[] {
    const comparators: OrderComparator[] = [];
    for (const o of order ?? []) {
      const added = this.aggregateTranslator.collectAggregates(o.expression, aggregates, aggregateVarMap);
      if (translate) {
        const comparator = this.aggregateTranslator.translateOrderComparator(o, added > 0 ? aggregateVarMap : undefined);
        if (added > 0 && comparator.expression.type !== "variable") {
          // ORDER BY by an expression does not sort (ems__Bug f7105304), so an
          // expression over an aggregate would come back silently unsorted — it
          // was refused before 2653916f and stays refused, with the way round it.
          throw new AlgebraTranslatorError(
            "ORDER BY on an expression over an aggregate is not supported: project it and order by the variable — SELECT … ((<expression>) AS ?k) … ORDER BY ?k"
          );
        }
        comparators.push(comparator);
      }
    }
    return comparators;
  }

  /**
   * HAVING of a query level that does not group (no GROUP BY, no aggregate in
   * SELECT, HAVING or ORDER BY): the aggregate step is skipped and each HAVING
   * condition is a Filter over the solutions — SPARQL 1.1 §18.2.4.2
   * `P := Filter(E, P)`. One Filter per condition makes them a conjunction where
   * an error in any drops the solution, as over a group. A group built here
   * instead turned the solutions into one empty row (ems__Bug 2653916f).
   */
  private havingAsFilter(input: AlgebraOperation, having: SparqljsExpression[] | undefined): AlgebraOperation {
    let operation = input;
    for (const expr of having ?? []) {
      operation = {
        type: "filter",
        expression: this.expressionTranslator.translateExpression(expr),
        input: operation,
      };
    }
    return operation;
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
