import type { SolutionMapping } from "../SolutionMapping";

/**
 * Executes SPARQL MINUS operator for set difference.
 *
 * MINUS removes solutions from the left side that are **compatible** with
 * any solution from the right side.
 *
 * Semantics (SPARQL 1.1 Section 18.5):
 * - Two solutions μ1 and μ2 are compatible if for every variable v in
 *   dom(μ1) ∩ dom(μ2), we have μ1(v) = μ2(v)
 * - Diff(Ω1, Ω2) = { μ | μ in Ω1 such that for all μ' in Ω2, μ and μ' are not compatible }
 *
 * Key difference from FILTER NOT EXISTS:
 * - MINUS operates on solution sets: removes left solutions compatible with ANY right solution
 * - FILTER NOT EXISTS evaluates the pattern for EACH left solution with substituted variables
 * - If patterns have no shared variables, MINUS removes nothing (solutions always compatible)
 * - FILTER NOT EXISTS would remove everything if pattern matches
 *
 * Example:
 * ```sparql
 * SELECT ?task WHERE {
 *   ?task a ems:Task .
 *   MINUS { ?task ems:status "done" }
 * }
 * ```
 * Returns all tasks except those with status "done"
 */
export class MinusExecutor {
  /**
   * Execute MINUS operation: remove left solutions compatible with any right solution.
   *
   * @param leftSolutions - The input solution set (preceding patterns)
   * @param rightSolutions - The solutions to subtract (MINUS pattern results)
   * @returns Solutions from left that are NOT compatible with any solution in right
   */
  async *execute(
    leftSolutions: AsyncIterableIterator<SolutionMapping>,
    rightSolutions: AsyncIterableIterator<SolutionMapping>
  ): AsyncIterableIterator<SolutionMapping> {
    // Collect both solution sets (need random access for compatibility checks)
    const leftArray: SolutionMapping[] = [];
    for await (const solution of leftSolutions) {
      leftArray.push(solution);
    }

    const rightArray: SolutionMapping[] = [];
    for await (const solution of rightSolutions) {
      rightArray.push(solution);
    }

    // For each left solution, check if compatible with ANY right solution
    for (const leftSolution of leftArray) {
      let shouldExclude = false;

      for (const rightSolution of rightArray) {
        if (this.areCompatible(leftSolution, rightSolution)) {
          shouldExclude = true;
          break; // No need to check further
        }
      }

      // Only yield solutions that are NOT compatible with any right solution
      if (!shouldExclude) {
        yield leftSolution;
      }
    }
  }

  /**
   * Execute MINUS with pre-collected solution arrays.
   * Convenience method for testing and when solutions are already collected.
   */
  async executeAll(
    leftSolutions: SolutionMapping[],
    rightSolutions: SolutionMapping[]
  ): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];

    async function* generateLeft() {
      for (const solution of leftSolutions) {
        yield solution;
      }
    }

    async function* generateRight() {
      for (const solution of rightSolutions) {
        yield solution;
      }
    }

    for await (const solution of this.execute(generateLeft(), generateRight())) {
      results.push(solution);
    }

    return results;
  }

  /**
   * Check if two solution mappings are compatible for MINUS semantics.
   *
   * SPARQL 1.1 Diff semantics (Section 18.5):
   * Diff(Ω1, Ω2) = { μ | μ in Ω1 such that for all μ' in Ω2,
   *                 μ and μ' are NOT compatible OR dom(μ) ∩ dom(μ') = ∅ }
   *
   * This means μ is KEPT if:
   * - For all μ' in Ω2: either they disagree on some shared variable, OR they have no shared variables
   *
   * This means μ is REMOVED if:
   * - There exists μ' in Ω2: they agree on all shared variables AND they have at least one shared variable
   *
   * @param left - Left solution mapping
   * @param right - Right solution mapping
   * @returns true if the left solution should be excluded (i.e., it's compatible with right
   *          AND they share at least one variable)
   */
  private areCompatible(left: SolutionMapping, right: SolutionMapping): boolean {
    const leftVars = left.variables();
    const rightVars = new Set(right.variables());

    // Find shared variables
    const sharedVars = leftVars.filter((v) => rightVars.has(v));

    // If no shared variables, domains are disjoint - solutions are NOT "compatible" for MINUS
    // (MINUS with no shared variables removes nothing)
    if (sharedVars.length === 0) {
      return false;
    }

    // Check if all shared variables have the same value
    for (const varName of sharedVars) {
      const leftValue = left.get(varName);
      const rightValue = right.get(varName);

      if (leftValue === undefined || rightValue === undefined) {
        // Unbound variable - not compatible
        return false;
      }

      // Compare string representations (works for IRI, Literal, BlankNode)
      if (leftValue.toString() !== rightValue.toString()) {
        return false;
      }
    }

    // All shared variables agree - solutions are compatible, left should be excluded
    return true;
  }
}
