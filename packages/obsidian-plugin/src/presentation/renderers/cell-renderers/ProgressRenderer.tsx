/**
 * ProgressRenderer - Renders progress values as a progress bar
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Parse a value into a progress percentage (0-100).
 */
function parseProgress(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === "number") {
    // Assume values > 1 are percentages, values <= 1 are ratios
    const progress = value > 1 ? value : value * 100;
    return isNaN(progress) ? null : Math.max(0, Math.min(100, progress));
  }

  if (typeof value === "string") {
    // Try parsing as percentage string (e.g., "75%")
    const percentMatch = value.match(/^(\d+(?:\.\d+)?)\s*%?$/);
    if (percentMatch) {
      const num = parseFloat(percentMatch[1]);
      return isNaN(num) ? null : Math.max(0, Math.min(100, num));
    }
    return null;
  }

  return null;
}

/**
 * Get CSS color class based on progress percentage.
 */
function getProgressColorClass(progress: number): string {
  if (progress >= 100) return "exo-progress-complete";
  if (progress >= 75) return "exo-progress-high";
  if (progress >= 50) return "exo-progress-medium";
  if (progress >= 25) return "exo-progress-low";
  return "exo-progress-minimal";
}

/**
 * Renders a cell value as a progress bar.
 * Values can be percentages (0-100) or ratios (0-1).
 */
export const ProgressRenderer: React.FC<CellRendererProps> = ({
  value,
}) => {
  const progress = parseProgress(value);

  if (progress == null) {
    return <span className="exo-cell-progress exo-cell-progress-empty">-</span>;
  }

  const colorClass = getProgressColorClass(progress);
  const roundedProgress = Math.round(progress);

  return (
    <div
      className={`exo-cell-progress ${colorClass}`}
      title={`${roundedProgress}%`}
    >
      <div className="exo-progress-track">
        <div
          className="exo-progress-fill"
          style={{ width: `${roundedProgress}%` }}
        />
      </div>
      <span className="exo-progress-label">{roundedProgress}%</span>
    </div>
  );
};
