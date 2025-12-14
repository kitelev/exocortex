import type { SolutionMapping } from "exocortex";

export class JsonFormatter {
  format(results: SolutionMapping[]): string {
    const jsonResults = results.map((solution) => solution.toJSON());
    return JSON.stringify(jsonResults, null, 2);
  }
}
