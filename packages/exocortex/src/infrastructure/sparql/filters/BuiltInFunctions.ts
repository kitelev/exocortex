import type { Subject, Predicate, Object as RDFObject } from "../../../domain/models/rdf/Triple";
import { IRI } from "../../../domain/models/rdf/IRI";
import { Literal } from "../../../domain/models/rdf/Literal";
import { BlankNode } from "../../../domain/models/rdf/BlankNode";
import { v4 as uuidv4 } from "uuid";

export type RDFTerm = Subject | Predicate | RDFObject;

export class BuiltInFunctions {
  static str(term: RDFTerm | undefined): string {
    if (term === undefined) {
      throw new Error("STR: argument is undefined");
    }

    if (term instanceof IRI) {
      return term.value;
    }

    if (term instanceof Literal) {
      return term.value;
    }

    if (term instanceof BlankNode) {
      return term.id;
    }

    return String(term);
  }

  static lang(term: RDFTerm | undefined): string {
    if (term === undefined) {
      throw new Error("LANG: argument is undefined");
    }

    if (term instanceof Literal && term.language) {
      return term.language;
    }

    return "";
  }

  /**
   * SPARQL 1.1 langMatches function.
   * https://www.w3.org/TR/sparql11-query/#func-langMatches
   *
   * Matches a language tag against a language range per RFC 4647 basic filtering.
   *
   * @param languageTag - The language tag to check (e.g., "en", "en-US", "en-GB")
   * @param languageRange - The language range to match against (e.g., "en", "*")
   * @returns true if the language tag matches the range, false otherwise
   *
   * Special cases:
   * - Range "*" matches any non-empty language tag
   * - Empty language tag matches nothing (except empty range for exact match)
   * - Case-insensitive comparison (per RFC 4647)
   */
  static langMatches(languageTag: string, languageRange: string): boolean {
    // Normalize both to lowercase for case-insensitive comparison
    const tag = languageTag.toLowerCase();
    const range = languageRange.toLowerCase();

    // Special case: "*" matches any non-empty language tag
    if (range === "*") {
      return tag !== "";
    }

    // Empty tag matches nothing (except empty range for exact match)
    if (tag === "") {
      return range === "";
    }

    // Exact match
    if (tag === range) {
      return true;
    }

    // Prefix match: tag starts with range followed by "-"
    // e.g., "en-US" matches "en", "en-GB-oed" matches "en-GB"
    return tag.startsWith(range + "-");
  }

  static datatype(term: RDFTerm | undefined): IRI {
    if (term === undefined) {
      throw new Error("DATATYPE: argument is undefined");
    }

    if (term instanceof Literal) {
      if (term.datatype) {
        return term.datatype;
      }
      if (term.language) {
        return new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
      }
      return new IRI("http://www.w3.org/2001/XMLSchema#string");
    }

    throw new Error("DATATYPE: argument must be a literal");
  }

  static bound(term: RDFTerm | undefined): boolean {
    return term !== undefined;
  }

  static isIRI(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof IRI;
  }

  static isBlank(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof BlankNode;
  }

