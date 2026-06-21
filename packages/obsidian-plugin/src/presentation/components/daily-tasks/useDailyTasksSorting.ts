import { useMemo } from "react";
import { MetadataHelpers, EffortSortingHelpers } from "@kitelev/exocortex-core";
import { useTableSortStore } from '@plugin/presentation/stores';
import type { DailyTask } from './types';
import {
  getDisplayName,
  getEffortAreaDisplayText,
  calculateEmptySlots,
  isContextTask,
  periodsOverlap,
} from './helpers';

interface UseDailyTasksSortingProps {
  tasks: DailyTask[];
  getAssetLabel?: (path: string) => string | null;
  getEffortArea?: (metadata: Record<string, unknown>) => string | null;
  showArchived: boolean;
  focusMode: boolean;
  showEmptySlots: boolean;
}

interface UseDailyTasksSortingResult {
  displayedTasks: DailyTask[];
  tasksWithOverlaps: Set<string>;
  sortState: { column: string | null; order: "asc" | "desc" };
  handleSort: (column: string) => void;
}

export const useDailyTasksSorting = ({
  tasks,
  getAssetLabel,
  getEffortArea,
  showArchived,
  focusMode,
  showEmptySlots,
}: UseDailyTasksSortingProps): UseDailyTasksSortingResult => {
  const sortState = useTableSortStore((state) => state.dailyTasks);
  const toggleSort = useTableSortStore((state) => state.toggleSort);

  const tasksWithOverlaps = useMemo(() => {
    const overlapping = new Set<string>();

    const tasksWithPlannedTimes = tasks.filter((task) => {
      const start = task.metadata.ems__Effort_plannedStartTimestamp;
      const end = task.metadata.ems__Effort_plannedEndTimestamp;

      if (isContextTask(task.metadata)) {
        return false;
      }

      return start != null && end != null;
    });

    for (let i = 0; i < tasksWithPlannedTimes.length; i++) {
      const task1 = tasksWithPlannedTimes[i];
      const start1Str = task1.metadata.ems__Effort_plannedStartTimestamp;
      const end1Str = task1.metadata.ems__Effort_plannedEndTimestamp;

      const start1 = new Date(start1Str as string | number).getTime();
      const end1 = new Date(end1Str as string | number).getTime();

      if (isNaN(start1) || isNaN(end1)) continue;

      for (let j = i + 1; j < tasksWithPlannedTimes.length; j++) {
        const task2 = tasksWithPlannedTimes[j];
        const start2Str = task2.metadata.ems__Effort_plannedStartTimestamp;
        const end2Str = task2.metadata.ems__Effort_plannedEndTimestamp;

        const start2 = new Date(start2Str as string | number).getTime();
        const end2 = new Date(end2Str as string | number).getTime();

        if (isNaN(start2) || isNaN(end2)) continue;

        if (periodsOverlap(start1, end1, start2, end2)) {
          overlapping.add(task1.path);
          overlapping.add(task2.path);
        }
      }
    }

    return overlapping;
  }, [tasks]);

  const handleSort = (column: string) => {
    toggleSort("dailyTasks", column);
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

      if (!sortState.column) {
        return sorted.sort((a, b) => EffortSortingHelpers.sortByStartTime(a, b));
      }

      sorted.sort((a, b) => {
        let aValue: string | number;
        let bValue: string | number;

        switch (sortState.column) {
          case "name":
            aValue = getDisplayName(a, getAssetLabel).toLowerCase();
            bValue = getDisplayName(b, getAssetLabel).toLowerCase();
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
            aValue = getEffortAreaDisplayText(a, getEffortArea);
            bValue = getEffortAreaDisplayText(b, getEffortArea);
            break;
          case "votes":
            aValue = typeof a.metadata.ems__Effort_votes === "number"
              ? a.metadata.ems__Effort_votes
              : -1;
            bValue = typeof b.metadata.ems__Effort_votes === "number"
              ? b.metadata.ems__Effort_votes
              : -1;
            break;
          case "timeEstimate":
            aValue = typeof a.metadata.ems__Effort_timeEstimateMinutes === "number"
              ? a.metadata.ems__Effort_timeEstimateMinutes
              : -1;
            bValue = typeof b.metadata.ems__Effort_timeEstimateMinutes === "number"
              ? b.metadata.ems__Effort_timeEstimateMinutes
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

  const displayedTasks = useMemo(() => {
    let result = sortedTasks;

    if (focusMode && result.length > 0) {
      result = [result[0]];
    }

    if (showEmptySlots && !focusMode) {
      result = calculateEmptySlots(result);
    }

    return result;
  }, [sortedTasks, focusMode, showEmptySlots]);

  return {
    displayedTasks,
    tasksWithOverlaps,
    sortState,
    handleSort,
  };
};
