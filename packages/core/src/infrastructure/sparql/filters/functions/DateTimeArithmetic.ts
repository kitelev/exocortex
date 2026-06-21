import { IRI } from "../../../../domain/models/rdf/IRI";
import { Literal } from "../../../../domain/models/rdf/Literal";
import { DateTimeParsing } from "./DateTimeParsing";

/**
 * DateTime and duration arithmetic functions.
 * Implements SPARQL 1.1/1.2 date/time arithmetic operations.
 */
export class DateTimeArithmetic {

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
    const durationStr = DateTimeParsing.formatDayTimeDuration(diffMs);

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

    const durationMs = DateTimeParsing.parseDayTimeDuration(durValue);
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

    const durationMs = DateTimeParsing.parseDayTimeDuration(durValue);
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

    const d = DateTimeParsing.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateAdd: invalid date: '${dateValue}'`);
    }

    const durationMs = DateTimeParsing.parseDayTimeDuration(durValue);
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

    const d = DateTimeParsing.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateSubtract: invalid date: '${dateValue}'`);
    }

    const durationMs = DateTimeParsing.parseDayTimeDuration(durValue);
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

    const months = DateTimeParsing.parseYearMonthDuration(durValue);

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

    const months = DateTimeParsing.parseYearMonthDuration(durValue);

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

    const d = DateTimeParsing.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateAddYearMonth: invalid date: '${dateValue}'`);
    }

    const months = DateTimeParsing.parseYearMonthDuration(durValue);

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

    const d = DateTimeParsing.parseXSDDate(dateValue);
    if (d === null) {
      throw new Error(`dateSubtractYearMonth: invalid date: '${dateValue}'`);
    }

    const months = DateTimeParsing.parseYearMonthDuration(durValue);

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

    const ms1 = DateTimeParsing.parseDayTimeDuration(d1Value);
    const ms2 = DateTimeParsing.parseDayTimeDuration(d2Value);

    const resultStr = DateTimeParsing.formatDayTimeDuration(ms1 + ms2);
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

    const ms1 = DateTimeParsing.parseDayTimeDuration(d1Value);
    const ms2 = DateTimeParsing.parseDayTimeDuration(d2Value);

    const resultStr = DateTimeParsing.formatDayTimeDuration(ms1 - ms2);
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
    const ms = DateTimeParsing.parseDayTimeDuration(durValue);
    const resultStr = DateTimeParsing.formatDayTimeDuration(ms * multiplier);
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
    const ms = DateTimeParsing.parseDayTimeDuration(durValue);
    const resultStr = DateTimeParsing.formatDayTimeDuration(ms / divisor);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#dayTimeDuration"));
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

    const months1 = DateTimeParsing.parseYearMonthDuration(d1Value);
    const months2 = DateTimeParsing.parseYearMonthDuration(d2Value);

    const resultStr = DateTimeParsing.formatYearMonthDuration(months1 + months2);
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

    const months1 = DateTimeParsing.parseYearMonthDuration(d1Value);
    const months2 = DateTimeParsing.parseYearMonthDuration(d2Value);

    const resultStr = DateTimeParsing.formatYearMonthDuration(months1 - months2);
    return new Literal(resultStr, new IRI("http://www.w3.org/2001/XMLSchema#yearMonthDuration"));
  }

  /**
   * Get the total number of days from an xsd:dayTimeDuration (as decimal).
   *
   * @param duration - Duration string or Literal
   * @returns Number of days (can be fractional)
   */
  static durationToDays(duration: string | Literal): number {
    const durValue = duration instanceof Literal ? duration.value : duration;
    const ms = DateTimeParsing.parseDayTimeDuration(durValue);
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
    const ms = DateTimeParsing.parseDayTimeDuration(durValue);
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
    const ms = DateTimeParsing.parseDayTimeDuration(durValue);
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
    const ms = DateTimeParsing.parseDayTimeDuration(durValue);
    return ms / 1000;
  }
}
