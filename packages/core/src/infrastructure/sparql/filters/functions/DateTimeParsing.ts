import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";

/**
 * DateTime parsing, validation, and formatting functions.
 * These are foundational utilities used by DateTimeArithmetic and DateTimeAccessors.
 */
export class DateTimeParsing {

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
    DateTimeParsing.parseDayTimeDuration(value);
    return new Literal(value, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
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
  static parseXSDDate(dateStr: string): Date | null {
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
  static parseXSDTime(timeStr: string): number | null {
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

  /**
   * Format a number of days as an xsd:dayTimeDuration string.
   * Produces clean day-only format (P14D, -P14D, P0D).
   *
   * @param days - Number of days (can be negative)
   * @returns xsd:dayTimeDuration string in day-only format
   */
  static formatDateDuration(days: number): string {
    if (days === 0) {
      return "P0D";
    }

    const negative = days < 0;
    const absDays = Math.abs(days);

    return negative ? `-P${absDays}D` : `P${absDays}D`;
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
   * Parse an xsd:yearMonthDuration string and return the components.
   *
   * Format: PnYnM (e.g., "P1Y2M", "P3M", "P2Y", "-P1Y")
   *
   * @param durationStr - xsd:yearMonthDuration string
   * @returns Object with years, months, and negative flag
   */
  static parseYearMonthDurationComponents(durationStr: string): {
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
   * Parse duration string and extract individual components.
   * Helper for DAYS(), HOURS(), MINUTES(), SECONDS() functions.
   *
   * @param durationStr - xsd:dayTimeDuration string
   * @returns Object with days, hours, minutes, seconds components
   */
  static parseDurationComponents(durationStr: string): {
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
}
