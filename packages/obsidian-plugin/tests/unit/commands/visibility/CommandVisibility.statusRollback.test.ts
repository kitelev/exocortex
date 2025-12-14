import type { CommandVisibilityContext } from "exocortex";
import { canRollbackStatus } from "exocortex";

describe("CommandVisibility - Status Rollback Commands", () => {
  describe("canRollbackStatus", () => {
    it("should return false for non-Effort assets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(false);
    });

    it("should return false for archived Efforts", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(false);
    });

    it("should return false when currentStatus is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(false);
    });

    it("should return false when status is Trashed", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusTrashed]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(false);
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
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return true for Task with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return true for Task with Draft status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return true for Task with Done status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return true for Project with ToDo status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusToDo]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return true for Project with Analysis status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusAnalysis]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return true for Meeting with Done status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Meeting]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should handle array currentStatus correctly", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: ["[[ems__EffortStatusDoing]]"],
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(true);
    });

    it("should return false for array currentStatus with Trashed", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: ["[[ems__EffortStatusTrashed]]"],
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canRollbackStatus(context)).toBe(false);
    });
  });
});
