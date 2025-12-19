import React, { useMemo, useRef, useState, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTableSortStore, useUIStore } from '@plugin/presentation/stores';

export interface DailyProject {
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
  isBlocked: boolean;
}

export interface DailyProjectsTableProps {
  projects: DailyProject[];
  onProjectClick?: (path: string, event: React.MouseEvent) => void;
  getAssetLabel?: (path: string) => string | null;
  showArchived?: boolean;
  showFullDateInEffortTimes?: boolean;
}

export const DailyProjectsTable: React.FC<DailyProjectsTableProps> = ({
  projects,
  onProjectClick,
  getAssetLabel,
  showArchived: propShowArchived,
  showFullDateInEffortTimes: propShowFullDate,
}) => {
  const sortState = useTableSortStore((state) => state.dailyProjects);
  const toggleSort = useTableSortStore((state) => state.toggleSort);

  const storeShowArchived = useUIStore((state) => state.showArchived);
  const storeShowFullDate = useUIStore(
    (state) => state.showFullDateInEffortTimes,
  );

  const showArchived = propShowArchived ?? storeShowArchived;
  const showFullDateInEffortTimes = propShowFullDate ?? storeShowFullDate;

  const handleSort = (column: string) => {
    toggleSort("dailyProjects", column);
  };

  interface WikiLink {
    target: string;
    alias?: string;
  }

  const parseWikiLink = (value: string): WikiLink => {
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

  const getDisplayName = (project: DailyProject): string => {
    const blockerIcon = project.isBlocked ? "🚩 " : "";
    const icon = project.isDone ? "✅ " : project.isTrashed ? "❌ " : "📦 ";

    let displayText = project.label || project.title;

    if (typeof getAssetLabel === "function") {
      const customLabel = getAssetLabel(project.path);
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

  const isAssetArchived = (metadata: Record<string, unknown>): boolean => {
    const value = metadata.exo__Asset_isArchived;
    if (!value) return false;
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      const lower = String(value).toLowerCase().trim();
      return lower === "true" || lower === "yes" || lower === "1";
    }
    return Boolean(value);
  };

  const sortedProjects = useMemo(() => {
    let filtered = projects;

    if (!showArchived) {
      filtered = projects.filter((project) => {
        return !isAssetArchived(project.metadata);
      });
    }

    if (!sortState.column) {
      return filtered;
    }

    const sorted = [...filtered];

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
  }, [projects, sortState, getAssetLabel, showArchived]);

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

  const shouldVirtualize = sortedProjects.length > VIRTUALIZATION_THRESHOLD;

  // Only initialize virtualizer when we need virtualization AND parent is mounted
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? sortedProjects.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
    // Enable smooth scrolling and ensure proper initialization
    enabled: shouldVirtualize && isParentMounted,
  });

  const renderRow = (project: DailyProject, index: number, style?: React.CSSProperties) => (
    <tr
      key={`${project.path}-${index}`}
      data-path={project.path}
      style={style}
    >
      <td className="project-name" title={getDisplayName(project)}>
        <a
          data-href={project.path}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onProjectClick?.(project.path, e);
          }}
          className="internal-link"
          style={{ cursor: "pointer" }}
          title={getDisplayName(project)}
        >
          {getDisplayName(project)}
        </a>
      </td>
      <td className="project-start">
        {formatTimeDisplay(project.startTimestamp, project.startTime)}
      </td>
      <td className="project-end">
        {formatTimeDisplay(project.endTimestamp, project.endTime)}
      </td>
      <td className="project-status">
        {project.status
          ? (() => {
              const isWikiLink =
                typeof project.status === "string" &&
                /\[\[.*?\]\]/.test(project.status);
              const parsed = isWikiLink
                ? parseWikiLink(project.status)
                : { target: project.status };
              const displayText = parsed.alias || parsed.target;

              return (
                <a
                  data-href={parsed.target}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onProjectClick?.(parsed.target, e);
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
    </tr>
  );

  const renderTableHeader = () => (
    <thead>
      <tr>
        <th
          onClick={() => handleSort("name")}
          className="sortable"
          style={{ cursor: "pointer" }}
        >
          Name{" "}
          {sortState.column === "name" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
        <th
          onClick={() => handleSort("start")}
          className="sortable"
          style={{ cursor: "pointer" }}
        >
          Start{" "}
          {sortState.column === "start" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
        <th
          onClick={() => handleSort("end")}
          className="sortable"
          style={{ cursor: "pointer" }}
        >
          End{" "}
          {sortState.column === "end" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
        <th
          onClick={() => handleSort("status")}
          className="sortable"
          style={{ cursor: "pointer" }}
        >
          Status{" "}
          {sortState.column === "status" &&
            (sortState.order === "asc" ? "↑" : "↓")}
        </th>
      </tr>
    </thead>
  );

  if (!shouldVirtualize) {
    return (
      <div className="exocortex-daily-projects">
        <table className="exocortex-projects-table">
          {renderTableHeader()}
          <tbody>
            {sortedProjects.map((project, index) => renderRow(project, index))}
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
    : sortedProjects.length * ROW_HEIGHT;

  return (
    <div className="exocortex-daily-projects exocortex-virtualized">
      <table className="exocortex-projects-table exocortex-projects-table-header">
        {renderTableHeader()}
      </table>
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
            className="exocortex-projects-table exocortex-virtual-table"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
            }}
          >
            <tbody>
              {virtualItems.length > 0 ? (
                virtualItems.map((virtualRow) => {
                  const project = sortedProjects[virtualRow.index];
                  return renderRow(project, virtualRow.index, {
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
                sortedProjects.map((project, index) => renderRow(project, index))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export interface DailyProjectsTableWithToggleProps
  extends Omit<
    DailyProjectsTableProps,
    "showArchived" | "showFullDateInEffortTimes"
  > {
  showArchived?: boolean;
  onToggleArchived?: () => void;
  showFullDateInEffortTimes?: boolean;
  onToggleFullDate?: () => void;
}

export const DailyProjectsTableWithToggle: React.FC<
  DailyProjectsTableWithToggleProps
> = ({
  showArchived: propShowArchived,
  onToggleArchived,
  showFullDateInEffortTimes: propShowFullDate,
  onToggleFullDate,
  ...props
}) => {
  const storeShowArchived = useUIStore((state) => state.showArchived);
  const storeShowFullDate = useUIStore(
    (state) => state.showFullDateInEffortTimes,
  );

  const storeToggleArchived = useUIStore((state) => state.toggleArchived);
  const storeToggleFullDate = useUIStore((state) => state.toggleFullDate);

  const showArchived = propShowArchived ?? storeShowArchived;
  const showFullDateInEffortTimes = propShowFullDate ?? storeShowFullDate;

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

  return (
    <div className="exocortex-daily-projects-wrapper">
      <div className="exocortex-daily-projects-controls">
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
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {showFullDateInEffortTimes ? "HH:mm" : "MM-DD HH:mm"}
        </button>
      </div>
      <DailyProjectsTable
        {...props}
        showArchived={showArchived}
        showFullDateInEffortTimes={showFullDateInEffortTimes}
      />
    </div>
  );
};
