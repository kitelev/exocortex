/**
 * Calendar Layout Renderer Module
 *
 * Exports components for rendering calendar views of time-based data.
 *
 * @module presentation/renderers/calendar
 * @since 1.0.0
 */

export { CalendarLayoutRenderer } from "./CalendarLayoutRenderer";
export { CalendarEvent } from "./CalendarEvent";
export type {
  CalendarEvent as CalendarEventData,
  CalendarViewMode,
  CalendarLayoutRendererProps,
  CalendarLayoutOptions,
  CalendarEventProps,
  CalendarDay,
  CalendarTimeSlot,
  CalendarHeaderProps,
  CalendarGridProps,
  CalendarMonthViewProps,
} from "./types";
export {
  rowsToEvents,
  parseDate,
  isAllDay,
  extractLabelFromPath,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  isSameDay,
  isToday,
  formatTime,
  formatDate,
  formatDateRange,
  getEventsForDay,
  generateTimeSlots,
  calculateEventPosition,
} from "./types";
