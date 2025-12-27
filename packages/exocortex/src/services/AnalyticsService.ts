/**
 * AnalyticsService - Behavioral Analytics and Data Aggregation
 *
 * Provides analytics capabilities for effort/task data:
 * - Sleep analysis (duration, patterns, regularity)
 * - Task completion metrics
 * - Activity frequency analysis
 * - Time distribution analysis
 *
 * Uses SPARQL queries to aggregate data from the knowledge base.
 *
 * @module services
 * @since 1.0.0
 */

import { injectable, inject } from "tsyringe";
import type { IVaultAdapter, IFile } from "../interfaces/IVaultAdapter";
import { DI_TOKENS } from "../interfaces/tokens";
import { DateFormatter } from "../utilities/DateFormatter";
import { FrontmatterService } from "../utilities/FrontmatterService";
import type { WeeklyPattern } from "./TrendDetectionService";

/**
 * Time period for analytics queries
 */
export interface AnalyticsPeriod {
  startDate: Date;
  endDate: Date;
}

/**
 * Duration statistics for a metric
 */
export interface DurationStats {
  count: number;
  totalMinutes: number;
  averageMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  stdDevMinutes: number;
}

/**
 * Daily aggregate data point
 */
export interface DailyAggregate {
  date: string;
  count: number;
  totalMinutes: number;
  averageMinutes: number;
}

/**
 * Hourly distribution data
 */
export interface HourlyDistribution {
  hour: number;
  count: number;
  percentage: number;
}

/**
 * Sleep analysis result
 */
export interface SleepAnalysis {
  period: AnalyticsPeriod;
  stats: DurationStats;
  dailyData: DailyAggregate[];
  averageBedtime: string;
  averageWakeTime: string;
  bedtimeVariabilityMinutes: number;
  wakeTimeVariabilityMinutes: number;
  weeklyPattern?: WeeklyPattern[];
}

/**
 * Task completion analysis result
 */
export interface TaskCompletionAnalysis {
  period: AnalyticsPeriod;
  totalTasks: number;
  completedTasks: number;
  trashedTasks: number;
  completionRate: number;
  averageCompletionTimeMinutes: number;
  dailyCompletions: DailyAggregate[];
}

/**
 * Activity frequency analysis result
 */
export interface ActivityFrequencyAnalysis {
  activityLabel: string;
  period: AnalyticsPeriod;
  stats: DurationStats;
  dailyData: DailyAggregate[];
  hourlyDistribution: HourlyDistribution[];
  weekdayDistribution: {
    dayOfWeek: number;
    dayName: string;
    count: number;
    percentage: number;
  }[];
}

/**
 * Effort data extracted from vault files
 */
export interface EffortData {
  path: string;
  label: string;
  status: string | null;
  startTimestamp: Date | null;
  endTimestamp: Date | null;
  prototypeUri: string | null;
  instanceClass: string | string[] | null;
}

@injectable()
export class AnalyticsService {
  private frontmatterService: FrontmatterService;

  constructor(
    @inject(DI_TOKENS.IVaultAdapter) private vault: IVaultAdapter,
  ) {
    this.frontmatterService = new FrontmatterService();
  }

  /**
   * Get default period (last 30 days)
   */
  getDefaultPeriod(): AnalyticsPeriod {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    return { startDate, endDate };
  }

  /**
   * Get efforts within a time period
   */
  async getEffortsInPeriod(
    period: AnalyticsPeriod,
    filter?: {
      prototypeUri?: string;
      labelContains?: string;
      status?: string[];
    },
  ): Promise<EffortData[]> {
    const allFiles = this.vault.getAllFiles();
    const files = allFiles.filter((f) => f.path.endsWith(".md"));
    const efforts: EffortData[] = [];

    for (const file of files) {
      try {
        const content = await this.vault.read(file);
        const effortData = this.extractEffortData(file, content);

        if (!effortData) continue;

        // Filter by time period
        if (effortData.startTimestamp) {
          if (
            effortData.startTimestamp < period.startDate ||
            effortData.startTimestamp > period.endDate
          ) {
            continue;
          }
        } else {
          continue; // Skip efforts without start timestamp
        }

        // Apply optional filters
        if (filter?.prototypeUri && effortData.prototypeUri !== filter.prototypeUri) {
          continue;
        }

        if (filter?.labelContains && !effortData.label.toLowerCase().includes(filter.labelContains.toLowerCase())) {
          continue;
        }

        if (filter?.status && effortData.status && !filter.status.includes(effortData.status)) {
          continue;
        }

        efforts.push(effortData);
      } catch {
        // Skip files that can't be processed
        continue;
      }
    }

    return efforts;
  }

