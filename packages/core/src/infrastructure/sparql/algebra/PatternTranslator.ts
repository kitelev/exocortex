
import { LateralTransformer } from "../LateralTransformer";
import { AlgebraTranslatorError } from "./AlgebraTranslatorError";
import type {
  AlgebraOperation,
  BGPOperation,
  LeftJoinOperation,
  LateralJoinOperation,
  UnionOperation,
  MinusOperation,
  ValuesOperation,
  ValuesBinding,
  ExtendOperation,
  SubqueryOperation,
  ServiceOperation,
  GraphOperation,
  Expression,
  IRI,
  Literal,
  Variable,
} from "./AlgebraOperation";
import type { SelectQuery } from "../SPARQLParser";
import type {
  SparqljsPattern,
  SparqljsExpression,
  ValuePatternRow,
  FilterPattern,
  OptionalPattern,
  UnionPattern,
  MinusPattern,
  ValuesPattern,
  BindPattern,
  ServicePattern,
  GraphPattern,
  Variable as SparqljsVariable,
  Wildcard,
} from "../SparqljsTypes";
import { isVariableTerm } from "../SparqljsTypes";

/** Direction mappings from directional language tags */
export type DirectionMappings = Map<string, "ltr" | "rtl">;

/**
 * Translates SPARQL graph patterns (BGP, UNION, OPTIONAL, MINUS, VALUES,
 * GRAPH, SERVICE, LATERAL) from sparqljs AST.
 */
export class PatternTranslator {
  private directionMappings: DirectionMappings = new Map();

  private readonly translateExpressionFn: (expr: SparqljsExpression) => Expression;
  private readonly translateSelectFn: (query: SelectQuery) => AlgebraOperation;
  private readonly translateBGPFn: (pattern: SparqljsPattern) => AlgebraOperation;
  constructor(deps: {
    translateExpression: (expr: SparqljsExpression) => Expression;
    translateSelect: (query: SelectQuery) => AlgebraOperation;
    translateBGP: (pattern: SparqljsPattern) => AlgebraOperation;
  }) {
    this.translateExpressionFn = deps.translateExpression;
    this.translateSelectFn = deps.translateSelect;
    this.translateBGPFn = deps.translateBGP;
  }

  setDirectionMappings(mappings: DirectionMappings): void {
    this.directionMappings = mappings;
  }

  translateWhere(patterns: SparqljsPattern[]): AlgebraOperation {
    if (patterns.length === 0) {
      throw new AlgebraTranslatorError("Empty WHERE clause");
    }

    const filterPatterns = patterns.filter((p) => p.type === "filter");
    const bindPatterns = patterns.filter((p) => p.type === "bind");
    const otherPatterns = patterns.filter((p) => p.type !== "filter" && p.type !== "bind");

    let result: AlgebraOperation;

    if (otherPatterns.length === 0) {
      result = { type: "bgp", triples: [] } as BGPOperation;
    } else if (otherPatterns.length === 1) {
      if (otherPatterns[0].type === "optional") {
        const optExpr = (otherPatterns[0] as unknown as Record<string, unknown>).expression as SparqljsExpression | undefined;
        result = {
          type: "leftjoin",
          left: { type: "bgp", triples: [] } as BGPOperation,
          right: this.translateWhere(otherPatterns[0].patterns),
          expression: optExpr ? this.translateExpressionFn(optExpr) : undefined,
        } as LeftJoinOperation;
      } else {
        result = this.translatePattern(otherPatterns[0]);
      }
    } else {
      if (otherPatterns[0].type === "optional") {
        const optExpr = (otherPatterns[0] as unknown as Record<string, unknown>).expression as SparqljsExpression | undefined;
        result = {
          type: "leftjoin",
          left: { type: "bgp", triples: [] } as BGPOperation,
          right: this.translateWhere(otherPatterns[0].patterns),
          expression: optExpr ? this.translateExpressionFn(optExpr) : undefined,
        } as LeftJoinOperation;
      } else {
        result = this.translatePattern(otherPatterns[0]);
      }

      for (let i = 1; i < otherPatterns.length; i++) {
        const rightPattern = otherPatterns[i];

        if (this.isLateralPattern(rightPattern)) {
          const lateralSubquery = this.extractLateralSubquery(rightPattern);
          const cleanedSubquery = this.removeLateralMarker(lateralSubquery);
          const innerQuery = this.translateSelectFn(cleanedSubquery as SelectQuery);

          result = {
            type: "lateraljoin",
            left: result,
            right: innerQuery,
          } as LateralJoinOperation;
        } else if (rightPattern.type === "optional") {
          const rightOptExpr = (rightPattern as unknown as Record<string, unknown>).expression as SparqljsExpression | undefined;
          result = {
            type: "leftjoin",
            left: result,
            right: this.translateWhere(rightPattern.patterns),
            expression: rightOptExpr ? this.translateExpressionFn(rightOptExpr) : undefined,
          } as LeftJoinOperation;
        } else if (rightPattern.type === "minus") {
          // MINUS subtracts from the group that PRECEDES it (SPARQL 1.1
          // §8.3.2 / §18.5: `{ P } MINUS { Q }` = Diff(eval(P), eval(Q))).
          //
          // ⛔ Falling through to the generic `join` below produced
          // `Join(P, Minus(∅, Q))`, which is NOT the same operation:
          // `Minus(∅, Q)` shares no variables with Q, so it removes nothing and
          // yields the single empty solution; joining P with that returns P
          // unchanged. MINUS degraded to a silent no-op in every query that had
          // anything before it — i.e. in every real query.
          //
          // Mirrors the OPTIONAL branch above, which already threads `result`
          // as its left operand for exactly the same reason.
          result = {
            type: "minus",
            left: result,
            right: this.translateWhere(rightPattern.patterns),
          } as MinusOperation;
        } else {
          const right = this.translatePattern(rightPattern);
          result = { type: "join", left: result, right };
        }
      }
    }

    for (const bindPattern of bindPatterns) {
      result = this.translateBind(bindPattern, result);
    }

    for (const filterPattern of filterPatterns) {
      result = {
        type: "filter",
        expression: this.translateExpressionFn(filterPattern.expression),
        input: result,
      };
    }

    return result;
  }

