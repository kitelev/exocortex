/**
 * CalendarLayoutRenderer Unit Tests
 *
 * Tests for the CalendarLayoutRenderer component including:
 * - Basic rendering
 * - View switching (day, week, month)
 * - Navigation (previous, next, today)
 * - Event rendering and positioning
 * - Drag and drop reschedule
 * - Empty state handling
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { CalendarLayoutRenderer } from "@plugin/presentation/renderers/calendar/CalendarLayoutRenderer";
import type {
  CalendarEvent,
  CalendarLayoutRendererProps,
  CalendarViewMode,
} from "@plugin/presentation/renderers/calendar/types";

describe("CalendarLayoutRenderer", () => {
  // Test fixtures - use current date to ensure events appear in current view
  const today = new Date();

  const createEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: "event-1",
    title: "Test Event",
    path: "/assets/event.md",
    start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0),
    end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 0),
    ...overrides,
  });

  const createLayout = (
    overrides: Partial<CalendarLayoutRendererProps["layout"]> = {}
  ) => ({
    uid: "calendar-1",
    label: "Test Calendar",
    startProperty: "[[ems__Effort_startTimestamp]]",
    endProperty: "[[ems__Effort_endTimestamp]]",
    view: "week" as CalendarViewMode,
    ...overrides,
  });

  const createProps = (
    overrides: Partial<CalendarLayoutRendererProps> = {}
  ): CalendarLayoutRendererProps => ({
    layout: createLayout(),
    events: [createEvent()],
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders calendar with header", () => {
      render(<CalendarLayoutRenderer {...createProps()} />);

      expect(screen.getByText("Test Calendar")).toBeInTheDocument();
    });

    it("renders view selector buttons", () => {
      render(<CalendarLayoutRenderer {...createProps()} />);

      expect(screen.getByText("Day")).toBeInTheDocument();
      expect(screen.getByText("Week")).toBeInTheDocument();
      expect(screen.getByText("Month")).toBeInTheDocument();
    });

    it("renders navigation buttons", () => {
      render(<CalendarLayoutRenderer {...createProps()} />);

      expect(screen.getByText("<")).toBeInTheDocument();
      expect(screen.getByText(">")).toBeInTheDocument();
      expect(screen.getByText("Today")).toBeInTheDocument();
    });

    it("renders with custom className", () => {
      const { container } = render(
        <CalendarLayoutRenderer {...createProps({ className: "custom-calendar" })} />
      );

      expect(container.querySelector(".custom-calendar")).toBeInTheDocument();
    });

    it("displays date range in header", () => {
      render(<CalendarLayoutRenderer {...createProps()} />);

      // Should display some date information
      const dateRange = screen.getByText(/\d{4}/);
      expect(dateRange).toBeInTheDocument();
    });
  });

  describe("View Modes", () => {
    it("starts with default view from layout", () => {
      render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "month" }) })}
        />
      );

      const monthButton = screen.getByText("Month");
      expect(monthButton).toHaveClass("exo-calendar-view-btn-active");
    });

    it("switches to day view", () => {
      render(<CalendarLayoutRenderer {...createProps()} />);

      fireEvent.click(screen.getByText("Day"));

      const dayButton = screen.getByText("Day");
      expect(dayButton).toHaveClass("exo-calendar-view-btn-active");
    });

    it("switches to week view", () => {
      render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "day" }) })}
        />
      );

      fireEvent.click(screen.getByText("Week"));

      const weekButton = screen.getByText("Week");
      expect(weekButton).toHaveClass("exo-calendar-view-btn-active");
    });

    it("switches to month view", () => {
      render(<CalendarLayoutRenderer {...createProps()} />);

      fireEvent.click(screen.getByText("Month"));

      const monthButton = screen.getByText("Month");
      expect(monthButton).toHaveClass("exo-calendar-view-btn-active");
    });

    it("calls onViewChange when view changes", () => {
      const onViewChange = jest.fn();
      render(
        <CalendarLayoutRenderer {...createProps({ onViewChange })} />
      );

      fireEvent.click(screen.getByText("Month"));

      expect(onViewChange).toHaveBeenCalledWith("month");
    });
  });

  describe("Navigation", () => {
    it("navigates to previous period", () => {
      const onDateChange = jest.fn();
      render(
        <CalendarLayoutRenderer {...createProps({ onDateChange })} />
      );

      fireEvent.click(screen.getByText("<"));

      expect(onDateChange).toHaveBeenCalled();
    });

    it("navigates to next period", () => {
      const onDateChange = jest.fn();
      render(
        <CalendarLayoutRenderer {...createProps({ onDateChange })} />
      );

      fireEvent.click(screen.getByText(">"));

      expect(onDateChange).toHaveBeenCalled();
    });

    it("navigates to today", () => {
      const onDateChange = jest.fn();
      render(
        <CalendarLayoutRenderer {...createProps({ onDateChange })} />
      );

      fireEvent.click(screen.getByText("Today"));

      expect(onDateChange).toHaveBeenCalled();
      // The date should be today
      const callArg = onDateChange.mock.calls[0][0] as Date;
      const today = new Date();
      expect(callArg.getDate()).toBe(today.getDate());
    });
  });

  describe("Event Rendering", () => {
    it("renders events in current week", () => {
      const events = [
        createEvent({ id: "1", title: "Event 1" }),
        createEvent({
          id: "2",
          title: "Event 2",
          start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0),
          end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 0),
        }),
      ];

      render(<CalendarLayoutRenderer {...createProps({ events })} />);

      expect(screen.getByText("Event 1")).toBeInTheDocument();
      expect(screen.getByText("Event 2")).toBeInTheDocument();
    });

    it("calls onEventClick when event is clicked", () => {
      const onEventClick = jest.fn();
      render(
        <CalendarLayoutRenderer {...createProps({ onEventClick })} />
      );

      fireEvent.click(screen.getByText("Test Event"));

      expect(onEventClick).toHaveBeenCalledWith(
        "event-1",
        "/assets/event.md",
        expect.any(Object)
      );
    });

    it("renders events with custom colors", () => {
      const events = [createEvent({ color: "#ff5500" })];
      const { container } = render(
        <CalendarLayoutRenderer {...createProps({ events })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveStyle({ backgroundColor: "#ff5500" });
    });
  });

  describe("Week View", () => {
    it("renders 7 day columns in week view", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "week" }) })}
        />
      );

      const dayHeaders = container.querySelectorAll(".exo-calendar-day-header");
      expect(dayHeaders).toHaveLength(7);
    });

    it("renders time slots", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "week" }) })}
        />
      );

      const timeSlotLabels = container.querySelectorAll(".exo-calendar-time-slot-label");
      expect(timeSlotLabels.length).toBeGreaterThan(0);
    });

    it("highlights today column", () => {
      // Default createEvent already uses today's date
      const events = [createEvent()];

      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ events, layout: createLayout({ view: "week" }) })}
        />
      );

      // Should have a today column
      const todayColumn = container.querySelector(".exo-calendar-day-column-today");
      expect(todayColumn).toBeInTheDocument();
    });
  });

  describe("Day View", () => {
    it("renders single day column in day view", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "day" }) })}
        />
      );

      const dayColumns = container.querySelectorAll(".exo-calendar-day-column");
      expect(dayColumns).toHaveLength(1);
    });

    it("renders time column", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "day" }) })}
        />
      );

      const timeColumn = container.querySelector(".exo-calendar-time-column");
      expect(timeColumn).toBeInTheDocument();
    });
  });

  describe("Month View", () => {
    it("renders month grid in month view", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "month" }) })}
        />
      );

      const monthBody = container.querySelector(".exo-calendar-month-body");
      expect(monthBody).toBeInTheDocument();
    });

    it("renders day of week headers", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "month" }) })}
        />
      );

      const dayHeaders = container.querySelectorAll(".exo-calendar-month-day-header");
      expect(dayHeaders).toHaveLength(7);
    });

    it("renders weeks", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "month" }) })}
        />
      );

      const weeks = container.querySelectorAll(".exo-calendar-month-week");
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(6);
    });

    it("shows more indicator for days with many events", () => {
      // Create 5 events for the same day (today is already defined at test suite level)
      const events = Array.from({ length: 5 }, (_, i) =>
        createEvent({
          id: `event-${i}`,
          title: `Event ${i}`,
          start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10 + i, 0),
          end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11 + i, 0),
        })
      );

      render(
        <CalendarLayoutRenderer
          {...createProps({
            events,
            layout: createLayout({ view: "month" }),
          })}
        />
      );

      // Should show "+2 more" indicator
      expect(screen.getByText(/\+\d+ more/)).toBeInTheDocument();
    });

    it("dims days from other months", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ layout: createLayout({ view: "month" }) })}
        />
      );

      const otherMonthDays = container.querySelectorAll(".exo-calendar-month-day-other");
      // There should be some days from previous/next month
      expect(otherMonthDays.length).toBeGreaterThan(0);
    });
  });

  describe("Empty State", () => {
    it("renders empty message when no events", () => {
      render(
        <CalendarLayoutRenderer {...createProps({ events: [] })} />
      );

      expect(screen.getByText(/no events to display/i)).toBeInTheDocument();
    });

    it("shows start property in empty message", () => {
      render(
        <CalendarLayoutRenderer
          {...createProps({
            events: [],
            layout: createLayout({ startProperty: "[[customStartProp]]" }),
          })}
        />
      );

      expect(screen.getByText(/\[\[customStartProp\]\]/)).toBeInTheDocument();
    });
  });

  describe("Drag and Drop", () => {
    it("allows dragging events when draggable option is true", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ options: { draggable: true } })}
        />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveClass("exo-calendar-event-draggable");
    });

    it("does not allow dragging when draggable option is false", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ options: { draggable: false } })}
        />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).not.toHaveClass("exo-calendar-event-draggable");
    });

    it("calls onEventMove when event is dropped", () => {
      const onEventMove = jest.fn();
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({
            onEventMove,
            options: { draggable: true },
          })}
        />
      );

      // Start drag on event
      const eventElement = container.querySelector(".exo-calendar-event")!;
      const dataTransfer = {
        setData: jest.fn(),
        effectAllowed: "",
      };
      fireEvent.dragStart(eventElement, { dataTransfer });

      // Drop on a day column
      const dayColumn = container.querySelector(".exo-calendar-day-column")!;
      fireEvent.dragOver(dayColumn);
      fireEvent.drop(dayColumn, {
        clientY: 100,
        currentTarget: {
          getBoundingClientRect: () => ({ top: 0 }),
        },
      });

      // onEventMove should be called
      expect(onEventMove).toHaveBeenCalled();
    });
  });

  describe("Options", () => {
    it("applies custom height", () => {
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ options: { height: 800 } })}
        />
      );

      const calendar = container.querySelector(".exo-calendar-container");
      expect(calendar).toHaveStyle({ height: "800px" });
    });

    it("applies custom event color function", () => {
      const events = [
        createEvent({ group: "work" }),
      ];
      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({
            events,
            options: {
              eventColor: (event) => event.group === "work" ? "#0066ff" : "#ff6600",
            },
          })}
        />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveStyle({ backgroundColor: "#0066ff" });
    });
  });

  describe("Current Time Indicator", () => {
    it("shows current time indicator in day/week view by default", () => {
      // Default createEvent uses today's date
      const events = [createEvent()];

      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({ events, layout: createLayout({ view: "week" }) })}
        />
      );

      const timeIndicator = container.querySelector(".exo-calendar-current-time");
      expect(timeIndicator).toBeInTheDocument();
    });

    it("hides current time indicator when showCurrentTime is false", () => {
      // Default createEvent uses today's date
      const events = [createEvent()];

      const { container } = render(
        <CalendarLayoutRenderer
          {...createProps({
            events,
            layout: createLayout({ view: "week" }),
            options: { showCurrentTime: false },
          })}
        />
      );

      const timeIndicator = container.querySelector(".exo-calendar-current-time");
      expect(timeIndicator).not.toBeInTheDocument();
    });
  });
});
