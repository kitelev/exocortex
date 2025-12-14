/**
 * DateFormatter Utility
 *
 * Centralized date formatting utilities to eliminate code duplication.
 * Follows DRY principle by providing reusable date formatting functions.
 *
 * @module infrastructure/utilities
 * @since 1.0.0
 */

/**
 * Utility class for consistent date formatting across the application.
 *
 * Provides standardized formats for:
 * - ISO 8601 local timestamps (for frontmatter metadata)
 * - Obsidian wikilink date format (for date references)
 *
 * @example
 * ```typescript
 * const now = new Date();
 *
 * // For timestamp metadata
 * const timestamp = DateFormatter.toLocalTimestamp(now);
 * // "2025-10-24T14:30:45"
 *
 * // For date wikilinks
 * const wikilink = DateFormatter.toDateWikilink(now);
 * // "[[2025-10-24]]"
 *
 * // Get current date as wikilink
 * const today = DateFormatter.getTodayWikilink();
 * // "[[2025-10-24]]"
 * ```
 */
export class DateFormatter {
  /**
   * Format date to ISO 8601 timestamp string with UTC timezone (Z suffix).
   *
   * Format: `YYYY-MM-DDTHH:MM:SSZ`
   *
   * This is the **preferred format** for timestamp properties as it:
   * - Enables proper SPARQL date range filtering
   * - Follows ISO 8601 standard with explicit UTC timezone
   * - Allows lexicographic string comparison for date ordering
   *
   * Used for effort timestamp properties like:
   * - `ems__Effort_startTimestamp`
   * - `ems__Effort_endTimestamp`
   * - `ems__Effort_resolutionTimestamp`
   * - `ems__Effort_plannedStartTimestamp`
   * - `ems__Effort_plannedEndTimestamp`
   *
   * @param date - Date object to format
   * @returns ISO 8601 UTC timestamp string with Z suffix
   *
   * @example
   * ```typescript
   * const date = new Date('2025-10-24T14:30:45Z');
   * const timestamp = DateFormatter.toISOTimestamp(date);
   * // "2025-10-24T14:30:45Z"
   * ```
   */
  static toISOTimestamp(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  /**
   * Format date to local timestamp string in ISO 8601 format (without timezone).
   *
   * Format: `YYYY-MM-DDTHH:MM:SS`
   *
   * @deprecated Use `toISOTimestamp()` for effort timestamps to enable SPARQL filtering.
   * This method is kept for backward compatibility with display-only timestamps.
   *
   * Used for frontmatter properties like:
   * - `ems__Effort_created`
   * - `ems__Effort_modified`
   * - `ems__Effort_archived`
   *
   * @param date - Date object to format
   * @returns ISO 8601 local timestamp string
   *
   * @example
   * ```typescript
   * const date = new Date('2025-10-24T14:30:45Z');
   * const timestamp = DateFormatter.toLocalTimestamp(date);
   * // "2025-10-24T14:30:45"
   * ```
   */
  static toLocalTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  /**
   * Format date to Obsidian wikilink format (quoted).
   *
   * Format: `"[[YYYY-MM-DD]]"`
   *
   * Used for frontmatter properties like:
   * - `ems__Effort_day` (daily note reference)
   * - `pn__DailyNote_day` (daily note date)
   *
   * Note: Returns quoted string ready for YAML frontmatter.
   *
   * @param date - Date object to format
   * @returns Quoted wikilink string
   *
   * @example
   * ```typescript
   * const date = new Date('2025-10-24T14:30:45Z');
   * const wikilink = DateFormatter.toDateWikilink(date);
   * // "[[2025-10-24]]"
   * ```
   */
  static toDateWikilink(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `"[[${year}-${month}-${day}]]"`;
  }

  /**
   * Get current date as wikilink format.
   *
   * Convenience method equivalent to `toDateWikilink(new Date())`.
   *
   * @returns Today's date as quoted wikilink
   *
   * @example
   * ```typescript
   * const today = DateFormatter.getTodayWikilink();
   * // "[[2025-10-24]]"
   * ```
   */
  static getTodayWikilink(): string {
    return DateFormatter.toDateWikilink(new Date());
  }

  /**
   * Format date to simple date string (no brackets, no quotes).
   *
   * Format: `YYYY-MM-DD`
   *
   * Used for generating default labels or simple date formatting.
   *
   * @param date - Date object to format
   * @returns Simple date string
   *
   * @example
   * ```typescript
   * const date = new Date('2025-10-24T14:30:45Z');
   * const dateStr = DateFormatter.toDateString(date);
   * // "2025-10-24"
   * ```
   */
  static toDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  /**
   * Parse wikilink format back to date string (without quotes).
   *
   * Extracts date from `"[[YYYY-MM-DD]]"` or `[[YYYY-MM-DD]]` format.
   *
   * @param wikilink - Wikilink string (with or without quotes)
   * @returns Date string in YYYY-MM-DD format, or null if invalid
   *
   * @example
   * ```typescript
   * const date1 = DateFormatter.parseWikilink('"[[2025-10-24]]"');
   * // "2025-10-24"
   *
   * const date2 = DateFormatter.parseWikilink('[[2025-10-24]]');
   * // "2025-10-24"
   *
   * const invalid = DateFormatter.parseWikilink('invalid');
   * // null
   * ```
   */
  static parseWikilink(wikilink: string): string | null {
    // Remove quotes if present
    const cleaned = wikilink.replace(/^["']|["']$/g, "");

    // Extract date from [[YYYY-MM-DD]]
    const match = cleaned.match(/\[\[(\d{4}-\d{2}-\d{2})\]\]/);
    return match ? match[1] : null;
  }

  /**
   * Add days to a date and return new date.
   *
   * @param date - Starting date
   * @param days - Number of days to add (negative for subtraction)
   * @returns New date object with days added
   *
   * @example
   * ```typescript
   * const today = new Date('2025-10-24');
   * const tomorrow = DateFormatter.addDays(today, 1);
   * const yesterday = DateFormatter.addDays(today, -1);
   * ```
   */
  static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Check if two dates are on the same day (ignoring time).
   *
   * @param date1 - First date
   * @param date2 - Second date
   * @returns True if dates are on same day
   *
   * @example
   * ```typescript
   * const morning = new Date('2025-10-24T08:00:00');
   * const evening = new Date('2025-10-24T20:00:00');
   * const isSameDay = DateFormatter.isSameDay(morning, evening);
   * // true
   * ```
   */
  static isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  /**
   * Get start of day timestamp for today (00:00:00) in local time ISO 8601 format.
   *
   * Format: `YYYY-MM-DDT00:00:00`
   *
   * Used for setting planned start timestamp to beginning of current day.
   *
   * @returns Today's date at midnight local time as ISO timestamp string (without Z suffix)
   *
   * @example
   * ```typescript
   * const startOfToday = DateFormatter.getTodayStartTimestamp();
   * // "2025-11-03T00:00:00"
   * ```
   */
  static getTodayStartTimestamp(): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return DateFormatter.toLocalTimestamp(today);
  }

  /**
   * Convert date string (YYYY-MM-DD) to timestamp at start of day (00:00:00) in local time.
   *
   * Format: `YYYY-MM-DDT00:00:00`
   *
   * Used for creating tasks from DailyNote with planned start at beginning of day.
   *
   * @param dateStr - Date string in format "YYYY-MM-DD" (e.g., "2025-11-11")
   * @returns Date at midnight local time as ISO timestamp string (without Z suffix)
   *
   * @example
   * ```typescript
   * const timestamp = DateFormatter.toTimestampAtStartOfDay("2025-11-11");
   * // "2025-11-11T00:00:00"
   * ```
   */
  static toTimestampAtStartOfDay(dateStr: string): string {
    const parts = dateStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
    }

    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day, 0, 0, 0, 0);

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date values: ${dateStr}`);
    }

    return DateFormatter.toLocalTimestamp(date);
  }

  /**
   * Normalize any timestamp format to ISO 8601 UTC format.
   *
   * Handles:
   * - JavaScript Date.toString() format: "Mon Nov 04 2025 10:00:00 GMT+1000"
   * - ISO 8601 local format: "2025-11-04T10:00:00"
   * - ISO 8601 UTC format: "2025-11-04T10:00:00Z" (returns as-is)
   *
   * @param timestamp - Any valid date/timestamp string
   * @returns ISO 8601 UTC timestamp string with Z suffix
   * @throws Error if timestamp cannot be parsed
   *
   * @example
   * ```typescript
   * // JavaScript Date string
   * DateFormatter.normalizeTimestamp("Mon Nov 04 2025 10:00:00 GMT+1000");
   * // "2025-11-04T00:00:00Z"
   *
   * // ISO local
   * DateFormatter.normalizeTimestamp("2025-11-04T10:00:00");
   * // "2025-11-04T10:00:00Z"
   *
   * // Already ISO UTC (pass-through)
   * DateFormatter.normalizeTimestamp("2025-11-04T10:00:00Z");
   * // "2025-11-04T10:00:00Z"
   * ```
   */
  static normalizeTimestamp(timestamp: string): string {
    // Already in ISO UTC format
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)) {
      return timestamp;
    }

    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }

    return DateFormatter.toISOTimestamp(date);
  }

  /**
   * Check if a timestamp string is in ISO 8601 UTC format.
   *
   * @param timestamp - Timestamp string to check
   * @returns True if timestamp is in ISO 8601 UTC format (YYYY-MM-DDTHH:MM:SSZ)
   *
   * @example
   * ```typescript
   * DateFormatter.isISOTimestamp("2025-11-04T10:00:00Z");  // true
   * DateFormatter.isISOTimestamp("2025-11-04T10:00:00");   // false (no Z)
   * DateFormatter.isISOTimestamp("Mon Nov 04 2025 10:00:00 GMT+1000");  // false
   * ```
   */
  static isISOTimestamp(timestamp: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp);
  }
}