  translatePattern(pattern: SparqljsPattern): AlgebraOperation {
    if (!pattern || !pattern.type) {
      throw new AlgebraTranslatorError("Invalid pattern: missing type");
    }

    switch (pattern.type) {
      case "bgp":
        return this.translateBGPFn(pattern);
      case "filter":
        return this.translateFilter(pattern);
      case "optional":
        return this.translateOptional(pattern);
      case "union":
        return this.translateUnion(pattern);
      case "minus":
        return this.translateMinus(pattern);
      case "values":
        return this.translateValues(pattern);
      case "group":
        return this.translateWhere(pattern.patterns);
      case "query":
        return this.translateSubquery(pattern);
      case "service":
        return this.translateService(pattern);
      case "graph":
        return this.translateGraph(pattern);
      default:
        throw new AlgebraTranslatorError(`Unsupported pattern type: ${pattern.type}`);
    }
  }

  private translateFilter(pattern: FilterPattern): AlgebraOperation {
    if (!pattern.expression) {
      throw new AlgebraTranslatorError("Filter pattern must have expression");
    }
    const input: AlgebraOperation = ({ type: "bgp", triples: [] } as BGPOperation);
    return {
      type: "filter",
      expression: this.translateExpressionFn(pattern.expression),
      input,
    };
  }

  private translateOptional(pattern: OptionalPattern): LeftJoinOperation {
    if (!pattern.patterns || pattern.patterns.length === 0) {
      throw new AlgebraTranslatorError("OPTIONAL pattern must have patterns");
    }

    const optExpr = (pattern as unknown as Record<string, unknown>).expression as SparqljsExpression | undefined;

    return {
      type: "leftjoin",
      left: { type: "bgp", triples: [] },
      right: this.translateWhere(pattern.patterns),
      expression: optExpr ? this.translateExpressionFn(optExpr) : undefined,
    };
  }

  private translateUnion(pattern: UnionPattern): UnionOperation {
    if (!pattern.patterns || pattern.patterns.length < 2) {
      throw new AlgebraTranslatorError("UNION pattern must have at least 2 patterns");
    }

    const translateBranch = (branch: SparqljsPattern): AlgebraOperation => {
      if (branch.type === "graph") return this.translateGraph(branch);
      if (branch.type === "service") return this.translateService(branch);
      if ("patterns" in branch && branch.patterns && Array.isArray(branch.patterns)) {
        return this.translateWhere(branch.patterns);
      }
      return this.translateWhere([branch]);
    };

    let result: UnionOperation = {
      type: "union",
      left: translateBranch(pattern.patterns[0]),
      right: translateBranch(pattern.patterns[1]),
    };

    for (let i = 2; i < pattern.patterns.length; i++) {
      result = {
        type: "union",
        left: result,
        right: translateBranch(pattern.patterns[i]),
      };
    }

    return result;
  }

  private translateMinus(pattern: MinusPattern): MinusOperation {
    if (!pattern.patterns || pattern.patterns.length === 0) {
      throw new AlgebraTranslatorError("MINUS pattern must have patterns");
    }

    return {
      type: "minus",
      left: { type: "bgp", triples: [] },
      right: this.translateWhere(pattern.patterns),
    };
  }

  private translateValues(pattern: ValuesPattern): ValuesOperation {
    if (!pattern.values || !Array.isArray(pattern.values)) {
      throw new AlgebraTranslatorError("VALUES pattern must have values array");
    }

    const variables: Set<string> = new Set();
    for (const binding of pattern.values) {
      for (const key of Object.keys(binding)) {
        const varName = key.startsWith("?") ? key.slice(1) : key;
        variables.add(varName);
      }
    }

    const bindings: ValuesBinding[] = pattern.values.map((sparqljsBinding: ValuePatternRow) =>
      this.translateValuesBinding(sparqljsBinding)
    );

    return {
      type: "values",
      variables: Array.from(variables),
      bindings,
    };
  }

