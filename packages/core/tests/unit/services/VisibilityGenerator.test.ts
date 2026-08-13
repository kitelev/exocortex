import { VisibilityGenerator } from "../../../src/services/VisibilityGenerator";
import { WorkflowEngine } from "../../../src/services/WorkflowEngine";
import { WorkflowResolver } from "../../../src/services/WorkflowResolver";
import { InMemoryTripleStore } from "../../../src/infrastructure/rdf/InMemoryTripleStore";
import { AssetClass } from "../../../src/domain/constants/AssetClass";
import { EffortStatus } from "../../../src/domain/constants/EffortStatus";

function getProjectEngine(): WorkflowEngine {
  const resolver = new WorkflowResolver(new InMemoryTripleStore());
  return new WorkflowEngine(resolver.getHardcodedFallback(AssetClass.PROJECT));
}

function getTaskEngine(): WorkflowEngine {
  const resolver = new WorkflowResolver(new InMemoryTripleStore());
  return new WorkflowEngine(resolver.getHardcodedFallback(AssetClass.TASK));
}

describe("VisibilityGenerator", () => {
  describe("with Project workflow", () => {
    let gen: VisibilityGenerator;

    beforeEach(() => {
      gen = new VisibilityGenerator(getProjectEngine());
    });

    it("should return Doing as forward command from Backlog", () => {
      const cmds = gen.getForwardCommands(EffortStatus.BACKLOG);
      const targets = cmds.map(c => c.targetStatus);
      expect(targets).toContain(EffortStatus.DOING);
    });

    it("should return Backlog as rollback command from Doing", () => {
      const cmds = gen.getRollbackCommands(EffortStatus.DOING);
      const targets = cmds.map(c => c.targetStatus);
      expect(targets).toContain(EffortStatus.BACKLOG);
    });

    it("should include both forward and rollback in getVisibleCommands", () => {
      const all = gen.getVisibleCommands(EffortStatus.BACKLOG);
      const forward = gen.getForwardCommands(EffortStatus.BACKLOG);
      const rollback = gen.getRollbackCommands(EffortStatus.BACKLOG);
      expect(all.length).toBe(forward.length + rollback.length);
    });
  });

  describe("with Task workflow", () => {
    let gen: VisibilityGenerator;

    beforeEach(() => {
      gen = new VisibilityGenerator(getTaskEngine());
    });

    it("should return Doing as the only forward command from Backlog", () => {
      const cmds = gen.getForwardCommands(EffortStatus.BACKLOG);
      const targets = cmds.map(c => c.targetStatus);
      expect(targets).toEqual([EffortStatus.DOING]);
    });

    it("should return Backlog as rollback from Doing", () => {
      const cmds = gen.getRollbackCommands(EffortStatus.DOING);
      const targets = cmds.map(c => c.targetStatus);
      expect(targets).toContain(EffortStatus.BACKLOG);
    });
  });

  describe("terminal and initial states", () => {
    let gen: VisibilityGenerator;

    beforeEach(() => {
      gen = new VisibilityGenerator(getProjectEngine());
    });

    it("should have no forward commands from Done", () => {
      const cmds = gen.getForwardCommands(EffortStatus.DONE);
      expect(cmds).toHaveLength(0);
    });

    it("should have no forward commands from Trashed", () => {
      const cmds = gen.getForwardCommands(EffortStatus.TRASHED);
      expect(cmds).toHaveLength(0);
    });

    it("should have forward command from Draft to Backlog but no rollback", () => {
      const forward = gen.getForwardCommands(EffortStatus.DRAFT);
      const rollback = gen.getRollbackCommands(EffortStatus.DRAFT);
      expect(forward.length).toBeGreaterThan(0);
      expect(forward.some(c => c.targetStatus === EffortStatus.BACKLOG)).toBe(true);
      expect(rollback).toHaveLength(0);
    });
  });

  describe("command format", () => {
    let gen: VisibilityGenerator;

    beforeEach(() => {
      gen = new VisibilityGenerator(getProjectEngine());
    });

    it("should generate correct commandId format", () => {
      const cmds = gen.getForwardCommands(EffortStatus.DRAFT);
      const cmd = cmds.find(c => c.targetStatus === EffortStatus.BACKLOG);
      expect(cmd).toBeDefined();
      expect(cmd!.commandId).toBe("workflow-draft-to-backlog");
    });

    it("should have labels on all commands", () => {
      const all = gen.getVisibleCommands(EffortStatus.BACKLOG);
      expect(all.length).toBeGreaterThan(0);
      for (const cmd of all) {
        expect(cmd.label).toBeTruthy();
      }
    });

    it("should mark rollback commands with isRollback=true", () => {
      const rollback = gen.getRollbackCommands(EffortStatus.BACKLOG);
      for (const cmd of rollback) {
        expect(cmd.isRollback).toBe(true);
      }
    });

    it("should mark forward commands with isRollback=false", () => {
      const forward = gen.getForwardCommands(EffortStatus.BACKLOG);
      for (const cmd of forward) {
        expect(cmd.isRollback).toBe(false);
      }
    });
  });
});
