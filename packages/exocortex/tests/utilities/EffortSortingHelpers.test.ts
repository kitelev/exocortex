import { EffortSortingHelpers } from "../../src/utilities/EffortSortingHelpers";

describe("EffortSortingHelpers", () => {
  describe("getTimeFromTimestamp", () => {
    it("should return 00:00:00 for null timestamp", () => {
      expect(EffortSortingHelpers.getTimeFromTimestamp(null)).toBe("00:00:00");
    });

    it("should return 00:00:00 for undefined timestamp", () => {
      expect(EffortSortingHelpers.getTimeFromTimestamp(undefined as unknown as null)).toBe("00:00:00");
    });

    it("should return 00:00:00 for invalid timestamp string", () => {
      expect(EffortSortingHelpers.getTimeFromTimestamp("invalid")).toBe("00:00:00");
    });

    it("should extract time from ISO timestamp string", () => {
      expect(EffortSortingHelpers.getTimeFromTimestamp("2025-01-15T09:30:00")).toBe("09:30:00");
    });

    it("should extract time from Unix timestamp number", () => {
      // 2025-01-15 14:30:00 UTC
      const timestamp = new Date("2025-01-15T14:30:00Z").getTime();
      const result = EffortSortingHelpers.getTimeFromTimestamp(timestamp);
      // The result depends on local timezone, so we just verify format
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("should handle midnight timestamp (00:00:00)", () => {
      expect(EffortSortingHelpers.getTimeFromTimestamp("2025-01-15T00:00:00")).toBe("00:00:00");
    });
  });

  describe("sortByStartTime", () => {
    it("should put tasks with specific time before tasks without time", () => {
      const taskWithTime = { startTimestamp: "2025-01-15T09:00:00" };
      const taskWithoutTime = { startTimestamp: "2025-01-15T00:00:00" };

      expect(EffortSortingHelpers.sortByStartTime(taskWithTime, taskWithoutTime)).toBe(-1);
      expect(EffortSortingHelpers.sortByStartTime(taskWithoutTime, taskWithTime)).toBe(1);
    });

    it("should sort tasks with time in ascending order", () => {
      const morningTask = { startTimestamp: "2025-01-15T09:00:00" };
      const afternoonTask = { startTimestamp: "2025-01-15T14:30:00" };
      const eveningTask = { startTimestamp: "2025-01-15T18:00:00" };

      expect(EffortSortingHelpers.sortByStartTime(morningTask, afternoonTask)).toBeLessThan(0);
      expect(EffortSortingHelpers.sortByStartTime(afternoonTask, eveningTask)).toBeLessThan(0);
      expect(EffortSortingHelpers.sortByStartTime(eveningTask, morningTask)).toBeGreaterThan(0);
    });

    it("should keep relative order for tasks both without time", () => {
      const taskA = { startTimestamp: "2025-01-15T00:00:00" };
      const taskB = { startTimestamp: "2025-01-16T00:00:00" };

      // Both are 00:00:00, so they compare equal (order preserved)
      expect(EffortSortingHelpers.sortByStartTime(taskA, taskB)).toBe(0);
    });

    it("should treat null timestamp as 00:00:00 (no specific time)", () => {
      const taskWithTime = { startTimestamp: "2025-01-15T09:00:00" };
      const taskWithNull = { startTimestamp: null };

      expect(EffortSortingHelpers.sortByStartTime(taskWithTime, taskWithNull)).toBe(-1);
      expect(EffortSortingHelpers.sortByStartTime(taskWithNull, taskWithTime)).toBe(1);
    });

    it("should sort full task list correctly", () => {
      const tasks = [
        { startTimestamp: null, name: "No time 1" },
        { startTimestamp: "2025-01-15T14:30:00", name: "Afternoon" },
        { startTimestamp: "2025-01-15T00:00:00", name: "No time 2" },
        { startTimestamp: "2025-01-15T09:00:00", name: "Morning" },
      ];

      const sorted = [...tasks].sort((a, b) => EffortSortingHelpers.sortByStartTime(a, b));

      expect(sorted.map(t => t.name)).toEqual([
        "Morning",      // 09:00
        "Afternoon",    // 14:30
        "No time 1",    // null -> 00:00:00
        "No time 2",    // 00:00:00
      ]);
    });
  });

  describe("sortByPriority", () => {
    it("should prioritize non-trashed over trashed", () => {
      const a = { isTrashed: false, isDone: false, metadata: {} };
      const b = { isTrashed: true, isDone: false, metadata: {} };
      expect(EffortSortingHelpers.sortByPriority(a, b)).toBe(-1);
      expect(EffortSortingHelpers.sortByPriority(b, a)).toBe(1);
    });

    it("should prioritize not done over done", () => {
      const a = { isTrashed: false, isDone: false, metadata: {} };
      const b = { isTrashed: false, isDone: true, metadata: {} };
      expect(EffortSortingHelpers.sortByPriority(a, b)).toBe(-1);
      expect(EffortSortingHelpers.sortByPriority(b, a)).toBe(1);
    });

    it("should sort by votes (descending)", () => {
      const a = { isTrashed: false, isDone: false, metadata: { ems__Effort_votes: 5 } };
      const b = { isTrashed: false, isDone: false, metadata: { ems__Effort_votes: 10 } };
      expect(EffortSortingHelpers.sortByPriority(a, b)).toBe(5);
      expect(EffortSortingHelpers.sortByPriority(b, a)).toBe(-5);
    });

    it("should handle missing votes as zero", () => {
      const a = { isTrashed: false, isDone: false, metadata: {} };
      const b = { isTrashed: false, isDone: false, metadata: { ems__Effort_votes: 3 } };
      expect(EffortSortingHelpers.sortByPriority(a, b)).toBe(3);
    });

    it("should sort by startTime if votes equal", () => {
      const a = { isTrashed: false, isDone: false, metadata: {}, startTime: "2025-01-15" };
      const b = { isTrashed: false, isDone: false, metadata: {}, startTime: "2025-01-20" };
      expect(EffortSortingHelpers.sortByPriority(a, b)).toBeLessThan(0);
    });

    it("should prioritize items with startTime over those without", () => {
      const a = { isTrashed: false, isDone: false, metadata: {}, startTime: "2025-01-15" };
      const b = { isTrashed: false, isDone: false, metadata: {} };
      expect(EffortSortingHelpers.sortByPriority(a, b)).toBe(-1);
      expect(EffortSortingHelpers.sortByPriority(b, a)).toBe(1);
    });
  });
});
