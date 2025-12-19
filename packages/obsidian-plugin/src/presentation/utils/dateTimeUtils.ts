/**
 * Utility functions for date/time parsing and formatting in property editors.
 *
 * Key design principle: All user input is interpreted as LOCAL time.
 * - Input: User enters "2025-12-02 13:03" meaning 1:03 PM in their timezone
 * - Storage: Stored as local timestamp string (e.g., "2025-12-02T13:03:00") WITHOUT timezone suffix
 * - Display: Local timestamp string displayed directly (no conversion needed)
 *
 * IMPORTANT: This is consistent with how timestamps are stored elsewhere in the codebase
 * (TaskStatusService, StatusTimestampService) using DateFormatter.toLocalTimestamp().
 * Storing without Z suffix avoids timezone conversion issues when parsing.
 */

/**
 * Parses a user input string into a Date object.
 * Interprets the input as LOCAL time, not UTC.
 *
 * Supports:
 * - ISO-like formats: "2025-12-02", "2025-12-02 13:03", "2025-12-02T13:03:22"
 * - Natural language: "today", "tomorrow", "yesterday", "next week"
 * - Relative dates: "in 3 days", "in 2 weeks"
 *
 * @param input - The user's date input string
 * @returns A Date object in local time, or null if parsing fails
 */
export function parseLocalDate(input: string): Date | null {
  if (!input.trim()) return null;

  const lowerInput = input.toLowerCase().trim();

  // Natural language shortcuts
  if (lowerInput === "today") {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  if (lowerInput === "tomorrow") {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  if (lowerInput === "yesterday") {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  if (lowerInput === "next week") {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  // Relative days: "in X days"
  const inDaysMatch = lowerInput.match(/^in (\d+) days?$/i);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  // Relative weeks: "in X weeks"
  const inWeeksMatch = lowerInput.match(/^in (\d+) weeks?$/i);
  if (inWeeksMatch) {
    const weeks = parseInt(inWeeksMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() + weeks * 7);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  try {
    // Normalize input: replace space with 'T' to ensure consistent local time parsing
    // "2025-12-02 13:03" → "2025-12-02T13:03" (parsed as local time)
    // This avoids browser inconsistencies where "YYYY-MM-DD HH:MM" may be parsed as UTC
    const normalizedInput = input.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    const date = new Date(normalizedInput);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch {
    // Fall through
  }

  return null;
}

/**
 * Formats an ISO date string for display in a date input field.
 * Converts UTC time to local time for editing.
 *
 * @param isoString - An ISO 8601 date string (typically from storage)
 * @returns A formatted string like "2025-12-02 13:03" in local time
 */
export function formatForInput(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    // Only include time if it's not midnight
    if (date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0) {
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } else {
      return `${year}-${month}-${day}`;
    }
  } catch {
    return isoString;
  }
}

/**
 * Formats a Date object as a local timestamp string for storage.
 * Format: YYYY-MM-DDTHH:mm:ss (no timezone suffix)
 *
 * This format is consistent with DateFormatter.toLocalTimestamp() in @exocortex/core.
 *
 * @param date - The Date object to format
 * @returns A local timestamp string like "2025-12-02T13:03:00"
 */
export function formatToLocalTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Formats an ISO date string for display to the user.
 * Converts UTC time to local time using locale-aware formatting.
 *
 * @param isoString - An ISO 8601 date string (typically from storage), or null
 * @returns A localized date string like "Dec 2, 2025, 13:03" or "Empty" if null
 */
export function formatDisplayValue(isoString: string | null): string {
  if (!isoString) return "Empty";

  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    // Check if the original string includes time information
    const hasTime =
      isoString.includes("T") ||
      date.getHours() !== 0 ||
      date.getMinutes() !== 0;

    if (hasTime) {
      return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } else {
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  } catch {
    return isoString;
  }
}
