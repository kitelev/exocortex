import type { DailyTask, WikiLink } from './types';

/**
 * Calculate duration in minutes from timestamps when explicit timeEstimateMinutes is missing.
 * Issue #2236: Dynamic time calculation for Time column in DailyNote Tasks table.
 *
 * Priority order:
 * 1. Calculate from actual timestamps (startTimestamp -> endTimestamp)
 * 2. Calculate from planned timestamps (plannedStartTimestamp -> plannedEndTimestamp)
 * 3. Return null if no valid timestamp pair
 *
 * @param metadata - Task metadata containing timestamp fields
 * @returns Duration in minutes, or null if no valid timestamps
 */
export const calculateTimeFromTimestamps = (
  metadata: Record<string, unknown>
): number | null => {
  // Priority 1: Actual timestamps (fact > plan)
  const startActual = metadata.ems__Effort_startTimestamp;
  const endActual = metadata.ems__Effort_endTimestamp;

  if (startActual != null && endActual != null) {
    const start = new Date(startActual as string | number).getTime();
    const end = new Date(endActual as string | number).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      return Math.round((end - start) / (1000 * 60));
    }
  }

  // Priority 2: Planned timestamps
  const startPlanned = metadata.ems__Effort_plannedStartTimestamp;
  const endPlanned = metadata.ems__Effort_plannedEndTimestamp;

  if (startPlanned != null && endPlanned != null) {
    const start = new Date(startPlanned as string | number).getTime();
    const end = new Date(endPlanned as string | number).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      return Math.round((end - start) / (1000 * 60));
    }
  }

  return null;
};

/**
 * Detect if two time periods overlap.
 * Uses strict inequality (< not <=) so touching periods (end1 === start2) are not considered overlapping.
 */
export const periodsOverlap = (
  start1: number,
  end1: number,
  start2: number,
  end2: number,
): boolean => {
  return start1 < end2 && start2 < end1;
};

/**
 * Check if a class list contains ems__Context class.
 * Handles both string and array formats.
 */
const classListHasContext = (classes: unknown): boolean => {
  if (classes == null) {
    return false;
  }

  if (Array.isArray(classes)) {
    return classes.some((c: unknown) =>
      typeof c === 'string' && c.includes('ems__Context')
    );
  }

  if (typeof classes === 'string') {
    return classes.includes('ems__Context');
  }

  return false;
};

/**
 * Check if a task is a context task (has ems__Context class).
 * Context tasks describe WHERE or HOW other tasks are executed, not WHAT is being done.
 * They should be excluded from overlap detection to avoid false-positive scheduling conflicts.
 */
export const isContextTask = (metadata: Record<string, unknown>): boolean => {
  if (classListHasContext(metadata.exo__Instance_class)) {
    return true;
  }

  if (classListHasContext(metadata._prototypeClasses)) {
    return true;
  }

  return false;
};

export const parseWikiLink = (value: string): WikiLink => {
  const content = value.replace(/^\[\[|\]\]$/g, "");
  const pipeIndex = content.indexOf("|");

  if (pipeIndex !== -1) {
    return {
      target: content.substring(0, pipeIndex).trim(),
      alias: content.substring(pipeIndex + 1).trim(),
    };
  }

  return {
    target: content.trim(),
  };
};

/**
 * Formats time estimate in minutes to a human-readable string.
 * Examples: 90 -> "1h 30m", 45 -> "45m", 120 -> "2h", 0 -> "-", null -> "-"
 */
