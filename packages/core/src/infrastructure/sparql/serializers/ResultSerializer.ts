import { Literal } from "../../../domain/models/rdf/Literal";
import { IRI } from "../../../domain/models/rdf/IRI";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import type { SolutionMapping } from "../SolutionMapping";
import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";

/**
 * Output formats supported for SPARQL query results.
 */
export type ResultOutputFormat = "json" | "xml" | "csv" | "turtle";

/**
 * Options for result serialization.
 */
export interface ResultSerializeOptions {
  /** Variables to include in output (defaults to all) */
  variables?: string[];
  /** Pretty print output (for JSON format) */
  pretty?: boolean;
  /** Indentation level (for JSON format, default: 2) */
  indent?: number;
}

/**
 * JSON representation of a SPARQL result binding value.
 * Based on SPARQL 1.1 Query Results JSON Format.
 * Extended with SPARQL 1.2 direction support.
 *
 * @see https://www.w3.org/TR/sparql11-results-json/
 * @see https://w3c.github.io/rdf-dir-literal/
 */
export interface JSONResultBinding {
  type: "uri" | "literal" | "bnode";
  value: string;
  datatype?: string;
  "xml:lang"?: string;
  /** SPARQL 1.2: Base direction for bidirectional text */
  direction?: "ltr" | "rtl";
}

/**
 * JSON representation of SPARQL query results.
 */
export interface JSONResultSet {
  head: {
    vars: string[];
  };
  results: {
    bindings: Array<Record<string, JSONResultBinding>>;
  };
}

/**
 * Serializes SPARQL query results (SolutionMappings) to various output formats.
 *
 * Supports directional literals (SPARQL 1.2) in all output formats:
 * - JSON: Includes "direction" property in binding objects
 * - Turtle: Uses @lang--dir syntax
 * - CSV: Includes direction as part of language tag
 * - XML: Includes xml:dir attribute (future extension)
 *
 * @example
 * ```typescript
 * const serializer = new ResultSerializer();
 *
 * // Serialize to JSON
 * const json = serializer.serialize(solutions, "json", { pretty: true });
 *
 * // Serialize to Turtle
 * const turtle = serializer.serialize(solutions, "turtle");
 * ```
 */
export class ResultSerializer {
  /**
   * Serialize solution mappings to the specified format.
   *
   * @param solutions - Array of solution mappings from query execution
   * @param format - Output format (json, xml, csv, turtle)
   * @param options - Serialization options
   * @returns Serialized string representation
   */
  serialize(
    solutions: SolutionMapping[],
    format: ResultOutputFormat,
    options: ResultSerializeOptions = {}
  ): string {
    switch (format) {
      case "json":
        return this.serializeJSON(solutions, options);
      case "xml":
        return this.serializeXML(solutions, options);
      case "csv":
        return this.serializeCSV(solutions, options);
      case "turtle":
        return this.serializeTurtle(solutions, options);
      default:
        throw new Error(`Unsupported result format: ${format}`);
    }
  }

  /**
   * Serialize to SPARQL 1.1 Query Results JSON Format.
   * Extended with SPARQL 1.2 direction support for directional literals.
   *
   * @see https://www.w3.org/TR/sparql11-results-json/
   */
  serializeJSON(
    solutions: SolutionMapping[],
    options: ResultSerializeOptions = {}
  ): string {
    const resultSet = this.toJSONResultSet(solutions, options);
    const indent = options.pretty ? (options.indent ?? 2) : undefined;
    return JSON.stringify(resultSet, null, indent);
  }

  /**
   * Convert solutions to JSON result set structure.
   */
  toJSONResultSet(
    solutions: SolutionMapping[],
    options: ResultSerializeOptions = {}
  ): JSONResultSet {
    // Collect all variables across all solutions
    const allVariables = new Set<string>();
    for (const solution of solutions) {
      for (const varName of solution.variables()) {
        allVariables.add(varName);
      }
    }

    // Use specified variables or all found variables
    const vars = options.variables ?? Array.from(allVariables).sort();

    // Convert each solution to a binding object
    const bindings = solutions.map((solution) => {
      const binding: Record<string, JSONResultBinding> = {};

      for (const varName of vars) {
        const term = solution.get(varName);
        if (term !== undefined) {
          binding[varName] = this.termToJSONBinding(term);
        }
      }

      return binding;
    });

    return {
      head: { vars },
      results: { bindings },
    };
  }

