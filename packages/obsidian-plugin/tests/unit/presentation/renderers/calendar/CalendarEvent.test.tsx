/**
 * CalendarEvent Unit Tests
 *
 * Tests for the CalendarEvent component including:
 * - Basic rendering
 * - Event display (title, time)
 * - Click interactions
 * - Drag and drop behavior
 * - Hover states
 */

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

import { CalendarEvent } from "@plugin/presentation/renderers/calendar/CalendarEvent";
import type {
  CalendarEvent as CalendarEventData,
  CalendarEventProps,
} from "@plugin/presentation/renderers/calendar/types";

describe("CalendarEvent", () => {
  // Test fixtures
  const createEvent = (overrides: Partial<CalendarEventData> = {}): CalendarEventData => ({
    id: "event-1",
    title: "Test Event",
    path: "/assets/event.md",
    start: new Date(2025, 5, 15, 10, 0),
    end: new Date(2025, 5, 15, 11, 0),
    ...overrides,
  });

  const createProps = (overrides: Partial<CalendarEventProps> = {}): CalendarEventProps => ({
    event: createEvent(),
    ...overrides,
  });

  describe("Basic Rendering", () => {
    it("renders event title", () => {
      render(<CalendarEvent {...createProps()} />);

      expect(screen.getByText("Test Event")).toBeInTheDocument();
    });

    it("renders event time", () => {
      render(<CalendarEvent {...createProps()} />);

      // Time format depends on locale, but should be present
      const element = screen.getByText(/\d{1,2}:\d{2}/);
      expect(element).toBeInTheDocument();
    });

    it("renders with correct data attributes", () => {
      const { container } = render(<CalendarEvent {...createProps()} />);

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveAttribute("data-event-id", "event-1");
      expect(eventElement).toHaveAttribute("data-event-path", "/assets/event.md");
    });

    it("applies custom color", () => {
      const { container } = render(
        <CalendarEvent {...createProps({ color: "#ff5500" })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveStyle({ backgroundColor: "#ff5500" });
    });
  });

  describe("All-Day Events", () => {
    it("shows 'All day' for all-day events", () => {
      const event = createEvent({
        allDay: true,
      });

      render(<CalendarEvent {...createProps({ event })} />);

      // All-day events don't show time range
      expect(screen.queryByText(/\d{1,2}:\d{2} - \d{1,2}:\d{2}/)).not.toBeInTheDocument();
    });

    it("shows time for non-all-day events", () => {
      const event = createEvent({
        allDay: false,
        start: new Date(2025, 5, 15, 10, 0),
        end: new Date(2025, 5, 15, 14, 30),
      });

      render(<CalendarEvent {...createProps({ event })} />);

      // Should show time range
      const timeElement = screen.getByText(/\d{1,2}:\d{2}/);
      expect(timeElement).toBeInTheDocument();
    });
  });

  describe("Click Interactions", () => {
    it("calls onClick when event is clicked", () => {
      const onClick = jest.fn();
      render(<CalendarEvent {...createProps({ onClick })} />);

      fireEvent.click(screen.getByText("Test Event"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("stops event propagation on click", () => {
      const onClick = jest.fn((e: React.MouseEvent) => {
        // Event should be stopped
      });
      const parentClick = jest.fn();

      render(
        <div onClick={parentClick}>
          <CalendarEvent {...createProps({ onClick })} />
        </div>
      );

      fireEvent.click(screen.getByText("Test Event"));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(parentClick).not.toHaveBeenCalled();
    });
  });

  describe("Hover Interactions", () => {
    it("calls onMouseEnter on hover", () => {
      const onMouseEnter = jest.fn();
      const { container } = render(
        <CalendarEvent {...createProps({ onMouseEnter })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event")!;
      fireEvent.mouseEnter(eventElement);

      expect(onMouseEnter).toHaveBeenCalledTimes(1);
    });

    it("calls onMouseLeave when mouse leaves", () => {
      const onMouseLeave = jest.fn();
      const { container } = render(
        <CalendarEvent {...createProps({ onMouseLeave })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event")!;
      fireEvent.mouseLeave(eventElement);

      expect(onMouseLeave).toHaveBeenCalledTimes(1);
    });
  });

  describe("Drag and Drop", () => {
    it("is not draggable by default", () => {
      const { container } = render(<CalendarEvent {...createProps()} />);

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).not.toHaveAttribute("draggable", "true");
    });

    it("is draggable when isDraggable is true", () => {
      const { container } = render(
        <CalendarEvent {...createProps({ isDraggable: true })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveAttribute("draggable", "true");
    });

    it("has draggable class when isDraggable is true", () => {
      const { container } = render(
        <CalendarEvent {...createProps({ isDraggable: true })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveClass("exo-calendar-event-draggable");
    });

    it("has dragging class when isDragging is true", () => {
      const { container } = render(
        <CalendarEvent {...createProps({ isDragging: true })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveClass("exo-calendar-event-dragging");
    });

    it("calls onDragStart when drag starts", () => {
      const onDragStart = jest.fn();
      const { container } = render(
        <CalendarEvent {...createProps({ isDraggable: true, onDragStart })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event")!;
      // Must provide dataTransfer object for jsdom
      fireEvent.dragStart(eventElement, {
        dataTransfer: {
          setData: jest.fn(),
          effectAllowed: "move",
        },
      });

      expect(onDragStart).toHaveBeenCalledTimes(1);
    });

    it("sets drag data when drag starts", () => {
      const { container } = render(
        <CalendarEvent {...createProps({ isDraggable: true })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event")!;
      const dataTransfer = {
        setData: jest.fn(),
        effectAllowed: "",
      };

      fireEvent.dragStart(eventElement, { dataTransfer });

      expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "event-1");
      expect(dataTransfer.effectAllowed).toBe("move");
    });

    it("does not call onDragStart when not draggable", () => {
      const onDragStart = jest.fn();
      const { container } = render(
        <CalendarEvent {...createProps({ isDraggable: false, onDragStart })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event")!;

      // When not draggable, onDragStart callback should not be called
      fireEvent.dragStart(eventElement, {
        dataTransfer: {
          setData: jest.fn(),
          effectAllowed: "move",
        },
      });

      expect(onDragStart).not.toHaveBeenCalled();
    });

    it("calls onDragEnd when drag ends", () => {
      const onDragEnd = jest.fn();
      const { container } = render(
        <CalendarEvent {...createProps({ isDraggable: true, onDragEnd })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event")!;
      fireEvent.dragEnd(eventElement);

      expect(onDragEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("Event Display", () => {
    it("shows title in tooltip", () => {
      const { container } = render(<CalendarEvent {...createProps()} />);

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveAttribute("title");
      expect(eventElement?.getAttribute("title")).toContain("Test Event");
    });

    it("shows time in tooltip", () => {
      const { container } = render(<CalendarEvent {...createProps()} />);

      const eventElement = container.querySelector(".exo-calendar-event");
      const title = eventElement?.getAttribute("title") || "";
      // Should contain some time indication
      expect(title).toMatch(/\d{1,2}:\d{2}/);
    });

    it("truncates long titles with ellipsis", () => {
      const event = createEvent({
        title: "This is a very long event title that should be truncated with ellipsis",
      });

      const { container } = render(<CalendarEvent {...createProps({ event })} />);

      const titleElement = container.querySelector(".exo-calendar-event-title");
      expect(titleElement).toHaveClass("exo-calendar-event-title");
      // CSS handles truncation, we just verify the class exists
    });
  });

  describe("Event with Color", () => {
    it("uses event color when provided", () => {
      const event = createEvent({ color: "#00ff00" });
      const { container } = render(<CalendarEvent {...createProps({ event })} />);

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveStyle({ backgroundColor: "#00ff00" });
    });

    it("prioritizes prop color over event color", () => {
      const event = createEvent({ color: "#00ff00" });
      const { container } = render(
        <CalendarEvent {...createProps({ event, color: "#ff0000" })} />
      );

      const eventElement = container.querySelector(".exo-calendar-event");
      expect(eventElement).toHaveStyle({ backgroundColor: "#ff0000" });
    });
  });
});
