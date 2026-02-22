/**
 * Enhanced SPARQL error messages with suggestions.
 *
 * Transforms cryptic Fuseki/parser error messages into user-friendly messages
 * with actionable suggestions for fixing common issues.
 *
 * Features:
 * - Levenshtein distance for prefix suggestions
 * - Query context extraction (±2 lines around error)
 * - Error classification (syntax, prefix, timeout, connection)
 * - User-friendly formatting for both text and JSON output
 *
 * @see https://github.com/kitelev/exocortex/issues/2221
 */

/**
 * Error type classification for SPARQL errors.
 */
export type SPARQLErrorType =
  | "unknown_prefix"
  | "syntax"
  | "timeout"
  | "connection"
  | "unknown";

/**
 * A context line from the query with metadata.
 */
export interface ContextLine {
  /** Line number (1-indexed) */
  number: number;
  /** Line content */
  content: string;
  /** Whether this is the error line */
  isError: boolean;
}

/**
 * Query context around an error position.
 */
export interface QueryContext {
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** The error line number (1-indexed) */
  errorLine: number;
  /** The error column (1-indexed), if known */
  errorColumn?: number;
  /** Lines with metadata */
  lines: ContextLine[];
}

/**
 * Enhanced error information.
 */
export interface EnhancedSPARQLError {
  /** Error type classification */
  type: SPARQLErrorType;
  /** User-friendly error message */
  message: string;
  /** Original error message (preserved for debugging) */
  originalMessage: string;
  /** Original stack trace (preserved for debugging) */
  originalStack?: string;
  /** Actionable suggestions for fixing the error */
  suggestions?: string[];
  /** Query context around the error (for syntax errors) */
  context?: QueryContext;
  /** Line number where error occurred */
  line?: number;
  /** Column number where error occurred */
  column?: number;
}

/**
 * JSON format for enhanced errors.
 */
export interface EnhancedSPARQLErrorJSON {
  type: SPARQLErrorType;
  message: string;
  originalMessage: string;
  suggestions?: string[];
  line?: number;
  column?: number;
  context?: {
    startLine: number;
    endLine: number;
    errorLine: number;
    errorColumn?: number;
    lines: Array<{ number: number; content: string; isError: boolean }>;
  };
}

/**
 * Calculate the Levenshtein distance between two strings.
 *
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string
 * into another.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The Levenshtein distance between the two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Create a matrix of distances
  const matrix: number[][] = [];

  // Initialize the first column
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }

  // Initialize the first row
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Find similar prefixes using Levenshtein distance.
 *
 * @param unknownPrefix - The unknown prefix that caused the error
 * @param knownPrefixes - Array of known/declared prefixes
 * @param maxSuggestions - Maximum number of suggestions to return (default: 3)
 * @param maxDistance - Maximum Levenshtein distance to consider (default: 3)
 * @returns Array of similar prefixes sorted by similarity
 */
