import { describe, it, expect } from "@jest/globals";
import {
  canCreateProject,
  canMoveToAnalysis,
  canMoveToToDo,
  canConvertProjectToTask,
} from "../../../../../src/domain/commands/visibility/ProjectVisibilityRules";
import type { CommandVisibilityContext } from "../../../../../src/domain/commands/visibility/types";

function makeContext(
  overrides: Partial<CommandVisibilityContext> = {},
): CommandVisibilityContext {
  return {
    instanceClass: "ems__Project",
    currentStatus: null,
    metadata: {},
    isArchived: false,
    currentFolder: "/some/folder",
    expectedFolder: "/some/folder",
    ...overrides,
  };
}

describe("ProjectVisibilityRules", () => {
  describe("canCreateProject", () => {
    it("should return true for ems__Area", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: "ems__Area" })),
      ).toBe(true);
    });

    it("should return true for ems__Initiative", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: "ems__Initiative" })),
      ).toBe(true);
    });

    it("should return true for ems__Project", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: "ems__Project" })),
      ).toBe(true);
    });

    it("should return false for ems__Task", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: "ems__Task" })),
      ).toBe(false);
    });

    it("should return false for ems__Meeting", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: "ems__Meeting" })),
      ).toBe(false);
    });

    it("should return false for arbitrary class", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: "other__Class" })),
      ).toBe(false);
    });

    it("should return false for null instanceClass", () => {
      expect(
        canCreateProject(makeContext({ instanceClass: null as unknown as string })),
      ).toBe(false);
    });

    it("should handle array instanceClass with ems__Area", () => {
      expect(
        canCreateProject(
          makeContext({ instanceClass: ["ems__Area"] as unknown as string }),
        ),
      ).toBe(true);
    });

    it("should handle array instanceClass with ems__Initiative", () => {
      expect(
        canCreateProject(
          makeContext({ instanceClass: ["ems__Initiative"] as unknown as string }),
        ),
      ).toBe(true);
    });

    it("should handle array instanceClass with ems__Project", () => {
      expect(
        canCreateProject(
          makeContext({ instanceClass: ["ems__Project"] as unknown as string }),
        ),
      ).toBe(true);
    });
  });

  describe("canMoveToAnalysis", () => {
    it("should return true for Project with Backlog status", () => {
      expect(
        canMoveToAnalysis(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for Project with non-Backlog status", () => {
      expect(
        canMoveToAnalysis(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for non-Project class", () => {
      expect(
        canMoveToAnalysis(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for Project with null status", () => {
      expect(
        canMoveToAnalysis(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: null,
          }),
        ),
      ).toBe(false);
    });

    it("should handle array instanceClass with ems__Project and Backlog status", () => {
      expect(
        canMoveToAnalysis(
          makeContext({
            instanceClass: ["ems__Project"] as unknown as string,
            currentStatus: "ems__EffortStatusBacklog",
          }),
        ),
      ).toBe(true);
    });
  });

  describe("canMoveToToDo", () => {
    it("should return true for Project with Analysis status", () => {
      expect(
        canMoveToToDo(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusAnalysis",
          }),
        ),
      ).toBe(true);
    });

    it("should return false for Project with non-Analysis status", () => {
      expect(
        canMoveToToDo(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: "ems__EffortStatusDoing",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for non-Project class", () => {
      expect(
        canMoveToToDo(
          makeContext({
            instanceClass: "ems__Task",
            currentStatus: "ems__EffortStatusAnalysis",
          }),
        ),
      ).toBe(false);
    });

    it("should return false for Project with null status", () => {
      expect(
        canMoveToToDo(
          makeContext({
            instanceClass: "ems__Project",
            currentStatus: null,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("canConvertProjectToTask", () => {
    it("should return true for ems__Project", () => {
      expect(
        canConvertProjectToTask(
          makeContext({ instanceClass: "ems__Project" }),
        ),
      ).toBe(true);
    });

    it("should return false for ems__Task", () => {
      expect(
        canConvertProjectToTask(
          makeContext({ instanceClass: "ems__Task" }),
        ),
      ).toBe(false);
    });

    it("should return false for ems__Area", () => {
      expect(
        canConvertProjectToTask(
          makeContext({ instanceClass: "ems__Area" }),
        ),
      ).toBe(false);
    });

    it("should handle array instanceClass with ems__Project", () => {
      expect(
        canConvertProjectToTask(
          makeContext({
            instanceClass: ["ems__Project"] as unknown as string,
          }),
        ),
      ).toBe(true);
    });
  });
});
