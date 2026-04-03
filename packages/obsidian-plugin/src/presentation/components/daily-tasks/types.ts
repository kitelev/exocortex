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
  isDone: boolean;
  isTrashed: boolean;
  isDoing: boolean;
  isMeeting: boolean;
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
