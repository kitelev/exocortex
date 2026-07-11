import React from "react";

export interface DailyTask {
  file: {
    path: string;
    basename: string;
  };
  path: string;
  title: string;
  label: string;
  startTime: string;
  endTime: string;
  startTimestamp: string | number | null;
  endTimestamp: string | number | null;
  status: string;
  metadata: Record<string, unknown>;
  /**
   * Homoiconic display name resolved through the vault `exo__DisplayNameSpec` system
   * (DisplayNameResolver + PrintNameRuleService), computed by DailyTasksRenderer. Carries
   * the status/class prefix (🔄/✅/❌/👥) declared in vault data — single source of truth,
   * same as native Obsidian links. Undefined when no resolver is available (fallback to label).
   */
  displayName?: string;
  /**
   * Dual-IRI-robust "Doing" flag (derived via getStatusLabel, NOT a naive strict-equality
   * against a label-form enum). Used for the NON-display sort that lifts Doing tasks to the top.
   */
  isDoing: boolean;
  /**
   * @deprecated Display-only status/class flags — the status/class prefix is now homoiconic
   * (see `displayName`), so these no longer drive rendering. Retained optional for the
   * DailyTask shape's backward-compat (many test fixtures still set them); not computed by
   * the renderer nor read by getDisplayName.
   */
  isDone?: boolean;
  isTrashed?: boolean;
  isMeeting?: boolean;
  isBlocked: boolean;
  isEmptySlot?: boolean;
}

export interface DailyTasksTableProps {
  tasks: DailyTask[];
  onTaskClick?: (path: string, event: React.MouseEvent) => void;
  getAssetLabel?: (path: string) => string | null;
  getEffortArea?: (metadata: Record<string, unknown>) => string | null;
  showEffortArea?: boolean;
  showEffortVotes?: boolean;
  showArchived?: boolean;
  showFullDateInEffortTimes?: boolean;
  focusMode?: boolean;
  showEmptySlots?: boolean;
  showTime?: boolean;
  showStatus?: boolean;
  showTimeEstimate?: boolean;
}

export interface DailyTasksTableWithToggleProps
  extends Omit<
    DailyTasksTableProps,
    | "showEffortArea"
    | "showEffortVotes"
    | "showArchived"
    | "showFullDateInEffortTimes"
    | "focusMode"
    | "showEmptySlots"
    | "showTime"
    | "showStatus"
    | "showTimeEstimate"
  > {
  showEffortArea?: boolean;
  onToggleEffortArea?: () => void;
  showEffortVotes?: boolean;
  onToggleEffortVotes?: () => void;
  showArchived?: boolean;
  onToggleArchived?: () => void;
  showFullDateInEffortTimes?: boolean;
  onToggleFullDate?: () => void;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  showEmptySlots?: boolean;
  onToggleEmptySlots?: () => void;
  showTime?: boolean;
  onToggleTime?: () => void;
  showStatus?: boolean;
  onToggleStatus?: () => void;
  showTimeEstimate?: boolean;
  onToggleTimeEstimate?: () => void;
}

export interface WikiLink {
  target: string;
  alias?: string;
}
