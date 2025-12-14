export interface SortState {
  column: string;
  order: "asc" | "desc";
}

export interface UISettings {
  showArchived: boolean;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  showFullDateInEffortTimes: boolean;
  focusMode: boolean;
  showEmptySlots: boolean;
  showTime: boolean;
  showStatus: boolean;
}

export interface UIStore extends UISettings {
  toggleArchived: () => void;
  toggleEffortArea: () => void;
  toggleEffortVotes: () => void;
  toggleFullDate: () => void;
  toggleFocusMode: () => void;
  toggleEmptySlots: () => void;
  toggleTime: () => void;
  toggleStatus: () => void;
  resetToDefaults: () => void;
}

export interface TableSortState {
  dailyTasks: SortState;
  dailyProjects: SortState;
  assetRelations: SortState;
  assetProperties: SortState;
}

export interface TableSortStore extends TableSortState {
  setSort: (
    table: keyof TableSortState,
    column: string,
    order: "asc" | "desc",
  ) => void;
  toggleSort: (table: keyof TableSortState, column: string) => void;
  resetSort: (table: keyof TableSortState) => void;
  resetAllSorts: () => void;
}
