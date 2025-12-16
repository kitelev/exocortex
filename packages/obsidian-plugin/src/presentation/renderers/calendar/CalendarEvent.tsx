/**
 * CalendarEvent Component
 *
 * Renders a single event in the calendar view.
 * Supports click, hover, and drag interactions.
 *
 * @module presentation/renderers/calendar
 * @since 1.0.0
 */
import React, { useCallback } from "react";

import type { CalendarEventProps } from "./types";
import { formatTime } from "./types";

/**
 * Default event color
 */
const DEFAULT_EVENT_COLOR = "var(--interactive-accent)";

/**
 * CalendarEvent - Renders a single calendar event
 *
 * @example
 * ```tsx
 * <CalendarEvent
 *   event={event}
 *   isDraggable={true}
 *   onClick={(e) => handleEventClick(event.id, event.path, e)}
 * />
 * ```
 */
export const CalendarEvent: React.FC<CalendarEventProps> = ({
  event,
  isDraggable = false,
  isDragging = false,
  color,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onDragStart,
  onDragEnd,
}) => {
  const eventColor = color || event.color || DEFAULT_EVENT_COLOR;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick?.(e);
    },
    [onClick],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!isDraggable) {
        e.preventDefault();
        return;
      }

      // Set drag data (with null check for test environments)
      if (e.dataTransfer) {
        e.dataTransfer.setData("text/plain", event.id);
        e.dataTransfer.effectAllowed = "move";
      }

      onDragStart?.(e);
    },
    [isDraggable, event.id, onDragStart],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      onDragEnd?.(e);
    },
    [onDragEnd],
  );

  // Format time range for display
  const timeDisplay = event.allDay
    ? "All day"
    : event.end
      ? `${formatTime(event.start)} - ${formatTime(event.end)}`
      : formatTime(event.start);

  return (
    <div
      className={`exo-calendar-event ${isDraggable ? "exo-calendar-event-draggable" : ""} ${isDragging ? "exo-calendar-event-dragging" : ""}`}
      style={{
        backgroundColor: eventColor,
        borderLeftColor: eventColor,
      }}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      data-event-id={event.id}
      data-event-path={event.path}
      title={`${event.title}\n${timeDisplay}`}
    >
      <div className="exo-calendar-event-content">
        <span className="exo-calendar-event-title">{event.title}</span>
        {!event.allDay && (
          <span className="exo-calendar-event-time">{timeDisplay}</span>
        )}
      </div>
    </div>
  );
};

export default CalendarEvent;
