/**
 * Transformer for extended DESCRIBE clause options (SPARQL 1.2).
 *
 * Extracts DEPTH and SYMMETRIC options from DESCRIBE queries and stores them
 * as metadata that can be used by the DescribeExecutor.
 *
 * SPARQL 1.2 extension syntax:
 * - DESCRIBE ?x DEPTH 2        - Limit description to 2 hops from resource
 * - DESCRIBE ?x SYMMETRIC      - Include both incoming and outgoing triples
 * - DESCRIBE ?x DEPTH 1 SYMMETRIC - Combine both options
 *
 * Since sparqljs doesn't support these options natively, this transformer:
 * 1. Extracts the options from the query string
 * 2. Removes them from the query for sparqljs to parse
 * 3. Stores them in a map keyed by a query hash
 */

export class DescribeOptionsTransformerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DescribeOptionsTransformerError";
  }
}

/**
 * Options for extended DESCRIBE behavior.
 */
export interface DescribeOptions {
  /**
   * Maximum depth to follow from the described resource.
   * Default behavior (undefined) means unlimited depth within direct triples.
   * DEPTH 1 means only direct triples (subject or object).
   * DEPTH 2 means follow one hop from direct results.
   */
  depth?: number;

  /**
   * Whether to include both incoming and outgoing triples.
   * Default behavior already includes both (resource as subject AND as object).
   * SYMMETRIC makes this explicit and ensures consistent behavior.
   */
  symmetric?: boolean;
}

/**
 * Result of transforming a DESCRIBE query with options.
 */
export interface DescribeTransformResult {
  /** The query string with DEPTH/SYMMETRIC removed (safe for sparqljs) */
  query: string;
  /** The extracted options, or undefined if no options found */
  options?: DescribeOptions;
}

export class DescribeOptionsTransformer {
  /**
   * Regex patterns for DESCRIBE options.
   * These patterns match after variable/IRI lists in DESCRIBE clause.
   *
   * Pattern breakdown:
   * - DEPTH followed by whitespace and a positive integer
   * - SYMMETRIC keyword
   * - These can appear in any order after DESCRIBE resources
   */
  private static readonly DEPTH_PATTERN = /\bDEPTH\s+(\d+)/gi;
  private static readonly SYMMETRIC_PATTERN = /\bSYMMETRIC\b/gi;

  /**
   * Pattern to match DESCRIBE queries and locate where options might appear.
   * DESCRIBE queries can have:
   * - DESCRIBE * WHERE { ... }
   * - DESCRIBE ?var1 ?var2 WHERE { ... }
   * - DESCRIBE <uri1> <uri2> WHERE { ... }
   * - DESCRIBE ?var <uri> DEPTH 2 SYMMETRIC WHERE { ... }
   */
  private static readonly DESCRIBE_QUERY_PATTERN = /\bDESCRIBE\b/i;

  /**
   * Transform a SPARQL query string to extract DESCRIBE options.
   *
   * @param queryString - The SPARQL query string
   * @returns Transform result with cleaned query and extracted options
   */
  transform(queryString: string): DescribeTransformResult {
    // Quick check if this is a DESCRIBE query
    if (!DescribeOptionsTransformer.DESCRIBE_QUERY_PATTERN.test(queryString)) {
      return { query: queryString };
    }

    let transformedQuery = queryString;
    const options: DescribeOptions = {};
    let hasOptions = false;

    // Extract DEPTH option
    const depthMatch = DescribeOptionsTransformer.DEPTH_PATTERN.exec(queryString);
    if (depthMatch) {
      const depth = parseInt(depthMatch[1], 10);
      if (depth < 0) {
        throw new DescribeOptionsTransformerError(
          `DESCRIBE DEPTH must be a non-negative integer, got: ${depth}`
        );
      }
      options.depth = depth;
      hasOptions = true;
      // Reset lastIndex for reuse
      DescribeOptionsTransformer.DEPTH_PATTERN.lastIndex = 0;
      // Remove DEPTH clause from query
      transformedQuery = transformedQuery.replace(
        DescribeOptionsTransformer.DEPTH_PATTERN,
        ""
      );
    }
    // Reset lastIndex after exec
    DescribeOptionsTransformer.DEPTH_PATTERN.lastIndex = 0;

    // Extract SYMMETRIC option
    if (DescribeOptionsTransformer.SYMMETRIC_PATTERN.test(queryString)) {
      options.symmetric = true;
      hasOptions = true;
      // Reset lastIndex for reuse
      DescribeOptionsTransformer.SYMMETRIC_PATTERN.lastIndex = 0;
      // Remove SYMMETRIC keyword from query
      transformedQuery = transformedQuery.replace(
        DescribeOptionsTransformer.SYMMETRIC_PATTERN,
        ""
      );
    }
    // Reset lastIndex after test
    DescribeOptionsTransformer.SYMMETRIC_PATTERN.lastIndex = 0;

    // Clean up any double spaces created by removal
    transformedQuery = transformedQuery.replace(/\s{2,}/g, " ").trim();

    return {
      query: transformedQuery,
      options: hasOptions ? options : undefined,
    };
  }

  /**
   * Check if a query string contains DESCRIBE options.
   *
   * @param queryString - The SPARQL query string
   * @returns true if the query contains DEPTH or SYMMETRIC options
   */
  hasDescribeOptions(queryString: string): boolean {
    const hasDepth = DescribeOptionsTransformer.DEPTH_PATTERN.test(queryString);
    DescribeOptionsTransformer.DEPTH_PATTERN.lastIndex = 0;

    const hasSymmetric = DescribeOptionsTransformer.SYMMETRIC_PATTERN.test(queryString);
    DescribeOptionsTransformer.SYMMETRIC_PATTERN.lastIndex = 0;

    return hasDepth || hasSymmetric;
  }
}