export function findSimilarPrefixes(
  unknownPrefix: string,
  knownPrefixes: string[],
  maxSuggestions: number = 3,
  maxDistance: number = 3
): string[] {
  const scored = knownPrefixes
    .map(prefix => ({
      prefix,
      distance: levenshteinDistance(unknownPrefix.toLowerCase(), prefix.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, maxSuggestions).map(({ prefix }) => prefix);
}

/**
 * Get query context around an error position.
 *
 * @param query - The full query string
 * @param errorLine - Line number where the error occurred (1-indexed)
 * @param contextLines - Number of lines to show before and after (default: 2)
 * @param errorColumn - Column number where error occurred (optional)
 * @returns Query context with lines and metadata
 */
export function getQueryContext(
  query: string,
  errorLine: number,
  contextLines: number = 2,
  errorColumn?: number
): QueryContext {
  const lines = query.split("\n");
  const totalLines = lines.length;

  // Calculate range (1-indexed)
  const startLine = Math.max(1, errorLine - contextLines);
  const endLine = Math.min(totalLines, errorLine + contextLines);

  // Build context lines
  const contextLineArray: ContextLine[] = [];
  for (let i = startLine; i <= endLine; i++) {
    contextLineArray.push({
      number: i,
      content: lines[i - 1], // Convert to 0-indexed for array access
      isError: i === errorLine,
    });
  }

  return {
    startLine,
    endLine,
    errorLine,
    errorColumn,
    lines: contextLineArray,
  };
}

/**
 * Extract prefixes declared in a SPARQL query.
 *
 * @param query - The SPARQL query string
 * @returns Array of declared prefix names
 */
function extractDeclaredPrefixes(query: string): string[] {
  const prefixRegex = /PREFIX\s+(\w+):\s*</gi;
  const prefixes: string[] = [];
  let match;

  while ((match = prefixRegex.exec(query)) !== null) {
    prefixes.push(match[1]);
  }

  return prefixes;
}

/**
 * Extract the unknown prefix name from an error message.
 *
 * @param message - The error message
 * @returns The extracted prefix name or null if not found
 */
function extractUnknownPrefix(message: string): string | null {
  // Match patterns like "Unknown prefix: foo" or "Unknown prefix 'foo'"
  const patterns = [
    /unknown prefix[:\s]+['"]?(\w+)['"]?/i,
    /prefix\s+['"]?(\w+)['"]?\s+not\s+defined/i,
    /undefined\s+prefix[:\s]+['"]?(\w+)['"]?/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extract line and column from error message.
 *
 * @param message - The error message
 * @returns Object with line and column (if found)
 */
function extractPosition(message: string): { line?: number; column?: number } {
  // Match patterns like "at line 3, column 10" or "line 3:10"
  const patterns = [
    /line\s+(\d+),?\s*column\s+(\d+)/i,
    /line\s+(\d+):(\d+)/i,
    /at\s+(\d+):(\d+)/i,
    /\((\d+),\s*(\d+)\)/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
      };
    }
  }

  // Try to find just line number
  const lineOnlyMatch = message.match(/line\s+(\d+)/i);
  if (lineOnlyMatch) {
    return { line: parseInt(lineOnlyMatch[1], 10) };
  }

  return {};
}

/**
 * Extract timeout duration from error message.
 *
 * @param message - The error message
 * @returns Timeout duration in milliseconds or null
 */
function extractTimeoutDuration(message: string): number | null {
  const patterns = [
    /timeout[^\d]*(\d+)\s*ms/i,
    /timeout[^\d]*(\d+)\s*milliseconds/i,
    /(\d+)\s*ms\s*timeout/i,
    /exceeded[^\d]*(\d+)\s*ms/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Enhanced SPARQL error processor.
 *
 * Transforms cryptic error messages into user-friendly messages with
 * actionable suggestions.
 */
export class SPARQLErrorEnhancer {
  /** Well-known SPARQL prefixes for suggestion fallback */
  private readonly wellKnownPrefixes: Record<string, string> = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    owl: "http://www.w3.org/2002/07/owl#",
    ems: "http://exocortex.local/ems#",
    exo: "http://exocortex.local/exo#",
    ims: "http://exocortex.local/ims#",
  };

  /**
   * Classify an error by its type.
   *
   * @param error - The error to classify
   * @returns The error type classification
   */
  classifyError(error: Error): SPARQLErrorType {
    const message = error.message.toLowerCase();

    if (message.includes("unknown prefix") ||
        message.includes("prefix") && (message.includes("not defined") || message.includes("undefined"))) {
      return "unknown_prefix";
    }

    if (message.includes("parse error") ||
        message.includes("syntax error") ||
        message.includes("unexpected") ||
        message.includes("expected")) {
      return "syntax";
    }

    if (message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("exceeded")) {
      return "timeout";
    }

    if (message.includes("econnrefused") ||
        message.includes("connection refused") ||
        message.includes("network") ||
        message.includes("connect")) {
      return "connection";
    }

    return "unknown";
  }

  /**
   * Enhance an error with user-friendly message and suggestions.
   *
   * @param error - The original error
   * @param query - The SPARQL query that caused the error
   * @returns Enhanced error information
   */
  enhanceError(error: Error, query: string): EnhancedSPARQLError {
    const type = this.classifyError(error);

    switch (type) {
      case "unknown_prefix":
        return this.enhanceUnknownPrefixError(error, query);
      case "syntax":
        return this.enhanceSyntaxError(error, query);
      case "timeout":
        return this.enhanceTimeoutError(error, query);
      case "connection":
        return this.enhanceConnectionError(error, query);
      default:
        return this.enhanceUnknownError(error, query);
    }
  }

  /**
   * Enhance an unknown prefix error.
   */
  private enhanceUnknownPrefixError(error: Error, query: string): EnhancedSPARQLError {
    const unknownPrefix = extractUnknownPrefix(error.message);
    const declaredPrefixes = extractDeclaredPrefixes(query);
    const allKnownPrefixes = [
      ...new Set([...declaredPrefixes, ...Object.keys(this.wellKnownPrefixes)]),
    ];

    let message: string;
    const suggestions: string[] = [];

    if (unknownPrefix) {
      const similarPrefixes = findSimilarPrefixes(unknownPrefix, allKnownPrefixes);

      if (similarPrefixes.length > 0) {
        message = `Unknown prefix '${unknownPrefix}'. Did you mean: ${similarPrefixes.join(", ")}?`;
        suggestions.push(`Replace '${unknownPrefix}:' with '${similarPrefixes[0]}:'`);
      } else {
        message = `Unknown prefix '${unknownPrefix}'.`;
      }

      // Always show available prefixes
      const availablePrefixes = declaredPrefixes.length > 0
        ? declaredPrefixes.join(", ")
        : Object.keys(this.wellKnownPrefixes).join(", ");
      message += `\n\nAvailable prefixes: ${availablePrefixes}`;

      // Suggest adding a prefix declaration
      if (this.wellKnownPrefixes[unknownPrefix]) {
        suggestions.push(
          `Add: PREFIX ${unknownPrefix}: <${this.wellKnownPrefixes[unknownPrefix]}>`
        );
      }
    } else {
      message = error.message;
    }

    return {
      type: "unknown_prefix",
      message,
      originalMessage: error.message,
      originalStack: error.stack,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  /**
   * Enhance a syntax error with context.
   */
  private enhanceSyntaxError(error: Error, query: string): EnhancedSPARQLError {
    // Try to get position from error properties first (SPARQLParseError)
    // then fall back to extracting from message
    const errorWithPosition = error as { line?: number; column?: number };
    const position = errorWithPosition.line !== undefined
      ? { line: errorWithPosition.line, column: errorWithPosition.column }
      : extractPosition(error.message);

    let message: string;
    let context: QueryContext | undefined;

    if (position.line) {
      message = `Syntax error at line ${position.line}`;
      if (position.column) {
        message += `, column ${position.column}`;
      }
      message += `: ${error.message.replace(/.*line\s+\d+.*?:\s*/i, "")}`;

      context = getQueryContext(query, position.line, 2, position.column);
    } else {
      message = `Syntax error: ${error.message}`;
    }

    const suggestions = this.generateSyntaxSuggestions(error.message);

    return {
      type: "syntax",
      message,
      originalMessage: error.message,
      originalStack: error.stack,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      context,
      line: position.line,
      column: position.column,
    };
  }

  /**
   * Generate suggestions for syntax errors.
   */
  private generateSyntaxSuggestions(message: string): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("where") || lowerMessage.includes("expected")) {
      suggestions.push("Ensure your query has a WHERE clause: SELECT ?s WHERE { ... }");
    }

    if (lowerMessage.includes("{") || lowerMessage.includes("}") ||
        lowerMessage.includes("brace") || lowerMessage.includes("bracket")) {
      suggestions.push("Check that all braces { } are properly balanced");
    }

    if (lowerMessage.includes("variable") || lowerMessage.includes("?")) {
      suggestions.push("Variables must start with '?' (e.g., ?subject, ?predicate, ?object)");
    }

    if (lowerMessage.includes("end of input") || lowerMessage.includes("eof")) {
      suggestions.push("Query may be incomplete - check for missing closing braces or statements");
    }

    if (lowerMessage.includes("prefix")) {
      suggestions.push("Add PREFIX declarations at the start of your query");
    }

    if (suggestions.length === 0) {
      suggestions.push("Check SPARQL syntax reference: https://www.w3.org/TR/sparql11-query/");
    }

    return suggestions;
  }

  /**
   * Enhance a timeout error.
   */
  private enhanceTimeoutError(error: Error, query: string): EnhancedSPARQLError {
    const timeoutMs = extractTimeoutDuration(error.message);
    const timeoutSec = timeoutMs ? Math.round(timeoutMs / 1000) : null;

    let message: string;
    if (timeoutSec) {
      message = `Query timed out after ${timeoutSec} second${timeoutSec !== 1 ? "s" : ""}`;
    } else {
      message = "Query timed out";
    }

    const suggestions: string[] = [
      "Try limiting results with LIMIT (e.g., LIMIT 100)",
      "Add more specific FILTER conditions to reduce result set",
      "Use more selective triple patterns",
      "Consider using OPTIONAL sparingly (it can be expensive)",
    ];

    // Check if query already has LIMIT
    if (!/\bLIMIT\b/i.test(query)) {
      suggestions.unshift("Add LIMIT clause to restrict result count");
    }

    // Check for SELECT * which can be expensive
    if (/SELECT\s+\*/i.test(query)) {
      suggestions.push("Replace SELECT * with specific variables to reduce data transfer");
    }

    return {
      type: "timeout",
      message,
      originalMessage: error.message,
      originalStack: error.stack,
      suggestions,
    };
  }

  /**
   * Enhance a connection error.
   */
  private enhanceConnectionError(error: Error, query: string): EnhancedSPARQLError {
    const message = "Connection failed to SPARQL endpoint";
    const suggestions = [
      "Check that the SPARQL endpoint is running",
      "Verify network connectivity",
      "Check firewall settings",
    ];

    return {
      type: "connection",
      message,
      originalMessage: error.message,
      originalStack: error.stack,
      suggestions,
    };
  }

  /**
   * Enhance an unknown error (fallback).
   */
  private enhanceUnknownError(error: Error, query: string): EnhancedSPARQLError {
    return {
      type: "unknown",
      message: error.message,
      originalMessage: error.message,
      originalStack: error.stack,
      suggestions: ["Check query syntax and try again"],
    };
  }

  /**
   * Format an enhanced error for text output.
   *
   * @param enhanced - The enhanced error
   * @returns Formatted text string
   */
  formatForText(enhanced: EnhancedSPARQLError): string {
    const lines: string[] = [];

    // Error header
    lines.push(`❌ ${enhanced.message}`);

    // Context (for syntax errors)
    if (enhanced.context) {
      lines.push("");
      lines.push("Context:");
      for (const line of enhanced.context.lines) {
        const marker = line.isError ? ">>> " : "    ";
        lines.push(`${marker}${line.number.toString().padStart(3)}: ${line.content}`);

        // Add column pointer if available
        if (line.isError && enhanced.context.errorColumn) {
          const pointer = " ".repeat(8 + line.number.toString().length + enhanced.context.errorColumn - 1) + "^";
          lines.push(pointer);
        }
      }
    }

    // Suggestions
    if (enhanced.suggestions && enhanced.suggestions.length > 0) {
      lines.push("");
      lines.push("Suggestions:");
      for (const suggestion of enhanced.suggestions) {
        lines.push(`  • ${suggestion}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format an enhanced error for JSON output.
   *
   * @param enhanced - The enhanced error
   * @returns JSON-serializable object
   */
  formatForJSON(enhanced: EnhancedSPARQLError): EnhancedSPARQLErrorJSON {
    return {
      type: enhanced.type,
      message: enhanced.message,
      originalMessage: enhanced.originalMessage,
      suggestions: enhanced.suggestions,
      line: enhanced.line,
      column: enhanced.column,
      context: enhanced.context ? {
        startLine: enhanced.context.startLine,
        endLine: enhanced.context.endLine,
        errorLine: enhanced.context.errorLine,
        errorColumn: enhanced.context.errorColumn,
        lines: enhanced.context.lines.map(l => ({
          number: l.number,
          content: l.content,
          isError: l.isError,
        })),
      } : undefined,
    };
  }
}
