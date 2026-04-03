import { describe, it, expect } from "@jest/globals";
import {
  PROJECT_DEFAULT_WORKFLOW,
  TASK_DEFAULT_WORKFLOW,
  buildWorkflowAssetContent,
} from "../../../../src/domain/defaults/DefaultWorkflows";
import type { WorkflowDefinition, WorkflowStateDefinition, WorkflowTransitionDefinition } from "../../../../src/domain/models/WorkflowDefinition";

describe("DefaultWorkflows - branch coverage", () => {
  describe("PROJECT_DEFAULT_WORKFLOW", () => {
    it("should have name", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.name).toBeDefined();
    });

    it("should have states with timestamps", () => {
      const withTimestamps = PROJECT_DEFAULT_WORKFLOW.states.filter(
        (s: WorkflowStateDefinition) => s.timestampOnEnter.length > 0,
      );
      expect(withTimestamps.length).toBeGreaterThan(0);
    });

    it("should have states without timestamps", () => {
      const withoutTimestamps = PROJECT_DEFAULT_WORKFLOW.states.filter(
        (s: WorkflowStateDefinition) => s.timestampOnEnter.length === 0,
      );
      expect(withoutTimestamps.length).toBeGreaterThan(0);
    });
  });

  describe("TASK_DEFAULT_WORKFLOW", () => {
    it("should have name", () => {
      expect(TASK_DEFAULT_WORKFLOW.name).toBeDefined();
    });

    it("should have transitions with rollback", () => {
      const rollbacks = TASK_DEFAULT_WORKFLOW.transitions.filter(
        (t: WorkflowTransitionDefinition) => t.isRollback,
      );
      expect(rollbacks.length).toBeGreaterThan(0);
    });
  });

  describe("buildWorkflowAssetContent", () => {
    it("should generate files for task workflow", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      expect(files.length).toBeGreaterThan(0);
      expect(files.length).toBe(
        1 + TASK_DEFAULT_WORKFLOW.states.length + TASK_DEFAULT_WORKFLOW.transitions.length,
      );
    });

    it("should generate files for project workflow", () => {
      const files = buildWorkflowAssetContent(PROJECT_DEFAULT_WORKFLOW);

      expect(files.length).toBe(
        1 + PROJECT_DEFAULT_WORKFLOW.states.length + PROJECT_DEFAULT_WORKFLOW.transitions.length,
      );
    });

    it("should include timestamp properties in state files when configured", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      // State files start at index 1
      const stateFiles = files.slice(1, 1 + TASK_DEFAULT_WORKFLOW.states.length);

      const statesWithTimestamp = TASK_DEFAULT_WORKFLOW.states.filter(
        (s: WorkflowStateDefinition) => s.timestampOnEnter.length > 0,
      );

      for (const state of statesWithTimestamp) {
        const stateIndex = TASK_DEFAULT_WORKFLOW.states.indexOf(state);
        const stateFile = stateFiles[stateIndex];
        expect(stateFile.content).toContain("ems__WorkflowState_timestampOnEnter");
      }
    });

    it("should not include timestamp properties in states without them", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      const stateFiles = files.slice(1, 1 + TASK_DEFAULT_WORKFLOW.states.length);

      const statesWithoutTimestamp = TASK_DEFAULT_WORKFLOW.states.filter(
        (s: WorkflowStateDefinition) => s.timestampOnEnter.length === 0,
      );

      for (const state of statesWithoutTimestamp) {
        const stateIndex = TASK_DEFAULT_WORKFLOW.states.indexOf(state);
        const stateFile = stateFiles[stateIndex];
        expect(stateFile.content).not.toContain("ems__WorkflowState_timestampOnEnter");
      }
    });

    it("should include badge color in state files when configured", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      const stateFiles = files.slice(1, 1 + TASK_DEFAULT_WORKFLOW.states.length);
      const statesWithBadge = TASK_DEFAULT_WORKFLOW.states.filter(
        (s: WorkflowStateDefinition) => s.badgeColor,
      );

      for (const state of statesWithBadge) {
        const stateIndex = TASK_DEFAULT_WORKFLOW.states.indexOf(state);
        const stateFile = stateFiles[stateIndex];
        expect(stateFile.content).toContain("ems__WorkflowState_badgeColor");
      }
    });

    it("should include icon in transition files when configured", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      const transitionFiles = files.slice(1 + TASK_DEFAULT_WORKFLOW.states.length);
      const transWithIcon = TASK_DEFAULT_WORKFLOW.transitions.filter(
        (t: WorkflowTransitionDefinition) => t.icon,
      );

      for (const trans of transWithIcon) {
        const transIndex = TASK_DEFAULT_WORKFLOW.transitions.indexOf(trans);
        const transFile = transitionFiles[transIndex];
        expect(transFile.content).toContain("ems__WorkflowTransition_icon");
      }
    });

    it("should not include icon in transition files without it", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      const transitionFiles = files.slice(1 + TASK_DEFAULT_WORKFLOW.states.length);
      const transWithoutIcon = TASK_DEFAULT_WORKFLOW.transitions.filter(
        (t: WorkflowTransitionDefinition) => !t.icon,
      );

      for (const trans of transWithoutIcon) {
        const transIndex = TASK_DEFAULT_WORKFLOW.transitions.indexOf(trans);
        const transFile = transitionFiles[transIndex];
        expect(transFile.content).not.toContain("ems__WorkflowTransition_icon");
      }
    });

    it("should have .md extension on all files", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);

      for (const file of files) {
        expect(file.filename).toMatch(/\.md$/);
      }
    });
  });
});
