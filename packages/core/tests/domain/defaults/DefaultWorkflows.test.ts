import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import {
  PROJECT_DEFAULT_WORKFLOW,
  TASK_DEFAULT_WORKFLOW,
  buildWorkflowAssetContent,
} from "../../../src/domain/defaults/DefaultWorkflows";

describe("DefaultWorkflows", () => {
  describe("PROJECT_DEFAULT_WORKFLOW", () => {
    it("should have correct targetClass", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.targetClass).toBe(AssetClass.PROJECT);
    });

    it("should have 5 states", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.states).toHaveLength(5);
    });

    it("should have 6 transitions", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.transitions).toHaveLength(6);
    });

    it("should have DRAFT as initial state", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.initialState).toBe(EffortStatus.DRAFT);
    });

    it("should have DONE and TRASHED as terminal states", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.terminalStates).toEqual([
        EffortStatus.DONE,
        EffortStatus.TRASHED,
      ]);
    });

    it("should be marked as default", () => {
      expect(PROJECT_DEFAULT_WORKFLOW.isDefault).toBe(true);
    });

    it("should have states in correct order", () => {
      const orders = PROJECT_DEFAULT_WORKFLOW.states.map((s) => s.order);
      expect(orders).toEqual([1, 2, 3, 4, 5]);
    });

    it("should have no optional states (Analysis/ToDo dropped with req fcbde537)", () => {
      const optionalStates = PROJECT_DEFAULT_WORKFLOW.states
        .filter((s) => s.optional)
        .map((s) => s.status);
      expect(optionalStates).toEqual([]);
    });

    it("should set startTimestamp when entering DOING", () => {
      const doingState = PROJECT_DEFAULT_WORKFLOW.states.find(
        (s) => s.status === EffortStatus.DOING,
      );
      expect(doingState?.timestampOnEnter).toContain("ems__Effort_startTimestamp");
    });

    it("should set endTimestamp and resolutionTimestamp when entering DONE", () => {
      const doneState = PROJECT_DEFAULT_WORKFLOW.states.find(
        (s) => s.status === EffortStatus.DONE,
      );
      expect(doneState?.timestampOnEnter).toContain("ems__Effort_endTimestamp");
      expect(doneState?.timestampOnEnter).toContain("ems__Effort_resolutionTimestamp");
    });

    it("should have 3 forward and 3 rollback transitions", () => {
      const forward = PROJECT_DEFAULT_WORKFLOW.transitions.filter((t) => !t.isRollback);
      const rollback = PROJECT_DEFAULT_WORKFLOW.transitions.filter((t) => t.isRollback);
      expect(forward).toHaveLength(3);
      expect(rollback).toHaveLength(3);
    });
  });

  describe("TASK_DEFAULT_WORKFLOW", () => {
    it("should have correct targetClass", () => {
      expect(TASK_DEFAULT_WORKFLOW.targetClass).toBe(AssetClass.TASK);
    });

    it("should have 5 states", () => {
      expect(TASK_DEFAULT_WORKFLOW.states).toHaveLength(5);
    });

    it("should have 6 transitions", () => {
      expect(TASK_DEFAULT_WORKFLOW.transitions).toHaveLength(6);
    });

    it("should have DRAFT as initial state", () => {
      expect(TASK_DEFAULT_WORKFLOW.initialState).toBe(EffortStatus.DRAFT);
    });

    it("should have DONE and TRASHED as terminal states", () => {
      expect(TASK_DEFAULT_WORKFLOW.terminalStates).toEqual([
        EffortStatus.DONE,
        EffortStatus.TRASHED,
      ]);
    });

    it("should be marked as default", () => {
      expect(TASK_DEFAULT_WORKFLOW.isDefault).toBe(true);
    });

    it("should have states in correct order", () => {
      const orders = TASK_DEFAULT_WORKFLOW.states.map((s) => s.order);
      expect(orders).toEqual([1, 2, 3, 4, 5]);
    });

    it("should have no optional states", () => {
      const optionalStates = TASK_DEFAULT_WORKFLOW.states.filter((s) => s.optional);
      expect(optionalStates).toHaveLength(0);
    });

    it("should have 3 forward and 3 rollback transitions", () => {
      const forward = TASK_DEFAULT_WORKFLOW.transitions.filter((t) => !t.isRollback);
      const rollback = TASK_DEFAULT_WORKFLOW.transitions.filter((t) => t.isRollback);
      expect(forward).toHaveLength(3);
      expect(rollback).toHaveLength(3);
    });
  });

  describe("buildWorkflowAssetContent", () => {
    it("should generate correct number of files for project workflow", () => {
      const files = buildWorkflowAssetContent(PROJECT_DEFAULT_WORKFLOW);
      // 1 workflow + 5 states + 6 transitions = 12
      expect(files).toHaveLength(12);
    });

    it("should generate correct number of files for task workflow", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      // 1 workflow + 5 states + 6 transitions = 12
      expect(files).toHaveLength(12);
    });

    it("should generate files with .md extension", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      for (const file of files) {
        expect(file.filename).toMatch(/\.md$/);
      }
    });

    it("should generate files with valid YAML frontmatter format", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      for (const file of files) {
        expect(file.content).toMatch(/^---\n/);
        expect(file.content).toMatch(/\n---\n/);
      }
    });

    it("should include exo__Asset_uid in every file", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      for (const file of files) {
        expect(file.content).toContain("exo__Asset_uid:");
      }
    });

    it("should include exo__Asset_label in every file", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      for (const file of files) {
        expect(file.content).toContain("exo__Asset_label:");
      }
    });

    it("should include exo__Instance_class in every file", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      for (const file of files) {
        expect(file.content).toContain("exo__Instance_class:");
      }
    });

    it("should reference correct targetClass in workflow file", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      const workflowFile = files[0];
      expect(workflowFile.content).toContain(AssetClass.TASK);
    });

    it("should reference correct targetClass for project workflow", () => {
      const files = buildWorkflowAssetContent(PROJECT_DEFAULT_WORKFLOW);
      const workflowFile = files[0];
      expect(workflowFile.content).toContain(AssetClass.PROJECT);
    });

    it("should set workflow file as ems__Workflow class", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      const workflowFile = files[0];
      expect(workflowFile.content).toContain(`exo__Instance_class: ${AssetClass.WORKFLOW}`);
    });

    it("should set state files as ems__WorkflowState class", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      // States are files[1] through files[5] (5 states)
      for (let i = 1; i <= 5; i++) {
        expect(files[i].content).toContain(
          `exo__Instance_class: ${AssetClass.WORKFLOW_STATE}`,
        );
      }
    });

    it("should set transition files as ems__WorkflowTransition class", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      // Transitions are files[6] through files[11] (6 transitions)
      for (let i = 6; i <= 11; i++) {
        expect(files[i].content).toContain(
          `exo__Instance_class: ${AssetClass.WORKFLOW_TRANSITION}`,
        );
      }
    });

    it("should generate unique UIDs for state and transition files", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      const uids = files.map((f) => f.filename.replace(".md", ""));
      const uniqueUids = new Set(uids);
      expect(uniqueUids.size).toBe(uids.length);
    });

    it("should include exo__Asset_createdAt in every file", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      for (const file of files) {
        expect(file.content).toContain("exo__Asset_createdAt:");
      }
    });

    it("should include isDefault property in workflow file", () => {
      const files = buildWorkflowAssetContent(PROJECT_DEFAULT_WORKFLOW);
      const workflowFile = files[0];
      expect(workflowFile.content).toContain("ems__Workflow_isDefault: true");
    });

    it("should include timestampOnEnter for states that have it", () => {
      const files = buildWorkflowAssetContent(TASK_DEFAULT_WORKFLOW);
      // DOING state (index 3 in states, file index 3) has timestampOnEnter
      const doingStateFile = files[3];
      expect(doingStateFile.content).toContain("ems__WorkflowState_timestampOnEnter:");
      expect(doingStateFile.content).toContain("ems__Effort_startTimestamp");
    });
  });
});
