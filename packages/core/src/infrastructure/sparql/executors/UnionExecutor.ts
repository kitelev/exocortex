import type { SolutionMapping } from "../SolutionMapping";

export class UnionExecutor {
  async *execute(
    leftSolutions: AsyncIterableIterator<SolutionMapping>,
    rightSolutions: AsyncIterableIterator<SolutionMapping>
  ): AsyncIterableIterator<SolutionMapping> {
    const seen = new Set<string>();

    for await (const solution of leftSolutions) {
      const key = this.getSolutionKey(solution);
      if (!seen.has(key)) {
        seen.add(key);
        yield solution;
      }
    }

    for await (const solution of rightSolutions) {
      const key = this.getSolutionKey(solution);
      if (!seen.has(key)) {
        seen.add(key);
        yield solution;
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

  private getSolutionKey(solution: SolutionMapping): string {
    const json = solution.toJSON();
    const keys = Object.keys(json).sort();
    return keys.map((k) => `${k}=${json[k]}`).join("|");
  }
}