  /**
   * Extract effort data from file content
   */
  private extractEffortData(file: IFile, content: string): EffortData | null {
    const parsed = this.frontmatterService.parse(content);
    if (!parsed.exists) return null;

    const label = this.frontmatterService.getPropertyValue(
      parsed.content,
      "exo__Asset_label",
    );

    if (!label) return null;

    const status = this.frontmatterService.getPropertyValue(
      parsed.content,
      "ems__Effort_status",
    );

    const startTimestampStr = this.frontmatterService.getPropertyValue(
      parsed.content,
      "ems__Effort_startTimestamp",
    );

    const endTimestampStr = this.frontmatterService.getPropertyValue(
      parsed.content,
      "ems__Effort_endTimestamp",
    );

    const prototypeUri = this.frontmatterService.getPropertyValue(
      parsed.content,
      "exo__Asset_prototype",
    );

    const instanceClass = this.extractInstanceClass(parsed.content);

    return {
      path: file.path,
      label: this.cleanWikiLink(label),
      status: status ? this.cleanWikiLink(status) : null,
      startTimestamp: startTimestampStr ? this.parseTimestamp(startTimestampStr) : null,
      endTimestamp: endTimestampStr ? this.parseTimestamp(endTimestampStr) : null,
      prototypeUri: prototypeUri ? this.cleanWikiLink(prototypeUri) : null,
      instanceClass: instanceClass,
    };
  }

  /**
   * Extract instance class from frontmatter (handles both single value and array)
   */
  private extractInstanceClass(frontmatterContent: string): string | string[] | null {
    const arrayMatch = frontmatterContent.match(
      /exo__Instance_class:\s*\n((?:\s*-\s*.*\n?)+)/,
    );

    if (arrayMatch) {
      const lines = arrayMatch[1].split("\n").filter((l) => l.trim());
      return lines.map((line) =>
        this.cleanWikiLink(line.replace(/^\s*-\s*/, "").trim()),
      );
    }

    const value = this.frontmatterService.getPropertyValue(
      frontmatterContent,
      "exo__Instance_class",
    );

    return value ? this.cleanWikiLink(value) : null;
  }

  /**
   * Clean wiki-link syntax from value
   */
  private cleanWikiLink(value: string): string {
    return value
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .replace(/^"/, "")
      .replace(/"$/, "");
  }

  /**
   * Parse timestamp string to Date
   */
  private parseTimestamp(timestamp: string): Date | null {
    if (!timestamp) return null;

    const cleaned = timestamp.replace(/^"/, "").replace(/"$/, "");
    const date = new Date(cleaned);

    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  /**
   * Calculate duration statistics from efforts
   */
  calculateDurationStats(efforts: EffortData[]): DurationStats {
    const durations = efforts
      .filter((e) => e.startTimestamp && e.endTimestamp)
      .map((e) => {
        const durationMs =
          e.endTimestamp!.getTime() - e.startTimestamp!.getTime();
        return durationMs / 60000; // Convert to minutes
      })
      .filter((d) => d > 0);

    if (durations.length === 0) {
      return {
        count: 0,
        totalMinutes: 0,
        averageMinutes: 0,
        minMinutes: 0,
        maxMinutes: 0,
        stdDevMinutes: 0,
      };
    }

    const total = durations.reduce((a, b) => a + b, 0);
    const avg = total / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);

    // Calculate standard deviation
    const squaredDiffs = durations.map((d) => Math.pow(d - avg, 2));
    const avgSquaredDiff =
      squaredDiffs.reduce((a, b) => a + b, 0) / durations.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
      count: durations.length,
      totalMinutes: Math.round(total),
      averageMinutes: Math.round(avg * 10) / 10,
      minMinutes: Math.round(min),
      maxMinutes: Math.round(max),
      stdDevMinutes: Math.round(stdDev * 10) / 10,
    };
  }

  /**
   * Group efforts by date and calculate daily aggregates
   */
  calculateDailyAggregates(efforts: EffortData[]): DailyAggregate[] {
    const dailyMap = new Map<string, { count: number; totalMinutes: number }>();

    for (const effort of efforts) {
      if (!effort.startTimestamp) continue;

      const dateStr = DateFormatter.toDateString(effort.startTimestamp);

      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, { count: 0, totalMinutes: 0 });
      }

      const daily = dailyMap.get(dateStr)!;
      daily.count++;

      if (effort.endTimestamp) {
        const durationMs =
          effort.endTimestamp.getTime() - effort.startTimestamp.getTime();
        daily.totalMinutes += durationMs / 60000;
      }
    }

