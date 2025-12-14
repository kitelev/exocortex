import type {
  AlgebraOperation,
  BGPOperation,
  ValuesOperation,
  Expression,
  Triple,
  TripleElement,
  PropertyPath,
  IRI,
  Literal,
} from "./AlgebraOperation";

export class SPARQLGeneratorError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "SPARQLGeneratorError";
  }
}

/**
 * Generates SPARQL query strings from algebra operations.
 *
 * This is used by the ServiceExecutor to convert inner patterns
 * of SERVICE clauses back to SPARQL syntax for remote execution.
 *
 * Unlike AlgebraSerializer (which produces debug output), this generator
 * produces valid SPARQL queries that can be executed by remote endpoints.
 */
export class SPARQLGenerator {
  /**
   * Collect all variables used in an algebra operation.
   * Used to generate SELECT variable list.
   */
  collectVariables(operation: AlgebraOperation): Set<string> {
    const variables = new Set<string>();
    this.collectVariablesFromOperation(operation, variables);
    return variables;
  }

  /**
   * Generate a SELECT query from an algebra operation.
   * This is the main entry point for SERVICE clause pattern generation.
   *
   * @param operation - The algebra operation to convert
   * @returns A valid SPARQL SELECT query string
   */
  generateSelect(operation: AlgebraOperation): string {
    const variables = this.collectVariables(operation);
    const varList = variables.size > 0
      ? Array.from(variables).map((v) => `?${v}`).join(" ")
      : "*";

    const whereClause = this.generateWhereClause(operation);

    return `SELECT ${varList} WHERE {\n${whereClause}\n}`;
  }

  /**
   * Generate WHERE clause body from an algebra operation.
   */
  private generateWhereClause(operation: AlgebraOperation, indent: number = 2): string {
    const pad = " ".repeat(indent);

    switch (operation.type) {
      case "bgp":
        return this.generateBGP(operation, indent);

      case "filter":
        return `${this.generateWhereClause(operation.input, indent)}\n${pad}FILTER(${this.generateExpression(operation.expression)})`;

      case "join":
        return `${this.generateWhereClause(operation.left, indent)}\n${this.generateWhereClause(operation.right, indent)}`;

      case "leftjoin": {
        const left = this.generateWhereClause(operation.left, indent);
        const right = this.generateWhereClause(operation.right, indent + 2);
        return `${left}\n${pad}OPTIONAL {\n${right}\n${pad}}`;
      }

      case "union": {
        const left = this.generateWhereClause(operation.left, indent + 2);
        const right = this.generateWhereClause(operation.right, indent + 2);
        return `${pad}{\n${left}\n${pad}}\n${pad}UNION\n${pad}{\n${right}\n${pad}}`;
      }

      case "values":
        return this.generateValues(operation, indent);

      case "extend": {
        const inputClause = this.generateWhereClause(operation.input, indent);
        const expr = this.generateExpression(operation.expression as Expression);
        return `${inputClause}\n${pad}BIND(${expr} AS ?${operation.variable})`;
      }

      case "project":
      case "distinct":
      case "reduced":
        // These are handled at the outer SELECT level
        return this.generateWhereClause(operation.input, indent);

      case "orderby":
      case "slice":
      case "group":
        // These modifiers aren't typically used in SERVICE inner patterns
        // but we support input extraction
        return this.generateWhereClause(operation.input, indent);

      case "subquery": {
        const innerQuery = this.generateSelect(operation.query);
        const indentedQuery = innerQuery.split("\n").map((line) => pad + line).join("\n");
        return `${pad}{\n${indentedQuery}\n${pad}}`;
      }

      default:
        throw new SPARQLGeneratorError(`Unsupported operation type for SPARQL generation: ${(operation as any).type}`);
    }
  }

  /**
   * Generate triple patterns from a BGP operation.
   */
  private generateBGP(operation: BGPOperation, indent: number): string {
    const pad = " ".repeat(indent);
    return operation.triples
      .map((t) => `${pad}${this.generateTriple(t)} .`)
      .join("\n");
  }

