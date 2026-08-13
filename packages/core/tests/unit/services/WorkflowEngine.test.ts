import { WorkflowEngine } from "../../../src/services/WorkflowEngine";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";
import type { WorkflowDefinition } from "../../../src/domain/models/WorkflowDefinition";

/** Get default Project workflow via resolver fallback */
function getProjectWorkflow(): WorkflowDefinition {
  const resolver = new WorkflowResolver(new InMemoryTripleStore());
  return resolver.getHardcodedFallback(AssetClass.PROJECT);
}

/** Get default Task workflow via resolver fallback */
function getTaskWorkflow(): WorkflowDefinition {
  const resolver = new WorkflowResolver(new InMemoryTripleStore());
  return resolver.getHardcodedFallback(AssetClass.TASK);
}

/** Build a minimal custom workflow */
function buildMinimalWorkflow(
  overrides?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    id: "test-workflow",
    name: "Test Workflow",
    targetClass: AssetClass.TASK,
    initialState: EffortStatus.DRAFT,
    terminalStates: [EffortStatus.DONE],
    isDefault: true,
    states: [
      { status: EffortStatus.DRAFT, order: 1, optional: false, timestampOnEnter: [] },
      { status: EffortStatus.DONE, order: 2, optional: false, timestampOnEnter: ["ems__Effort_endTimestamp"] },
    ],
    transitions: [
      { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "✓ Done", isRollback: false },
      { from: EffortStatus.DONE, to: EffortStatus.DRAFT, label: "← Draft", isRollback: true },
    ],
    ...overrides,
  };
}

