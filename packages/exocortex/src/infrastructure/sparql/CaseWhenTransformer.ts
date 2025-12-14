/**
 * CaseWhenTransformer - Transforms CASE WHEN expressions to nested IF expressions.
 *
 * SPARQL 1.1 does not include CASE WHEN syntax (it's a SQL extension).
 * However, SPARQL 1.1 provides the IF() function which can achieve the same result.
 *
 * This transformer enables SQL-style CASE WHEN syntax by converting:
 *
 * ```sparql
 * CASE
 *   WHEN ?hours > 8 THEN "overtime"
 *   WHEN ?hours > 4 THEN "half-day"
 *   ELSE "short"
 * END
 * ```
 *
 * to nested IF expressions:
 *
 * ```sparql
 * IF(?hours > 8, "overtime", IF(?hours > 4, "half-day", "short"))
 * ```
 *
 * Supports:
 * - Simple CASE: CASE WHEN condition1 THEN result1 ... END
 * - Multiple WHEN clauses
 * - ELSE clause (optional)
 * - Nested CASE expressions
 * - CASE inside BIND, SELECT expressions, and FILTER
 *
 * Note: This does NOT support searched CASE (CASE expr WHEN val1 THEN ...)
 * Only simple CASE with conditions is supported.
 */
export class CaseWhenTransformer {
  /**
   * Transform all CASE WHEN expressions in a SPARQL query string to nested IF expressions.
   *
   * @param query - The SPARQL query string that may contain CASE WHEN expressions
   * @returns The transformed query with CASE WHEN replaced by IF expressions
   * @throws CaseWhenTransformerError if CASE WHEN syntax is malformed
   */
  transform(query: string): string {
    // Keep transforming until no more CASE expressions are found
    // (handles nested CASE expressions)
    let result = query;
    let transformed: string;
    let iterationCount = 0;
    const maxIterations = 100; // Prevent infinite loops

    do {
      transformed = result;
      result = this.transformSinglePass(result);
      iterationCount++;
      if (iterationCount > maxIterations) {
        throw new CaseWhenTransformerError(
          "Too many nested CASE expressions (max 100 iterations)"
        );
      }
    } while (result !== transformed);

    return result;
  }

  /**
   * Perform a single pass of CASE WHEN transformation.
   * Finds and transforms the innermost CASE expressions first.
   */
  private transformSinglePass(query: string): string {
    // Find all CASE positions (skipping those inside strings)
    const casePositions = this.findCasePositions(query);

    if (casePositions.length === 0) {
      return query;
    }

    let result = query;

    // Process in reverse order to maintain valid positions
    for (let i = casePositions.length - 1; i >= 0; i--) {
      const startPos = casePositions[i];
      const caseExpr = this.extractCaseExpression(result, startPos);
      if (caseExpr) {
        const ifExpr = this.convertCaseToIf(caseExpr.content);
        result =
          result.substring(0, startPos) +
          ifExpr +
          result.substring(startPos + caseExpr.length);
      }
    }

    return result;
  }

  /**
   * Find all CASE keyword positions that are NOT inside string literals.
   */
  private findCasePositions(query: string): number[] {
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

      // Check for CASE keyword
      if (
        queryUpper.substring(pos, pos + 4) === "CASE" &&
        this.isWordBoundary(query, pos, 4)
      ) {
        positions.push(pos);
        pos += 4;
        continue;
      }

      pos++;
    }

