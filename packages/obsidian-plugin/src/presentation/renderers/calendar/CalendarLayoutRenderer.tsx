/**
 * CalendarLayoutRenderer Component
 *
 * Renders a CalendarLayout definition as an interactive calendar with:
 * - Day, Week, and Month views
 * - Events from startProperty/endProperty
 * - Click on event opens asset
 * - Drag for reschedule (update timestamps)
 * - CSS styles following Obsidian theme
 *
 * @module presentation/renderers/calendar
 * @since 1.0.0
 */
import React, { useState, useMemo, useCallback } from "react";

import type {
  CalendarLayoutRendererProps,
  CalendarLayoutOptions,
  CalendarEvent as CalendarEventType,
  CalendarViewMode,
  CalendarDay,
} from "./types";
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfWeek,
  endOfMonth,
  addDays,
  addMonths,
  isToday,
  formatDateRange,
  getEventsForDay,
  generateTimeSlots,
  calculateEventPosition,
} from "./types";
import { CalendarEvent } from "./CalendarEvent";

/**
 * Default calendar layout options
 */
const defaultOptions: CalendarLayoutOptions = {
  draggable: true,
  startHour: 0,
  endHour: 24,
  slotInterval: 60,
  firstDayOfWeek: 1,
  height: 600,
  showCurrentTime: true,
  showWeekNumbers: false,
};

/**
 * Height of each time slot in pixels
 */
const SLOT_HEIGHT = 48;

/**
 * CalendarLayoutRenderer - Renders a CalendarLayout as an interactive calendar
 *
 * @example
 * ```tsx
 * <CalendarLayoutRenderer
 *   layout={calendarLayout}
 *   events={events}
 *   onEventClick={(eventId, path, event) => {
 *     // Navigate to asset
 *   }}
 *   onEventMove={(eventId, startProp, newStart, endProp, newEnd) => {
 *     // Update timestamps
 *   }}
 * />
 * ```
 */