    return Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        count: data.count,
        totalMinutes: Math.round(data.totalMinutes),
        averageMinutes:
          data.count > 0
            ? Math.round((data.totalMinutes / data.count) * 10) / 10
            : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate hourly distribution of activities
   */
  calculateHourlyDistribution(efforts: EffortData[]): HourlyDistribution[] {
    const hourlyCounts = new Array(24).fill(0);

    for (const effort of efforts) {
      if (!effort.startTimestamp) continue;
      const hour = effort.startTimestamp.getHours();
      hourlyCounts[hour]++;
    }

    const total = hourlyCounts.reduce((a, b) => a + b, 0);

    return hourlyCounts.map((count, hour) => ({
      hour,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));
  }

  /**
   * Calculate weekday distribution of activities
   */
  calculateWeekdayDistribution(
    efforts: EffortData[],
  ): { dayOfWeek: number; dayName: string; count: number; percentage: number }[] {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayCounts = new Array(7).fill(0);

    for (const effort of efforts) {
      if (!effort.startTimestamp) continue;
      const dayOfWeek = effort.startTimestamp.getDay();
      dayCounts[dayOfWeek]++;
    }

    const total = dayCounts.reduce((a, b) => a + b, 0);

    return dayCounts.map((count, dayOfWeek) => ({
      dayOfWeek,
      dayName: dayNames[dayOfWeek],
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }));
  }

  /**
   * Analyze sleep patterns
   */
  async analyzeSleep(
    period: AnalyticsPeriod = this.getDefaultPeriod(),
  ): Promise<SleepAnalysis> {
    const efforts = await this.getEffortsInPeriod(period, {
      labelContains: "Поспать",
    });

    const stats = this.calculateDurationStats(efforts);
    const dailyData = this.calculateDailyAggregates(efforts);

    // Calculate bedtime and wake time statistics
    const bedtimes: number[] = [];
    const wakeTimes: number[] = [];

    for (const effort of efforts) {
      if (effort.startTimestamp) {
        const bedtimeMinutes =
          effort.startTimestamp.getHours() * 60 +
          effort.startTimestamp.getMinutes();
        // Normalize bedtime: if after midnight (0-6am), add 24 hours
        bedtimes.push(bedtimeMinutes < 360 ? bedtimeMinutes + 1440 : bedtimeMinutes);
      }
      if (effort.endTimestamp) {
        const wakeMinutes =
          effort.endTimestamp.getHours() * 60 +
          effort.endTimestamp.getMinutes();
        wakeTimes.push(wakeMinutes);
      }
    }

    const avgBedtimeMinutes =
      bedtimes.length > 0
        ? bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length
        : 0;
    const avgWakeTimeMinutes =
      wakeTimes.length > 0
        ? wakeTimes.reduce((a, b) => a + b, 0) / wakeTimes.length
        : 0;

    // Calculate variability (standard deviation)
    const bedtimeVariability =
      bedtimes.length > 1
        ? Math.sqrt(
            bedtimes
              .map((b) => Math.pow(b - avgBedtimeMinutes, 2))
              .reduce((a, b) => a + b, 0) / bedtimes.length,
          )
        : 0;

    const wakeTimeVariability =
      wakeTimes.length > 1
        ? Math.sqrt(
            wakeTimes
              .map((w) => Math.pow(w - avgWakeTimeMinutes, 2))
              .reduce((a, b) => a + b, 0) / wakeTimes.length,
          )
        : 0;

    return {
      period,
      stats,
      dailyData,
      averageBedtime: this.minutesToTimeString(avgBedtimeMinutes % 1440),
      averageWakeTime: this.minutesToTimeString(avgWakeTimeMinutes),
      bedtimeVariabilityMinutes: Math.round(bedtimeVariability),
      wakeTimeVariabilityMinutes: Math.round(wakeTimeVariability),
    };
  }

  /**
   * Convert minutes from midnight to time string (HH:MM)
   */
  private minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }

