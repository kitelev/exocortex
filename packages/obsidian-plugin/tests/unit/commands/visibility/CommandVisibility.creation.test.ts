import type { CommandVisibilityContext } from "exocortex";
import {
  canCreateTask,
  canCreateProject,
  canCreateEvent,
  canCreateChildArea,
} from "exocortex";

describe("CommandVisibility - Creation Commands", () => {
  describe("canCreateTask", () => {
    it("should return true for ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTask(context)).toBe(true);
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
      expect(canCreateTask(context)).toBe(true);
    });

    it("should return true for Area without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Area",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTask(context)).toBe(true);
    });

    it("should return false for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTask(context)).toBe(false);
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
      expect(canCreateTask(context)).toBe(false);
    });

    it("should return true for array with ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Area]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateTask(context)).toBe(true);
    });
  });

  describe("canCreateProject", () => {
    it("should return true for ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
    });

    it("should return true for ems__Initiative", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Initiative]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
    });

    it("should return true for Area without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Area",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
    });

    it("should return true for Initiative without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Initiative",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
    });

    it("should return false for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(false);
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
      expect(canCreateProject(context)).toBe(true);
    });

    it("should return true for Project without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Project",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
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
      expect(canCreateProject(context)).toBe(false);
    });

    it("should return true for array with ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Area]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
    });

    it("should return true for array with ems__Initiative", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Initiative]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateProject(context)).toBe(true);
    });
  });

  describe("canCreateChildArea", () => {
    it("should return true for ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateChildArea(context)).toBe(true);
    });

    it("should return true for Area without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Area",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateChildArea(context)).toBe(true);
    });

    it("should return false for ems__Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateChildArea(context)).toBe(false);
    });

    it("should return false for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateChildArea(context)).toBe(false);
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
      expect(canCreateChildArea(context)).toBe(false);
    });

    it("should return true for array with ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Area]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateChildArea(context)).toBe(true);
    });
  });

  describe("canCreateEvent", () => {
    it("should return true for ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateEvent(context)).toBe(true);
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
      expect(canCreateEvent(context)).toBe(true);
    });

    it("should return true for Area without brackets", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "ems__Area",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateEvent(context)).toBe(true);
    });

    it("should return false for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateEvent(context)).toBe(false);
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
      expect(canCreateEvent(context)).toBe(false);
    });

    it("should return true for array with ems__Area", () => {
      const context: CommandVisibilityContext = {
        instanceClass: ["[[ems__Area]]", "[[SomeOtherClass]]"],
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCreateEvent(context)).toBe(true);
    });
  });
});