  /**
   * Generate a single triple pattern.
   */
  private generateTriple(triple: Triple): string {
    const subject = this.generateElement(triple.subject);
    const predicate = this.generatePredicate(triple.predicate);
    const object = this.generateElement(triple.object);
    return `${subject} ${predicate} ${object}`;
  }

  /**
   * Generate predicate (may be IRI or property path).
   */
  private generatePredicate(predicate: TripleElement | PropertyPath): string {
    if ("pathType" in predicate) {
      return this.generatePropertyPath(predicate);
    }
    return this.generateElement(predicate);
  }

  /**
   * Generate property path expression.
   */
  private generatePropertyPath(path: PropertyPath): string {
    const items = path.items.map((item) => {
      if ("pathType" in item) {
        return `(${this.generatePropertyPath(item)})`;
      }
      return `<${item.value}>`;
    });

    switch (path.pathType) {
      case "/":
        return items.join("/");
      case "|":
        return items.join("|");
      case "^":
        return `^${items[0]}`;
      case "+":
        return `${items[0]}+`;
      case "*":
        return `${items[0]}*`;
      case "?":
        return `${items[0]}?`;
    }
  }

  /**
   * Generate a triple element (variable, IRI, literal, or blank node).
   */
  private generateElement(element: TripleElement): string {
    switch (element.type) {
      case "variable":
        return `?${element.value}`;

      case "iri":
        return `<${element.value}>`;

      case "literal": {
        // Escape special characters in literal value
        const escapedValue = element.value
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t");

        let str = `"${escapedValue}"`;
        if (element.language) {
          str += `@${element.language}`;
        } else if (element.datatype) {
          str += `^^<${element.datatype}>`;
        }
        return str;
      }

      case "blank":
        return `_:${element.value}`;

      default:
        throw new SPARQLGeneratorError(`Unknown element type: ${(element as any).type}`);
    }
  }

  /**
   * Generate VALUES clause.
   */
  private generateValues(operation: ValuesOperation, indent: number): string {
    const pad = " ".repeat(indent);

    if (operation.variables.length === 0 || operation.bindings.length === 0) {
      return "";
    }

    if (operation.variables.length === 1) {
      // Single variable syntax: VALUES ?var { "val1" "val2" }
      const varName = operation.variables[0];
      const values = operation.bindings
        .map((b) => {
          const val = b[varName];
          return val ? this.generateValuesTerm(val) : "UNDEF";
        })
        .join(" ");
      return `${pad}VALUES ?${varName} { ${values} }`;
    }

    // Multi-variable syntax: VALUES (?var1 ?var2) { ("v1" "v2") }
    const varList = operation.variables.map((v) => `?${v}`).join(" ");
    const rows = operation.bindings.map((b) => {
      const values = operation.variables.map((v) => {
        const val = b[v];
        return val ? this.generateValuesTerm(val) : "UNDEF";
      });
      return `(${values.join(" ")})`;
    });
    return `${pad}VALUES (${varList}) {\n${rows.map((r) => `${pad}  ${r}`).join("\n")}\n${pad}}`;
  }

  /**
   * Generate a term for VALUES clause.
   */
  private generateValuesTerm(term: IRI | Literal): string {
    if (term.type === "iri") {
      return `<${term.value}>`;
    }

    // Literal
    const escapedValue = term.value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    let str = `"${escapedValue}"`;
    if (term.language) {
      str += `@${term.language}`;
    } else if (term.datatype) {
      str += `^^<${term.datatype}>`;
    }
    return str;
  }

