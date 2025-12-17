/**
 * TripleTermTransformer - Transforms SPARQL 1.2 triple term syntax to standard RDF-Star syntax.
 *
 * SPARQL 1.2 introduces an alternative triple term syntax using parentheses:
 * `<<( subject predicate object )>>` which is equivalent to `<< subject predicate object >>`.
 *
 * The underlying sparqljs parser supports the standard `<< >>` syntax when sparqlStar mode
 * is enabled, but not the parenthesized `<<( )>>` variant.
 *
 * This transformer enables the parenthesized syntax by converting:
 *
 * ```sparql
 * FILTER(?triple = <<( :Alice :knows :Bob )>>)
 * ```
 *
 * to:
 *
 * ```sparql
 * FILTER(?triple = << :Alice :knows :Bob >>)
 * ```
 *
 * Supports:
 * - Basic triple terms: <<( :s :p :o )>>
 * - Triple terms with variables: <<( ?s :p ?o )>>
 * - Nested triple terms: <<( <<( :s :p :o )>> :source :doc )>>
 * - Multiple triple terms in a query
 * - Triple terms in FILTER, BIND, SELECT expressions, and graph patterns
 *
 * @see https://w3c.github.io/sparql-12/spec/ - SPARQL 1.2 Specification
 * @see https://w3c.github.io/rdf-star/cg-spec/ - RDF-Star Specification
 */
export class TripleTermTransformer {
  /**
   * Transform all triple term syntax `<<( s p o )>>` to standard `<< s p o >>`.
   *
   * @param query - The SPARQL query string that may contain <<( )>> syntax
   * @returns The transformed query with <<( )>> replaced by << >>
   * @throws TripleTermTransformerError if syntax is malformed
   */
  transform(query: string): string {
    // Keep transforming until no more <<( patterns are found
    // (handles nested triple terms)
    let result = query;
    let transformed: string;
    let iterationCount = 0;
    const maxIterations = 100; // Prevent infinite loops

    do {
      transformed = result;
      result = this.transformSinglePass(result);
      iterationCount++;
      if (iterationCount > maxIterations) {
        throw new TripleTermTransformerError(
          "Too many nested triple terms (max 100 iterations)"
        );
      }
    } while (result !== transformed);

    return result;
  }

  /**
   * Check if a query contains triple term syntax that needs transformation.
   * This method correctly handles string literals (won't match <<( inside strings).
   *
   * @param query - The SPARQL query to check
   * @returns true if the query contains <<( )>> syntax
   */
  hasTripleTermSyntax(query: string): boolean {
    // Use findTripleTermPositions which handles string literals correctly
    return this.findTripleTermPositions(query).length > 0;
  }

  /**
   * Perform a single pass of triple term transformation.
   * Finds and transforms the innermost triple terms first.
   */
  private transformSinglePass(query: string): string {
    // Find all <<( positions (skipping those inside strings)
    const positions = this.findTripleTermPositions(query);

    if (positions.length === 0) {
      return query;
    }

    let result = query;

    // Process in reverse order to maintain valid positions
    for (let i = positions.length - 1; i >= 0; i--) {
      const startPos = positions[i];
      const tripleTerm = this.extractTripleTerm(result, startPos);
      if (tripleTerm) {
        const standardSyntax = this.convertToStandardSyntax(tripleTerm.content);
        result =
          result.substring(0, startPos) +
          standardSyntax +
          result.substring(startPos + tripleTerm.length);
      }
    }

    return result;
  }

  /**
   * Find all <<( positions that are NOT inside string literals.
   */
  private findTripleTermPositions(query: string): number[] {
    const positions: number[] = [];
    let pos = 0;

    while (pos < query.length) {
      // Skip string literals (single quoted)
      if (query[pos] === "'") {
        pos = this.skipStringLiteral(query, pos, "'");
        continue;
      }

      // Skip string literals (double quoted)
      if (query[pos] === '"') {
        pos = this.skipStringLiteral(query, pos, '"');
        continue;
      }

      // Check for <<( pattern
      if (
        query.substring(pos, pos + 2) === "<<" &&
        this.isParenthesizedTripleTerm(query, pos)
      ) {
        positions.push(pos);
        pos += 2;
        continue;
      }

      pos++;
    }

    return positions;
  }

