import "reflect-metadata";
import { TrendDetectionService } from "../../src/services/TrendDetectionService";
import type { DailyAggregate, DurationStats } from "../../src/services/AnalyticsService";

describe("TrendDetectionService", () => {
  let trendService: TrendDetectionService;

  beforeEach(() => {
    trendService = new TrendDetectionService();
  });

  describe("analyzeTrend", () => {
    it("should detect increasing trend", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 1, totalMinutes: 60, averageMinutes: 60 },
        { date: "2025-01-02", count: 2, totalMinutes: 120, averageMinutes: 60 },
        { date: "2025-01-03", count: 3, totalMinutes: 180, averageMinutes: 60 },
        { date: "2025-01-04", count: 4, totalMinutes: 240, averageMinutes: 60 },
        { date: "2025-01-05", count: 5, totalMinutes: 300, averageMinutes: 60 },
      ];

      const trend = trendService.analyzeTrend(data, "count");

      expect(trend.direction).toBe("increasing");
      expect(trend.slope).toBeGreaterThan(0);
      expect(trend.changePercentage).toBeGreaterThan(0);
    });

    it("should detect decreasing trend", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-02", count: 8, totalMinutes: 480, averageMinutes: 60 },
        { date: "2025-01-03", count: 6, totalMinutes: 360, averageMinutes: 60 },
        { date: "2025-01-04", count: 4, totalMinutes: 240, averageMinutes: 60 },
        { date: "2025-01-05", count: 2, totalMinutes: 120, averageMinutes: 60 },
      ];

      const trend = trendService.analyzeTrend(data, "count");

      expect(trend.direction).toBe("decreasing");
      expect(trend.slope).toBeLessThan(0);
      expect(trend.changePercentage).toBeLessThan(0);
    });

    it("should detect stable trend", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-02", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-03", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-04", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-05", count: 5, totalMinutes: 300, averageMinutes: 60 },
      ];

      const trend = trendService.analyzeTrend(data, "count");

      expect(trend.direction).toBe("stable");
      expect(Math.abs(trend.slope)).toBeLessThan(0.01);
    });

    it("should handle insufficient data", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-02", count: 6, totalMinutes: 360, averageMinutes: 60 },
      ];

      const trend = trendService.analyzeTrend(data);

      expect(trend.direction).toBe("stable");
      expect(trend.strength).toBe("none");
      expect(trend.insight).toContain("Insufficient data");
    });
  });

  describe("detectAnomalies", () => {
    it("should detect spike anomalies", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-02", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-03", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-04", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-05", count: 20, totalMinutes: 1200, averageMinutes: 60 }, // Spike!
      ];

      const anomalies = trendService.detectAnomalies(data, "count");

      expect(anomalies.length).toBeGreaterThan(0);
      const spikeAnomaly = anomalies.find((a) => a.type === "spike");
      expect(spikeAnomaly).toBeDefined();
      expect(spikeAnomaly!.date).toBe("2025-01-05");
      expect(spikeAnomaly!.value).toBe(20);
    });

    it("should detect drop anomalies", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 50, totalMinutes: 3000, averageMinutes: 60 },
        { date: "2025-01-02", count: 50, totalMinutes: 3000, averageMinutes: 60 },
        { date: "2025-01-03", count: 50, totalMinutes: 3000, averageMinutes: 60 },
        { date: "2025-01-04", count: 50, totalMinutes: 3000, averageMinutes: 60 },
        { date: "2025-01-05", count: 5, totalMinutes: 300, averageMinutes: 60 }, // Extreme drop!
      ];

      const anomalies = trendService.detectAnomalies(data, "count");

      expect(anomalies.length).toBeGreaterThan(0);
      const dropAnomaly = anomalies.find((a) => a.type === "drop");
      expect(dropAnomaly).toBeDefined();
      expect(dropAnomaly!.date).toBe("2025-01-05");
    });

    it("should return empty array for insufficient data", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 5, totalMinutes: 300, averageMinutes: 60 },
        { date: "2025-01-02", count: 100, totalMinutes: 6000, averageMinutes: 60 },
      ];

      const anomalies = trendService.detectAnomalies(data, "count");

      expect(anomalies).toHaveLength(0);
    });

    it("should assign correct severity based on deviation", () => {
      // Need data where the spike is >3 standard deviations above mean
      // With 10,10,10,10,300 -> mean=68, stdDev=116, deviation for 300 = (300-68)/116 = 2.0 (info)
      // With 10,10,10,10,10,10,10,10,300 -> provides more stable baseline for higher deviation
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-02", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-03", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-04", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-05", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-06", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-07", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-08", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-09", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-10", count: 500, totalMinutes: 30000, averageMinutes: 60 }, // Extreme spike (>3 stdDev)
      ];

      const anomalies = trendService.detectAnomalies(data, "count");

      const extremeAnomaly = anomalies.find((a) => a.date === "2025-01-10");
      expect(extremeAnomaly).toBeDefined();
      expect(extremeAnomaly!.severity).toBe("critical");
    });
  });

  describe("calculateCorrelation", () => {
    it("should detect strong positive correlation", () => {
      const series1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const series2 = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]; // Perfect positive correlation

      const result = trendService.calculateCorrelation(
        series1,
        series2,
        "Metric A",
        "Metric B"
      );

      expect(result.coefficient).toBeCloseTo(1, 1);
      expect(result.strength).toBe("strong");
      expect(result.direction).toBe("positive");
    });

    it("should detect strong negative correlation", () => {
      const series1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const series2 = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2]; // Perfect negative correlation

      const result = trendService.calculateCorrelation(
        series1,
        series2,
        "Metric A",
        "Metric B"
      );

      expect(result.coefficient).toBeCloseTo(-1, 1);
      expect(result.strength).toBe("strong");
      expect(result.direction).toBe("negative");
    });

    it("should detect no correlation", () => {
      const series1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const series2 = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]; // No variation

      const result = trendService.calculateCorrelation(
        series1,
        series2,
        "Metric A",
        "Metric B"
      );

      expect(result.strength).toBe("none");
      expect(result.insight).toContain("no variation");
    });

    it("should handle insufficient data", () => {
      const series1 = [1, 2];
      const series2 = [3, 4];

      const result = trendService.calculateCorrelation(
        series1,
        series2,
        "Metric A",
        "Metric B"
      );

      expect(result.strength).toBe("none");
      expect(result.insight).toContain("Insufficient data");
    });
  });

  describe("analyzeWeeklyPattern", () => {
    it("should identify high and low points in weekly pattern", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-06", count: 10, totalMinutes: 600, averageMinutes: 60 }, // Monday
        { date: "2025-01-07", count: 8, totalMinutes: 480, averageMinutes: 60 }, // Tuesday
        { date: "2025-01-08", count: 6, totalMinutes: 360, averageMinutes: 60 }, // Wednesday
        { date: "2025-01-09", count: 4, totalMinutes: 240, averageMinutes: 60 }, // Thursday
        { date: "2025-01-10", count: 2, totalMinutes: 120, averageMinutes: 60 }, // Friday - low
        { date: "2025-01-11", count: 5, totalMinutes: 300, averageMinutes: 60 }, // Saturday
        { date: "2025-01-12", count: 3, totalMinutes: 180, averageMinutes: 60 }, // Sunday
      ];

      const patterns = trendService.analyzeWeeklyPattern(data, "count");

      expect(patterns).toHaveLength(7);

      const monday = patterns.find((p) => p.dayName === "Monday");
      expect(monday).toBeDefined();
      expect(monday!.isHighPoint).toBe(true);

      const friday = patterns.find((p) => p.dayName === "Friday");
      expect(friday).toBeDefined();
      expect(friday!.isLowPoint).toBe(true);
    });
  });

  describe("detectSuddenChanges", () => {
    it("should detect sudden increases", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-02", count: 10, totalMinutes: 600, averageMinutes: 60 },
        { date: "2025-01-03", count: 20, totalMinutes: 1200, averageMinutes: 60 }, // 100% increase
        { date: "2025-01-04", count: 20, totalMinutes: 1200, averageMinutes: 60 },
      ];

      const changes = trendService.detectSuddenChanges(data, "count", 50);

      expect(changes.length).toBeGreaterThan(0);
      const increase = changes.find((c) => c.date === "2025-01-03");
      expect(increase).toBeDefined();
      expect(increase!.changePercent).toBe(100);
    });

    it("should detect sudden decreases", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 20, totalMinutes: 1200, averageMinutes: 60 },
        { date: "2025-01-02", count: 20, totalMinutes: 1200, averageMinutes: 60 },
        { date: "2025-01-03", count: 5, totalMinutes: 300, averageMinutes: 60 }, // 75% decrease
        { date: "2025-01-04", count: 5, totalMinutes: 300, averageMinutes: 60 },
      ];

      const changes = trendService.detectSuddenChanges(data, "count", 50);

      expect(changes.length).toBeGreaterThan(0);
      const decrease = changes.find((c) => c.date === "2025-01-03");
      expect(decrease).toBeDefined();
      expect(decrease!.changePercent).toBe(-75);
    });
  });

  describe("generateInsights", () => {
    it("should generate trend insight when trend is significant", () => {
      const stats: DurationStats = {
        count: 10,
        totalMinutes: 600,
        averageMinutes: 60,
        minMinutes: 50,
        maxMinutes: 70,
        stdDevMinutes: 10,
      };

      const trend = {
        direction: "decreasing" as const,
        strength: "moderate" as const,
        slope: -2,
        rSquared: 0.5,
        changePercentage: -25,
        insight: "Test insight",
      };

      const anomalies: never[] = [];
      const weeklyPattern = trendService.analyzeWeeklyPattern([]);

      const insights = trendService.generateInsights(
        stats,
        trend,
        anomalies,
        weeklyPattern,
        "Sleep Duration"
      );

      const trendInsight = insights.find((i) => i.type === "trend");
      expect(trendInsight).toBeDefined();
      expect(trendInsight!.severity).toBe("warning");
      expect(trendInsight!.actionable).toBe(true);
    });

    it("should generate variability warning when stdDev is high", () => {
      const stats: DurationStats = {
        count: 10,
        totalMinutes: 600,
        averageMinutes: 60,
        minMinutes: 20,
        maxMinutes: 120,
        stdDevMinutes: 40, // > 50% of average
      };

      const trend = {
        direction: "stable" as const,
        strength: "none" as const,
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "Stable",
      };

      const insights = trendService.generateInsights(
        stats,
        trend,
        [],
        [],
        "Test Metric"
      );

      const variabilityInsight = insights.find((i) => i.type === "recommendation");
      expect(variabilityInsight).toBeDefined();
      expect(variabilityInsight!.title).toContain("variability");
    });
  });
});