  /**
   * Generate a filter expression.
   */
  private generateExpression(expr: Expression): string {
    switch (expr.type) {
      case "variable":
        return `?${expr.name}`;

      case "literal":
        if (typeof expr.value === "string") {
          const escaped = expr.value
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
          return `"${escaped}"`;
        }
        if (typeof expr.value === "boolean") {
          return expr.value ? "true" : "false";
        }
        return String(expr.value);

      case "comparison":
        return `(${this.generateExpression(expr.left)} ${expr.operator} ${this.generateExpression(expr.right)})`;

      case "logical":
        if (expr.operator === "!") {
          return `!(${this.generateExpression(expr.operands[0])})`;
        }
        return `(${expr.operands.map((o) => this.generateExpression(o)).join(` ${expr.operator} `)})`;

      case "arithmetic":
        return `(${this.generateExpression(expr.left)} ${expr.operator} ${this.generateExpression(expr.right)})`;

      case "function":
        return `${expr.function.toUpperCase()}(${expr.args.map((a) => this.generateExpression(a)).join(", ")})`;

      case "functionCall": {
        const funcName = typeof expr.function === "string"
          ? expr.function
          : expr.function.value;
        return `${funcName.toUpperCase()}(${expr.args.map((a) => this.generateExpression(a)).join(", ")})`;
      }

      case "exists":
        return `${expr.negated ? "NOT EXISTS" : "EXISTS"} { ${this.generateWhereClause(expr.pattern, 0)} }`;

      case "in": {
        const testExpr = this.generateExpression(expr.expression);
        const list = expr.list.map((item) => this.generateExpression(item)).join(", ");
        return expr.negated
          ? `${testExpr} NOT IN (${list})`
          : `${testExpr} IN (${list})`;
      }

      default:
        throw new SPARQLGeneratorError(`Unknown expression type: ${(expr as any).type}`);
    }
  }

  /**
   * Recursively collect variables from an operation.
   */
  private collectVariablesFromOperation(operation: AlgebraOperation, variables: Set<string>): void {
    switch (operation.type) {
      case "bgp":
        for (const triple of operation.triples) {
          this.collectVariablesFromTriple(triple, variables);
        }
        break;

      case "filter":
        this.collectVariablesFromOperation(operation.input, variables);
        this.collectVariablesFromExpression(operation.expression, variables);
        break;

      case "join":
      case "leftjoin":
      case "union":
      case "minus":
        this.collectVariablesFromOperation(operation.left, variables);
        this.collectVariablesFromOperation(operation.right, variables);
        break;

      case "values":
        for (const varName of operation.variables) {
          variables.add(varName);
        }
        break;

      case "project":
        for (const varName of operation.variables) {
          variables.add(varName);
        }
        this.collectVariablesFromOperation(operation.input, variables);
        break;

      case "extend":
        variables.add(operation.variable);
        this.collectVariablesFromOperation(operation.input, variables);
        break;

      case "orderby":
      case "slice":
      case "distinct":
      case "reduced":
        this.collectVariablesFromOperation(operation.input, variables);
        break;

      case "group":
        for (const varName of operation.variables) {
          variables.add(varName);
        }
        for (const agg of operation.aggregates) {
          variables.add(agg.variable);
        }
        this.collectVariablesFromOperation(operation.input, variables);
        break;

      case "subquery":
        this.collectVariablesFromOperation(operation.query, variables);
        break;
    }
  }

  /**
   * Collect variables from a triple.
   */
  private collectVariablesFromTriple(triple: Triple, variables: Set<string>): void {
    if (triple.subject.type === "variable") {
      variables.add(triple.subject.value);
    }
    if ("type" in triple.predicate && triple.predicate.type === "variable") {
      variables.add(triple.predicate.value);
    }
    if (triple.object.type === "variable") {
      variables.add(triple.object.value);
    }
  }

  /**
   * Collect variables from an expression.
   */
  private collectVariablesFromExpression(expr: Expression, variables: Set<string>): void {
    switch (expr.type) {
      case "variable":
        variables.add(expr.name);
        break;

      case "comparison":
      case "arithmetic":
        this.collectVariablesFromExpression(expr.left, variables);
        this.collectVariablesFromExpression(expr.right, variables);
        break;

      case "logical":
        for (const operand of expr.operands) {
          this.collectVariablesFromExpression(operand, variables);
        }
        break;

      case "function":
      case "functionCall":
        for (const arg of expr.args) {
          this.collectVariablesFromExpression(arg, variables);
        }
        break;

      case "exists":
        this.collectVariablesFromOperation(expr.pattern, variables);
        break;

      case "in":
        this.collectVariablesFromExpression(expr.expression, variables);
        for (const item of expr.list) {
          this.collectVariablesFromExpression(item, variables);
        }
        break;
    }
  }
}
