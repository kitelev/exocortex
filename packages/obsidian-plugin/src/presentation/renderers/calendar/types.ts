/**
 * Calendar Types
 *
 * Defines the types and interfaces for Calendar visualization components.
 *
 * @module presentation/renderers/calendar
 * @since 1.0.0
 */

import type { LayoutColumn } from "../../../domain/layout";
import type { TableRow } from "../cell-renderers";

/**
 * Calendar view modes
 */
export type CalendarViewMode = "day" | "week" | "month";

/**
 * Calendar event data for calendar visualization
 */
export interface CalendarEvent {
  /** Unique identifier for the event */
  id: string;

  /** Display title for the event */
  title: string;

  /** Path to the asset file */
  path: string;

  /** Event start date/time */
  start: Date;

  /** Event end date/time (optional, for duration-based events) */
  end?: Date;

  /** Whether this is an all-day event */
  allDay?: boolean;

  /** Optional event color */
  color?: string;

  /** Optional event group/category */
  group?: string;

  /** Additional event metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Calendar time slot for grid display
 */
export interface CalendarTimeSlot {
  /** The time for this slot */
  time: Date;

  /** Display label (e.g., "9:00 AM") */
  label: string;

  /** Events that start in this slot */
  events: CalendarEvent[];
}

/**
 * Calendar day data
 */
export interface CalendarDay {
  /** The date for this day */
  date: Date;

  /** Whether this day is today */
  isToday: boolean;

  /** Whether this day is in the current month (for month view) */
  isCurrentMonth: boolean;

  /** Events for this day */
  events: CalendarEvent[];
}

/**
 * Props for CalendarLayoutRenderer
 */
export interface CalendarLayoutRendererProps {
  /**
   * The CalendarLayout definition
   */
  layout: {
    uid: string;
    label: string;
    startProperty: string;
    endProperty?: string;
    view?: CalendarViewMode;
    columns?: LayoutColumn[];
  };

  /**
   * Event data to display
   */
  events: CalendarEvent[];

  /**
   * Handler for event clicks (navigation)
   */
  onEventClick?: (eventId: string, path: string, event: React.MouseEvent) => void;

  /**
   * Handler for event move operations (drag-and-drop reschedule)
   * @param eventId - The event being moved
   * @param startProperty - The property to update for start time
   * @param newStart - The new start date/time
   * @param endProperty - The property to update for end time (optional)
   * @param newEnd - The new end date/time (optional)
   */
  onEventMove?: (
    eventId: string,
    startProperty: string,
    newStart: Date,
    endProperty?: string,
    newEnd?: Date,
  ) => void;

  /**
   * Handler for view change
   */
  onViewChange?: (view: CalendarViewMode) => void;

  /**
   * Handler for date navigation
   */
  onDateChange?: (date: Date) => void;

  /**
   * Layout options
   */
  options?: CalendarLayoutOptions;

  /**
   * Custom CSS class name
   */
  className?: string;
}

/**
 * Options for Calendar layout rendering
 */
export interface CalendarLayoutOptions {
  /** Whether drag-and-drop is enabled for rescheduling */
  draggable?: boolean;

  /** Start hour for day/week view (0-23, default: 0) */
  startHour?: number;

  /** End hour for day/week view (0-23, default: 24) */
  endHour?: number;

  /** Time slot interval in minutes (default: 60) */
  slotInterval?: number;

  /** First day of week (0 = Sunday, 1 = Monday, default: 1) */
  firstDayOfWeek?: number;

  /** Height of the calendar container (default: 600px) */
  height?: string | number;

  /** Event color (CSS color or function) */
  eventColor?: string | ((event: CalendarEvent) => string);

  /** Show current time indicator (default: true) */
  showCurrentTime?: boolean;

  /** Show week numbers in month view (default: false) */
  showWeekNumbers?: boolean;
}

/**
 * Props for CalendarEvent component
 */
export interface CalendarEventProps {
  /** Event data */
  event: CalendarEvent;

  /** Whether event is draggable */
  isDraggable?: boolean;

  /** Whether event is currently being dragged */
  isDragging?: boolean;

  /** Event color */
  color?: string;

  /** Click handler */
  onClick?: (event: React.MouseEvent) => void;

  /** Mouse enter handler */
  onMouseEnter?: (event: React.MouseEvent) => void;

