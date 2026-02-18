import {
  useTableSortStore,
  getDefaultSortState,
} from "../../../src/presentation/stores/tableSortStore";
import type { SortState } from "../../../src/presentation/stores/types";

const mockStorage: Record<string, string> = {};

const localStorageMock = {
  getItem: jest.fn((key: string) => mockStorage[key] || null),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: jest.fn(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  }),
  length: 0,
  key: jest.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("TableSortStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useTableSortStore.setState({
      dailyTasks: { column: "", order: "asc" },
      assetRelations: { column: "", order: "asc" },
      assetProperties: { column: "", order: "asc" },
    });
  });

  describe("initial state", () => {
    it("should have default sort state for all tables", () => {
      const state = useTableSortStore.getState();

      expect(state.dailyTasks).toEqual({ column: "", order: "asc" });
      expect(state.assetRelations).toEqual({ column: "", order: "asc" });
      expect(state.assetProperties).toEqual({ column: "", order: "asc" });
    });
  });

  describe("setSort", () => {
    it("should set sort for dailyTasks table", () => {
      useTableSortStore.getState().setSort("dailyTasks", "name", "asc");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "asc",
      });
    });

    it("should set sort for assetRelations table", () => {
      useTableSortStore.getState().setSort("assetRelations", "title", "asc");

      expect(useTableSortStore.getState().assetRelations).toEqual({
        column: "title",
        order: "asc",
      });
    });

    it("should set sort for assetProperties table", () => {
      useTableSortStore.getState().setSort("assetProperties", "value", "desc");

      expect(useTableSortStore.getState().assetProperties).toEqual({
        column: "value",
        order: "desc",
      });
    });

    it("should not affect other tables when setting sort", () => {
      useTableSortStore.getState().setSort("dailyTasks", "name", "asc");
      useTableSortStore.getState().setSort("assetRelations", "title", "desc");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "asc",
      });
      expect(useTableSortStore.getState().assetRelations).toEqual({
        column: "title",
        order: "desc",
      });
    });

    it("should overwrite existing sort state", () => {
      useTableSortStore.getState().setSort("dailyTasks", "name", "asc");
      useTableSortStore.getState().setSort("dailyTasks", "status", "desc");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "status",
        order: "desc",
      });
    });
  });

  describe("toggleSort", () => {
    it("should set asc order when clicking new column", () => {
      useTableSortStore.getState().toggleSort("dailyTasks", "name");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "asc",
      });
    });

    it("should toggle to desc when clicking same column with asc", () => {
      useTableSortStore.setState({
        dailyTasks: { column: "name", order: "asc" },
        assetRelations: { column: "", order: "asc" },
        assetProperties: { column: "", order: "asc" },
      });

      useTableSortStore.getState().toggleSort("dailyTasks", "name");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "desc",
      });
    });

    it("should toggle to asc when clicking same column with desc", () => {
      useTableSortStore.setState({
        dailyTasks: { column: "name", order: "desc" },
        assetRelations: { column: "", order: "asc" },
        assetProperties: { column: "", order: "asc" },
      });

      useTableSortStore.getState().toggleSort("dailyTasks", "name");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "asc",
      });
    });

    it("should reset to asc when clicking different column", () => {
      useTableSortStore.setState({
        dailyTasks: { column: "name", order: "desc" },
        assetRelations: { column: "", order: "asc" },
        assetProperties: { column: "", order: "asc" },
      });

      useTableSortStore.getState().toggleSort("dailyTasks", "status");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "status",
        order: "asc",
      });
    });

    it("should work for different tables independently", () => {
      useTableSortStore.getState().toggleSort("dailyTasks", "name");
      useTableSortStore.getState().toggleSort("assetRelations", "title");
      useTableSortStore.getState().toggleSort("dailyTasks", "name");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "desc",
      });
      expect(useTableSortStore.getState().assetRelations).toEqual({
        column: "title",
        order: "asc",
      });
    });
  });

  describe("resetSort", () => {
    it("should reset sort for specific table", () => {
      useTableSortStore.setState({
        dailyTasks: { column: "name", order: "desc" },
        assetRelations: { column: "title", order: "asc" },
        assetProperties: { column: "", order: "asc" },
      });

      useTableSortStore.getState().resetSort("dailyTasks");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "",
        order: "asc",
      });
      expect(useTableSortStore.getState().assetRelations).toEqual({
        column: "title",
        order: "asc",
      });
    });

    it("should work when already at default", () => {
      useTableSortStore.getState().resetSort("dailyTasks");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "",
        order: "asc",
      });
    });
  });

  describe("resetAllSorts", () => {
    it("should reset all tables to default sort state", () => {
      useTableSortStore.setState({
        dailyTasks: { column: "name", order: "desc" },
        assetRelations: { column: "title", order: "desc" },
        assetProperties: { column: "value", order: "asc" },
      });

      useTableSortStore.getState().resetAllSorts();

      const state = useTableSortStore.getState();
      expect(state.dailyTasks).toEqual({ column: "", order: "asc" });
      expect(state.assetRelations).toEqual({ column: "", order: "asc" });
      expect(state.assetProperties).toEqual({ column: "", order: "asc" });
    });

    it("should work when already at defaults", () => {
      useTableSortStore.getState().resetAllSorts();

      const state = useTableSortStore.getState();
      expect(state.dailyTasks).toEqual({ column: "", order: "asc" });
    });
  });

  describe("edge cases", () => {
    it("should handle empty column name", () => {
      useTableSortStore.getState().setSort("dailyTasks", "", "asc");

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "",
        order: "asc",
      });
    });

    it("should handle column names with special characters", () => {
      useTableSortStore.getState().setSort("dailyTasks", "start-time", "asc");

      expect(useTableSortStore.getState().dailyTasks.column).toBe("start-time");
    });

    it("should handle rapid sequential operations", () => {
      for (let i = 0; i < 10; i++) {
        useTableSortStore.getState().toggleSort("dailyTasks", "name");
      }

      expect(useTableSortStore.getState().dailyTasks).toEqual({
        column: "name",
        order: "desc",
      });
    });
  });
});

describe("getDefaultSortState", () => {
  it("should return default sort state", () => {
    const defaultState = getDefaultSortState();

    expect(defaultState).toEqual({ column: "", order: "asc" });
  });

  it("should return a new object each time", () => {
    const state1 = getDefaultSortState();
    const state2 = getDefaultSortState();

    expect(state1).not.toBe(state2);
    expect(state1).toEqual(state2);
  });

  it("should be immutable (modifying returned object does not affect next call)", () => {
    const state1 = getDefaultSortState();
    state1.column = "modified";
    state1.order = "desc";

    const state2 = getDefaultSortState();
    expect(state2.column).toBe("");
    expect(state2.order).toBe("asc");
  });
});
