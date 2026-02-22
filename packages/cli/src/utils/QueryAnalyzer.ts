import {
  SPARQLParser,
  SPARQLParseError,
  AlgebraTranslator,
  AlgebraOptimizer,
  AlgebraSerializer,
} from "exocortex";

/**
 * Prefix declaration extracted from a SPARQL query.
 */
export interface PrefixDeclaration {
  prefix: string;
  iri: string;
}

/**
 * Error information with position and suggestions.
 */
export interface QueryError {
  message: string;
  line?: number;
  column?: number;
  suggestions?: string[];
}

/**
 * Result of analyzing a SPARQL query.
 */
export interface QueryAnalysisResult {
  /** Whether the query is syntactically valid */
  valid: boolean;
  /** Query type (SELECT, CONSTRUCT, ASK, DESCRIBE) */
  queryType?: string;
  /** Prefix declarations used in the query */
  prefixes?: PrefixDeclaration[];
  /** Variables selected (or ["*"] for SELECT *) */
  variables?: string[];
  /** Number of triple patterns in WHERE clause */
  triplePatternCount?: number;
  /** Estimated query complexity */
  complexity?: "low" | "medium" | "high";
  /** Whether query contains FILTER clauses */
  hasFilter?: boolean;
  /** Whether query contains UNION */
  hasUnion?: boolean;
  /** Whether query contains OPTIONAL */
  hasOptional?: boolean;
  /** Serialized algebra plan (if requested) */
  algebraPlan?: string;
  /** Error information if parsing failed */
  error?: QueryError;
}

/**
 * Options for query analysis.
 */
export interface QueryAnalyzerOptions {
  /** Include serialized algebra plan in results */
  includeAlgebraPlan?: boolean;
  /** Optimize the algebra before serialization */
  optimize?: boolean;
}

/**
 * Analyzes SPARQL queries without execution.
 * Extracts metadata like prefixes, variables, triple patterns, and complexity.
 * Provides helpful error messages with suggestions for syntax errors.
 */
export class QueryAnalyzer {
  private readonly parser: SPARQLParser;
  private readonly translator: AlgebraTranslator;
  private readonly optimizer: AlgebraOptimizer;
  private readonly serializer: AlgebraSerializer;

  constructor() {
    this.parser = new SPARQLParser();
    this.translator = new AlgebraTranslator();
    this.optimizer = new AlgebraOptimizer();
    this.serializer = new AlgebraSerializer();
  }

  /**
   * Analyze a SPARQL query and extract metadata.
   *
   * @param queryString - The SPARQL query to analyze
   * @param options - Analysis options
   * @returns Analysis result with metadata or error information
   */
  async analyze(
    queryString: string,
    options: QueryAnalyzerOptions = {}
  ): Promise<QueryAnalysisResult> {
    try {
      // Parse the query
      const ast = this.parser.parse(queryString);

      // Extract basic metadata
      const result: QueryAnalysisResult = {
        valid: true,
        queryType: this.extractQueryType(ast),
        prefixes: this.extractPrefixes(ast),
        variables: this.extractVariables(ast),
        triplePatternCount: this.countTriplePatterns(ast),
        hasFilter: this.hasPatternType(ast, "filter"),
        hasUnion: this.hasPatternType(ast, "union"),
        hasOptional: this.hasPatternType(ast, "optional"),
      };

      // Calculate complexity based on patterns
      result.complexity = this.estimateComplexity(result);

      // Include algebra plan if requested
      if (options.includeAlgebraPlan) {
        let algebra = this.translator.translate(ast);
        if (options.optimize !== false) {
          if (algebra.type === "construct") {
            algebra = {
              ...algebra,
              where: this.optimizer.optimize(algebra.where),
            };
          } else {
            algebra = this.optimizer.optimize(algebra);
          }
        }
        result.algebraPlan = this.serializer.toString(algebra);
      }

      return result;
    } catch (error) {
      return this.handleParseError(error);
    }
  }

