import type { SolutionMapping } from "@kitelev/exocortex-core";

export class JsonFormatter {
  format(results: SolutionMapping[]): string {
    const jsonResults = results.map((solution) => solution.toJSON());
    return JSON.stringify(jsonResults, null, 2);
  }
}
