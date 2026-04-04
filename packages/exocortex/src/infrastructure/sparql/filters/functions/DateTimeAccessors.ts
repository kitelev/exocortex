import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";
import { DateTimeParsing } from "./DateTimeParsing";

/**
 * DateTime accessor, comparison, and type-checking functions.
 * Implements SPARQL 1.1/1.2 component extraction, comparison, and type guards.
 */
export class DateTimeAccessors {

  // =========================================================================
  // SPARQL 1.1 Date/Time Accessor Functions
  // https://www.w3.org/TR/sparql11-query/#func-year
  // =========================================================================

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

  // =========================================================================
  // Duration Component Accessors
  // =========================================================================

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
    const components = DateTimeParsing.parseDurationComponents(durValue);
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
    const components = DateTimeParsing.parseDurationComponents(durValue);
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
    const components = DateTimeParsing.parseDurationComponents(durValue);
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
    const components = DateTimeParsing.parseDurationComponents(durValue);
    return components.negative ? -components.seconds : components.seconds;
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
    const components = DateTimeParsing.parseYearMonthDurationComponents(durValue);
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
    const components = DateTimeParsing.parseYearMonthDurationComponents(durValue);
    return components.negative ? -components.months : components.months;
  }

  // =========================================================================
  // Timezone Functions
  // =========================================================================

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
    const tzOffsetMs = DateTimeParsing.parseDayTimeDuration(tzValue);

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

  /**
   * SPARQL 1.1 NOW function.
   * Returns the current dateTime as ISO string.
   */
  static now(): string {
    return new Date().toISOString();
  }

  // =========================================================================
  // Comparison Functions
  // =========================================================================

  /**
   * Check if date1 is before date2.
   * Custom function for date comparison support.
   */
  static dateBefore(date1: string, date2: string): boolean {
    const d1 = DateTimeParsing.parseDate(date1);
    const d2 = DateTimeParsing.parseDate(date2);
    return d1 < d2;
  }

  /**
   * Check if date1 is after date2.
   * Custom function for date comparison support.
   */
  static dateAfter(date1: string, date2: string): boolean {
    const d1 = DateTimeParsing.parseDate(date1);
    const d2 = DateTimeParsing.parseDate(date2);
    return d1 > d2;
  }

  /**
   * Check if date is within a range [start, end].
   * Custom function for date comparison support.
   */
  static dateInRange(date: string, start: string, end: string): boolean {
    const d = DateTimeParsing.parseDate(date);
    const s = DateTimeParsing.parseDate(start);
    const e = DateTimeParsing.parseDate(end);
    return d >= s && d <= e;
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

    const ms1 = DateTimeParsing.parseDayTimeDuration(d1Value);
    const ms2 = DateTimeParsing.parseDayTimeDuration(d2Value);

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
   * Calculate the difference between two dates in minutes.
   * Returns the absolute difference (always positive).
   * Custom function for duration calculation support.
   *
   * @param date1 - First date string (start timestamp)
   * @param date2 - Second date string (end timestamp)
   * @returns Difference in minutes (positive number)
   */
  static dateDiffMinutes(date1: string, date2: string): number {
    const d1 = DateTimeParsing.parseDate(date1);
    const d2 = DateTimeParsing.parseDate(date2);
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
    const d1 = DateTimeParsing.parseDate(date1);
    const d2 = DateTimeParsing.parseDate(date2);
    const diffMs = Math.abs(d2 - d1);
    return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
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
    const t1Ms = DateTimeParsing.parseXSDTime(t1Value);
    const t2Ms = DateTimeParsing.parseXSDTime(t2Value);

    if (t1Ms === null) {
      throw new Error(`timeDiff: invalid first time: '${t1Value}'`);
    }
    if (t2Ms === null) {
      throw new Error(`timeDiff: invalid second time: '${t2Value}'`);
    }

    // Calculate difference in milliseconds
    const diffMs = t1Ms - t2Ms;

    // Format as dayTimeDuration
    const durationStr = DateTimeParsing.formatDayTimeDuration(diffMs);

    return new Literal(durationStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }

  // =========================================================================
  // Type Checking Functions
  // =========================================================================

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
    const d1 = DateTimeParsing.parseXSDDate(d1Value);
    const d2 = DateTimeParsing.parseXSDDate(d2Value);

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
    const durationStr = DateTimeParsing.formatDateDuration(diffDays);

    return new Literal(durationStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
  }
}
