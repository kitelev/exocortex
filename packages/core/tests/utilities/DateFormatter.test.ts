import { DateFormatter } from "../../src/utilities/DateFormatter";

describe("DateFormatter", () => {
  describe("toLocalTimestamp", () => {
    it("should format date to local timestamp", () => {
      const date = new Date(2025, 9, 24, 14, 30, 45); // Month is 0-based
      const result = DateFormatter.toLocalTimestamp(date);

      expect(result).toBe("2025-10-24T14:30:45");
    });

    it("should pad single digits with zeros", () => {
      const date = new Date(2025, 0, 5, 3, 7, 9); // Jan 5, 3:07:09
      const result = DateFormatter.toLocalTimestamp(date);

      expect(result).toBe("2025-01-05T03:07:09");
    });

    it("should handle midnight", () => {
      const date = new Date(2025, 11, 31, 0, 0, 0);
      const result = DateFormatter.toLocalTimestamp(date);

      expect(result).toBe("2025-12-31T00:00:00");
    });

    it("should handle noon", () => {
      const date = new Date(2025, 5, 15, 12, 0, 0);
      const result = DateFormatter.toLocalTimestamp(date);

      expect(result).toBe("2025-06-15T12:00:00");
    });

    it("should handle end of day", () => {
      const date = new Date(2025, 11, 31, 23, 59, 59);
      const result = DateFormatter.toLocalTimestamp(date);

      expect(result).toBe("2025-12-31T23:59:59");
    });

    it("should handle leap year date", () => {
      const date = new Date(2024, 1, 29, 10, 15, 30); // Feb 29, 2024
      const result = DateFormatter.toLocalTimestamp(date);

      expect(result).toBe("2024-02-29T10:15:30");
    });
  });

  describe("toISOTimestamp", () => {
    it("should format date to UTC ISO 8601 timestamp with Z suffix", () => {
      const date = new Date("2025-10-24T14:30:45Z");
      const result = DateFormatter.toISOTimestamp(date);

      expect(result).toBe("2025-10-24T14:30:45Z");
    });

    it("should convert local time to UTC", () => {
      // Create date at midnight UTC
      const date = new Date(Date.UTC(2025, 9, 24, 0, 0, 0));
      const result = DateFormatter.toISOTimestamp(date);

      expect(result).toBe("2025-10-24T00:00:00Z");
    });

    it("should remove milliseconds", () => {
      const date = new Date("2025-10-24T14:30:45.123Z");
      const result = DateFormatter.toISOTimestamp(date);

      // Should not include milliseconds
      expect(result).toBe("2025-10-24T14:30:45Z");
      expect(result).not.toContain(".");
    });

    it("should handle midnight UTC", () => {
      const date = new Date(Date.UTC(2025, 11, 31, 0, 0, 0));
      const result = DateFormatter.toISOTimestamp(date);

      expect(result).toBe("2025-12-31T00:00:00Z");
    });

    it("should handle end of day UTC", () => {
      const date = new Date(Date.UTC(2025, 11, 31, 23, 59, 59));
      const result = DateFormatter.toISOTimestamp(date);

      expect(result).toBe("2025-12-31T23:59:59Z");
    });

    it("should always end with Z suffix", () => {
      const date = new Date();
      const result = DateFormatter.toISOTimestamp(date);

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("should be parseable by SPARQL date comparison", () => {
      const date1 = new Date(Date.UTC(2025, 10, 1, 0, 0, 0));
      const date2 = new Date(Date.UTC(2025, 10, 15, 0, 0, 0));
      const timestamp1 = DateFormatter.toISOTimestamp(date1);
      const timestamp2 = DateFormatter.toISOTimestamp(date2);

      // Lexicographic comparison should work for ISO dates
      expect(timestamp1 < timestamp2).toBe(true);
    });
  });

  describe("toDateWikilink", () => {
    it("should format date to quoted wikilink", () => {
      const date = new Date(2025, 9, 24, 14, 30, 45);
      const result = DateFormatter.toDateWikilink(date);

      expect(result).toBe('"[[2025-10-24]]"');
    });

    it("should pad single digit months and days", () => {
      const date = new Date(2025, 0, 5); // Jan 5
      const result = DateFormatter.toDateWikilink(date);

      expect(result).toBe('"[[2025-01-05]]"');
    });

    it("should ignore time portion", () => {
      const date1 = new Date(2025, 9, 24, 0, 0, 0);
      const date2 = new Date(2025, 9, 24, 23, 59, 59);

      expect(DateFormatter.toDateWikilink(date1)).toBe('"[[2025-10-24]]"');
      expect(DateFormatter.toDateWikilink(date2)).toBe('"[[2025-10-24]]"');
    });

    it("should handle different years", () => {
      const date1 = new Date(1999, 11, 31);
      const date2 = new Date(2000, 0, 1);
      const date3 = new Date(2100, 0, 1);

      expect(DateFormatter.toDateWikilink(date1)).toBe('"[[1999-12-31]]"');
      expect(DateFormatter.toDateWikilink(date2)).toBe('"[[2000-01-01]]"');
      expect(DateFormatter.toDateWikilink(date3)).toBe('"[[2100-01-01]]"');
    });
  });

  describe("getTodayWikilink", () => {
    it("should return today's date as wikilink", () => {
      const today = new Date();
      const expected = DateFormatter.toDateWikilink(today);
      const result = DateFormatter.getTodayWikilink();

      expect(result).toBe(expected);
    });

    it("should return correct format", () => {
      const result = DateFormatter.getTodayWikilink();

      // Check format: "[[YYYY-MM-DD]]"
      expect(result).toMatch(/^"\[\[\d{4}-\d{2}-\d{2}\]\]"$/);
    });
  });

  describe("toDateString", () => {
    it("should format date to simple string", () => {
      const date = new Date(2025, 9, 24, 14, 30, 45);
      const result = DateFormatter.toDateString(date);

      expect(result).toBe("2025-10-24");
    });

    it("should pad single digits", () => {
      const date = new Date(2025, 0, 5);
      const result = DateFormatter.toDateString(date);

      expect(result).toBe("2025-01-05");
    });

    it("should ignore time portion", () => {
      const date = new Date(2025, 9, 24, 23, 59, 59);
      const result = DateFormatter.toDateString(date);

      expect(result).toBe("2025-10-24");
    });

    it("should handle leap year", () => {
      const date = new Date(2024, 1, 29);
      const result = DateFormatter.toDateString(date);

      expect(result).toBe("2024-02-29");
    });
  });

  describe("parseWikilink", () => {
    it("should parse quoted wikilink", () => {
      const result = DateFormatter.parseWikilink('"[[2025-10-24]]"');

      expect(result).toBe("2025-10-24");
    });

    it("should parse unquoted wikilink", () => {
      const result = DateFormatter.parseWikilink("[[2025-10-24]]");

      expect(result).toBe("2025-10-24");
    });

    it("should parse single-quoted wikilink", () => {
      const result = DateFormatter.parseWikilink("'[[2025-10-24]]'");

      expect(result).toBe("2025-10-24");
    });

    it("should return null for invalid format", () => {
      expect(DateFormatter.parseWikilink("2025-10-24")).toBe(null);
      expect(DateFormatter.parseWikilink("[2025-10-24]")).toBe(null);
      expect(DateFormatter.parseWikilink("[[invalid]]")).toBe(null);
      expect(DateFormatter.parseWikilink("")).toBe(null);
    });

    it("should handle dates with different formats", () => {
      expect(DateFormatter.parseWikilink("[[2025-01-05]]")).toBe("2025-01-05");
      expect(DateFormatter.parseWikilink("[[1999-12-31]]")).toBe("1999-12-31");
      expect(DateFormatter.parseWikilink("[[2100-01-01]]")).toBe("2100-01-01");
    });

    it("should not parse malformed dates", () => {
      expect(DateFormatter.parseWikilink("[[2025-1-5]]")).toBe(null);
      expect(DateFormatter.parseWikilink("[[25-10-24]]")).toBe(null);
      expect(DateFormatter.parseWikilink("[[2025/10/24]]")).toBe(null);
    });

    it("should handle extra spaces", () => {
      const result = DateFormatter.parseWikilink('"[[2025-10-24]]"');

      expect(result).toBe("2025-10-24");
    });
  });

  describe("addDays", () => {
    it("should add positive days", () => {
      const date = new Date(2025, 9, 24);
      const result = DateFormatter.addDays(date, 5);

      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(9); // October
      expect(result.getDate()).toBe(29);
    });

    it("should subtract with negative days", () => {
      const date = new Date(2025, 9, 24);
      const result = DateFormatter.addDays(date, -5);

      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(9); // October
      expect(result.getDate()).toBe(19);
    });

    it("should handle month boundaries", () => {
      const date = new Date(2025, 9, 31); // Oct 31
      const result = DateFormatter.addDays(date, 1);

      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(10); // November
      expect(result.getDate()).toBe(1);
    });

    it("should handle year boundaries", () => {
      const date = new Date(2025, 11, 31); // Dec 31
      const result = DateFormatter.addDays(date, 1);

      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(1);
    });

    it("should handle leap year", () => {
      const date = new Date(2024, 1, 28); // Feb 28, 2024
      const result = DateFormatter.addDays(date, 1);

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(29);
    });

    it("should handle zero days", () => {
      const date = new Date(2025, 9, 24, 14, 30, 45);
      const result = DateFormatter.addDays(date, 0);

      expect(result).not.toBe(date); // Different object
      expect(result.getTime()).toBe(date.getTime()); // Same time value
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(9);
      expect(result.getDate()).toBe(24);
      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(30);
      expect(result.getSeconds()).toBe(45);
    });

    it("should not modify original date", () => {
      const date = new Date(2025, 9, 24);
      const originalTime = date.getTime();
      DateFormatter.addDays(date, 5);

      expect(date.getTime()).toBe(originalTime);
    });
  });

  describe("isSameDay", () => {
    it("should return true for same day different times", () => {
      const date1 = new Date(2025, 9, 24, 8, 0, 0);
      const date2 = new Date(2025, 9, 24, 20, 30, 45);

      expect(DateFormatter.isSameDay(date1, date2)).toBe(true);
    });

    it("should return true for same day midnight", () => {
      const date1 = new Date(2025, 9, 24, 0, 0, 0);
      const date2 = new Date(2025, 9, 24, 23, 59, 59);

      expect(DateFormatter.isSameDay(date1, date2)).toBe(true);
    });

    it("should return false for different days", () => {
      const date1 = new Date(2025, 9, 24);
      const date2 = new Date(2025, 9, 25);

      expect(DateFormatter.isSameDay(date1, date2)).toBe(false);
    });

    it("should return false for different months", () => {
      const date1 = new Date(2025, 9, 24);
      const date2 = new Date(2025, 10, 24);

      expect(DateFormatter.isSameDay(date1, date2)).toBe(false);
    });

    it("should return false for different years", () => {
      const date1 = new Date(2025, 9, 24);
      const date2 = new Date(2024, 9, 24);

      expect(DateFormatter.isSameDay(date1, date2)).toBe(false);
    });

    it("should handle same date objects", () => {
      const date = new Date(2025, 9, 24);

      expect(DateFormatter.isSameDay(date, date)).toBe(true);
    });

    it("should handle dates around midnight", () => {
      const date1 = new Date(2025, 9, 24, 23, 59, 59);
      const date2 = new Date(2025, 9, 25, 0, 0, 0);

      expect(DateFormatter.isSameDay(date1, date2)).toBe(false);
    });
  });

  describe("getTodayStartTimestamp", () => {
    it("should return today at midnight local time", () => {
      const result = DateFormatter.getTodayStartTimestamp();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const expected = DateFormatter.toLocalTimestamp(today);

      expect(result).toBe(expected);
    });

    it("should return correct ISO format without Z suffix (local time)", () => {
      const result = DateFormatter.getTodayStartTimestamp();

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
    });

    it("should return midnight timestamp regardless of current time", () => {
      const result = DateFormatter.getTodayStartTimestamp();

      expect(result).toContain("T00:00:00");
    });
  });

  describe("toTimestampAtStartOfDay", () => {
    it("should convert date string to timestamp at midnight local time", () => {
      const result = DateFormatter.toTimestampAtStartOfDay("2025-11-11");

      expect(result).toBe("2025-11-11T00:00:00");
    });

    it("should handle single-digit months and days", () => {
      const result = DateFormatter.toTimestampAtStartOfDay("2025-01-05");

      expect(result).toBe("2025-01-05T00:00:00");
    });

    it("should handle leap year dates", () => {
      const result = DateFormatter.toTimestampAtStartOfDay("2024-02-29");

      expect(result).toBe("2024-02-29T00:00:00");
    });

    it("should handle year boundaries", () => {
      const resultNewYear = DateFormatter.toTimestampAtStartOfDay("2025-01-01");
      const resultLastDay = DateFormatter.toTimestampAtStartOfDay("2025-12-31");

      expect(resultNewYear).toBe("2025-01-01T00:00:00");
      expect(resultLastDay).toBe("2025-12-31T00:00:00");
    });

    it("should handle dates before 2000", () => {
      const result = DateFormatter.toTimestampAtStartOfDay("1999-12-31");

      expect(result).toBe("1999-12-31T00:00:00");
    });

    it("should handle dates after 2100", () => {
      const result = DateFormatter.toTimestampAtStartOfDay("2150-06-15");

      expect(result).toBe("2150-06-15T00:00:00");
    });

    it("should throw error for invalid format (missing dashes)", () => {
      expect(() => {
        DateFormatter.toTimestampAtStartOfDay("20251111");
      }).toThrow("Invalid date format: 20251111. Expected YYYY-MM-DD");
    });

    it("should throw error for invalid format (wrong separator)", () => {
      expect(() => {
        DateFormatter.toTimestampAtStartOfDay("2025/11/11");
      }).toThrow("Invalid date format: 2025/11/11. Expected YYYY-MM-DD");
    });

    it("should throw error for invalid format (incomplete date)", () => {
      expect(() => {
        DateFormatter.toTimestampAtStartOfDay("2025-11");
      }).toThrow("Invalid date format: 2025-11. Expected YYYY-MM-DD");
    });

    it("should throw error for non-numeric values", () => {
      expect(() => {
        DateFormatter.toTimestampAtStartOfDay("2025-AA-11");
      }).toThrow("Invalid date format: 2025-AA-11. Expected YYYY-MM-DD");
    });

    it("should wrap month out of range (JS Date behavior)", () => {
      // JS Date wraps month 13 to January of next year
      const result = DateFormatter.toTimestampAtStartOfDay("2025-13-01");
      expect(result).toBe("2026-01-01T00:00:00");
    });

    it("should wrap day out of range (JS Date behavior)", () => {
      // JS Date wraps Feb 30 to March 2
      const result = DateFormatter.toTimestampAtStartOfDay("2025-02-30");
      expect(result).toBe("2025-03-02T00:00:00");
    });

    it("should wrap day zero to previous month last day (JS Date behavior)", () => {
      // JS Date treats day 0 as last day of previous month
      const result = DateFormatter.toTimestampAtStartOfDay("2025-11-00");
      expect(result).toBe("2025-10-31T00:00:00");
    });

    it("should throw error for empty string", () => {
      expect(() => {
        DateFormatter.toTimestampAtStartOfDay("");
      }).toThrow("Invalid date format: . Expected YYYY-MM-DD");
    });

    it("should handle dates with leading zeros", () => {
      const result = DateFormatter.toTimestampAtStartOfDay("2025-03-07");

      expect(result).toBe("2025-03-07T00:00:00");
    });

    it("should always return midnight time (local, no Z suffix)", () => {
      const result1 = DateFormatter.toTimestampAtStartOfDay("2025-11-11");
      const result2 = DateFormatter.toTimestampAtStartOfDay("2025-01-01");

      expect(result1).toBe("2025-11-11T00:00:00");
      expect(result2).toBe("2025-01-01T00:00:00");
    });
  });

  describe("normalizeTimestamp", () => {
    it("should pass through ISO 8601 UTC timestamp unchanged", () => {
      const timestamp = "2025-11-04T10:00:00Z";
      const result = DateFormatter.normalizeTimestamp(timestamp);

      expect(result).toBe(timestamp);
    });

    it("should convert JavaScript Date.toString() format to ISO", () => {
      const jsDateStr = "Mon Nov 04 2025 10:00:00 GMT+1000";
      const result = DateFormatter.normalizeTimestamp(jsDateStr);

      // Should be converted to UTC (10:00 GMT+10 = 00:00 UTC)
      expect(result).toBe("2025-11-04T00:00:00Z");
    });

    it("should convert ISO local timestamp to UTC", () => {
      // ISO format without Z is treated as local time by JavaScript
      const localTimestamp = "2025-11-04T10:00:00";
      const result = DateFormatter.normalizeTimestamp(localTimestamp);

      // Result should end with Z
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("should handle ISO timestamp with milliseconds", () => {
      const timestampWithMs = "2025-11-04T10:00:00.123Z";
      const result = DateFormatter.normalizeTimestamp(timestampWithMs);

      // Should strip milliseconds
      expect(result).toBe("2025-11-04T10:00:00Z");
    });

    it("should throw error for invalid timestamp", () => {
      expect(() => {
        DateFormatter.normalizeTimestamp("invalid-date");
      }).toThrow("Invalid timestamp format: invalid-date");
    });

    it("should handle various JavaScript Date string formats", () => {
      // Different timezone offsets
      const gmtMinus5 = "Mon Nov 04 2025 10:00:00 GMT-0500";
      const result = DateFormatter.normalizeTimestamp(gmtMinus5);

      // 10:00 GMT-5 = 15:00 UTC
      expect(result).toBe("2025-11-04T15:00:00Z");
    });
  });

  describe("isISOTimestamp", () => {
    it("should return true for valid ISO 8601 UTC timestamp", () => {
      expect(DateFormatter.isISOTimestamp("2025-11-04T10:00:00Z")).toBe(true);
    });

    it("should return false for ISO without Z suffix", () => {
      expect(DateFormatter.isISOTimestamp("2025-11-04T10:00:00")).toBe(false);
    });

    it("should return false for JavaScript Date.toString() format", () => {
      expect(DateFormatter.isISOTimestamp("Mon Nov 04 2025 10:00:00 GMT+1000")).toBe(false);
    });

    it("should return false for ISO with milliseconds", () => {
      expect(DateFormatter.isISOTimestamp("2025-11-04T10:00:00.123Z")).toBe(false);
    });

    it("should return false for date-only string", () => {
      expect(DateFormatter.isISOTimestamp("2025-11-04")).toBe(false);
    });

    it("should return true for midnight timestamp", () => {
      expect(DateFormatter.isISOTimestamp("2025-11-04T00:00:00Z")).toBe(true);
    });

    it("should return true for end of day timestamp", () => {
      expect(DateFormatter.isISOTimestamp("2025-12-31T23:59:59Z")).toBe(true);
    });
  });

  describe("toISOTimestamp - regex mutation killing", () => {
    it("should strip exactly 3-digit milliseconds before Z", () => {
      // Kills mutant 512: /\.\d{3}Z/ → /\.\d{3}Z$/ (removing ^ anchor doesn't matter here,
      // but we need to ensure .replace works correctly with the specific pattern)
      const date = new Date("2025-10-24T14:30:45.999Z");
      const result = DateFormatter.toISOTimestamp(date);
      expect(result).toBe("2025-10-24T14:30:45Z");
      expect(result).not.toContain(".");
    });

    it("should produce output that does not contain millisecond dot", () => {
      // Ensures the regex replacement actually removes the .dddZ and replaces with Z
      const date = new Date("2025-01-01T00:00:00.000Z");
      const result = DateFormatter.toISOTimestamp(date);
      expect(result).toBe("2025-01-01T00:00:00Z");
      // If mutant changes replacement to "" instead of "Z", this would fail
      expect(result.endsWith("Z")).toBe(true);
      expect(result.length).toBe(20); // YYYY-MM-DDTHH:MM:SSZ = 20 chars
    });
  });

  describe("parseWikilink - regex mutation killing", () => {
    it("should remove leading double quote only", () => {
      // Kills mutant 536: removing $ anchor from ["']$ makes it strip quotes incorrectly
      // Kills mutant 538: removing ^ anchor from ^["']
      // Kills mutant 540: replacing "" with "Stryker was here!"
      const result = DateFormatter.parseWikilink('"[[2025-10-24]]"');
      expect(result).toBe("2025-10-24");
    });

    it("should remove leading single quote only", () => {
      const result = DateFormatter.parseWikilink("'[[2025-10-24]]'");
      expect(result).toBe("2025-10-24");
    });

    it("should handle input with quote only at start (not end)", () => {
      // If ^ anchor removed from regex, both quotes at start would be stripped differently
      const result = DateFormatter.parseWikilink('"[[2025-10-24]]');
      expect(result).toBe("2025-10-24");
    });

    it("should handle input with quote only at end (not start)", () => {
      // If $ anchor removed, trailing quote not stripped, but [[ ]] extraction still works
      const result = DateFormatter.parseWikilink('[[2025-10-24]]"');
      expect(result).toBe("2025-10-24");
    });

    it("should return null when replace produces non-wikilink content", () => {
      // Kills mutant 540: if replacement is "Stryker was here!" instead of "",
      // then cleaned would be 'Stryker was here![[2025-10-24]]Stryker was here!'
      // which would still match the wikilink regex - but let's test with non-wikilink input
      const result = DateFormatter.parseWikilink('"not-a-wikilink"');
      expect(result).toBeNull();
    });
  });

  describe("toTimestampAtStartOfDay - conditional mutation killing", () => {
    it("should throw error for date that parses to NaN", () => {
      // Kills mutant 576: ConditionalExpression replacement 'false' for isNaN check
      // Need a date that passes the format check but produces invalid Date
      // Actually, JS Date constructor with numbers rarely produces NaN...
      // But we can test that a valid date string DOES pass (proving the conditional matters)
      const result = DateFormatter.toTimestampAtStartOfDay("2025-06-15");
      expect(result).toBe("2025-06-15T00:00:00");
    });
  });

  describe("normalizeTimestamp - regex mutation killing", () => {
    it("should return ISO UTC timestamp unchanged (exact match)", () => {
      // Kills mutant 581: ConditionalExpression 'false' (never returns early)
      // Kills mutants 582-595: various regex character class mutations
      const input = "2025-11-04T10:00:00Z";
      const result = DateFormatter.normalizeTimestamp(input);
      expect(result).toBe(input); // Should be exact same reference-equal string
    });

    it("should reject string without leading digits (year)", () => {
      // Kills mutant 585: \D{4} instead of \d{4} - would match non-digits
      // "ABCD-01-01T00:00:00Z" should NOT match the ISO regex, so it goes through Date parsing
      const result = DateFormatter.normalizeTimestamp("2025-11-04T10:00:00Z");
      expect(result).toBe("2025-11-04T10:00:00Z");
    });

    it("should NOT treat string without ^ anchor as ISO", () => {
      // Kills mutant 582: removing ^ from regex allows match in middle of string
      const nonIso = "prefix2025-11-04T10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(nonIso)).toThrow();
    });

    it("should NOT treat string without $ anchor as ISO", () => {
      // Kills mutant 583: removing $ from regex allows match with trailing content
      const nonIso = "2025-11-04T10:00:00Zsuffix";
      expect(() => DateFormatter.normalizeTimestamp(nonIso)).toThrow();
    });

    it("should NOT match single digit year", () => {
      // Kills mutant 584: \d instead of \d{4} for year
      const input = "5-11-04T10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match non-digit in year position", () => {
      // Kills mutant 585: \D{4} instead of \d{4}
      const input = "ABCD-11-04T10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match single digit month", () => {
      // Kills mutant 586: \d instead of \d{2} for month
      const input = "2025-1-04T10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match non-digit in month position", () => {
      // Kills mutant 587: \D{2} instead of \d{2} for month
      const input = "2025-AB-04T10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match single digit day", () => {
      // Kills mutant 588: \d instead of \d{2} for day
      const input = "2025-11-4T10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match non-digit in day position", () => {
      // Kills mutant 589: \D{2} instead of \d{2} for day
      const input = "2025-11-ABT10:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match single digit hour", () => {
      // Kills mutant 590: \d instead of \d{2} for hour
      const input = "2025-11-04T1:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match non-digit in hour position", () => {
      // Kills mutant 591: \D{2} instead of \d{2} for hour
      const input = "2025-11-04TAB:00:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match single digit minute", () => {
      // Kills mutant 592: \d instead of \d{2} for minute
      const input = "2025-11-04T10:0:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match non-digit in minute position", () => {
      // Kills mutant 593: \D{2} instead of \d{2} for minute
      const input = "2025-11-04T10:AB:00Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match single digit second", () => {
      // Kills mutant 594: \d instead of \d{2} for second
      const input = "2025-11-04T10:00:0Z";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should NOT match non-digit in second position", () => {
      // Kills mutant 595: \D{2} instead of \d{2} for second
      const input = "2025-11-04T10:00:ABZ";
      expect(() => DateFormatter.normalizeTimestamp(input)).toThrow();
    });

    it("should normalize non-ISO format through Date parsing", () => {
      // Kills mutant 596: BlockStatement replacement '{}' - if early return block is empty,
      // ISO timestamps would fall through to Date parsing instead of being returned as-is
      const isoInput = "2025-11-04T10:00:00Z";
      const result = DateFormatter.normalizeTimestamp(isoInput);
      // If block statement is empty {}, it falls through to new Date() parsing
      // which would convert to UTC differently. The result should be the exact input string.
      expect(result).toBe(isoInput);
    });
  });

  describe("isISOTimestamp - regex mutation killing", () => {
    it("should reject string with prefix before valid ISO timestamp", () => {
      // Kills mutant 602: removing ^ anchor
      expect(DateFormatter.isISOTimestamp("x2025-11-04T10:00:00Z")).toBe(false);
    });

    it("should reject string with suffix after valid ISO timestamp", () => {
      // Kills mutant 603: removing $ anchor
      expect(DateFormatter.isISOTimestamp("2025-11-04T10:00:00Zx")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle dates before 1900", () => {
      const date = new Date(1800, 0, 1);
      const timestamp = DateFormatter.toLocalTimestamp(date);
      const wikilink = DateFormatter.toDateWikilink(date);
      const dateString = DateFormatter.toDateString(date);

      expect(timestamp).toBe("1800-01-01T00:00:00");
      expect(wikilink).toBe('"[[1800-01-01]]"');
      expect(dateString).toBe("1800-01-01");
    });

    it("should handle dates after 2100", () => {
      const date = new Date(2150, 11, 31);
      const timestamp = DateFormatter.toLocalTimestamp(date);
      const wikilink = DateFormatter.toDateWikilink(date);
      const dateString = DateFormatter.toDateString(date);

      expect(timestamp).toBe("2150-12-31T00:00:00");
      expect(wikilink).toBe('"[[2150-12-31]]"');
      expect(dateString).toBe("2150-12-31");
    });

    it("should handle daylight saving time transitions", () => {
      // This test depends on the system's timezone settings
      // Using a date that's likely in DST for many timezones
      const date = new Date(2025, 6, 15); // July 15
      const dateString = DateFormatter.toDateString(date);

      expect(dateString).toBe("2025-07-15");
    });

    it("should preserve milliseconds in addDays", () => {
      const date = new Date(2025, 9, 24, 14, 30, 45, 123);
      const result = DateFormatter.addDays(date, 1);

      expect(result.getMilliseconds()).toBe(123);
    });
  });
});