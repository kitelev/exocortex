import type { CommandVisibilityContext } from "exocortex";
import {
  canMoveToBacklog,
  canMoveToAnalysis,
  canMoveToToDo,
  canStartEffort,
  canMarkDone,
} from "exocortex";

describe("CommandVisibility - Status Commands", () => {
  describe("canMoveToBacklog", () => {
    it("should return true for Task with Draft status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToBacklog(context)).toBe(true);
    });

    it("should return true for Project with Draft status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToBacklog(context)).toBe(true);
    });

    it("should return false for Task with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToBacklog(context)).toBe(false);
    });

    it("should return false for Task with Doing status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToBacklog(context)).toBe(false);
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
      expect(canMoveToBacklog(context)).toBe(false);
    });

    it("should return false for Task without status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToBacklog(context)).toBe(false);
    });

    it("should return false for Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToBacklog(context)).toBe(false);
    });
  });

  describe("canMoveToAnalysis", () => {
    it("should return true for Project with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToAnalysis(context)).toBe(true);
    });

    it("should return false for Project with Draft status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToAnalysis(context)).toBe(false);
    });

    it("should return false for Task with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToAnalysis(context)).toBe(false);
    });
  });

  describe("canMoveToToDo", () => {
    it("should return true for Project with Analysis status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusAnalysis]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToToDo(context)).toBe(true);
    });

    it("should return false for Project with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToToDo(context)).toBe(false);
    });

    it("should return false for Task with Analysis status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusAnalysis]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMoveToToDo(context)).toBe(false);
    });
  });

  describe("canStartEffort", () => {
    it("should return true for Task with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canStartEffort(context)).toBe(true);
    });

    it("should return false for Project with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canStartEffort(context)).toBe(false);
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
      expect(canStartEffort(context)).toBe(true);
    });

    it("should return false for Task with Draft status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canStartEffort(context)).toBe(false);
    });

    it("should return false for Task with Doing status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canStartEffort(context)).toBe(false);
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
      expect(canStartEffort(context)).toBe(false);
    });

    it("should return false for Task without status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canStartEffort(context)).toBe(false);
    });

    it("should return false for Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canStartEffort(context)).toBe(false);
    });
  });

  describe("canMarkDone", () => {
    it("should return true for Task with Doing status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMarkDone(context)).toBe(true);
    });

    it("should return true for Project with Doing status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMarkDone(context)).toBe(true);
    });

    it("should return false for Task with Draft status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDraft]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMarkDone(context)).toBe(false);
    });

    it("should return false for Task with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMarkDone(context)).toBe(false);
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
      expect(canMarkDone(context)).toBe(false);
    });

    it("should return false for Task without status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMarkDone(context)).toBe(false);
    });

    it("should return false for Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: "[[ems__EffortStatusDoing]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canMarkDone(context)).toBe(false);
    });
  });
});
