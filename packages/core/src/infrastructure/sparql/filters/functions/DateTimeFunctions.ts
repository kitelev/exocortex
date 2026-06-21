import { Literal } from "../../../../domain/models/rdf/Literal";
import { DateTimeParsing } from "./DateTimeParsing";
import { DateTimeArithmetic } from "./DateTimeArithmetic";
import { DateTimeAccessors } from "./DateTimeAccessors";

/**
 * DateTimeFunctions - Barrel class that delegates to sub-modules.
 *
 * This class maintains the original public API for backwards compatibility.
 * Implementation is split across:
 * - DateTimeParsing: Parse/validate datetime & duration strings, formatting
 * - DateTimeArithmetic: DateTime/duration arithmetic operations
 * - DateTimeAccessors: Component extraction, comparison, type checking, timezone
 */
export class DateTimeFunctions {

  // =========================================================================
  // Parsing & Formatting (delegated to DateTimeParsing)
  // =========================================================================

  static parseDate(dateStr: string): number {
    return DateTimeParsing.parseDate(dateStr);
  }

  static parseDayTimeDuration(durationStr: string): number {
    return DateTimeParsing.parseDayTimeDuration(durationStr);
  }

  static formatDayTimeDuration(ms: number): string {
    return DateTimeParsing.formatDayTimeDuration(ms);
  }

  static xsdDayTimeDuration(value: string): Literal {
    return DateTimeParsing.xsdDayTimeDuration(value);
  }

  static parseYearMonthDuration(durationStr: string): number {
    return DateTimeParsing.parseYearMonthDuration(durationStr);
  }

  static formatYearMonthDuration(totalMonths: number): string {
    return DateTimeParsing.formatYearMonthDuration(totalMonths);
  }

  // =========================================================================
  // Accessors (delegated to DateTimeAccessors)
  // =========================================================================

  static year(dateStr: string): number {
    return DateTimeAccessors.year(dateStr);
  }

  static month(dateStr: string): number {
    return DateTimeAccessors.month(dateStr);
  }

  static day(dateStr: string): number {
    return DateTimeAccessors.day(dateStr);
  }

  static hours(dateStr: string): number {
    return DateTimeAccessors.hours(dateStr);
  }

  static minutes(dateStr: string): number {
    return DateTimeAccessors.minutes(dateStr);
  }

  static seconds(dateStr: string): number {
    return DateTimeAccessors.seconds(dateStr);
  }

  static durationDays(duration: string | Literal): number {
    return DateTimeAccessors.durationDays(duration);
  }

  static durationHours(duration: string | Literal): number {
    return DateTimeAccessors.durationHours(duration);
  }

  static durationMinutes(duration: string | Literal): number {
    return DateTimeAccessors.durationMinutes(duration);
  }

  static durationSeconds(duration: string | Literal): number {
    return DateTimeAccessors.durationSeconds(duration);
  }

  static durationYears(duration: string | Literal): number {
    return DateTimeAccessors.durationYears(duration);
  }

  static durationMonths(duration: string | Literal): number {
    return DateTimeAccessors.durationMonths(duration);
  }

  // =========================================================================
  // Timezone (delegated to DateTimeAccessors)
  // =========================================================================

  static timezone(dateStr: string): Literal {
    return DateTimeAccessors.timezone(dateStr);
  }

  static tz(dateStr: string): string {
    return DateTimeAccessors.tz(dateStr);
  }

  static adjust(dateTime: string | Literal, timezone?: string | Literal): Literal {
    return DateTimeAccessors.adjust(dateTime, timezone);
  }

  static now(): string {
    return DateTimeAccessors.now();
  }

  // =========================================================================
  // Comparison (delegated to DateTimeAccessors)
  // =========================================================================

  static dateBefore(date1: string, date2: string): boolean {
    return DateTimeAccessors.dateBefore(date1, date2);
  }

  static dateAfter(date1: string, date2: string): boolean {
    return DateTimeAccessors.dateAfter(date1, date2);
  }

