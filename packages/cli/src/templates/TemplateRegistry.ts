/**
 * SPARQL Query Templates Library
 *
 * Provides reusable SPARQL query templates with parameter substitution
 * for common use cases, reducing repetitive queries and errors.
 *
 * @module templates/TemplateRegistry
 */

/**
 * Custom error thrown when a template is not found.
 */
export class TemplateNotFoundError extends Error {
  constructor(templateName: string) {
    super(`Template not found: "${templateName}". Use --list-templates to see available templates.`);
    this.name = "TemplateNotFoundError";
  }
}

/**
 * Custom error thrown when an invalid parameter is provided.
 */
export class InvalidParameterError extends Error {
  constructor(paramName: string, templateName: string, validParams: string[]) {
    super(
      `Invalid parameter "${paramName}" for template "${templateName}". ` +
      `Valid parameters: ${validParams.length > 0 ? validParams.join(", ") : "none"}`
    );
    this.name = "InvalidParameterError";
  }
}

/**
 * Custom error thrown when a required parameter is missing.
 */
export class MissingParameterError extends Error {
  constructor(missingParams: string[], templateName: string) {
    super(
      `Missing required parameter(s) for template "${templateName}": ${missingParams.join(", ")}. ` +
      `Use --param to provide values.`
    );
    this.name = "MissingParameterError";
  }
}

/**
 * Custom error thrown when parameter string format is invalid.
 */
export class InvalidParamFormatError extends Error {
  constructor(paramString: string) {
    super(
      `Invalid parameter format: "${paramString}". ` +
      `Use format: key=value or key1=value1,key2=value2`
    );
    this.name = "InvalidParamFormatError";
  }
}

/**
 * Template definition with metadata.
 */
export interface QueryTemplate {
  /** Unique template name (e.g., "tasks-by-date") */
  name: string;
  /** Human-readable description */
  description: string;
  /** SPARQL query with {{param}} placeholders */
  query: string;
  /** List of parameter names used in the query */
  parameters: string[];
  /** Optional examples of parameter values */
  examples?: Record<string, string>;
}

/**
 * Validation result for parameter checking.
 */
export interface ParameterValidation {
  valid: boolean;
  missing: string[];
  unknown: string[];
}

/**
 * Built-in MVP templates for common SPARQL queries.
 */
const BUILTIN_TEMPLATES: QueryTemplate[] = [
  {
    name: "tasks-by-date",
    description: "Find tasks scheduled for a specific date",
    query: `PREFIX ems: <http://example.org/ems#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?task ?label ?status WHERE {
  ?task a ems:Task ;
        rdfs:label ?label .
  OPTIONAL { ?task ems:Effort_status ?status }
  ?task ems:Effort_plannedStartTimestamp ?start .
  FILTER(STRSTARTS(STR(?start), "{{date}}"))
}
ORDER BY ?start`,
    parameters: ["date"],
    examples: { date: "2024-01-15" },
  },
  {
    name: "tasks-by-status",
    description: "Find tasks with a specific effort status",
    query: `PREFIX ems: <http://example.org/ems#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?task ?label ?status WHERE {
  ?task a ems:Task ;
        rdfs:label ?label ;
        ems:Effort_status ?statusNode .
  ?statusNode rdfs:label ?status .
  FILTER(STR(?status) = "{{status}}")
}
ORDER BY ?label`,
    parameters: ["status"],
    examples: { status: "Done" },
  },
  {
    name: "projects-active",
    description: "List all active projects (not completed)",
    query: `PREFIX ems: <http://example.org/ems#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?project ?label ?status WHERE {
  ?project a ems:Project ;
           rdfs:label ?label .
  OPTIONAL {
    ?project ems:Effort_status ?statusNode .
    ?statusNode rdfs:label ?status .
  }
  FILTER(!BOUND(?status) || ?status != "Done")
}
ORDER BY ?label`,
    parameters: [],
    examples: {},
  },
  {
    name: "concepts-by-domain",
    description: "Find concepts in a specific domain",
    query: `PREFIX ims: <http://example.org/ims#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?concept ?label ?description WHERE {
  ?concept a ims:Concept ;
           rdfs:label ?label .
  OPTIONAL { ?concept rdfs:comment ?description }
  ?concept ims:Concept_domain ?domainNode .
  ?domainNode rdfs:label ?domain .
  FILTER(CONTAINS(LCASE(STR(?domain)), LCASE("{{domain}}")))
}
ORDER BY ?label`,
    parameters: ["domain"],
    examples: { domain: "Software Engineering" },
  },
  {
    name: "sleep-analysis",
    description: "Analyze sleep patterns from task records",
    query: `PREFIX ems: <http://example.org/ems#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?task ?label ?start ?end WHERE {
  ?task a ems:Task ;
        rdfs:label ?label .
  FILTER(CONTAINS(LCASE(STR(?label)), "sleep") || CONTAINS(LCASE(STR(?label)), "сон"))
  OPTIONAL { ?task ems:Effort_startTimestamp ?start }
  OPTIONAL { ?task ems:Effort_endTimestamp ?end }
}
ORDER BY DESC(?start)
LIMIT 30`,
    parameters: [],
    examples: {},
  },
];

