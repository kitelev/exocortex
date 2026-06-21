import type { SolutionMapping } from "../SolutionMapping";

export class OptionalExecutor {
  async *execute(
    leftSolutions: AsyncIterableIterator<SolutionMapping>,
    rightSolutions: AsyncIterableIterator<SolutionMapping>
  ): AsyncIterableIterator<SolutionMapping> {
    const leftArray: SolutionMapping[] = [];
    for await (const solution of leftSolutions) {
      leftArray.push(solution);
    }

    const rightArray: SolutionMapping[] = [];
    for await (const solution of rightSolutions) {
      rightArray.push(solution);
    }

    yield* this.hashJoin(leftArray, rightArray);
  }

  async executeAll(
    leftSolutions: SolutionMapping[],
    rightSolutions: SolutionMapping[]
  ): Promise<SolutionMapping[]> {
    const results: SolutionMapping[] = [];
    for (const solution of this.hashJoin(leftSolutions, rightSolutions)) {
      results.push(solution);
    }
    return results;
  }

  private *hashJoin(
    leftArray: SolutionMapping[],
    rightArray: SolutionMapping[]
  ): IterableIterator<SolutionMapping> {
    if (leftArray.length === 0) return;
    if (rightArray.length === 0) {
      yield* leftArray;
      return;
    }

    // Find shared variables between left and right
    const leftVars = new Set<string>();
    for (const sol of leftArray) {
      for (const v of sol.variables()) {
        leftVars.add(v);
      }
    }

    const rightVars = new Set<string>();
    for (const sol of rightArray) {
      for (const v of sol.variables()) {
        rightVars.add(v);
      }
    }

    const sharedVars: string[] = [];
    for (const v of leftVars) {
      if (rightVars.has(v)) {
        sharedVars.push(v);
      }
    }
    sharedVars.sort();

    // No shared variables: cross-join fallback (nested-loop)
    if (sharedVars.length === 0) {
      yield* this.nestedLoopJoin(leftArray, rightArray);
      return;
    }

    // Build hash index on right solutions keyed by shared variable values
    const SEPARATOR = "\x00";
    const rightIndex = new Map<string, SolutionMapping[]>();

    for (const rightSol of rightArray) {
      const key = this.computeHashKey(rightSol, sharedVars, SEPARATOR);
      let bucket = rightIndex.get(key);
      if (!bucket) {
        bucket = [];
        rightIndex.set(key, bucket);
      }
      bucket.push(rightSol);
    }

    // Probe phase: for each left solution, look up matching right solutions
    for (const leftSol of leftArray) {
      const key = this.computeHashKey(leftSol, sharedVars, SEPARATOR);
      const candidates = rightIndex.get(key);
      let matched = false;

      if (candidates) {
        for (const rightSol of candidates) {
          const merged = leftSol.merge(rightSol);
          if (merged !== null) {
            yield merged;
            matched = true;
          }
        }
      }

      if (!matched) {
        yield leftSol;
      }
    }
  }

  private computeHashKey(
    solution: SolutionMapping,
    sharedVars: string[],
    separator: string
  ): string {
    const parts: string[] = [];
    for (const v of sharedVars) {
      const val = solution.get(v);
      parts.push(val !== undefined ? val.toString() : "\x01UNBOUND");
    }
    return parts.join(separator);
  }

  private *nestedLoopJoin(
    leftArray: SolutionMapping[],
    rightArray: SolutionMapping[]
  ): IterableIterator<SolutionMapping> {
    for (const leftSol of leftArray) {
      let matched = false;

      for (const rightSol of rightArray) {
        const merged = leftSol.merge(rightSol);
        if (merged !== null) {
          yield merged;
          matched = true;
        }
      }

      if (!matched) {
        yield leftSol;
      }
    }
  }
}
