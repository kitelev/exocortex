import React, { useRef, useState, useLayoutEffect, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useUIStore } from '@plugin/presentation/stores';
import type { DailyTask, DailyTasksTableProps } from './types';
import { DailyTasksTableRow } from './DailyTasksTableRow';
import { DailyTasksTableHeader, DailyTasksColGroup } from './DailyTasksTableHeader';
import { useDailyTasksSorting } from './useDailyTasksSorting';

const ROW_HEIGHT = 35;
const VIRTUALIZATION_THRESHOLD = 50;

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
  showTimeEstimate: propShowTimeEstimate,
}) => {
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
  const storeShowTimeEstimate = useUIStore((state) => state.showTimeEstimate);

  const showArchived = propShowArchived ?? storeShowArchived;
  const showEffortArea = propShowEffortArea ?? storeShowEffortArea;
  const showEffortVotes = propShowEffortVotes ?? storeShowEffortVotes;
  const showFullDateInEffortTimes = propShowFullDate ?? storeShowFullDate;
  const focusMode = propFocusMode ?? storeFocusMode;
  const showEmptySlots = propShowEmptySlots ?? storeShowEmptySlots;
  const showTime = propShowTime ?? storeShowTime;
  const showStatus = propShowStatus ?? storeShowStatus;
  const showTimeEstimate = propShowTimeEstimate ?? storeShowTimeEstimate;

  const { displayedTasks, tasksWithOverlaps, sortState, handleSort } = useDailyTasksSorting({
    tasks,
    getAssetLabel,
    getEffortArea,
    showArchived,
    focusMode,
    showEmptySlots,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const headerTableRef = useRef<HTMLTableElement>(null);

  const [isParentMounted, setIsParentMounted] = useState(false);

  useLayoutEffect(() => {
    if (parentRef.current && !isParentMounted) {
      setIsParentMounted(true);
    }
  }, [isParentMounted]);

  const shouldVirtualize = displayedTasks.length > VIRTUALIZATION_THRESHOLD;

  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [nameColumnWidth, setNameColumnWidth] = useState<number | undefined>(undefined);

  const measureWidths = useCallback(() => {
    if (!parentRef.current) return;

    const scrollContainer = parentRef.current;
    const sbWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
    setScrollbarWidth(sbWidth);

    if (headerTableRef.current) {
      const nameHeader = headerTableRef.current.querySelector('th.task-name-header');
      if (nameHeader) {
        const width = (nameHeader as HTMLElement).offsetWidth;
        setNameColumnWidth(width);
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (shouldVirtualize && isParentMounted) {
      measureWidths();
    }
  }, [shouldVirtualize, isParentMounted, measureWidths]);

  useEffect(() => {
    if (!shouldVirtualize) return;

    const handleResize = () => {
      measureWidths();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [shouldVirtualize, measureWidths]);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? displayedTasks.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
    enabled: shouldVirtualize && isParentMounted,
  });

  const columnVisibility = {
    showTime,
    showStatus,
    showEffortArea,
    showEffortVotes,
    showTimeEstimate,
  };

  const renderRow = (task: DailyTask, index: number, style?: React.CSSProperties) => (
    <DailyTasksTableRow
      key={`${task.path}-${index}`}
      task={task}
      index={index}
      style={style}
      {...columnVisibility}
      showFullDateInEffortTimes={showFullDateInEffortTimes}
      hasOverlap={tasksWithOverlaps.has(task.path)}
      onTaskClick={onTaskClick}
      getAssetLabel={getAssetLabel}
      getEffortArea={getEffortArea}
    />
  );

  if (!shouldVirtualize) {
    return (
      <div className="exocortex-daily-tasks">
        <table className="exocortex-tasks-table">
          <DailyTasksColGroup {...columnVisibility} />
          <DailyTasksTableHeader {...columnVisibility} sortState={sortState} onSort={handleSort} />
          <tbody>
            {displayedTasks.map((task, index) => renderRow(task, index))}
          </tbody>
        </table>
      </div>
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualizerTotalSize = rowVirtualizer.getTotalSize();

  const totalSize = virtualizerTotalSize > 0
    ? virtualizerTotalSize
    : displayedTasks.length * ROW_HEIGHT;

  return (
    <div className="exocortex-daily-tasks exocortex-virtualized">
      <div
        className="exocortex-tasks-table-header-wrapper"
        style={{
          paddingRight: scrollbarWidth > 0 ? `${scrollbarWidth}px` : undefined,
        }}
      >
        <table
          ref={headerTableRef}
          className="exocortex-tasks-table exocortex-tasks-table-header"
        >
          <DailyTasksColGroup {...columnVisibility} />
          <DailyTasksTableHeader {...columnVisibility} sortState={sortState} onSort={handleSort} />
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
            <DailyTasksColGroup {...columnVisibility} nameColumnWidth={nameColumnWidth} forBody />
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
                displayedTasks.map((task, index) => renderRow(task, index))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