describe("WorkflowEngine", () => {
  describe("with default Project workflow", () => {
    let engine: WorkflowEngine;

    beforeEach(() => {
      engine = new WorkflowEngine(getProjectWorkflow());
    });

    it("should return Doing as next state from Backlog", () => {
      const next = engine.getNextStates(EffortStatus.BACKLOG);
      expect(next).toContain(EffortStatus.DOING);
    });

    it("should return Done as next state from Doing", () => {
      const next = engine.getNextStates(EffortStatus.DOING);
      expect(next).toContain(EffortStatus.DONE);
    });

    it("should allow transition from Draft to Backlog", () => {
      expect(engine.canTransition(EffortStatus.DRAFT, EffortStatus.BACKLOG)).toBe(true);
    });

    it("should NOT allow direct transition from Draft to Doing", () => {
      expect(engine.canTransition(EffortStatus.DRAFT, EffortStatus.DOING)).toBe(false);
    });

    it("should rollback DOING to Backlog", () => {
      const prev = engine.getPreviousStatus(EffortStatus.DOING);
      expect(prev).toBe(EffortStatus.BACKLOG);
    });

    it("should rollback DONE to DOING", () => {
      expect(engine.getPreviousStatus(EffortStatus.DONE)).toBe(EffortStatus.DOING);
    });

    it("should have no rollback from DRAFT", () => {
      expect(engine.getPreviousStatus(EffortStatus.DRAFT)).toBeNull();
    });

    it("should identify Done as terminal state", () => {
      expect(engine.isTerminalState(EffortStatus.DONE)).toBe(true);
    });

    it("should identify Trashed as terminal state", () => {
      expect(engine.isTerminalState(EffortStatus.TRASHED)).toBe(true);
    });

    it("should NOT identify Doing as terminal state", () => {
      expect(engine.isTerminalState(EffortStatus.DOING)).toBe(false);
    });

    it("should identify Draft as initial state", () => {
      expect(engine.isInitialState(EffortStatus.DRAFT)).toBe(true);
    });

    it("should validate as valid", () => {
      const result = engine.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("with default Task workflow", () => {
    let engine: WorkflowEngine;

    beforeEach(() => {
      engine = new WorkflowEngine(getTaskWorkflow());
    });

    it("should go from Backlog directly to Doing", () => {
      const next = engine.getNextStates(EffortStatus.BACKLOG);
      expect(next).toEqual([EffortStatus.DOING]);
    });

    it("should rollback DOING to Backlog", () => {
      expect(engine.getPreviousStatus(EffortStatus.DOING)).toBe(EffortStatus.BACKLOG);
    });

    it("should validate as valid", () => {
      expect(engine.validate().valid).toBe(true);
    });
  });

  describe("transitions", () => {
    it("should return empty array for terminal state with no forward transitions", () => {
      const engine = new WorkflowEngine(buildMinimalWorkflow());
      const transitions = engine.getAvailableTransitions(EffortStatus.DONE);
      expect(transitions).toHaveLength(0);
    });

    it("should separate forward and rollback transitions", () => {
      const engine = new WorkflowEngine(getProjectWorkflow());

      const forward = engine.getAvailableTransitions(EffortStatus.BACKLOG);
      const rollback = engine.getRollbackTransitions(EffortStatus.BACKLOG);
      const all = engine.getAllTransitions(EffortStatus.BACKLOG);

      expect(forward.length).toBeGreaterThan(0);
      expect(rollback.length).toBeGreaterThan(0);
      expect(all.length).toBe(forward.length + rollback.length);
    });

    it("should return transition definition for valid from→to pair", () => {
      const engine = new WorkflowEngine(getProjectWorkflow());
      const t = engine.getTransition(EffortStatus.DRAFT, EffortStatus.BACKLOG);
      expect(t).toBeDefined();
      expect(t?.label).toBe("→ Backlog");
    });

    it("should return undefined for invalid from→to pair", () => {
      const engine = new WorkflowEngine(getProjectWorkflow());
      expect(engine.getTransition(EffortStatus.DRAFT, EffortStatus.DONE)).toBeUndefined();
    });
  });

  describe("timestamps", () => {
    it("should return timestamps for Doing state", () => {
      const engine = new WorkflowEngine(getTaskWorkflow());
      const ts = engine.getTimestampsForStatus(EffortStatus.DOING);
      expect(ts).toContain("ems__Effort_startTimestamp");
    });

    it("should return timestamps for Done state", () => {
      const engine = new WorkflowEngine(getTaskWorkflow());
      const ts = engine.getTimestampsForStatus(EffortStatus.DONE);
      expect(ts).toContain("ems__Effort_endTimestamp");
      expect(ts).toContain("ems__Effort_resolutionTimestamp");
    });

    it("should return empty array for Draft state", () => {
      const engine = new WorkflowEngine(getTaskWorkflow());
      expect(engine.getTimestampsForStatus(EffortStatus.DRAFT)).toHaveLength(0);
    });

    it("should return empty array for unknown status", () => {
      const engine = new WorkflowEngine(buildMinimalWorkflow());
      expect(engine.getTimestampsForStatus(EffortStatus.WAITING)).toHaveLength(0);
    });
  });

  describe("ordered states", () => {
    it("should return states in order", () => {
      const engine = new WorkflowEngine(getProjectWorkflow());
      const ordered = engine.getOrderedStates();

      expect(ordered[0]).toBe(EffortStatus.DRAFT);
      expect(ordered[ordered.length - 1]).toBe(EffortStatus.TRASHED);
    });

    it("should return definition via getter", () => {
      const def = getProjectWorkflow();
      const engine = new WorkflowEngine(def);
      expect(engine.getDefinition()).toBe(def);
    });
  });

  describe("validation", () => {
    it("should fail for empty states", () => {
      const engine = new WorkflowEngine(buildMinimalWorkflow({ states: [] }));
      const result = engine.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least one state"))).toBe(true);
    });

    it("should fail when initial state not in states list", () => {
      const engine = new WorkflowEngine(
        buildMinimalWorkflow({ initialState: EffortStatus.WAITING }),
      );
      const result = engine.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Initial state"))).toBe(true);
    });

    it("should fail when terminal state not in states list", () => {
      const engine = new WorkflowEngine(
        buildMinimalWorkflow({ terminalStates: [EffortStatus.TRASHED] }),
      );
      const result = engine.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Terminal state"))).toBe(true);
    });

    it("should fail when transition references unknown state", () => {
      const engine = new WorkflowEngine(
        buildMinimalWorkflow({
          transitions: [
            { from: EffortStatus.DRAFT, to: EffortStatus.WAITING, label: "bad", isRollback: false },
          ],
        }),
      );
      const result = engine.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("unknown target state"))).toBe(true);
    });

    it("should fail when non-terminal state has no outgoing forward transition", () => {
      const engine = new WorkflowEngine(
        buildMinimalWorkflow({
          transitions: [
            // Only rollback, no forward from Draft
            { from: EffortStatus.DONE, to: EffortStatus.DRAFT, label: "← Draft", isRollback: true },
          ],
        }),
      );
      const result = engine.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("dead end"))).toBe(true);
    });

    it("should fail on duplicate transitions", () => {
      const engine = new WorkflowEngine(
        buildMinimalWorkflow({
          transitions: [
            { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "Done 1", isRollback: false },
            { from: EffortStatus.DRAFT, to: EffortStatus.DONE, label: "Done 2", isRollback: false },
          ],
        }),
      );
      const result = engine.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Duplicate transition"))).toBe(true);
    });

    it("should pass for valid minimal workflow", () => {
      const engine = new WorkflowEngine(buildMinimalWorkflow());
      expect(engine.validate().valid).toBe(true);
    });
  });
});
