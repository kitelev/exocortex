import React, { useState, useMemo } from "react";
import type {
  AnalyticsPeriod,
  SleepAnalysis,
  TaskCompletionAnalysis,
  WeeklyPattern,
  BehavioralInsight,
} from "exocortex";

/**
 * Chart data point for visualization
 */
export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

/**
 * Props for the dashboard component
 */
export interface BehavioralAnalyticsDashboardProps {
  period: AnalyticsPeriod;
  sleepAnalysis?: SleepAnalysis;
  taskAnalysis?: TaskCompletionAnalysis;
  insights: BehavioralInsight[];
  isLoading?: boolean;
  error?: string | null;
  onPeriodChange?: (period: AnalyticsPeriod) => void;
  onRefresh?: () => void;
}

/**
 * Format minutes to human-readable time string
 */
function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Stat card component for displaying a single metric
 */
const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  icon?: string;
}> = ({ title, value, subtitle, trend, trendValue, icon }) => {
  const trendColor =
    trend === "up"
      ? "var(--color-green)"
      : trend === "down"
        ? "var(--color-red)"
        : "var(--text-muted)";
  const trendIcon = trend === "up" ? "^" : trend === "down" ? "v" : "-";

  return (
    <div className="exo-stat-card">
      <div className="exo-stat-card__header">
        {icon && <span className="exo-stat-card__icon">{icon}</span>}
        <span className="exo-stat-card__title">{title}</span>
      </div>
      <div className="exo-stat-card__value">{value}</div>
      {subtitle && (
        <div className="exo-stat-card__subtitle">{subtitle}</div>
      )}
      {trend && trendValue && (
        <div
          className="exo-stat-card__trend"
          style={{ color: trendColor }}
        >
          <span>{trendIcon}</span>
          <span>{trendValue}</span>
        </div>
      )}
    </div>
  );
};

/**
 * Simple bar chart component using pure CSS
 */
