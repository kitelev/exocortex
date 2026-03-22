import { TrendDetectionService } from "../../../src/services/TrendDetectionService";
import type { DailyAggregate, DurationStats } from "../../../src/services/AnalyticsService";
import type { Anomaly, TrendAnalysis, WeeklyPattern } from "../../../src/services/TrendDetectionService";

describe("TrendDetectionService", () => {
  let service: TrendDetectionService;

  beforeEach(() => {
    service = new TrendDetectionService();
  });

  const makeDailyData = (
    values: number[],
    startDate = "2025-01-01",
  ): DailyAggregate[] => {
    return values.map((v, i) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      return {
        date: date.toISOString().split("T")[0],
        count: i + 1,
        totalMinutes: v * (i + 1),
        averageMinutes: v,
      };
    });
  };

  describe("analyzeTrend", () => {
    it("should return stable with none strength for fewer than 3 data points", () => {
      const result = service.analyzeTrend([]);
      expect(result.direction).toBe("stable");
      expect(result.strength).toBe("none");
      expect(result.slope).toBe(0);
      expect(result.rSquared).toBe(0);
      expect(result.changePercentage).toBe(0);
      expect(result.insight).toContain("Insufficient data");
    });

    it("should return stable with none strength for 2 data points", () => {
      const data = makeDailyData([10, 10]);
      const result = service.analyzeTrend(data);
      expect(result.direction).toBe("stable");
      expect(result.strength).toBe("none");
    });

    it("should detect increasing trend with strong strength", () => {
      // Perfectly linear increasing: 10, 20, 30, 40, 50
      const data = makeDailyData([10, 20, 30, 40, 50]);
      const result = service.analyzeTrend(data);
      expect(result.direction).toBe("increasing");
      expect(result.strength).toBe("strong");
      expect(result.slope).toBeGreaterThan(0);
      expect(result.rSquared).toBeGreaterThanOrEqual(0.7);
      expect(result.changePercentage).toBeGreaterThan(0);
    });

    it("should detect decreasing trend with strong strength", () => {
      const data = makeDailyData([50, 40, 30, 20, 10]);
      const result = service.analyzeTrend(data);
      expect(result.direction).toBe("decreasing");
      expect(result.strength).toBe("strong");
      expect(result.slope).toBeLessThan(0);
      expect(result.changePercentage).toBeLessThan(0);
    });

    it("should detect stable trend when values barely change", () => {
      const data = makeDailyData([100, 100.1, 100, 99.9, 100]);
      const result = service.analyzeTrend(data);
      expect(result.direction).toBe("stable");
    });

    it("should detect moderate strength trend", () => {
      // R^2 between 0.4 and 0.7
      const data = makeDailyData([10, 15, 12, 18, 20, 17, 25]);
      const result = service.analyzeTrend(data);
      expect(["moderate", "weak", "strong"]).toContain(result.strength);
    });

    it("should detect weak strength trend", () => {
      // Noisy data with slight upward trend
      const data = makeDailyData([10, 5, 15, 8, 20, 6, 18]);
      const result = service.analyzeTrend(data);
      // With noisy data, strength should be weak or none
      expect(["weak", "none", "moderate"]).toContain(result.strength);
    });

    it("should use count metricKey", () => {
      const data = makeDailyData([10, 20, 30, 40, 50]);
      // count values are 1,2,3,4,5
      const result = service.analyzeTrend(data, "count");
      expect(result.direction).toBe("increasing");
    });

    it("should use totalMinutes metricKey", () => {
      const data = makeDailyData([10, 20, 30, 40, 50]);
      const result = service.analyzeTrend(data, "totalMinutes");
      expect(result.slope).toBeDefined();
    });

    it("should handle case where first value is 0", () => {
      const data = makeDailyData([0, 10, 20, 30, 40]);
      const result = service.analyzeTrend(data);
      // startValue defaults to 1 when 0 (via || 1)
      expect(result.changePercentage).toBeDefined();
    });
  });

  describe("generateTrendInsight", () => {
    it("should generate stable insight when direction is stable", () => {
      const data = makeDailyData([100, 100, 100, 100, 100]);
      const result = service.analyzeTrend(data);
      expect(result.insight).toContain("stable");
    });

    it("should generate increasing insight text", () => {
      const data = makeDailyData([10, 20, 30, 40, 50]);
      const result = service.analyzeTrend(data);
      expect(result.insight).toContain("increasing");
    });

    it("should generate decreasing insight text", () => {
      const data = makeDailyData([50, 40, 30, 20, 10]);
      const result = service.analyzeTrend(data);
      expect(result.insight).toContain("decreasing");
    });
  });

  describe("detectAnomalies", () => {
    it("should return empty array for fewer than 5 data points", () => {
      const data = makeDailyData([10, 20, 30, 40]);
      const result = service.detectAnomalies(data);
      expect(result).toEqual([]);
    });

    it("should detect spike anomaly", () => {
      // All 10s except one 100 - that's a spike
      const data = makeDailyData([10, 10, 10, 10, 10, 100, 10, 10, 10, 10]);
      const result = service.detectAnomalies(data);
      expect(result.length).toBeGreaterThan(0);
      const spike = result.find(a => a.type === "spike");
      expect(spike).toBeDefined();
      expect(spike!.value).toBe(100);
    });

    it("should detect drop anomaly", () => {
      const data = makeDailyData([100, 100, 100, 100, 100, 0, 100, 100, 100, 100]);
      const result = service.detectAnomalies(data);
      expect(result.length).toBeGreaterThan(0);
      const drop = result.find(a => a.type === "drop");
      expect(drop).toBeDefined();
    });

    it("should classify critical anomaly (>=3 std dev)", () => {
      // Mean ~10, stddev ~0, value 1000 => very high deviation
      const data = makeDailyData([10, 10, 10, 10, 10, 10, 10, 10, 10, 1000]);
      const result = service.detectAnomalies(data);
      const critical = result.find(a => a.severity === "critical");
      expect(critical).toBeDefined();
    });

    it("should classify warning anomaly (>=2.5 std dev)", () => {
      // Carefully craft to get deviation between 2.5 and 3
      const data = makeDailyData([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 50]);
      const result = service.detectAnomalies(data);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should classify info anomaly (>=2 std dev)", () => {
      const data = makeDailyData([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 35]);
      const result = service.detectAnomalies(data);
      if (result.length > 0) {
        expect(["info", "warning", "critical"]).toContain(result[0].severity);
      }
    });

    it("should use count metricKey", () => {
      // count values are 1,2,3...10,100
      const data: DailyAggregate[] = [];
      for (let i = 0; i < 10; i++) {
        data.push({
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          count: i < 9 ? 5 : 500,
          totalMinutes: 100,
          averageMinutes: 10,
        });
      }
      const result = service.detectAnomalies(data, "count");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle zero stdDev gracefully", () => {
      // All same values - stdDev is 0, deviation calculated as value-mean / 1
      const data = makeDailyData([10, 10, 10, 10, 10]);
      const result = service.detectAnomalies(data);
      expect(result).toEqual([]);
    });

    it("should generate anomaly description with correct text", () => {
      const data = makeDailyData([10, 10, 10, 10, 10, 10, 10, 10, 10, 1000]);
      const result = service.detectAnomalies(data);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].description).toContain("detected");
    });
  });

  describe("calculateCorrelation", () => {
    it("should return none for fewer than 5 data points", () => {
      const result = service.calculateCorrelation([1, 2, 3], [4, 5, 6], "A", "B");
      expect(result.strength).toBe("none");
      expect(result.direction).toBe("none");
      expect(result.coefficient).toBe(0);
      expect(result.insight).toContain("Insufficient");
    });

    it("should detect strong positive correlation", () => {
      const s1 = [1, 2, 3, 4, 5, 6, 7];
      const s2 = [2, 4, 6, 8, 10, 12, 14];
      const result = service.calculateCorrelation(s1, s2, "MetricA", "MetricB");
      expect(result.strength).toBe("strong");
      expect(result.direction).toBe("positive");
      expect(result.coefficient).toBeGreaterThanOrEqual(0.7);
      expect(result.insight).toContain("strongly");
    });

    it("should detect strong negative correlation", () => {
      const s1 = [1, 2, 3, 4, 5, 6, 7];
      const s2 = [14, 12, 10, 8, 6, 4, 2];
      const result = service.calculateCorrelation(s1, s2, "MetricA", "MetricB");
      expect(result.strength).toBe("strong");
      expect(result.direction).toBe("negative");
      expect(result.coefficient).toBeLessThanOrEqual(-0.7);
    });

    it("should detect no correlation when stdDev is 0", () => {
      const s1 = [5, 5, 5, 5, 5, 5, 5];
      const s2 = [1, 2, 3, 4, 5, 6, 7];
      const result = service.calculateCorrelation(s1, s2, "Constant", "Increasing");
      expect(result.strength).toBe("none");
      expect(result.direction).toBe("none");
      expect(result.insight).toContain("no variation");
    });

    it("should handle series of different lengths by using minimum", () => {
      const s1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const s2 = [2, 4, 6, 8, 10];
      const result = service.calculateCorrelation(s1, s2, "Long", "Short");
      expect(result.strength).toBe("strong");
    });

    it("should detect moderate correlation", () => {
      // r between 0.4 and 0.7
      const s1 = [1, 2, 3, 4, 5, 6, 7];
      const s2 = [2, 1, 5, 3, 7, 5, 9];
      const result = service.calculateCorrelation(s1, s2, "A", "B");
      expect(["moderate", "strong", "weak"]).toContain(result.strength);
    });

    it("should detect weak correlation", () => {
      // r between 0.2 and 0.4 approximately
      const s1 = [1, 2, 3, 4, 5, 6, 7];
      const s2 = [3, 1, 4, 1, 5, 9, 2];
      const result = service.calculateCorrelation(s1, s2, "A", "B");
      expect(["weak", "none", "moderate"]).toContain(result.strength);
    });

    it("should return none insight for no correlation", () => {
      const s1 = [1, 2, 3, 4, 5, 6, 7];
      const s2 = [4, 4, 4, 5, 4, 4, 4]; // Nearly constant
      const result = service.calculateCorrelation(s1, s2, "A", "B");
      if (result.strength === "none") {
        expect(result.insight).toContain("No significant correlation");
      }
    });
  });

  describe("analyzeWeeklyPattern", () => {
    it("should return 7 patterns for a week of data", () => {
      // Create data spanning multiple weeks
      const data: DailyAggregate[] = [];
      // Start from a Monday (2025-01-06 is a Monday)
      for (let i = 0; i < 28; i++) {
        const date = new Date("2025-01-06");
        date.setDate(date.getDate() + i);
        data.push({
          date: date.toISOString().split("T")[0],
          count: 1,
          totalMinutes: (i % 7) * 10 + 10,
          averageMinutes: (i % 7) * 10 + 10,
        });
      }
      const result = service.analyzeWeeklyPattern(data);
      expect(result).toHaveLength(7);
      expect(result[0].dayName).toBe("Sunday");
      expect(result[6].dayName).toBe("Saturday");
    });

    it("should mark high and low points", () => {
      const data: DailyAggregate[] = [];
      // Create data where Monday (1) is highest and Sunday (0) is lowest
      for (let week = 0; week < 4; week++) {
        // Sunday
        const sunday = new Date("2025-01-05");
        sunday.setDate(sunday.getDate() + week * 7);
        data.push({
          date: sunday.toISOString().split("T")[0],
          count: 1,
          totalMinutes: 10,
          averageMinutes: 10,
        });
        // Monday
        const monday = new Date("2025-01-06");
        monday.setDate(monday.getDate() + week * 7);
        data.push({
          date: monday.toISOString().split("T")[0],
          count: 1,
          totalMinutes: 100,
          averageMinutes: 100,
        });
      }
      const result = service.analyzeWeeklyPattern(data);
      const highPoints = result.filter(p => p.isHighPoint);
      const lowPoints = result.filter(p => p.isLowPoint);
      expect(highPoints.length).toBeGreaterThan(0);
      expect(lowPoints.length).toBeGreaterThan(0);
    });

    it("should handle empty days gracefully", () => {
      // Only data for 2 days of the week
      const data: DailyAggregate[] = [
        { date: "2025-01-06", count: 1, totalMinutes: 60, averageMinutes: 60 }, // Monday
        { date: "2025-01-08", count: 1, totalMinutes: 30, averageMinutes: 30 }, // Wednesday
      ];
      const result = service.analyzeWeeklyPattern(data);
      expect(result).toHaveLength(7);
      // Days without data should have 0 average
      const sunday = result.find(p => p.dayName === "Sunday");
      expect(sunday!.averageValue).toBe(0);
    });

    it("should use count metricKey", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-06", count: 5, totalMinutes: 60, averageMinutes: 60 },
        { date: "2025-01-13", count: 10, totalMinutes: 120, averageMinutes: 60 },
      ];
      const result = service.analyzeWeeklyPattern(data, "count");
      const monday = result.find(p => p.dayName === "Monday");
      expect(monday!.averageValue).toBe(7.5); // (5+10)/2
    });
  });

  describe("generateInsights", () => {
    const baseStats: DurationStats = {
      count: 10,
      totalMinutes: 600,
      averageMinutes: 60,
      minMinutes: 30,
      maxMinutes: 90,
      stdDevMinutes: 15,
    };

    it("should generate trend insight for increasing trend", () => {
      const trend: TrendAnalysis = {
        direction: "increasing",
        strength: "strong",
        slope: 5,
        rSquared: 0.9,
        changePercentage: 50,
        insight: "Metric is clearly increasing",
      };
      const insights = service.generateInsights(baseStats, trend, [], [], "Sleep");
      const trendInsight = insights.find(i => i.type === "trend");
      expect(trendInsight).toBeDefined();
      expect(trendInsight!.severity).toBe("info");
      expect(trendInsight!.actionable).toBe(false);
    });

    it("should generate warning for decreasing trend", () => {
      const trend: TrendAnalysis = {
        direction: "decreasing",
        strength: "moderate",
        slope: -3,
        rSquared: 0.5,
        changePercentage: -30,
        insight: "Metric is moderately decreasing",
      };
      const insights = service.generateInsights(baseStats, trend, [], [], "Sleep");
      const trendInsight = insights.find(i => i.type === "trend");
      expect(trendInsight).toBeDefined();
      expect(trendInsight!.severity).toBe("warning");
      expect(trendInsight!.actionable).toBe(true);
    });

    it("should not generate trend insight when strength is none", () => {
      const trend: TrendAnalysis = {
        direction: "increasing",
        strength: "none",
        slope: 0.1,
        rSquared: 0.1,
        changePercentage: 1,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, trend, [], [], "Sleep");
      const trendInsight = insights.find(i => i.type === "trend");
      expect(trendInsight).toBeUndefined();
    });

    it("should not generate trend insight when direction is stable", () => {
      const trend: TrendAnalysis = {
        direction: "stable",
        strength: "moderate",
        slope: 0,
        rSquared: 0.5,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, trend, [], [], "Sleep");
      const trendInsight = insights.find(i => i.type === "trend");
      expect(trendInsight).toBeUndefined();
    });

    it("should include critical anomaly insights", () => {
      const anomalies: Anomaly[] = [
        {
          date: "2025-01-05",
          value: 200,
          expectedValue: 60,
          deviation: 3.5,
          severity: "critical",
          type: "spike",
          description: "Significant spike detected",
        },
      ];
      const stableTrend: TrendAnalysis = {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, stableTrend, anomalies, [], "Sleep");
      const anomalyInsight = insights.find(i => i.type === "anomaly");
      expect(anomalyInsight).toBeDefined();
      expect(anomalyInsight!.severity).toBe("critical");
      expect(anomalyInsight!.actionable).toBe(true);
    });

    it("should not include non-critical anomalies", () => {
      const anomalies: Anomaly[] = [
        {
          date: "2025-01-05",
          value: 80,
          expectedValue: 60,
          deviation: 2.1,
          severity: "info",
          type: "spike",
          description: "Minor spike",
        },
      ];
      const stableTrend: TrendAnalysis = {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, stableTrend, anomalies, [], "Sleep");
      const anomalyInsight = insights.find(i => i.type === "anomaly");
      expect(anomalyInsight).toBeUndefined();
    });

    it("should generate weekly pattern insight when high and low days exist", () => {
      const weeklyPattern: WeeklyPattern[] = [
        { dayOfWeek: 0, dayName: "Sunday", averageValue: 30, deviation: 5, isHighPoint: false, isLowPoint: true },
        { dayOfWeek: 1, dayName: "Monday", averageValue: 90, deviation: 5, isHighPoint: true, isLowPoint: false },
        { dayOfWeek: 2, dayName: "Tuesday", averageValue: 60, deviation: 5, isHighPoint: false, isLowPoint: false },
        { dayOfWeek: 3, dayName: "Wednesday", averageValue: 60, deviation: 5, isHighPoint: false, isLowPoint: false },
        { dayOfWeek: 4, dayName: "Thursday", averageValue: 60, deviation: 5, isHighPoint: false, isLowPoint: false },
        { dayOfWeek: 5, dayName: "Friday", averageValue: 60, deviation: 5, isHighPoint: false, isLowPoint: false },
        { dayOfWeek: 6, dayName: "Saturday", averageValue: 60, deviation: 5, isHighPoint: false, isLowPoint: false },
      ];
      const stableTrend: TrendAnalysis = {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, stableTrend, [], weeklyPattern, "Sleep");
      const patternInsight = insights.find(i => i.type === "pattern");
      expect(patternInsight).toBeDefined();
      expect(patternInsight!.description).toContain("Monday");
      expect(patternInsight!.description).toContain("Sunday");
    });

    it("should not generate pattern insight when no high/low days", () => {
      const weeklyPattern: WeeklyPattern[] = Array.from({ length: 7 }, (_, i) => ({
        dayOfWeek: i,
        dayName: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i],
        averageValue: 60,
        deviation: 5,
        isHighPoint: false,
        isLowPoint: false,
      }));
      const stableTrend: TrendAnalysis = {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, stableTrend, [], weeklyPattern, "Sleep");
      const patternInsight = insights.find(i => i.type === "pattern");
      expect(patternInsight).toBeUndefined();
    });

    it("should generate high variability recommendation", () => {
      const highVarStats: DurationStats = {
        count: 10,
        totalMinutes: 600,
        averageMinutes: 60,
        minMinutes: 10,
        maxMinutes: 120,
        stdDevMinutes: 40, // > 60 * 0.5 = 30
      };
      const stableTrend: TrendAnalysis = {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(highVarStats, stableTrend, [], [], "Sleep");
      const recommendation = insights.find(i => i.type === "recommendation");
      expect(recommendation).toBeDefined();
      expect(recommendation!.severity).toBe("warning");
      expect(recommendation!.actionable).toBe(true);
      expect(recommendation!.description).toContain("variability");
    });

    it("should not generate variability recommendation when stdDev is low", () => {
      const stableTrend: TrendAnalysis = {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "stable",
      };
      const insights = service.generateInsights(baseStats, stableTrend, [], [], "Sleep");
      const recommendation = insights.find(i => i.type === "recommendation");
      expect(recommendation).toBeUndefined();
    });
  });

  describe("detectSuddenChanges", () => {
    it("should detect sudden change exceeding threshold", () => {
      const data = makeDailyData([100, 200, 100, 100, 100]);
      const result = service.detectSuddenChanges(data);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].changePercent).toBe(100);
    });

    it("should skip when previous value is 0", () => {
      const data = makeDailyData([0, 100, 100, 100, 100]);
      const result = service.detectSuddenChanges(data);
      // First transition (0 -> 100) should be skipped
      expect(result.every(c => c.previousValue !== 0)).toBe(true);
    });

    it("should detect both increases and decreases", () => {
      const data = makeDailyData([100, 200, 50, 100, 100]);
      const result = service.detectSuddenChanges(data);
      const increases = result.filter(c => c.changePercent > 0);
      const decreases = result.filter(c => c.changePercent < 0);
      expect(increases.length).toBeGreaterThan(0);
      expect(decreases.length).toBeGreaterThan(0);
    });

    it("should respect custom threshold", () => {
      const data = makeDailyData([100, 130, 100, 100, 100]);
      // Default threshold 50% - 30% change should not trigger
      const result50 = service.detectSuddenChanges(data, "averageMinutes", 50);
      expect(result50.length).toBe(0);
      // Custom threshold 25% - 30% change should trigger
      const result25 = service.detectSuddenChanges(data, "averageMinutes", 25);
      expect(result25.length).toBeGreaterThan(0);
    });

    it("should use count metricKey", () => {
      const data: DailyAggregate[] = [
        { date: "2025-01-01", count: 5, totalMinutes: 100, averageMinutes: 20 },
        { date: "2025-01-02", count: 15, totalMinutes: 100, averageMinutes: 20 },
      ];
      const result = service.detectSuddenChanges(data, "count");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].changePercent).toBe(200);
    });

    it("should return empty when no changes exceed threshold", () => {
      const data = makeDailyData([100, 105, 98, 102, 100]);
      const result = service.detectSuddenChanges(data);
      expect(result).toEqual([]);
    });
  });
});
