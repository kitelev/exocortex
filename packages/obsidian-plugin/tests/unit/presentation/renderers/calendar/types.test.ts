/**
 * Calendar Types Unit Tests
 *
 * Tests for the calendar utility functions including:
 * - Date parsing and formatting
 * - Date range calculations
 * - Event data conversion
 * - Time slot generation
 */

import {
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
  rowsToEvents,
} from "@plugin/presentation/renderers/calendar/types";
import type { CalendarEvent } from "@plugin/presentation/renderers/calendar/types";
import type { TableRow } from "@plugin/presentation/renderers/cell-renderers";

describe("Calendar Types", () => {
  describe("parseDate", () => {
    it("parses Date objects correctly", () => {
      const date = new Date(2025, 5, 15, 10, 30);
      const result = parseDate(date);
      expect(result.getTime()).toBe(date.getTime());
    });

    it("parses ISO date strings", () => {
      const result = parseDate("2025-06-15T10:30:00.000Z");
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(5); // June (0-indexed)
      expect(result.getDate()).toBe(15);
    });

    it("parses numeric timestamps", () => {
      const timestamp = Date.now();
      const result = parseDate(timestamp);
      expect(result.getTime()).toBe(timestamp);
    });

    it("parses string timestamps", () => {
      const timestamp = "1718448600000";
      const result = parseDate(timestamp);
      expect(result.getTime()).toBe(1718448600000);
    });

    it("returns invalid date for unparseable values", () => {
      const result = parseDate("not a date");
      expect(isNaN(result.getTime())).toBe(true);
    });
  });

  describe("isAllDay", () => {
    it("returns false when no end date", () => {
      const start = new Date(2025, 5, 15, 10, 30);
      expect(isAllDay(start)).toBe(false);
    });

    it("returns true for midnight-to-midnight events", () => {
      const start = new Date(2025, 5, 15, 0, 0, 0);
      const end = new Date(2025, 5, 16, 0, 0, 0);
      expect(isAllDay(start, end)).toBe(true);
    });

    it("returns false for non-midnight events", () => {
      const start = new Date(2025, 5, 15, 10, 0);
      const end = new Date(2025, 5, 15, 14, 0);
      expect(isAllDay(start, end)).toBe(false);
    });
  });

  describe("extractLabelFromPath", () => {
    it("extracts filename from path", () => {
      expect(extractLabelFromPath("/path/to/MyFile.md")).toBe("MyFile");
    });

    it("removes .md extension", () => {
      expect(extractLabelFromPath("simple-file.md")).toBe("simple-file");
    });

    it("handles files without extension", () => {
      expect(extractLabelFromPath("/path/to/file")).toBe("file");
    });
  });

  describe("Date Range Functions", () => {
    const testDate = new Date(2025, 5, 15, 10, 30, 45); // June 15, 2025 10:30:45

    describe("startOfDay", () => {
      it("returns start of day", () => {
        const result = startOfDay(testDate);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
        expect(result.getSeconds()).toBe(0);
        expect(result.getMilliseconds()).toBe(0);
      });

      it("preserves the date", () => {
        const result = startOfDay(testDate);
        expect(result.getFullYear()).toBe(2025);
        expect(result.getMonth()).toBe(5);
        expect(result.getDate()).toBe(15);
      });
    });

    describe("endOfDay", () => {
      it("returns end of day", () => {
        const result = endOfDay(testDate);
        expect(result.getHours()).toBe(23);
        expect(result.getMinutes()).toBe(59);
        expect(result.getSeconds()).toBe(59);
        expect(result.getMilliseconds()).toBe(999);
      });
    });

    describe("startOfWeek", () => {
      it("returns Monday by default (firstDayOfWeek=1)", () => {
        const result = startOfWeek(testDate, 1);
        expect(result.getDay()).toBe(1); // Monday
        expect(result.getDate()).toBeLessThanOrEqual(testDate.getDate());
      });

      it("returns Sunday when firstDayOfWeek=0", () => {
        const result = startOfWeek(testDate, 0);
        expect(result.getDay()).toBe(0); // Sunday
      });

      it("sets time to midnight", () => {
        const result = startOfWeek(testDate);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
      });
    });

    describe("endOfWeek", () => {
      it("returns end of week", () => {
        const result = endOfWeek(testDate, 1);
        // End of week should be 6 days after start of week
        const start = startOfWeek(testDate, 1);
        const expectedEnd = new Date(start);
        expectedEnd.setDate(expectedEnd.getDate() + 6);
        expect(result.getDate()).toBe(expectedEnd.getDate());
      });

      it("sets time to end of day", () => {
        const result = endOfWeek(testDate);
        expect(result.getHours()).toBe(23);
        expect(result.getMinutes()).toBe(59);
      });
    });

    describe("startOfMonth", () => {
      it("returns first day of month", () => {
        const result = startOfMonth(testDate);
        expect(result.getDate()).toBe(1);
        expect(result.getMonth()).toBe(5); // June
      });
    });

    describe("endOfMonth", () => {
      it("returns last day of month", () => {
        const result = endOfMonth(testDate);
        expect(result.getDate()).toBe(30); // June has 30 days
        expect(result.getMonth()).toBe(5);
      });
    });
  });

  describe("Date Manipulation Functions", () => {
    describe("addDays", () => {
      it("adds positive days", () => {
        const date = new Date(2025, 5, 15);
        const result = addDays(date, 5);
        expect(result.getDate()).toBe(20);
      });

      it("subtracts with negative days", () => {
        const date = new Date(2025, 5, 15);
        const result = addDays(date, -5);
        expect(result.getDate()).toBe(10);
      });

      it("handles month boundaries", () => {
        const date = new Date(2025, 5, 28); // June 28
        const result = addDays(date, 5);
        expect(result.getMonth()).toBe(6); // July
        expect(result.getDate()).toBe(3);
      });
    });

    describe("addMonths", () => {
      it("adds positive months", () => {
        const date = new Date(2025, 5, 15);
        const result = addMonths(date, 2);
        expect(result.getMonth()).toBe(7); // August
      });

      it("subtracts with negative months", () => {
        const date = new Date(2025, 5, 15);
        const result = addMonths(date, -2);
        expect(result.getMonth()).toBe(3); // April
      });

      it("handles year boundaries", () => {
        const date = new Date(2025, 11, 15); // December
        const result = addMonths(date, 2);
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(1); // February
      });
    });
  });

  describe("Date Comparison Functions", () => {
    describe("isSameDay", () => {
      it("returns true for same day different times", () => {
        const date1 = new Date(2025, 5, 15, 10, 0);
        const date2 = new Date(2025, 5, 15, 18, 30);
        expect(isSameDay(date1, date2)).toBe(true);
      });

      it("returns false for different days", () => {
        const date1 = new Date(2025, 5, 15);
        const date2 = new Date(2025, 5, 16);
        expect(isSameDay(date1, date2)).toBe(false);
      });

      it("returns false for different months", () => {
        const date1 = new Date(2025, 5, 15);
        const date2 = new Date(2025, 6, 15);
        expect(isSameDay(date1, date2)).toBe(false);
      });
    });

    describe("isToday", () => {
      it("returns true for today", () => {
        const today = new Date();
        expect(isToday(today)).toBe(true);
      });

      it("returns false for yesterday", () => {
        const yesterday = addDays(new Date(), -1);
        expect(isToday(yesterday)).toBe(false);
      });

      it("returns false for tomorrow", () => {
        const tomorrow = addDays(new Date(), 1);
        expect(isToday(tomorrow)).toBe(false);
      });
    });
  });

  describe("Formatting Functions", () => {
    describe("formatTime", () => {
      it("formats time correctly", () => {
        const date = new Date(2025, 5, 15, 14, 30);
        const result = formatTime(date);
        // Result format depends on locale, but should contain time
        expect(result).toMatch(/\d{1,2}:\d{2}/);
      });
    });

    describe("formatDate", () => {
      it("formats date correctly", () => {
        const date = new Date(2025, 5, 15);
        const result = formatDate(date);
        // Result should contain day number
        expect(result).toMatch(/15/);
      });
    });

    describe("formatDateRange", () => {
      it("formats day view", () => {
        const start = new Date(2025, 5, 15);
        const result = formatDateRange(start, start, "day");
        expect(result).toMatch(/June/i);
        expect(result).toMatch(/15/);
      });

      it("formats week view within same month", () => {
        const start = new Date(2025, 5, 15);
        const end = new Date(2025, 5, 21);
        const result = formatDateRange(start, end, "week");
        expect(result).toMatch(/15/);
        expect(result).toMatch(/21/);
      });

      it("formats month view", () => {
        const start = new Date(2025, 5, 1);
        const end = new Date(2025, 5, 30);
        const result = formatDateRange(start, end, "month");
        expect(result).toMatch(/June/i);
        expect(result).toMatch(/2025/);
      });
    });
  });

  describe("Event Functions", () => {
    describe("getEventsForDay", () => {
      const events: CalendarEvent[] = [
        {
          id: "1",
          title: "Event 1",
          path: "/event1.md",
          start: new Date(2025, 5, 15, 10, 0),
          end: new Date(2025, 5, 15, 11, 0),
        },
        {
          id: "2",
          title: "Event 2",
          path: "/event2.md",
          start: new Date(2025, 5, 15, 14, 0),
          end: new Date(2025, 5, 15, 15, 0),
        },
        {
          id: "3",
          title: "Event 3",
          path: "/event3.md",
          start: new Date(2025, 5, 16, 10, 0),
        },
      ];

      it("returns events for specified day", () => {
        const date = new Date(2025, 5, 15);
        const result = getEventsForDay(events, date);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("1");
        expect(result[1].id).toBe("2");
      });

      it("returns empty array for day with no events", () => {
        const date = new Date(2025, 5, 20);
        const result = getEventsForDay(events, date);
        expect(result).toHaveLength(0);
      });

      it("includes multi-day events", () => {
        const multiDayEvents: CalendarEvent[] = [
          {
            id: "1",
            title: "Multi-day",
            path: "/multi.md",
            start: new Date(2025, 5, 14, 0, 0),
            end: new Date(2025, 5, 17, 0, 0),
          },
        ];
        const date = new Date(2025, 5, 15);
        const result = getEventsForDay(multiDayEvents, date);
        expect(result).toHaveLength(1);
      });
    });

    describe("generateTimeSlots", () => {
      it("generates hourly slots by default", () => {
        const slots = generateTimeSlots(0, 24, 60);
        expect(slots).toHaveLength(24);
      });

      it("generates half-hourly slots", () => {
        const slots = generateTimeSlots(8, 18, 30);
        // 10 hours * 2 slots per hour = 20 slots
        expect(slots).toHaveLength(20);
      });

      it("respects start and end hour", () => {
        const slots = generateTimeSlots(9, 17, 60);
        expect(slots).toHaveLength(8);
      });
    });

    describe("calculateEventPosition", () => {
      it("calculates position for event at slot boundary", () => {
        const event: CalendarEvent = {
          id: "1",
          title: "Test",
          path: "/test.md",
          start: new Date(2025, 5, 15, 10, 0),
          end: new Date(2025, 5, 15, 11, 0),
        };
        const position = calculateEventPosition(event, 0, 48, 60);
        expect(position.top).toBe(10 * 48); // 10 hours * 48px
        expect(position.height).toBe(48); // 1 hour = 48px
      });

      it("calculates position for event mid-slot", () => {
        const event: CalendarEvent = {
          id: "1",
          title: "Test",
          path: "/test.md",
          start: new Date(2025, 5, 15, 10, 30),
          end: new Date(2025, 5, 15, 11, 30),
        };
        const position = calculateEventPosition(event, 0, 48, 60);
        // 10.5 hours * 48px / 1 hour = 504px
        expect(position.top).toBe(504);
      });

      it("handles events with no end time", () => {
        const event: CalendarEvent = {
          id: "1",
          title: "Test",
          path: "/test.md",
          start: new Date(2025, 5, 15, 10, 0),
        };
        const position = calculateEventPosition(event, 0, 48, 60);
        // Default 1 hour duration
        expect(position.height).toBe(48);
      });

      it("ensures minimum height", () => {
        const event: CalendarEvent = {
          id: "1",
          title: "Test",
          path: "/test.md",
          start: new Date(2025, 5, 15, 10, 0),
          end: new Date(2025, 5, 15, 10, 5), // 5 minutes
        };
        const position = calculateEventPosition(event, 0, 48, 60);
        // Should be at least half slot height
        expect(position.height).toBeGreaterThanOrEqual(24);
      });
    });
  });

  describe("rowsToEvents", () => {
    const createRow = (overrides: Partial<TableRow> = {}): TableRow => ({
      id: "row-1",
      path: "/assets/task.md",
      metadata: {},
      values: {
        start: "2025-06-15T10:00:00.000Z",
        end: "2025-06-15T11:00:00.000Z",
        title: "Test Task",
      },
      ...overrides,
    });

    it("converts rows to events", () => {
      const rows = [createRow()];
      const events = rowsToEvents(rows, "start", "end", "title");

      expect(events).toHaveLength(1);
      expect(events[0].title).toBe("Test Task");
      expect(events[0].path).toBe("/assets/task.md");
    });

    it("filters out rows without start date", () => {
      const rows = [
        createRow({ values: { start: null, title: "No Start" } }),
        createRow({ id: "row-2", values: { start: "2025-06-15T10:00:00.000Z", title: "Has Start" } }),
      ];
      const events = rowsToEvents(rows, "start", undefined, "title");

      expect(events).toHaveLength(1);
      expect(events[0].title).toBe("Has Start");
    });

    it("uses path for title when no title column specified", () => {
      const rows = [createRow()];
      const events = rowsToEvents(rows, "start");

      expect(events[0].title).toBe("task");
    });

    it("filters out events with invalid dates", () => {
      const rows = [
        createRow({ values: { start: "invalid date", title: "Bad Date" } }),
      ];
      const events = rowsToEvents(rows, "start");

      expect(events).toHaveLength(0);
    });
  });
});