  static dateInRange(date: string, start: string, end: string): boolean {
    return DateTimeAccessors.dateInRange(date, start, end);
  }

  static compareDurations(
    duration1: string | Literal,
    duration2: string | Literal,
    operator: string
  ): boolean {
    return DateTimeAccessors.compareDurations(duration1, duration2, operator);
  }

  static dateDiffMinutes(date1: string, date2: string): number {
    return DateTimeAccessors.dateDiffMinutes(date1, date2);
  }

  static dateDiffHours(date1: string, date2: string): number {
    return DateTimeAccessors.dateDiffHours(date1, date2);
  }

  static timeDiff(time1: string | Literal, time2: string | Literal): Literal {
    return DateTimeAccessors.timeDiff(time1, time2);
  }

  static dateDiff(date1: string | Literal, date2: string | Literal): Literal {
    return DateTimeAccessors.dateDiff(date1, date2);
  }

  // =========================================================================
  // Type Checking (delegated to DateTimeAccessors)
  // =========================================================================

  static isDayTimeDuration(value: unknown): boolean {
    return DateTimeAccessors.isDayTimeDuration(value);
  }

  static isDate(value: unknown): boolean {
    return DateTimeAccessors.isDate(value);
  }

  static isYearMonthDuration(value: string | Literal): boolean {
    return DateTimeAccessors.isYearMonthDuration(value);
  }

  static isTime(value: unknown): boolean {
    return DateTimeAccessors.isTime(value);
  }

  // =========================================================================
  // Arithmetic (delegated to DateTimeArithmetic)
  // =========================================================================

  static dateTimeDiff(dateTime1: string | Literal, dateTime2: string | Literal): Literal {
    return DateTimeArithmetic.dateTimeDiff(dateTime1, dateTime2);
  }

  static dateTimeAdd(dateTime: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateTimeAdd(dateTime, duration);
  }

  static dateTimeSubtract(dateTime: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateTimeSubtract(dateTime, duration);
  }

  static dateAdd(date: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateAdd(date, duration);
  }

  static dateSubtract(date: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateSubtract(date, duration);
  }

  static dateTimeAddYearMonth(dateTime: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateTimeAddYearMonth(dateTime, duration);
  }

  static dateTimeSubtractYearMonth(dateTime: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateTimeSubtractYearMonth(dateTime, duration);
  }

  static dateAddYearMonth(date: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateAddYearMonth(date, duration);
  }

  static dateSubtractYearMonth(date: string | Literal, duration: string | Literal): Literal {
    return DateTimeArithmetic.dateSubtractYearMonth(date, duration);
  }

  static durationAdd(duration1: string | Literal, duration2: string | Literal): Literal {
    return DateTimeArithmetic.durationAdd(duration1, duration2);
  }

  static durationSubtract(duration1: string | Literal, duration2: string | Literal): Literal {
    return DateTimeArithmetic.durationSubtract(duration1, duration2);
  }

  static durationMultiply(duration: string | Literal, multiplier: number): Literal {
    return DateTimeArithmetic.durationMultiply(duration, multiplier);
  }

  static durationDivide(duration: string | Literal, divisor: number): Literal {
    return DateTimeArithmetic.durationDivide(duration, divisor);
  }

  static yearMonthDurationAdd(duration1: string | Literal, duration2: string | Literal): Literal {
    return DateTimeArithmetic.yearMonthDurationAdd(duration1, duration2);
  }

  static yearMonthDurationSubtract(duration1: string | Literal, duration2: string | Literal): Literal {
    return DateTimeArithmetic.yearMonthDurationSubtract(duration1, duration2);
  }

  static durationToDays(duration: string | Literal): number {
    return DateTimeArithmetic.durationToDays(duration);
  }

  static durationToHours(duration: string | Literal): number {
    return DateTimeArithmetic.durationToHours(duration);
  }

  static durationToMinutes(duration: string | Literal): number {
    return DateTimeArithmetic.durationToMinutes(duration);
  }

  static durationToSeconds(duration: string | Literal): number {
    return DateTimeArithmetic.durationToSeconds(duration);
  }
}
