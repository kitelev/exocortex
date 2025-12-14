import type { CommandVisibilityContext } from "exocortex";
import { canPlanOnToday, canTrashEffort } from "exocortex";

describe("CommandVisibility - Effort Planning Commands", () => {
  describe("canPlanOnToday", () => {
    it("should return true for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
    });

    it("should return true for ems__Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
    });

    it("should return true for Task without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Task",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
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
      expect(canPlanOnToday(context)).toBe(false);
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
      expect(canPlanOnToday(context)).toBe(false);
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
      expect(canPlanOnToday(context)).toBe(true);
    });

    it("should return false when ems__Effort_plannedStartTimestamp is set to today", () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const todayString = `${year}-${month}-${day}`;

      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: `${todayString}T00:00:00`,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(false);
    });

    it("should return false when ems__Effort_plannedStartTimestamp is set to today with different time", () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const todayString = `${year}-${month}-${day}`;

      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: `${todayString}T19:00:00`,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(false);
    });

    it("should return true when ems__Effort_plannedStartTimestamp is set to yesterday", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const year = yesterday.getFullYear();
      const month = String(yesterday.getMonth() + 1).padStart(2, "0");
      const day = String(yesterday.getDate()).padStart(2, "0");
      const yesterdayString = `${year}-${month}-${day}`;

      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: `${yesterdayString}T00:00:00`,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
    });

    it("should return true when ems__Effort_plannedStartTimestamp is set to tomorrow", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
      const day = String(tomorrow.getDate()).padStart(2, "0");
      const tomorrowString = `${year}-${month}-${day}`;

      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: `${tomorrowString}T00:00:00`,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
    });

    it("should return false when ems__Effort_plannedStartTimestamp is array with today", () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const todayString = `${year}-${month}-${day}`;

      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: [`${todayString}T00:00:00`],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(false);
    });

    it("should return true when ems__Effort_plannedStartTimestamp is empty string", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: "",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
    });

    it("should return true when ems__Effort_plannedStartTimestamp is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          ems__Effort_plannedStartTimestamp: null,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canPlanOnToday(context)).toBe(true);
    });
  });

  describe("canTrashEffort", () => {
    it("should return true for Task without status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(true);
    });

    it("should return true for Task with Doing status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(true);
    });

    it("should return false for Task with Done status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(false);
    });

    it("should return false for Task with Trashed status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusTrashed]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(false);
    });

    it("should return true for Project without status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(true);
    });

    it("should return false for Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(false);
    });

    it("should return false for null instanceClass", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(false);
    });

    it("should handle array of statuses with Trashed", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: ["[[ems__EffortStatusTrashed]]"],
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(false);
    });

    it("should handle array of statuses with Done", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: ["[[ems__EffortStatusDone]]"],
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canTrashEffort(context)).toBe(false);
    });
  });
});
