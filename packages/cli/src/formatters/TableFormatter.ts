import type { SolutionMapping } from "exocortex";

export class TableFormatter {
  format(results: SolutionMapping[]): string {
    if (results.length === 0) {
      return "No results";
    }

    const allVariables = this.getAllVariables(results);
    const rows = results.map((solution) => this.solutionToRow(solution, allVariables));

    return this.renderTable(allVariables, rows);
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

  private solutionToRow(solution: SolutionMapping, variables: string[]): string[] {
    return variables.map((variable) => {
      const value = solution.get(variable);
      return value ? this.formatValue(value.toString()) : "";
    });
  }

  private formatValue(value: string): string {
    if (value.length > 50) {
      return value.substring(0, 47) + "...";
    }
    return value;
  }

  private renderTable(headers: string[], rows: string[][]): string {
    const columns = headers.map((h, i) => {
      const headerWidth = h.length + 1;
      const maxDataWidth = Math.max(...rows.map((r) => r[i]?.length || 0));
      return Math.max(headerWidth, maxDataWidth, 10);
    });

    const lines: string[] = [];

    lines.push(this.renderSeparator(columns, "top"));
    lines.push(this.renderRow(headers.map((h) => `?${h}`), columns));
    lines.push(this.renderSeparator(columns, "mid"));

    for (const row of rows) {
      lines.push(this.renderRow(row, columns));
    }

    lines.push(this.renderSeparator(columns, "bottom"));

    return lines.join("\n");
  }

  private renderRow(cells: string[], widths: number[]): string {
    const paddedCells = cells.map((cell, i) => cell.padEnd(widths[i]));
    return `│ ${paddedCells.join(" │ ")} │`;
  }

  private renderSeparator(widths: number[], position: "top" | "mid" | "bottom"): string {
    const left = position === "top" ? "┌" : position === "mid" ? "├" : "└";
    const right = position === "top" ? "┐" : position === "mid" ? "┤" : "┘";
    const cross = position === "mid" ? "┼" : "─";
    const sep = position === "mid" ? "─┼─" : "─" + cross + "─";

    const segments = widths.map((w) => "─".repeat(w + 2));
    return `${left}${segments.join(sep)}${right}`;
  }
}
