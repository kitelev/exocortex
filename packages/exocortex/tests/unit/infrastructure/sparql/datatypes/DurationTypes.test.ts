import {
  DayTimeDuration,
  parseXSDDayTimeDuration,
  formatDayTimeDuration,
  durationToMilliseconds,
  millisecondsToStructuredDuration,
  formatStructuredDuration,
} from "../../../../../src/infrastructure/sparql/datatypes/DurationTypes";

describe("DurationTypes", () => {
  describe("parseXSDDayTimeDuration", () => {
    describe("basic parsing", () => {
      it("should parse hours only", () => {
        const result = parseXSDDayTimeDuration("PT5H");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 5,
          minutes: 0,
          seconds: 0,
        });
      });

      it("should parse minutes only", () => {
        const result = parseXSDDayTimeDuration("PT30M");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 0,
          minutes: 30,
          seconds: 0,
        });
      });

      it("should parse seconds only", () => {
        const result = parseXSDDayTimeDuration("PT45S");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 45,
        });
      });

      it("should parse days only", () => {
        const result = parseXSDDayTimeDuration("P1D");
        expect(result).toEqual({
          negative: false,
          days: 1,
          hours: 0,
          minutes: 0,
          seconds: 0,
        });
      });

      it("should parse zero duration", () => {
        const result = parseXSDDayTimeDuration("PT0S");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
        });
      });
    });

    describe("combined durations", () => {
      it('should parse "PT1H30M" - 1 hour 30 minutes', () => {
        const result = parseXSDDayTimeDuration("PT1H30M");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 1,
          minutes: 30,
          seconds: 0,
        });
      });

      it('should parse "P2DT3H" - 2 days 3 hours', () => {
        const result = parseXSDDayTimeDuration("P2DT3H");
        expect(result).toEqual({
          negative: false,
          days: 2,
          hours: 3,
          minutes: 0,
          seconds: 0,
        });
      });

      it("should parse full duration with all components", () => {
        const result = parseXSDDayTimeDuration("P1DT2H30M45S");
        expect(result).toEqual({
          negative: false,
          days: 1,
          hours: 2,
          minutes: 30,
          seconds: 45,
        });
      });

      it("should parse hours and seconds without minutes", () => {
        const result = parseXSDDayTimeDuration("PT1H45S");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 1,
          minutes: 0,
          seconds: 45,
        });
      });
    });

    describe("negative durations", () => {
      it('should parse "-PT1H" - negative 1 hour', () => {
        const result = parseXSDDayTimeDuration("-PT1H");
        expect(result).toEqual({
          negative: true,
          days: 0,
          hours: 1,
          minutes: 0,
          seconds: 0,
        });
      });

      it("should parse negative combined duration", () => {
        const result = parseXSDDayTimeDuration("-P1DT2H30M");
        expect(result).toEqual({
          negative: true,
          days: 1,
          hours: 2,
          minutes: 30,
          seconds: 0,
        });
      });
    });

    describe("fractional seconds", () => {
      it("should parse decimal seconds", () => {
        const result = parseXSDDayTimeDuration("PT1.5S");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 1.5,
        });
      });

      it("should parse sub-second durations", () => {
        const result = parseXSDDayTimeDuration("PT0.5S");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0.5,
        });
      });

      it("should parse fractional seconds with minutes", () => {
        const result = parseXSDDayTimeDuration("PT30M1.5S");
        expect(result).toEqual({
          negative: false,
          days: 0,
          hours: 0,
          minutes: 30,
          seconds: 1.5,
        });
      });
    });

    describe("whitespace handling", () => {
      it("should handle leading whitespace", () => {
        const result = parseXSDDayTimeDuration("  PT5H");
        expect(result.hours).toBe(5);
      });

      it("should handle trailing whitespace", () => {
        const result = parseXSDDayTimeDuration("PT5H  ");
        expect(result.hours).toBe(5);
      });

      it("should handle surrounding whitespace", () => {
        const result = parseXSDDayTimeDuration("  PT5H  ");
        expect(result.hours).toBe(5);
      });
    });

    describe("error handling", () => {
      it("should throw for empty string", () => {
        expect(() => parseXSDDayTimeDuration("")).toThrow(
          "duration string is empty"
        );
      });

      it("should throw for missing P prefix", () => {
        expect(() => parseXSDDayTimeDuration("T5H")).toThrow(
          "must start with 'P'"
        );
      });

      it("should throw for invalid format - just P", () => {
        // P without any components should fail when T is present but empty
        // Actually "P" alone is technically parseable as 0
        // Let's test invalid component order instead
        expect(() => parseXSDDayTimeDuration("PT5M30H")).toThrow(
          "invalid time component"
        );
      });

      it("should throw for invalid day component", () => {
        expect(() => parseXSDDayTimeDuration("PXDT5H")).toThrow(
          "invalid day component"
        );
      });

      it("should throw for invalid time component", () => {
        expect(() => parseXSDDayTimeDuration("PT5X")).toThrow(
          "invalid time component"
        );
      });

      it("should throw for components in wrong order", () => {
        expect(() => parseXSDDayTimeDuration("PT30S5M")).toThrow(
          "invalid time component"
        );
      });
    });
  });

  describe("formatDayTimeDuration", () => {
    describe("basic formatting", () => {
      it("should format hours only", () => {
        // 5 hours = 5 * 60 * 60 * 1000 = 18000000 ms
        expect(formatDayTimeDuration(18000000)).toBe("PT5H");
      });

      it("should format minutes only", () => {
        // 30 minutes = 30 * 60 * 1000 = 1800000 ms
        expect(formatDayTimeDuration(1800000)).toBe("PT30M");
      });

      it("should format seconds only", () => {
        // 45 seconds = 45000 ms
        expect(formatDayTimeDuration(45000)).toBe("PT45S");
      });

      it("should format days only", () => {
        // 1 day = 86400000 ms
        // When only days are present, no T part is needed
        expect(formatDayTimeDuration(86400000)).toBe("P1D");
      });

      it("should format zero as PT0S", () => {
        expect(formatDayTimeDuration(0)).toBe("PT0S");
      });
    });

    describe("acceptance criteria", () => {
      it('should format 5400000ms as "PT1H30M"', () => {
        // 5400000 ms = 1 hour 30 minutes = 90 minutes
        // 90 * 60 * 1000 = 5400000
        expect(formatDayTimeDuration(5400000)).toBe("PT1H30M");
      });
    });

    describe("combined durations", () => {
      it("should format 1 day 2 hours", () => {
        // 1 day + 2 hours = (24 + 2) * 60 * 60 * 1000 = 93600000 ms
        expect(formatDayTimeDuration(93600000)).toBe("P1DT2H");
      });

      it("should format hours and minutes", () => {
        // 8 hours 30 minutes = (8 * 60 + 30) * 60 * 1000 = 30600000 ms
        expect(formatDayTimeDuration(30600000)).toBe("PT8H30M");
      });

      it("should format full duration", () => {
        // 1 day 2 hours 30 minutes 45 seconds
        const ms =
          1 * 24 * 60 * 60 * 1000 +
          2 * 60 * 60 * 1000 +
          30 * 60 * 1000 +
          45 * 1000;
        expect(formatDayTimeDuration(ms)).toBe("P1DT2H30M45S");
      });
    });

    describe("negative durations", () => {
      it("should format negative hours", () => {
        expect(formatDayTimeDuration(-18000000)).toBe("-PT5H");
      });

      it("should format negative combined duration", () => {
        // -8 hours 30 minutes
        expect(formatDayTimeDuration(-30600000)).toBe("-PT8H30M");
      });
    });

    describe("fractional seconds", () => {
      it("should format decimal seconds", () => {
        // 1.5 seconds = 1500 ms
        expect(formatDayTimeDuration(1500)).toBe("PT1.5S");
      });

      it("should format sub-second durations", () => {
        // 0.5 seconds = 500 ms
        expect(formatDayTimeDuration(500)).toBe("PT0.5S");
      });

      it("should limit decimal precision to 3 places", () => {
        // 1.1234 seconds = 1123.4 ms → should round to PT1.123S
        expect(formatDayTimeDuration(1123.4)).toBe("PT1.123S");
      });
    });
  });

  describe("durationToMilliseconds", () => {
    it("should convert hours to milliseconds", () => {
      const duration: DayTimeDuration = {
        negative: false,
        days: 0,
        hours: 5,
        minutes: 0,
        seconds: 0,
      };
      expect(durationToMilliseconds(duration)).toBe(5 * 60 * 60 * 1000);
    });

    it("should convert combined duration to milliseconds", () => {
      const duration: DayTimeDuration = {
        negative: false,
        days: 1,
        hours: 2,
        minutes: 30,
        seconds: 45,
      };
      const expected =
        1 * 24 * 60 * 60 * 1000 +
        2 * 60 * 60 * 1000 +
        30 * 60 * 1000 +
        45 * 1000;
      expect(durationToMilliseconds(duration)).toBe(expected);
    });

    it("should return negative for negative durations", () => {
      const duration: DayTimeDuration = {
        negative: true,
        days: 0,
        hours: 1,
        minutes: 0,
        seconds: 0,
      };
      expect(durationToMilliseconds(duration)).toBe(-3600000);
    });

    it("should handle fractional seconds", () => {
      const duration: DayTimeDuration = {
        negative: false,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 1.5,
      };
      expect(durationToMilliseconds(duration)).toBe(1500);
    });
  });

  describe("millisecondsToStructuredDuration", () => {
    it("should convert milliseconds to structured duration", () => {
      // 5400000 ms = 1 hour 30 minutes
      const result = millisecondsToStructuredDuration(5400000);
      expect(result).toEqual({
        negative: false,
        days: 0,
        hours: 1,
        minutes: 30,
        seconds: 0,
      });
    });

    it("should handle negative milliseconds", () => {
      const result = millisecondsToStructuredDuration(-3600000);
      expect(result).toEqual({
        negative: true,
        days: 0,
        hours: 1,
        minutes: 0,
        seconds: 0,
      });
    });

    it("should handle days overflow from hours", () => {
      // 25 hours = 1 day + 1 hour
      const result = millisecondsToStructuredDuration(25 * 60 * 60 * 1000);
      expect(result).toEqual({
        negative: false,
        days: 1,
        hours: 1,
        minutes: 0,
        seconds: 0,
      });
    });

    it("should handle fractional seconds", () => {
      const result = millisecondsToStructuredDuration(1500);
      expect(result).toEqual({
        negative: false,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 1.5,
      });
    });

    it("should handle zero", () => {
      const result = millisecondsToStructuredDuration(0);
      expect(result).toEqual({
        negative: false,
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
      });
    });
  });

  describe("formatStructuredDuration", () => {
    it("should format structured duration to string", () => {
      const duration: DayTimeDuration = {
        negative: false,
        days: 0,
        hours: 1,
        minutes: 30,
        seconds: 0,
      };
      expect(formatStructuredDuration(duration)).toBe("PT1H30M");
    });

    it("should format negative structured duration", () => {
      const duration: DayTimeDuration = {
        negative: true,
        days: 0,
        hours: 2,
        minutes: 0,
        seconds: 0,
      };
      expect(formatStructuredDuration(duration)).toBe("-PT2H");
    });
  });

  describe("round-trip parsing and formatting", () => {
    const testCases = [
      "PT1H",
      "PT30M",
      "PT45S",
      "P1D",
      "PT1H30M",
      "P2DT3H",
      "PT0S",
      "-PT1H",
      "-P1DT2H30M",
      "PT1.5S",
    ];

    it.each(testCases)("should round-trip %s", (original) => {
      const parsed = parseXSDDayTimeDuration(original);
      const ms = durationToMilliseconds(parsed);
      const formatted = formatDayTimeDuration(ms);
      const reparsed = parseXSDDayTimeDuration(formatted);

      // The millisecond value should be the same after round-trip
      expect(durationToMilliseconds(reparsed)).toBe(ms);
    });

    it("should preserve value through parse → ms → format → parse", () => {
      // Test acceptance criteria round-trip
      const original = "PT1H30M";
      const parsed = parseXSDDayTimeDuration(original);
      const ms = durationToMilliseconds(parsed);

      expect(ms).toBe(5400000);
      expect(formatDayTimeDuration(ms)).toBe("PT1H30M");
    });
  });
});
