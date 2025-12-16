/**
 * LateralTransformer - Transforms LATERAL join syntax to a parseable form.
 *
 * SPARQL 1.2 introduces the LATERAL keyword for correlated subqueries,
 * allowing the inner query to reference variables from the outer query.
 *
 * Since sparqljs doesn't support LATERAL natively, this transformer converts:
 *
 * ```sparql
 * SELECT ?person ?topFriend
 * WHERE {
 *   ?person a :Person .
 *   LATERAL {
 *     SELECT ?friend WHERE {
 *       ?person :knows ?friend .
 *     }
 *     ORDER BY DESC(?score)
 *     LIMIT 1
 *   }
 * }
 * ```
 *
 * to:
 *
 * ```sparql
 * SELECT ?person ?topFriend
 * WHERE {
 *   ?person a :Person .
 *   {
 *     # __LATERAL_JOIN__
 *     SELECT ?friend WHERE {
 *       ?person :knows ?friend .
 *     }
 *     ORDER BY DESC(?score)
 *     LIMIT 1
 *   }
 * }
 * ```
 *
 * The marker comment `# __LATERAL_JOIN__` is preserved in the parsed AST
 * and recognized by AlgebraTranslator to create a LateralJoinOperation
 * instead of a regular SubqueryOperation.
 *
 * SPARQL 1.2 spec: https://w3c.github.io/sparql-12/spec/
 */
export class LateralTransformer {
  /**
   * Marker used to identify lateral joins in the transformed query.
   * This is inserted as a comment before the subquery.
   */
  public static readonly LATERAL_MARKER = "__LATERAL_JOIN__";

  /**
   * Transform all LATERAL keywords in a SPARQL query string.
   *
   * @param query - The SPARQL query string that may contain LATERAL keywords
   * @returns The transformed query with LATERAL replaced by marked subqueries
   * @throws LateralTransformerError if LATERAL syntax is malformed
   */
  transform(query: string): string {
    // Keep transforming until no more LATERAL keywords are found
    // (handles nested LATERAL joins, though rare)
    let result = query;
    let transformed: string;
    let iterationCount = 0;
    const maxIterations = 100; // Prevent infinite loops

    do {
      transformed = result;
      result = this.transformSinglePass(result);
      iterationCount++;
      if (iterationCount > maxIterations) {
        throw new LateralTransformerError(
          "Too many nested LATERAL joins (max 100 iterations)"
        );
      }
    } while (result !== transformed);

    return result;
  }

  /**
   * Check if a query contains LATERAL keywords.
   *
   * @param query - The SPARQL query string to check
   * @returns true if the query contains LATERAL keywords
   */
  hasLateral(query: string): boolean {
    const positions = this.findLateralPositions(query);
    return positions.length > 0;
  }