    return positions;
  }

  /**
   * Extract a complete CASE ... END expression from the query string.
   */
  private extractCaseExpression(
    query: string,
    startPos: number
  ): { content: string; length: number } | null {
    // Find matching END keyword, accounting for nested CASE
    let depth = 1;
    let pos = startPos + 4; // Skip "CASE"
    const queryUpper = query.toUpperCase();

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

      // Check for nested CASE
      if (
        queryUpper.substring(pos, pos + 4) === "CASE" &&
        this.isWordBoundary(query, pos, 4)
      ) {
        depth++;
        pos += 4;
        continue;
      }

      // Check for END
      if (
        queryUpper.substring(pos, pos + 3) === "END" &&
        this.isWordBoundary(query, pos, 3)
      ) {
        depth--;
        if (depth === 0) {
          const content = query.substring(startPos, pos + 3);
          return { content, length: content.length };
        }
        pos += 3;
        continue;
      }

      pos++;
    }

    if (depth > 0) {
      throw new CaseWhenTransformerError(
        `Unclosed CASE expression at position ${startPos}`
      );
    }

    return null;
  }

  /**
   * Check if position is at a word boundary (not part of a longer identifier).
   * In SPARQL, variables start with ? or $, so ?end should not be treated
   * as containing the keyword END.
   */
  private isWordBoundary(query: string, pos: number, wordLength: number): boolean {
    // Check character before the keyword
    const charBefore = pos > 0 ? query[pos - 1] : "";
    // In SPARQL, ? and $ prefix variables, so they indicate the keyword is part of a variable
    const beforeOk = pos === 0 || !/[a-zA-Z0-9_?$]/.test(charBefore);

    // Check character after the keyword
    const charAfter = pos + wordLength < query.length ? query[pos + wordLength] : "";
    const afterOk = pos + wordLength >= query.length || !/[a-zA-Z0-9_]/.test(charAfter);

    return beforeOk && afterOk;
  }

  /**
   * Convert a CASE ... END expression to nested IF expressions.
   */
  private convertCaseToIf(caseExpr: string): string {
    // Extract WHEN ... THEN ... pairs and ELSE clause
    const whenClauses = this.extractWhenClauses(caseExpr);
    const elseClause = this.extractElseClause(caseExpr);

    if (whenClauses.length === 0) {
      throw new CaseWhenTransformerError(
        "CASE expression must have at least one WHEN clause"
      );
    }

    // Build nested IF from the end
    // Start with ELSE value (or empty string if no ELSE)
    let result = elseClause !== null ? elseClause : '""';

    // Build nested IFs from last to first WHEN clause
    for (let i = whenClauses.length - 1; i >= 0; i--) {
      const { condition, result: thenResult } = whenClauses[i];
      result = `IF(${condition}, ${thenResult}, ${result})`;
    }

    return result;
  }

  /**
   * Extract all WHEN ... THEN ... pairs from the CASE expression.
   * Uses character-by-character parsing to properly handle parentheses and strings.
   */
  private extractWhenClauses(
    caseExpr: string
  ): Array<{ condition: string; result: string }> {
    const clauses: Array<{ condition: string; result: string }> = [];

    // Remove CASE and END keywords
    const content = caseExpr.replace(/^\s*CASE\s+/i, "").replace(/\s*END\s*$/i, "");

    // Find all WHEN positions that are at the top level (not inside parentheses or strings)
    const whenPositions = this.findKeywordPositions(content, "WHEN");

    // Find ELSE position if it exists
    const elsePositions = this.findKeywordPositions(content, "ELSE");
    const elsePos = elsePositions.length > 0 ? elsePositions[0] : content.length;

    for (let i = 0; i < whenPositions.length; i++) {
      const whenStart = whenPositions[i] + 4; // Skip "WHEN"
      const whenEnd =
        i + 1 < whenPositions.length
          ? whenPositions[i + 1]
          : elsePos;

      const whenContent = content.substring(whenStart, whenEnd).trim();
      const clause = this.parseWhenClause(whenContent);
      if (clause) {
        clauses.push(clause);
      }
    }

    return clauses;
  }

  /**
   * Find keyword positions that are at the top level (not inside parentheses or strings).
   */
  private findKeywordPositions(content: string, keyword: string): number[] {
    const positions: number[] = [];
    const contentUpper = content.toUpperCase();
    let pos = 0;
    let parenDepth = 0;

    while (pos < content.length) {
      const char = content[pos];

      // Skip string literals
      if (char === "'" || char === '"') {
        const quote = char;
        pos++;
        while (pos < content.length && content[pos] !== quote) {
          if (content[pos] === "\\") pos++;
          pos++;
        }
        pos++;
        continue;
      }

      // Track parentheses depth
      if (char === "(") {
        parenDepth++;
        pos++;
        continue;
      }

      if (char === ")") {
        parenDepth--;
        pos++;
        continue;
      }

      // Only match keyword at top level (parenDepth === 0)
      if (
        parenDepth === 0 &&
        contentUpper.substring(pos, pos + keyword.length) === keyword &&
        this.isWordBoundary(content, pos, keyword.length)
      ) {
        positions.push(pos);
        pos += keyword.length;
        continue;
      }

      pos++;
    }

    return positions;
  }

  /**
   * Parse a single WHEN ... THEN ... clause.
   */
  private parseWhenClause(
    whenContent: string
  ): { condition: string; result: string } | null {
    // Find THEN keyword at top level
    const thenPositions = this.findKeywordPositions(whenContent, "THEN");

    if (thenPositions.length === 0) {
      throw new CaseWhenTransformerError(
        `WHEN clause missing THEN keyword: ${whenContent.substring(0, 50)}...`
      );
    }

    const thenPos = thenPositions[0];
    const condition = whenContent.substring(0, thenPos).trim();
    const result = whenContent.substring(thenPos + 4).trim();

    if (!condition) {
      throw new CaseWhenTransformerError("WHEN clause has empty condition");
    }

    if (!result) {
      throw new CaseWhenTransformerError("WHEN clause has empty result");
    }

    return { condition, result };
  }

  /**
   * Extract the ELSE clause value from the CASE expression.
   */
  private extractElseClause(caseExpr: string): string | null {
    // Remove CASE and END keywords
    let content = caseExpr.replace(/^\s*CASE\s+/i, "").replace(/\s*END\s*$/i, "");

    // Find ELSE position at top level
    const elsePositions = this.findKeywordPositions(content, "ELSE");

    if (elsePositions.length > 0) {
      const elsePos = elsePositions[0];
      return content.substring(elsePos + 4).trim();
    }

    return null;
  }
}

/**
 * Error thrown when CASE WHEN transformation fails.
 */
export class CaseWhenTransformerError extends Error {
  constructor(message: string) {
    super(`CASE WHEN transformation error: ${message}`);
    this.name = "CaseWhenTransformerError";
  }
}
