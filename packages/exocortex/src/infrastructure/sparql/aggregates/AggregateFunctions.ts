import type { SolutionMapping } from "../SolutionMapping";
import { Literal } from "../../../domain/models/rdf/Literal";
import { IRI } from "../../../domain/models/rdf/IRI";

export type AggregateResult = string | number;

export class AggregateFunctions {
  static count(solutions: SolutionMapping[], variable?: string): number {
    if (!variable) {
      return solutions.length;
    }

    let count = 0;
    for (const solution of solutions) {
      if (solution.has(variable)) {
        count++;
      }
    }
    return count;
  }

  static countDistinct(solutions: SolutionMapping[], variable: string): number {
    const seen = new Set<string>();
    for (const solution of solutions) {
      const value = solution.get(variable);
      if (value) {
        seen.add(value.toString());
      }
    }
    return seen.size;
  }

  static sum(solutions: SolutionMapping[], variable: string): number {
    let total = 0;
    for (const solution of solutions) {
      const value = solution.get(variable);
      if (value instanceof Literal) {
        const num = this.toNumber(value);
        if (!isNaN(num)) {
          total += num;
        }
      }
    }
    return total;
  }

  static avg(solutions: SolutionMapping[], variable: string): number {
    const sum = this.sum(solutions, variable);
    const count = this.count(solutions, variable);
    return count > 0 ? sum / count : 0;
  }

  static min(solutions: SolutionMapping[], variable: string): AggregateResult | null {
    let minValue: number | string | null = null;

    for (const solution of solutions) {
      const value = solution.get(variable);
      if (!value) continue;

      const comparable = this.toComparable(value);
      if (minValue === null || comparable < minValue) {
        minValue = comparable;
      }
    }

    return minValue;
  }

  static max(solutions: SolutionMapping[], variable: string): AggregateResult | null {
    let maxValue: number | string | null = null;

    for (const solution of solutions) {
      const value = solution.get(variable);
      if (!value) continue;

      const comparable = this.toComparable(value);
      if (maxValue === null || comparable > maxValue) {
        maxValue = comparable;
      }
    }

    return maxValue;
  }

  static groupConcat(solutions: SolutionMapping[], variable: string, separator: string = " "): string {
    const values: string[] = [];

    for (const solution of solutions) {
      const value = solution.get(variable);
      if (value) {
        if (value instanceof Literal) {
          values.push(value.value);
        } else if (value instanceof IRI) {
          values.push(value.value);
        } else {
          values.push(value.toString());
        }
      }
    }

    return values.join(separator);
  }

  private static toNumber(literal: Literal): number {
    const datatype = literal.datatype?.value;
    if (datatype?.includes("#integer") || datatype?.includes("#decimal") || datatype?.includes("#double")) {
      return parseFloat(literal.value);
    }
    return parseFloat(literal.value);
  }

  private static toComparable(value: any): number | string {
    if (value instanceof Literal) {
      const num = this.toNumber(value);
      if (!isNaN(num)) {
        return num;
      }
      return value.value;
    }

    if (value instanceof IRI) {
      return value.value;
    }

    return String(value);
  }
}
