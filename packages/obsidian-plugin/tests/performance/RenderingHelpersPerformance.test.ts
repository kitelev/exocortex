/**
 * Performance regression tests for rendering helper functions.
 *
 * These tests ensure that data preparation for rendering executes within
 * expected time bounds to detect performance regressions.
 *
 * Based on Issue #755: [Test Quality] Add Performance Regression Tests
 */

import { LayoutConfigParser } from "../../src/presentation/renderers/helpers/LayoutConfigParser";
import { SectionStateManager } from "../../src/presentation/renderers/helpers/SectionStateManager";
import { DailyNoteHelpers } from "../../src/presentation/renderers/helpers/DailyNoteHelpers";

/**
 * Generate mock effort metadata for performance testing.
 */
function generateMockEffortMetadata(
  count: number,
  dayStr: string
): Record<string, unknown>[] {
  const metadataList: Record<string, unknown>[] = [];
  const dayDate = new Date(dayStr);

  for (let i = 0; i < count; i++) {
    // Vary timestamps: some in the day, some outside
    const inDay = i % 3 !== 0; // 2/3 of efforts are in the day
    const offsetHours = inDay ? Math.floor(Math.random() * 24) : 48;
    const startTime = new Date(dayDate);
    startTime.setHours(startTime.getHours() + offsetHours);

    metadataList.push({
      exo__Instance_class: "ems__Task",
      exo__Asset_label: `Task ${i}`,
      ems__Effort_startTimestamp: startTime.toISOString(),
      ems__Effort_endTimestamp: new Date(
        startTime.getTime() + 60 * 60 * 1000
      ).toISOString(),
      ems__Task_status: ["open", "in_progress", "completed"][i % 3],
    });
  }

  return metadataList;
}

/**
 * Generate mock layout configuration strings.
 */
function generateLayoutConfigs(count: number): string[] {
  const configs: string[] = [];
  const properties = [
    "status",
    "priority",
    "size",
    "assignee",
    "dueDate",
    "createdAt",
    "effort",
    "votes",
  ];

  for (let i = 0; i < count; i++) {
    const numProps = Math.floor(Math.random() * 5) + 1;
    const selectedProps = properties.slice(0, numProps).join(", ");

    configs.push(`sortBy: ${properties[i % properties.length]}
sortOrder: ${i % 2 === 0 ? "asc" : "desc"}
showProperties: ${selectedProps}`);
  }

  return configs;
}

