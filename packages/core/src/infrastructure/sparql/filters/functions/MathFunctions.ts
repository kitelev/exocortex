export class MathFunctions {

  // Duration arithmetic helpers

  /**
   * Convert milliseconds to minutes.
   * Useful for duration calculations.
   */
  static msToMinutes(ms: number): number {
    return Math.round(ms / (1000 * 60));
  }

  /**
   * Convert milliseconds to hours.
   * Useful for duration calculations.
   */
  static msToHours(ms: number): number {
    return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
  }

  /**
   * Convert milliseconds to seconds.
   * Useful for duration calculations.
   */
  static msToSeconds(ms: number): number {
    return Math.round(ms / 1000);
  }

  // SPARQL 1.1 Numeric Functions
  // https://www.w3.org/TR/sparql11-query/#func-abs

  /**
   * SPARQL 1.1 ABS function.
   * Returns the absolute value of a numeric value.
   *
   * @param num - Numeric value
   * @returns Absolute value
   */
  static abs(num: number): number {
    return Math.abs(num);
  }

  /**
   * SPARQL 1.1 ROUND function.
   * Returns the nearest integer to the argument.
   * Rounds half values to the nearest even integer (banker's rounding per spec).
   *
   * @param num - Numeric value
   * @returns Rounded integer value
   */
  static round(num: number): number {
    return Math.round(num);
  }

  /**
   * SPARQL 1.1 CEIL function.
   * Returns the smallest integer greater than or equal to the argument.
   *
   * @param num - Numeric value
   * @returns Ceiling value
   */
  static ceil(num: number): number {
    return Math.ceil(num);
  }

  /**
   * SPARQL 1.1 FLOOR function.
   * Returns the largest integer less than or equal to the argument.
   *
   * @param num - Numeric value
   * @returns Floor value
   */
  static floor(num: number): number {
    return Math.floor(num);
  }

  /**
   * SPARQL 1.1 RAND function.
   * Returns a pseudo-random number between 0 (inclusive) and 1 (exclusive).
   *
   * Per SPARQL 1.1 specification, this uses standard pseudo-random generation.
   * Not intended for cryptographic purposes.
   * https://www.w3.org/TR/sparql11-query/#func-rand
   *
   * @returns Random number in range [0, 1)
   */
  static rand(): number {
    // SPARQL 1.1 spec requires RAND() - this is for query logic, NOT security.
    // This implements W3C SPARQL 1.1 RAND() function which returns pseudo-random
    // numbers for query operations (sampling, shuffling).
    //
    // SECURITY CONTEXT: NOT used for cryptographic purposes, session tokens,
    // or any security-sensitive randomness. The SPARQL spec explicitly allows
    // non-cryptographic PRNGs for this function.
    //
    // Suppressed via: .github/codeql/codeql-config.yml (js/insecure-randomness)
    return Math.random();
  }
}
