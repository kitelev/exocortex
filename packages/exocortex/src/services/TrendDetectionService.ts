/**
 * TrendDetectionService - Trend Analysis and Anomaly Detection
 *
 * Provides trend detection capabilities:
 * - Linear trend detection (increasing/decreasing/stable)
 * - Anomaly detection (outliers, sudden changes)
 * - Correlation analysis between metrics
 * - Pattern recognition (weekly cycles, etc.)
 *
 * Uses statistical methods to analyze behavioral data.
 *
 * @module services
 * @since 1.0.0
 */

import { injectable } from "tsyringe";
import type { DailyAggregate, DurationStats } from "./AnalyticsService";

/**
 * Trend direction
 */
export type TrendDirection = "increasing" | "decreasing" | "stable";

/**
 * Trend strength (how strong is the trend)
 */
export type TrendStrength = "strong" | "moderate" | "weak" | "none";

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  direction: TrendDirection;
  strength: TrendStrength;
  slope: number;
  rSquared: number;
  changePercentage: number;
  insight: string;
}

/**
 * Anomaly detection result
 */
export interface Anomaly {
  date: string;
  value: number;
  expectedValue: number;
  deviation: number;
  severity: "critical" | "warning" | "info";
  type: "spike" | "drop" | "outlier";
  description: string;
}

/**
 * Correlation analysis result
 */
export interface CorrelationResult {
  metric1: string;
  metric2: string;
  coefficient: number;
  strength: "strong" | "moderate" | "weak" | "none";
  direction: "positive" | "negative" | "none";
  insight: string;
}

/**
 * Weekly pattern analysis
 */
export interface WeeklyPattern {
  dayOfWeek: number;
  dayName: string;
  averageValue: number;
  deviation: number;
  isHighPoint: boolean;
  isLowPoint: boolean;
}

/**
 * Insight generated from analysis
 */
export interface BehavioralInsight {
  type: "trend" | "anomaly" | "correlation" | "pattern" | "recommendation";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metric?: string;
  value?: number;
  actionable: boolean;
}

@injectable()
export class TrendDetectionService {
  /**
   * Threshold for considering a trend as significant
   */
  private readonly TREND_THRESHOLD = 0.05; // 5% change is considered a trend
  private readonly ANOMALY_THRESHOLD_STD = 2.0; // 2 standard deviations
  private readonly STRONG_CORRELATION_THRESHOLD = 0.7;
  private readonly MODERATE_CORRELATION_THRESHOLD = 0.4;

  /**
   * Analyze trend in a series of daily aggregates
   */
  analyzeTrend(dailyData: DailyAggregate[], metricKey: "count" | "averageMinutes" | "totalMinutes" = "averageMinutes"): TrendAnalysis {
    if (dailyData.length < 3) {
      return {
        direction: "stable",
        strength: "none",
        slope: 0,
        rSquared: 0,
        changePercentage: 0,
        insight: "Insufficient data for trend analysis (need at least 3 data points)",
      };
    }

    const values = dailyData.map((d) => d[metricKey]);
    const { slope, rSquared } = this.linearRegression(values);

    // Calculate percentage change from start to end
    const startValue = values[0] || 1;
    const endValue = values[values.length - 1] || 0;
    const changePercentage = ((endValue - startValue) / startValue) * 100;

    // Determine direction
    let direction: TrendDirection;
    if (Math.abs(changePercentage) < this.TREND_THRESHOLD * 100) {
      direction = "stable";
    } else if (slope > 0) {
      direction = "increasing";
    } else {
      direction = "decreasing";
    }

    // Determine strength based on R² value
    let strength: TrendStrength;
    if (rSquared >= 0.7) {
      strength = "strong";
    } else if (rSquared >= 0.4) {
      strength = "moderate";
    } else if (rSquared >= 0.2) {
      strength = "weak";
    } else {
      strength = "none";
    }

    // Generate insight
    const insight = this.generateTrendInsight(direction, strength, changePercentage);

    return {
      direction,
      strength,
      slope: Math.round(slope * 100) / 100,
      rSquared: Math.round(rSquared * 100) / 100,
      changePercentage: Math.round(changePercentage * 10) / 10,
      insight,
    };
  }

