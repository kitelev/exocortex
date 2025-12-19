import {
  parseLocalDate,
  formatForInput,
  formatDisplayValue,
  formatToLocalTimestamp,
} from "../../../src/presentation/utils/dateTimeUtils";

describe("dateTimeUtils", () => {
  describe("parseLocalDate", () => {
    describe("empty and whitespace input", () => {
      it("should return null for empty string", () => {
        expect(parseLocalDate("")).toBeNull();
      });

      it("should return null for whitespace-only string", () => {
        expect(parseLocalDate("   ")).toBeNull();
      });
    });

    describe("natural language dates", () => {
      it("should parse 'today' as midnight local time", () => {
        const result = parseLocalDate("today");
        expect(result).not.toBeNull();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        expect(result?.getFullYear()).toBe(today.getFullYear());
        expect(result?.getMonth()).toBe(today.getMonth());
        expect(result?.getDate()).toBe(today.getDate());
        expect(result?.getHours()).toBe(0);
        expect(result?.getMinutes()).toBe(0);
      });

      it("should parse 'tomorrow' as tomorrow at midnight", () => {
        const result = parseLocalDate("tomorrow");
        expect(result).not.toBeNull();

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        expect(result?.getFullYear()).toBe(tomorrow.getFullYear());
        expect(result?.getMonth()).toBe(tomorrow.getMonth());
        expect(result?.getDate()).toBe(tomorrow.getDate());
      });

      it("should parse 'yesterday' as yesterday at midnight", () => {
        const result = parseLocalDate("yesterday");
        expect(result).not.toBeNull();

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        expect(result?.getFullYear()).toBe(yesterday.getFullYear());
        expect(result?.getMonth()).toBe(yesterday.getMonth());
        expect(result?.getDate()).toBe(yesterday.getDate());
      });

      it("should parse 'next week' as 7 days from now", () => {
        const result = parseLocalDate("next week");
        expect(result).not.toBeNull();

        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        nextWeek.setHours(0, 0, 0, 0);

        expect(result?.getFullYear()).toBe(nextWeek.getFullYear());
        expect(result?.getMonth()).toBe(nextWeek.getMonth());
        expect(result?.getDate()).toBe(nextWeek.getDate());
      });

      it("should be case-insensitive", () => {
        expect(parseLocalDate("TODAY")).not.toBeNull();
        expect(parseLocalDate("Tomorrow")).not.toBeNull();
        expect(parseLocalDate("NEXT WEEK")).not.toBeNull();
      });
    });

    describe("relative dates", () => {
      it("should parse 'in 3 days'", () => {
        const result = parseLocalDate("in 3 days");
        expect(result).not.toBeNull();

        const expected = new Date();
        expected.setDate(expected.getDate() + 3);
        expected.setHours(0, 0, 0, 0);

        expect(result?.getDate()).toBe(expected.getDate());
      });

      it("should parse 'in 1 day' (singular)", () => {
        const result = parseLocalDate("in 1 day");
        expect(result).not.toBeNull();

        const expected = new Date();
        expected.setDate(expected.getDate() + 1);

        expect(result?.getDate()).toBe(expected.getDate());
      });

      it("should parse 'in 2 weeks'", () => {
        const result = parseLocalDate("in 2 weeks");
        expect(result).not.toBeNull();

        const expected = new Date();
        expected.setDate(expected.getDate() + 14);
        expected.setHours(0, 0, 0, 0);

        expect(result?.getDate()).toBe(expected.getDate());
      });
    });

    describe("ISO-style date formats", () => {
      it("should parse date-only format (YYYY-MM-DD)", () => {
        const result = parseLocalDate("2025-12-02");
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2025);
        expect(result?.getMonth()).toBe(11); // December is 11
        expect(result?.getDate()).toBe(2);
      });

      it("should parse date with time using T separator", () => {
        const result = parseLocalDate("2025-12-02T13:03:22");
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2025);
        expect(result?.getMonth()).toBe(11);
        expect(result?.getDate()).toBe(2);
        expect(result?.getHours()).toBe(13);
        expect(result?.getMinutes()).toBe(3);
      });

      it("should parse date with time using space separator (normalized to local time)", () => {
        // This is the key fix: space-separated format should be treated as local time
        const result = parseLocalDate("2025-12-02 13:03");
        expect(result).not.toBeNull();
        expect(result?.getFullYear()).toBe(2025);
        expect(result?.getMonth()).toBe(11);
        expect(result?.getDate()).toBe(2);
        // Hours should be 13 (local time), not converted from UTC
        expect(result?.getHours()).toBe(13);
        expect(result?.getMinutes()).toBe(3);
      });

      it("should parse date with seconds", () => {
        const result = parseLocalDate("2025-12-02 13:03:22");
        expect(result).not.toBeNull();
        expect(result?.getHours()).toBe(13);
        expect(result?.getMinutes()).toBe(3);
        expect(result?.getSeconds()).toBe(22);
      });
    });

    describe("timezone handling", () => {
      it("should store date as local timestamp string (without Z suffix)", () => {
        // Parse a local time
        const localDate = parseLocalDate("2025-12-02 13:03");
        expect(localDate).not.toBeNull();

        // Convert to local timestamp string (without Z suffix)
        const localTimestamp = formatToLocalTimestamp(localDate!);

        // The local timestamp should preserve the local time components
        expect(localTimestamp).toBe("2025-12-02T13:03:00");

        // When we parse it back, it should be interpreted as local time
        const parsedBack = new Date(localTimestamp);
        expect(parsedBack.getHours()).toBe(13);
        expect(parsedBack.getMinutes()).toBe(3);
      });

      it("should maintain roundtrip consistency: input → store → display", () => {
        // Simulate the full roundtrip:
        // 1. User enters "2025-12-02 13:03" (local time)
        const userInput = "2025-12-02 13:03";
        const parsed = parseLocalDate(userInput);
        expect(parsed).not.toBeNull();

        // 2. Store as local timestamp string (without Z suffix)
        const storedValue = formatToLocalTimestamp(parsed!);

        // 3. Format back for display
        const displayValue = formatForInput(storedValue);

        // 4. Display should match user's original input (local time)
        expect(displayValue).toBe("2025-12-02 13:03");
      });
    });

    describe("invalid input", () => {
      it("should return null for invalid date string", () => {
        expect(parseLocalDate("not a date")).toBeNull();
      });

      it("should return null for completely invalid input", () => {
        expect(parseLocalDate("abc123")).toBeNull();
        expect(parseLocalDate("random text here")).toBeNull();
      });
    });
  });

  describe("formatForInput", () => {
    it("should return original string for invalid ISO string", () => {
      expect(formatForInput("not a date")).toBe("not a date");
    });

    it("should format UTC midnight as date-only (local time)", () => {
      // UTC midnight will show as local time
      // Test with a date that's clearly midnight in UTC
      const utcMidnight = "2025-06-15T00:00:00.000Z";
      const result = formatForInput(utcMidnight);

      // Parse the stored value and check local components
      const date = new Date(utcMidnight);
      const expectedYear = date.getFullYear();
      const expectedMonth = String(date.getMonth() + 1).padStart(2, "0");
      const expectedDay = String(date.getDate()).padStart(2, "0");

      // If local time has non-zero hours (due to timezone offset),
      // it should include time; otherwise just date
      if (date.getHours() !== 0 || date.getMinutes() !== 0) {
        const expectedHours = String(date.getHours()).padStart(2, "0");
        const expectedMinutes = String(date.getMinutes()).padStart(2, "0");
        expect(result).toBe(
          `${expectedYear}-${expectedMonth}-${expectedDay} ${expectedHours}:${expectedMinutes}`,
        );
      } else {
        expect(result).toBe(`${expectedYear}-${expectedMonth}-${expectedDay}`);
      }
    });

    it("should format date with time correctly", () => {
      // Use a specific UTC time
      const utcTime = "2025-12-02T08:03:00.000Z";
      const result = formatForInput(utcTime);

      // Parse and get local components
      const date = new Date(utcTime);
      const expectedYear = date.getFullYear();
      const expectedMonth = String(date.getMonth() + 1).padStart(2, "0");
      const expectedDay = String(date.getDate()).padStart(2, "0");
      const expectedHours = String(date.getHours()).padStart(2, "0");
      const expectedMinutes = String(date.getMinutes()).padStart(2, "0");

      expect(result).toBe(
        `${expectedYear}-${expectedMonth}-${expectedDay} ${expectedHours}:${expectedMinutes}`,
      );
    });

    it("should use local time for display, not UTC", () => {
      // Create a date at a specific UTC time
      const utcTime = "2025-12-02T15:30:00.000Z";
      const date = new Date(utcTime);

      // Get what the local hour should be
      const localHour = date.getHours();

      const result = formatForInput(utcTime);

      // Result should contain the local hour, not 15 (UTC)
      // Unless we're in UTC timezone, in which case they're the same
      expect(result).toContain(String(localHour).padStart(2, "0"));
    });
  });

  describe("formatDisplayValue", () => {
    it("should return 'Empty' for null", () => {
      expect(formatDisplayValue(null)).toBe("Empty");
    });

    it("should return original string for invalid date", () => {
      expect(formatDisplayValue("not a date")).toBe("not a date");
    });

    it("should include time component for datetime values", () => {
      const result = formatDisplayValue("2024-11-11T15:30:00.000Z");
      expect(result).toContain(":");
    });

    it("should format in 24-hour format (no AM/PM)", () => {
      const result = formatDisplayValue("2024-11-11T15:30:00.000Z");
      expect(result).not.toContain("AM");
      expect(result).not.toContain("PM");
      expect(result).not.toContain("am");
      expect(result).not.toContain("pm");
    });

    it("should include year, month, and day", () => {
      const result = formatDisplayValue("2024-11-11T15:30:00.000Z");
      // The exact format depends on locale, but should contain these components
      expect(result).toContain("2024");
      expect(result).toContain("11"); // day
      // Month could be "Nov" or "11" depending on locale
    });
  });

  describe("timezone roundtrip scenarios", () => {
    it("should handle editing and re-saving without drift", () => {
      // Simulate: user enters time → save → open editor → save again
      // The value should not drift due to timezone conversions

      const originalInput = "2025-12-02 13:03";

      // First save
      const firstParse = parseLocalDate(originalInput);
      const firstSave = formatToLocalTimestamp(firstParse!);

      // Open editor (format for input)
      const displayedValue = formatForInput(firstSave);

      // Second save (user doesn't change anything)
      const secondParse = parseLocalDate(displayedValue);
      const secondSave = formatToLocalTimestamp(secondParse!);

      // Values should be identical - no drift
      expect(secondSave).toBe(firstSave);
    });

    it("should preserve time across multiple edit cycles", () => {
      const originalInput = "2025-06-15 09:30";
      let currentValue = formatToLocalTimestamp(parseLocalDate(originalInput)!);

      // Simulate 5 edit cycles
      for (let i = 0; i < 5; i++) {
        const displayed = formatForInput(currentValue);
        const parsed = parseLocalDate(displayed);
        currentValue = formatToLocalTimestamp(parsed!);
      }

      // Final display should match original input
      const finalDisplay = formatForInput(currentValue);
      expect(finalDisplay).toBe(originalInput);
    });
  });

  describe("formatToLocalTimestamp", () => {
    it("should format date as YYYY-MM-DDTHH:mm:ss without Z suffix", () => {
      const date = new Date(2025, 11, 17, 20, 5, 30); // Dec 17, 2025, 20:05:30
      const result = formatToLocalTimestamp(date);
      expect(result).toBe("2025-12-17T20:05:30");
    });

    it("should pad single digit values with zeros", () => {
      const date = new Date(2025, 0, 5, 3, 7, 9); // Jan 5, 2025, 03:07:09
      const result = formatToLocalTimestamp(date);
      expect(result).toBe("2025-01-05T03:07:09");
    });

    it("should not include Z suffix (unlike toISOString)", () => {
      const date = new Date(2025, 11, 17, 20, 5, 0);
      const result = formatToLocalTimestamp(date);
      expect(result).not.toContain("Z");
      expect(result).not.toContain("+");
      expect(result).not.toContain("-05"); // No timezone offset
    });

    it("should be parseable back to the same local time", () => {
      const original = new Date(2025, 11, 17, 20, 5, 30);
      const formatted = formatToLocalTimestamp(original);
      const parsed = new Date(formatted);

      expect(parsed.getFullYear()).toBe(original.getFullYear());
      expect(parsed.getMonth()).toBe(original.getMonth());
      expect(parsed.getDate()).toBe(original.getDate());
      expect(parsed.getHours()).toBe(original.getHours());
      expect(parsed.getMinutes()).toBe(original.getMinutes());
      expect(parsed.getSeconds()).toBe(original.getSeconds());
    });
  });
});