const SimpleBarChart: React.FC<{
  data: ChartDataPoint[];
  title: string;
  height?: number;
  color?: string;
}> = ({ data, title, height = 150, color = "var(--interactive-accent)" }) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="exo-chart">
      <div className="exo-chart__title">{title}</div>
      <div className="exo-chart__container" style={{ height }}>
        <div className="exo-chart__bars">
          {data.map((point, index) => {
            const barHeight = (point.value / maxValue) * 100;
            return (
              <div
                key={index}
                className="exo-chart__bar-wrapper"
                title={`${point.date}: ${point.value}`}
              >
                <div
                  className="exo-chart__bar"
                  style={{
                    height: `${barHeight}%`,
                    backgroundColor: color,
                  }}
                />
                <div className="exo-chart__bar-label">
                  {point.date.slice(-2)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * Insight card component for displaying behavioral insights
 */
const InsightCard: React.FC<{
  insight: BehavioralInsight;
}> = ({ insight }) => {
  const severityIcon =
    insight.severity === "critical"
      ? "!!"
      : insight.severity === "warning"
        ? "!"
        : "i";
  const severityClass = `exo-insight--${insight.severity}`;

  return (
    <div className={`exo-insight ${severityClass}`}>
      <div className="exo-insight__header">
        <span className="exo-insight__icon">{severityIcon}</span>
        <span className="exo-insight__type">{insight.type.toUpperCase()}</span>
        {insight.actionable && (
          <span className="exo-insight__actionable">ACTION</span>
        )}
      </div>
      <div className="exo-insight__title">{insight.title}</div>
      <div className="exo-insight__description">{insight.description}</div>
    </div>
  );
};

/**
 * Weekly pattern visualization component
 */
const WeeklyPatternChart: React.FC<{
  patterns: WeeklyPattern[];
  title: string;
}> = ({ patterns, title }) => {
  const maxValue = Math.max(...patterns.map((p) => p.averageValue), 1);

  return (
    <div className="exo-weekly-pattern">
      <div className="exo-weekly-pattern__title">{title}</div>
      <div className="exo-weekly-pattern__grid">
        {patterns.map((pattern) => {
          const heightPercent = (pattern.averageValue / maxValue) * 100;
          return (
            <div
              key={pattern.dayOfWeek}
              className="exo-weekly-pattern__day"
            >
              <div className="exo-weekly-pattern__bar-container">
                <div
                  className={`exo-weekly-pattern__bar ${pattern.isHighPoint ? "exo-weekly-pattern__bar--high" : ""} ${pattern.isLowPoint ? "exo-weekly-pattern__bar--low" : ""}`}
                  style={{ height: `${heightPercent}%` }}
                />
              </div>
              <div className="exo-weekly-pattern__label">
                {pattern.dayName.slice(0, 3)}
              </div>
              <div className="exo-weekly-pattern__value">
                {Math.round(pattern.averageValue)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Main dashboard component for behavioral analytics
 */
export const BehavioralAnalyticsDashboard: React.FC<
  BehavioralAnalyticsDashboardProps
> = ({
  period,
  sleepAnalysis,
  taskAnalysis,
  insights,
  isLoading = false,
  error = null,
  onPeriodChange,
  onRefresh,
}) => {
  const [selectedTab, setSelectedTab] = useState<
    "overview" | "sleep" | "tasks" | "insights"
  >("overview");

  const periodLabel = useMemo(() => {
    return `${formatDate(period.startDate)} - ${formatDate(period.endDate)}`;
  }, [period]);

  // Handle period quick select
  const handlePeriodSelect = (days: number) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    onPeriodChange?.({ startDate, endDate });
  };

  if (error) {
    return (
      <div className="exo-dashboard exo-dashboard--error">
        <div className="exo-dashboard__error">
          <span className="exo-dashboard__error-icon">!!</span>
          <span className="exo-dashboard__error-message">{error}</span>
          {onRefresh && (
            <button
              className="exo-dashboard__refresh-btn"
              onClick={onRefresh}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="exo-dashboard">
      {/* Header */}
      <div className="exo-dashboard__header">
        <div className="exo-dashboard__title">Behavioral Analytics</div>
        <div className="exo-dashboard__period">{periodLabel}</div>
        <div className="exo-dashboard__actions">
          <button
            className={`exo-dashboard__period-btn ${period.endDate.getTime() - period.startDate.getTime() < 8 * 24 * 60 * 60 * 1000 ? "active" : ""}`}
            onClick={() => handlePeriodSelect(7)}
          >
            7d
          </button>
          <button
            className={`exo-dashboard__period-btn ${period.endDate.getTime() - period.startDate.getTime() >= 28 * 24 * 60 * 60 * 1000 && period.endDate.getTime() - period.startDate.getTime() < 32 * 24 * 60 * 60 * 1000 ? "active" : ""}`}
            onClick={() => handlePeriodSelect(30)}
          >
            30d
          </button>
          <button
            className={`exo-dashboard__period-btn ${period.endDate.getTime() - period.startDate.getTime() >= 88 * 24 * 60 * 60 * 1000 ? "active" : ""}`}
            onClick={() => handlePeriodSelect(90)}
          >
            90d
          </button>
          {onRefresh && (
            <button
              className="exo-dashboard__refresh-btn"
              onClick={onRefresh}
              disabled={isLoading}
            >
              {isLoading ? "..." : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="exo-dashboard__tabs">
        <button
          className={`exo-dashboard__tab ${selectedTab === "overview" ? "active" : ""}`}
          onClick={() => setSelectedTab("overview")}
        >
          Overview
        </button>
        <button
          className={`exo-dashboard__tab ${selectedTab === "sleep" ? "active" : ""}`}
          onClick={() => setSelectedTab("sleep")}
        >
          Sleep
        </button>
        <button
          className={`exo-dashboard__tab ${selectedTab === "tasks" ? "active" : ""}`}
          onClick={() => setSelectedTab("tasks")}
        >
          Tasks
        </button>
        <button
          className={`exo-dashboard__tab ${selectedTab === "insights" ? "active" : ""}`}
          onClick={() => setSelectedTab("insights")}
        >
          Insights ({insights.length})
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="exo-dashboard__loading">
          <div className="exo-dashboard__loading-spinner" />
          <span>Loading analytics...</span>
        </div>
      )}

      {/* Content area */}
      {!isLoading && (
        <div className="exo-dashboard__content">
          {/* Overview Tab */}
          {selectedTab === "overview" && (
            <div className="exo-dashboard__overview">
              {/* Key metrics */}
              <div className="exo-dashboard__metrics-grid">
                {sleepAnalysis && (
                  <>
                    <StatCard
                      title="Average Sleep"
                      value={formatMinutesToTime(
                        sleepAnalysis.stats.averageMinutes,
                      )}
                      subtitle={`${sleepAnalysis.stats.count} nights`}
                      icon="z"
                    />
                    <StatCard
                      title="Avg Bedtime"
                      value={sleepAnalysis.averageBedtime}
                      subtitle={`+/-${sleepAnalysis.bedtimeVariabilityMinutes}m`}
                      icon="M"
                    />
                    <StatCard
                      title="Avg Wake Time"
                      value={sleepAnalysis.averageWakeTime}
                      subtitle={`+/-${sleepAnalysis.wakeTimeVariabilityMinutes}m`}
                      icon="S"
                    />
                  </>
                )}
                {taskAnalysis && (
                  <>
                    <StatCard
                      title="Task Completion"
                      value={`${taskAnalysis.completionRate}%`}
                      subtitle={`${taskAnalysis.completedTasks}/${taskAnalysis.totalTasks} tasks`}
                      icon="T"
                    />
                    <StatCard
                      title="Avg Task Time"
                      value={formatMinutesToTime(
                        taskAnalysis.averageCompletionTimeMinutes,
                      )}
                      subtitle="per task"
                      icon="C"
                    />
                  </>
                )}
              </div>

              {/* Critical insights */}
              {insights.filter((i) => i.severity === "critical").length > 0 && (
                <div className="exo-dashboard__section">
                  <h3 className="exo-dashboard__section-title">
                    Critical Insights
                  </h3>
                  <div className="exo-dashboard__insights">
                    {insights
                      .filter((i) => i.severity === "critical")
                      .map((insight, index) => (
                        <InsightCard key={index} insight={insight} />
                      ))}
                  </div>
                </div>
              )}

              {/* Daily trend chart */}
              {sleepAnalysis && sleepAnalysis.dailyData.length > 0 && (
                <div className="exo-dashboard__section">
                  <SimpleBarChart
                    title="Sleep Duration (minutes)"
                    data={sleepAnalysis.dailyData.slice(-14).map((d) => ({
                      date: d.date,
                      value: d.averageMinutes,
                    }))}
                    color="var(--interactive-accent)"
                  />
                </div>
              )}

              {/* Task completion chart */}
              {taskAnalysis && taskAnalysis.dailyCompletions.length > 0 && (
                <div className="exo-dashboard__section">
                  <SimpleBarChart
                    title="Daily Task Completions"
                    data={taskAnalysis.dailyCompletions.slice(-14).map((d) => ({
                      date: d.date,
                      value: d.count,
                    }))}
                    color="var(--color-green)"
                  />
                </div>
              )}
            </div>
          )}

          {/* Sleep Tab */}
          {selectedTab === "sleep" && sleepAnalysis && (
            <div className="exo-dashboard__sleep">
              {/* Sleep stats */}
              <div className="exo-dashboard__metrics-grid">
                <StatCard
                  title="Total Nights"
                  value={sleepAnalysis.stats.count}
                  icon="#"
                />
                <StatCard
                  title="Average Duration"
                  value={formatMinutesToTime(sleepAnalysis.stats.averageMinutes)}
                  icon="~"
                />
                <StatCard
                  title="Shortest Night"
                  value={formatMinutesToTime(sleepAnalysis.stats.minMinutes)}
                  icon="v"
                />
                <StatCard
                  title="Longest Night"
                  value={formatMinutesToTime(sleepAnalysis.stats.maxMinutes)}
                  icon="^"
                />
                <StatCard
                  title="Variability"
                  value={`+/-${Math.round(sleepAnalysis.stats.stdDevMinutes)}m`}
                  subtitle="std deviation"
                  icon="*"
                />
                <StatCard
                  title="Bedtime Regularity"
                  value={
                    sleepAnalysis.bedtimeVariabilityMinutes < 30
                      ? "Excellent"
                      : sleepAnalysis.bedtimeVariabilityMinutes < 60
                        ? "Good"
                        : "Needs work"
                  }
                  subtitle={`+/-${sleepAnalysis.bedtimeVariabilityMinutes}m`}
                  icon="R"
                />
              </div>

              {/* Sleep duration chart */}
              <div className="exo-dashboard__section">
                <SimpleBarChart
                  title="Sleep Duration by Day"
                  data={sleepAnalysis.dailyData.map((d) => ({
                    date: d.date,
                    value: d.averageMinutes,
                  }))}
                  height={200}
                />
              </div>

              {/* Weekly pattern chart */}
              {sleepAnalysis.weeklyPattern && sleepAnalysis.weeklyPattern.length > 0 && (
                <div className="exo-dashboard__section">
                  <WeeklyPatternChart
                    patterns={sleepAnalysis.weeklyPattern}
                    title="Sleep by Day of Week"
                  />
                </div>
              )}
            </div>
          )}

          {/* Tasks Tab */}
          {selectedTab === "tasks" && taskAnalysis && (
            <div className="exo-dashboard__tasks">
              {/* Task stats */}
              <div className="exo-dashboard__metrics-grid">
                <StatCard
                  title="Total Tasks"
                  value={taskAnalysis.totalTasks}
                  icon="#"
                />
                <StatCard
                  title="Completed"
                  value={taskAnalysis.completedTasks}
                  icon="/"
                />
                <StatCard
                  title="Trashed"
                  value={taskAnalysis.trashedTasks}
                  icon="x"
                />
                <StatCard
                  title="Completion Rate"
                  value={`${taskAnalysis.completionRate}%`}
                  icon="%"
                />
                <StatCard
                  title="Avg Time to Complete"
                  value={formatMinutesToTime(
                    taskAnalysis.averageCompletionTimeMinutes,
                  )}
                  icon="C"
                />
              </div>

              {/* Daily completions chart */}
              {taskAnalysis.dailyCompletions.length > 0 && (
                <div className="exo-dashboard__section">
                  <SimpleBarChart
                    title="Tasks Completed Per Day"
                    data={taskAnalysis.dailyCompletions.map((d) => ({
                      date: d.date,
                      value: d.count,
                    }))}
                    height={200}
                    color="var(--color-green)"
                  />
                </div>
              )}
            </div>
          )}

          {/* Insights Tab */}
          {selectedTab === "insights" && (
            <div className="exo-dashboard__insights-tab">
              {insights.length === 0 ? (
                <div className="exo-dashboard__empty">
                  <span>No insights available for this period.</span>
                  <span className="exo-dashboard__empty-hint">
                    Try expanding the date range or adding more data.
                  </span>
                </div>
              ) : (
                <div className="exo-dashboard__insights-list">
                  {/* Group by severity */}
                  {["critical", "warning", "info"].map((severity) => {
                    const severityInsights = insights.filter(
                      (i) => i.severity === severity,
                    );
                    if (severityInsights.length === 0) return null;
                    return (
                      <div key={severity} className="exo-dashboard__insight-group">
                        <h3 className="exo-dashboard__insight-group-title">
                          {severity === "critical"
                            ? "Critical"
                            : severity === "warning"
                              ? "Warnings"
                              : "Information"}
                          ({severityInsights.length})
                        </h3>
                        {severityInsights.map((insight, index) => (
                          <InsightCard key={index} insight={insight} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BehavioralAnalyticsDashboard;
