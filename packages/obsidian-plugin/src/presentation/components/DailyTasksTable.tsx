import React, { useMemo, useRef, useState, useLayoutEffect, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MetadataHelpers, EffortSortingHelpers } from "exocortex";
import { useTableSortStore, useUIStore } from '@plugin/presentation/stores';

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
}

export const DailyTasksTable: React.FC<DailyTasksTableProps> = ({
  tasks,
  onTaskClick,
  getAssetLabel,
  getEffortArea,
  showEffortArea: propShowEffortArea,
  showEffortVotes: propShowEffortVotes,
  showArchived: propShowArchived,
  showFullDateInEffortTimes: propShowFullDate,
  focusMode: propFocusMode,
  showEmptySlots: propShowEmptySlots,
  showTime: propShowTime,
  showStatus: propShowStatus,
}) => {
  const sortState = useTableSortStore((state) => state.dailyTasks);
  const toggleSort = useTableSortStore((state) => state.toggleSort);

  const storeShowArchived = useUIStore((state) => state.showArchived);
  const storeShowEffortArea = useUIStore((state) => state.showEffortArea);
  const storeShowEffortVotes = useUIStore((state) => state.showEffortVotes);
  const storeShowFullDate = useUIStore(
    (state) => state.showFullDateInEffortTimes,
  );
  const storeFocusMode = useUIStore((state) => state.focusMode);
  const storeShowEmptySlots = useUIStore((state) => state.showEmptySlots);
  const storeShowTime = useUIStore((state) => state.showTime);
  const storeShowStatus = useUIStore((state) => state.showStatus);

  const showArchived = propShowArchived ?? storeShowArchived;
  const showEffortArea = propShowEffortArea ?? storeShowEffortArea;
  const showEffortVotes = propShowEffortVotes ?? storeShowEffortVotes;
  const showFullDateInEffortTimes = propShowFullDate ?? storeShowFullDate;
  const focusMode = propFocusMode ?? storeFocusMode;
  const showEmptySlots = propShowEmptySlots ?? storeShowEmptySlots;
  const showTime = propShowTime ?? storeShowTime;
  const showStatus = propShowStatus ?? storeShowStatus;

  const handleSort = (column: string) => {
    toggleSort("dailyTasks", column);
  };

  interface WikiLink {
    target: string;
    alias?: string;
  }

  const parseWikiLink = (value: string): WikiLink => {
    // Remove [[ and ]]
    const content = value.replace(/^\[\[|\]\]$/g, "");

    // Check if there's an alias (format: target|alias)
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

  const getDisplayName = (task: DailyTask): string => {
    const blockerIcon = task.isBlocked ? "🚩 " : "";
    const icon =
      task.isDone && task.isMeeting
        ? "✅ 👥 "
        : task.isDone
          ? "✅ "
          : task.isTrashed
            ? "❌ "
            : task.isDoing
              ? "🔄 "
              : task.isMeeting
                ? "👥 "
                : "";

    let displayText = task.label || task.title;

    // Check if getAssetLabel function is provided
    if (typeof getAssetLabel === "function") {
      const customLabel = getAssetLabel(task.path);
      // Only use custom label if it's a non-null, non-empty string
      if (
        customLabel !== null &&
        customLabel !== undefined &&
        customLabel !== ""
      ) {
        displayText = customLabel;
      }
    }

    return blockerIcon + icon + displayText;
  };

  const getEffortAreaDisplayText = (task: DailyTask): string => {
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

  const formatTimeDisplay = (
    timestamp: string | number | null | undefined,
    fallbackFormatted: string,
  ): string => {
    if (!timestamp) return fallbackFormatted || "-";

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

  const sortedTasks = useMemo(() => {
    let filtered = tasks;

    if (!showArchived) {
      filtered = tasks.filter((task) => {
        return !MetadataHelpers.isAssetArchived(task.metadata);
      });
    }

    const doingTasks = filtered.filter((task) => task.isDoing);
    const otherTasks = filtered.filter((task) => !task.isDoing);

    const applySorting = (taskList: DailyTask[]): DailyTask[] => {
      const sorted = [...taskList];

      // Default sorting by start time when no column is selected
      if (!sortState.column) {
        return sorted.sort((a, b) => EffortSortingHelpers.sortByStartTime(a, b));
      }

      sorted.sort((a, b) => {
        let aValue: string | number;
        let bValue: string | number;

        switch (sortState.column) {
          case "name":
            aValue = getDisplayName(a).toLowerCase();
            bValue = getDisplayName(b).toLowerCase();
            break;
          case "start":
            aValue = a.startTimestamp
              ? new Date(a.startTimestamp).getTime()
              : 0;
            bValue = b.startTimestamp
              ? new Date(b.startTimestamp).getTime()
              : 0;
            break;
          case "end":
            aValue = a.endTimestamp ? new Date(a.endTimestamp).getTime() : 0;
            bValue = b.endTimestamp ? new Date(b.endTimestamp).getTime() : 0;
            break;
          case "status":
            aValue = a.status?.toLowerCase() || "";
            bValue = b.status?.toLowerCase() || "";
            break;
          case "effortArea":
            aValue = getEffortAreaDisplayText(a);
            bValue = getEffortAreaDisplayText(b);
            break;
          case "votes":
            aValue = typeof a.metadata.ems__Effort_votes === "number"
              ? a.metadata.ems__Effort_votes
              : -1;
            bValue = typeof b.metadata.ems__Effort_votes === "number"
              ? b.metadata.ems__Effort_votes
              : -1;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) {
          return sortState.order === "asc" ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortState.order === "asc" ? 1 : -1;
        }
        return 0;
      });

      return sorted;
    };

    const sortedDoing = applySorting(doingTasks);
    const sortedOthers = applySorting(otherTasks);

    return [...sortedDoing, ...sortedOthers];
  }, [tasks, sortState, getAssetLabel, getEffortArea, showArchived]);

  /**
   * Creates an empty time slot entry.
   */
  const createEmptySlot = (
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
      metadata: {},
      isDone: false,
      isTrashed: false,
      isDoing: false,
      isMeeting: false,
      isBlocked: false,
      isEmptySlot: true,
    };
  };

  /**
   * Calculates empty time slots between tasks.
   * Only considers tasks that have both start and end timestamps.
   * Minimum gap size is 5 minutes.
   */
  const calculateEmptySlots = (taskList: DailyTask[]): DailyTask[] => {
    // Filter tasks with valid timestamps and sort by start time
    const tasksWithTime = taskList
      .filter((t) => !t.isEmptySlot && t.startTimestamp && t.endTimestamp)
      .map((t) => ({
        task: t,
        start: new Date(t.startTimestamp!).getTime(),
        end: new Date(t.endTimestamp!).getTime(),
      }))
      .sort((a, b) => a.start - b.start);

    if (tasksWithTime.length === 0) {
      return taskList;
    }

    const emptySlots: DailyTask[] = [];
    const MIN_GAP_MS = 5 * 60 * 1000; // 5 minutes minimum gap

    for (let i = 0; i < tasksWithTime.length - 1; i++) {
      const currentEnd = tasksWithTime[i].end;
      const nextStart = tasksWithTime[i + 1].start;

      // Check if there's a gap between current task end and next task start
      if (nextStart - currentEnd >= MIN_GAP_MS) {
        emptySlots.push(createEmptySlot(currentEnd, nextStart, i));
      }
    }

    // Merge empty slots with original tasks and sort by start time
    const result = [...taskList, ...emptySlots];
    return result.sort((a, b) => {
      const aStart = a.startTimestamp ? new Date(a.startTimestamp).getTime() : 0;
      const bStart = b.startTimestamp ? new Date(b.startTimestamp).getTime() : 0;
      return aStart - bStart;
    });
  };

  const displayedTasks = useMemo(() => {
    let result = sortedTasks;

    if (focusMode && result.length > 0) {
      result = [result[0]];
    }

    // Add empty slots if enabled
    if (showEmptySlots && !focusMode) {
      result = calculateEmptySlots(result);
    }

    return result;
  }, [sortedTasks, focusMode, showEmptySlots]);

  const ROW_HEIGHT = 35;
  const VIRTUALIZATION_THRESHOLD = 50;
  const parentRef = useRef<HTMLDivElement>(null);

  // Track when parent element is mounted for virtualizer initialization
  const [isParentMounted, setIsParentMounted] = useState(false);

  useLayoutEffect(() => {
    if (parentRef.current && !isParentMounted) {
      setIsParentMounted(true);
    }
  }, [isParentMounted]);

  const shouldVirtualize = displayedTasks.length > VIRTUALIZATION_THRESHOLD;

  // Synchronize column widths between header and body tables in virtualized mode
  // This fixes misalignment caused by scrollbar width difference (Issue #941)
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  // Measure scrollbar width when scroll container is mounted
  const measureScrollbarWidth = useCallback(() => {
    if (!parentRef.current) return;

    const scrollContainer = parentRef.current;
    // Scrollbar width = total width - client width (visible content area)
    const sbWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
    setScrollbarWidth(sbWidth);
  }, []);

  // Measure scrollbar width when virtualized mode is active and parent is mounted
  useLayoutEffect(() => {
    if (shouldVirtualize && isParentMounted) {
      measureScrollbarWidth();
    }
  }, [shouldVirtualize, isParentMounted, measureScrollbarWidth]);

  // Re-measure on window resize (scrollbar might appear/disappear)
  useEffect(() => {
    if (!shouldVirtualize) return;

    const handleResize = () => {
      measureScrollbarWidth();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [shouldVirtualize, measureScrollbarWidth]);

  // Only initialize virtualizer when we need virtualization AND parent is mounted
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? displayedTasks.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
    // Enable smooth scrolling and ensure proper initialization
    enabled: shouldVirtualize && isParentMounted,
  });

  const renderRow = (task: DailyTask, index: number, style?: React.CSSProperties) => {
    // Render empty slot row with special styling
    if (task.isEmptySlot) {
      return (
        <tr
          key={`${task.path}-${index}`}
          data-path={task.path}
          data-empty-slot="true"
          className="empty-slot-row"
          style={{
            ...style,
            opacity: 0.5,
          }}
        >
          <td className="task-name empty-slot-cell">-</td>
          {showTime && (
            <>
              <td className="task-start empty-slot-cell">
                {formatTimeDisplay(task.startTimestamp, task.startTime)}
              </td>
              <td className="task-end empty-slot-cell">
                {formatTimeDisplay(task.endTimestamp, task.endTime)}
              </td>
            </>
          )}
          {showStatus && <td className="task-status empty-slot-cell">-</td>}
          {showEffortArea && <td className="task-effort-area empty-slot-cell">-</td>}
          {showEffortVotes && <td className="task-effort-votes empty-slot-cell">-</td>}
        </tr>
      );
    }

    let effortArea: unknown = null;
    if (getEffortArea) {
      effortArea = getEffortArea(task.metadata);
    }
    if (!effortArea) {
      effortArea = task.metadata.ems__Effort_area;
    }

    let effortAreaParsed: WikiLink | null = null;
    if (effortArea) {
      const effortAreaStr = String(effortArea);
      if (/\[\[.*?\]\]/.test(effortAreaStr)) {
        effortAreaParsed = parseWikiLink(effortAreaStr);
      } else if (effortAreaStr.includes("|")) {
        const parts = effortAreaStr.split("|");
        effortAreaParsed = {
          target: parts[0].trim(),
          alias: parts[1]?.trim(),
        };
      } else {
        effortAreaParsed = { target: effortAreaStr.trim() };
      }
    }

    return (
      <tr
        key={`${task.path}-${index}`}
        data-path={task.path}
        style={style}
      >
        <td className="task-name">
          <a
            data-href={task.path}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTaskClick?.(task.path, e);
            }}
            className="internal-link"
            style={{ cursor: "pointer" }}
          >
            {getDisplayName(task)}
          </a>
        </td>
        {showTime && (
          <>
            <td className="task-start">
              {formatTimeDisplay(task.startTimestamp, task.startTime)}
            </td>
            <td className="task-end">
              {formatTimeDisplay(task.endTimestamp, task.endTime)}
            </td>
          </>
        )}
        {showStatus && (
          <td className="task-status">
            {task.status
              ? (() => {
                  const isWikiLink =
                    typeof task.status === "string" &&
                    /\[\[.*?\]\]/.test(task.status);
                  const parsed = isWikiLink
                    ? parseWikiLink(task.status)
                    : { target: task.status };
                  const displayText = parsed.alias || parsed.target;

                  return (
                    <a
                      data-href={parsed.target}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onTaskClick?.(parsed.target, e);
                      }}
                      className="internal-link"
                      style={{ cursor: "pointer" }}
                    >
                      {displayText}
                    </a>
                  );
                })()
              : "-"}
          </td>
        )}
        {showEffortArea && (
          <td className="task-effort-area">
            {effortAreaParsed ? (
              <a
                data-href={effortAreaParsed.target}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTaskClick?.(effortAreaParsed!.target, e);
                }}
                className="internal-link"
                style={{ cursor: "pointer" }}
              >
                {getAssetLabel?.(effortAreaParsed.target) ||
                  effortAreaParsed.alias ||
                  effortAreaParsed.target}
              </a>
            ) : (
              "-"
            )}
          </td>
        )}
        {showEffortVotes && (
          <td className="task-effort-votes">
            {typeof task.metadata.ems__Effort_votes === "number"
              ? task.metadata.ems__Effort_votes
              : "-"}
          </td>
        )}
      </tr>
    );
  };

  // Colgroup for synchronizing column widths between header and body tables
  // in virtualized mode. With table-layout: fixed, col widths are respected.
  // Widths must match CSS definitions in styles.css for .exocortex-tasks-table
  const renderColGroup = () => (
    <colgroup>
      <col className="col-name" />
      {showTime && (
        <>
          <col className="col-start" style={{ width: "90px" }} />
          <col className="col-end" style={{ width: "90px" }} />
        </>
      )}
      {showStatus && <col className="col-status" style={{ width: "100px" }} />}
      {showEffortArea && <col className="col-effort-area" style={{ width: "120px" }} />}
      {showEffortVotes && <col className="col-votes" style={{ width: "70px" }} />}
    </colgroup>
  );

  const renderTableHeader = () => (
    <thead>
      <tr>
        <th
          onClick={() => handleSort("name")}
          className="sortable task-name-header"
          style={{ cursor: "pointer" }}
        >
          Name{" "}
          {sortState.column === "name" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
        {showTime && (
          <>
            <th
              onClick={() => handleSort("start")}
              className="sortable task-start-header"
              style={{ cursor: "pointer" }}
            >
              Start{" "}
              {sortState.column === "start" &&
                (sortState.order === "asc" ? "↑" : "↓")}
            </th>
            <th
              onClick={() => handleSort("end")}
              className="sortable task-end-header"
              style={{ cursor: "pointer" }}
            >
              End{" "}
              {sortState.column === "end" &&
                (sortState.order === "asc" ? "↑" : "↓")}
            </th>
          </>
        )}
        {showStatus && (
          <th
            onClick={() => handleSort("status")}
            className="sortable task-status-header"
            style={{ cursor: "pointer" }}
          >
            Status{" "}
            {sortState.column === "status" &&
              (sortState.order === "asc" ? "↑" : "↓")}
          </th>
        )}
        {showEffortArea && (
          <th
            onClick={() => handleSort("effortArea")}
            className="sortable task-effort-area-header"
            style={{ cursor: "pointer" }}
          >
            Effort Area{" "}
            {sortState.column === "effortArea" &&
              (sortState.order === "asc" ? "↑" : "↓")}
          </th>
        )}
        {showEffortVotes && (
          <th
            onClick={() => handleSort("votes")}
            className="sortable task-votes-header"
            style={{ cursor: "pointer" }}
          >
            Votes{" "}
            {sortState.column === "votes" &&
              (sortState.order === "asc" ? "↑" : "↓")}
          </th>
        )}
      </tr>
    </thead>
  );

  if (!shouldVirtualize) {
    return (
      <div className="exocortex-daily-tasks">
        <table className="exocortex-tasks-table">
          {renderColGroup()}
          {renderTableHeader()}
          <tbody>
            {displayedTasks.map((task, index) => renderRow(task, index))}
          </tbody>
        </table>
      </div>
    );
  }

  // Get virtual items - may be empty on first render if parentRef is not yet set
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualizerTotalSize = rowVirtualizer.getTotalSize();

  // Calculate fallback height when virtualizer hasn't initialized yet
  // This ensures content is visible even before the parent ref is mounted
  const totalSize = virtualizerTotalSize > 0
    ? virtualizerTotalSize
    : displayedTasks.length * ROW_HEIGHT;

  return (
    <div className="exocortex-daily-tasks exocortex-virtualized">
      {/* Header wrapper with padding-right to account for scrollbar width (Issue #941) */}
      <div
        className="exocortex-tasks-table-header-wrapper"
        style={{
          paddingRight: scrollbarWidth > 0 ? `${scrollbarWidth}px` : undefined,
        }}
      >
        <table className="exocortex-tasks-table exocortex-tasks-table-header">
          {renderColGroup()}
          {renderTableHeader()}
        </table>
      </div>
      <div
        ref={parentRef}
        className="exocortex-virtual-scroll-container"
        style={{
          height: "400px",
          overflow: "auto",
        }}
      >
        {/* Wrapper div with total height for scrollbar sizing */}
        <div
          style={{
            height: `${totalSize}px`,
            width: "100%",
            position: "relative",
          }}
        >
          <table
            className="exocortex-tasks-table exocortex-virtual-table"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
            }}
          >
            {renderColGroup()}
            <tbody>
              {virtualItems.length > 0 ? (
                virtualItems.map((virtualRow) => {
                  const task = displayedTasks[virtualRow.index];
                  return renderRow(task, virtualRow.index, {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  });
                })
              ) : (
                // Fallback: render all rows if virtualizer hasn't initialized yet
                displayedTasks.map((task, index) => renderRow(task, index))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

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
}

export const DailyTasksTableWithToggle: React.FC<
  DailyTasksTableWithToggleProps
> = ({
  showEffortArea: propShowEffortArea,
  onToggleEffortArea,
  showEffortVotes: propShowEffortVotes,
  onToggleEffortVotes,
  showArchived: propShowArchived,
  onToggleArchived,
  showFullDateInEffortTimes: propShowFullDate,
  onToggleFullDate,
  focusMode: propFocusMode,
  onToggleFocusMode,
  showEmptySlots: propShowEmptySlots,
  onToggleEmptySlots,
  showTime: propShowTime,
  onToggleTime,
  showStatus: propShowStatus,
  onToggleStatus,
  ...props
}) => {
  const storeShowEffortArea = useUIStore((state) => state.showEffortArea);
  const storeShowEffortVotes = useUIStore((state) => state.showEffortVotes);
  const storeShowArchived = useUIStore((state) => state.showArchived);
  const storeShowFullDate = useUIStore(
    (state) => state.showFullDateInEffortTimes,
  );
  const storeFocusMode = useUIStore((state) => state.focusMode);
  const storeShowEmptySlots = useUIStore((state) => state.showEmptySlots);
  const storeShowTime = useUIStore((state) => state.showTime);
  const storeShowStatus = useUIStore((state) => state.showStatus);

  const storeToggleEffortArea = useUIStore((state) => state.toggleEffortArea);
  const storeToggleEffortVotes = useUIStore((state) => state.toggleEffortVotes);
  const storeToggleArchived = useUIStore((state) => state.toggleArchived);
  const storeToggleFullDate = useUIStore((state) => state.toggleFullDate);
  const storeToggleFocusMode = useUIStore((state) => state.toggleFocusMode);
  const storeToggleEmptySlots = useUIStore((state) => state.toggleEmptySlots);
  const storeToggleTime = useUIStore((state) => state.toggleTime);
  const storeToggleStatus = useUIStore((state) => state.toggleStatus);

  const showEffortArea = propShowEffortArea ?? storeShowEffortArea;
  const showEffortVotes = propShowEffortVotes ?? storeShowEffortVotes;
  const showArchived = propShowArchived ?? storeShowArchived;
  const showFullDateInEffortTimes = propShowFullDate ?? storeShowFullDate;
  const focusMode = propFocusMode ?? storeFocusMode;
  const showEmptySlots = propShowEmptySlots ?? storeShowEmptySlots;
  const showTime = propShowTime ?? storeShowTime;
  const showStatus = propShowStatus ?? storeShowStatus;

  const handleToggleEffortArea = () => {
    if (onToggleEffortArea) {
      onToggleEffortArea();
    } else {
      storeToggleEffortArea();
    }
  };

  const handleToggleEffortVotes = () => {
    if (onToggleEffortVotes) {
      onToggleEffortVotes();
    } else {
      storeToggleEffortVotes();
    }
  };

  const handleToggleArchived = () => {
    if (onToggleArchived) {
      onToggleArchived();
    } else {
      storeToggleArchived();
    }
  };

  const handleToggleFullDate = () => {
    if (onToggleFullDate) {
      onToggleFullDate();
    } else {
      storeToggleFullDate();
    }
  };

  const handleToggleFocusMode = () => {
    if (onToggleFocusMode) {
      onToggleFocusMode();
    } else {
      storeToggleFocusMode();
    }
  };

  const handleToggleEmptySlots = () => {
    if (onToggleEmptySlots) {
      onToggleEmptySlots();
    } else {
      storeToggleEmptySlots();
    }
  };

  const handleToggleTime = () => {
    if (onToggleTime) {
      onToggleTime();
    } else {
      storeToggleTime();
    }
  };

  const handleToggleStatus = () => {
    if (onToggleStatus) {
      onToggleStatus();
    } else {
      storeToggleStatus();
    }
  };

  return (
    <div className="exocortex-daily-tasks-wrapper">
      <div className="exocortex-daily-tasks-controls">
        <button
          className="exocortex-toggle-effort-area"
          onClick={handleToggleEffortArea}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showEffortArea ? "Hide" : "Show"} Effort Area
        </button>
        <button
          className="exocortex-toggle-effort-votes"
          onClick={handleToggleEffortVotes}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showEffortVotes ? "Hide" : "Show"} Votes
        </button>
        <button
          className="exocortex-toggle-archived"
          onClick={handleToggleArchived}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showArchived ? "Hide" : "Show"} Archived
        </button>
        <button
          className="exocortex-toggle-full-date"
          onClick={handleToggleFullDate}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showFullDateInEffortTimes ? "HH:mm" : "MM-DD HH:mm"}
        </button>
        <button
          className="exocortex-toggle-focus-mode"
          onClick={handleToggleFocusMode}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {focusMode ? "🎯 focused" : "🎯 focus"}
        </button>
        <button
          className="exocortex-toggle-empty-slots"
          onClick={handleToggleEmptySlots}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showEmptySlots ? "Hide" : "Show"} Empty Slots
        </button>
        <button
          className="exocortex-toggle-time"
          onClick={handleToggleTime}
          style={{
            marginBottom: "8px",
            marginRight: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showTime ? "Hide" : "Show"} Time
        </button>
        <button
          className="exocortex-toggle-status"
          onClick={handleToggleStatus}
          style={{
            marginBottom: "8px",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showStatus ? "Hide" : "Show"} Status
        </button>
      </div>
      <DailyTasksTable
        {...props}
        showEffortArea={showEffortArea}
        showEffortVotes={showEffortVotes}
        showArchived={showArchived}
        showFullDateInEffortTimes={showFullDateInEffortTimes}
        focusMode={focusMode}
        showEmptySlots={showEmptySlots}
        showTime={showTime}
        showStatus={showStatus}
      />
    </div>
  );
};