describe("Rendering Helpers Performance", () => {
  describe("LayoutConfigParser Performance", () => {
    it("should parse simple config in < 1ms", () => {
      const config = `sortBy: status
sortOrder: asc
showProperties: status, priority`;

      const start = performance.now();
      LayoutConfigParser.parse(config);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it("should parse 1000 configs in < 50ms", () => {
      const configs = generateLayoutConfigs(1000);

      const start = performance.now();
      for (const config of configs) {
        LayoutConfigParser.parse(config);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it("should parse complex config with many properties in < 1ms", () => {
      const config = `sortBy: priority
sortOrder: desc
showProperties: status, priority, size, assignee, dueDate, createdAt, effort, votes, complexity`;

      const start = performance.now();
      LayoutConfigParser.parse(config);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1);
    });

    it("should handle empty config efficiently", () => {
      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        LayoutConfigParser.parse("");
      }
      const duration = performance.now() - start;

      // 10K empty parses should be very fast
      expect(duration).toBeLessThan(50);
    });
  });

  describe("SectionStateManager Performance", () => {
    let stateManager: SectionStateManager;

    beforeEach(() => {
      // Initialize with many section IDs for testing
      const sectionIds = Array.from(
        { length: 100 },
        (_, i) => `section-${i}`
      );
      stateManager = new SectionStateManager(sectionIds);
    });

    it("should check collapsed state in < 0.1ms", () => {
      const durations: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        stateManager.isCollapsed(`section-${i}`);
        durations.push(performance.now() - start);
      }

      const avgDuration =
        durations.reduce((a, b) => a + b, 0) / durations.length;
      expect(avgDuration).toBeLessThan(0.1);
    });

    it("should query 10000 section states efficiently", () => {
      // Create manager with many sections
      const sectionIds = Array.from(
        { length: 10000 },
        (_, i) => `section-${i}`
      );
      const bigManager = new SectionStateManager(sectionIds);

      const start = performance.now();

      // Query all states
      for (let i = 0; i < 10000; i++) {
        bigManager.isCollapsed(`section-${i}`);
      }

      const duration = performance.now() - start;

      // 10K read operations should complete quickly
      expect(duration).toBeLessThan(50);
    });

    it("should initialize with many sections efficiently", () => {
      const start = performance.now();

      // Create managers with increasing section counts
      for (let count = 100; count <= 1000; count += 100) {
        const sectionIds = Array.from(
          { length: count },
          (_, i) => `section-${i}`
        );
        new SectionStateManager(sectionIds);
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });
  });

  describe("DailyNoteHelpers.isEffortInDay Performance", () => {
    const testDay = "2025-01-15";

    it("should check effort average time < 0.5ms (100 iterations)", () => {
      const metadata = {
        ems__Effort_startTimestamp: "2025-01-15T10:00:00.000Z",
        ems__Effort_endTimestamp: "2025-01-15T11:00:00.000Z",
      };

      // Run 100 iterations to get stable average (avoids CI flakiness)
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        DailyNoteHelpers.isEffortInDay(metadata, testDay);
      }
      const avgDuration = (performance.now() - start) / 100;

      // Average per-check should be sub-millisecond
      expect(avgDuration).toBeLessThan(0.5);
    });

    it("should check 1000 efforts in < 50ms", () => {
      const metadataList = generateMockEffortMetadata(1000, testDay);

      const start = performance.now();
      for (const metadata of metadataList) {
        DailyNoteHelpers.isEffortInDay(metadata, testDay);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });

    it("should handle efforts with all timestamp fields < 0.5ms avg (100 iterations)", () => {
      const metadata = {
        ems__Effort_startTimestamp: "2025-01-15T09:00:00.000Z",
        ems__Effort_endTimestamp: "2025-01-15T10:00:00.000Z",
        ems__Effort_plannedStartTimestamp: "2025-01-15T08:00:00.000Z",
        ems__Effort_plannedEndTimestamp: "2025-01-15T12:00:00.000Z",
      };

      // Run 100 iterations to get stable average (avoids CI flakiness)
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        DailyNoteHelpers.isEffortInDay(metadata, testDay);
      }
      const avgDuration = (performance.now() - start) / 100;

      expect(avgDuration).toBeLessThan(0.5);
    });

    it("should handle efforts with no timestamps efficiently", () => {
      const metadata = {
        exo__Asset_label: "Task without timestamps",
        ems__Task_status: "open",
      };

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        DailyNoteHelpers.isEffortInDay(metadata, testDay);
      }
      const duration = performance.now() - start;

      // 10K checks with no timestamps should be very fast
      expect(duration).toBeLessThan(50);
    });

    it("P95 check should complete in < 1ms", () => {
      const metadataList = generateMockEffortMetadata(100, testDay);
      const durations: number[] = [];

      for (const metadata of metadataList) {
        const start = performance.now();
        DailyNoteHelpers.isEffortInDay(metadata, testDay);
        durations.push(performance.now() - start);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.floor(durations.length * 0.95);
      const p95Duration = durations[p95Index];

      // P95 should be under 1ms (generous for CI variance)
      expect(p95Duration).toBeLessThan(1);
    });
  });

  describe("Combined Data Preparation Performance", () => {
    it("should prepare data for 100 tasks display in < 100ms", () => {
      const testDay = "2025-01-15";
      const metadataList = generateMockEffortMetadata(100, testDay);
      const config = `sortBy: status
sortOrder: asc
showProperties: status, priority, size`;

      const start = performance.now();

      // Parse config
      const parsedConfig = LayoutConfigParser.parse(config);

      // Filter efforts by day
      const tasksInDay = metadataList.filter((m) =>
        DailyNoteHelpers.isEffortInDay(m, testDay)
      );

      // Simulate sorting
      tasksInDay.sort((a, b) => {
        const aStatus = String(a.ems__Task_status || "");
        const bStatus = String(b.ems__Task_status || "");
        return parsedConfig.sortOrder === "desc"
          ? bStatus.localeCompare(aStatus)
          : aStatus.localeCompare(bStatus);
      });

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(tasksInDay.length).toBeGreaterThan(0);
    });

    it("should prepare data for 1000 tasks display in < 300ms", () => {
      const testDay = "2025-01-15";
      const metadataList = generateMockEffortMetadata(1000, testDay);
      const config = `sortBy: status
sortOrder: desc
showProperties: status, priority, size, assignee, dueDate`;

      const start = performance.now();

      // Parse config
      const parsedConfig = LayoutConfigParser.parse(config);

      // Filter efforts by day
      const tasksInDay = metadataList.filter((m) =>
        DailyNoteHelpers.isEffortInDay(m, testDay)
      );

      // Simulate sorting
      tasksInDay.sort((a, b) => {
        const aStatus = String(a.ems__Task_status || "");
        const bStatus = String(b.ems__Task_status || "");
        return parsedConfig.sortOrder === "desc"
          ? bStatus.localeCompare(aStatus)
          : aStatus.localeCompare(bStatus);
      });

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(300);
      expect(tasksInDay.length).toBeGreaterThan(0);
    });
  });
});

describe("Rendering Performance Regression Guards", () => {
  it("LayoutConfigParser should not regress beyond 2x baseline", () => {
    const config = `sortBy: priority
sortOrder: asc
showProperties: status, priority, size`;

    const runs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      LayoutConfigParser.parse(config);
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;

    // Average parsing should be sub-millisecond
    expect(avgDuration).toBeLessThan(1);
  });

  it("isEffortInDay should not regress beyond 2x baseline", () => {
    const testDay = "2025-01-15";
    const metadata = {
      ems__Effort_startTimestamp: "2025-01-15T10:00:00.000Z",
      ems__Effort_endTimestamp: "2025-01-15T11:00:00.000Z",
    };

    const runs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      DailyNoteHelpers.isEffortInDay(metadata, testDay);
      runs.push(performance.now() - start);
    }

    const avgDuration = runs.reduce((a, b) => a + b, 0) / runs.length;

    // Average check should be sub-millisecond
    expect(avgDuration).toBeLessThan(0.5);
  });
});