  /**
   * Convert an RDF term to a JSON result binding.
   * Includes direction property for directional literals (SPARQL 1.2).
   */
  termToJSONBinding(term: Subject | Predicate | RDFObject): JSONResultBinding {
    if (term instanceof IRI) {
      return {
        type: "uri",
        value: term.value,
      };
    }

    if (term instanceof BlankNode) {
      return {
        type: "bnode",
        value: term.id,
      };
    }

    if (term instanceof Literal) {
      return this.literalToJSONBinding(term);
    }

    // Fallback for unknown term types
    return {
      type: "literal",
      value: String(term),
    };
  }

  /**
   * Convert a Literal to a JSON result binding.
   * Handles directional literals by including the direction property.
   *
   * @example
   * // Regular literal
   * { type: "literal", value: "Hello" }
   *
   * // Language-tagged literal
   * { type: "literal", value: "Hello", "xml:lang": "en" }
   *
   * // Directional literal (SPARQL 1.2)
   * { type: "literal", value: "مرحبا", "xml:lang": "ar", direction: "rtl" }
   */
  literalToJSONBinding(literal: Literal): JSONResultBinding {
    const binding: JSONResultBinding = {
      type: "literal",
      value: literal.value,
    };

    if (literal.datatype) {
      binding.datatype = literal.datatype.value;
    } else if (literal.language) {
      binding["xml:lang"] = literal.language;

      // SPARQL 1.2: Include direction for directional literals
      if (literal.hasDirection() && literal.direction) {
        binding.direction = literal.direction;
      }
    }

    return binding;
  }

  /**
   * Serialize to SPARQL 1.1 Query Results XML Format.
   * Extended with direction attribute for directional literals.
   *
   * @see https://www.w3.org/TR/rdf-sparql-XMLres/
   */
  serializeXML(
    solutions: SolutionMapping[],
    options: ResultSerializeOptions = {}
  ): string {
    // Collect all variables
    const allVariables = new Set<string>();
    for (const solution of solutions) {
      for (const varName of solution.variables()) {
        allVariables.add(varName);
      }
    }

    const vars = options.variables ?? Array.from(allVariables).sort();

    const lines: string[] = [
      '<?xml version="1.0"?>',
      '<sparql xmlns="http://www.w3.org/2005/sparql-results#">',
      "  <head>",
    ];

    for (const varName of vars) {
      lines.push(`    <variable name="${this.escapeXML(varName)}"/>`);
    }

    lines.push("  </head>");
    lines.push("  <results>");

    for (const solution of solutions) {
      lines.push("    <result>");

      for (const varName of vars) {
        const term = solution.get(varName);
        if (term !== undefined) {
          lines.push(`      <binding name="${this.escapeXML(varName)}">`);
          lines.push("        " + this.termToXML(term));
          lines.push("      </binding>");
        }
      }

      lines.push("    </result>");
    }

    lines.push("  </results>");
    lines.push("</sparql>");

    return lines.join("\n");
  }

  /**
   * Convert an RDF term to XML representation.
   */
  termToXML(term: Subject | Predicate | RDFObject): string {
    if (term instanceof IRI) {
      return `<uri>${this.escapeXML(term.value)}</uri>`;
    }

    if (term instanceof BlankNode) {
      return `<bnode>${this.escapeXML(term.id)}</bnode>`;
    }

    if (term instanceof Literal) {
      return this.literalToXML(term);
    }

    return `<literal>${this.escapeXML(String(term))}</literal>`;
  }

