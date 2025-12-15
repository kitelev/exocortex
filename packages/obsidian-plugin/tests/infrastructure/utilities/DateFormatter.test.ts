/**
 * DateFormatter Test Suite
 *
 * Tests for centralized date formatting utility.
 * Validates DRY principle adherence and consistent formatting.
 *
 * @module tests/infrastructure/utilities
 */

import { DateFormatter } from "../../../src/infrastructure/utilities/DateFormatter";

describe("DateFormatter", () => {
  describe("toLocalTimestamp", () => {
    it("should format date to ISO 8601 local timestamp", () => {
      // Arrange - Use local date (not UTC) to avoid timezone issues
      const date = new Date(2025, 9, 24, 14, 30, 45); // Oct 24, 2025, 14:30:45 local

      // Act
      const result = DateFormatter.toLocalTimestamp(date);

      // Assert
      expect(result).toBe("2025-10-24T14:30:45");
    });

    it("should pad single-digit months with zero", () => {
      // Arrange
      const date = new Date(2025, 0, 5, 14, 30, 45); // Jan 5, 2025

      // Act
      const result = DateFormatter.toLocalTimestamp(date);

      // Assert
      expect(result).toBe("2025-01-05T14:30:45");
    });

    it("should pad single-digit hours, minutes, seconds", () => {
      // Arrange
      const date = new Date(2025, 9, 24, 8, 5, 3); // Oct 24, 2025, 08:05:03

      // Act
      const result = DateFormatter.toLocalTimestamp(date);

      // Assert
      expect(result).toBe("2025-10-24T08:05:03");
    });

    it("should handle midnight correctly", () => {
      // Arrange
      const date = new Date(2025, 9, 24, 0, 0, 0); // Oct 24, 2025, 00:00:00

      // Act
      const result = DateFormatter.toLocalTimestamp(date);

      // Assert
      expect(result).toBe("2025-10-24T00:00:00");
    });

    it("should handle end of day correctly", () => {
      // Arrange
      const date = new Date(2025, 9, 24, 23, 59, 59); // Oct 24, 2025, 23:59:59

      // Act
      const result = DateFormatter.toLocalTimestamp(date);

      // Assert
      expect(result).toBe("2025-10-24T23:59:59");
    });
  });

  describe("toDateWikilink", () => {
    it("should format date to Obsidian wikilink with quotes", () => {
      // Arrange - Use local date
      const date = new Date(2025, 9, 24, 14, 30, 45); // Oct 24, 2025

      // Act
      const result = DateFormatter.toDateWikilink(date);

      // Assert
      expect(result).toBe('"[[2025-10-24]]"');
    });

    it("should pad single-digit months and days", () => {
      // Arrange
      const date = new Date(2025, 0, 5, 14, 30, 45); // Jan 5, 2025

      // Act
      const result = DateFormatter.toDateWikilink(date);

      // Assert
      expect(result).toBe('"[[2025-01-05]]"');
    });

    it("should handle first day of year", () => {
      // Arrange
      const date = new Date(2025, 0, 1, 0, 0, 0); // Jan 1, 2025

      // Act
      const result = DateFormatter.toDateWikilink(date);

      // Assert
      expect(result).toBe('"[[2025-01-01]]"');
    });

    it("should handle last day of year", () => {
      // Arrange
      const date = new Date(2025, 11, 31, 23, 59, 59); // Dec 31, 2025

      // Act
      const result = DateFormatter.toDateWikilink(date);

      // Assert
      expect(result).toBe('"[[2025-12-31]]"');
    });
  });

  describe("getTodayWikilink", () => {
    it("should return wikilink for current date", () => {
      // Act
      const result = DateFormatter.getTodayWikilink();

      // Assert
      expect(result).toMatch(/^"\[\[\d{4}-\d{2}-\d{2}\]\]"$/);
    });

    it("should match toDateWikilink for same timestamp", () => {
      // Arrange
      const now = new Date();

      // Act
      const today = DateFormatter.getTodayWikilink();
      const explicit = DateFormatter.toDateWikilink(now);

      // Assert - should be equal within same millisecond
      expect(today).toBe(explicit);
    });
  });

  describe("parseWikilink", () => {
    it("should parse quoted wikilink to date string", () => {
      // Arrange
      const wikilink = '"[[2025-10-24]]"';

      // Act
      const result = DateFormatter.parseWikilink(wikilink);

      // Assert
      expect(result).toBe("2025-10-24");
    });

    it("should parse unquoted wikilink to date string", () => {
      // Arrange
      const wikilink = "[[2025-10-24]]";

      // Act
      const result = DateFormatter.parseWikilink(wikilink);

      // Assert
      expect(result).toBe("2025-10-24");
    });

    it("should handle single quotes", () => {
      // Arrange
      const wikilink = "'[[2025-10-24]]'";

      // Act
      const result = DateFormatter.parseWikilink(wikilink);

      // Assert
      expect(result).toBe("2025-10-24");
    });

    it("should return null for invalid format", () => {
      // Arrange
      const invalid = "2025-10-24";

      // Act
      const result = DateFormatter.parseWikilink(invalid);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      // Arrange
      const empty = "";

      // Act
      const result = DateFormatter.parseWikilink(empty);

      // Assert
      expect(result).toBeNull();
    });

    it("should return null for malformed wikilink", () => {
      // Arrange
      const malformed = "[[invalid-date]]";

      // Act
      const result = DateFormatter.parseWikilink(malformed);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("addDays", () => {
    it("should add positive days correctly", () => {
      // Arrange
      const date = new Date("2025-10-24T12:00:00Z");

      // Act
      const result = DateFormatter.addDays(date, 5);

      // Assert
      expect(result.getDate()).toBe(29);
      expect(result.getMonth()).toBe(9); // October (0-indexed)
    });

    it("should subtract days with negative input", () => {
      // Arrange
      const date = new Date("2025-10-24T12:00:00Z");

      // Act
      const result = DateFormatter.addDays(date, -5);

      // Assert
      expect(result.getDate()).toBe(19);
      expect(result.getMonth()).toBe(9);
    });

    it("should handle month boundary when adding days", () => {
      // Arrange
      const date = new Date("2025-10-30T12:00:00Z");

      // Act
      const result = DateFormatter.addDays(date, 5);

      // Assert
      expect(result.getDate()).toBe(4);
      expect(result.getMonth()).toBe(10); // November
    });

    it("should handle month boundary when subtracting days", () => {
      // Arrange
      const date = new Date("2025-11-03T12:00:00Z");

      // Act
      const result = DateFormatter.addDays(date, -5);

      // Assert
      expect(result.getDate()).toBe(29);
      expect(result.getMonth()).toBe(9); // October
    });

    it("should handle year boundary", () => {
      // Arrange
      const date = new Date("2025-12-30T12:00:00Z");

      // Act
      const result = DateFormatter.addDays(date, 5);

      // Assert
      expect(result.getDate()).toBe(4);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getFullYear()).toBe(2026);
    });

    it("should not mutate original date", () => {
      // Arrange
      const date = new Date("2025-10-24T12:00:00Z");
      const originalTime = date.getTime();

      // Act
      DateFormatter.addDays(date, 5);

      // Assert
      expect(date.getTime()).toBe(originalTime);
    });

    it("should handle adding zero days", () => {
      // Arrange
      const date = new Date("2025-10-24T12:00:00Z");

      // Act
      const result = DateFormatter.addDays(date, 0);

      // Assert
      expect(result.getDate()).toBe(date.getDate());
      expect(result.getMonth()).toBe(date.getMonth());
      expect(result.getFullYear()).toBe(date.getFullYear());
    });
  });

  describe("isSameDay", () => {
    it("should return true for same day different times", () => {
      // Arrange - Use local dates
      const morning = new Date(2025, 9, 24, 8, 0, 0); // Oct 24, 2025, 8 AM
      const evening = new Date(2025, 9, 24, 20, 0, 0); // Oct 24, 2025, 8 PM

      // Act
      const result = DateFormatter.isSameDay(morning, evening);

      // Assert
      expect(result).toBe(true);
    });

    it("should return false for different days", () => {
      // Arrange
      const today = new Date(2025, 9, 24, 23, 59, 59); // Oct 24, 2025, 23:59:59
      const tomorrow = new Date(2025, 9, 25, 0, 0, 0); // Oct 25, 2025, 00:00:00

      // Act
      const result = DateFormatter.isSameDay(today, tomorrow);

      // Assert
      expect(result).toBe(false);
    });

    it("should return true for exact same timestamp", () => {
      // Arrange
      const date1 = new Date("2025-10-24T12:00:00Z");
      const date2 = new Date("2025-10-24T12:00:00Z");

      // Act
      const result = DateFormatter.isSameDay(date1, date2);

      // Assert
      expect(result).toBe(true);
    });

    it("should return false for same day different months", () => {
      // Arrange
      const october = new Date("2025-10-24T12:00:00Z");
      const november = new Date("2025-11-24T12:00:00Z");

      // Act
      const result = DateFormatter.isSameDay(october, november);

      // Assert
      expect(result).toBe(false);
    });

    it("should return false for same day different years", () => {
      // Arrange
      const year2025 = new Date("2025-10-24T12:00:00Z");
      const year2026 = new Date("2026-10-24T12:00:00Z");

      // Act
      const result = DateFormatter.isSameDay(year2025, year2026);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("Integration: Real-world scenarios", () => {
    it("should format effort created timestamp", () => {
      // Arrange
      const created = new Date("2025-10-24T14:30:45Z");

      // Act
      const timestamp = DateFormatter.toLocalTimestamp(created);

      // Assert
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it("should format daily note reference", () => {
      // Arrange
      const today = new Date("2025-10-24T12:00:00Z");

      // Act
      const wikilink = DateFormatter.toDateWikilink(today);

      // Assert
      expect(wikilink).toBe('"[[2025-10-24]]"');
    });

    it("should shift effort day forward", () => {
      // Arrange
      const currentDate = new Date("2025-10-24T00:00:00Z");

      // Act - shift forward one day
      const nextDay = DateFormatter.addDays(currentDate, 1);
      const nextDayWikilink = DateFormatter.toDateWikilink(nextDay);

      // Assert
      expect(nextDayWikilink).toBe('"[[2025-10-25]]"');
    });

    it("should shift effort day backward", () => {
      // Arrange
      const currentDate = new Date("2025-10-24T00:00:00Z");

      // Act - shift backward one day
      const prevDay = DateFormatter.addDays(currentDate, -1);
      const prevDayWikilink = DateFormatter.toDateWikilink(prevDay);

      // Assert
      expect(prevDayWikilink).toBe('"[[2025-10-23]]"');
    });

    it("should round-trip parse and format", () => {
      // Arrange
      const original = new Date("2025-10-24T00:00:00Z");
      const wikilink = DateFormatter.toDateWikilink(original);

      // Act
      const parsed = DateFormatter.parseWikilink(wikilink);
      const reconstructed = new Date(parsed + "T00:00:00Z");

      // Assert
      expect(DateFormatter.isSameDay(original, reconstructed)).toBe(true);
    });
  });
});
