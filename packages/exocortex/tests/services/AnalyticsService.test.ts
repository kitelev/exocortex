import "reflect-metadata";
import { AnalyticsService } from "../../src/services/AnalyticsService";
import type { IVaultAdapter, IFile } from "../../src/interfaces/IVaultAdapter";
import { container } from "tsyringe";
import { DI_TOKENS } from "../../src/interfaces/tokens";

describe("AnalyticsService", () => {
  let analyticsService: AnalyticsService;
  let mockVault: jest.Mocked<IVaultAdapter>;

  const createMockFile = (path: string): IFile => ({
    path,
    basename: path.split("/").pop()?.replace(".md", "") || "",
    name: path.split("/").pop() || "",
    stat: { ctime: Date.now(), mtime: Date.now() },
    parent: null,
  });

  const createEffortContent = (options: {
    label: string;
    status?: string;
    startTimestamp?: string;
    endTimestamp?: string;
    prototypeUri?: string;
    instanceClass?: string;
  }): string => {
    const lines = ["---"];
    lines.push(`exo__Asset_label: "${options.label}"`);

    if (options.status) {
      lines.push(`ems__Effort_status: "[[${options.status}]]"`);
    }
    if (options.startTimestamp) {
      lines.push(`ems__Effort_startTimestamp: ${options.startTimestamp}`);
    }
    if (options.endTimestamp) {
      lines.push(`ems__Effort_endTimestamp: ${options.endTimestamp}`);
    }
    if (options.prototypeUri) {
      lines.push(`exo__Asset_prototype: "[[${options.prototypeUri}]]"`);
    }
    if (options.instanceClass) {
      lines.push(`exo__Instance_class: "[[${options.instanceClass}]]"`);
    }

    lines.push("---");
    lines.push("");
    lines.push("Content here");

    return lines.join("\n");
  };

  beforeEach(() => {
    container.clearInstances();

    mockVault = {
      read: jest.fn(),
      modify: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
      createFolder: jest.fn(),
      getAllFiles: jest.fn(),
      getAbstractFileByPath: jest.fn(),
      getFirstLinkpathDest: jest.fn(),
      getFrontmatter: jest.fn(),
      setFrontmatter: jest.fn(),
      exists: jest.fn(),
      trash: jest.fn(),
    } as unknown as jest.Mocked<IVaultAdapter>;

    container.registerInstance(DI_TOKENS.IVaultAdapter, mockVault);

    analyticsService = container.resolve(AnalyticsService);
  });

  describe("getDefaultPeriod", () => {
    it("should return a period spanning the last 30 days", () => {
      const period = analyticsService.getDefaultPeriod();

      expect(period.startDate).toBeInstanceOf(Date);
      expect(period.endDate).toBeInstanceOf(Date);

      const diffDays = Math.round(
        (period.endDate.getTime() - period.startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(diffDays).toBe(30);
    });
  });

  describe("calculateDurationStats", () => {
    it("should calculate correct statistics for duration data", () => {
      const efforts = [
        {
          path: "/test/1.md",
          label: "Test 1",
          status: null,
          startTimestamp: new Date("2025-01-01T22:00:00"),
          endTimestamp: new Date("2025-01-02T06:00:00"), // 8 hours
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/2.md",
          label: "Test 2",
          status: null,
          startTimestamp: new Date("2025-01-02T23:00:00"),
          endTimestamp: new Date("2025-01-03T07:00:00"), // 8 hours
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/3.md",
          label: "Test 3",
          status: null,
          startTimestamp: new Date("2025-01-03T22:30:00"),
          endTimestamp: new Date("2025-01-04T06:30:00"), // 8 hours
          prototypeUri: null,
          instanceClass: null,
        },
      ];

      const stats = analyticsService.calculateDurationStats(efforts);

      expect(stats.count).toBe(3);
      expect(stats.averageMinutes).toBe(480); // 8 hours in minutes
      expect(stats.minMinutes).toBe(480);
      expect(stats.maxMinutes).toBe(480);
      expect(stats.stdDevMinutes).toBe(0);
    });

    it("should handle empty effort array", () => {
      const stats = analyticsService.calculateDurationStats([]);

      expect(stats.count).toBe(0);
      expect(stats.averageMinutes).toBe(0);
      expect(stats.totalMinutes).toBe(0);
    });

    it("should calculate standard deviation correctly", () => {
      const efforts = [
        {
          path: "/test/1.md",
          label: "Test 1",
          status: null,
          startTimestamp: new Date("2025-01-01T22:00:00"),
          endTimestamp: new Date("2025-01-02T04:00:00"), // 6 hours (360 min)
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/2.md",
          label: "Test 2",
          status: null,
          startTimestamp: new Date("2025-01-02T22:00:00"),
          endTimestamp: new Date("2025-01-03T08:00:00"), // 10 hours (600 min)
          prototypeUri: null,
          instanceClass: null,
        },
      ];

      const stats = analyticsService.calculateDurationStats(efforts);

      expect(stats.count).toBe(2);
      expect(stats.averageMinutes).toBe(480); // (360 + 600) / 2
      expect(stats.minMinutes).toBe(360);
      expect(stats.maxMinutes).toBe(600);
      // Std dev: sqrt(((360-480)^2 + (600-480)^2) / 2) = sqrt(14400) = 120
      expect(stats.stdDevMinutes).toBe(120);
    });
  });

  describe("calculateDailyAggregates", () => {
    it("should group efforts by date correctly", () => {
      const efforts = [
        {
          path: "/test/1.md",
          label: "Test 1",
          status: null,
          startTimestamp: new Date("2025-01-01T10:00:00"),
          endTimestamp: new Date("2025-01-01T11:00:00"), // 60 min
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/2.md",
          label: "Test 2",
          status: null,
          startTimestamp: new Date("2025-01-01T14:00:00"),
          endTimestamp: new Date("2025-01-01T15:30:00"), // 90 min
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/3.md",
          label: "Test 3",
          status: null,
          startTimestamp: new Date("2025-01-02T09:00:00"),
          endTimestamp: new Date("2025-01-02T10:00:00"), // 60 min
          prototypeUri: null,
          instanceClass: null,
        },
      ];

      const aggregates = analyticsService.calculateDailyAggregates(efforts);

      expect(aggregates).toHaveLength(2);

      const day1 = aggregates.find((a) => a.date === "2025-01-01");
      expect(day1).toBeDefined();
      expect(day1!.count).toBe(2);
      expect(day1!.totalMinutes).toBe(150);
      expect(day1!.averageMinutes).toBe(75);

      const day2 = aggregates.find((a) => a.date === "2025-01-02");
      expect(day2).toBeDefined();
      expect(day2!.count).toBe(1);
      expect(day2!.totalMinutes).toBe(60);
    });

    it("should return sorted results by date", () => {
      const efforts = [
        {
          path: "/test/2.md",
          label: "Test 2",
          status: null,
          startTimestamp: new Date("2025-01-05T10:00:00"),
          endTimestamp: new Date("2025-01-05T11:00:00"),
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/1.md",
          label: "Test 1",
          status: null,
          startTimestamp: new Date("2025-01-01T10:00:00"),
          endTimestamp: new Date("2025-01-01T11:00:00"),
          prototypeUri: null,
          instanceClass: null,
        },
      ];

      const aggregates = analyticsService.calculateDailyAggregates(efforts);

      expect(aggregates[0].date).toBe("2025-01-01");
      expect(aggregates[1].date).toBe("2025-01-05");
    });
  });

  describe("calculateHourlyDistribution", () => {
    it("should calculate correct hourly distribution", () => {
      const efforts = [
        {
          path: "/test/1.md",
          label: "Test 1",
          status: null,
          startTimestamp: new Date("2025-01-01T09:00:00"),
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/2.md",
          label: "Test 2",
          status: null,
          startTimestamp: new Date("2025-01-02T09:30:00"),
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/3.md",
          label: "Test 3",
          status: null,
          startTimestamp: new Date("2025-01-03T14:00:00"),
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
      ];

      const distribution = analyticsService.calculateHourlyDistribution(efforts);

      expect(distribution).toHaveLength(24);
      expect(distribution[9].count).toBe(2); // 9:00 and 9:30
      expect(distribution[9].percentage).toBeCloseTo(66.7, 0);
      expect(distribution[14].count).toBe(1);
      expect(distribution[14].percentage).toBeCloseTo(33.3, 0);
    });
  });

  describe("calculateWeekdayDistribution", () => {
    it("should calculate correct weekday distribution", () => {
      // Create efforts on known days
      const efforts = [
        {
          path: "/test/1.md",
          label: "Test 1",
          status: null,
          startTimestamp: new Date("2025-01-06T10:00:00"), // Monday
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/2.md",
          label: "Test 2",
          status: null,
          startTimestamp: new Date("2025-01-07T10:00:00"), // Tuesday
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/3.md",
          label: "Test 3",
          status: null,
          startTimestamp: new Date("2025-01-08T10:00:00"), // Wednesday
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
        {
          path: "/test/4.md",
          label: "Test 4",
          status: null,
          startTimestamp: new Date("2025-01-13T10:00:00"), // Monday again
          endTimestamp: null,
          prototypeUri: null,
          instanceClass: null,
        },
      ];

      const distribution = analyticsService.calculateWeekdayDistribution(efforts);

      expect(distribution).toHaveLength(7);

      const monday = distribution.find((d) => d.dayName === "Monday");
      expect(monday).toBeDefined();
      expect(monday!.count).toBe(2);
      expect(monday!.percentage).toBe(50);

      const tuesday = distribution.find((d) => d.dayName === "Tuesday");
      expect(tuesday!.count).toBe(1);
    });
  });

  describe("getEffortsInPeriod", () => {
    it("should filter efforts by time period", async () => {
      const file1 = createMockFile("/test/task1.md");
      const file2 = createMockFile("/test/task2.md");
      const file3 = createMockFile("/test/task3.md");

      mockVault.getAllFiles.mockReturnValue([file1, file2, file3]);

      mockVault.read
        .mockResolvedValueOnce(
          createEffortContent({
            label: "Task 1",
            startTimestamp: "2025-01-15T10:00:00",
            endTimestamp: "2025-01-15T11:00:00",
          })
        )
        .mockResolvedValueOnce(
          createEffortContent({
            label: "Task 2",
            startTimestamp: "2025-01-05T10:00:00", // Outside period
            endTimestamp: "2025-01-05T11:00:00",
          })
        )
        .mockResolvedValueOnce(
          createEffortContent({
            label: "Task 3",
            startTimestamp: "2025-01-20T10:00:00",
            endTimestamp: "2025-01-20T11:00:00",
          })
        );

      const period = {
        startDate: new Date("2025-01-10T00:00:00"),
        endDate: new Date("2025-01-25T23:59:59"),
      };

      const efforts = await analyticsService.getEffortsInPeriod(period);

      expect(efforts).toHaveLength(2);
      expect(efforts.map((e) => e.label)).toContain("Task 1");
      expect(efforts.map((e) => e.label)).toContain("Task 3");
    });

    it("should filter by label contains", async () => {
      const file1 = createMockFile("/test/sleep1.md");
      const file2 = createMockFile("/test/task1.md");

      mockVault.getAllFiles.mockReturnValue([file1, file2]);

      mockVault.read
        .mockResolvedValueOnce(
          createEffortContent({
            label: "Поспать 2025-01-15",
            startTimestamp: "2025-01-15T23:00:00",
            endTimestamp: "2025-01-16T07:00:00",
          })
        )
        .mockResolvedValueOnce(
          createEffortContent({
            label: "Regular Task",
            startTimestamp: "2025-01-15T10:00:00",
            endTimestamp: "2025-01-15T11:00:00",
          })
        );

      const period = {
        startDate: new Date("2025-01-10T00:00:00"),
        endDate: new Date("2025-01-20T23:59:59"),
      };

      const efforts = await analyticsService.getEffortsInPeriod(period, {
        labelContains: "Поспать",
      });

      expect(efforts).toHaveLength(1);
      expect(efforts[0].label).toBe("Поспать 2025-01-15");
    });
  });
});
