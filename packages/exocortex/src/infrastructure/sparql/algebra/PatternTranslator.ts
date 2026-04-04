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
  ServiceOperation,
  GraphOperation,
  SubqueryOperation,
  Triple,
  TripleElement,
  Expression,
  PropertyPath,
  IRI,
  Literal,
  Variable,
  QuotedTriple,
} from "./AlgebraOperation";
import type { SelectQuery } from "../SPARQLParser";
import type {
  SparqljsPattern,
  SparqljsBgpPattern,
  SparqljsTriple,
  SparqljsTerm,
  SparqljsPropertyPath,
  SparqljsExpression,
  SparqljsFilterPattern,
  SparqljsOptionalPattern,
  SparqljsUnionPattern,
  SparqljsMinusPattern,
  SparqljsValuesPattern,
  SparqljsValuesRow,
  SparqljsBindPattern,
  SparqljsServicePattern,
  SparqljsGraphPattern,
  SparqljsSubqueryPattern,
  SparqljsSelectVariable,
  SparqljsNamedNode,
  SparqljsQuad,
} from "../types";

/** Direction mappings from directional language tags */
export type DirectionMappings = Map<string, "ltr" | "rtl">;

/**
 * Translates SPARQL graph patterns (BGP, UNION, OPTIONAL, MINUS, VALUES,
 * GRAPH, SERVICE, LATERAL) and triple elements from sparqljs AST.
 */
export class PatternTranslator {
  private directionMappings: DirectionMappings = new Map();

  private readonly translateExpressionFn: (expr: SparqljsExpression) => Expression;
  private readonly translateSelectFn: (query: SelectQuery) => AlgebraOperation;

  constructor(deps: {
    translateExpression: (expr: SparqljsExpression) => Expression;
    translateSelect: (query: SelectQuery) => AlgebraOperation;
  }) {
    this.translateExpressionFn = deps.translateExpression;
    this.translateSelectFn = deps.translateSelect;
  }

  setDirectionMappings(mappings: DirectionMappings): void {
    this.directionMappings = mappings;
  }

