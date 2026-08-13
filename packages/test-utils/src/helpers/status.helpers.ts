/**
 * Shared effort status helpers for test factories.
 *
 * Single source of truth for status name-to-URI mapping within test-utils.
 * Eliminates duplication across task, project, and meeting factories.
 *
 * Issue #2463
 */

import type { EffortStatus, EffortStatusName } from "../types";

/**
 * Map human-readable status names to ems__ format.
 */
export const STATUS_MAP: Record<EffortStatusName, EffortStatus> = {
  Draft: "ems__EffortStatusDraft",
  Backlog: "ems__EffortStatusBacklog",
  Doing: "ems__EffortStatusDoing",
  Waiting: "ems__EffortStatusWaiting",
  Done: "ems__EffortStatusDone",
  Trashed: "ems__EffortStatusTrashed",
};

/**
 * Normalize status to the ems__ format.
 */
export function normalizeStatus(
  status: EffortStatus | EffortStatusName,
  fallback: EffortStatus = "ems__EffortStatusDraft",
): EffortStatus {
  if (status.startsWith("ems__")) {
    return status as EffortStatus;
  }
  return STATUS_MAP[status as EffortStatusName] || fallback;
}

/**
 * Check if a status indicates "done" state.
 */
export function isDoneStatus(status: EffortStatus): boolean {
  return status === "ems__EffortStatusDone";
}

/**
 * Check if a status indicates "trashed" state.
 */
export function isTrashedStatus(status: EffortStatus): boolean {
  return status === "ems__EffortStatusTrashed";
}

/**
 * Check if a status indicates "doing" state.
 */
export function isDoingStatus(status: EffortStatus): boolean {
  return status === "ems__EffortStatusDoing";
}
