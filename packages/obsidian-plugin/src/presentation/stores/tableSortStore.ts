import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { TableSortStore, TableSortState, SortState } from "./types";

const DEFAULT_SORT_STATE: SortState = {
  column: "",
  order: "asc",
};

const DEFAULT_TABLE_SORT_STATE: TableSortState = {
  dailyTasks: { ...DEFAULT_SORT_STATE },
  assetRelations: { ...DEFAULT_SORT_STATE },
  assetProperties: { ...DEFAULT_SORT_STATE },
};

export const useTableSortStore = create<TableSortStore>()(
  devtools(
    persist(
      (set) => ({
        ...DEFAULT_TABLE_SORT_STATE,

        setSort: (table, column, order) =>
          set(
            () => ({
              [table]: { column, order },
            }),
            false,
            `setSort:${table}`,
          ),

        toggleSort: (table, column) =>
          set(
            (state) => {
              const currentSort = state[table];
              const newOrder =
                currentSort.column === column && currentSort.order === "asc"
                  ? "desc"
                  : "asc";
              return {
                [table]: { column, order: newOrder },
              };
            },
            false,
            `toggleSort:${table}:${column}`,
          ),

        resetSort: (table) =>
          set(
            () => ({
              [table]: { ...DEFAULT_SORT_STATE },
            }),
            false,
            `resetSort:${table}`,
          ),

        resetAllSorts: () =>
          set(DEFAULT_TABLE_SORT_STATE, false, "resetAllSorts"),
      }),
      {
        name: "exocortex-table-sort-v1",
        partialize: (state) => ({
          dailyTasks: state.dailyTasks,
          assetRelations: state.assetRelations,
          assetProperties: state.assetProperties,
        }),
      },
    ),
    {
      name: "TableSortStore",
    },
  ),
);

export const getDefaultSortState = (): SortState => ({ ...DEFAULT_SORT_STATE });