  translateWhere(patterns: SparqljsPattern[]): AlgebraOperation {
    if (patterns.length === 0) {
      throw new AlgebraTranslatorError("Empty WHERE clause");
    }

    // Separate FILTER and BIND from other patterns (they apply to results, not joined)
    const filterPatterns = patterns.filter((p) => p.type === "filter");
    const bindPatterns = patterns.filter((p) => p.type === "bind");
    const otherPatterns = patterns.filter((p) => p.type !== "filter" && p.type !== "bind");

    let result: AlgebraOperation;

    if (otherPatterns.length === 0) {
      result = { type: "bgp", triples: [] } as BGPOperation;
    } else if (otherPatterns.length === 1) {
      // Issue #2208: OPTIONAL at the start uses empty BGP as left
      if (otherPatterns[0].type === "optional") {
        result = {
          type: "leftjoin",
          left: { type: "bgp", triples: [] } as BGPOperation,
          right: this.translateWhere(otherPatterns[0].patterns),
          expression: otherPatterns[0].expression
            ? this.translateExpressionFn(otherPatterns[0].expression)
            : undefined,
        } as LeftJoinOperation;
      } else {
        result = this.translatePattern(otherPatterns[0]);
      }
    } else {
      // Handle first pattern specially if it's OPTIONAL (use empty BGP as left)
      if (otherPatterns[0].type === "optional") {
        result = {
          type: "leftjoin",
          left: { type: "bgp", triples: [] } as BGPOperation,
          right: this.translateWhere(otherPatterns[0].patterns),
          expression: otherPatterns[0].expression
            ? this.translateExpressionFn(otherPatterns[0].expression)
            : undefined,
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
          result = {
            type: "leftjoin",
            left: result,
            right: this.translateWhere(rightPattern.patterns),
            expression: rightPattern.expression
              ? this.translateExpressionFn(rightPattern.expression)
              : undefined,
          } as LeftJoinOperation;
        } else {
          // Regular join
          const right = this.translatePattern(rightPattern);
          result = {
            type: "join",
            left: result,
            right,
          };
        }
      }
    }

    // Apply BIND operations (they extend solutions with computed values)
    for (const bindPattern of bindPatterns) {
      result = this.translateBind(bindPattern, result);
    }

    // Then, wrap with FILTER operations (they apply to the combined result)
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
        return this.translateBGP(pattern);
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

  translateBGP(pattern: SparqljsBgpPattern): BGPOperation {
    if (!pattern.triples || !Array.isArray(pattern.triples)) {
      throw new AlgebraTranslatorError("BGP pattern must have triples array");
    }

    return {
      type: "bgp",
      triples: pattern.triples.map((t) => this.translateTriple(t)),
    };
  }

  translateTriple(triple: SparqljsTriple): Triple {
    if (!triple.subject || !triple.predicate || !triple.object) {
      throw new AlgebraTranslatorError("Triple must have subject, predicate, and object");
    }

    return {
      subject: this.translateTripleElement(triple.subject),
      predicate: this.translatePredicate(triple.predicate),
      object: this.translateTripleElement(triple.object),
    };
  }

  /** Translate CONSTRUCT template triples from sparqljs AST format. */
  translateConstructTemplate(template: SparqljsTriple[]): Triple[] {
    if (!template || !Array.isArray(template)) {
      return [];
    }

    return template.map((t) => this.translateTriple(t));
  }

  /** Translate a predicate (simple IRI/Variable or property path). */
  private translatePredicate(predicate: SparqljsTerm | SparqljsPropertyPath): TripleElement | PropertyPath {
    if ("type" in predicate && predicate.type === "path") return this.translatePropertyPath(predicate as SparqljsPropertyPath);
    return this.translateTripleElement(predicate as SparqljsTerm);
  }

  /** Translate a property path expression from sparqljs AST. */
  private translatePropertyPath(path: SparqljsPropertyPath): PropertyPath {
    if (!path.pathType) {
      throw new AlgebraTranslatorError("Property path must have pathType");
    }
    if (!path.items || !Array.isArray(path.items)) {
      throw new AlgebraTranslatorError("Property path must have items array");
    }

    const items = path.items.map((item) => this.translatePathItem(item));
    const singleItemTypes = ["^", "+", "*", "?"];
    const singleItemLabels: Record<string, string> = {
      "^": "Inverse", "+": "OneOrMore", "*": "ZeroOrMore", "?": "ZeroOrOne",
    };

    if (path.pathType === "/" || path.pathType === "|") {
      return { type: "path", pathType: path.pathType, items };
    }
    if (singleItemTypes.includes(path.pathType)) {
      if (items.length !== 1) {
        throw new AlgebraTranslatorError(`${singleItemLabels[path.pathType]} path must have exactly one item`);
      }
      return { type: "path", pathType: path.pathType, items: [items[0]] };
    }
    throw new AlgebraTranslatorError(`Unsupported property path type: ${path.pathType}`);
  }

  /** Translate a single item in a property path (IRI or nested path). */
  private translatePathItem(item: SparqljsNamedNode | SparqljsPropertyPath): IRI | PropertyPath {
    if ("type" in item && item.type === "path") return this.translatePropertyPath(item as SparqljsPropertyPath);
    if ("termType" in item && item.termType === "NamedNode") return { type: "iri", value: (item as SparqljsNamedNode).value };
    throw new AlgebraTranslatorError(`Unsupported path item type: ${"type" in item ? item.type : "termType" in item ? item.termType : "unknown"}`);
  }

  translateTripleElement(element: SparqljsTerm): TripleElement {
    if (!element || !element.termType) {
      throw new AlgebraTranslatorError("Triple element must have termType");
    }
    switch (element.termType) {
      case "Variable":
        return { type: "variable", value: element.value };
      case "NamedNode":
        return { type: "iri", value: element.value };
      case "Literal": {
        const literal: Literal = {
          type: "literal", value: element.value,
          datatype: element.datatype?.value, language: element.language,
        };
        if (element.language) {
          const direction = this.directionMappings.get(element.language.toLowerCase());
          if (direction) { literal.direction = direction; }
        }
        return literal;
      }
      case "BlankNode":
        return { type: "blank", value: element.value };
      case "Quad":
        return this.translateQuotedTriple(element);
      default:
        throw new AlgebraTranslatorError(`Unsupported term type: ${(element as SparqljsTerm).termType}`);
    }
  }

  /** Translate a quoted triple (RDF-Star) from sparqljs Quad format. */
  private translateQuotedTriple(element: SparqljsQuad): QuotedTriple {
    if (!element.subject || !element.predicate || !element.object) {
      throw new AlgebraTranslatorError("Quoted triple must have subject, predicate, and object");
    }
    return {
      type: "quoted",
      subject: this.translateTripleElement(element.subject),
      predicate: this.translateQuotedTriplePredicate(element.predicate),
      object: this.translateTripleElement(element.object),
    };
  }

  /** Translate predicate in a quoted triple (only IRI or Variable allowed). */
  private translateQuotedTriplePredicate(predicate: SparqljsTerm): IRI | Variable {
    if (!predicate || !predicate.termType) {
      throw new AlgebraTranslatorError("Quoted triple predicate must have termType");
    }
    if (predicate.termType === "Variable") return { type: "variable", value: predicate.value };
    if (predicate.termType === "NamedNode") return { type: "iri", value: predicate.value };
    throw new AlgebraTranslatorError(
      `Quoted triple predicate must be IRI or Variable, got: ${predicate.termType}`
    );
  }

  private translateFilter(pattern: SparqljsFilterPattern): AlgebraOperation {
    if (!pattern.expression) {
      throw new AlgebraTranslatorError("Filter pattern must have expression");
    }
    const input: AlgebraOperation = pattern.patterns
      ? this.translateWhere(pattern.patterns)
      : ({ type: "bgp", triples: [] } as BGPOperation);
    return { type: "filter", expression: this.translateExpressionFn(pattern.expression), input };
  }

  private translateOptional(pattern: SparqljsOptionalPattern): LeftJoinOperation {
    if (!pattern.patterns || pattern.patterns.length === 0) {
      throw new AlgebraTranslatorError("OPTIONAL pattern must have patterns");
    }
    return { type: "leftjoin", left: { type: "bgp", triples: [] },
      right: this.translateWhere(pattern.patterns),
      expression: pattern.expression ? this.translateExpressionFn(pattern.expression) : undefined };
  }

  /** Translate n-ary UNION into left-associative binary union tree. */
  private translateUnion(pattern: SparqljsUnionPattern): UnionOperation {
    if (!pattern.patterns || pattern.patterns.length < 2) {
      throw new AlgebraTranslatorError("UNION pattern must have at least 2 patterns");
    }

    const translateBranch = (branch: SparqljsPattern): AlgebraOperation => {
      if (branch.type === "graph") {
        return this.translateGraph(branch);
      }
      if (branch.type === "service") {
        return this.translateService(branch);
      }
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

  private translateMinus(pattern: SparqljsMinusPattern): MinusOperation {
    if (!pattern.patterns || pattern.patterns.length === 0) {
      throw new AlgebraTranslatorError("MINUS pattern must have patterns");
    }
    return { type: "minus", left: { type: "bgp", triples: [] },
      right: this.translateWhere(pattern.patterns) };
  }

  private translateValues(pattern: SparqljsValuesPattern): ValuesOperation {
    if (!pattern.values || !Array.isArray(pattern.values)) {
      throw new AlgebraTranslatorError("VALUES pattern must have values array");
    }
    const variables: Set<string> = new Set();
    for (const binding of pattern.values) {
      for (const key of Object.keys(binding)) {
        variables.add(key.startsWith("?") ? key.slice(1) : key);
      }
    }
    return {
      type: "values",
      variables: Array.from(variables),
      bindings: pattern.values.map((b) => this.translateValuesBinding(b)),
    };
  }

  private translateValuesBinding(sparqljsBinding: SparqljsValuesRow): ValuesBinding {
    const binding: ValuesBinding = {};
    for (const [key, term] of Object.entries(sparqljsBinding)) {
      const varName = key.startsWith("?") ? key.slice(1) : key;
      const tv = term as SparqljsTerm | undefined;
      if (!tv) continue;
      if (tv.termType === "NamedNode") {
        binding[varName] = { type: "iri", value: tv.value } as IRI;
      } else if (tv.termType === "Literal") {
        const literal: Literal = {
          type: "literal", value: tv.value,
          datatype: tv.datatype?.value, language: tv.language || undefined,
        };
        if (tv.language) {
          const direction = this.directionMappings.get(tv.language.toLowerCase());
          if (direction) { literal.direction = direction; }
        }
        binding[varName] = literal;
      } else {
        throw new AlgebraTranslatorError(`Unsupported VALUES term type: ${tv.termType}`);
      }
    }
    return binding;
  }

  private translateBind(pattern: SparqljsBindPattern, input: AlgebraOperation): ExtendOperation {
    if (!pattern.variable || !pattern.expression) {
      throw new AlgebraTranslatorError("BIND pattern must have variable and expression");
    }
    return { type: "extend", variable: pattern.variable.value,
      expression: this.translateExpressionFn(pattern.expression), input };
  }

  private translateSubquery(pattern: SparqljsSubqueryPattern): SubqueryOperation {
    if (pattern.queryType !== "SELECT") {
      throw new AlgebraTranslatorError(`Only SELECT subqueries are supported, got: ${pattern.queryType}`);
    }
    return { type: "subquery",
      query: this.translateSelectFn(this.removeLateralMarker(pattern) as SelectQuery) };
  }

  /** Translate SERVICE pattern for federated queries. */
  translateService(pattern: SparqljsServicePattern): ServiceOperation {
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

  /** Translate GRAPH pattern for named graph queries. */
  translateGraph(pattern: SparqljsGraphPattern): GraphOperation {
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
        `GRAPH pattern name must be NamedNode or Variable, got: ${(pattern.name as SparqljsTerm).termType}`
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

  private extractLateralSubquery(pattern: SparqljsPattern): SparqljsSubqueryPattern {
    if (pattern.type === "query") return pattern;
    if (pattern.type === "group" && pattern.patterns?.length === 1) {
      const inner = pattern.patterns[0];
      if (inner.type === "query") return inner;
    }
    throw new AlgebraTranslatorError("Invalid lateral pattern structure");
  }

  private isLateralSubquery(pattern: SparqljsSubqueryPattern): boolean {
    if (pattern.queryType !== "SELECT" || !pattern.variables) return false;
    return pattern.variables.some(
      (v: SparqljsSelectVariable) =>
        "termType" in v && v.termType === "Variable" && v.value === LateralTransformer.LATERAL_MARKER
    );
  }

  private removeLateralMarker(pattern: SparqljsSubqueryPattern): SparqljsSubqueryPattern {
    if (!pattern.variables) return pattern;
    return {
      ...pattern,
      variables: pattern.variables.filter(
        (v: SparqljsSelectVariable) =>
          !("termType" in v && v.termType === "Variable" && v.value === LateralTransformer.LATERAL_MARKER)
      ),
    };
  }
}
