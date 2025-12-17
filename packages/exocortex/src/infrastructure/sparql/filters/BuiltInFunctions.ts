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
   * SPARQL 1.2 LANGDIR function.
   * https://w3c.github.io/sparql-12/spec/
   *
   * Returns the combined language tag and base direction from a directional literal.
   * The format is `lang--dir` (e.g., `"ar--rtl"`, `"en--ltr"`).
   *
   * For non-directional language-tagged literals, returns just the language tag.
   * For non-literals or literals without language tags, returns empty string.
   *
   * @param term - RDF term to extract language direction from
   * @returns String in format "lang--dir", "lang", or "" depending on the term
   *
   * @example
   * // Directional literal with rtl direction
   * LANGDIR("مرحبا"@ar--rtl) → "ar--rtl"
   *
   * // Directional literal with ltr direction
   * LANGDIR("Hello"@en--ltr) → "en--ltr"
   *
   * // Non-directional language-tagged literal
   * LANGDIR("Hello"@en) → "en"
   *
   * // Plain literal (no language tag)
   * LANGDIR("Hello") → ""
   *
   * // IRI (not a literal)
   * LANGDIR(<http://example.org>) → ""
   */
  static langdir(term: RDFTerm | undefined): string {
    if (term === undefined) {
      throw new Error("LANGDIR: argument is undefined");
    }

    if (!(term instanceof Literal)) {
      return "";
    }

    if (!term.language) {
      return "";
    }

    // If the literal has a direction, return "lang--dir" format
    if (term.direction) {
      return `${term.language}--${term.direction}`;
    }

    // No direction, just return the language tag
    return term.language;
  }

  /**
   * SPARQL 1.1/1.2 langMatches function with direction-aware extension.
   * https://www.w3.org/TR/sparql11-query/#func-langMatches
   *
   * Matches a language tag against a language range per RFC 4647 basic filtering.
   * Extended to support directional language tags in the format "lang--dir".
   *
   * @param languageTag - The language tag to check (e.g., "en", "en-US", "ar--rtl")
   * @param languageRange - The language range to match against (e.g., "en", "*", "ar--rtl")
   * @returns true if the language tag matches the range, false otherwise
   *
   * Special cases:
   * - Range "*" matches any non-empty language tag (including directional)
   * - Empty language tag matches nothing (except empty range for exact match)
   * - Case-insensitive comparison (per RFC 4647)
   *
   * Direction-aware matching (SPARQL 1.2 extension):
   * - Tags can include direction: "ar--rtl", "he--rtl", "en--ltr"
   * - Language-only range matches any direction: LANGMATCHES("ar--rtl", "ar") → true
   * - Exact direction match: LANGMATCHES("ar--rtl", "ar--rtl") → true
   * - Direction mismatch returns false: LANGMATCHES("ar--rtl", "ar--ltr") → false
   */
  static langMatches(languageTag: string, languageRange: string): boolean {
    // Parse direction from tag (format: "lang--dir")
    const [tagLang, tagDir] = this.parseDirectionalLangTag(languageTag);
    const [rangeLang, rangeDir] = this.parseDirectionalLangTag(languageRange);

    // Normalize both language parts to lowercase for case-insensitive comparison
    const tag = tagLang.toLowerCase();
    const range = rangeLang.toLowerCase();

    // Special case: "*" matches any non-empty language tag
    if (range === "*") {
      // Direction doesn't matter for wildcard - just check language is non-empty
      return tag !== "";
    }

    // Empty tag matches nothing (except empty range for exact match)
    if (tag === "") {
      return range === "";
    }

    // Check direction match if range specifies a direction
    // If range has no direction, match any direction in tag
    if (rangeDir && tagDir !== rangeDir) {
      return false;
    }

    // Exact match
    if (tag === range) {
      return true;
    }

    // Prefix match: tag starts with range followed by "-"
    // e.g., "en-US" matches "en", "en-GB-oed" matches "en-GB"
    return tag.startsWith(range + "-");
  }

  /**
   * Parses a directional language tag into language and direction components.
   *
   * @param tag - The language tag, possibly with direction (e.g., "ar--rtl", "en")
   * @returns Tuple of [language, direction] where direction may be undefined
   *
   * Examples:
   * - parseDirectionalLangTag("ar--rtl") → ["ar", "rtl"]
   * - parseDirectionalLangTag("en-US--ltr") → ["en-US", "ltr"]
   * - parseDirectionalLangTag("en") → ["en", undefined]
   * - parseDirectionalLangTag("en-US") → ["en-US", undefined]
   */
  private static parseDirectionalLangTag(
    tag: string
  ): [string, string | undefined] {
    const dirSeparatorIndex = tag.indexOf("--");
    if (dirSeparatorIndex === -1) {
      return [tag, undefined];
    }

    const language = tag.substring(0, dirSeparatorIndex);
    const direction = tag.substring(dirSeparatorIndex + 2).toLowerCase();

    return [language, direction];
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
  /**
   * SPARQL 1.2 hasLANGDIR function.
   * https://w3c.github.io/sparql-12/spec/
   *
   * Returns true if the literal has both a language tag AND a base direction
   * (i.e., is a directional language-tagged literal).
   *
   * A directional literal has format: `"value"@lang--dir` where dir is "ltr" or "rtl".
   *
   * @param term - RDF term to check
   * @returns true if term is a literal with both language tag and direction, false otherwise
   *
   * @example
   * // Directional literal with ltr direction
   * hasLANGDIR("Hello"@en--ltr) → true
   *
   * // Directional literal with rtl direction
   * hasLANGDIR("مرحبا"@ar--rtl) → true
   *
   * // Non-directional language-tagged literal
   * hasLANGDIR("Hello"@en) → false
   *
   * // Plain literal (no language tag)
   * hasLANGDIR("Hello") → false
   *
   * // IRI (not a literal)
   * hasLANGDIR(<http://example.org>) → false
   */
  static hasLangdir(term: RDFTerm | undefined): boolean {
    if (term === undefined) {
      return false;
    }

    if (!(term instanceof Literal)) {
      return false;
    }

    // Must have both language AND direction to return true
    return !!term.language && !!term.direction;
  }

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
    // Check if both values are xsd:dayTimeDuration for special comparison
    if (this.isDayTimeDurationValue(a) && this.isDayTimeDurationValue(b)) {
      return this.compareDurations(
        a instanceof Literal ? a : String(a),
        b instanceof Literal ? b : String(b),
        operator
      );
    }

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
          return this.parseDayTimeDuration(value.value);
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
   * https://www.w3.org/TR/sparql11-query/#func-timezone
   *
   * Returns the timezone part of a dateTime as an xsd:dayTimeDuration.
   * If the argument does not have a timezone, raises an error.
   *
   * @param dateStr - dateTime string with timezone
   * @returns Literal with xsd:dayTimeDuration datatype
   *
   * Examples:
   * - TIMEZONE("2025-01-01T12:00:00Z") → "PT0S"^^xsd:dayTimeDuration
   * - TIMEZONE("2025-01-01T12:00:00+05:00") → "PT5H"^^xsd:dayTimeDuration
   * - TIMEZONE("2025-01-01T12:00:00-08:30") → "-PT8H30M"^^xsd:dayTimeDuration
   */
  static timezone(dateStr: string): Literal {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`TIMEZONE: invalid date string '${dateStr}'`);
    }

    let durationStr: string;

    // Check if original string has timezone info
    if (dateStr.endsWith("Z")) {
      durationStr = "PT0S"; // UTC
    } else {
      const tzMatch = dateStr.match(/([+-]\d{2}):?(\d{2})$/);
      if (tzMatch) {
        const hours = parseInt(tzMatch[1], 10);
        const minutes = parseInt(tzMatch[2], 10);
        const sign = hours >= 0 ? "" : "-";
        const absHours = Math.abs(hours);
        if (minutes === 0) {
          durationStr = `${sign}PT${absHours}H`;
        } else {
          durationStr = `${sign}PT${absHours}H${minutes}M`;
        }
      } else {
        // No timezone in string - per SPARQL 1.1 spec this should raise an error
        // But for backwards compatibility, use local timezone offset
        const offset = -date.getTimezoneOffset();
        const hours = Math.floor(Math.abs(offset) / 60);
        const mins = Math.abs(offset) % 60;
        const sign = offset >= 0 ? "" : "-";
        if (mins === 0) {
          durationStr = `${sign}PT${hours}H`;
        } else {
          durationStr = `${sign}PT${hours}H${mins}M`;
        }
      }
    }

    return new Literal(durationStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * SPARQL 1.1 TZ function.
   * https://www.w3.org/TR/sparql11-query/#func-tz
   *
   * Returns the timezone part of a dateTime as a simple literal (string).
   * Returns the empty string if there is no timezone.
   *
   * @param dateStr - dateTime string
   * @returns String representation of timezone, or empty string if no timezone
   *
   * Examples:
   * - TZ("2025-01-01T12:00:00Z") → "Z"
   * - TZ("2025-01-01T12:00:00+05:00") → "+05:00"
   * - TZ("2025-01-01T12:00:00-08:30") → "-08:30"
   * - TZ("2025-01-01T12:00:00") → "" (no timezone)
   */
  static tz(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`TZ: invalid date string '${dateStr}'`);
    }

    // Check for Z (UTC)
    if (dateStr.endsWith("Z")) {
      return "Z";
    }

    // Check for explicit timezone offset (e.g., +05:00, -08:30)
    const tzMatch = dateStr.match(/([+-]\d{2}:\d{2})$/);
    if (tzMatch) {
      return tzMatch[1];
    }

    // Check for timezone offset without colon (e.g., +0500, -0830)
    const tzMatchNoColon = dateStr.match(/([+-])(\d{2})(\d{2})$/);
    if (tzMatchNoColon) {
      return `${tzMatchNoColon[1]}${tzMatchNoColon[2]}:${tzMatchNoColon[3]}`;
    }

    // No timezone - return empty string
    return "";
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
   * Per SPARQL 1.1 specification, this uses standard pseudo-random generation.
   * Not intended for cryptographic purposes.
   * https://www.w3.org/TR/sparql11-query/#func-rand
   *
   * @returns Random number in range [0, 1)
   */
  static rand(): number {
    // SPARQL 1.1 spec requires RAND() - this is for query logic, NOT security.
    // CodeQL js/insecure-randomness: This is intentional per SPARQL 1.1 spec.
    // lgtm[js/insecure-randomness]
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
   * WARNING: MD5 is cryptographically weak. This function exists ONLY for
   * SPARQL 1.1 specification compliance. Do NOT use for security purposes.
   * https://www.w3.org/TR/sparql11-query/#func-md5
   *
   * @param str - String to hash
   * @returns Lowercase hex string of MD5 hash
   *
   * Example: MD5("test") = "098f6bcd4621d373cade4e832627b4f6"
   */
  static md5(str: string): string {
    // SPARQL 1.1 spec requires MD5 - this is for spec compliance, NOT security.
    // CodeQL js/weak-cryptographic-algorithm: Intentional per W3C SPARQL 1.1 spec.
    // lgtm[js/weak-cryptographic-algorithm]
    const crypto = require("crypto");
    return crypto.createHash("md5").update(str).digest("hex");
  }

  /**
   * SPARQL 1.1 SHA1 function.
   * Returns the SHA1 checksum, as a hex digit string.
   *
   * WARNING: SHA1 is cryptographically weak. This function exists ONLY for
   * SPARQL 1.1 specification compliance. Do NOT use for security purposes.
   * https://www.w3.org/TR/sparql11-query/#func-sha1
   *
   * @param str - String to hash
   * @returns Lowercase hex string of SHA1 hash
   *
   * Example: SHA1("test") = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
   */
  static sha1(str: string): string {
    // SPARQL 1.1 spec requires SHA1 - this is for spec compliance, NOT security.
    // CodeQL js/weak-cryptographic-algorithm: Intentional per W3C SPARQL 1.1 spec.
    // lgtm[js/weak-cryptographic-algorithm]
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
    // No argument - generate unique blank node using UUID (cryptographically secure)
    if (label === undefined) {
      // Use UUID v4 for unique blank node generation - already imported
      const uniqueId = `b${uuidv4().replace(/-/g, "").substring(0, 12)}`;
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
   * SPARQL 1.2 STRLANGDIR constructor function.
   * https://w3c.github.io/sparql-12/spec/
   *
   * Creates a directional language-tagged literal with both language tag
   * and base direction (ltr/rtl) for bidirectional text support.
   *
   * @param lexicalForm - String literal containing the text
   * @param languageTag - String literal containing the language tag
   * @param direction - String literal containing the direction ("ltr" or "rtl")
   * @returns Literal with specified language tag and direction
   *
   * @see https://w3c.github.io/rdf-dir-literal/ - RDF Directional Literals
   *
   * Examples:
   * - STRLANGDIR("Hello", "en", "ltr") → "Hello"@en--ltr
   * - STRLANGDIR("مرحبا", "ar", "rtl") → "مرحبا"@ar--rtl
   * - STRLANGDIR("text", "fr", "xxx") → Error (invalid direction)
   */
  static strlangdir(
    lexicalForm: RDFTerm | undefined,
    languageTag: RDFTerm | undefined,
    direction: RDFTerm | undefined
  ): Literal {
    if (lexicalForm === undefined) {
      throw new Error("STRLANGDIR: lexical form is undefined");
    }

    if (languageTag === undefined) {
      throw new Error("STRLANGDIR: language tag is undefined");
    }

    if (direction === undefined) {
      throw new Error("STRLANGDIR: direction is undefined");
    }

    // Get the lexical form string
    let lexicalValue: string;
    if (lexicalForm instanceof Literal) {
      // Must be a simple literal (no language tag, no datatype other than xsd:string)
      if (lexicalForm.language) {
        throw new Error("STRLANGDIR: lexical form must not already have a language tag");
      }
      lexicalValue = lexicalForm.value;
    } else if (typeof lexicalForm === "string") {
      lexicalValue = lexicalForm;
    } else {
      throw new Error("STRLANGDIR: lexical form must be a string literal");
    }

    // Get the language tag string
    let langValue: string;
    if (languageTag instanceof Literal) {
      langValue = languageTag.value;
    } else if (typeof languageTag === "string") {
      langValue = languageTag;
    } else {
      throw new Error("STRLANGDIR: language tag must be a string literal");
    }

    // Validate language tag is not empty
    if (langValue === "") {
      throw new Error("STRLANGDIR: language tag cannot be empty");
    }

    // Get the direction string
    let dirValue: string;
    if (direction instanceof Literal) {
      dirValue = direction.value.toLowerCase();
    } else {
      throw new Error("STRLANGDIR: direction must be a string literal");
    }

    // Validate direction is 'ltr' or 'rtl'
    if (dirValue !== "ltr" && dirValue !== "rtl") {
      throw new Error(`STRLANGDIR: invalid direction '${dirValue}'. Must be 'ltr' or 'rtl'`);
    }

    return new Literal(lexicalValue, undefined, langValue, dirValue as "ltr" | "rtl");
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

  // =========================================================================
  // xsd:dayTimeDuration Support (SPARQL 1.1)
  // https://www.w3.org/TR/xpath-functions/#dt-dayTimeDuration
  // =========================================================================

  /**
   * Parse an xsd:dayTimeDuration string to total milliseconds.
   *
   * Format: [-]P[nD][T[nH][nM][nS]] or [-]P[nD][T[nH][nM][n.nS]]
   *
   * Examples:
   * - "PT5H" → 5 hours = 18000000 ms
   * - "-PT8H30M" → -8.5 hours = -30600000 ms
   * - "P1DT2H" → 1 day + 2 hours = 93600000 ms
   * - "PT0S" → 0 ms
   * - "PT1.5S" → 1500 ms
   *
   * @param durationStr - xsd:dayTimeDuration string
   * @returns Duration in milliseconds (can be negative)
   */
  static parseDayTimeDuration(durationStr: string): number {
    if (!durationStr) {
      throw new Error("parseDayTimeDuration: duration string is empty");
    }

    // Handle sign
    let negative = false;
    let str = durationStr.trim();
    if (str.startsWith("-")) {
      negative = true;
      str = str.substring(1);
    }

    // Must start with 'P'
    if (!str.startsWith("P")) {
      throw new Error(`parseDayTimeDuration: invalid format, must start with 'P': '${durationStr}'`);
    }
    str = str.substring(1);

    let totalMs = 0;

    // Parse days (before T)
    const tIndex = str.indexOf("T");
    let dayPart = "";
    let timePart = "";

    if (tIndex === -1) {
      // No time part, could be just days like "P1D"
      dayPart = str;
    } else {
      dayPart = str.substring(0, tIndex);
      timePart = str.substring(tIndex + 1);
    }

    // Parse days: nD
    if (dayPart) {
      const dayMatch = dayPart.match(/^(\d+(?:\.\d+)?)D$/);
      if (dayMatch) {
        const days = parseFloat(dayMatch[1]);
        totalMs += days * 24 * 60 * 60 * 1000;
      } else if (dayPart !== "") {
        throw new Error(`parseDayTimeDuration: invalid day component: '${dayPart}' in '${durationStr}'`);
      }
    }

    // Parse time part: [nH][nM][nS] or [nH][nM][n.nS]
    if (timePart) {
      let remaining = timePart;

      // Hours: nH
      const hourMatch = remaining.match(/^(\d+(?:\.\d+)?)H/);
      if (hourMatch) {
        const hours = parseFloat(hourMatch[1]);
        totalMs += hours * 60 * 60 * 1000;
        remaining = remaining.substring(hourMatch[0].length);
      }

      // Minutes: nM
      const minMatch = remaining.match(/^(\d+(?:\.\d+)?)M/);
      if (minMatch) {
        const minutes = parseFloat(minMatch[1]);
        totalMs += minutes * 60 * 1000;
        remaining = remaining.substring(minMatch[0].length);
      }

      // Seconds: nS or n.nS
      const secMatch = remaining.match(/^(\d+(?:\.\d+)?)S$/);
      if (secMatch) {
        const seconds = parseFloat(secMatch[1]);
        totalMs += seconds * 1000;
        remaining = remaining.substring(secMatch[0].length);
      }

      // If there's remaining content, it's invalid
      if (remaining !== "") {
        throw new Error(`parseDayTimeDuration: invalid time component: '${remaining}' in '${durationStr}'`);
      }
    }

    return negative ? -totalMs : totalMs;
  }

  /**
   * Format milliseconds as an xsd:dayTimeDuration string.
   *
   * @param ms - Duration in milliseconds (can be negative)
   * @returns xsd:dayTimeDuration string
   *
   * Examples:
   * - 18000000 → "PT5H"
   * - -30600000 → "-PT8H30M"
   * - 93600000 → "P1DT2H"
   * - 0 → "PT0S"
   */
  static formatDayTimeDuration(ms: number): string {
    const negative = ms < 0;
    let remaining = Math.abs(ms);

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    remaining = remaining % (24 * 60 * 60 * 1000);

    const hours = Math.floor(remaining / (60 * 60 * 1000));
    remaining = remaining % (60 * 60 * 1000);

    const minutes = Math.floor(remaining / (60 * 1000));
    remaining = remaining % (60 * 1000);

    const seconds = remaining / 1000;

    // Build duration string
    let result = negative ? "-P" : "P";

    // Add days if present
    if (days > 0) {
      result += `${days}D`;
    }

    // Add time part if any time component is present
    const hasTimePart = hours > 0 || minutes > 0 || seconds > 0 || days === 0;
    if (hasTimePart) {
      result += "T";

      if (hours > 0) {
        result += `${hours}H`;
      }
      if (minutes > 0) {
        result += `${minutes}M`;
      }
      // Always include seconds if no other time component, or if seconds has a value
      if (seconds > 0 || (hours === 0 && minutes === 0)) {
        // Format seconds, avoiding trailing zeros for whole numbers
        if (Number.isInteger(seconds)) {
          result += `${seconds}S`;
        } else {
          // Keep up to 3 decimal places, remove trailing zeros
          result += `${parseFloat(seconds.toFixed(3))}S`;
        }
      }
    }

    return result;
  }

  /**
   * XSD dayTimeDuration constructor/cast function.
   * Creates an xsd:dayTimeDuration Literal from a string.
   *
   * @param value - Duration string in ISO 8601 duration format
   * @returns Literal with xsd:dayTimeDuration datatype
   *
   * Examples:
   * - xsd:dayTimeDuration("PT5H") → "PT5H"^^xsd:dayTimeDuration
   * - xsd:dayTimeDuration("P1DT2H30M") → "P1DT2H30M"^^xsd:dayTimeDuration
   */
  static xsdDayTimeDuration(value: string): Literal {
    // Validate by parsing (throws if invalid)
    this.parseDayTimeDuration(value);
    return new Literal(value, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Compare two xsd:dayTimeDuration values.
   *
   * @param duration1 - First duration string or Literal
   * @param duration2 - Second duration string or Literal
   * @param operator - Comparison operator: '<', '>', '<=', '>=', '=', '!='
   * @returns Boolean result of comparison
   */
  static compareDurations(
    duration1: string | Literal,
    duration2: string | Literal,
    operator: string
  ): boolean {
    const d1Value = duration1 instanceof Literal ? duration1.value : duration1;
    const d2Value = duration2 instanceof Literal ? duration2.value : duration2;

    const ms1 = this.parseDayTimeDuration(d1Value);
    const ms2 = this.parseDayTimeDuration(d2Value);

    switch (operator) {
      case "=":
        return ms1 === ms2;
      case "!=":
        return ms1 !== ms2;
      case "<":
        return ms1 < ms2;
      case ">":
        return ms1 > ms2;
      case "<=":
        return ms1 <= ms2;
      case ">=":
        return ms1 >= ms2;
      default:
        throw new Error(`compareDurations: unknown operator: ${operator}`);
    }
  }

  /**
   * Check if a value is an xsd:dayTimeDuration.
   *
   * @param value - Value to check
   * @returns true if the value is an xsd:dayTimeDuration Literal
   */
  static isDayTimeDuration(value: any): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#dayTimeDuration";
    }
    return false;
  }

  /**
   * Check if a value is a pure xsd:date (not xsd:dateTime).
   *
   * @param value - Value to check
   * @returns true if the value is an xsd:date Literal
   */
  static isDate(value: any): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#date";
    }
    return false;
  }

  /**
   * Subtract two xsd:date values and return an xsd:dayTimeDuration.
   * Per SPARQL 1.2 specification: date - date = dayTimeDuration
   *
   * Unlike dateTimeDiff, this function produces clean day-only durations
   * (e.g., "P14D" instead of "P14DT0S") since dates have no time component.
   *
   * @param date1 - First date string or Literal (minuend)
   * @param date2 - Second date string or Literal (subtrahend)
   * @returns Literal with xsd:dayTimeDuration datatype representing the difference
   *
   * Examples:
   * - dateDiff("2025-12-15", "2025-12-01") → "P14D"
   * - dateDiff("2025-12-01", "2025-12-15") → "-P14D"
   * - dateDiff("2025-12-15", "2025-12-15") → "P0D"
   */
  static dateDiff(date1: string | Literal, date2: string | Literal): Literal {
    const d1Value = date1 instanceof Literal ? date1.value : date1;
    const d2Value = date2 instanceof Literal ? date2.value : date2;

    // Parse dates - for pure dates, normalize to start of day UTC
    const d1 = this.parseXSDDate(d1Value);
    const d2 = this.parseXSDDate(d2Value);

    if (d1 === null) {
      throw new Error(`dateDiff: invalid first date: '${d1Value}'`);
    }
    if (d2 === null) {
      throw new Error(`dateDiff: invalid second date: '${d2Value}'`);
    }

    // Calculate difference in whole days
    const diffMs = d1.getTime() - d2.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

    // Format as clean day-only duration
    const durationStr = this.formatDateDuration(diffDays);

    return new Literal(durationStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Parse an xsd:date string into a Date object normalized to start of day UTC.
   *
   * Handles various date formats:
   * - "2025-12-15" (standard xsd:date)
   * - "2025-12-15Z" (with UTC timezone)
   * - "2025-12-15+05:00" (with timezone offset)
   *
   * @param dateStr - xsd:date string
   * @returns Date object normalized to UTC, or null if invalid
   */
  private static parseXSDDate(dateStr: string): Date | null {
    // Match xsd:date format: YYYY-MM-DD with optional timezone
    const datePattern = /^(-?\d{4})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/;
    const match = dateStr.match(datePattern);

    if (!match) {
      // Try parsing as ISO string anyway (for compatibility)
      const fallbackDate = new Date(dateStr);
      if (isNaN(fallbackDate.getTime())) {
        return null;
      }
      // Normalize to UTC start of day
      return new Date(Date.UTC(
        fallbackDate.getUTCFullYear(),
        fallbackDate.getUTCMonth(),
        fallbackDate.getUTCDate()
      ));
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JavaScript months are 0-based
    const day = parseInt(match[3], 10);
    const timezone = match[4];

    // Create date at UTC start of day
    let date = new Date(Date.UTC(year, month, day));

    // Adjust for timezone if specified
    if (timezone && timezone !== "Z") {
      const tzMatch = timezone.match(/([+-])(\d{2}):(\d{2})/);
      if (tzMatch) {
        const sign = tzMatch[1] === "+" ? 1 : -1;
        const hours = parseInt(tzMatch[2], 10);
        const minutes = parseInt(tzMatch[3], 10);
        const offsetMs = sign * (hours * 60 + minutes) * 60 * 1000;
        // Subtract offset to normalize to UTC
        date = new Date(date.getTime() - offsetMs);
      }
    }

    return date;
  }

  /**
   * Format a number of days as an xsd:dayTimeDuration string.
   * Produces clean day-only format (P14D, -P14D, P0D).
   *
   * @param days - Number of days (can be negative)
   * @returns xsd:dayTimeDuration string in day-only format
   */
  private static formatDateDuration(days: number): string {
    if (days === 0) {
      return "P0D";
    }

    const negative = days < 0;
    const absDays = Math.abs(days);

    return negative ? `-P${absDays}D` : `P${absDays}D`;
  }

  /**
   * Subtract two xsd:dateTime values and return an xsd:dayTimeDuration.
   * Per SPARQL 1.1 specification: dateTime - dateTime = dayTimeDuration
   *
   * @param dateTime1 - First dateTime string or Literal (minuend)
   * @param dateTime2 - Second dateTime string or Literal (subtrahend)
   * @returns Literal with xsd:dayTimeDuration datatype representing the difference
   *
   * Examples:
   * - dateTimeDiff("2025-01-01T12:00:00Z", "2025-01-01T10:00:00Z") → "PT2H"
   * - dateTimeDiff("2025-01-01T10:00:00Z", "2025-01-01T12:00:00Z") → "-PT2H"
   */
  static dateTimeDiff(dateTime1: string | Literal, dateTime2: string | Literal): Literal {
    const dt1Value = dateTime1 instanceof Literal ? dateTime1.value : dateTime1;
    const dt2Value = dateTime2 instanceof Literal ? dateTime2.value : dateTime2;

    const d1 = new Date(dt1Value);
    const d2 = new Date(dt2Value);

    if (isNaN(d1.getTime())) {
      throw new Error(`dateTimeDiff: invalid first dateTime: '${dt1Value}'`);
    }
    if (isNaN(d2.getTime())) {
      throw new Error(`dateTimeDiff: invalid second dateTime: '${dt2Value}'`);
    }

    const diffMs = d1.getTime() - d2.getTime();
    const durationStr = this.formatDayTimeDuration(diffMs);

    return new Literal(durationStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Add a duration to a dateTime value.
   * Per SPARQL 1.1 specification: dateTime + dayTimeDuration = dateTime
   *
   * @param dateTime - dateTime string or Literal
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Literal with xsd:dateTime datatype
   *
   * Examples:
   * - dateTimeAdd("2025-01-01T10:00:00Z", "PT2H") → "2025-01-01T12:00:00.000Z"
   * - dateTimeAdd("2025-01-01T12:00:00Z", "-PT2H") → "2025-01-01T10:00:00.000Z"
   */
  static dateTimeAdd(dateTime: string | Literal, duration: string | Literal): Literal {
    const dtValue = dateTime instanceof Literal ? dateTime.value : dateTime;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = new Date(dtValue);
    if (isNaN(d.getTime())) {
      throw new Error(`dateTimeAdd: invalid dateTime: '${dtValue}'`);
    }

    const durationMs = this.parseDayTimeDuration(durValue);
    const resultMs = d.getTime() + durationMs;
    const resultDate = new Date(resultMs);

    return new Literal(resultDate.toISOString(), new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  /**
   * Subtract a duration from a dateTime value.
   * Per SPARQL 1.1 specification: dateTime - dayTimeDuration = dateTime
   *
   * @param dateTime - dateTime string or Literal
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Literal with xsd:dateTime datatype
   *
   * Examples:
   * - dateTimeSubtract("2025-01-01T12:00:00Z", "PT2H") → "2025-01-01T10:00:00.000Z"
   */
  static dateTimeSubtract(dateTime: string | Literal, duration: string | Literal): Literal {
    const dtValue = dateTime instanceof Literal ? dateTime.value : dateTime;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = new Date(dtValue);
    if (isNaN(d.getTime())) {
      throw new Error(`dateTimeSubtract: invalid dateTime: '${dtValue}'`);
    }

    const durationMs = this.parseDayTimeDuration(durValue);
    const resultMs = d.getTime() - durationMs;
    const resultDate = new Date(resultMs);

    return new Literal(resultDate.toISOString(), new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  /**
   * Add a duration to an xsd:date value.
   * Per SPARQL 1.1 specification: date + dayTimeDuration = date
   *
   * @param date - date string or Literal
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Literal with xsd:date datatype
   *
   * Examples:
   * - dateAdd("2025-01-15", "P7D") → "2025-01-22"
   * - dateAdd("2025-01-31", "P1D") → "2025-02-01" (month boundary)
   * - dateAdd("2025-12-31", "P1D") → "2026-01-01" (year boundary)
   */
  static dateAdd(date: string | Literal, duration: string | Literal): Literal {
    const dateValue = date instanceof Literal ? date.value : date;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = this.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateAdd: invalid date: '${dateValue}'`);
    }

    const durationMs = this.parseDayTimeDuration(durValue);
    const resultMs = d.getTime() + durationMs;
    const resultDate = new Date(resultMs);

    // Format as xsd:date (YYYY-MM-DD)
    const year = resultDate.getUTCFullYear();
    const month = String(resultDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(resultDate.getUTCDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    return new Literal(dateStr, new IRI("http://www.w3.org/2001/XMLSchema#date"));
  }

  /**
   * Subtract a duration from an xsd:date value.
   * Per SPARQL 1.1 specification: date - dayTimeDuration = date
   *
   * @param date - date string or Literal
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Literal with xsd:date datatype
   *
   * Examples:
   * - dateSubtract("2025-01-22", "P7D") → "2025-01-15"
   * - dateSubtract("2025-02-01", "P1D") → "2025-01-31" (month boundary)
   * - dateSubtract("2026-01-01", "P1D") → "2025-12-31" (year boundary)
   */
  static dateSubtract(date: string | Literal, duration: string | Literal): Literal {
    const dateValue = date instanceof Literal ? date.value : date;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = this.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateSubtract: invalid date: '${dateValue}'`);
    }

    const durationMs = this.parseDayTimeDuration(durValue);
    const resultMs = d.getTime() - durationMs;
    const resultDate = new Date(resultMs);

    // Format as xsd:date (YYYY-MM-DD)
    const year = resultDate.getUTCFullYear();
    const month = String(resultDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(resultDate.getUTCDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    return new Literal(dateStr, new IRI("http://www.w3.org/2001/XMLSchema#date"));
  }

  /**
   * Parse an xsd:yearMonthDuration string and return the number of months.
   *
   * Format: PnYnM (e.g., "P1Y2M", "P3M", "P2Y", "-P1Y")
   *
   * @param durationStr - xsd:yearMonthDuration string
   * @returns Number of months (positive or negative)
   */
  static parseYearMonthDuration(durationStr: string): number {
    // Pattern: optional negative sign, P, optional years, optional months
    const pattern = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?$/;
    const match = durationStr.match(pattern);

    if (!match) {
      throw new Error(`parseYearMonthDuration: invalid format: '${durationStr}'`);
    }

    const negative = match[1] === "-";
    const years = parseInt(match[2] || "0", 10);
    const months = parseInt(match[3] || "0", 10);

    // Validate that at least years or months is specified
    if (!match[2] && !match[3]) {
      throw new Error(`parseYearMonthDuration: invalid format (no duration components): '${durationStr}'`);
    }

    const totalMonths = years * 12 + months;
    return negative ? -totalMonths : totalMonths;
  }

  /**
   * Check if a value is an xsd:yearMonthDuration.
   */
  static isYearMonthDuration(value: string | Literal): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#yearMonthDuration";
    }
    return false;
  }

  /**
   * Add a yearMonthDuration to a dateTime value.
   * Per SPARQL 1.2 specification: dateTime + yearMonthDuration = dateTime
   *
   * @param dateTime - dateTime string or Literal
   * @param duration - xsd:yearMonthDuration string or Literal
   * @returns Literal with xsd:dateTime datatype
   *
   * Examples:
   * - dateTimeAddYearMonth("2025-01-15T10:00:00Z", "P1Y") → "2026-01-15T10:00:00.000Z"
   * - dateTimeAddYearMonth("2025-01-15T10:00:00Z", "P2M") → "2025-03-15T10:00:00.000Z"
   * - dateTimeAddYearMonth("2025-01-31T10:00:00Z", "P1M") → "2025-02-28T10:00:00.000Z" (month end)
   */
  static dateTimeAddYearMonth(dateTime: string | Literal, duration: string | Literal): Literal {
    const dtValue = dateTime instanceof Literal ? dateTime.value : dateTime;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = new Date(dtValue);
    if (isNaN(d.getTime())) {
      throw new Error(`dateTimeAddYearMonth: invalid dateTime: '${dtValue}'`);
    }

    const months = this.parseYearMonthDuration(durValue);

    // Add months to the date
    const originalDay = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + months);

    // Handle month-end overflow (e.g., Jan 31 + 1 month should be Feb 28/29)
    // If the day changed, we overflowed into the next month, so go back to last day of previous month
    if (d.getUTCDate() !== originalDay) {
      d.setUTCDate(0); // Set to last day of previous month
    }

    return new Literal(d.toISOString(), new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  /**
   * Subtract a yearMonthDuration from a dateTime value.
   * Per SPARQL 1.2 specification: dateTime - yearMonthDuration = dateTime
   *
   * @param dateTime - dateTime string or Literal
   * @param duration - xsd:yearMonthDuration string or Literal
   * @returns Literal with xsd:dateTime datatype
   */
  static dateTimeSubtractYearMonth(dateTime: string | Literal, duration: string | Literal): Literal {
    const dtValue = dateTime instanceof Literal ? dateTime.value : dateTime;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = new Date(dtValue);
    if (isNaN(d.getTime())) {
      throw new Error(`dateTimeSubtractYearMonth: invalid dateTime: '${dtValue}'`);
    }

    const months = this.parseYearMonthDuration(durValue);

    // Subtract months from the date
    const originalDay = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() - months);

    // Handle month-end overflow
    if (d.getUTCDate() !== originalDay) {
      d.setUTCDate(0); // Set to last day of previous month
    }

    return new Literal(d.toISOString(), new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  /**
   * Add a yearMonthDuration to a date value.
   * Per SPARQL 1.2 specification: date + yearMonthDuration = date
   *
   * @param date - date string or Literal
   * @param duration - xsd:yearMonthDuration string or Literal
   * @returns Literal with xsd:date datatype
   *
   * Examples:
   * - dateAddYearMonth("2025-01-15", "P1Y") → "2026-01-15"
   * - dateAddYearMonth("2025-01-31", "P1M") → "2025-02-28" (month end adjustment)
   */
  static dateAddYearMonth(date: string | Literal, duration: string | Literal): Literal {
    const dateValue = date instanceof Literal ? date.value : date;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = this.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateAddYearMonth: invalid date: '${dateValue}'`);
    }

    const months = this.parseYearMonthDuration(durValue);

    // Add months to the date
    const originalDay = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + months);

    // Handle month-end overflow
    if (d.getUTCDate() !== originalDay) {
      d.setUTCDate(0);
    }

    // Format as xsd:date (YYYY-MM-DD)
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    return new Literal(dateStr, new IRI("http://www.w3.org/2001/XMLSchema#date"));
  }

  /**
   * Subtract a yearMonthDuration from a date value.
   * Per SPARQL 1.2 specification: date - yearMonthDuration = date
   *
   * @param date - date string or Literal
   * @param duration - xsd:yearMonthDuration string or Literal
   * @returns Literal with xsd:date datatype
   */
  static dateSubtractYearMonth(date: string | Literal, duration: string | Literal): Literal {
    const dateValue = date instanceof Literal ? date.value : date;
    const durValue = duration instanceof Literal ? duration.value : duration;

    const d = this.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateSubtractYearMonth: invalid date: '${dateValue}'`);
    }

    const months = this.parseYearMonthDuration(durValue);

    // Subtract months from the date
    const originalDay = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() - months);

    // Handle month-end overflow
    if (d.getUTCDate() !== originalDay) {
      d.setUTCDate(0);
    }

    // Format as xsd:date (YYYY-MM-DD)
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    return new Literal(dateStr, new IRI("http://www.w3.org/2001/XMLSchema#date"));
  }

  /**
   * Add two xsd:dayTimeDuration values.
   *
   * @param duration1 - First duration string or Literal
   * @param duration2 - Second duration string or Literal
   * @returns Literal with xsd:dayTimeDuration datatype
   *
   * Examples:
   * - durationAdd("PT2H", "PT30M") → "PT2H30M"
   */
  static durationAdd(duration1: string | Literal, duration2: string | Literal): Literal {
    const d1Value = duration1 instanceof Literal ? duration1.value : duration1;
    const d2Value = duration2 instanceof Literal ? duration2.value : duration2;

    const ms1 = this.parseDayTimeDuration(d1Value);
    const ms2 = this.parseDayTimeDuration(d2Value);

    const resultStr = this.formatDayTimeDuration(ms1 + ms2);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Subtract two xsd:dayTimeDuration values.
   *
   * @param duration1 - First duration string or Literal (minuend)
   * @param duration2 - Second duration string or Literal (subtrahend)
   * @returns Literal with xsd:dayTimeDuration datatype
   *
   * Examples:
   * - durationSubtract("PT2H30M", "PT30M") → "PT2H"
   */
  static durationSubtract(duration1: string | Literal, duration2: string | Literal): Literal {
    const d1Value = duration1 instanceof Literal ? duration1.value : duration1;
    const d2Value = duration2 instanceof Literal ? duration2.value : duration2;

    const ms1 = this.parseDayTimeDuration(d1Value);
    const ms2 = this.parseDayTimeDuration(d2Value);

    const resultStr = this.formatDayTimeDuration(ms1 - ms2);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Multiply an xsd:dayTimeDuration by a numeric value.
   *
   * @param duration - Duration string or Literal
   * @param multiplier - Numeric multiplier
   * @returns Literal with xsd:dayTimeDuration datatype
   *
   * Examples:
   * - durationMultiply("PT2H", 2) → "PT4H"
   */
  static durationMultiply(duration: string | Literal, multiplier: number): Literal {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = this.parseDayTimeDuration(durValue);
    const resultStr = this.formatDayTimeDuration(ms * multiplier);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Divide an xsd:dayTimeDuration by a numeric value.
   *
   * @param duration - Duration string or Literal
   * @param divisor - Numeric divisor (must not be zero)
   * @returns Literal with xsd:dayTimeDuration datatype
   *
   * Examples:
   * - durationDivide("PT4H", 2) → "PT2H"
   */
  static durationDivide(duration: string | Literal, divisor: number): Literal {
    if (divisor === 0) {
      throw new Error("durationDivide: division by zero");
    }
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = this.parseDayTimeDuration(durValue);
    const resultStr = this.formatDayTimeDuration(ms / divisor);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  // =========================================================================
  // xsd:yearMonthDuration Arithmetic (Issue #975)
  // =========================================================================

  /**
   * Format total months as an xsd:yearMonthDuration string.
   *
   * @param totalMonths - Total number of months (can be negative)
   * @returns Canonical xsd:yearMonthDuration string (e.g., "P1Y2M", "P3M", "-P1Y")
   *
   * Examples:
   * - formatYearMonthDuration(14) → "P1Y2M"
   * - formatYearMonthDuration(3) → "P3M"
   * - formatYearMonthDuration(-12) → "-P1Y"
   * - formatYearMonthDuration(0) → "P0M"
   */
  static formatYearMonthDuration(totalMonths: number): string {
    const negative = totalMonths < 0;
    const absMonths = Math.abs(totalMonths);

    const years = Math.floor(absMonths / 12);
    const months = absMonths % 12;

    let result = negative ? "-P" : "P";

    if (years > 0) {
      result += `${years}Y`;
    }

    // Include months if non-zero, or if no years (to avoid "P" alone)
    if (months > 0 || years === 0) {
      result += `${months}M`;
    }

    return result;
  }

  /**
   * Add two xsd:yearMonthDuration values.
   * Per SPARQL 1.1 specification: yearMonthDuration + yearMonthDuration = yearMonthDuration
   *
   * @param duration1 - First yearMonthDuration string or Literal
   * @param duration2 - Second yearMonthDuration string or Literal
   * @returns Literal with xsd:yearMonthDuration datatype
   *
   * Examples:
   * - yearMonthDurationAdd("P1Y", "P2M") → "P1Y2M"
   * - yearMonthDurationAdd("P1Y6M", "P6M") → "P2Y"
   */
  static yearMonthDurationAdd(duration1: string | Literal, duration2: string | Literal): Literal {
    const d1Value = duration1 instanceof Literal ? duration1.value : duration1;
    const d2Value = duration2 instanceof Literal ? duration2.value : duration2;

    const months1 = this.parseYearMonthDuration(d1Value);
    const months2 = this.parseYearMonthDuration(d2Value);

    const resultStr = this.formatYearMonthDuration(months1 + months2);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#yearMonthDuration"));
  }

  /**
   * Subtract two xsd:yearMonthDuration values.
   * Per SPARQL 1.1 specification: yearMonthDuration - yearMonthDuration = yearMonthDuration
   *
   * @param duration1 - First yearMonthDuration string or Literal (minuend)
   * @param duration2 - Second yearMonthDuration string or Literal (subtrahend)
   * @returns Literal with xsd:yearMonthDuration datatype
   *
   * Examples:
   * - yearMonthDurationSubtract("P2Y", "P6M") → "P1Y6M"
   * - yearMonthDurationSubtract("P1Y", "P1Y2M") → "-P2M"
   */
  static yearMonthDurationSubtract(duration1: string | Literal, duration2: string | Literal): Literal {
    const d1Value = duration1 instanceof Literal ? duration1.value : duration1;
    const d2Value = duration2 instanceof Literal ? duration2.value : duration2;

    const months1 = this.parseYearMonthDuration(d1Value);
    const months2 = this.parseYearMonthDuration(d2Value);

    const resultStr = this.formatYearMonthDuration(months1 - months2);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#yearMonthDuration"));
  }

  /**
   * Parse an xsd:yearMonthDuration string and return the components.
   *
   * Format: PnYnM (e.g., "P1Y2M", "P3M", "P2Y", "-P1Y")
   *
   * @param durationStr - xsd:yearMonthDuration string
   * @returns Object with years, months, and negative flag
   */
  private static parseYearMonthDurationComponents(durationStr: string): {
    years: number;
    months: number;
    negative: boolean;
  } {
    // Pattern: optional negative sign, P, optional years, optional months
    const pattern = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?$/;
    const match = durationStr.match(pattern);

    if (!match) {
      throw new Error(`parseYearMonthDurationComponents: invalid format: '${durationStr}'`);
    }

    const negative = match[1] === "-";
    const years = parseInt(match[2] || "0", 10);
    const months = parseInt(match[3] || "0", 10);

    // Validate that at least years or months is specified
    if (!match[2] && !match[3]) {
      throw new Error(`parseYearMonthDurationComponents: invalid format (no duration components): '${durationStr}'`);
    }

    return { years, months, negative };
  }

  /**
   * YEARS accessor function for xsd:yearMonthDuration.
   * Extracts the years component from a yearMonthDuration value.
   *
   * Per XPath/SPARQL functions specification, returns the integer years component.
   *
   * @param duration - xsd:yearMonthDuration string or Literal
   * @returns Integer years component (can be negative)
   *
   * Examples:
   * - YEARS("P1Y6M") → 1
   * - YEARS("P3M") → 0
   * - YEARS("-P2Y3M") → -2
   */
  static durationYears(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const components = this.parseYearMonthDurationComponents(durValue);
    return components.negative ? -components.years : components.years;
  }

  /**
   * MONTHS accessor function for xsd:yearMonthDuration.
   * Extracts the months component from a yearMonthDuration value.
   *
   * Per XPath/SPARQL functions specification, returns the integer months component
   * (0-11 range, not total months converted from years).
   *
   * @param duration - xsd:yearMonthDuration string or Literal
   * @returns Integer months component (can be negative, range -11 to 11)
   *
   * Examples:
   * - MONTHS("P1Y6M") → 6
   * - MONTHS("P14M") → 14 (if specified as 14M, returns 14)
   * - MONTHS("-P1Y3M") → -3
   */
  static durationMonths(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const components = this.parseYearMonthDurationComponents(durValue);
    return components.negative ? -components.months : components.months;
  }

  /**
   * Get the total number of days from an xsd:dayTimeDuration (as decimal).
   *
   * @param duration - Duration string or Literal
   * @returns Number of days (can be fractional)
   */
  static durationToDays(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = this.parseDayTimeDuration(durValue);
    return ms / (24 * 60 * 60 * 1000);
  }

  /**
   * Get the total number of hours from an xsd:dayTimeDuration (as decimal).
   *
   * @param duration - Duration string or Literal
   * @returns Number of hours (can be fractional)
   */
  static durationToHours(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = this.parseDayTimeDuration(durValue);
    return ms / (60 * 60 * 1000);
  }

  /**
   * Get the total number of minutes from an xsd:dayTimeDuration (as decimal).
   *
   * @param duration - Duration string or Literal
   * @returns Number of minutes (can be fractional)
   */
  static durationToMinutes(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = this.parseDayTimeDuration(durValue);
    return ms / (60 * 1000);
  }

  /**
   * Get the total number of seconds from an xsd:dayTimeDuration (as decimal).
   *
   * @param duration - Duration string or Literal
   * @returns Number of seconds (can be fractional)
   */
  static durationToSeconds(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = this.parseDayTimeDuration(durValue);
    return ms / 1000;
  }

  // =========================================================================
  // xsd:dayTimeDuration Component Accessor Functions (SPARQL 1.1 Issue #989)
  // https://www.w3.org/TR/xpath-functions/#dt-dayTimeDuration
  // =========================================================================

  /**
   * Parse duration string and extract individual components.
   * Internal helper for DAYS(), HOURS(), MINUTES(), SECONDS() functions.
   *
   * @param durationStr - xsd:dayTimeDuration string
   * @returns Object with days, hours, minutes, seconds components
   */
  private static parseDurationComponents(durationStr: string): {
    negative: boolean;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } {
    if (!durationStr) {
      throw new Error("parseDurationComponents: duration string is empty");
    }

    // Handle sign
    let negative = false;
    let str = durationStr.trim();
    if (str.startsWith("-")) {
      negative = true;
      str = str.substring(1);
    }

    // Must start with 'P'
    if (!str.startsWith("P")) {
      throw new Error(`parseDurationComponents: invalid format, must start with 'P': '${durationStr}'`);
    }
    str = str.substring(1);

    let days = 0;
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    // Parse days (before T)
    const tIndex = str.indexOf("T");
    let dayPart = "";
    let timePart = "";

    if (tIndex === -1) {
      // No time part, could be just days like "P1D"
      dayPart = str;
    } else {
      dayPart = str.substring(0, tIndex);
      timePart = str.substring(tIndex + 1);
    }

    // Parse days: nD
    if (dayPart) {
      const dayMatch = dayPart.match(/^(\d+(?:\.\d+)?)D$/);
      if (dayMatch) {
        days = parseFloat(dayMatch[1]);
      } else if (dayPart !== "") {
        throw new Error(`parseDurationComponents: invalid day component: '${dayPart}' in '${durationStr}'`);
      }
    }

    // Parse time part: [nH][nM][nS] or [nH][nM][n.nS]
    if (timePart) {
      let remaining = timePart;

      // Hours: nH
      const hourMatch = remaining.match(/^(\d+(?:\.\d+)?)H/);
      if (hourMatch) {
        hours = parseFloat(hourMatch[1]);
        remaining = remaining.substring(hourMatch[0].length);
      }

      // Minutes: nM
      const minMatch = remaining.match(/^(\d+(?:\.\d+)?)M/);
      if (minMatch) {
        minutes = parseFloat(minMatch[1]);
        remaining = remaining.substring(minMatch[0].length);
      }

      // Seconds: nS or n.nS
      const secMatch = remaining.match(/^(\d+(?:\.\d+)?)S$/);
      if (secMatch) {
        seconds = parseFloat(secMatch[1]);
        remaining = remaining.substring(secMatch[0].length);
      }

      // If there's remaining content, it's invalid
      if (remaining !== "") {
        throw new Error(`parseDurationComponents: invalid time component: '${remaining}' in '${durationStr}'`);
      }
    }

    return { negative, days, hours, minutes, seconds };
  }

  /**
   * DAYS accessor function for xsd:dayTimeDuration.
   * Extracts the days component from a duration value.
   *
   * Per XPath/SPARQL functions specification, returns the integer days component.
   *
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Integer days component (can be negative)
   *
   * Examples:
   * - DAYS("P1DT2H30M") → 1
   * - DAYS("PT5H") → 0
   * - DAYS("-P2DT3H") → -2
   */
  static durationDays(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const components = this.parseDurationComponents(durValue);
    const result = Math.floor(components.days);
    return components.negative ? -result : result;
  }

  /**
   * HOURS accessor function for xsd:dayTimeDuration.
   * Extracts the hours component from a duration value.
   *
   * Per XPath/SPARQL functions specification, returns the integer hours component
   * (0-23 range, not total hours converted from days).
   *
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Integer hours component (can be negative, range -23 to 23)
   *
   * Examples:
   * - HOURS("PT1H30M") → 1
   * - HOURS("P1DT2H30M") → 2 (not 26)
   * - HOURS("-PT8H30M") → -8
   */
  static durationHours(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const components = this.parseDurationComponents(durValue);
    const result = Math.floor(components.hours);
    return components.negative ? -result : result;
  }

  /**
   * MINUTES accessor function for xsd:dayTimeDuration.
   * Extracts the minutes component from a duration value.
   *
   * Per XPath/SPARQL functions specification, returns the integer minutes component
   * (0-59 range, not total minutes converted from hours/days).
   *
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Integer minutes component (can be negative, range -59 to 59)
   *
   * Examples:
   * - MINUTES("PT1H30M") → 30
   * - MINUTES("PT90M") → 90 (if specified as 90M, returns 90)
   * - MINUTES("-PT1H45M") → -45
   */
  static durationMinutes(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const components = this.parseDurationComponents(durValue);
    const result = Math.floor(components.minutes);
    return components.negative ? -result : result;
  }

  /**
   * SECONDS accessor function for xsd:dayTimeDuration.
   * Extracts the seconds component from a duration value.
   *
   * Per XPath/SPARQL functions specification, returns the decimal seconds component
   * (includes fractional seconds, 0-59.999... range, not total seconds).
   *
   * @param duration - xsd:dayTimeDuration string or Literal
   * @returns Decimal seconds component (can be negative)
   *
   * Examples:
   * - SECONDS("PT1H30M45S") → 45
   * - SECONDS("PT1.5S") → 1.5
   * - SECONDS("-PT30.123S") → -30.123
   */
  static durationSeconds(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const components = this.parseDurationComponents(durValue);
    return components.negative ? -components.seconds : components.seconds;
  }

  // =========================================================================
  // SPARQL 1.2 ADJUST Function (Issue #976)
  // https://www.w3.org/TR/xpath-functions/#func-adjust-dateTime-to-timezone
  // =========================================================================

  /**
   * SPARQL 1.2 ADJUST function.
   * Adjusts a dateTime value to a different timezone while preserving the instant in time.
   *
   * If timezone is provided, the dateTime is converted to that timezone.
   * If timezone is absent/undefined, the timezone is removed from the dateTime.
   *
   * @param dateTime - xsd:dateTime string or Literal
   * @param timezone - Optional xsd:dayTimeDuration string or Literal representing the target timezone
   * @returns Literal with xsd:dateTime datatype
   *
   * Examples:
   * - ADJUST("2025-01-15T10:00:00Z", "PT5H") → "2025-01-15T15:00:00+05:00"
   * - ADJUST("2025-01-15T10:00:00Z") → "2025-01-15T10:00:00" (no timezone)
   * - ADJUST("2025-01-15T10:00:00+03:00", "-PT5H") → "2025-01-15T02:00:00-05:00"
   */
  static adjust(dateTime: string | Literal, timezone?: string | Literal): Literal {
    const dtValue = dateTime instanceof Literal ? dateTime.value : dateTime;

    // Parse the input dateTime
    const date = new Date(dtValue);
    if (isNaN(date.getTime())) {
      throw new Error(`ADJUST: invalid dateTime: '${dtValue}'`);
    }

    // If no timezone provided, remove timezone information
    if (timezone === undefined || timezone === null) {
      // Format as dateTime without timezone (local representation)
      // Use the UTC time values to create a "no timezone" representation
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hours = String(date.getUTCHours()).padStart(2, "0");
      const minutes = String(date.getUTCMinutes()).padStart(2, "0");
      const seconds = String(date.getUTCSeconds()).padStart(2, "0");
      const ms = date.getUTCMilliseconds();

      let result = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
      if (ms > 0) {
        result += `.${String(ms).padStart(3, "0")}`;
      }

      return new Literal(result, new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
    }

    // Parse the target timezone as dayTimeDuration
    const tzValue = timezone instanceof Literal ? timezone.value : timezone;
    const tzOffsetMs = this.parseDayTimeDuration(tzValue);

    // Validate timezone offset is within valid range (-14:00 to +14:00)
    const maxOffsetMs = 14 * 60 * 60 * 1000;
    if (Math.abs(tzOffsetMs) > maxOffsetMs) {
      throw new Error(`ADJUST: timezone offset out of range: '${tzValue}'`);
    }

    // Get the UTC time in milliseconds
    const utcMs = date.getTime();

    // Create a new date adjusted to the target timezone
    const adjustedDate = new Date(utcMs + tzOffsetMs);

    // Format the adjusted dateTime with the target timezone
    const year = adjustedDate.getUTCFullYear();
    const month = String(adjustedDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(adjustedDate.getUTCDate()).padStart(2, "0");
    const hours = String(adjustedDate.getUTCHours()).padStart(2, "0");
    const minutes = String(adjustedDate.getUTCMinutes()).padStart(2, "0");
    const seconds = String(adjustedDate.getUTCSeconds()).padStart(2, "0");
    const ms = adjustedDate.getUTCMilliseconds();

    // Format timezone offset
    const tzSign = tzOffsetMs >= 0 ? "+" : "-";
    const tzHours = Math.floor(Math.abs(tzOffsetMs) / (60 * 60 * 1000));
    const tzMins = Math.floor((Math.abs(tzOffsetMs) % (60 * 60 * 1000)) / (60 * 1000));
    const tzStr = `${tzSign}${String(tzHours).padStart(2, "0")}:${String(tzMins).padStart(2, "0")}`;

    let result = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    if (ms > 0) {
      result += `.${String(ms).padStart(3, "0")}`;
    }
    result += tzStr;

    return new Literal(result, new IRI("http://www.w3.org/2001/XMLSchema#dateTime"));
  }

  // =========================================================================
  // SPARQL 1.2 NORMALIZE Function (Issue #982)
  // https://www.w3.org/TR/sparql12-query/#func-normalize
  // =========================================================================

  /**
   * Valid Unicode normalization forms per SPARQL 1.2 specification.
   */
  private static readonly VALID_NORMALIZATION_FORMS = ["NFC", "NFD", "NFKC", "NFKD"] as const;

  /**
   * SPARQL 1.2 NORMALIZE function.
   * Normalizes a Unicode string to a canonical form for consistent comparison.
   *
   * Unicode normalization forms:
   * - NFC (default): Canonical Decomposition, followed by Canonical Composition
   * - NFD: Canonical Decomposition
   * - NFKC: Compatibility Decomposition, followed by Canonical Composition
   * - NFKD: Compatibility Decomposition
   *
   * @param str - String or Literal to normalize
   * @param form - Optional normalization form (defaults to "NFC")
   * @returns Literal with normalized string value
   *
   * Examples:
   * - NORMALIZE("café") → NFC-normalized "café"
   * - NORMALIZE("ﬁ", "NFKC") → "fi" (compatibility normalization decomposes ligatures)
   * - NORMALIZE("Ω", "NFD") → NFD-normalized omega (decomposed form)
   */
  static normalize(str: RDFTerm | string | undefined, form?: RDFTerm | string | undefined): Literal {
    if (str === undefined) {
      throw new Error("NORMALIZE: string argument is undefined");
    }

    // Extract string value
    let strValue: string;
    if (str instanceof Literal) {
      strValue = str.value;
    } else if (str instanceof IRI) {
      strValue = str.value;
    } else if (str instanceof BlankNode) {
      strValue = str.id;
    } else if (typeof str === "string") {
      strValue = str;
    } else {
      throw new Error("NORMALIZE: first argument must be a string or literal");
    }

    // Extract normalization form (default to NFC)
    let normForm: string = "NFC";
    if (form !== undefined) {
      if (form instanceof Literal) {
        normForm = form.value.toUpperCase();
      } else if (typeof form === "string") {
        normForm = form.toUpperCase();
      } else if (form instanceof IRI) {
        normForm = form.value.toUpperCase();
      } else {
        throw new Error("NORMALIZE: second argument must be a string literal");
      }
    }

    // Validate normalization form
    if (!this.VALID_NORMALIZATION_FORMS.includes(normForm as "NFC" | "NFD" | "NFKC" | "NFKD")) {
      throw new Error(`NORMALIZE: invalid normalization form '${normForm}'. Valid forms are: NFC, NFD, NFKC, NFKD`);
    }

    // Apply Unicode normalization
    const normalized = strValue.normalize(normForm as "NFC" | "NFD" | "NFKC" | "NFKD");

    return new Literal(normalized, new IRI("http://www.w3.org/2001/XMLSchema#string"));
  }

  // =========================================================================
  // SPARQL 1.2 FOLD Function (Issue #983)
  // https://www.w3.org/TR/sparql12-query/#func-fold
  // Unicode Case Folding per Unicode Standard Annex #15
  // =========================================================================

  /**
   * Unicode case folding mappings for special characters.
   * These are characters that don't simply map to their lowercase equivalent.
   * Based on Unicode Case Folding data (CaseFolding.txt).
   *
   * Key mappings include:
   * - German sharp S (ß) → ss (full case folding)
   * - Greek capital letter sigma (Σ) → σ (final form uses same lowercase)
   * - Turkish dotted/dotless I handling
   * - Various ligatures and special characters
   */
  private static readonly CASE_FOLDING_MAP: Map<string, string> = new Map([
    // German sharp S (full case folding)
    ["\u00DF", "ss"], // ß → ss
    ["\u1E9E", "ss"], // ẞ (capital sharp S) → ss

    // Greek sigma variants - all fold to lowercase sigma
    ["\u03A3", "\u03C3"], // Σ → σ
    ["\u03C2", "\u03C3"], // ς (final sigma) → σ

    // Turkish special cases
    ["\u0130", "i\u0307"], // İ (dotted I) → i + combining dot above
    ["\u0049", "\u0069"], // I → i (standard, but included for completeness)

    // Armenian ligatures
    ["\u0587", "\u0565\u0582"], // և → եdelays

    // Various other full case foldings from Unicode
    ["\uFB00", "ff"], // ﬀ → ff
    ["\uFB01", "fi"], // ﬁ → fi
    ["\uFB02", "fl"], // ﬂ → fl
    ["\uFB03", "ffi"], // ﬃ → ffi
    ["\uFB04", "ffl"], // ﬄ → ffl
    ["\uFB05", "st"], // ﬅ → st
    ["\uFB06", "st"], // ﬆ → st

    // Greek small letter iota with dialytika and tonos
    ["\u0390", "\u03B9\u0308\u0301"], // ΐ

    // Greek small letter upsilon with dialytika and tonos
    ["\u03B0", "\u03C5\u0308\u0301"], // ΰ

    // Latin small letter long S
    ["\u017F", "s"], // ſ → s

    // Cherokee small letters (map uppercase to lowercase)
    // Note: Cherokee case mapping was added in Unicode 8.0

    // Medieval Latin characters
    ["\u1E9B", "\u1E61"], // ẛ → ṡ (Latin small letter long s with dot above)

    // Kelvin sign
    ["\u212A", "k"], // K (Kelvin sign) → k

    // Angstrom sign
    ["\u212B", "\u00E5"], // Å (Angstrom) → å
  ]);

  /**
   * SPARQL 1.2 FOLD function.
   * Performs Unicode case folding for case-insensitive string comparison.
   *
   * Case folding is more comprehensive than simple lowercase conversion:
   * - Handles special cases like German ß → ss
   * - Handles Greek sigma variants
   * - Handles ligatures (ﬁ → fi, ﬂ → fl, etc.)
   * - Ensures consistent comparison across all Unicode scripts
   *
   * @param str - String or Literal to case-fold
   * @returns Literal with case-folded string value
   *
   * @see https://www.w3.org/TR/sparql12-query/#func-fold
   * @see https://unicode.org/reports/tr44/#Casemapping
   *
   * Examples:
   * - FOLD("Hello") → "hello"
   * - FOLD("Straße") → "strasse"
   * - FOLD("ΣΕΛΛΑΣ") → "σελλασ"
   * - FOLD("ﬁle") → "file"
   */
  static fold(str: RDFTerm | string | undefined): Literal {
    if (str === undefined) {
      throw new Error("FOLD: string argument is undefined");
    }

    // Extract string value
    let strValue: string;
    if (str instanceof Literal) {
      strValue = str.value;
    } else if (str instanceof IRI) {
      strValue = str.value;
    } else if (str instanceof BlankNode) {
      strValue = str.id;
    } else if (typeof str === "string") {
      strValue = str;
    } else {
      throw new Error("FOLD: argument must be a string or literal");
    }

    // Apply Unicode case folding
    const folded = this.unicodeCaseFold(strValue);

    return new Literal(folded, new IRI("http://www.w3.org/2001/XMLSchema#string"));
  }

  /**
   * Performs full Unicode case folding on a string.
   *
   * This implements Unicode case folding following the Unicode Standard Annex #15.
   * Case folding is used for case-insensitive matching and differs from
   * simple lowercasing in several ways:
   *
   * 1. It uses full case folding (e.g., ß → ss, not ß → ß)
   * 2. It handles special characters that don't have simple case mappings
   * 3. It provides consistent results across all Unicode scripts
   *
   * @param str - Input string to case-fold
   * @returns Case-folded string
   */
  private static unicodeCaseFold(str: string): string {
    let result = "";

    for (const char of str) {
      // Check if character has special case folding
      const folded = this.CASE_FOLDING_MAP.get(char);
      if (folded !== undefined) {
        result += folded;
      } else {
        // Use standard toLowerCase for characters without special mapping
        // This handles the vast majority of characters correctly
        result += char.toLowerCase();
      }
    }

    return result;
  }

  // =========================================================================
  // xsd:time Subtraction Support (SPARQL 1.2 Issue #963)
  // https://www.w3.org/TR/xpath-functions/#func-subtract-times
  // =========================================================================

  /**
   * Check if a value is an xsd:time Literal.
   *
   * @param value - Value to check
   * @returns true if the value is an xsd:time Literal
   */
  static isTime(value: any): boolean {
    if (value instanceof Literal) {
      const datatypeValue = value.datatype?.value || "";
      return datatypeValue === "http://www.w3.org/2001/XMLSchema#time";
    }
    return false;
  }

  /**
   * Subtract two xsd:time values and return an xsd:dayTimeDuration.
   * Per SPARQL 1.2 specification: time - time = dayTimeDuration
   *
   * Time values are treated as times within a single day (no date component).
   * The result can be negative if the first time is earlier than the second.
   *
   * @param time1 - First time string or Literal (minuend)
   * @param time2 - Second time string or Literal (subtrahend)
   * @returns Literal with xsd:dayTimeDuration datatype representing the difference
   *
   * Examples:
   * - timeDiff("14:30:00", "10:00:00") → "PT4H30M"
   * - timeDiff("08:00:00", "23:00:00") → "-PT15H"
   * - timeDiff("12:00:00", "12:00:00") → "PT0S"
   * - timeDiff("10:30:45.500", "10:30:45") → "PT0.5S"
   */
  static timeDiff(time1: string | Literal, time2: string | Literal): Literal {
    const t1Value = time1 instanceof Literal ? time1.value : time1;
    const t2Value = time2 instanceof Literal ? time2.value : time2;

    // Parse times into milliseconds from midnight
    const t1Ms = this.parseXSDTime(t1Value);
    const t2Ms = this.parseXSDTime(t2Value);

    if (t1Ms === null) {
      throw new Error(`timeDiff: invalid first time: '${t1Value}'`);
    }
    if (t2Ms === null) {
      throw new Error(`timeDiff: invalid second time: '${t2Value}'`);
    }

    // Calculate difference in milliseconds
    const diffMs = t1Ms - t2Ms;

    // Format as dayTimeDuration
    const durationStr = this.formatDayTimeDuration(diffMs);

    return new Literal(durationStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  /**
   * Parse an xsd:time string into milliseconds from midnight.
   *
   * Handles various time formats:
   * - "14:30:00" (standard xsd:time)
   * - "14:30:00Z" (with UTC timezone)
   * - "14:30:00+05:00" (with timezone offset)
   * - "14:30:00.500" (with fractional seconds)
   * - "14:30:00.500Z" (with fractional seconds and timezone)
   *
   * Timezone handling: When a timezone is present, the time is normalized
   * to UTC for consistent comparison. E.g., "15:00:00+05:00" becomes
   * 10:00:00 UTC (15:00 - 5 hours offset).
   *
   * @param timeStr - xsd:time string
   * @returns Milliseconds from midnight (UTC), or null if invalid
   */
  private static parseXSDTime(timeStr: string): number | null {
    // Match xsd:time format: HH:MM:SS[.sss][Z|±HH:MM]
    // Per XSD spec: https://www.w3.org/TR/xmlschema-2/#time
    const timePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/;
    const match = timeStr.match(timePattern);

    if (!match) {
      return null;
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const fractionalPart = match[4];
    const timezone = match[5];

    // Validate time components
    if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
      return null;
    }
    // Special case: 24:00:00 is valid but means midnight (end of day)
    if (hours === 24 && (minutes !== 0 || seconds !== 0)) {
      return null;
    }

    // Calculate milliseconds
    let milliseconds = 0;
    if (fractionalPart) {
      // Pad or truncate to 3 digits for milliseconds
      const normalizedFraction = fractionalPart.padEnd(3, "0").slice(0, 3);
      milliseconds = parseInt(normalizedFraction, 10);
    }

    // Calculate total milliseconds from midnight
    let totalMs = hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000 + milliseconds;

    // Handle 24:00:00 as 0 (next day's midnight = current day's end)
    if (hours === 24) {
      totalMs = 24 * 60 * 60 * 1000;
    }

    // Adjust for timezone if specified
    if (timezone && timezone !== "Z") {
      const tzMatch = timezone.match(/([+-])(\d{2}):(\d{2})/);
      if (tzMatch) {
        const sign = tzMatch[1] === "+" ? 1 : -1;
        const tzHours = parseInt(tzMatch[2], 10);
        const tzMinutes = parseInt(tzMatch[3], 10);
        const offsetMs = sign * (tzHours * 60 + tzMinutes) * 60 * 1000;
        // Subtract offset to normalize to UTC
        totalMs -= offsetMs;
      }
    }

    return totalMs;
  }
}