  /** Mouse leave handler */
  onMouseLeave?: (event: React.MouseEvent) => void;

  /** Drag event handlers */
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: (event: React.DragEvent) => void;
}

/**
 * Props for CalendarHeader component
 */
export interface CalendarHeaderProps {
  /** Current view date */
  currentDate: Date;

  /** Current view mode */
  view: CalendarViewMode;

  /** Handler for view change */
  onViewChange?: (view: CalendarViewMode) => void;

  /** Handler for navigating to previous period */
  onPrevious?: () => void;

  /** Handler for navigating to next period */
  onNext?: () => void;

  /** Handler for navigating to today */
  onToday?: () => void;
}

/**
 * Props for CalendarGrid component (day/week view)
 */
export interface CalendarGridProps {
  /** Days to display */
  days: CalendarDay[];

  /** Time slots for the grid */
  timeSlots: CalendarTimeSlot[];

  /** Events to display */
  events: CalendarEvent[];

  /** Options for rendering */
  options?: CalendarLayoutOptions;

  /** Handler for event click */
  onEventClick?: (eventId: string, path: string, event: React.MouseEvent) => void;

  /** Handler for time slot click (for creating new events) */
  onTimeSlotClick?: (date: Date) => void;

  /** Drag event handlers */
  onEventDragStart?: (eventId: string, event: React.DragEvent) => void;
  onEventDragEnd?: (eventId: string, event: React.DragEvent) => void;
  onTimeSlotDrop?: (date: Date, event: React.DragEvent) => void;
}

/**
 * Props for CalendarMonthView component
 */
export interface CalendarMonthViewProps {
  /** Current view date (determines which month to show) */
  currentDate: Date;

  /** Events to display */
  events: CalendarEvent[];

  /** First day of week (0 = Sunday, 1 = Monday) */
  firstDayOfWeek?: number;

  /** Options for rendering */
  options?: CalendarLayoutOptions;

  /** Handler for event click */
  onEventClick?: (eventId: string, path: string, event: React.MouseEvent) => void;

  /** Handler for day click */
  onDayClick?: (date: Date) => void;
}

/**
 * Convert TableRow array to CalendarEvent array.
 *
 * @param rows - The table rows to convert
 * @param startProperty - The column UID for event start time
 * @param endProperty - The column UID for event end time (optional)
 * @param titleColumn - The column UID for event title (optional)
 * @returns Array of CalendarEvent objects
 */
export function rowsToEvents(
  rows: TableRow[],
  startProperty: string,
  endProperty?: string,
  titleColumn?: string,
): CalendarEvent[] {
  return rows
    .filter((row) => {
      const startValue = row.values[startProperty];
      return startValue != null;
    })
    .map((row) => {
      const startValue = row.values[startProperty];
      const endValue = endProperty ? row.values[endProperty] : undefined;

      const start = parseDate(startValue);
      const end = endValue ? parseDate(endValue) : undefined;

      return {
        id: row.id,
        title: titleColumn && row.values[titleColumn]
          ? String(row.values[titleColumn])
          : extractLabelFromPath(row.path),
        path: row.path,
        start,
        end,
        allDay: isAllDay(start, end),
        metadata: row.metadata,
      };
    })
    .filter((event) => !isNaN(event.start.getTime()));
}

/**
 * Parse a date value from various formats.
 *
 * @param value - The value to parse
 * @returns A Date object
 */
export function parseDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    // Try ISO format first
    const isoDate = new Date(value);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // Try parsing as Unix timestamp (number string)
    const timestamp = parseInt(value, 10);
    if (!isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  return new Date(NaN);
}

/**
 * Check if an event spans a full day (or multiple days).
 *
 * @param start - Event start date
 * @param end - Event end date (optional)
 * @returns True if this is an all-day event
 */
export function isAllDay(start: Date, end?: Date): boolean {
  if (!end) {
    return false;
  }

  // Check if times are midnight for both start and end
  const startMidnight =
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    start.getSeconds() === 0;
  const endMidnight =
    end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0;

  return startMidnight && endMidnight;
}

/**
 * Extract label from a file path.
 *
 * @param path - The file path
 * @returns The extracted label (filename without extension)
 */
export function extractLabelFromPath(path: string): string {
  const segments = path.split("/");
  const filename = segments[segments.length - 1];
  return filename.replace(/\.md$/, "");
}

/**
 * Get the start of a day.
 *
 * @param date - The date
 * @returns A new Date at the start of the day
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the end of a day.
 *
 * @param date - The date
 * @returns A new Date at the end of the day
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Get the start of a week.
 *
 * @param date - The date
 * @param firstDayOfWeek - First day of week (0 = Sunday, 1 = Monday)
 * @returns A new Date at the start of the week
 */
export function startOfWeek(date: Date, firstDayOfWeek = 1): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day < firstDayOfWeek ? 7 : 0) + day - firstDayOfWeek;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the end of a week.
 *
 * @param date - The date
 * @param firstDayOfWeek - First day of week (0 = Sunday, 1 = Monday)
 * @returns A new Date at the end of the week
 */
