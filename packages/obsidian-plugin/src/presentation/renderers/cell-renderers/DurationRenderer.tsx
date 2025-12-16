/**
 * DurationRenderer - Renders duration values in human-readable format
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Parse a duration value into milliseconds.
 *
 * Supports:
 * - Number (milliseconds)
 * - String with ISO 8601 duration (PT1H30M)
 * - String with human-readable format (1h 30m, 90min, etc.)
 */
function parseDuration(value: unknown): number | null {
  if (value == null) return null;

  // Already a number (milliseconds)
  if (typeof value === "number") {
    return isNaN(value) ? null : value;
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Try parsing as pure number (milliseconds) - only if entire string is numeric
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numValue = parseFloat(trimmed);
    if (!isNaN(numValue)) {
      return numValue;
    }
  }

  // Try ISO 8601 duration format (PT1H30M15S)
  const isoMatch = trimmed.match(
    /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i
  );
  if (isoMatch) {
    const days = parseInt(isoMatch[1] || "0", 10);
    const hours = parseInt(isoMatch[2] || "0", 10);
    const minutes = parseInt(isoMatch[3] || "0", 10);
    const seconds = parseFloat(isoMatch[4] || "0");

    return (
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000
    );
  }

  // Try human-readable format (1h 30m, 90min, 2 hours 30 minutes)
  let totalMs = 0;
  const patterns = [
    { regex: /(\d+)\s*(?:d|day|days)/gi, multiplier: 24 * 60 * 60 * 1000 },
    { regex: /(\d+)\s*(?:h|hr|hour|hours)/gi, multiplier: 60 * 60 * 1000 },
    { regex: /(\d+)\s*(?:m|min|minute|minutes)/gi, multiplier: 60 * 1000 },
    { regex: /(\d+)\s*(?:s|sec|second|seconds)/gi, multiplier: 1000 },
  ];

  let matched = false;
  for (const { regex, multiplier } of patterns) {
    const matches = trimmed.matchAll(regex);
    for (const match of matches) {
      totalMs += parseInt(match[1], 10) * multiplier;
      matched = true;
    }
  }

  return matched ? totalMs : null;
}

/**
 * Format duration in milliseconds to human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 0) ms = Math.abs(ms);

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (remainingHours > 0) {
    parts.push(`${remainingHours}h`);
  }
  if (remainingMinutes > 0) {
    parts.push(`${remainingMinutes}m`);
  }
  if (parts.length === 0 || (remainingSeconds > 0 && ms < 60000)) {
    parts.push(`${remainingSeconds}s`);
  }

  return parts.join(" ");
}

/**
 * Renders a cell value as a formatted duration.
 * Supports milliseconds, ISO 8601 durations, and human-readable formats.
 */
export const DurationRenderer: React.FC<CellRendererProps> = ({
  value,
}) => {
  const durationMs = parseDuration(value);

  if (durationMs == null) {
    return <span className="exo-cell-duration exo-cell-duration-empty">-</span>;
  }

  const formatted = formatDuration(durationMs);

  return (
    <span
      className="exo-cell-duration"
      title={`${durationMs}ms`}
    >
      {formatted}
    </span>
  );
};