  /**
   * Format analysis results for display.
   *
   * @param result - The analysis result
   * @param format - Output format ("text" or "json")
   * @returns Formatted string
   */
  formatAnalysis(result: QueryAnalysisResult, format: "text" | "json"): string {
    if (format === "json") {
      return JSON.stringify(result, null, 2);
    }

    if (!result.valid) {
      return this.formatError(result.error!);
    }

    const lines: string[] = [];

    lines.push(`Query Type: ${result.queryType}`);
    lines.push("");

    // Prefixes
    if (result.prefixes && result.prefixes.length > 0) {
      lines.push("Prefixes:");
      for (const prefix of result.prefixes) {
        lines.push(`  ${prefix.prefix}: <${prefix.iri}>`);
      }
      lines.push("");
    }

    // Variables
    if (result.variables) {
      lines.push("Variables:");
      if (result.variables.length === 1 && result.variables[0] === "*") {
        lines.push("  * (all variables)");
      } else {
        lines.push(`  ${result.variables.join(", ")}`);
      }
      lines.push("");
    }

    // Triple patterns
    lines.push(`Triple Patterns: ${result.triplePatternCount ?? 0}`);
    lines.push("");

    // Pattern types
    const patterns: string[] = [];
    if (result.hasFilter) patterns.push("FILTER");
    if (result.hasUnion) patterns.push("UNION");
    if (result.hasOptional) patterns.push("OPTIONAL");
    if (patterns.length > 0) {
      lines.push(`Features: ${patterns.join(", ")}`);
      lines.push("");
    }

    // Complexity
    lines.push(`Complexity: ${result.complexity}`);

    // Algebra plan
    if (result.algebraPlan) {
      lines.push("");
      lines.push("Query Plan:");
      lines.push(result.algebraPlan);
    }

    return lines.join("\n");
  }

  /**
   * Extract query type from AST.
   */
  private extractQueryType(ast: any): string {
    if (ast.type === "update") {
      return "UPDATE";
    }
    if ("queryType" in ast) {
      return ast.queryType as string;
    }
    return "UNKNOWN";
  }

  /**
   * Extract prefix declarations from AST.
   */
  private extractPrefixes(ast: any): PrefixDeclaration[] {
    const prefixes: PrefixDeclaration[] = [];
    if (ast.prefixes && typeof ast.prefixes === "object") {
      for (const [prefix, iri] of Object.entries(ast.prefixes)) {
        prefixes.push({ prefix, iri: iri as string });
      }
    }
    return prefixes;
  }

  /**
   * Extract selected variables from AST.
   */
  private extractVariables(ast: any): string[] {
    if (!ast.variables) {
      return [];
    }

    if (Array.isArray(ast.variables)) {
      // Check for SELECT *
      if (ast.variables.length === 1 && ast.variables[0] === "*") {
        return ["*"];
      }

      // Extract variable names
      return ast.variables.map((v: any) => {
        if (typeof v === "string") {
          return v;
        }
        // Handle different variable structures from sparqljs
        if (v.termType === "Variable") {
          return `?${v.value}`;
        }
        if (v.variable && v.variable.termType === "Variable") {
          return `?${v.variable.value}`;
        }
        return String(v);
      });
    }

    return [];
  }

  /**
   * Count triple patterns recursively in WHERE clause.
   */
  private countTriplePatterns(ast: any): number {
    const where = ast.where || [];
    return this.countTriplesInPatterns(where);
  }

  /**
   * Recursively count triples in pattern array.
   */
  private countTriplesInPatterns(patterns: any[]): number {
    let count = 0;

    for (const pattern of patterns) {
      if (!pattern) continue;

      // Basic graph pattern with triples
      if (pattern.type === "bgp" && Array.isArray(pattern.triples)) {
        count += pattern.triples.length;
      }
      // Nested patterns in various pattern types (OPTIONAL, UNION, GROUP, etc.)
      else if (pattern.patterns && Array.isArray(pattern.patterns)) {
        count += this.countTriplesInPatterns(pattern.patterns);
      }
    }

    return count;
  }

  /**
   * Check if AST contains a specific pattern type.
   */
  private hasPatternType(ast: any, type: string): boolean {
    const where = ast.where || [];
    return this.containsPatternType(where, type);
  }

