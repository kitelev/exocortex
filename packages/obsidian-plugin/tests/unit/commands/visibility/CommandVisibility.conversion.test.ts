import type { CommandVisibilityContext } from "exocortex";
import { canConvertTaskToProject, canConvertProjectToTask } from "exocortex";

describe("CommandVisibility - Conversion Commands", () => {
  describe("canConvertTaskToProject", () => {
    it("should return true for ems__Task", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canConvertTaskToProject(context)).toBe(true);
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
      expect(canConvertTaskToProject(context)).toBe(false);
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
      expect(canConvertTaskToProject(context)).toBe(false);
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
      expect(canConvertTaskToProject(context)).toBe(false);
    });
  });

  describe("canConvertProjectToTask", () => {
    it("should return true for ems__Project", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canConvertProjectToTask(context)).toBe(true);
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
      expect(canConvertProjectToTask(context)).toBe(false);
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
      expect(canConvertProjectToTask(context)).toBe(false);
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
      expect(canConvertProjectToTask(context)).toBe(false);
    });
  });
});