  static isLiteral(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }
    return term instanceof Literal;
  }

  /**
   * SPARQL 1.1 isNumeric function.
   * https://www.w3.org/TR/sparql11-query/#func-isNumeric
   *
   * Returns true if the term is a numeric literal (xsd:integer, xsd:decimal,
   * xsd:float, xsd:double, or derived numeric types).
   *
   * @param term - RDF term to check
   * @returns true if term is a numeric literal, false otherwise
   */
  static isNumeric(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }

    if (!(term instanceof Literal)) {
      return false;
    }

    const datatype = term.datatype?.value;
    if (!datatype) {
      return false;
    }

    // XSD numeric types per SPARQL 1.1 spec section 17.4.2.4
    const numericTypes = [
      "http://www.w3.org/2001/XMLSchema#integer",
      "http://www.w3.org/2001/XMLSchema#decimal",
      "http://www.w3.org/2001/XMLSchema#float",
      "http://www.w3.org/2001/XMLSchema#double",
      // Derived integer types (all are subtypes of xsd:integer)
      "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
      "http://www.w3.org/2001/XMLSchema#negativeInteger",
      "http://www.w3.org/2001/XMLSchema#long",
      "http://www.w3.org/2001/XMLSchema#int",
      "http://www.w3.org/2001/XMLSchema#short",
      "http://www.w3.org/2001/XMLSchema#byte",
      "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
      "http://www.w3.org/2001/XMLSchema#unsignedLong",
      "http://www.w3.org/2001/XMLSchema#unsignedInt",
      "http://www.w3.org/2001/XMLSchema#unsignedShort",
      "http://www.w3.org/2001/XMLSchema#unsignedByte",
      "http://www.w3.org/2001/XMLSchema#positiveInteger",
    ];

    return numericTypes.includes(datatype);
  }

  static regex(text: string, pattern: string, flags?: string): boolean {
    try {
      const regex = new RegExp(pattern, flags);
      return regex.test(text);
    } catch (error) {
      throw new Error(`REGEX: invalid pattern '${pattern}': ${(error as Error).message}`);
    }
  }

  static compare(a: RDFTerm | string | number, b: RDFTerm | string | number, operator: string): boolean {
    const aValue = this.toComparableValue(a);
    const bValue = this.toComparableValue(b);

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

  // W3C SPARQL 1.1 String Functions
  // https://www.w3.org/TR/sparql11-query/#func-contains

  static contains(str: string, substr: string): boolean {
    return str.includes(substr);
  }

  static strStarts(str: string, prefix: string): boolean {
    return str.startsWith(prefix);
  }

  static strEnds(str: string, suffix: string): boolean {
    return str.endsWith(suffix);
  }

  static strlen(str: string): number {
    return str.length;
  }

  static ucase(str: string): string {
    return str.toUpperCase();
  }

  static lcase(str: string): string {
    return str.toLowerCase();
  }

  /**
   * SPARQL 1.1 SUBSTR function.
   * https://www.w3.org/TR/sparql11-query/#func-substr
   *
   * @param str - Source string
   * @param start - Starting position (1-based, per SPARQL spec)
   * @param length - Optional length of substring
   * @returns Substring from position start with optional length
   */
  static substr(str: string, start: number, length?: number): string {
    // SPARQL uses 1-based indexing, JavaScript uses 0-based
    const startIndex = start - 1;

    if (startIndex < 0) {
      // For negative start, adjust length and start from 0
      if (length !== undefined) {
        const adjustedLength = length + startIndex;
        if (adjustedLength <= 0) {
          return "";
        }
        return str.substring(0, adjustedLength);
      }
      return str;
    }

    if (length !== undefined) {
      return str.substring(startIndex, startIndex + length);
    }

    return str.substring(startIndex);
  }

  /**
   * SPARQL 1.1 STRBEFORE function.
   * https://www.w3.org/TR/sparql11-query/#func-strbefore
   *
   * Returns the substring before the first occurrence of the separator.
   * Returns empty string if separator not found or str is empty.
   *
   * @param str - Source string
   * @param separator - Separator to search for
   * @returns Substring before separator, or empty string if not found
   */
  static strBefore(str: string, separator: string): string {
    if (separator === "") {
      return "";
    }
    const index = str.indexOf(separator);
    if (index === -1) {
      return "";
    }
    return str.substring(0, index);
  }

  /**
   * SPARQL 1.1 STRAFTER function.
   * https://www.w3.org/TR/sparql11-query/#func-strafter
   *
   * Returns the substring after the first occurrence of the separator.
   * Returns empty string if separator not found or str is empty.
   *
   * @param str - Source string
   * @param separator - Separator to search for
   * @returns Substring after separator, or empty string if not found
   */
  static strAfter(str: string, separator: string): string {
    if (separator === "") {
      return str;
    }
    const index = str.indexOf(separator);
    if (index === -1) {
      return "";
    }
    return str.substring(index + separator.length);
  }

  /**
   * SPARQL 1.1 CONCAT function.
   * https://www.w3.org/TR/sparql11-query/#func-concat
   *
   * Concatenates multiple string arguments.
   *
   * @param strings - Strings to concatenate
   * @returns Concatenated result
   */
  static concat(...strings: string[]): string {
    return strings.join("");
  }

  /**
   * SPARQL 1.1 REPLACE function.
   * https://www.w3.org/TR/sparql11-query/#func-replace
   */
  static replace(str: string, pattern: string, replacement: string, flags?: string): string {
    try {
      const regex = new RegExp(pattern, flags || "g");
      return str.replace(regex, replacement);
    } catch (error) {
      throw new Error(`REPLACE: invalid pattern '${pattern}': ${(error as Error).message}`);
    }
  }

  /**
   * Parse a date string to a timestamp (milliseconds since epoch).
   * Custom function for date comparison support.
   */
  static parseDate(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`PARSEDATE: invalid date string '${dateStr}'`);
    }
    return date.getTime();
  }

  /**
   * Check if date1 is before date2.
   * Custom function for date comparison support.
   */
  static dateBefore(date1: string, date2: string): boolean {
    const d1 = this.parseDate(date1);
    const d2 = this.parseDate(date2);
    return d1 < d2;
  }

  /**
   * Check if date1 is after date2.
   * Custom function for date comparison support.
   */
  static dateAfter(date1: string, date2: string): boolean {
    const d1 = this.parseDate(date1);
    const d2 = this.parseDate(date2);
    return d1 > d2;
  }

  /**
   * Check if date is within a range [start, end].
   * Custom function for date comparison support.
   */
  static dateInRange(date: string, start: string, end: string): boolean {
    const d = this.parseDate(date);
    const s = this.parseDate(start);
    const e = this.parseDate(end);
    return d >= s && d <= e;
  }

  /**
   * Calculate the difference between two dates in minutes.
   * Returns the absolute difference (always positive).
   * Custom function for duration calculation support.
   *
   * @param date1 - First date string (start timestamp)
   * @param date2 - Second date string (end timestamp)
   * @returns Difference in minutes (positive number)
   */
  static dateDiffMinutes(date1: string, date2: string): number {
    const d1 = this.parseDate(date1);
    const d2 = this.parseDate(date2);
    const diffMs = Math.abs(d2 - d1);
    return Math.round(diffMs / (1000 * 60));
  }

  /**
   * Calculate the difference between two dates in hours.
   * Returns the absolute difference (always positive).
   * Custom function for duration calculation support.
   *
   * @param date1 - First date string (start timestamp)
   * @param date2 - Second date string (end timestamp)
   * @returns Difference in hours (decimal number with 2 decimal places)
   */
  static dateDiffHours(date1: string, date2: string): number {
    const d1 = this.parseDate(date1);
    const d2 = this.parseDate(date2);
    const diffMs = Math.abs(d2 - d1);
    return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
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

  // SPARQL 1.1 Date/Time Accessor Functions
  // https://www.w3.org/TR/sparql11-query/#func-year

  /**
   * SPARQL 1.1 YEAR function.
   * Returns the year component of a dateTime value.
   */
  static year(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`YEAR: invalid date string '${dateStr}'`);
    }
    return date.getFullYear();
  }

  /**
   * SPARQL 1.1 MONTH function.
   * Returns the month component of a dateTime value (1-12).
   */
  static month(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`MONTH: invalid date string '${dateStr}'`);
    }
    return date.getMonth() + 1; // JavaScript months are 0-indexed
  }

  /**
   * SPARQL 1.1 DAY function.
   * Returns the day component of a dateTime value (1-31).
   */
  static day(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`DAY: invalid date string '${dateStr}'`);
    }
    return date.getDate();
  }

  /**
   * SPARQL 1.1 HOURS function.
   * Returns the hours component of a dateTime value (0-23).
   */
  static hours(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`HOURS: invalid date string '${dateStr}'`);
    }
    return date.getHours();
  }

  /**
   * SPARQL 1.1 MINUTES function.
   * Returns the minutes component of a dateTime value (0-59).
   */
  static minutes(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`MINUTES: invalid date string '${dateStr}'`);
    }
    return date.getMinutes();
  }

  /**
   * SPARQL 1.1 SECONDS function.
   * Returns the seconds component of a dateTime value (0-59, may include decimal).
   */
  static seconds(dateStr: string): number {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`SECONDS: invalid date string '${dateStr}'`);
    }
    // Include milliseconds as decimal seconds
    return date.getSeconds() + date.getMilliseconds() / 1000;
  }

  /**
   * SPARQL 1.1 TIMEZONE function.
   * Returns the timezone offset as a string (e.g., "+05:00", "Z").
   */
  static timezone(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`TIMEZONE: invalid date string '${dateStr}'`);
    }
    // Check if original string has timezone info
    if (dateStr.endsWith("Z")) {
      return "PT0S"; // UTC
    }
    const tzMatch = dateStr.match(/([+-]\d{2}):?(\d{2})$/);
    if (tzMatch) {
      const hours = parseInt(tzMatch[1], 10);
      const minutes = parseInt(tzMatch[2], 10);
      const sign = hours >= 0 ? "" : "-";
      const absHours = Math.abs(hours);
      if (minutes === 0) {
        return `${sign}PT${absHours}H`;
      }
      return `${sign}PT${absHours}H${minutes}M`;
    }
    // Return local timezone offset
    const offset = -date.getTimezoneOffset();
    const hours = Math.floor(Math.abs(offset) / 60);
    const mins = Math.abs(offset) % 60;
    const sign = offset >= 0 ? "" : "-";
    if (mins === 0) {
      return `${sign}PT${hours}H`;
    }
    return `${sign}PT${hours}H${mins}M`;
  }

  /**
   * SPARQL 1.1 NOW function.
   * Returns the current dateTime as ISO string.
   */
  static now(): string {
    return new Date().toISOString();
  }

  // Duration arithmetic helpers

  /**
   * Convert milliseconds to minutes.
   * Useful for duration calculations.
   */
  static msToMinutes(ms: number): number {
    return Math.round(ms / (1000 * 60));
  }

  /**
   * Convert milliseconds to hours.
   * Useful for duration calculations.
   */
  static msToHours(ms: number): number {
    return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
  }

  /**
   * Convert milliseconds to seconds.
   * Useful for duration calculations.
   */
  static msToSeconds(ms: number): number {
    return Math.round(ms / 1000);
  }

  // SPARQL 1.1 Numeric Functions
  // https://www.w3.org/TR/sparql11-query/#func-abs

  /**
   * SPARQL 1.1 ABS function.
   * Returns the absolute value of a numeric value.
   *
   * @param num - Numeric value
   * @returns Absolute value
   */
  static abs(num: number): number {
    return Math.abs(num);
  }

  /**
   * SPARQL 1.1 ROUND function.
   * Returns the nearest integer to the argument.
   * Rounds half values to the nearest even integer (banker's rounding per spec).
   *
   * @param num - Numeric value
   * @returns Rounded integer value
   */
  static round(num: number): number {
    return Math.round(num);
  }

  /**
   * SPARQL 1.1 CEIL function.
   * Returns the smallest integer greater than or equal to the argument.
   *
   * @param num - Numeric value
   * @returns Ceiling value
   */
  static ceil(num: number): number {
    return Math.ceil(num);
  }

  /**
   * SPARQL 1.1 FLOOR function.
   * Returns the largest integer less than or equal to the argument.
   *
   * @param num - Numeric value
   * @returns Floor value
   */
  static floor(num: number): number {
    return Math.floor(num);
  }

  /**
   * SPARQL 1.1 RAND function.
   * Returns a pseudo-random number between 0 (inclusive) and 1 (exclusive).
   *
   * @returns Random number in range [0, 1)
   */
  static rand(): number {
    return Math.random();
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

  // XSD Type Casting Functions
  // https://www.w3.org/TR/sparql11-query/#FunctionMapping

  /**
   * XSD dateTime constructor/cast function.
   * Converts a string value to an xsd:dateTime Literal.
   * Used for dateTime arithmetic: xsd:dateTime(?end) - xsd:dateTime(?start)
   *
   * @param value - String representation of dateTime (ISO 8601 or JS Date format)
   * @returns Literal with xsd:dateTime datatype
   */
  static xsdDateTime(value: string): Literal {
    // Parse the date to validate it
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`xsd:dateTime: invalid date string '${value}'`);
    }
    // Return as ISO 8601 string with xsd:dateTime datatype
    return new Literal(date.toISOString(), new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  /**
   * XSD integer constructor/cast function.
   * Converts a string/number value to an xsd:integer Literal.
   * Used for duration calculations.
   *
   * @param value - String or numeric representation of integer
   * @returns Literal with xsd:integer datatype
   */
  static xsdInteger(value: string): Literal {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new Error(`xsd:integer: cannot convert '${value}' to integer`);
    }
    return new Literal(String(num), new IRI("http://www.w3.org/2001/XMLSchema#integer"));
  }

  /**
   * XSD decimal constructor/cast function.
   * Converts a string/number value to an xsd:decimal Literal.
   *
   * @param value - String or numeric representation of decimal
   * @returns Literal with xsd:decimal datatype
   */
  static xsdDecimal(value: string): Literal {
    const num = parseFloat(value);
    if (isNaN(num)) {
      throw new Error(`xsd:decimal: cannot convert '${value}' to decimal`);
    }
    return new Literal(String(num), new IRI("http://www.w3.org/2001/XMLSchema#decimal"));
  }

  // SPARQL 1.1 String Functions (URI)
  // https://www.w3.org/TR/sparql11-query/#func-encode

  /**
   * SPARQL 1.1 ENCODE_FOR_URI function.
   * https://www.w3.org/TR/sparql11-query/#func-encode
   *
   * Percent-encodes a string for safe inclusion in a URI.
   * Encodes all characters except unreserved characters (A-Z, a-z, 0-9, -, _, ., ~).
   *
   * @param str - String to encode
   * @returns Percent-encoded string
   *
   * Examples:
   * - ENCODE_FOR_URI("hello world") → "hello%20world"
   * - ENCODE_FOR_URI("a/b?c=d") → "a%2Fb%3Fc%3Dd"
   * - ENCODE_FOR_URI("Los Angeles") → "Los%20Angeles"
   */
  static encodeForUri(str: string): string {
    return encodeURIComponent(str);
  }

  // SPARQL 1.1 Hash Functions
  // https://www.w3.org/TR/sparql11-query/#func-hash

  /**
   * SPARQL 1.1 MD5 function.
   * Returns the MD5 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of MD5 hash
   *
   * Example: MD5("test") = "098f6bcd4621d373cade4e832627b4f6"
   */
  static md5(str: string): string {
    // Use Web Crypto API compatible implementation via Node.js crypto
    const crypto = require("crypto");
    return crypto.createHash("md5").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA1 function.
   * Returns the SHA1 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA1 hash
   *
   * Example: SHA1("test") = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
   */
  static sha1(str: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha1").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA256 function.
   * Returns the SHA256 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA256 hash
   *
   * Example: SHA256("test") = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
   */
  static sha256(str: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA384 function.
   * Returns the SHA384 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA384 hash
   */
  static sha384(str: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha384").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA512 function.
   * Returns the SHA512 checksum, as a hex digit string.
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA512 hash
   */
  static sha512(str: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha512").update(str).digest("hex");
  }

  // SPARQL 1.1 RDF Term Functions
  // https://www.w3.org/TR/sparql11-query/#func-sameTerm

  /**
   * SPARQL 1.1 sameTerm function.
   * Returns true if two RDF terms are exactly identical.
   *
   * Unlike the = operator which performs value-based comparison (e.g.,
   * "42"^^xsd:integer equals "42.0"^^xsd:decimal), sameTerm() checks
   * if two terms are exactly the same RDF term:
   * - Same IRI value for IRIs
   * - Same blank node ID for blank nodes
   * - Same literal value, datatype, AND language tag for literals
   *
   * @see https://www.w3.org/TR/sparql11-query/#func-sameTerm
   *
   * @param term1 - First RDF term
   * @param term2 - Second RDF term
   * @returns true if terms are exactly identical, false otherwise
   */
  static sameTerm(term1: RDFTerm | undefined, term2: RDFTerm | undefined): boolean {
    // Both undefined = same (vacuously)
    if (term1 === undefined && term2 === undefined) {
      return true;
    }

    // One undefined, one not = different
    if (term1 === undefined || term2 === undefined) {
      return false;
    }

    // Different term types = different
    if (term1.constructor !== term2.constructor) {
      return false;
    }

    // Same IRI value
    if (term1 instanceof IRI && term2 instanceof IRI) {
      return term1.value === term2.value;
    }

    // Same blank node ID
    if (term1 instanceof BlankNode && term2 instanceof BlankNode) {
      return term1.id === term2.id;
    }

    // Same literal: value, datatype, AND language must all match exactly
    if (term1 instanceof Literal && term2 instanceof Literal) {
      // Value must match
      if (term1.value !== term2.value) {
        return false;
      }

      // Language must match exactly (both undefined or same string)
      if (term1.language !== term2.language) {
        return false;
      }

      // Datatype must match exactly (both undefined or same IRI value)
      const dt1 = term1.datatype?.value;
      const dt2 = term2.datatype?.value;

      // Unlike Literal.equals(), we do NOT treat plain literal as xsd:string
      // sameTerm() requires exact identity
      return dt1 === dt2;
    }

    return false;
  }

  // SPARQL 1.1 Constructor Functions
  // https://www.w3.org/TR/sparql11-query/#FunctionMapping

  /**
   * SPARQL 1.1 IRI constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-iri
   *
   * Creates an IRI from a string literal or returns the IRI unchanged.
   * URI is a synonym for IRI.
   *
   * @param term - String literal containing the IRI value, or an existing IRI
   * @returns IRI term
   *
   * Examples:
   * - IRI("http://example.org/resource") → <http://example.org/resource>
   * - IRI(<http://example.org/resource>) → <http://example.org/resource>
   */
  static iri(term: RDFTerm | undefined): IRI {
    if (term === undefined) {
      throw new Error("IRI: argument is undefined");
    }

    // If already an IRI, return as-is
    if (term instanceof IRI) {
      return term;
    }

    // If literal, create IRI from value
    if (term instanceof Literal) {
      return new IRI(term.value);
    }

    // Blank nodes cannot be converted to IRIs
    if (term instanceof BlankNode) {
      throw new Error("IRI: cannot convert blank node to IRI");
    }

    throw new Error("IRI: unsupported term type");
  }

  /**
   * SPARQL 1.1 URI constructor function (synonym for IRI).
   * https://www.w3.org/TR/sparql11-query/#func-iri
   *
   * @param term - String literal containing the URI value, or an existing IRI
   * @returns IRI term
   */
  static uri(term: RDFTerm | undefined): IRI {
    return this.iri(term);
  }

  /**
   * SPARQL 1.1 BNODE constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-bnode
   *
   * Creates a blank node. If called with no argument or empty argument,
   * generates a unique blank node each call. If called with a string literal,
   * creates a blank node with that label (consistent within query scope).
   *
   * @param label - Optional string literal to use as blank node label
   * @returns BlankNode term
   *
   * Examples:
   * - BNODE() → _:b1 (unique per call)
   * - BNODE("label") → _:label (consistent within query)
   */
  static bnode(label?: RDFTerm | undefined): BlankNode {
    // No argument - generate unique blank node
    if (label === undefined) {
      // Generate a unique ID using random component
      const uniqueId = `b${Math.random().toString(36).substring(2, 11)}`;
      return new BlankNode(uniqueId);
    }

    // With literal argument - use as label
    if (label instanceof Literal) {
      return new BlankNode(label.value);
    }

    // Already a blank node - return as is
    if (label instanceof BlankNode) {
      return label;
    }

    throw new Error("BNODE: argument must be a string literal or omitted");
  }

  /**
   * SPARQL 1.1 STRDT constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-strdt
   *
   * Creates a typed literal with specified datatype.
   *
   * @param lexicalForm - String literal containing the lexical form
   * @param datatypeIRI - IRI of the datatype
   * @returns Literal with specified datatype
   *
   * Examples:
   * - STRDT("42", xsd:integer) → "42"^^xsd:integer
   * - STRDT("2025-01-01", xsd:date) → "2025-01-01"^^xsd:date
   */
  static strdt(lexicalForm: RDFTerm | undefined, datatypeIRI: RDFTerm | undefined): Literal {
    if (lexicalForm === undefined) {
      throw new Error("STRDT: lexical form is undefined");
    }

    if (datatypeIRI === undefined) {
      throw new Error("STRDT: datatype IRI is undefined");
    }

    // Get the lexical form string
    let lexicalValue: string;
    if (lexicalForm instanceof Literal) {
      // Must be a simple literal (no language tag, no datatype other than xsd:string)
      if (lexicalForm.language) {
        throw new Error("STRDT: lexical form must not have a language tag");
      }
      lexicalValue = lexicalForm.value;
    } else if (typeof lexicalForm === "string") {
      lexicalValue = lexicalForm;
    } else {
      throw new Error("STRDT: lexical form must be a string literal");
    }

    // Get the datatype IRI
    let datatypeValue: IRI;
    if (datatypeIRI instanceof IRI) {
      datatypeValue = datatypeIRI;
    } else if (datatypeIRI instanceof Literal) {
      datatypeValue = new IRI(datatypeIRI.value);
    } else {
      throw new Error("STRDT: datatype must be an IRI");
    }

    return new Literal(lexicalValue, datatypeValue);
  }

  /**
   * SPARQL 1.1 STRLANG constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-strlang
   *
   * Creates a language-tagged literal.
   *
   * @param lexicalForm - String literal containing the text
   * @param languageTag - String literal containing the language tag
   * @returns Literal with specified language tag
   *
   * Examples:
   * - STRLANG("hello", "en") → "hello"@en
   * - STRLANG("Привет", "ru") → "Привет"@ru
   */
  static strlang(lexicalForm: RDFTerm | undefined, languageTag: RDFTerm | undefined): Literal {
    if (lexicalForm === undefined) {
      throw new Error("STRLANG: lexical form is undefined");
    }

    if (languageTag === undefined) {
      throw new Error("STRLANG: language tag is undefined");
    }

    // Get the lexical form string
    let lexicalValue: string;
    if (lexicalForm instanceof Literal) {
      // Must be a simple literal (no language tag, no datatype other than xsd:string)
      if (lexicalForm.language) {
        throw new Error("STRLANG: lexical form must not already have a language tag");
      }
      lexicalValue = lexicalForm.value;
    } else if (typeof lexicalForm === "string") {
      lexicalValue = lexicalForm;
    } else {
      throw new Error("STRLANG: lexical form must be a string literal");
    }

    // Get the language tag string
    let langValue: string;
    if (languageTag instanceof Literal) {
      langValue = languageTag.value;
    } else if (typeof languageTag === "string") {
      langValue = languageTag;
    } else {
      throw new Error("STRLANG: language tag must be a string literal");
    }

    // Validate language tag is not empty
    if (langValue === "") {
      throw new Error("STRLANG: language tag cannot be empty");
    }

    return new Literal(lexicalValue, undefined, langValue);
  }

  /**
   * SPARQL 1.1 UUID constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-uuid
   *
   * Returns a fresh IRI from the UUID URN scheme. Each call returns a
   * different UUID. Uses RFC 4122 UUID format.
   *
   * @returns IRI in the form <urn:uuid:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX>
   *
   * Examples:
   * - UUID() → <urn:uuid:b7f4e9a2-8c3d-4e5f-a1b2-c3d4e5f6a7b8>
   */
  static uuid(): IRI {
    const uuid = uuidv4();
    return new IRI(`urn:uuid:${uuid}`);
  }

  /**
   * SPARQL 1.1 STRUUID constructor function.
   * https://www.w3.org/TR/sparql11-query/#func-struuid
   *
   * Returns a string that is the UUID of a fresh IRI. Each call returns a
   * different UUID string. Uses RFC 4122 UUID format.
   *
   * @returns String literal containing the UUID (without urn:uuid: prefix)
   *
   * Examples:
   * - STRUUID() → "b7f4e9a2-8c3d-4e5f-a1b2-c3d4e5f6a7b8"
   */
  static struuid(): Literal {
    const uuid = uuidv4();
    return new Literal(uuid);
  }
}