  /**
   * Recursively check for pattern type.
   */
  private containsPatternType(patterns: any[], type: string): boolean {
    for (const pattern of patterns) {
      if (!pattern) continue;

      if (pattern.type === type) {
        return true;
      }

      // Check nested patterns
      if (pattern.patterns && this.containsPatternType(pattern.patterns, type)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Estimate query complexity based on patterns.
   *
   * Complexity factors:
   * - Number of triple patterns
   * - Presence of OPTIONAL (causes left outer join)
   * - Presence of UNION (causes multiple branches)
   * - Presence of FILTER (additional filtering)
   */
  private estimateComplexity(result: QueryAnalysisResult): "low" | "medium" | "high" {
    let score = 0;

    // Base score from triple pattern count
    const tripleCount = result.triplePatternCount ?? 0;
    if (tripleCount <= 3) {
      score += 1;
    } else if (tripleCount <= 7) {
      score += 2;
    } else {
      score += 3;
    }

    // Pattern type penalties
    if (result.hasOptional) score += 1;
    if (result.hasUnion) score += 2;
    if (result.hasFilter) score += 0.5;

    // Classify
    if (score <= 2) {
      return "low";
    } else if (score <= 4) {
      return "medium";
    } else {
      return "high";
    }
  }

  /**
   * Handle parse errors and generate suggestions.
   */
  private handleParseError(error: unknown): QueryAnalysisResult {
    if (error instanceof SPARQLParseError) {
      return {
        valid: false,
        error: {
          message: error.message,
          line: error.line,
          column: error.column,
          suggestions: this.generateSuggestions(error.message),
        },
      };
    }

    if (error instanceof Error) {
      return {
        valid: false,
        error: {
          message: error.message,
          suggestions: this.generateSuggestions(error.message),
        },
      };
    }

    return {
      valid: false,
      error: {
        message: String(error),
      },
    };
  }

  /**
   * Generate helpful suggestions based on error message.
   */
  private generateSuggestions(message: string): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();

    // Missing prefix suggestions
    if (lowerMessage.includes("unknown prefix") || lowerMessage.includes("prefix")) {
      const prefixMatch = message.match(/prefix[:\s]+(\w+)/i);
      if (prefixMatch) {
        const prefix = prefixMatch[1].toLowerCase();
        const knownPrefixes: Record<string, string> = {
          rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
          rdfs: "http://www.w3.org/2000/01/rdf-schema#",
          xsd: "http://www.w3.org/2001/XMLSchema#",
          owl: "http://www.w3.org/2002/07/owl#",
          ems: "http://exocortex.local/ems#",
          exo: "http://exocortex.local/exo#",
          ims: "http://exocortex.local/ims#",
        };
        if (knownPrefixes[prefix]) {
          suggestions.push(`Add prefix declaration: PREFIX ${prefix}: <${knownPrefixes[prefix]}>`);
        } else {
          suggestions.push(`Add a PREFIX declaration for '${prefix}' at the start of your query`);
        }
      }
    }

    // Missing WHERE clause
    if (lowerMessage.includes("where") || lowerMessage.includes("expected")) {
      suggestions.push("Ensure your query has a WHERE clause: SELECT ?s WHERE { ... }");
    }

    // Bracket/brace issues
    if (lowerMessage.includes("bracket") || lowerMessage.includes("brace") || lowerMessage.includes("{") || lowerMessage.includes("}")) {
      suggestions.push("Check that all braces { } are properly balanced");
    }

    // Variable syntax
    if (lowerMessage.includes("variable") || lowerMessage.includes("?")) {
      suggestions.push("Variables must start with '?' (e.g., ?subject, ?predicate, ?object)");
    }

    // General syntax tips
    if (suggestions.length === 0) {
      suggestions.push("Check SPARQL syntax - see https://www.w3.org/TR/sparql11-query/");
    }

    return suggestions;
  }

  /**
   * Format error for text display.
   */
  private formatError(error: QueryError): string {
    const lines: string[] = [];

    lines.push("Syntax Error:");
    if (error.line !== undefined) {
      const posInfo = error.column !== undefined
        ? `line ${error.line}, column ${error.column}`
        : `line ${error.line}`;
      lines.push(`  Position: ${posInfo}`);
    }
    lines.push(`  ${error.message}`);

    if (error.suggestions && error.suggestions.length > 0) {
      lines.push("");
      lines.push("Suggestions:");
      for (const suggestion of error.suggestions) {
        lines.push(`  - ${suggestion}`);
      }
    }

    return lines.join("\n");
  }
}