export function endOfWeek(date: Date, firstDayOfWeek = 1): Date {
  const result = startOfWeek(date, firstDayOfWeek);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Get the start of a month.
 *
 * @param date - The date
 * @returns A new Date at the start of the month
 */
export function startOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the end of a month.
 *
 * @param date - The date
 * @returns A new Date at the end of the month
 */
export function endOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1, 0);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Add days to a date.
 *
 * @param date - The date
 * @param days - Number of days to add
 * @returns A new Date with days added
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add months to a date.
 *
 * @param date - The date
 * @param months - Number of months to add
 * @returns A new Date with months added
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Check if two dates are the same day.
 *
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if a date is today.
 *
 * @param date - The date to check
 * @returns True if the date is today
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Format time for display.
 *
 * @param date - The date to format
 * @returns Formatted time string (e.g., "9:00 AM")
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format date for display.
 *
 * @param date - The date to format
 * @returns Formatted date string
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format date range for header display.
 *
 * @param start - Start date
 * @param end - End date
 * @param view - Current view mode
 * @returns Formatted date range string
 */
export function formatDateRange(
  start: Date,
  end: Date,
  view: CalendarViewMode,
): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "long",
    year: "numeric",
  };

  if (view === "day") {
    return start.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  if (view === "week") {
    const startMonth = start.toLocaleDateString(undefined, { month: "short" });
    const endMonth = end.toLocaleDateString(undefined, { month: "short" });
    const startDay = start.getDate();
    const endDay = end.getDate();
    const year = start.getFullYear();

    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} - ${endDay}, ${year}`;
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
  }

  return start.toLocaleDateString(undefined, options);
}

/**
 * Get events that occur on a specific day.
 *
 * @param events - All events
 * @param date - The day to filter by
 * @returns Events that occur on the specified day
 */
export function getEventsForDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  return events.filter((event) => {
    const eventEnd = event.end || event.start;
    return event.start <= dayEnd && eventEnd >= dayStart;
  });
}

/**
 * Generate time slots for day/week view.
 *
 * @param startHour - Start hour (0-23)
 * @param endHour - End hour (0-24)
 * @param interval - Slot interval in minutes
 * @returns Array of time slot labels
 */
export function generateTimeSlots(
  startHour = 0,
  endHour = 24,
  interval = 60,
): string[] {
  const slots: string[] = [];
  const baseDate = new Date(2000, 0, 1, 0, 0, 0);

  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += interval) {
      const slotDate = new Date(baseDate);
      slotDate.setHours(hour, minute);
      slots.push(formatTime(slotDate));
    }
  }

  return slots;
}

/**
 * Calculate event position within a time slot grid.
 *
 * @param event - The event
 * @param startHour - Grid start hour
 * @param slotHeight - Height of each slot in pixels
 * @param interval - Slot interval in minutes
 * @returns CSS positioning values
 */
export function calculateEventPosition(
  event: CalendarEvent,
  startHour: number,
  slotHeight: number,
  interval: number,
): { top: number; height: number } {
  const eventStart = event.start;
  const eventEnd = event.end || new Date(eventStart.getTime() + 60 * 60 * 1000); // Default 1 hour

  const startMinutes = eventStart.getHours() * 60 + eventStart.getMinutes();
  const endMinutes = eventEnd.getHours() * 60 + eventEnd.getMinutes();
  const gridStartMinutes = startHour * 60;

  const top = ((startMinutes - gridStartMinutes) / interval) * slotHeight;
  const height = ((endMinutes - startMinutes) / interval) * slotHeight;

  return { top: Math.max(0, top), height: Math.max(slotHeight / 2, height) };
}
