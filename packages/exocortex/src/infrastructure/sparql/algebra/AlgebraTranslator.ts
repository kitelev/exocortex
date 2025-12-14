import type { SPARQLQuery, SelectQuery, ConstructQuery, AskQuery } from "../SPARQLParser";
import type {
  AlgebraOperation,
  BGPOperation,
  FilterOperation,
  LeftJoinOperation,
  UnionOperation,
  MinusOperation,
  ValuesOperation,
  ValuesBinding,
  ExtendOperation,
  SubqueryOperation,
  ConstructOperation,
  AskOperation,
  ServiceOperation,
  GraphOperation,
  ExistsExpression,
  InExpression,
  ArithmeticExpression,
  Triple,
  TripleElement,
  Expression,
  OrderComparator,
  AggregateBinding,
  AggregateExpression,
  PropertyPath,
  IRI,
  Literal,
  Variable,
} from "./AlgebraOperation";

export class AlgebraTranslatorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "AlgebraTranslatorError";
  }
}

export class AlgebraTranslator {
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

    throw new AlgebraTranslatorError(`Query type ${query.queryType} not yet supported`);
  }

  private translateSelect(query: SelectQuery): AlgebraOperation {
    let operation: AlgebraOperation;

    if (!query.where || query.where.length === 0) {
      throw new AlgebraTranslatorError("SELECT query must have WHERE clause");
    }

    operation = this.translateWhere(query.where);

    // Reset aggregate counter for each query translation
    this.aggregateCounter = 0;

    // Map to track aggregate expressions and their assigned variable names
    // This is used to replace aggregate references in arithmetic expressions
    const aggregateVarMap = new Map<any, string>();

    const aggregates = this.extractAggregatesWithMapping(query.variables, aggregateVarMap);
    const groupVars = this.extractGroupVariables(query.group);

    if (aggregates.length > 0 || groupVars.length > 0) {
      operation = {
        type: "group",
        variables: groupVars,
        aggregates: aggregates,
        input: operation,
      };
    }

    if (query.variables && query.variables.length > 0) {
      // Create extend operations for computed expressions that need post-aggregate evaluation
      for (const v of query.variables) {
        const anyV = v as any;
        if (anyV.expression && anyV.variable) {
          // Skip simple aggregates - they're already bound by the group operation
          if (anyV.expression.type === "aggregate") {
            continue;
          }

          // For complex expressions containing aggregates (e.g., SUM(?x) / COUNT(?x)),
          // we need to create an extend that evaluates the arithmetic using the
          // pre-computed aggregate variable values
          const transformedExpr = this.transformExpressionWithAggregateVars(
            anyV.expression,
            aggregateVarMap
          );

          operation = {
            type: "extend",
            variable: anyV.variable.value,
            expression: transformedExpr,
            input: operation,
          };
        }
      }

      const varNames = query.variables
        .filter((v: any) => v.termType === "Variable" || (v as any).variable)
        .map((v: any) => v.termType === "Variable" ? v.value : (v as any).variable.value);

      if (varNames.length > 0) {
        operation = {
          type: "project",
          variables: varNames,
          input: operation,
        };
      }
    }

    if (query.distinct) {
      operation = {
        type: "distinct",
        input: operation,
      };
    }

    // REDUCED modifier - spec allows treating it as DISTINCT or doing nothing
    // sparqljs exposes this as query.reduced
    if ((query as any).reduced) {
      operation = {
        type: "reduced",
        input: operation,
      };
    }

    if (query.order && query.order.length > 0) {
      operation = {
        type: "orderby",
        comparators: query.order.map((o: any) => this.translateOrderComparator(o)),
        input: operation,
      };
    }

    if (query.limit !== undefined || query.offset !== undefined) {
      operation = {
        type: "slice",
        limit: query.limit,
        offset: query.offset,
        input: operation,
      };
    }

    return operation;
  }

  /**
   * Translate a CONSTRUCT query to algebra.
   * CONSTRUCT queries produce triples by substituting variables in a template
   * with values from the WHERE clause solutions.
   */
  private translateConstruct(query: ConstructQuery): ConstructOperation {
    // Translate the template triples (may be undefined in sparqljs)
    const template = this.translateConstructTemplate(query.template ?? []);

    // Translate the WHERE clause
    if (!query.where || query.where.length === 0) {
      throw new AlgebraTranslatorError("CONSTRUCT query must have WHERE clause");
    }
    const where = this.translateWhere(query.where);

    return {
      type: "construct",
      template,
      where,
    };
  }

  /**
   * Translate CONSTRUCT template triples from sparqljs AST format.
   * Template triples may contain variables that will be substituted
   * with values from the WHERE clause solutions.
   */
  private translateConstructTemplate(template: any[]): Triple[] {
    if (!template || !Array.isArray(template)) {
      return [];
    }

    return template.map((t: any) => this.translateTriple(t));
  }

  /**
   * Translate an ASK query to algebra.
   * ASK queries test whether a pattern matches and return a boolean result.
   *
   * SPARQL 1.1 spec (Section 16.3): ASK queries return true if the pattern
   * matches at least one solution, false otherwise.
   */
  private translateAsk(query: AskQuery): AskOperation {
    // ASK queries may have an empty WHERE clause (rare but valid)
    const where = query.where && query.where.length > 0
      ? this.translateWhere(query.where)
      : ({ type: "bgp", triples: [] } as BGPOperation);

    return {
      type: "ask",
      where,
    };
  }

  /**
   * Counter for generating unique aggregate variable names.
   * Used when aggregates are nested inside arithmetic expressions.
   */
  private aggregateCounter = 0;

  /**
   * Extract all aggregate bindings from SELECT variables with mapping.
   * This handles both simple aggregates like (SUM(?x) AS ?total) and
   * complex expressions with aggregates like (SUM(?x) / COUNT(?x) AS ?avg).
   *
   * The aggregateVarMap is populated with mappings from the original aggregate
   * expression objects to their assigned variable names, so that later we can
   * transform the containing expression to reference these variables.
   */
  private extractAggregatesWithMapping(
    variables: any[],
    aggregateVarMap: Map<any, string>
  ): AggregateBinding[] {
    if (!variables) return [];

    const aggregates: AggregateBinding[] = [];

    for (const v of variables) {
      if (!v.expression || !v.variable) continue;

      if (v.expression.type === "aggregate") {
        // Simple case: (SUM(?x) AS ?total)
        // The variable name is directly from the AS clause
        aggregates.push({
          variable: v.variable.value,
          expression: this.translateAggregateExpression(v.expression),
        });
        // Map this aggregate to its variable for potential nested references
        aggregateVarMap.set(v.expression, v.variable.value);
      } else {
        // Complex case: expression contains aggregates (e.g., SUM(?x) / COUNT(?x))
        // Find all nested aggregates and create bindings for them
        this.collectNestedAggregates(v.expression, aggregates, aggregateVarMap);
      }
    }

    return aggregates;
  }

  /**
   * Recursively collect all aggregate expressions nested within an expression tree.
   * For each aggregate found, creates a temporary variable binding and records
   * the mapping in aggregateVarMap for later expression transformation.
   */
  private collectNestedAggregates(
    expr: any,
    aggregates: AggregateBinding[],
    aggregateVarMap: Map<any, string>
  ): void {
    if (!expr) return;

    if (expr.type === "aggregate") {
      // Found an aggregate - create a unique variable name for it
      const varName = `__agg${this.aggregateCounter++}`;
      aggregates.push({
        variable: varName,
        expression: this.translateAggregateExpression(expr),
      });
      // Record the mapping so we can transform the containing expression later
      aggregateVarMap.set(expr, varName);
    } else if (expr.type === "operation" && expr.args) {
      // Recursively search in operation arguments
      for (const arg of expr.args) {
        this.collectNestedAggregates(arg, aggregates, aggregateVarMap);
      }
    }
  }

  /**
   * Transform an expression by replacing aggregate sub-expressions with
   * variable references to their pre-computed values.
   *
   * For example, given the expression "SUM(?x) / COUNT(?x)" and a mapping
   * { SUM(?x) -> "__agg0", COUNT(?x) -> "__agg1" }, this returns the
   * translated expression "?__agg0 / ?__agg1".
   */
  private transformExpressionWithAggregateVars(
    expr: any,
    aggregateVarMap: Map<any, string>
  ): Expression {
    // Check if this exact expression object has a variable mapping
    if (aggregateVarMap.has(expr)) {
      // Replace aggregate with variable reference
      return {
        type: "variable",
        name: aggregateVarMap.get(expr)!,
      };
    }

    // For operations, recursively transform arguments
    if (expr.type === "operation" && expr.args) {
      const transformedArgs = expr.args.map((arg: any) =>
        this.transformExpressionWithAggregateVars(arg, aggregateVarMap)
      );

      // Determine expression type based on operator
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
    return this.translateExpression(expr);
  }

  private extractGroupVariables(group: any[] | undefined): string[] {
    if (!group) return [];

    return group
      .filter((g: any) => g.expression && g.expression.termType === "Variable")
      .map((g: any) => g.expression.value);
  }

  private translateAggregateExpression(expr: any): AggregateExpression {
    return {
      type: "aggregate",
      aggregation: expr.aggregation.toLowerCase() as AggregateExpression["aggregation"],
      expression: expr.expression ? this.translateExpression(expr.expression) : undefined,
      distinct: expr.distinct || false,
      separator: expr.separator,
    };
  }

  private translateWhere(patterns: any[]): AlgebraOperation {
    if (patterns.length === 0) {
      throw new AlgebraTranslatorError("Empty WHERE clause");
    }

    // Separate FILTER and BIND patterns from other patterns
    // FILTER and BIND apply to the result of other patterns, not joined with them
    const filterPatterns = patterns.filter((p) => p.type === "filter");
    const bindPatterns = patterns.filter((p) => p.type === "bind");
    const otherPatterns = patterns.filter((p) => p.type !== "filter" && p.type !== "bind");

    // First, translate and join all non-filter, non-bind patterns
    let result: AlgebraOperation;

    if (otherPatterns.length === 0) {
      // Only filters/binds with no base patterns - use empty BGP
      result = { type: "bgp", triples: [] } as BGPOperation;
    } else if (otherPatterns.length === 1) {
      result = this.translatePattern(otherPatterns[0]);
    } else {
      const operations = otherPatterns.map((p) => this.translatePattern(p));
      result = operations.reduce((left, right) => ({
        type: "join",
        left,
        right,
      }));
    }

    // Apply BIND operations (they extend solutions with computed values)
    for (const bindPattern of bindPatterns) {
      result = this.translateBind(bindPattern, result);
    }

    // Then, wrap with FILTER operations (they apply to the combined result)
    for (const filterPattern of filterPatterns) {
      result = {
        type: "filter",
        expression: this.translateExpression(filterPattern.expression),
        input: result,
      };
    }

    return result;
  }

  private translatePattern(pattern: any): AlgebraOperation {
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

  private translateBGP(pattern: any): BGPOperation {
    if (!pattern.triples || !Array.isArray(pattern.triples)) {
      throw new AlgebraTranslatorError("BGP pattern must have triples array");
    }

    return {
      type: "bgp",
      triples: pattern.triples.map((t: any) => this.translateTriple(t)),
    };
  }

  private translateTriple(triple: any): Triple {
    if (!triple.subject || !triple.predicate || !triple.object) {
      throw new AlgebraTranslatorError("Triple must have subject, predicate, and object");
    }

    return {
      subject: this.translateTripleElement(triple.subject),
      predicate: this.translatePredicate(triple.predicate),
      object: this.translateTripleElement(triple.object),
    };
  }

  /**
   * Translate a predicate which can be either a simple IRI/Variable or a property path.
   * sparqljs uses type: "path" for property paths, termType for regular terms.
   */
  private translatePredicate(predicate: any): TripleElement | PropertyPath {
    // Check if this is a property path (sparqljs uses type: "path")
    if (predicate.type === "path") {
      return this.translatePropertyPath(predicate);
    }

    // Otherwise it's a regular triple element (IRI, Variable, etc.)
    return this.translateTripleElement(predicate);
  }

  /**
   * Translate a property path expression from sparqljs AST.
   * sparqljs format: { type: "path", pathType: "+"|"*"|"?"|"^"|"/"|"|", items: [...] }
   */
  private translatePropertyPath(path: any): PropertyPath {
    if (!path.pathType) {
      throw new AlgebraTranslatorError("Property path must have pathType");
    }

    if (!path.items || !Array.isArray(path.items)) {
      throw new AlgebraTranslatorError("Property path must have items array");
    }

    const translatedItems = path.items.map((item: any) => this.translatePathItem(item));

    switch (path.pathType) {
      case "/":
        return {
          type: "path",
          pathType: "/",
          items: translatedItems,
        };
      case "|":
        return {
          type: "path",
          pathType: "|",
          items: translatedItems,
        };
      case "^":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("Inverse path must have exactly one item");
        }
        return {
          type: "path",
          pathType: "^",
          items: [translatedItems[0]],
        };
      case "+":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("OneOrMore path must have exactly one item");
        }
        return {
          type: "path",
          pathType: "+",
          items: [translatedItems[0]],
        };
      case "*":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("ZeroOrMore path must have exactly one item");
        }
        return {
          type: "path",
          pathType: "*",
          items: [translatedItems[0]],
        };
      case "?":
        if (translatedItems.length !== 1) {
          throw new AlgebraTranslatorError("ZeroOrOne path must have exactly one item");
        }
        return {
          type: "path",
          pathType: "?",
          items: [translatedItems[0]],
        };
      default:
        throw new AlgebraTranslatorError(`Unsupported property path type: ${path.pathType}`);
    }
  }

  /**
   * Translate a single item in a property path.
   * Can be either an IRI (NamedNode) or a nested path.
   */
  private translatePathItem(item: any): IRI | PropertyPath {
    // Nested property path
    if (item.type === "path") {
      return this.translatePropertyPath(item);
    }

    // IRI (NamedNode)
    if (item.termType === "NamedNode") {
      return {
        type: "iri",
        value: item.value,
      };
    }

    throw new AlgebraTranslatorError(`Unsupported path item type: ${item.type || item.termType}`);
  }

  private translateTripleElement(element: any): TripleElement {
    if (!element || !element.termType) {
      throw new AlgebraTranslatorError("Triple element must have termType");
    }

    switch (element.termType) {
      case "Variable":
        return {
          type: "variable",
          value: element.value,
        };
      case "NamedNode":
        return {
          type: "iri",
          value: element.value,
        };
      case "Literal":
        return {
          type: "literal",
          value: element.value,
          datatype: element.datatype?.value,
          language: element.language,
        };
      case "BlankNode":
        return {
          type: "blank",
          value: element.value,
        };
      default:
        throw new AlgebraTranslatorError(`Unsupported term type: ${element.termType}`);
    }
  }

  private translateFilter(pattern: any): FilterOperation {
    if (!pattern.expression) {
      throw new AlgebraTranslatorError("Filter pattern must have expression");
    }

    const input: AlgebraOperation = pattern.patterns
      ? this.translateWhere(pattern.patterns)
      : ({ type: "bgp", triples: [] } as BGPOperation);

    return {
      type: "filter",
      expression: this.translateExpression(pattern.expression),
      input,
    };
  }

  private translateExpression(expr: any): Expression {
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
        args: expr.args.map((a: any) => this.translateExpression(a)),
      };
    }

    // Handle terms with 'termType' property (variables, literals, IRIs)
    if (expr.termType) {
      return this.translateTermExpression(expr);
    }

    // If neither type nor termType, throw error
    throw new AlgebraTranslatorError(`Unsupported expression structure: ${JSON.stringify(expr)}`);
  }

  private translateOperationExpression(expr: any): Expression {
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
        operands: expr.args.map((a: any) => this.translateExpression(a)),
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
      args: expr.args.map((a: any) => this.translateExpression(a)),
    };
  }

  /**
   * Translate EXISTS or NOT EXISTS expression.
   * sparqljs AST: { type: "operation", operator: "exists"|"notexists", args: [pattern] }
   * The pattern is a graph pattern (BGP, group, etc.) that needs to be evaluated.
   */
  private translateExistsExpression(expr: any): ExistsExpression {
    if (!expr.args || expr.args.length !== 1) {
      throw new AlgebraTranslatorError("EXISTS/NOT EXISTS must have exactly one pattern argument");
    }

    const patternArg = expr.args[0];
    let pattern: AlgebraOperation;

    // Handle group pattern (most common for EXISTS)
    if (patternArg.type === "group" && patternArg.patterns) {
      pattern = this.translateWhere(patternArg.patterns);
    } else if (patternArg.type === "bgp") {
      pattern = this.translateBGP(patternArg);
    } else {
      // Try to translate as a generic pattern
      pattern = this.translatePattern(patternArg);
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
  private translateInExpression(expr: any): InExpression {
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
      list: listArg.map((item: any) => this.translateExpression(item)),
      negated: expr.operator === "notin",
    };
  }

  private translateTermExpression(term: any): Expression {
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

  private translateOptional(pattern: any): LeftJoinOperation {
    if (!pattern.patterns || pattern.patterns.length === 0) {
      throw new AlgebraTranslatorError("OPTIONAL pattern must have patterns");
    }

    return {
      type: "leftjoin",
      left: { type: "bgp", triples: [] },
      right: this.translateWhere(pattern.patterns),
      expression: pattern.expression ? this.translateExpression(pattern.expression) : undefined,
    };
  }

  /**
   * Translate UNION pattern to UnionOperation.
   * Supports n-ary UNION (2 or more branches) by nesting binary unions left-associatively:
   * A UNION B UNION C becomes (A UNION B) UNION C
   *
   * sparqljs AST format: { type: "union", patterns: [...] }
   * Each pattern can be a BGP, group, or other graph pattern.
   */
  private translateUnion(pattern: any): UnionOperation {
    if (!pattern.patterns || pattern.patterns.length < 2) {
      throw new AlgebraTranslatorError("UNION pattern must have at least 2 patterns");
    }

    // Helper to translate a single union branch
    const translateBranch = (branch: any): AlgebraOperation => {
      // If branch is a typed pattern like GRAPH or SERVICE, translate it directly
      // (these have patterns property but should not be unwrapped)
      if (branch.type === "graph") {
        return this.translateGraph(branch);
      }
      if (branch.type === "service") {
        return this.translateService(branch);
      }
      // If branch has nested patterns (group), unwrap them
      if (branch.patterns && Array.isArray(branch.patterns)) {
        return this.translateWhere(branch.patterns);
      }
      // Otherwise treat as a single pattern (BGP, etc.)
      return this.translateWhere([branch]);
    };

    // Build left-associative binary union tree: (((A UNION B) UNION C) UNION D)
    let result: UnionOperation = {
      type: "union",
      left: translateBranch(pattern.patterns[0]),
      right: translateBranch(pattern.patterns[1]),
    };

    // Add remaining branches by nesting
    for (let i = 2; i < pattern.patterns.length; i++) {
      result = {
        type: "union",
        left: result,
        right: translateBranch(pattern.patterns[i]),
      };
    }

    return result;
  }

  /**
   * Translate MINUS pattern to MinusOperation.
   * MINUS removes solutions from the preceding pattern that match the MINUS pattern.
   *
   * sparqljs AST format: { type: "minus", patterns: [...] }
   *
   * The left side of MINUS is implicit - it comes from the preceding patterns
   * in the WHERE clause. AlgebraTranslator handles this via the translateWhere
   * method which processes patterns sequentially.
   */
  private translateMinus(pattern: any): MinusOperation {
    if (!pattern.patterns || pattern.patterns.length === 0) {
      throw new AlgebraTranslatorError("MINUS pattern must have patterns");
    }

    // MINUS patterns from sparqljs contain the right-hand side patterns.
    // The left-hand side is empty here - it gets filled in by translateWhere
    // when joining patterns together.
    return {
      type: "minus",
      left: { type: "bgp", triples: [] },
      right: this.translateWhere(pattern.patterns),
    };
  }

  /**
   * Translate VALUES clause to ValuesOperation.
   * VALUES provides inline data that behaves like a virtual table.
   *
   * sparqljs AST format:
   * ```
   * {
   *   type: "values",
   *   values: [
   *     { "?var1": { termType: "Literal"|"NamedNode", value: "..." }, "?var2": ... },
   *     { "?var1": { termType: "Literal"|"NamedNode", value: "..." }, "?var2": ... },
   *     ...
   *   ]
   * }
   * ```
   *
   * UNDEF is represented by the absence of a variable key in a binding.
   *
   * Example:
   * VALUES ?status { "active" "pending" }
   * becomes:
   * { type: "values", values: [ { "?status": Literal("active") }, { "?status": Literal("pending") } ] }
   */
  private translateValues(pattern: any): ValuesOperation {
    if (!pattern.values || !Array.isArray(pattern.values)) {
      throw new AlgebraTranslatorError("VALUES pattern must have values array");
    }

    // Extract all variable names from the first binding (they use ?prefix in sparqljs)
    const variables: Set<string> = new Set();
    for (const binding of pattern.values) {
      for (const key of Object.keys(binding)) {
        // Remove the ? prefix from variable names
        const varName = key.startsWith("?") ? key.slice(1) : key;
        variables.add(varName);
      }
    }

    // Convert sparqljs bindings to our format
    const bindings: ValuesBinding[] = pattern.values.map((sparqljsBinding: any) =>
      this.translateValuesBinding(sparqljsBinding)
    );

    return {
      type: "values",
      variables: Array.from(variables),
      bindings,
    };
  }

  /**
   * Translate a single VALUES binding row from sparqljs format to our format.
   * sparqljs format: { "?var1": { termType: "...", value: "..." }, ... }
   * Our format: { var1: { type: "iri"|"literal", value: "..." }, ... }
   *
   * UNDEF values are represented by the absence of a key.
   */
  private translateValuesBinding(sparqljsBinding: any): ValuesBinding {
    const binding: ValuesBinding = {};

    for (const [key, term] of Object.entries(sparqljsBinding)) {
      // Remove the ? prefix from variable names
      const varName = key.startsWith("?") ? key.slice(1) : key;
      const termValue = term as any;

      if (termValue.termType === "NamedNode") {
        binding[varName] = {
          type: "iri",
          value: termValue.value,
        } as IRI;
      } else if (termValue.termType === "Literal") {
        binding[varName] = {
          type: "literal",
          value: termValue.value,
          datatype: termValue.datatype?.value,
          language: termValue.language || undefined,
        } as Literal;
      } else {
        throw new AlgebraTranslatorError(`Unsupported VALUES term type: ${termValue.termType}`);
      }
    }

    return binding;
  }

  /**
   * Translate BIND(expression AS ?variable) pattern to extend operation.
   * BIND creates a new binding in each solution by evaluating an expression.
   */
  private translateBind(pattern: any, input: AlgebraOperation): ExtendOperation {
    if (!pattern.variable || !pattern.expression) {
      throw new AlgebraTranslatorError("BIND pattern must have variable and expression");
    }

    return {
      type: "extend",
      variable: pattern.variable.value,
      expression: this.translateExpression(pattern.expression),
      input,
    };
  }

  private translateOrderComparator(order: any): OrderComparator {
    return {
      expression: this.translateExpression(order.expression),
      descending: order.descending || false,
    };
  }

  /**
   * Translate a subquery (nested SELECT) into a SubqueryOperation.
   * A subquery is a complete SELECT query that produces solution mappings
   * which are then joined with the outer query.
   *
   * sparqljs AST format:
   * {
   *   type: "query",
   *   queryType: "SELECT",
   *   variables: [...],
   *   where: [...],
   *   order: [...],
   *   limit: number,
   *   offset: number,
   *   distinct: boolean
   * }
   */
  private translateSubquery(pattern: any): SubqueryOperation {
    if (pattern.queryType !== "SELECT") {
      throw new AlgebraTranslatorError(`Only SELECT subqueries are supported, got: ${pattern.queryType}`);
    }

    // Translate the inner SELECT query using the same translateSelect method
    // This reuses all existing logic for handling variables, WHERE clause,
    // GROUP BY, ORDER BY, LIMIT, OFFSET, DISTINCT, etc.
    const innerQuery = this.translateSelect(pattern as SelectQuery);

    return {
      type: "subquery",
      query: innerQuery,
    };
  }

  /**
   * Translate SERVICE pattern for federated queries.
   *
   * SPARQL 1.1 Federated Query allows querying remote SPARQL endpoints.
   * sparqljs AST format:
   * {
   *   type: "service",
   *   name: { termType: "NamedNode", value: "http://endpoint" },
   *   patterns: [...],
   *   silent: boolean
   * }
   *
   * The SERVICE clause executes the inner pattern against a remote endpoint
   * and joins the results with the local query.
   *
   * SILENT keyword:
   * When silent is true, errors from the remote endpoint are suppressed
   * and an empty result set is returned instead of failing the query.
   */
  private translateService(pattern: any): ServiceOperation {
    if (!pattern.name || pattern.name.termType !== "NamedNode") {
      throw new AlgebraTranslatorError("SERVICE pattern must have a NamedNode endpoint");
    }

    if (!pattern.patterns || !Array.isArray(pattern.patterns)) {
      throw new AlgebraTranslatorError("SERVICE pattern must have patterns array");
    }

    // Translate the inner patterns
    const innerPattern = this.translateWhere(pattern.patterns);

    return {
      type: "service",
      endpoint: pattern.name.value,
      pattern: innerPattern,
      silent: pattern.silent || false,
    };
  }

  /**
   * Translate GRAPH pattern for named graph queries.
   *
   * SPARQL 1.1 allows querying specific named graphs within a dataset.
   * sparqljs AST format:
   * {
   *   type: "graph",
   *   name: { termType: "NamedNode" | "Variable", value: "..." },
   *   patterns: [...]
   * }
   *
   * The GRAPH clause restricts pattern matching to a specific named graph.
   * The graph name can be:
   * - A concrete IRI (NamedNode): GRAPH <http://example.org/g1> { ... }
   * - A variable: GRAPH ?g { ... } (matches all named graphs, binding ?g)
   *
   * SPARQL 1.1 spec Section 13.3:
   * https://www.w3.org/TR/sparql11-query/#queryDataset
   */
  private translateGraph(pattern: any): GraphOperation {
    if (!pattern.name) {
      throw new AlgebraTranslatorError("GRAPH pattern must have a name (IRI or variable)");
    }

    if (!pattern.patterns || !Array.isArray(pattern.patterns)) {
      throw new AlgebraTranslatorError("GRAPH pattern must have patterns array");
    }

    // Translate the graph name (can be IRI or Variable)
    let name: IRI | Variable;
    if (pattern.name.termType === "NamedNode") {
      name = {
        type: "iri",
        value: pattern.name.value,
      };
    } else if (pattern.name.termType === "Variable") {
      name = {
        type: "variable",
        value: pattern.name.value,
      };
    } else {
      throw new AlgebraTranslatorError(
        `GRAPH pattern name must be NamedNode or Variable, got: ${pattern.name.termType}`
      );
    }

    // Translate the inner patterns
    const innerPattern = this.translateWhere(pattern.patterns);

    return {
      type: "graph",
      name,
      pattern: innerPattern,
    };
  }
}
