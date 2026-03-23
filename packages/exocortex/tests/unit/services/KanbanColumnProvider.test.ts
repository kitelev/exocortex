import { KanbanColumnProvider } from "../../../src/services/KanbanColumnProvider";
import type { KanbanColumn } from "../../../src/services/KanbanColumnProvider";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import type { WorkflowDefinition } from "../../../src/domain/models/WorkflowDefinition";
import {
  PROJECT_DEFAULT_WORKFLOW,
  TASK_DEFAULT_WORKFLOW,
} from "../../../src/domain/defaults/DefaultWorkflows";

describe("KanbanColumnProvider", () => {
  let provider: KanbanColumnProvider;

  beforeEach(() => {
    provider = new KanbanColumnProvider();
  });

  describe("getColumns", () => {
    it("should return 7 columns for default Project workflow", () => {
      const columns = provider.getColumns(PROJECT_DEFAULT_WORKFLOW);

      expect(columns).toHaveLength(7);
      expect(columns.map((c) => c.label)).toEqual([
        "Draft",
        "Backlog",
        "Analysis",
        "ToDo",
        "Doing",
        "Done",
        "Trashed",
      ]);
    });

    it("should return 5 columns for default Task workflow", () => {
      const columns = provider.getColumns(TASK_DEFAULT_WORKFLOW);

      expect(columns).toHaveLength(5);
      expect(columns.map((c) => c.label)).toEqual([
        "Draft",
        "Backlog",
        "Doing",
        "Done",
        "Trashed",
      ]);
    });

    it("should sort columns by order", () => {
      const unorderedWorkflow: WorkflowDefinition = {
        id: "test-unordered",
        name: "Unordered Workflow",
        targetClass: AssetClass.TASK,
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
        states: [
          { status: EffortStatus.DONE, order: 3, optional: false, timestampOnEnter: [] },
          { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [] },
          { status: EffortStatus.DOING, order: 2, optional: false, timestampOnEnter: [] },
        ],
        transitions: [],
      };

      const columns = provider.getColumns(unorderedWorkflow);

      expect(columns.map((c) => c.status)).toEqual([
        EffortStatus.DRAFT,
        EffortStatus.DOING,
        EffortStatus.DONE,
      ]);
    });

    it("should preserve badge colors from state definition", () => {
      const workflow: WorkflowDefinition = {
        id: "test-colors",
        name: "Colored Workflow",
        targetClass: AssetClass.TASK,
        initialState: EffortStatus.DRAFT,
        terminalStates: [EffortStatus.DONE],
        isDefault: true,
        states: [
          { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [], badgeColor: "#cccccc" },
          { status: EffortStatus.DOING, order: 2, optional: false, timestampOnEnter: [], badgeColor: "#00ff00" },
          { status: EffortStatus.DONE, order: 3, optional: false, timestampOnEnter: [], badgeColor: "#0000ff" },
        ],
        transitions: [],
      };

      const columns = provider.getColumns(workflow);

      expect(columns[0].badgeColor).toBe("#cccccc");
      expect(columns[1].badgeColor).toBe("#00ff00");
      expect(columns[2].badgeColor).toBe("#0000ff");
    });

    it("should leave badgeColor undefined when not set in state", () => {
      const columns = provider.getColumns(TASK_DEFAULT_WORKFLOW);

      for (const col of columns) {
        expect(col.badgeColor).toBeUndefined();
      }
    });

    it("should produce human-readable labels (not full enum values)", () => {
      const columns = provider.getColumns(TASK_DEFAULT_WORKFLOW);

      for (const col of columns) {
        expect(col.label).not.toContain("ems__");
        expect(col.label).not.toContain("EffortStatus");
      }
    });

    it("should handle custom workflow with 2 states", () => {
      const minimalWorkflow: WorkflowDefinition = {
        id: "test-minimal",
        name: "Minimal Workflow",
        targetClass: AssetClass.TASK,
        initialState: EffortStatus.DOING,
        terminalStates: [EffortStatus.DONE],
        isDefault: false,
        states: [
          { status: EffortStatus.DOING, order: 1, optional: false, timestampOnEnter: [] },
          { status: EffortStatus.DONE, order: 2, optional: false, timestampOnEnter: [] },
        ],
        transitions: [
          { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "Done", isRollback: false },
        ],
      };

      const columns = provider.getColumns(minimalWorkflow);

      expect(columns).toHaveLength(2);
      expect(columns[0]).toEqual({
        status: EffortStatus.DOING,
        label: "Doing",
        order: 1,
        badgeColor: undefined,
      });
      expect(columns[1]).toEqual({
        status: EffortStatus.DONE,
        label: "Done",
        order: 2,
        badgeColor: undefined,
      });
    });

    it("should preserve correct EffortStatus enum values", () => {
      const columns = provider.getColumns(PROJECT_DEFAULT_WORKFLOW);

      expect(columns[0].status).toBe(EffortStatus.DRAFT);
      expect(columns[4].status).toBe(EffortStatus.DOING);
      expect(columns[5].status).toBe(EffortStatus.DONE);
    });
  });

  describe("getActiveColumns", () => {
    it("should return all columns when no states are disabled", () => {
      const all = provider.getColumns(PROJECT_DEFAULT_WORKFLOW);
      const active = provider.getActiveColumns(PROJECT_DEFAULT_WORKFLOW);

      expect(active).toEqual(all);
    });

    it("should filter out disabled states", () => {
      const active = provider.getActiveColumns(PROJECT_DEFAULT_WORKFLOW, [
        EffortStatus.ANALYSIS,
        EffortStatus.TODO,
      ]);

      expect(active).toHaveLength(5);
      expect(active.map((c) => c.label)).toEqual([
        "Draft",
        "Backlog",
        "Doing",
        "Done",
        "Trashed",
      ]);
    });

    it("should handle disabling a single state", () => {
      const active = provider.getActiveColumns(TASK_DEFAULT_WORKFLOW, [
        EffortStatus.TRASHED,
      ]);

      expect(active).toHaveLength(4);
      expect(active.map((c) => c.label)).toEqual([
        "Draft",
        "Backlog",
        "Doing",
        "Done",
      ]);
    });

    it("should handle empty disabled states array", () => {
      const all = provider.getColumns(TASK_DEFAULT_WORKFLOW);
      const active = provider.getActiveColumns(TASK_DEFAULT_WORKFLOW, []);

      expect(active).toEqual(all);
    });

    it("should ignore disabled states not present in workflow", () => {
      const active = provider.getActiveColumns(TASK_DEFAULT_WORKFLOW, [
        EffortStatus.ANALYSIS, // Not in Task workflow
      ]);

      // Should return all 5 Task columns unchanged
      expect(active).toHaveLength(5);
    });

    it("should maintain sort order after filtering", () => {
      const active = provider.getActiveColumns(PROJECT_DEFAULT_WORKFLOW, [
        EffortStatus.BACKLOG,
        EffortStatus.TODO,
      ]);

      const orders = active.map((c) => c.order);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThan(orders[i - 1]);
      }
    });
  });
});
