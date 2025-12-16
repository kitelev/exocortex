/**
 * XSD duration parsing and formatting utilities.
 *
 * This module provides structured parsing of ISO 8601 duration formats:
 * - dayTimeDuration: P[n]DT[n]H[n]M[n]S (days, hours, minutes, seconds)
 * - yearMonthDuration: P[n]Y[n]M (years and months)
 *
 * @see https://www.w3.org/TR/xpath-functions/#dt-dayTimeDuration
 * @see https://www.w3.org/TR/xpath-functions/#dt-yearMonthDuration
 * @see https://www.w3.org/TR/xmlschema-2/#dayTimeDuration
 * @see https://www.w3.org/TR/xmlschema-2/#yearMonthDuration
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

// ============================================================================
// YearMonthDuration Types and Functions
// ============================================================================

/**
 * Structured representation of an xsd:yearMonthDuration value.
 *
 * Represents duration in terms of years and months
 * with optional negative sign.
 */
export interface YearMonthDuration {
  /** Whether the duration is negative */
  negative: boolean;
  /** Number of years (0-n) */
  years: number;
  /** Number of months (0-11 after normalization, but can be >11 if not normalized) */
  months: number;
}

/**
 * Parse an xsd:yearMonthDuration string into a structured object.
 *
 * Supports the ISO 8601 duration format:
 * - `P[n]Y` - years only
 * - `P[n]M` - months only
 * - `P[n]Y[n]M` - years and months combined
 * - Negative durations with leading `-`
 *
 * @param value - ISO 8601 yearMonthDuration string
 * @returns Structured YearMonthDuration object
 * @throws Error if the value is empty or invalid format
 *
 * @example
 * // Basic parsing
 * parseXSDYearMonthDuration("P1Y")       // { negative: false, years: 1, months: 0 }
 * parseXSDYearMonthDuration("P6M")       // { negative: false, years: 0, months: 6 }
 * parseXSDYearMonthDuration("P1Y6M")     // { negative: false, years: 1, months: 6 }
 * parseXSDYearMonthDuration("-P1Y")      // { negative: true, years: 1, months: 0 }
 */
export function parseXSDYearMonthDuration(value: string): YearMonthDuration {
  if (!value) {
    throw new Error("parseXSDYearMonthDuration: duration string is empty");
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
      `parseXSDYearMonthDuration: invalid format, must start with 'P': '${value}'`
    );
  }
  str = str.substring(1);

  // Must not contain 'T' (that would be dayTimeDuration)
  if (str.includes("T")) {
    throw new Error(
      `parseXSDYearMonthDuration: invalid format, must not contain time component 'T': '${value}'`
    );
  }

  // Must not contain day/time components (D, H, S as designators)
  if (/[DHS]/.test(str)) {
    throw new Error(
      `parseXSDYearMonthDuration: invalid format, contains day/time components: '${value}'`
    );
  }

  let years = 0;
  let months = 0;
  let remaining = str;

  // Parse years: nY
  const yearMatch = remaining.match(/^(\d+)Y/);
  if (yearMatch) {
    years = parseInt(yearMatch[1], 10);
    remaining = remaining.substring(yearMatch[0].length);
  }

  // Parse months: nM
  const monthMatch = remaining.match(/^(\d+)M$/);
  if (monthMatch) {
    months = parseInt(monthMatch[1], 10);
    remaining = remaining.substring(monthMatch[0].length);
  }

  // If there's remaining content that's not empty, it's invalid
  if (remaining !== "") {
    throw new Error(
      `parseXSDYearMonthDuration: invalid format: '${value}'`
    );
  }

  // Must have at least years or months
  if (years === 0 && months === 0 && str !== "0Y" && str !== "0M" && str !== "0Y0M") {
    // Check if original string was just "P" without any components
    if (str === "") {
      throw new Error(
        `parseXSDYearMonthDuration: invalid format, must have at least one component: '${value}'`
      );
    }
  }

  return { negative, years, months };
}

/**
 * Convert a YearMonthDuration to total months.
 *
 * @param duration - Structured YearMonthDuration object
 * @returns Total months (negative if duration is negative)
 *
 * @example
 * yearMonthDurationToMonths({ negative: false, years: 1, months: 6 })
 * // Returns: 18 (1 year 6 months = 18 months)
 */
export function yearMonthDurationToMonths(duration: YearMonthDuration): number {
  const totalMonths = duration.years * 12 + duration.months;
  return duration.negative ? -totalMonths : totalMonths;
}

/**
 * Convert total months to a YearMonthDuration structure.
 *
 * @param months - Total months (can be negative)
 * @returns Structured YearMonthDuration object (normalized so months < 12)
 *
 * @example
 * monthsToYearMonthDuration(18)
 * // Returns: { negative: false, years: 1, months: 6 }
 *
 * monthsToYearMonthDuration(-6)
 * // Returns: { negative: true, years: 0, months: 6 }
 */
export function monthsToYearMonthDuration(months: number): YearMonthDuration {
  const negative = months < 0;
  const absMonths = Math.abs(months);

  const years = Math.floor(absMonths / 12);
  const remainingMonths = absMonths % 12;

  return { negative, years, months: remainingMonths };
}

/**
 * Format total months as an xsd:yearMonthDuration string.
 *
 * Creates a canonical ISO 8601 duration string from months.
 * The output format follows these rules:
 * - Always starts with 'P' (or '-P' for negative)
 * - Years are included as 'nY' if >= 12 months
 * - Months are included as 'nM' if remainder after years
 * - If input is 0, returns 'P0M'
 *
 * @param months - Duration in months (can be negative)
 * @returns xsd:yearMonthDuration string in canonical format
 *
 * @example
 * // Basic formatting
 * formatYearMonthDuration(18)    // "P1Y6M"
 * formatYearMonthDuration(12)    // "P1Y"
 * formatYearMonthDuration(6)     // "P6M"
 * formatYearMonthDuration(0)     // "P0M"
 * formatYearMonthDuration(-18)   // "-P1Y6M"
 */
export function formatYearMonthDuration(months: number): string {
  const negative = months < 0;
  const absMonths = Math.abs(months);

  const years = Math.floor(absMonths / 12);
  const remainingMonths = absMonths % 12;

  // Build duration string
  let result = negative ? "-P" : "P";

  // Add years if present
  if (years > 0) {
    result += `${years}Y`;
  }

  // Add months if present, or if no years (to avoid just "P")
  if (remainingMonths > 0 || years === 0) {
    result += `${remainingMonths}M`;
  }

  return result;
}

/**
 * Format a YearMonthDuration structure as an xsd:yearMonthDuration string.
 *
 * @param duration - Structured YearMonthDuration object
 * @returns xsd:yearMonthDuration string in canonical format
 *
 * @example
 * formatStructuredYearMonthDuration({ negative: false, years: 1, months: 6 })
 * // Returns: "P1Y6M"
 */
export function formatStructuredYearMonthDuration(duration: YearMonthDuration): string {
  const months = yearMonthDurationToMonths(duration);
  return formatYearMonthDuration(months);
}