export const CalendarLayoutRenderer: React.FC<CalendarLayoutRendererProps> = ({
  layout,
  events,
  onEventClick,
  onEventMove,
  onViewChange,
  onDateChange,
  options: propOptions,
  className,
}) => {
  const options = { ...defaultOptions, ...propOptions };

  // Current view state
  const [view, setView] = useState<CalendarViewMode>(layout.view || "week");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // Drag state
  const [dragState, setDragState] = useState<{
    eventId: string | null;
    originalStart: Date | null;
  }>({ eventId: null, originalStart: null });

  // Hover state - value stored for future feature expansion (tooltips, highlighting)
  const [, setHoveredEventId] = useState<string | null>(null);

  /**
   * Get date range for current view
   */
  const dateRange = useMemo(() => {
    const firstDay = options.firstDayOfWeek ?? 1;

    switch (view) {
      case "day":
        return {
          start: startOfDay(currentDate),
          end: startOfDay(currentDate),
        };
      case "week":
        return {
          start: startOfWeek(currentDate, firstDay),
          end: endOfWeek(currentDate, firstDay),
        };
      case "month": {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(currentDate);
        return {
          start: startOfWeek(monthStart, firstDay),
          end: endOfWeek(monthEnd, firstDay),
        };
      }
      default:
        return {
          start: startOfWeek(currentDate, firstDay),
          end: endOfWeek(currentDate, firstDay),
        };
    }
  }, [view, currentDate, options.firstDayOfWeek]);

  /**
   * Generate days for the current view
   */
  const days = useMemo((): CalendarDay[] => {
    const result: CalendarDay[] = [];
    let current = dateRange.start;

    while (current <= dateRange.end) {
      result.push({
        date: new Date(current),
        isToday: isToday(current),
        isCurrentMonth: current.getMonth() === currentDate.getMonth(),
        events: getEventsForDay(events, current),
      });
      current = addDays(current, 1);
    }

    return result;
  }, [dateRange, events, currentDate]);

  /**
   * Generate time slots for day/week view
   */
  const timeSlots = useMemo(() => {
    return generateTimeSlots(
      options.startHour,
      options.endHour,
      options.slotInterval,
    );
  }, [options.startHour, options.endHour, options.slotInterval]);

  /**
   * Handle view change
   */
  const handleViewChange = useCallback(
    (newView: CalendarViewMode) => {
      setView(newView);
      onViewChange?.(newView);
    },
    [onViewChange],
  );

  /**
   * Navigate to previous period
   */
  const handlePrevious = useCallback(() => {
    const newDate =
      view === "day"
        ? addDays(currentDate, -1)
        : view === "week"
          ? addDays(currentDate, -7)
          : addMonths(currentDate, -1);
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  }, [view, currentDate, onDateChange]);

  /**
   * Navigate to next period
   */
  const handleNext = useCallback(() => {
    const newDate =
      view === "day"
        ? addDays(currentDate, 1)
        : view === "week"
          ? addDays(currentDate, 7)
          : addMonths(currentDate, 1);
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  }, [view, currentDate, onDateChange]);

  /**
   * Navigate to today
   */
  const handleToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
    onDateChange?.(today);
  }, [onDateChange]);

  /**
   * Handle event click
   */
  const handleEventClick = useCallback(
    (event: CalendarEventType, e: React.MouseEvent) => {
      onEventClick?.(event.id, event.path, e);
    },
    [onEventClick],
  );

  /**
   * Handle event drag start
   */
  const handleEventDragStart = useCallback(
    (event: CalendarEventType, _e: React.DragEvent) => {
      setDragState({
        eventId: event.id,
        originalStart: event.start,
      });
    },
    [],
  );

  /**
   * Handle event drag end
   */
  const handleEventDragEnd = useCallback(() => {
    setDragState({ eventId: null, originalStart: null });
  }, []);

  /**
   * Handle drop on time slot
   */
  const handleTimeSlotDrop = useCallback(
    (targetDate: Date, e: React.DragEvent) => {
      e.preventDefault();

      const { eventId, originalStart } = dragState;
      if (!eventId || !originalStart || !onEventMove) {
        return;
      }

      const event = events.find((ev) => ev.id === eventId);
      if (!event) return;

      // Calculate duration if end time exists
      const duration = event.end
        ? event.end.getTime() - event.start.getTime()
        : 0;

      // Calculate new end time
      const newEnd = duration > 0 ? new Date(targetDate.getTime() + duration) : undefined;

      onEventMove(
        eventId,
        layout.startProperty,
        targetDate,
        layout.endProperty,
        newEnd,
      );

      setDragState({ eventId: null, originalStart: null });
    },
    [dragState, events, layout.startProperty, layout.endProperty, onEventMove],
  );

  /**
   * Get event color
   */
  const getEventColor = useCallback(
    (event: CalendarEventType): string => {
      if (typeof options.eventColor === "function") {
        return options.eventColor(event);
      }
      return event.color || options.eventColor || "var(--interactive-accent)";
    },
    [options.eventColor],
  );

  /**
   * Render calendar header
   */
  const renderHeader = () => (
    <div className="exo-calendar-header">
      <div className="exo-calendar-header-left">
        <h3 className="exo-calendar-title">{layout.label}</h3>
        <span className="exo-calendar-date-range">
          {formatDateRange(dateRange.start, dateRange.end, view)}
        </span>
      </div>

      <div className="exo-calendar-header-center">
        <button
          className="exo-calendar-nav-btn"
          onClick={handlePrevious}
          title="Previous"
        >
          &lt;
        </button>
        <button
          className="exo-calendar-nav-btn exo-calendar-today-btn"
          onClick={handleToday}
        >
          Today
        </button>
        <button
          className="exo-calendar-nav-btn"
          onClick={handleNext}
          title="Next"
        >
          &gt;
        </button>
      </div>

      <div className="exo-calendar-header-right">
        <div className="exo-calendar-view-selector">
          {(["day", "week", "month"] as CalendarViewMode[]).map((v) => (
            <button
              key={v}
              className={`exo-calendar-view-btn ${view === v ? "exo-calendar-view-btn-active" : ""}`}
              onClick={() => handleViewChange(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  /**
   * Render day/week view
   */
  const renderDayWeekView = () => {
    const visibleDays = view === "day" ? days.slice(0, 1) : days.slice(0, 7);

    return (
      <div className="exo-calendar-grid">
        {/* Time column */}
        <div className="exo-calendar-time-column">
          <div className="exo-calendar-time-header"></div>
          {timeSlots.map((slot, index) => (
            <div
              key={index}
              className="exo-calendar-time-slot-label"
              style={{ height: SLOT_HEIGHT }}
            >
              {slot}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="exo-calendar-days-container">
          {/* Day headers */}
          <div className="exo-calendar-day-headers">
            {visibleDays.map((day) => (
              <div
                key={day.date.toISOString()}
                className={`exo-calendar-day-header ${day.isToday ? "exo-calendar-day-header-today" : ""}`}
              >
                <span className="exo-calendar-day-name">
                  {day.date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="exo-calendar-day-number">
                  {day.date.getDate()}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns with events */}
          <div className="exo-calendar-day-columns">
            {visibleDays.map((day) => (
              <div
                key={day.date.toISOString()}
                className={`exo-calendar-day-column ${day.isToday ? "exo-calendar-day-column-today" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  // Calculate drop time based on position
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const slotIndex = Math.floor(y / SLOT_HEIGHT);
                  const hour = (options.startHour ?? 0) + Math.floor((slotIndex * (options.slotInterval ?? 60)) / 60);
                  const minutes = (slotIndex * (options.slotInterval ?? 60)) % 60;

                  const dropDate = new Date(day.date);
                  dropDate.setHours(hour, minutes, 0, 0);

                  handleTimeSlotDrop(dropDate, e);
                }}
              >
                {/* Time slot grid */}
                {timeSlots.map((_, slotIndex) => (
                  <div
                    key={slotIndex}
                    className="exo-calendar-time-slot"
                    style={{ height: SLOT_HEIGHT }}
                  />
                ))}

                {/* Events */}
                <div className="exo-calendar-events-container">
                  {day.events.map((event) => {
                    const position = calculateEventPosition(
                      event,
                      options.startHour ?? 0,
                      SLOT_HEIGHT,
                      options.slotInterval ?? 60,
                    );

                    return (
                      <div
                        key={event.id}
                        className="exo-calendar-event-wrapper"
                        style={{
                          position: "absolute",
                          top: position.top,
                          height: position.height,
                          left: 2,
                          right: 2,
                        }}
                      >
                        <CalendarEvent
                          event={event}
                          isDraggable={options.draggable}
                          isDragging={dragState.eventId === event.id}
                          color={getEventColor(event)}
                          onClick={(e) => handleEventClick(event, e)}
                          onMouseEnter={() => setHoveredEventId(event.id)}
                          onMouseLeave={() => setHoveredEventId(null)}
                          onDragStart={(e) => handleEventDragStart(event, e)}
                          onDragEnd={handleEventDragEnd}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Current time indicator */}
                {day.isToday && options.showCurrentTime && (
                  <CurrentTimeIndicator
                    startHour={options.startHour ?? 0}
                    slotHeight={SLOT_HEIGHT}
                    slotInterval={options.slotInterval ?? 60}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  /**
   * Render month view
   */
  const renderMonthView = () => {
    // Group days into weeks
    const weeks: CalendarDay[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    return (
      <div className="exo-calendar-month">
        {/* Day of week headers */}
        <div className="exo-calendar-month-header">
          {weeks[0]?.map((day) => (
            <div key={day.date.toISOString()} className="exo-calendar-month-day-header">
              {day.date.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="exo-calendar-month-body">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="exo-calendar-month-week">
              {week.map((day) => (
                <div
                  key={day.date.toISOString()}
                  className={`exo-calendar-month-day ${day.isToday ? "exo-calendar-month-day-today" : ""} ${!day.isCurrentMonth ? "exo-calendar-month-day-other" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleTimeSlotDrop(startOfDay(day.date), e)}
                >
                  <span className="exo-calendar-month-day-number">
                    {day.date.getDate()}
                  </span>
                  <div className="exo-calendar-month-events">
                    {day.events.slice(0, 3).map((event) => (
                      <CalendarEvent
                        key={event.id}
                        event={event}
                        isDraggable={options.draggable}
                        isDragging={dragState.eventId === event.id}
                        color={getEventColor(event)}
                        onClick={(e) => handleEventClick(event, e)}
                        onMouseEnter={() => setHoveredEventId(event.id)}
                        onMouseLeave={() => setHoveredEventId(null)}
                        onDragStart={(e) => handleEventDragStart(event, e)}
                        onDragEnd={handleEventDragEnd}
                      />
                    ))}
                    {day.events.length > 3 && (
                      <span className="exo-calendar-month-more">
                        +{day.events.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Empty state
  if (events.length === 0) {
    return (
      <div className={`exo-calendar-container exo-calendar-empty ${className || ""}`}>
        {renderHeader()}
        <div className="exo-calendar-empty-message">
          No events to display. Add items with {layout.startProperty} property.
        </div>
      </div>
    );
  }

  return (
    <div
      className={`exo-calendar-container ${className || ""}`}
      style={{
        height:
          typeof options.height === "number"
            ? `${options.height}px`
            : options.height,
      }}
    >
      {renderHeader()}
      <div className="exo-calendar-body">
        {view === "month" ? renderMonthView() : renderDayWeekView()}
      </div>
    </div>
  );
};

/**
 * CurrentTimeIndicator - Shows current time line in day/week view
 */
const CurrentTimeIndicator: React.FC<{
  startHour: number;
  slotHeight: number;
  slotInterval: number;
}> = ({ startHour, slotHeight, slotInterval }) => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const gridStartMinutes = startHour * 60;
  const top = ((currentMinutes - gridStartMinutes) / slotInterval) * slotHeight;

  return (
    <div
      className="exo-calendar-current-time"
      style={{ top }}
    >
      <div className="exo-calendar-current-time-dot" />
      <div className="exo-calendar-current-time-line" />
    </div>
  );
};

export default CalendarLayoutRenderer;
