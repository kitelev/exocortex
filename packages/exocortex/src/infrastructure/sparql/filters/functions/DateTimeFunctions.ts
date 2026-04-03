import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";

export class DateTimeFunctions {

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
    const d1 = DateTimeFunctions.parseDate(date1);
    const d2 = DateTimeFunctions.parseDate(date2);
    return d1 < d2;
  }

  /**
   * Check if date1 is after date2.
   * Custom function for date comparison support.
   */
  static dateAfter(date1: string, date2: string): boolean {
    const d1 = DateTimeFunctions.parseDate(date1);
    const d2 = DateTimeFunctions.parseDate(date2);
    return d1 > d2;
  }

  /**
   * Check if date is within a range [start, end].
   * Custom function for date comparison support.
   */
  static dateInRange(date: string, start: string, end: string): boolean {
    const d = DateTimeFunctions.parseDate(date);
    const s = DateTimeFunctions.parseDate(start);
    const e = DateTimeFunctions.parseDate(end);
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
    const d1 = DateTimeFunctions.parseDate(date1);
    const d2 = DateTimeFunctions.parseDate(date2);
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
    const d1 = DateTimeFunctions.parseDate(date1);
    const d2 = DateTimeFunctions.parseDate(date2);
    const diffMs = Math.abs(d2 - d1);
    return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
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
    DateTimeFunctions.parseDayTimeDuration(value);
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

    const ms1 = DateTimeFunctions.parseDayTimeDuration(d1Value);
    const ms2 = DateTimeFunctions.parseDayTimeDuration(d2Value);

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
  static isDayTimeDuration(value: unknown): boolean {
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
  static isDate(value: unknown): boolean {
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
    const d1 = DateTimeFunctions.parseXSDDate(d1Value);
    const d2 = DateTimeFunctions.parseXSDDate(d2Value);

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
    const durationStr = DateTimeFunctions.formatDateDuration(diffDays);

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
    const durationStr = DateTimeFunctions.formatDayTimeDuration(diffMs);

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

    const durationMs = DateTimeFunctions.parseDayTimeDuration(durValue);
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

    const durationMs = DateTimeFunctions.parseDayTimeDuration(durValue);
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

    const d = DateTimeFunctions.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateAdd: invalid date: '${dateValue}'`);
    }

    const durationMs = DateTimeFunctions.parseDayTimeDuration(durValue);
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

    const d = DateTimeFunctions.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateSubtract: invalid date: '${dateValue}'`);
    }

    const durationMs = DateTimeFunctions.parseDayTimeDuration(durValue);
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

    const months = DateTimeFunctions.parseYearMonthDuration(durValue);

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

    const months = DateTimeFunctions.parseYearMonthDuration(durValue);

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

    const d = DateTimeFunctions.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateAddYearMonth: invalid date: '${dateValue}'`);
    }

    const months = DateTimeFunctions.parseYearMonthDuration(durValue);

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

    const d = DateTimeFunctions.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateSubtractYearMonth: invalid date: '${dateValue}'`);
    }

    const months = DateTimeFunctions.parseYearMonthDuration(durValue);

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

    const ms1 = DateTimeFunctions.parseDayTimeDuration(d1Value);
    const ms2 = DateTimeFunctions.parseDayTimeDuration(d2Value);

    const resultStr = DateTimeFunctions.formatDayTimeDuration(ms1 + ms2);
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

    const ms1 = DateTimeFunctions.parseDayTimeDuration(d1Value);
    const ms2 = DateTimeFunctions.parseDayTimeDuration(d2Value);

    const resultStr = DateTimeFunctions.formatDayTimeDuration(ms1 - ms2);
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
    const ms = DateTimeFunctions.parseDayTimeDuration(durValue);
    const resultStr = DateTimeFunctions.formatDayTimeDuration(ms * multiplier);
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
    const ms = DateTimeFunctions.parseDayTimeDuration(durValue);
    const resultStr = DateTimeFunctions.formatDayTimeDuration(ms / divisor);
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

    const months1 = DateTimeFunctions.parseYearMonthDuration(d1Value);
    const months2 = DateTimeFunctions.parseYearMonthDuration(d2Value);

    const resultStr = DateTimeFunctions.formatYearMonthDuration(months1 + months2);
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

    const months1 = DateTimeFunctions.parseYearMonthDuration(d1Value);
    const months2 = DateTimeFunctions.parseYearMonthDuration(d2Value);

    const resultStr = DateTimeFunctions.formatYearMonthDuration(months1 - months2);
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
    const components = DateTimeFunctions.parseYearMonthDurationComponents(durValue);
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
    const components = DateTimeFunctions.parseYearMonthDurationComponents(durValue);
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
    const ms = DateTimeFunctions.parseDayTimeDuration(durValue);
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
    const ms = DateTimeFunctions.parseDayTimeDuration(durValue);
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
    const ms = DateTimeFunctions.parseDayTimeDuration(durValue);
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
    const ms = DateTimeFunctions.parseDayTimeDuration(durValue);
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
    const components = DateTimeFunctions.parseDurationComponents(durValue);
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
    const components = DateTimeFunctions.parseDurationComponents(durValue);
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
    const components = DateTimeFunctions.parseDurationComponents(durValue);
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
    const components = DateTimeFunctions.parseDurationComponents(durValue);
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
    const tzOffsetMs = DateTimeFunctions.parseDayTimeDuration(tzValue);

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
  // xsd:time Subtraction Support (SPARQL 1.2 Issue #963)
  // https://www.w3.org/TR/xpath-functions/#func-subtract-times
  // =========================================================================

  /**
   * Check if a value is an xsd:time Literal.
   *
   * @param value - Value to check
   * @returns true if the value is an xsd:time Literal
   */
  static isTime(value: unknown): boolean {
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
    const t1Ms = DateTimeFunctions.parseXSDTime(t1Value);
    const t2Ms = DateTimeFunctions.parseXSDTime(t2Value);

    if (t1Ms === null) {
      throw new Error(`timeDiff: invalid first time: '${t1Value}'`);
    }
    if (t2Ms === null) {
      throw new Error(`timeDiff: invalid second time: '${t2Value}'`);
    }

    // Calculate difference in milliseconds
    const diffMs = t1Ms - t2Ms;

    // Format as dayTimeDuration
    const durationStr = DateTimeFunctions.formatDayTimeDuration(diffMs);

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