  /**
   * Skip over a string literal and return the position after the closing quote.
   */
  private skipStringLiteral(query: string, pos: number, quote: string): number {
    // Check for long string literal (triple quotes)
    const tripleQuote = quote.repeat(3);
    if (query.substring(pos, pos + 3) === tripleQuote) {
      pos += 3;
      while (pos < query.length) {
        if (query.substring(pos, pos + 3) === tripleQuote) {
          return pos + 3;
        }
        if (query[pos] === "\\") pos++;
        pos++;
      }
      return pos;
    }

    // Single quote string
    pos++;
    while (pos < query.length && query[pos] !== quote) {
      if (query[pos] === "\\") pos++; // Skip escaped characters
      pos++;
    }
    return pos + 1; // Skip closing quote
  }

  /**
   * Check if the << at position is followed by ( (with optional whitespace).
   */
  private isParenthesizedTripleTerm(query: string, pos: number): boolean {
    let checkPos = pos + 2; // After <<
    // Skip whitespace
    while (checkPos < query.length && /\s/.test(query[checkPos])) {
      checkPos++;
    }
    return query[checkPos] === "(";
  }

  /**
   * Extract a complete <<( ... )>> triple term expression from the query string.
   */
  private extractTripleTerm(
    query: string,
    startPos: number
  ): { content: string; length: number } | null {
    // Skip << and find opening (
    let pos = startPos + 2;
    while (pos < query.length && /\s/.test(query[pos])) {
      pos++;
    }

    if (query[pos] !== "(") {
      return null;
    }

    // Find matching )>> accounting for nested structures
    pos++; // Skip opening (
    let depth = 1;

    while (pos < query.length && depth > 0) {
      // Skip strings
      if (query[pos] === "'" || query[pos] === '"') {
        pos = this.skipStringLiteral(query, pos, query[pos]);
        continue;
      }

      // Check for nested <<(
      if (
        query.substring(pos, pos + 2) === "<<" &&
        this.isParenthesizedTripleTerm(query, pos)
      ) {
        // Skip to the opening ( of nested term and increase depth
        pos += 2;
        while (pos < query.length && /\s/.test(query[pos])) {
          pos++;
        }
        if (query[pos] === "(") {
          depth++;
          pos++;
        }
        continue;
      }

      // Check for standard << (without parentheses) - skip over it
      if (query.substring(pos, pos + 2) === "<<") {
        pos += 2;
        // Find matching >>
        let nestedDepth = 1;
        while (pos < query.length && nestedDepth > 0) {
          if (query[pos] === "'" || query[pos] === '"') {
            pos = this.skipStringLiteral(query, pos, query[pos]);
            continue;
          }
          if (query.substring(pos, pos + 2) === "<<") {
            nestedDepth++;
            pos += 2;
            continue;
          }
          if (query.substring(pos, pos + 2) === ">>") {
            nestedDepth--;
            pos += 2;
            continue;
          }
          pos++;
        }
        continue;
      }

      // Track parentheses
      if (query[pos] === "(") {
        depth++;
        pos++;
        continue;
      }

      // Check for )>>
      if (query[pos] === ")") {
        // Look ahead for >>
        let lookAhead = pos + 1;
        while (lookAhead < query.length && /\s/.test(query[lookAhead])) {
          lookAhead++;
        }

        if (query.substring(lookAhead, lookAhead + 2) === ">>") {
          depth--;
          if (depth === 0) {
            const content = query.substring(startPos, lookAhead + 2);
            return { content, length: content.length };
          }
          pos = lookAhead + 2;
          continue;
        }

        // Regular parenthesis, not part of )>>
        pos++;
        continue;
      }

      pos++;
    }

    if (depth > 0) {
      throw new TripleTermTransformerError(
        `Unclosed triple term at position ${startPos}: missing )>>`
      );
    }

    return null;
  }

  /**
   * Convert <<( s p o )>> to << s p o >>.
   */
  private convertToStandardSyntax(tripleTerm: string): string {
    // Remove <<( at start and )>> at end, preserving internal content
    // Handle optional whitespace: <<( content )>> -> << content >>

    // Match pattern: <<\s*(\s* content \s*)\s*>>
    const match = tripleTerm.match(/^<<\s*\(\s*([\s\S]*?)\s*\)\s*>>$/);
    if (!match) {
      throw new TripleTermTransformerError(
        `Invalid triple term syntax: ${tripleTerm.substring(0, 50)}...`
      );
    }

    const content = match[1];
    return `<< ${content} >>`;
  }
}

/**
 * Error thrown when triple term transformation fails.
 */
export class TripleTermTransformerError extends Error {
  constructor(message: string) {
    super(`Triple term transformation error: ${message}`);
    this.name = "TripleTermTransformerError";
  }
}
