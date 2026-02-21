import type { SolutionMapping } from "exocortex";

/**
 * Formats SPARQL query results as CSV (RFC 4180 compliant).
 * Handles proper escaping of commas, quotes, and newlines.
 */
export class CsvFormatter {
  format(results: SolutionMapping[]): string {
    if (results.length === 0) {
      return "";
    }

    const allVariables = this.getAllVariables(results);
    const lines: string[] = [];

    // Header row
    lines.push(allVariables.join(","));

    // Data rows
    for (const solution of results) {
      const row = allVariables.map((variable) => {
        const value = solution.get(variable);
        return value ? this.escapeValue(value.toString()) : "";
      });
      lines.push(row.join(","));
    }

    return lines.join("\n");
  }

  private getAllVariables(results: SolutionMapping[]): string[] {
    const variableSet = new Set<string>();
    for (const solution of results) {
      for (const variable of solution.variables()) {
        variableSet.add(variable);
      }
    }
    return Array.from(variableSet).sort();
  }

  /**
   * Escape a value for CSV output according to RFC 4180.
   * Values containing commas, quotes, or newlines must be wrapped in quotes.
   * Quotes within values must be doubled.
   */
  private escapeValue(value: string): string {
    const needsQuoting = value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");

    if (!needsQuoting) {
      return value;
    }

    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }
}
