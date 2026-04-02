import { WorkflowCommandAdapter } from "../../../src/services/WorkflowCommandAdapter";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import { GroundingType } from "../../../src/domain/constants/GroundingType";
import type { WorkflowDefinition } from "../../../src/domain/models/WorkflowDefinition";
import { AssetClass } from "../../../src/domain/constants/AssetClass";

// -- Test Fixtures --

function createMinimalWorkflow(
  overrides?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    id: "wf-test",
    name: "Test Workflow",
    targetClass: AssetClass.TASK,
    initialState: EffortStatus.BACKLOG,
    terminalStates: [EffortStatus.DONE, EffortStatus.TRASHED],
    isDefault: true,
    states: [
      { status: EffortStatus.BACKLOG, order: 0, optional: false, timestampOnEnter: [] },
      { status: EffortStatus.TODO, order: 1, optional: false, timestampOnEnter: [] },
      {
        status: EffortStatus.DOING,
        order: 2,
        optional: false,
        timestampOnEnter: ["ems__Effort_startTimestamp"],
      },
      {
        status: EffortStatus.DONE,
        order: 3,
        optional: false,
        timestampOnEnter: ["ems__Effort_endTimestamp"],
      },
      { status: EffortStatus.TRASHED, order: 4, optional: false, timestampOnEnter: [] },
    ],
    transitions: [
      { from: EffortStatus.BACKLOG, to: EffortStatus.TODO, label: "→ Todo", isRollback: false },
      { from: EffortStatus.TODO, to: EffortStatus.DOING, label: "▶ Start", icon: "play", isRollback: false },
      { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "✓ Done", icon: "check", isRollback: false },
      { from: EffortStatus.DOING, to: EffortStatus.TODO, label: "← Back", icon: "undo", isRollback: true },
      { from: EffortStatus.BACKLOG, to: EffortStatus.TRASHED, label: "🗑 Trash", icon: "trash", isRollback: false },
    ],
    ...overrides,
  };
}

// -- Tests --

