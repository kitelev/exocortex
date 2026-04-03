import { EffortStatus } from "./EffortStatus";

/**
 * Human-readable status name type.
 */
export type EffortStatusName =
  | "Draft"
  | "Backlog"
  | "Analysis"
  | "To Do"
  | "Doing"
  | "Done"
  | "Trashed";

/**
 * Single source of truth for effort status configuration.
 *
 * Maps human-readable names to EffortStatus enum values and wikilink format.
 * All packages must use these mappings instead of defining their own.
 *
 * Issue #2463
 */
export const EFFORT_STATUS_CONFIG: ReadonlyArray<{
  readonly name: EffortStatusName;
  readonly status: EffortStatus;
  readonly wikilink: string;
}> = [
  { name: "Draft", status: EffortStatus.DRAFT, wikilink: "[[ems__EffortStatusDraft]]" },
  { name: "Backlog", status: EffortStatus.BACKLOG, wikilink: "[[ems__EffortStatusBacklog]]" },
  { name: "Analysis", status: EffortStatus.ANALYSIS, wikilink: "[[ems__EffortStatusAnalysis]]" },
  { name: "To Do", status: EffortStatus.TODO, wikilink: "[[ems__EffortStatusToDo]]" },
  { name: "Doing", status: EffortStatus.DOING, wikilink: "[[ems__EffortStatusDoing]]" },
  { name: "Done", status: EffortStatus.DONE, wikilink: "[[ems__EffortStatusDone]]" },
  { name: "Trashed", status: EffortStatus.TRASHED, wikilink: "[[ems__EffortStatusTrashed]]" },
] as const;

/**
 * Map from human-readable name to EffortStatus enum value.
 *
 * Example: STATUS_NAME_TO_ENUM["To Do"] === "ems__EffortStatusToDo"
 */
export const STATUS_NAME_TO_ENUM: Readonly<Record<EffortStatusName, EffortStatus>> =
  Object.fromEntries(
    EFFORT_STATUS_CONFIG.map((c) => [c.name, c.status]),
  ) as Record<EffortStatusName, EffortStatus>;

/**
 * Map from human-readable name to wikilink format.
 *
 * Example: STATUS_NAME_TO_WIKILINK["Doing"] === "[[ems__EffortStatusDoing]]"
 */
export const STATUS_NAME_TO_WIKILINK: Readonly<Record<EffortStatusName, string>> =
  Object.fromEntries(
    EFFORT_STATUS_CONFIG.map((c) => [c.name, c.wikilink]),
  ) as Record<EffortStatusName, string>;

/**
 * Effort status values with label and wikilink, for UI dropdowns and selects.
 *
 * Example: [{ value: "[[ems__EffortStatusDraft]]", label: "Draft" }, ...]
 */
export const EFFORT_STATUS_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> =
  EFFORT_STATUS_CONFIG.map((c) => ({ value: c.wikilink, label: c.name }));

/**
 * Normalize a status value (name or ems__ format) to the EffortStatus enum value.
 *
 * @param status - Human-readable name ("To Do") or ems__ format ("ems__EffortStatusToDo")
 * @param fallback - Fallback status if input is unknown (defaults to DRAFT)
 * @returns Normalized EffortStatus enum value
 */
export function normalizeEffortStatus(
  status: string,
  fallback: EffortStatus = EffortStatus.DRAFT,
): EffortStatus {
  if (status.startsWith("ems__")) {
    const found = EFFORT_STATUS_CONFIG.find((c) => c.status === status);
    return found ? found.status : fallback;
  }
  const entry = STATUS_NAME_TO_ENUM[status as EffortStatusName];
  return entry ?? fallback;
}

/**
 * Check if a status indicates "done" state.
 */
export function isDoneStatus(status: string): boolean {
  return status === EffortStatus.DONE;
}

/**
 * Check if a status indicates "trashed" state.
 */
export function isTrashedStatus(status: string): boolean {
  return status === EffortStatus.TRASHED;
}

/**
 * Convert an effort status value to a human-readable label.
 *
 * Handles various input formats: raw URI, wiki-link wrapped, already a label,
 * and case-insensitive label matching.
 *
 * @param statusValue - The status value in any format
 * @returns Human-readable label or "-" for null/undefined/empty
 */
export function getEffortStatusLabel(statusValue: string | null | undefined): string {
  if (!statusValue) return "-";

  const statusStr = String(statusValue);
  if (statusStr === "") return "-";

  for (const config of EFFORT_STATUS_CONFIG) {
    if (config.wikilink === statusStr) return config.name;
    if (`[[${statusStr}]]` === config.wikilink) return config.name;
    if (config.status === statusStr) return config.name;
    if (config.name === statusStr) return config.name;
  }

  const lower = statusStr.toLowerCase();
  for (const config of EFFORT_STATUS_CONFIG) {
    if (config.name.toLowerCase() === lower) return config.name;
  }

  return statusStr;
}
