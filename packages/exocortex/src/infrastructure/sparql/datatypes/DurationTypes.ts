/**
 * XSD dayTimeDuration parsing and formatting utilities.
 *
 * This module provides structured parsing of ISO 8601 duration format
 * (P[n]DT[n]H[n]M[n]S) and formatting back to canonical representation.
 *
 * @see https://www.w3.org/TR/xpath-functions/#dt-dayTimeDuration
 * @see https://www.w3.org/TR/xmlschema-2/#dayTimeDuration
 */

/**
 * Structured representation of an xsd:dayTimeDuration value.
 *
 * Represents duration in terms of days, hours, minutes, and seconds
 * with optional negative sign.
 */
export interface DayTimeDuration {
  /** Whether the duration is negative */
  negative: boolean;
  /** Number of whole days (0-n) */
  days: number;
  /** Number of hours (0-23) */
  hours: number;
  /** Number of minutes (0-59) */
  minutes: number;
  /** Number of seconds (0-59.999...), supports fractional seconds */
  seconds: number;
}

/**
 * Parse an xsd:dayTimeDuration string into a structured object.
 *
 * Supports the ISO 8601 duration format:
 * - `P[n]D` - days only
 * - `PT[n]H[n]M[n]S` - time only
 * - `P[n]DT[n]H[n]M[n]S` - days and time combined
 * - Negative durations with leading `-`
 * - Fractional seconds (e.g., PT1.5S)
 *
 * @param value - ISO 8601 dayTimeDuration string
 * @returns Structured DayTimeDuration object
 * @throws Error if the value is empty or invalid format
 *
 * @example
 * // Basic parsing
 * parseXSDDayTimeDuration("P1D")       // { negative: false, days: 1, hours: 0, minutes: 0, seconds: 0 }
 * parseXSDDayTimeDuration("PT1H30M")   // { negative: false, days: 0, hours: 1, minutes: 30, seconds: 0 }
 * parseXSDDayTimeDuration("P2DT3H")    // { negative: false, days: 2, hours: 3, minutes: 0, seconds: 0 }
 * parseXSDDayTimeDuration("-PT1H")     // { negative: true, days: 0, hours: 1, minutes: 0, seconds: 0 }
 * parseXSDDayTimeDuration("PT1.5S")    // { negative: false, days: 0, hours: 0, minutes: 0, seconds: 1.5 }
 */
export function parseXSDDayTimeDuration(value: string): DayTimeDuration {
  if (!value) {
    throw new Error("parseXSDDayTimeDuration: duration string is empty");
  }

  let str = value.trim();
  let negative = false;

  // Check for negative sign
  if (str.startsWith("-")) {
    negative = true;
    str = str.substring(1);
  }

  // Must start with 'P'
  if (!str.startsWith("P")) {
    throw new Error(
      `parseXSDDayTimeDuration: invalid format, must start with 'P': '${value}'`
    );
  }
  str = str.substring(1);

  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  // Split at 'T' to separate day part from time part
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
      throw new Error(
        `parseXSDDayTimeDuration: invalid day component: '${dayPart}' in '${value}'`
      );
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
      throw new Error(
        `parseXSDDayTimeDuration: invalid time component: '${remaining}' in '${value}'`
      );
    }
  }

  return { negative, days, hours, minutes, seconds };
}

/**
 * Convert a DayTimeDuration to total milliseconds.
 *
 * @param duration - Structured DayTimeDuration object
 * @returns Total milliseconds (negative if duration is negative)
 *
 * @example
 * durationToMilliseconds({ negative: false, days: 0, hours: 1, minutes: 30, seconds: 0 })
 * // Returns: 5400000 (1.5 hours in ms)
 */
export function durationToMilliseconds(duration: DayTimeDuration): number {
  const totalMs =
    duration.days * 24 * 60 * 60 * 1000 +
    duration.hours * 60 * 60 * 1000 +
    duration.minutes * 60 * 1000 +
    duration.seconds * 1000;

  return duration.negative ? -totalMs : totalMs;
}

/**
 * Convert milliseconds to a DayTimeDuration structure.
 *
 * @param ms - Duration in milliseconds (can be negative)
 * @returns Structured DayTimeDuration object
 *
 * @example
 * millisecondsToStructuredDuration(5400000)
 * // Returns: { negative: false, days: 0, hours: 1, minutes: 30, seconds: 0 }
 *
 * millisecondsToStructuredDuration(-3600000)
 * // Returns: { negative: true, days: 0, hours: 1, minutes: 0, seconds: 0 }
 */
export function millisecondsToStructuredDuration(ms: number): DayTimeDuration {
  const negative = ms < 0;
  let remaining = Math.abs(ms);

  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  remaining = remaining % (24 * 60 * 60 * 1000);

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  remaining = remaining % (60 * 60 * 1000);

  const minutes = Math.floor(remaining / (60 * 1000));
  remaining = remaining % (60 * 1000);

  const seconds = remaining / 1000;

  return { negative, days, hours, minutes, seconds };
}

/**
 * Format milliseconds as an xsd:dayTimeDuration string.
 *
 * Creates a canonical ISO 8601 duration string from milliseconds.
 * The output format follows these rules:
 * - Always starts with 'P' (or '-P' for negative)
 * - Days are included as 'nD' if present
 * - Time part starts with 'T' if any time components present
 * - Hours, minutes, seconds included only if non-zero
 * - If all components are zero, returns 'PT0S'
 *
 * @param ms - Duration in milliseconds (can be negative)
 * @returns xsd:dayTimeDuration string in canonical format
 *
 * @example
 * // Basic formatting
 * formatDayTimeDuration(5400000)    // "PT1H30M"
 * formatDayTimeDuration(86400000)   // "P1D"
 * formatDayTimeDuration(0)          // "PT0S"
 * formatDayTimeDuration(-3600000)   // "-PT1H"
 * formatDayTimeDuration(1500)       // "PT1.5S"
 */
export function formatDayTimeDuration(ms: number): string {
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

  // Add time part if any time component is present or if there are no days
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
 * Format a DayTimeDuration structure as an xsd:dayTimeDuration string.
 *
 * @param duration - Structured DayTimeDuration object
 * @returns xsd:dayTimeDuration string in canonical format
 *
 * @example
 * formatStructuredDuration({ negative: false, days: 0, hours: 1, minutes: 30, seconds: 0 })
 * // Returns: "PT1H30M"
 */
export function formatStructuredDuration(duration: DayTimeDuration): string {
  const ms = durationToMilliseconds(duration);
  return formatDayTimeDuration(ms);
}