describe("WorkflowCommandAdapter", () => {
  let adapter: WorkflowCommandAdapter;
  let workflow: WorkflowDefinition;

  beforeEach(() => {
    workflow = createMinimalWorkflow();
    adapter = new WorkflowCommandAdapter(workflow);
  });

  // -- adaptTransitions --

  describe("adaptTransitions", () => {
    it("should return all transitions from current status as commands", () => {
      const commands = adapter.adaptTransitions(EffortStatus.BACKLOG);

      expect(commands).toHaveLength(2); // Todo + Trash
    });

    it("should return empty array for terminal states", () => {
      const commands = adapter.adaptTransitions(EffortStatus.DONE);

      expect(commands).toHaveLength(0);
    });

    it("should include both forward and rollback transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.DOING);

      expect(commands).toHaveLength(2); // Done + Back
      const categories = commands.map((c) => c.category);
      expect(categories).toContain("workflow");
      expect(categories).toContain("rollback");
    });

    it("should generate deterministic command IDs", () => {
      const commands = adapter.adaptTransitions(EffortStatus.BACKLOG);

      expect(commands[0].id).toBe("workflow-backlog-to-todo");
      expect(commands[1].id).toBe("workflow-backlog-to-trashed");
    });

    it("should preserve transition label as command name", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].name).toBe("▶ Start");
    });

    it("should preserve transition icon", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].icon).toBe("play");
    });

    it("should handle transitions without icon", () => {
      const commands = adapter.adaptTransitions(EffortStatus.BACKLOG);
      const todoCmd = commands.find((c) => c.id === "workflow-backlog-to-todo");

      expect(todoCmd?.icon).toBeUndefined();
    });
  });

  // -- Preconditions --

  describe("preconditions", () => {
    it("should build precondition with SPARQL ASK checking from-status", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);
      const precondition = commands[0].precondition;

      expect(precondition).toBeDefined();
      expect(precondition!.id).toBe("precond-workflow-todo-to-doing");
      expect(precondition!.sparqlAsk).toContain(EffortStatus.TODO);
      expect(precondition!.sparqlAsk).toContain("$target");
    });

    it("should include human-readable label in precondition", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].precondition!.label).toContain("todo");
    });
  });

  // -- Grounding --

  describe("grounding", () => {
    it("should build composite grounding with status + timestamps", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);
      const startCmd = commands[0]; // Todo → Doing

      // Doing has timestampOnEnter: ["ems__Effort_startTimestamp"]
      expect(startCmd.grounding.type).toBe(GroundingType.COMPOSITE);
      expect(startCmd.grounding.steps).toHaveLength(2);
    });

    it("should set status property as first grounding step", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);
      const steps = commands[0].grounding.steps!;

      expect(steps[0].type).toBe(GroundingType.PROPERTY_SET);
      expect(steps[0].targetProperty).toBe("ems__Effort_status");
      expect(steps[0].targetValue).toBe(EffortStatus.DOING);
    });

    it("should set timestamps as subsequent grounding steps", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);
      const steps = commands[0].grounding.steps!;

      expect(steps[1].type).toBe(GroundingType.PROPERTY_SET);
      expect(steps[1].targetProperty).toBe("ems__Effort_startTimestamp");
      expect(steps[1].targetValue).toBe("$now");
    });

    it("should return simple grounding when no timestamps", () => {
      const commands = adapter.adaptTransitions(EffortStatus.BACKLOG);
      const todoCmd = commands.find((c) => c.id === "workflow-backlog-to-todo");

      // Todo has no timestampOnEnter → single property_set, not composite
      expect(todoCmd!.grounding.type).toBe(GroundingType.PROPERTY_SET);
      expect(todoCmd!.grounding.targetProperty).toBe("ems__Effort_status");
      expect(todoCmd!.grounding.targetValue).toBe(EffortStatus.TODO);
      expect(todoCmd!.grounding.steps).toBeUndefined();
    });

    it("should handle multiple timestamps on enter", () => {
      const multiTimestampWorkflow = createMinimalWorkflow({
        states: [
          { status: EffortStatus.BACKLOG, order: 0, optional: false, timestampOnEnter: [] },
          {
            status: EffortStatus.DOING,
            order: 1,
            optional: false,
            timestampOnEnter: [
              "ems__Effort_startTimestamp",
              "ems__Effort_plannedStartTimestamp",
            ],
          },
          { status: EffortStatus.DONE, order: 2, optional: false, timestampOnEnter: [] },
        ],
        transitions: [
          { from: EffortStatus.BACKLOG, to: EffortStatus.DOING, label: "Start", isRollback: false },
          { from: EffortStatus.DOING, to: EffortStatus.DONE, label: "Done", isRollback: false },
        ],
      });

      const multiAdapter = new WorkflowCommandAdapter(multiTimestampWorkflow);
      const commands = multiAdapter.adaptTransitions(EffortStatus.BACKLOG);
      const steps = commands[0].grounding.steps!;

      expect(steps).toHaveLength(3); // status + 2 timestamps
      expect(steps[0].targetProperty).toBe("ems__Effort_status");
      expect(steps[1].targetProperty).toBe("ems__Effort_startTimestamp");
      expect(steps[2].targetProperty).toBe("ems__Effort_plannedStartTimestamp");
    });
  });

  // -- Category --

  describe("category", () => {
    it("should set category to 'workflow' for forward transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].category).toBe("workflow");
    });

    it("should set category to 'rollback' for rollback transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.DOING);
      const rollbackCmd = commands.find((c) => c.category === "rollback");

      expect(rollbackCmd).toBeDefined();
      expect(rollbackCmd!.id).toBe("workflow-doing-to-todo");
    });
  });

  // -- Confirm/Success Messages --

  describe("messages", () => {
    it("should set confirmMessage for rollback transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.DOING);
      const rollbackCmd = commands.find((c) => c.category === "rollback");

      expect(rollbackCmd!.confirmMessage).toContain("Rollback");
      expect(rollbackCmd!.confirmMessage).toContain("todo");
    });

    it("should not set confirmMessage for forward transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].confirmMessage).toBeUndefined();
    });

    it("should set successMessage for all transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].successMessage).toContain("doing");
    });
  });

  // -- adaptForwardTransitions / adaptRollbackTransitions --

  describe("adaptForwardTransitions", () => {
    it("should return only forward transitions", () => {
      const commands = adapter.adaptForwardTransitions(EffortStatus.DOING);

      expect(commands).toHaveLength(1);
      expect(commands[0].category).toBe("workflow");
      expect(commands[0].id).toBe("workflow-doing-to-done");
    });
  });

  describe("adaptRollbackTransitions", () => {
    it("should return only rollback transitions", () => {
      const commands = adapter.adaptRollbackTransitions(EffortStatus.DOING);

      expect(commands).toHaveLength(1);
      expect(commands[0].category).toBe("rollback");
      expect(commands[0].id).toBe("workflow-doing-to-todo");
    });

    it("should return empty when no rollback available", () => {
      const commands = adapter.adaptRollbackTransitions(EffortStatus.BACKLOG);

      expect(commands).toHaveLength(0);
    });
  });

  // -- Accessor methods --

  describe("getEngine", () => {
    it("should expose the underlying WorkflowEngine", () => {
      const engine = adapter.getEngine();

      expect(engine.canTransition(EffortStatus.BACKLOG, EffortStatus.TODO)).toBe(true);
    });
  });

  describe("getWorkflow", () => {
    it("should return the original workflow definition", () => {
      expect(adapter.getWorkflow()).toBe(workflow);
    });
  });

  // -- Edge Cases --

  describe("edge cases", () => {
    it("should handle status with no outgoing transitions", () => {
      const commands = adapter.adaptTransitions(EffortStatus.TRASHED);

      expect(commands).toHaveLength(0);
    });

    it("should produce consistent IDs across multiple calls", () => {
      const first = adapter.adaptTransitions(EffortStatus.BACKLOG);
      const second = adapter.adaptTransitions(EffortStatus.BACKLOG);

      expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    });

    it("should match VisibilityGenerator command ID format", () => {
      // VisibilityGenerator uses: workflow-{fromShort}-to-{toShort}
      // where fromShort = t.from.replace("ems__EffortStatus", "").toLowerCase()
      const commands = adapter.adaptTransitions(EffortStatus.TODO);

      expect(commands[0].id).toMatch(/^workflow-[a-z]+-to-[a-z]+$/);
    });
  });
});
