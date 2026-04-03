import { describe, it, expect } from "@jest/globals";
import {
  canCreateTask,
  canCreateRelatedTask,
  canConvertTaskToProject,
  canSetCriticalityZone,
} from "../../../../../src/domain/commands/visibility/TaskVisibilityRules";
import type { CommandVisibilityContext } from "../../../../../src/domain/commands/visibility/types";

function makeContext(
  overrides: Partial<CommandVisibilityContext> = {},
): CommandVisibilityContext {
  return {
    instanceClass: "ems__Task",
    currentStatus: null,
    metadata: {},
    isArchived: false,
    currentFolder: "/some/folder",
    expectedFolder: "/some/folder",
    ...overrides,
  };
}

describe("TaskVisibilityRules", () => {
  describe("canCreateTask", () => {
    it("should return true for ems__Area", () => {
      expect(
        canCreateTask(makeContext({ instanceClass: "ems__Area" })),
      ).toBe(true);
    });

    it("should return true for ems__Project", () => {
      expect(
        canCreateTask(makeContext({ instanceClass: "ems__Project" })),
      ).toBe(true);
    });

    it("should return false for ems__Task", () => {
      expect(
        canCreateTask(makeContext({ instanceClass: "ems__Task" })),
      ).toBe(false);
    });

    it("should return false for ems__Meeting", () => {
      expect(
        canCreateTask(makeContext({ instanceClass: "ems__Meeting" })),
      ).toBe(false);
    });

    it("should return false for arbitrary class", () => {
      expect(
        canCreateTask(makeContext({ instanceClass: "other__Class" })),
      ).toBe(false);
    });
  });

  describe("canCreateRelatedTask", () => {
    it("should return true for non-archived ems__Task", () => {
      expect(
        canCreateRelatedTask(
          makeContext({ instanceClass: "ems__Task", isArchived: false }),
        ),
      ).toBe(true);
    });

    it("should return false for archived ems__Task", () => {
      expect(
        canCreateRelatedTask(
          makeContext({ instanceClass: "ems__Task", isArchived: true }),
        ),
      ).toBe(false);
    });

    it("should return false for non-Task class", () => {
      expect(
        canCreateRelatedTask(
          makeContext({ instanceClass: "ems__Project", isArchived: false }),
        ),
      ).toBe(false);
    });

    it("should return false for non-Task archived class", () => {
      expect(
        canCreateRelatedTask(
          makeContext({ instanceClass: "ems__Area", isArchived: true }),
        ),
      ).toBe(false);
    });

    it("should handle array instanceClass with ems__Task", () => {
      expect(
        canCreateRelatedTask(
          makeContext({
            instanceClass: ["ems__Task"] as unknown as string,
            isArchived: false,
          }),
        ),
      ).toBe(true);
    });
  });

  describe("canConvertTaskToProject", () => {
    it("should return true for ems__Task", () => {
      expect(
        canConvertTaskToProject(
          makeContext({ instanceClass: "ems__Task" }),
        ),
      ).toBe(true);
    });

    it("should return false for ems__Project", () => {
      expect(
        canConvertTaskToProject(
          makeContext({ instanceClass: "ems__Project" }),
        ),
      ).toBe(false);
    });

    it("should return false for ems__Area", () => {
      expect(
        canConvertTaskToProject(
          makeContext({ instanceClass: "ems__Area" }),
        ),
      ).toBe(false);
    });
  });

  describe("canSetCriticalityZone", () => {
    it("should return true for non-archived ems__Task", () => {
      expect(
        canSetCriticalityZone(
          makeContext({ instanceClass: "ems__Task", isArchived: false }),
        ),
      ).toBe(true);
    });

    it("should return false for archived ems__Task", () => {
      expect(
        canSetCriticalityZone(
          makeContext({ instanceClass: "ems__Task", isArchived: true }),
        ),
      ).toBe(false);
    });

    it("should return false for non-Task class", () => {
      expect(
        canSetCriticalityZone(
          makeContext({ instanceClass: "ems__Project", isArchived: false }),
        ),
      ).toBe(false);
    });

    it("should return false for non-Task archived class", () => {
      expect(
        canSetCriticalityZone(
          makeContext({ instanceClass: "ems__Meeting", isArchived: true }),
        ),
      ).toBe(false);
    });
  });
});
