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

    for (const leftSolution of leftArray) {
      let matched = false;

      for (const rightSolution of rightArray) {
        const merged = leftSolution.merge(rightSolution);
        if (merged !== null) {
          yield merged;
          matched = true;
        }
      }

      if (!matched) {
        yield leftSolution;
      }
    }
  }

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
}