export const formatTimeEstimate = (minutes: number | null | undefined): string => {
  if (minutes == null || minutes <= 0) return "-";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

/**
 * Compose the DailyNote task-cell label.
 *
 * The status/class prefix (\uD83D\uDD04 Doing, \u2705 Done, \u274C Trashed, \uD83D\uDC65 Meeting) is HOMOICONIC \u2014 it is
 * carried by `task.displayName`, resolved by DailyTasksRenderer through the vault
 * `exo__DisplayNameSpec` system (single source of truth, same as native Obsidian links). This
 * helper no longer re-implements a hardcoded emoji map (Issue: req a577316f).
 *
 * The \uD83D\uDEA9 blocked marker is RETAINED renderer-side: it is a computed predicate over the
 * referenced blocker asset's status, which the current single-value exo__DisplayNameSpec
 * matcher cannot express \u2014 tracked as a separate engine-extension follow-up.
 *
 * When `task.displayName` is unavailable (empty slots, or no printNameRuleService in tests)
 * the old label path is used: a custom `getAssetLabel(path)` wins over `task.label`.
 */
export const getDisplayName = (
  task: DailyTask,
  getAssetLabel?: (path: string) => string | null,
): string => {
  const blockerIcon = task.isBlocked ? "\uD83D\uDEA9 " : "";

  if (task.displayName != null && task.displayName !== "") {
    return blockerIcon + task.displayName;
  }

  // Fallback: no resolver-driven name \u2192 old label path (no status/class prefix).
  let displayText = task.label || task.title;

  if (typeof getAssetLabel === "function") {
    const customLabel = getAssetLabel(task.path);
    if (
      customLabel !== null &&
      customLabel !== undefined &&
      customLabel !== ""
    ) {
      displayText = customLabel;
    }
  }

  return blockerIcon + displayText;
};

export const getEffortAreaDisplayText = (
  task: DailyTask,
  getEffortArea?: (metadata: Record<string, unknown>) => string | null,
): string => {
  let effortArea: unknown = null;

  if (getEffortArea) {
    effortArea = getEffortArea(task.metadata);
  }

  if (!effortArea) {
    effortArea = task.metadata.ems__Effort_area;
  }

  if (!effortArea) return "";

  const effortAreaStr = String(effortArea);

  if (/\[\[.*?\]\]/.test(effortAreaStr)) {
    const parsed = parseWikiLink(effortAreaStr);
    return (parsed.alias || parsed.target).toLowerCase();
  } else if (effortAreaStr.includes("|")) {
    const parts = effortAreaStr.split("|");
    const alias = parts[1]?.trim() || parts[0].trim();
    return alias.toLowerCase();
  } else {
    return effortAreaStr.trim().toLowerCase();
  }
};

const DATE_ONLY_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Detects "date only" string timestamps that have no time component.
 *
 * Such values get parsed by `new Date()` as UTC midnight, which then renders
 * as the wrong wall-clock hour in any non-UTC timezone — e.g. `"2025-11-10"`
 * displays as `05:00` for a viewer in `Asia/Almaty` (UTC+5).
 *
 * Issue #2766 item 6: callers should suppress the time portion when this
 * helper returns true so the daily layout does not leak the local timezone
 * offset of whoever happens to be viewing the vault.
 */
export const isDateOnlyTimestamp = (
  value: unknown,
): value is string =>
  typeof value === "string" && DATE_ONLY_TIMESTAMP_REGEX.test(value);

export const formatTimeDisplay = (
  timestamp: string | number | null | undefined,
  fallbackFormatted: string,
  showFullDateInEffortTimes: boolean,
): string => {
  if (!timestamp) return fallbackFormatted || "-";

  // Date-only strings have no real time component. Computing one via
  // `new Date(...).getHours()` would expose the viewer's timezone offset,
  // so suppress it (Issue #2766 item 6).
  if (isDateOnlyTimestamp(timestamp)) {
    if (showFullDateInEffortTimes) {
      // Pure-string slice avoids any Date / TZ involvement: "YYYY-MM-DD" → "MM-DD".
      return timestamp.slice(5);
    }
    return fallbackFormatted || "-";
  }

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return fallbackFormatted || "-";

  if (showFullDateInEffortTimes) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  } else {
    return fallbackFormatted || "-";
  }
};

/**
 * Creates an empty time slot entry.
 */
export const createEmptySlot = (
  startTimestamp: number,
  endTimestamp: number,
  index: number,
): DailyTask => {
  const formatTime = (ts: number): string => {
    const date = new Date(ts);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  return {
    file: { path: `empty-slot-${index}`, basename: `empty-slot-${index}` },
    path: `empty-slot-${index}`,
    title: "-",
    label: "-",
    startTime: formatTime(startTimestamp),
    endTime: formatTime(endTimestamp),
    startTimestamp,
    endTimestamp,
    status: "-",
    metadata: {
      ems__Effort_startTimestamp: startTimestamp,
      ems__Effort_endTimestamp: endTimestamp,
    },
    isDoing: false,
    isBlocked: false,
    isEmptySlot: true,
  };
};

/**
 * Calculates empty time slots between tasks.
 * Only considers tasks that have both start and end timestamps.
 * Minimum gap size is 5 minutes.
 */
export const calculateEmptySlots = (taskList: DailyTask[]): DailyTask[] => {
  type TaskWithTimestamps = DailyTask & {
    startTimestamp: string | number;
    endTimestamp: string | number;
  };

  const hasValidTimestamps = (t: DailyTask): t is TaskWithTimestamps =>
    !t.isEmptySlot && t.startTimestamp !== null && t.endTimestamp !== null;

  const tasksWithTime = taskList
    .filter(hasValidTimestamps)
    .map((t) => ({
      task: t,
      start: new Date(t.startTimestamp).getTime(),
      end: new Date(t.endTimestamp).getTime(),
    }))
    .sort((a, b) => a.start - b.start);

  if (tasksWithTime.length === 0) {
    return taskList;
  }

  const emptySlots: DailyTask[] = [];
  const MIN_GAP_MS = 5 * 60 * 1000;

  for (let i = 0; i < tasksWithTime.length - 1; i++) {
    const currentEnd = tasksWithTime[i].end;
    const nextStart = tasksWithTime[i + 1].start;

    if (nextStart - currentEnd >= MIN_GAP_MS) {
      emptySlots.push(createEmptySlot(currentEnd, nextStart, i));
    }
  }

  const result = [...taskList, ...emptySlots];
  return result.sort((a, b) => {
    const aStart = a.startTimestamp ? new Date(a.startTimestamp).getTime() : 0;
    const bStart = b.startTimestamp ? new Date(b.startTimestamp).getTime() : 0;
    return aStart - bStart;
  });
};