/**
 * Registry for SPARQL query templates with parameter substitution.
 *
 * Provides methods to list, retrieve, validate, and apply templates
 * with safe parameter injection.
 */
export class TemplateRegistry {
  private templates: Map<string, QueryTemplate>;

  constructor() {
    this.templates = new Map();
    // Load built-in templates
    for (const template of BUILTIN_TEMPLATES) {
      this.templates.set(template.name, template);
    }
  }

  /**
   * List all available templates.
   * @returns Array of template metadata
   */
  listTemplates(): QueryTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get a template by name.
   * @param name Template name
   * @returns Template definition
   * @throws TemplateNotFoundError if template doesn't exist
   */
  getTemplate(name: string): QueryTemplate {
    const template = this.templates.get(name);
    if (!template) {
      throw new TemplateNotFoundError(name);
    }
    return template;
  }

  /**
   * Apply parameter substitution to a template.
   * @param name Template name
   * @param params Parameter values to substitute
   * @returns SPARQL query with substituted values
   * @throws TemplateNotFoundError if template doesn't exist
   * @throws MissingParameterError if required parameters are missing
   * @throws InvalidParameterError if unknown parameters are provided
   */
  applyTemplate(name: string, params: Record<string, string>): string {
    const template = this.getTemplate(name);
    const validation = this.validateParameters(name, params);

    if (!validation.valid) {
      if (validation.missing.length > 0) {
        throw new MissingParameterError(validation.missing, name);
      }
      if (validation.unknown.length > 0) {
        throw new InvalidParameterError(validation.unknown[0], name, template.parameters);
      }
    }

    let query = template.query;

    // Substitute parameters with escaped values
    for (const param of template.parameters) {
      const value = params[param];
      const escapedValue = this.escapeValue(value);
      query = query.replace(new RegExp(`\\{\\{${param}\\}\\}`, "g"), escapedValue);
    }

    return query;
  }

  /**
   * Validate parameters for a template without applying.
   * @param name Template name
   * @param params Parameters to validate
   * @returns Validation result with missing/unknown params
   */
  validateParameters(name: string, params: Record<string, string>): ParameterValidation {
    const template = this.getTemplate(name);
    const providedKeys = Object.keys(params);
    const requiredKeys = template.parameters;

    const missing = requiredKeys.filter((key) => !(key in params) || params[key] === undefined);
    const unknown = providedKeys.filter((key) => !requiredKeys.includes(key));

    return {
      valid: missing.length === 0 && unknown.length === 0,
      missing,
      unknown,
    };
  }

  /**
   * Parse a parameter string in format "key=value,key2=value2".
   * @param paramString Parameter string to parse
   * @returns Parsed key-value pairs
   * @throws InvalidParamFormatError if format is invalid
   */
  parseParamString(paramString: string): Record<string, string> {
    const trimmed = paramString.trim();
    if (trimmed === "") {
      return {};
    }

    const params: Record<string, string> = {};
    const pairs = trimmed.split(",");

    for (const pair of pairs) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        throw new InvalidParamFormatError(paramString);
      }

      const key = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();

      if (key === "") {
        throw new InvalidParamFormatError(paramString);
      }

      params[key] = value;
    }

    return params;
  }

  /**
   * Escape a parameter value to prevent SPARQL injection.
   * @param value Raw value to escape
   * @returns Escaped value safe for SPARQL
   */
  private escapeValue(value: string): string {
    // Escape quotes, backslashes, and other special characters
    return value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  /**
   * Register a custom template.
   * @param template Template definition to register
   */
  registerTemplate(template: QueryTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * Check if a template exists.
   * @param name Template name
   * @returns True if template exists
   */
  hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * Format templates list for display.
   * @param format Output format ("text" or "json")
   * @returns Formatted string
   */
  formatList(format: "text" | "json" = "text"): string {
    const templates = this.listTemplates();

    if (format === "json") {
      return JSON.stringify(templates, null, 2);
    }

    // Text format
    const lines: string[] = [];
    lines.push("Available SPARQL Templates:");
    lines.push("=" .repeat(50));
    lines.push("");

    for (const template of templates) {
      lines.push(`📋 ${template.name}`);
      lines.push(`   ${template.description}`);
      if (template.parameters.length > 0) {
        lines.push(`   Parameters: ${template.parameters.join(", ")}`);
        if (template.examples && Object.keys(template.examples).length > 0) {
          const exampleStr = Object.entries(template.examples)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          lines.push(`   Example: --param "${exampleStr}"`);
        }
      } else {
        lines.push("   Parameters: (none)");
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