  /**
   * Convert a Literal to XML representation.
   * Includes direction attribute for directional literals.
   */
  literalToXML(literal: Literal): string {
    const escapedValue = this.escapeXML(literal.value);

    if (literal.datatype) {
      return `<literal datatype="${this.escapeXML(literal.datatype.value)}">${escapedValue}</literal>`;
    }

    if (literal.language) {
      let attrs = `xml:lang="${this.escapeXML(literal.language)}"`;

      // SPARQL 1.2: Include direction for directional literals
      if (literal.hasDirection() && literal.direction) {
        attrs += ` direction="${literal.direction}"`;
      }

      return `<literal ${attrs}>${escapedValue}</literal>`;
    }

    return `<literal>${escapedValue}</literal>`;
  }

  /**
   * Serialize to CSV format.
   * Direction is encoded as part of the language tag (lang--dir).
   */
  serializeCSV(
    solutions: SolutionMapping[],
    options: ResultSerializeOptions = {}
  ): string {
    // Collect all variables
    const allVariables = new Set<string>();
    for (const solution of solutions) {
      for (const varName of solution.variables()) {
        allVariables.add(varName);
      }
    }

    const vars = options.variables ?? Array.from(allVariables).sort();

    const lines: string[] = [];

    // Header row
    lines.push(vars.map((v) => this.escapeCSV(v)).join(","));

    // Data rows
    for (const solution of solutions) {
      const row = vars.map((varName) => {
        const term = solution.get(varName);
        if (term === undefined) {
          return "";
        }
        return this.escapeCSV(this.termToCSV(term));
      });
      lines.push(row.join(","));
    }

    return lines.join("\n");
  }

  /**
   * Convert an RDF term to CSV value.
   */
  termToCSV(term: Subject | Predicate | RDFObject): string {
    if (term instanceof IRI) {
      return term.value;
    }

    if (term instanceof BlankNode) {
      return `_:${term.id}`;
    }

    if (term instanceof Literal) {
      return this.literalToCSV(term);
    }

    return String(term);
  }

  /**
   * Convert a Literal to CSV value.
   * Uses Turtle-style serialization for language tags and direction.
   */
  literalToCSV(literal: Literal): string {
    if (literal.datatype) {
      return `${literal.value}^^<${literal.datatype.value}>`;
    }

    if (literal.language) {
      let tag = literal.language;
      // Include direction in lang tag for directional literals
      if (literal.hasDirection() && literal.direction) {
        tag += `--${literal.direction}`;
      }
      return `${literal.value}@${tag}`;
    }

    return literal.value;
  }

  /**
   * Serialize to Turtle-like format.
   * Uses @lang--dir syntax for directional literals.
   */
  serializeTurtle(
    solutions: SolutionMapping[],
    options: ResultSerializeOptions = {}
  ): string {
    // Collect all variables
    const allVariables = new Set<string>();
    for (const solution of solutions) {
      for (const varName of solution.variables()) {
        allVariables.add(varName);
      }
    }

    const vars = options.variables ?? Array.from(allVariables).sort();

    const lines: string[] = [];

    // Header comment
    lines.push(`# SPARQL Results - ${solutions.length} solution(s)`);
    lines.push(`# Variables: ${vars.join(", ")}`);
    lines.push("");

    for (let i = 0; i < solutions.length; i++) {
      const solution = solutions[i];
      lines.push(`# Solution ${i + 1}`);

      for (const varName of vars) {
        const term = solution.get(varName);
        if (term !== undefined) {
          lines.push(`?${varName} = ${this.termToTurtle(term)}`);
        }
      }

      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }

  /**
   * Convert an RDF term to Turtle representation.
   */
  termToTurtle(term: Subject | Predicate | RDFObject): string {
    if (term instanceof IRI) {
      return `<${term.value}>`;
    }

    if (term instanceof BlankNode) {
      return `_:${term.id}`;
    }

    if (term instanceof Literal) {
      // Literal.toString() already handles directional literals correctly
      return term.toString();
    }

    return `"${String(term)}"`;
  }

  /**
   * Escape a string for XML output.
   */
  private escapeXML(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Escape a value for CSV output.
   */
  private escapeCSV(str: string): string {
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}