  /**
   * Perform linear regression on a series of values
   */
  private linearRegression(values: number[]): { slope: number; intercept: number; rSquared: number } {
    const n = values.length;
    if (n === 0) return { slope: 0, intercept: 0, rSquared: 0 };

    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Calculate R² (coefficient of determination)
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * i;
      ssRes += Math.pow(values[i] - predicted, 2);
      ssTot += Math.pow(values[i] - yMean, 2);
    }

    const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

    return { slope, intercept, rSquared: Math.max(0, rSquared) };
  }

  /**
   * Generate human-readable trend insight
   */
  private generateTrendInsight(
    direction: TrendDirection,
    strength: TrendStrength,
    changePercentage: number,
  ): string {
    if (strength === "none" || direction === "stable") {
      return "Metric is relatively stable with no significant trend.";
    }

    const strengthText = strength === "strong" ? "clearly" : strength === "moderate" ? "moderately" : "slightly";
    const directionText = direction === "increasing" ? "increasing" : "decreasing";
    const changeText = `${Math.abs(Math.round(changePercentage))}%`;

    return `Metric is ${strengthText} ${directionText} (${changeText} change over the period).`;
  }

  /**
   * Detect anomalies in a series of daily aggregates
   */
  detectAnomalies(
    dailyData: DailyAggregate[],
    metricKey: "count" | "averageMinutes" | "totalMinutes" = "averageMinutes",
  ): Anomaly[] {
    if (dailyData.length < 5) {
      return []; // Need minimum data for meaningful anomaly detection
    }

    const values = dailyData.map((d) => d[metricKey]);
    const { mean, stdDev } = this.calculateStats(values);

    const anomalies: Anomaly[] = [];

    for (let i = 0; i < dailyData.length; i++) {
      const value = values[i];
      const deviation = (value - mean) / (stdDev || 1);

      if (Math.abs(deviation) >= this.ANOMALY_THRESHOLD_STD) {
        const severity = this.determineAnomalySeverity(deviation);
        const type = this.determineAnomalyType(deviation, value, mean);

        anomalies.push({
          date: dailyData[i].date,
          value,
          expectedValue: Math.round(mean * 10) / 10,
          deviation: Math.round(deviation * 100) / 100,
          severity,
          type,
          description: this.generateAnomalyDescription(type, severity, deviation, value, mean),
        });
      }
    }

    return anomalies;
  }

  /**
   * Calculate mean and standard deviation
   */
  private calculateStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev };
  }

  /**
   * Determine anomaly severity based on deviation
   */
  private determineAnomalySeverity(deviation: number): "critical" | "warning" | "info" {
    const absDeviation = Math.abs(deviation);
    if (absDeviation >= 3) return "critical";
    if (absDeviation >= 2.5) return "warning";
    return "info";
  }

  /**
   * Determine anomaly type
   */
  private determineAnomalyType(
    deviation: number,
    value: number,
    mean: number,
  ): "spike" | "drop" | "outlier" {
    if (value > mean && deviation > 0) return "spike";
    if (value < mean && deviation < 0) return "drop";
    return "outlier";
  }

  /**
   * Generate anomaly description
   */
  private generateAnomalyDescription(
    type: "spike" | "drop" | "outlier",
    severity: "critical" | "warning" | "info",
    deviation: number,
    value: number,
    mean: number,
  ): string {
    const severityText =
      severity === "critical" ? "Significant" : severity === "warning" ? "Notable" : "Minor";
    const typeText = type === "spike" ? "spike" : type === "drop" ? "drop" : "unusual value";
    const percentChange = Math.round(((value - mean) / mean) * 100);

    return `${severityText} ${typeText} detected: ${Math.round(value)} (${percentChange > 0 ? "+" : ""}${percentChange}% from average of ${Math.round(mean)}, ${deviation.toFixed(1)}σ from mean).`;
  }

  /**
   * Calculate correlation between two series of data
   */
  calculateCorrelation(
    series1: number[],
    series2: number[],
    metric1Name: string,
    metric2Name: string,
  ): CorrelationResult {
    const n = Math.min(series1.length, series2.length);
    if (n < 5) {
      return {
        metric1: metric1Name,
        metric2: metric2Name,
        coefficient: 0,
        strength: "none",
        direction: "none",
        insight: "Insufficient data for correlation analysis.",
      };
    }

    // Pearson correlation coefficient
    const { mean: mean1, stdDev: stdDev1 } = this.calculateStats(series1.slice(0, n));
    const { mean: mean2, stdDev: stdDev2 } = this.calculateStats(series2.slice(0, n));

    if (stdDev1 === 0 || stdDev2 === 0) {
      return {
        metric1: metric1Name,
        metric2: metric2Name,
        coefficient: 0,
        strength: "none",
        direction: "none",
        insight: "One or both metrics have no variation.",
      };
    }

    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += ((series1[i] - mean1) / stdDev1) * ((series2[i] - mean2) / stdDev2);
    }
    const coefficient = sum / n;

    // Determine strength and direction
    const absCoeff = Math.abs(coefficient);
    let strength: "strong" | "moderate" | "weak" | "none";
    if (absCoeff >= this.STRONG_CORRELATION_THRESHOLD) {
      strength = "strong";
    } else if (absCoeff >= this.MODERATE_CORRELATION_THRESHOLD) {
      strength = "moderate";
    } else if (absCoeff >= 0.2) {
      strength = "weak";
    } else {
      strength = "none";
    }

    const direction: "positive" | "negative" | "none" =
      strength === "none" ? "none" : coefficient > 0 ? "positive" : "negative";

    const insight = this.generateCorrelationInsight(
      metric1Name,
      metric2Name,
      coefficient,
      strength,
      direction,
    );

    return {
      metric1: metric1Name,
      metric2: metric2Name,
      coefficient: Math.round(coefficient * 100) / 100,
      strength,
      direction,
      insight,
    };
  }

  /**
   * Generate correlation insight
   */
  private generateCorrelationInsight(
    metric1: string,
    metric2: string,
    coefficient: number,
    strength: "strong" | "moderate" | "weak" | "none",
    direction: "positive" | "negative" | "none",
  ): string {
    if (strength === "none") {
      return `No significant correlation found between ${metric1} and ${metric2}.`;
    }

    const strengthText =
      strength === "strong" ? "strongly" : strength === "moderate" ? "moderately" : "weakly";
    const directionText =
      direction === "positive"
        ? "When one increases, the other tends to increase"
        : "When one increases, the other tends to decrease";

    return `${metric1} and ${metric2} are ${strengthText} ${direction}ly correlated (r=${coefficient.toFixed(2)}). ${directionText}.`;
  }

  /**
   * Analyze weekly patterns in data
   */
  analyzeWeeklyPattern(dailyData: DailyAggregate[], metricKey: "count" | "averageMinutes" | "totalMinutes" = "averageMinutes"): WeeklyPattern[] {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayData: { [key: number]: number[] } = {};

    // Group data by day of week
    for (const day of dailyData) {
      const date = new Date(day.date);
      const dayOfWeek = date.getDay();
      if (!dayData[dayOfWeek]) {
        dayData[dayOfWeek] = [];
      }
      dayData[dayOfWeek].push(day[metricKey]);
    }

    // Calculate averages for each day
    const patterns: WeeklyPattern[] = [];
    let maxAvg = 0;
    let minAvg = Infinity;

    for (let dow = 0; dow < 7; dow++) {
      const values = dayData[dow] || [];
      const { mean, stdDev } = this.calculateStats(values);

      if (mean > maxAvg) maxAvg = mean;
      if (mean < minAvg && values.length > 0) minAvg = mean;

      patterns.push({
        dayOfWeek: dow,
        dayName: dayNames[dow],
        averageValue: Math.round(mean * 10) / 10,
        deviation: Math.round(stdDev * 10) / 10,
        isHighPoint: false,
        isLowPoint: false,
      });
    }

    // Mark high and low points
    for (const pattern of patterns) {
      if (pattern.averageValue === maxAvg && maxAvg > 0) {
        pattern.isHighPoint = true;
      }
      if (pattern.averageValue === minAvg && minAvg !== Infinity) {
        pattern.isLowPoint = true;
      }
    }

    return patterns;
  }

  /**
   * Generate behavioral insights from various analyses
   */
  generateInsights(
    stats: DurationStats,
    trend: TrendAnalysis,
    anomalies: Anomaly[],
    weeklyPattern: WeeklyPattern[],
    metricName: string,
  ): BehavioralInsight[] {
    const insights: BehavioralInsight[] = [];

    // Trend insight
    if (trend.strength !== "none" && trend.direction !== "stable") {
      insights.push({
        type: "trend",
        severity: trend.direction === "decreasing" ? "warning" : "info",
        title: `${metricName} is ${trend.direction}`,
        description: trend.insight,
        metric: metricName,
        value: trend.changePercentage,
        actionable: trend.direction === "decreasing",
      });
    }

    // Critical anomalies
    const criticalAnomalies = anomalies.filter((a) => a.severity === "critical");
    if (criticalAnomalies.length > 0) {
      for (const anomaly of criticalAnomalies) {
        insights.push({
          type: "anomaly",
          severity: "critical",
          title: `Unusual ${anomaly.type} detected on ${anomaly.date}`,
          description: anomaly.description,
          metric: metricName,
          value: anomaly.value,
          actionable: true,
        });
      }
    }

    // Weekly pattern insights
    const highDays = weeklyPattern.filter((p) => p.isHighPoint).map((p) => p.dayName);
    const lowDays = weeklyPattern.filter((p) => p.isLowPoint).map((p) => p.dayName);

    if (highDays.length > 0 && lowDays.length > 0) {
      insights.push({
        type: "pattern",
        severity: "info",
        title: "Weekly pattern detected",
        description: `${metricName} tends to be highest on ${highDays.join(", ")} and lowest on ${lowDays.join(", ")}.`,
        metric: metricName,
        actionable: false,
      });
    }

    // High variability warning
    if (stats.stdDevMinutes > stats.averageMinutes * 0.5) {
      insights.push({
        type: "recommendation",
        severity: "warning",
        title: "High variability detected",
        description: `${metricName} shows high variability (std dev: ${stats.stdDevMinutes} min). Consider maintaining a more consistent schedule.`,
        metric: metricName,
        value: stats.stdDevMinutes,
        actionable: true,
      });
    }

    return insights;
  }

  /**
   * Detect sudden changes between consecutive periods
   */
  detectSuddenChanges(
    dailyData: DailyAggregate[],
    metricKey: "count" | "averageMinutes" | "totalMinutes" = "averageMinutes",
    thresholdPercent: number = 50,
  ): { date: string; previousValue: number; currentValue: number; changePercent: number }[] {
    const changes: {
      date: string;
      previousValue: number;
      currentValue: number;
      changePercent: number;
    }[] = [];

    for (let i = 1; i < dailyData.length; i++) {
      const prev = dailyData[i - 1][metricKey];
      const curr = dailyData[i][metricKey];

      if (prev === 0) continue;

      const changePercent = ((curr - prev) / prev) * 100;

      if (Math.abs(changePercent) >= thresholdPercent) {
        changes.push({
          date: dailyData[i].date,
          previousValue: prev,
          currentValue: curr,
          changePercent: Math.round(changePercent * 10) / 10,
        });
      }
    }

    return changes;
  }
}
