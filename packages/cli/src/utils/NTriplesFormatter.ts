/**
 * N-Triples string formatting utilities
 *
 * Implements proper string escaping according to N-Triples specification.
 * Fixes code scanning alert js/incomplete-sanitization by ensuring
 * backslashes are escaped BEFORE other characters that use backslash escaping.
 *
 * @see https://www.w3.org/TR/n-triples/#grammar-production-STRING_LITERAL_QUOTE
 */
export class NTriplesFormatter {
  /**
   * Escape a string for N-Triples literal representation.
   *
   * CRITICAL: The order of replacements matters!
   * Backslash MUST be escaped first, otherwise:
   * - Input: test\"value (literal backslash + quote)
   * - Wrong: test\\"value (quote escaped but backslash not)
   * - Correct: test\\\"value (both escaped properly)
   *
   * @param str - The string to escape
   * @returns Escaped string (without surrounding quotes)
   */
  static escapeString(str: string): string {
    // Step 1: Escape backslashes FIRST (prevents double-escaping issues)
    // This is the fix for js/incomplete-sanitization (Issue #2226)
    let result = str.replace(/\\/g, "\\\\");

    // Step 2: Escape double quotes
    result = result.replace(/"/g, '\\"');

    // Step 3: Escape control characters
    result = result.replace(/\n/g, "\\n");
    result = result.replace(/\r/g, "\\r");
    result = result.replace(/\t/g, "\\t");

    return result;
  }

  /**
   * Format a value as an N-Triples object (URI or literal).
   *
   * @param obj - The object value (URI string or literal string)
   * @returns Formatted N-Triples object representation
   */
  static formatObject(obj: string): string {
    // Check if it's a URI (http, https, or urn scheme)
    if (obj.startsWith("http://") || obj.startsWith("https://") || obj.startsWith("urn:")) {
      return `<${obj}>`;
    }

    // Assume literal - escape and wrap in quotes
    return `"${NTriplesFormatter.escapeString(obj)}"`;
  }
}