  private translateValuesBinding(sparqljsBinding: ValuePatternRow): ValuesBinding {
    const binding: ValuesBinding = {};

    for (const [key, term] of Object.entries(sparqljsBinding)) {
      const varName = key.startsWith("?") ? key.slice(1) : key;
      const termValue = term;

      if (!termValue) continue;

      if (termValue.termType === "NamedNode") {
        binding[varName] = { type: "iri", value: termValue.value } as IRI;
      } else if (termValue.termType === "Literal") {
        const litTerm = termValue as import("sparqljs").LiteralTerm;
        const literal: Literal = {
          type: "literal",
          value: litTerm.value,
          datatype: litTerm.datatype?.value,
          language: litTerm.language || undefined,
        };
        if (litTerm.language) {
          const direction = this.directionMappings.get(litTerm.language.toLowerCase());
          if (direction) {
            literal.direction = direction;
          }
        }
        binding[varName] = literal;
      } else {
        throw new AlgebraTranslatorError(`Unsupported VALUES term type: ${termValue.termType}`);
      }
    }

    return binding;
  }

  private translateBind(pattern: BindPattern, input: AlgebraOperation): ExtendOperation {
    if (!pattern.variable || !pattern.expression) {
      throw new AlgebraTranslatorError("BIND pattern must have variable and expression");
    }

    return {
      type: "extend",
      variable: pattern.variable.value,
      expression: this.translateExpressionFn(pattern.expression),
      input,
    };
  }

  private translateSubquery(pattern: SelectQuery): SubqueryOperation {
    if (pattern.queryType !== "SELECT") {
      throw new AlgebraTranslatorError(`Only SELECT subqueries are supported, got: ${String((pattern as { queryType: string }).queryType)}`);
    }

    const cleanedPattern = this.removeLateralMarker(pattern);
    const innerQuery = this.translateSelectFn(cleanedPattern as SelectQuery);

    return { type: "subquery", query: innerQuery };
  }

  translateService(pattern: ServicePattern): ServiceOperation {
    if (!pattern.name || pattern.name.termType !== "NamedNode") {
      throw new AlgebraTranslatorError("SERVICE pattern must have a NamedNode endpoint");
    }

    if (!pattern.patterns || !Array.isArray(pattern.patterns)) {
      throw new AlgebraTranslatorError("SERVICE pattern must have patterns array");
    }

    return {
      type: "service",
      endpoint: pattern.name.value,
      pattern: this.translateWhere(pattern.patterns),
      silent: pattern.silent || false,
    };
  }

  translateGraph(pattern: GraphPattern): GraphOperation {
    if (!pattern.name) {
      throw new AlgebraTranslatorError("GRAPH pattern must have a name (IRI or variable)");
    }

    if (!pattern.patterns || !Array.isArray(pattern.patterns)) {
      throw new AlgebraTranslatorError("GRAPH pattern must have patterns array");
    }

    let name: IRI | Variable;
    if (pattern.name.termType === "NamedNode") {
      name = { type: "iri", value: pattern.name.value };
    } else if (pattern.name.termType === "Variable") {
      name = { type: "variable", value: pattern.name.value };
    } else {
      throw new AlgebraTranslatorError(
        `GRAPH pattern name must be NamedNode or Variable, got: ${(pattern.name as { termType: string }).termType}`
      );
    }

    return { type: "graph", name, pattern: this.translateWhere(pattern.patterns) };
  }

  // --- Lateral join helpers ---

  private isLateralPattern(pattern: SparqljsPattern): boolean {
    if (pattern.type === "query" && this.isLateralSubquery(pattern)) return true;
    if (pattern.type === "group" && pattern.patterns?.length === 1) {
      const inner = pattern.patterns[0];
      if (inner.type === "query" && this.isLateralSubquery(inner)) return true;
    }
    return false;
  }

  private extractLateralSubquery(pattern: SparqljsPattern): SparqljsPattern {
    if (pattern.type === "query") return pattern;
    if (pattern.type === "group" && pattern.patterns?.length === 1) {
      const inner = pattern.patterns[0];
      if (inner.type === "query") return inner;
    }
    throw new AlgebraTranslatorError("Invalid lateral pattern structure");
  }

  private isLateralSubquery(pattern: SparqljsPattern): boolean {
    if (!("queryType" in pattern) || pattern.queryType !== "SELECT" || !("variables" in pattern) || !pattern.variables) {
      return false;
    }

    const selectPattern = pattern as SelectQuery;
    const vars = selectPattern.variables as Array<SparqljsVariable | Wildcard>;
    return vars.some(
      (v) => isVariableTerm(v) && v.value === LateralTransformer.LATERAL_MARKER
    );
  }

  private removeLateralMarker(pattern: SparqljsPattern): SparqljsPattern {
    if (!("variables" in pattern) || !pattern.variables) {
      return pattern;
    }

    const selectPattern = pattern as SelectQuery;
    const vars = selectPattern.variables as Array<SparqljsVariable | Wildcard>;
    return {
      ...selectPattern,
      variables: vars.filter(
        (v) => !(isVariableTerm(v) && v.value === LateralTransformer.LATERAL_MARKER)
      ) as SelectQuery["variables"],
    };
  }
}
