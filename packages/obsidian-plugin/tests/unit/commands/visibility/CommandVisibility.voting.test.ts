import type { CommandVisibilityContext } from "exocortex";
import { canVoteOnEffort } from "exocortex";

describe("CommandVisibility - Voting Commands", () => {
  describe("canVoteOnEffort", () => {
    it("should return true for Task with Backlog status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
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
      expect(canVoteOnEffort(context)).toBe(true);
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
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should return true for Task without status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
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
      expect(canVoteOnEffort(context)).toBe(true);
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
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should return true for Project with Done status", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should return false for archived Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should return false for archived Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusToDo]]",
        metadata: {},
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should return false for non-effort asset (Area)", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should return true for Meeting", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Meeting]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
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
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should handle Task class without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Task",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should handle Project class without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Project",
        currentStatus: "[[ems__EffortStatusToDo]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should recognize archived as string 'true'", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: "true" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should recognize archived as string 'yes'", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: "yes" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should recognize archived as number 1", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: 1 as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should handle array of classes with Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Task]]", "[[SomeOtherClass]]"],
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should handle array of classes with Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Project]]", "[[SomeOtherClass]]"],
        currentStatus: "[[ems__EffortStatusToDo]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should return false for array of classes without Task or Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Area]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(false);
    });

    it("should return true for Task with existing votes", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusBacklog]]",
        metadata: { ems__Effort_votes: 5 },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });

    it("should return true for Project with existing votes", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusToDo]]",
        metadata: { ems__Effort_votes: 10 },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canVoteOnEffort(context)).toBe(true);
    });
  });
});