  /**
   * Analyze task completion metrics
   */
  async analyzeTaskCompletion(
    period: AnalyticsPeriod = this.getDefaultPeriod(),
  ): Promise<TaskCompletionAnalysis> {
    const efforts = await this.getEffortsInPeriod(period);

    // Filter to tasks only
    const tasks = efforts.filter((e) => {
      if (Array.isArray(e.instanceClass)) {
        return e.instanceClass.some((c) => c.includes("ems__Task"));
      }
      return e.instanceClass?.includes("ems__Task") ?? false;
    });

    const completedTasks = tasks.filter((t) =>
      t.status?.includes("ems__EffortStatusDone"),
    );
    const trashedTasks = tasks.filter((t) =>
      t.status?.includes("ems__EffortStatusTrashed"),
    );

    // Calculate completion times for completed tasks
    const completionTimes = completedTasks
      .filter((t) => t.startTimestamp && t.endTimestamp)
      .map((t) => {
        const durationMs =
          t.endTimestamp!.getTime() - t.startTimestamp!.getTime();
        return durationMs / 60000;
      });

    const avgCompletionTime =
      completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

    // Calculate daily completions
    const dailyCompletions = this.calculateDailyAggregates(completedTasks);

    return {
      period,
      totalTasks: tasks.length,
      completedTasks: completedTasks.length,
      trashedTasks: trashedTasks.length,
      completionRate:
        tasks.length > 0
          ? Math.round((completedTasks.length / tasks.length) * 1000) / 10
          : 0,
      averageCompletionTimeMinutes: Math.round(avgCompletionTime * 10) / 10,
      dailyCompletions,
    };
  }

  /**
   * Analyze frequency of a specific activity
   */
  async analyzeActivityFrequency(
    activityLabel: string,
    period: AnalyticsPeriod = this.getDefaultPeriod(),
  ): Promise<ActivityFrequencyAnalysis> {
    const efforts = await this.getEffortsInPeriod(period, {
      labelContains: activityLabel,
    });

    const stats = this.calculateDurationStats(efforts);
    const dailyData = this.calculateDailyAggregates(efforts);
    const hourlyDistribution = this.calculateHourlyDistribution(efforts);
    const weekdayDistribution = this.calculateWeekdayDistribution(efforts);

    return {
      activityLabel,
      period,
      stats,
      dailyData,
      hourlyDistribution,
      weekdayDistribution,
    };
  }

  /**
   * Get summary of all activities in a period
   */
  async getActivitySummary(
    period: AnalyticsPeriod = this.getDefaultPeriod(),
  ): Promise<Map<string, DurationStats>> {
    const efforts = await this.getEffortsInPeriod(period);

    // Group by label prefix (first word)
    const groupedByActivity = new Map<string, EffortData[]>();

    for (const effort of efforts) {
      const labelPrefix = effort.label.split(" ")[0];
      if (!groupedByActivity.has(labelPrefix)) {
        groupedByActivity.set(labelPrefix, []);
      }
      groupedByActivity.get(labelPrefix)!.push(effort);
    }

    // Calculate stats for each group
    const summary = new Map<string, DurationStats>();
    for (const [activity, activityEfforts] of groupedByActivity) {
      summary.set(activity, this.calculateDurationStats(activityEfforts));
    }

    return summary;
  }
}