  /**
   * Check if a parsed query (from sparqljs) contains lateral join markers.
   * This checks for the special marker comment in the query structure.
   *
   * @param pattern - A pattern from sparqljs AST
   * @returns true if the pattern represents a lateral join
   */
  static isLateralJoin(pattern: any): boolean {
    // After transformation, lateral joins are subqueries with a special variable
    // or annotation that we can detect
    if (pattern.type === "group" && pattern.patterns) {
      for (const p of pattern.patterns) {
        if (p.type === "query" && p.queryType === "SELECT") {
          // Check if there's a lateral marker in the subquery variables
          if (p.variables && Array.isArray(p.variables)) {
            for (const v of p.variables) {
              if (v.termType === "Variable" && v.value === LateralTransformer.LATERAL_MARKER) {
                return true;
              }
            }
          }
        }
      }
    }
    // Direct subquery check
    if (pattern.type === "query" && pattern.queryType === "SELECT") {
      if (pattern.variables && Array.isArray(pattern.variables)) {
        for (const v of pattern.variables) {
          if (v.termType === "Variable" && v.value === LateralTransformer.LATERAL_MARKER) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Perform a single pass of LATERAL transformation.
   * Finds and transforms the innermost LATERAL keywords first.
   */
  private transformSinglePass(query: string): string {
    // Find all LATERAL positions (skipping those inside strings)
    const lateralPositions = this.findLateralPositions(query);

    if (lateralPositions.length === 0) {
      return query;
    }

    let result = query;

    // Process in reverse order to maintain valid positions
    for (let i = lateralPositions.length - 1; i >= 0; i--) {
      const startPos = lateralPositions[i];
      const lateralExpr = this.extractLateralExpression(result, startPos);
      if (lateralExpr) {
        const transformedExpr = this.transformLateral(lateralExpr.content);
        result =
          result.substring(0, startPos) +
          transformedExpr +
          result.substring(startPos + lateralExpr.length);
      }
    }

    return result;
  }

  /**
   * Find all LATERAL keyword positions that are NOT inside string literals.
   */
  private findLateralPositions(query: string): number[] {
    const positions: number[] = [];
    const queryUpper = query.toUpperCase();
    let pos = 0;

    while (pos < query.length) {
      // Skip string literals
      if (query[pos] === "'" || query[pos] === '"') {
        const quote = query[pos];
        pos++;
        while (pos < query.length && query[pos] !== quote) {
          if (query[pos] === "\\") pos++; // Skip escaped characters
          pos++;
        }
        pos++; // Skip closing quote
        continue;
      }

      // Skip single-line comments
      if (query[pos] === "#") {
        while (pos < query.length && query[pos] !== "\n") {
          pos++;
        }
        continue;
      }

      // Check for LATERAL keyword
      if (
        queryUpper.substring(pos, pos + 7) === "LATERAL" &&
        this.isWordBoundary(query, pos, 7)
      ) {
        positions.push(pos);
        pos += 7;
        continue;
      }

      pos++;
    }

    return positions;
  }

  /**
   * Extract a complete LATERAL { ... } expression from the query string.
   * LATERAL must be followed by a block containing a SELECT subquery.
   */
  private extractLateralExpression(
    query: string,
    startPos: number
  ): { content: string; length: number } | null {
    // Skip "LATERAL" keyword
    let pos = startPos + 7;

    // Skip whitespace
    while (pos < query.length && /\s/.test(query[pos])) {
      pos++;
    }

    // Expect opening brace
    if (query[pos] !== "{") {
      throw new LateralTransformerError(
        `Expected '{' after LATERAL keyword at position ${startPos}`
      );
    }

    // Find matching closing brace, accounting for nested braces
    let depth = 1;
    pos++;

    while (pos < query.length && depth > 0) {
      // Skip strings (single and double quoted)
      if (query[pos] === "'" || query[pos] === '"') {
        const quote = query[pos];
        pos++;
        while (pos < query.length && query[pos] !== quote) {
          if (query[pos] === "\\") pos++; // Skip escaped characters
          pos++;
        }
        pos++;
        continue;
      }

      // Skip single-line comments
      if (query[pos] === "#") {
        while (pos < query.length && query[pos] !== "\n") {
          pos++;
        }
        continue;
      }

      // Track brace depth
      if (query[pos] === "{") {
        depth++;
        pos++;
        continue;
      }

      if (query[pos] === "}") {
        depth--;
        if (depth === 0) {
          const content = query.substring(startPos, pos + 1);
          return { content, length: content.length };
        }
        pos++;
        continue;
      }

      pos++;
    }

    if (depth > 0) {
      throw new LateralTransformerError(
        `Unclosed LATERAL block at position ${startPos}`
      );
    }

    return null;
  }

  /**
   * Transform a LATERAL { SELECT ... } expression to a marked subquery block.
   *
   * Input: LATERAL { SELECT ?x WHERE { ... } }
   * Output: { SELECT ?__LATERAL_JOIN__ ?x WHERE { ... } }
   *
   * Input: LATERAL { SELECT DISTINCT ?x WHERE { ... } }
   * Output: { SELECT DISTINCT ?__LATERAL_JOIN__ ?x WHERE { ... } }
   *
   * The marker variable is added to the SELECT clause to identify this
   * as a lateral join during algebra translation.
   */
  private transformLateral(lateralExpr: string): string {
    // Find the opening brace after LATERAL
    const braceStart = lateralExpr.indexOf("{");
    if (braceStart === -1) {
      throw new LateralTransformerError("LATERAL expression missing opening brace");
    }

    // Extract content between braces (excluding the braces themselves)
    const innerContent = lateralExpr.substring(braceStart + 1, lateralExpr.length - 1).trim();

    // Verify it starts with SELECT
    const innerUpper = innerContent.toUpperCase().trim();
    if (!innerUpper.startsWith("SELECT")) {
      throw new LateralTransformerError(
        "LATERAL block must contain a SELECT subquery"
      );
    }

    // Find where to insert the marker - after SELECT and any modifiers like DISTINCT/REDUCED
    const selectStart = innerContent.toUpperCase().indexOf("SELECT");
    let insertPos = selectStart + 6; // After "SELECT"

    // Skip whitespace after SELECT
    while (insertPos < innerContent.length && /\s/.test(innerContent[insertPos])) {
      insertPos++;
    }

    // Check for DISTINCT or REDUCED modifier
    const afterSelect = innerContent.substring(insertPos).toUpperCase();
    if (afterSelect.startsWith("DISTINCT")) {
      insertPos += 8; // Skip "DISTINCT"
    } else if (afterSelect.startsWith("REDUCED")) {
      insertPos += 7; // Skip "REDUCED"
    }

    // Insert marker variable at the calculated position
    const transformedInner =
      innerContent.substring(0, insertPos) +
      ` ?${LateralTransformer.LATERAL_MARKER}` +
      innerContent.substring(insertPos);

    // Return as a group block (the braces will be preserved)
    return `{ ${transformedInner} }`;
  }

  /**
   * Check if position is at a word boundary (not part of a longer identifier).
   */
  private isWordBoundary(query: string, pos: number, wordLength: number): boolean {
    // Check character before the keyword
    const charBefore = pos > 0 ? query[pos - 1] : "";
    const beforeOk = pos === 0 || !/[a-zA-Z0-9_]/.test(charBefore);

    // Check character after the keyword
    const charAfter = pos + wordLength < query.length ? query[pos + wordLength] : "";
    const afterOk = pos + wordLength >= query.length || !/[a-zA-Z0-9_]/.test(charAfter);

    return beforeOk && afterOk;
  }
}

/**
 * Error thrown when LATERAL transformation fails.
 */
export class LateralTransformerError extends Error {
  constructor(message: string) {
    super(`LATERAL transformation error: ${message}`);
    this.name = "LateralTransformerError";
  }
}
