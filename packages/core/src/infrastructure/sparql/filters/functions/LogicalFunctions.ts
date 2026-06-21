import type { RDFTerm } from "./types";

import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../../domain/models/rdf/BlankNode";
import { DateTimeFunctions } from "./DateTimeFunctions";

export class LogicalFunctions {

  static compare(a: RDFTerm | string | number, b: RDFTerm | string | number, operator: string): boolean {
    // Check if both values are xsd:dayTimeDuration for special comparison
    if (LogicalFunctions.isDayTimeDurationValue(a) && LogicalFunctions.isDayTimeDurationValue(b)) {
      return DateTimeFunctions.compareDurations(
        a instanceof Literal ? a : String(a),
        b instanceof Literal ? b : String(b),
        operator
      );
    }

    // Handle mixed duration comparison: one side is a duration Literal,
    // the other is a raw duration string (from literal expression evaluation)
    if (LogicalFunctions.isDayTimeDurationValue(a) && typeof b === "string" && /^-?P/.test(b)) {
      return DateTimeFunctions.compareDurations(
        a instanceof Literal ? a : String(a),
        b,
        operator
      );
    }
    if (typeof a === "string" && /^-?P/.test(a) && LogicalFunctions.isDayTimeDurationValue(b)) {
      return DateTimeFunctions.compareDurations(
        a,
        b instanceof Literal ? b : String(b),
        operator
      );
    }

    const aValue = LogicalFunctions.toComparableValue(a);
    const bValue = LogicalFunctions.toComparableValue(b);

    switch (operator) {
      case "=":
        return aValue === bValue;
      case "!=":
        return aValue !== bValue;
      case "<":
        return aValue < bValue;
      case ">":
        return aValue > bValue;
      case "<=":
        return aValue <= bValue;
      case ">=":
        return aValue >= bValue;
      default:
        throw new Error(`Unknown comparison operator: ${operator}`);
    }
  }

  /**
   * Check if a value is or represents an xsd:dayTimeDuration.
   * Used internally by compare() to detect duration comparisons.
   */
  private static isDayTimeDurationValue(value: RDFTerm | string | number): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#dayTimeDuration";
    }
    return false;
  }

  private static toComparableValue(value: RDFTerm | string | number): string | number {
    if (typeof value === "string" || typeof value === "number") {
      return value;
    }

    if (value instanceof Literal) {
      const datatype = value.datatype?.value;
      if (datatype?.includes("#integer") || datatype?.includes("#decimal") || datatype?.includes("#double")) {
        const num = parseFloat(value.value);
        if (!isNaN(num)) {
          return num;
        }
      }
      // For xsd:dayTimeDuration, convert to milliseconds for numeric comparison
      if (datatype === "http://www.w3.org/2001/XMLSchema#dayTimeDuration") {
        try {
          return DateTimeFunctions.parseDayTimeDuration(value.value);
        } catch {
          return value.value;
        }
      }
      return value.value;
    }

    if (value instanceof IRI) {
      return value.value;
    }

    if (value instanceof BlankNode) {
      return value.id;
    }

    return String(value);
  }

  static logicalAnd(operands: boolean[]): boolean {
    return operands.every((op) => op === true);
  }

  static logicalOr(operands: boolean[]): boolean {
    return operands.some((op) => op === true);
  }

  static logicalNot(operand: boolean): boolean {
    return !operand;
  }

  // SPARQL 1.1 Conditional Functions
  // https://www.w3.org/TR/sparql11-query/#func-coalesce
  // https://www.w3.org/TR/sparql11-query/#func-if

  /**
   * SPARQL 1.1 COALESCE function.
   * Returns the first non-error, non-unbound argument.
   *
   * Per SPARQL spec, COALESCE evaluates arguments lazily and returns
   * the first one that does not raise an error or is not unbound.
   *
   * @param values - Array of values to check
   * @returns First non-null/non-undefined value, or undefined if all are unbound/errors
   */
  static coalesce<T>(values: (T | undefined | null)[]): T | undefined {
    for (const value of values) {
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * SPARQL 1.1 IF function.
   * Returns one of two values based on a boolean condition.
   *
   * IF(condition, thenExpr, elseExpr) returns:
   * - thenExpr if condition is true
   * - elseExpr if condition is false
   * - error if condition raises an error
   *
   * @param condition - Boolean condition
   * @param thenValue - Value to return if condition is true
   * @param elseValue - Value to return if condition is false
   * @returns thenValue if condition is true, otherwise elseValue
   */
  static if<T>(condition: boolean, thenValue: T, elseValue: T): T {
    return condition ? thenValue : elseValue;
  }
}
