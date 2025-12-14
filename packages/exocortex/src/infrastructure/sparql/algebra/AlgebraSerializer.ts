import type { AlgebraOperation, Expression, Triple, TripleElement, PropertyPath } from "./AlgebraOperation";

export class AlgebraSerializer {
  toString(operation: AlgebraOperation, indent: number = 0): string {
    const prefix = "  ".repeat(indent);

    switch (operation.type) {
      case "bgp":
        return `${prefix}BGP [\n${operation.triples.map((t) => `${prefix}  ${this.tripleToString(t)}`).join("\n")}\n${prefix}]`;

      case "filter":
        return `${prefix}Filter(\n${prefix}  ${this.expressionToString(operation.expression)}\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "join":
        return `${prefix}Join(\n${this.toString(operation.left, indent + 1)}\n${this.toString(operation.right, indent + 1)}\n${prefix})`;

      case "leftjoin":
        const exprStr = operation.expression ? ` ${this.expressionToString(operation.expression)}` : "";
        return `${prefix}LeftJoin(${exprStr}\n${this.toString(operation.left, indent + 1)}\n${this.toString(operation.right, indent + 1)}\n${prefix})`;

      case "union":
        return `${prefix}Union(\n${this.toString(operation.left, indent + 1)}\n${this.toString(operation.right, indent + 1)}\n${prefix})`;

      case "minus":
        return `${prefix}Minus(\n${this.toString(operation.left, indent + 1)}\n${this.toString(operation.right, indent + 1)}\n${prefix})`;

      case "project":
        return `${prefix}Project [${operation.variables.map((v) => `?${v}`).join(", ")}](\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "orderby":
        const comparators = operation.comparators
          .map((c) => `${this.expressionToString(c.expression)} ${c.descending ? "DESC" : "ASC"}`)
          .join(", ");
        return `${prefix}OrderBy [${comparators}](\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "slice":
        const limits = [];
        if (operation.offset !== undefined) limits.push(`OFFSET ${operation.offset}`);
        if (operation.limit !== undefined) limits.push(`LIMIT ${operation.limit}`);
        return `${prefix}Slice [${limits.join(", ")}](\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "distinct":
        return `${prefix}Distinct(\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "group":
        const groupVars = operation.variables.length > 0 ? `[${operation.variables.map((v) => `?${v}`).join(", ")}]` : "[]";
        const aggs = operation.aggregates.length > 0
          ? operation.aggregates.map((a) => `?${a.variable} = ${a.expression.aggregation}(${a.expression.distinct ? "DISTINCT " : ""}${a.expression.expression ? this.expressionToString(a.expression.expression) : "*"})`).join(", ")
          : "";
        return `${prefix}Group ${groupVars}${aggs ? ` [${aggs}]` : ""}(\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "extend":
        return `${prefix}Extend (?${operation.variable} = ${this.expressionToString(operation.expression as any)})(\n${this.toString(operation.input, indent + 1)}\n${prefix})`;

      case "subquery":
        return `${prefix}Subquery(\n${this.toString(operation.query, indent + 1)}\n${prefix})`;

      default:
        return `${prefix}Unknown(${(operation as any).type})`;
    }
  }

  private tripleToString(triple: Triple): string {
    return `${this.elementToString(triple.subject)} ${this.predicateToString(triple.predicate)} ${this.elementToString(triple.object)}`;
  }

  private predicateToString(predicate: TripleElement | PropertyPath): string {
    if (this.isPropertyPath(predicate)) {
      return this.propertyPathToString(predicate);
    }
    return this.elementToString(predicate);
  }

  private isPropertyPath(element: TripleElement | PropertyPath): element is PropertyPath {
    return element.type === "path";
  }

  private propertyPathToString(path: PropertyPath): string {
    const items = path.items.map((item) => {
      if (item.type === "path") {
        return `(${this.propertyPathToString(item)})`;
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

  private elementToString(element: TripleElement): string {
    switch (element.type) {
      case "variable":
        return `?${element.value}`;
      case "iri":
        return `<${element.value}>`;
      case "literal":
        let str = `"${element.value}"`;
        if (element.language) str += `@${element.language}`;
        if (element.datatype) str += `^^<${element.datatype}>`;
        return str;
      case "blank":
        return `_:${element.value}`;
      default:
        return String(element);
    }
  }

  private expressionToString(expr: Expression): string {
    switch (expr.type) {
      case "variable":
        return `?${expr.name}`;

      case "literal":
        return typeof expr.value === "string" ? `"${expr.value}"` : String(expr.value);

      case "comparison":
        return `(${this.expressionToString(expr.left)} ${expr.operator} ${this.expressionToString(expr.right)})`;

      case "logical":
        if (expr.operator === "!") {
          return `!(${this.expressionToString(expr.operands[0])})`;
        }
        return `(${expr.operands.map((o) => this.expressionToString(o)).join(` ${expr.operator} `)})`;

      case "arithmetic":
        return `(${this.expressionToString(expr.left)} ${expr.operator} ${this.expressionToString(expr.right)})`;

      case "function":
        return `${expr.function}(${expr.args.map((a) => this.expressionToString(a)).join(", ")})`;

      case "exists":
        return `${expr.negated ? "NOT EXISTS" : "EXISTS"} { ${this.toString(expr.pattern, 0)} }`;

      default:
        return "unknown";
    }
  }

  toJSON(operation: AlgebraOperation): string {
    return JSON.stringify(operation, null, 2);
  }
}
