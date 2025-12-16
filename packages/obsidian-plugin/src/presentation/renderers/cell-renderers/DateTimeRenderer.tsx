/**
 * DateTimeRenderer - Renders datetime cell values with formatting
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Format options for datetime display
 */
export interface DateTimeFormatOptions {
  /** Whether to show the date part */
  showDate?: boolean;
  /** Whether to show the time part */
  showTime?: boolean;
  /** Date format style */
  dateStyle?: "short" | "medium" | "long";
  /** Time format style */
  timeStyle?: "short" | "medium";
}

const defaultOptions: DateTimeFormatOptions = {
  showDate: true,
  showTime: true,
  dateStyle: "short",
  timeStyle: "short",
};

/**
 * Parse a value into a Date object.
 */
function parseDate(value: unknown): Date | null {
  if (value == null) return null;

  // Already a Date
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // Number (timestamp)
  if (typeof value === "number") {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  // String (ISO format or other parseable format)
  if (typeof value === "string") {
    // Try ISO format first
    let date = new Date(value);
    if (!isNaN(date.getTime())) return date;

    // Try timestamp string
    const timestamp = parseInt(value, 10);
    if (!isNaN(timestamp)) {
      date = new Date(timestamp);
      if (!isNaN(date.getTime())) return date;
    }

    return null;
  }

  return null;
}

/**
 * Format a date according to the options.
 */
function formatDateTime(date: Date, options: DateTimeFormatOptions): string {
  const parts: string[] = [];

  if (options.showDate) {
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: options.dateStyle,
    });
    parts.push(dateFormatter.format(date));
  }

  if (options.showTime) {
    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      timeStyle: options.timeStyle,
    });
    parts.push(timeFormatter.format(date));
  }

  return parts.join(" ");
}

/**
 * Renders a cell value as a formatted datetime.
 * Supports Date objects, timestamps, and ISO date strings.
 */
export const DateTimeRenderer: React.FC<CellRendererProps> = ({
  value,
}) => {
  const date = parseDate(value);

  if (!date) {
    return <span className="exo-cell-datetime exo-cell-datetime-empty">-</span>;
  }

  const formatted = formatDateTime(date, defaultOptions);

  return (
    <span className="exo-cell-datetime" title={date.toISOString()}>
      {formatted}
    </span>
  );
};

/**
 * DateRenderer - Renders date only (no time)
 */
export const DateRenderer: React.FC<CellRendererProps> = ({
  value,
}) => {
  const date = parseDate(value);

  if (!date) {
    return <span className="exo-cell-date exo-cell-date-empty">-</span>;
  }

  const formatted = formatDateTime(date, {
    showDate: true,
    showTime: false,
    dateStyle: "medium",
  });

  return (
    <span className="exo-cell-date" title={date.toISOString()}>
      {formatted}
    </span>
  );
};

/**
 * TimeRenderer - Renders time only (no date)
 */
export const TimeRenderer: React.FC<CellRendererProps> = ({
  value,
}) => {
  const date = parseDate(value);

  if (!date) {
    return <span className="exo-cell-time exo-cell-time-empty">-</span>;
  }

  const formatted = formatDateTime(date, {
    showDate: false,
    showTime: true,
    timeStyle: "short",
  });

  return (
    <span className="exo-cell-time" title={date.toISOString()}>
      {formatted}
    </span>
  );
};
