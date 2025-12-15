import type { CommandVisibilityContext } from "exocortex";
import {
  canArchiveTask,
  canCleanProperties,
  canRepairFolder,
  canCopyLabelToAliases,
} from "exocortex";

describe("CommandVisibility - Maintenance Commands", () => {
  describe("canArchiveTask", () => {
    it("should return true for any asset not archived", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(true);
    });

    it("should return false for already archived asset", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(false);
    });

    it("should return true for Task with any status not archived", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusActive]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(true);
    });

    it("should return true for Project not archived", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Project]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(true);
    });

    it("should return true for Area not archived", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Area]]",
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(true);
    });

    it("should recognize archived as string 'true'", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: "true" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(false);
    });

    it("should recognize archived as string 'yes'", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: "yes" as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(false);
    });

    it("should recognize archived as number 1", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: "[[ems__EffortStatusDone]]",
        metadata: {},
        isArchived: 1 as any,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(false);
    });

    it("should return true for asset without instanceClass", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(true);
    });

    it("should return false for archived asset without instanceClass", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: true,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canArchiveTask(context)).toBe(false);
    });
  });

  describe("canCleanProperties", () => {
    it("should return true when metadata has empty string", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: "", prop2: "value" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(true);
    });

    it("should return true when metadata has null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: null, prop2: "value" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(true);
    });

    it("should return true when metadata has undefined", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: undefined, prop2: "value" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(true);
    });

    it("should return true when metadata has empty array", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: [], prop2: "value" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(true);
    });

    it("should return true when metadata has empty object", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: {}, prop2: "value" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(true);
    });

    it("should return false when metadata has no empty properties", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: "value1", prop2: "value2" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(false);
    });

    it("should return false when metadata is empty", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(false);
    });

    it("should return true for whitespace-only string", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: { prop1: "   ", prop2: "value" },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCleanProperties(context)).toBe(true);
    });
  });

  describe("canRepairFolder", () => {
    it("should return true when folders don't match", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder1",
        expectedFolder: "folder2",
      };
      expect(canRepairFolder(context)).toBe(true);
    });

    it("should return false when folders match", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder1",
        expectedFolder: "folder1",
      };
      expect(canRepairFolder(context)).toBe(false);
    });

    it("should return false when expectedFolder is null", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder1",
        expectedFolder: null,
      };
      expect(canRepairFolder(context)).toBe(false);
    });

    it("should normalize paths with trailing slashes", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder1/",
        expectedFolder: "folder1",
      };
      expect(canRepairFolder(context)).toBe(false);
    });

    it("should detect mismatch when current has trailing slash", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder1/",
        expectedFolder: "folder2",
      };
      expect(canRepairFolder(context)).toBe(true);
    });

    it("should detect mismatch when expected has trailing slash", () => {
      const context: CommandVisibilityContext = {
        instanceClass: null,
        currentStatus: null,
        metadata: {},
        isArchived: false,
        currentFolder: "folder1",
        expectedFolder: "folder2/",
      };
      expect(canRepairFolder(context)).toBe(true);
    });
  });

  describe("canCopyLabelToAliases", () => {
    it("should return true when label exists and no aliases", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "My Label",
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(true);
    });

    it("should return true when label exists and aliases is empty array", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "My Label",
          aliases: [],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(true);
    });

    it("should return true when label exists and aliases don't contain it", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "My Label",
          aliases: ["Other Alias", "Another Alias"],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(true);
    });

    it("should return false when label exists and aliases already contain it", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "My Label",
          aliases: ["Other Alias", "My Label"],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(false);
    });

    it("should return false when label is missing", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          aliases: ["Some Alias"],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(false);
    });

    it("should return false when label is empty string", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "",
          aliases: [],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(false);
    });

    it("should return false when label is whitespace only", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "   ",
          aliases: [],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(false);
    });

    it("should handle label with leading/trailing whitespace", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "  My Label  ",
          aliases: ["My Label"],
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(false);
    });

    it("should return true when aliases is not an array", () => {
      const context: CommandVisibilityContext = {
        instanceClass: "[[ems__Task]]",
        currentStatus: null,
        metadata: {
          exo__Asset_label: "My Label",
          aliases: "not an array" as any,
        },
        isArchived: false,
        currentFolder: "",
        expectedFolder: null,
      };
      expect(canCopyLabelToAliases(context)).toBe(true);
    });
  });
});
