import type { CommandVisibilityContext } from "exocortex";
import {
  canCreateRelatedTask,
  canCreateTaskForDailyNote,
  AssetClass,
} from "exocortex";

describe("CommandVisibility - Task Creation Commands", () => {
  describe("canCreateRelatedTask", () => {
    it("should return true for ems__Task not archived", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(true);
    });

    it("should return true for ems__Task without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Task",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(true);
    });

    it("should return false for archived ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should return false for ems__Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusToDo]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should return false for ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should return false when instanceClass is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should return true for array with ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Task]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(true);
    });

    it("should return false for array without ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Project]]", "[[ems__Area]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should recognize archived as string 'true'", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: "true" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should recognize archived as string 'yes'", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: "yes" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should recognize archived as number 1", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: 1 as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(false);
    });

    it("should show button when archived is false string", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: "false" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateRelatedTask(context)).toBe(true);
    });
  });

  describe("canCreateTaskForDailyNote", () => {
    it("should return true for DailyNote with past date", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "2020-01-01",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should return true for DailyNote with today's date", () => {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: dateStr,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should return false for DailyNote with future date", () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const futureStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;

      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: futureStr,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should return false for non-DailyNote asset", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.AREA,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "2025-11-11",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should return false when pn__DailyNote_day is missing", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should handle wiki-link format for day property", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "[[2025-11-11]]",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should handle quoted wiki-link format for day property", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: '"[[2025-11-11]]"',
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should handle array format for day property", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: ["[[2025-11-11]]"],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should handle array with plain string for day property", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: ["2025-11-11"],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should return false when instanceClass is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "2025-11-11",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should return false when day property is empty string", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should return false when day property is empty array", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: [],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should handle instanceClass as array", () => {
      const context: CommandVisibilityContext = {
        instanceClass: [AssetClass.DAILY_NOTE],
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "2025-11-11",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should handle day property with extra whitespace", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "  2020-01-01  ",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should return false when day property is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: null,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should return false when day property is undefined", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: undefined,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });

    it("should handle mixed case instance class array", () => {
      const context: CommandVisibilityContext = {
        instanceClass: [AssetClass.AREA, AssetClass.DAILY_NOTE],
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "2020-01-01",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(true);
    });

    it("should return false for archived DailyNote", () => {
      const context: CommandVisibilityContext = {
        instanceClass: AssetClass.DAILY_NOTE,
        currentStatus: null,
        metadata: {
          pn__DailyNote_day: "2020-01-01",
        },
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTaskForDailyNote(context)).toBe(false);
    });
  });
});
