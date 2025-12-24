/**
 * ConstraintManager Tests
 *
 * Tests for the constraint management system that handles adding,
 * removing, and applying layout constraints.
 */

import {
  ConstraintManager,
  createConstraintManager,
  DEFAULT_CONSTRAINT_MANAGER_CONFIG,
} from "../../../../../../src/presentation/renderers/graph/constraints/ConstraintManager";
import type {
  Point,
  LayoutConstraint,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  ConstraintEvent,
} from "../../../../../../src/presentation/renderers/graph/constraints/constraint.types";

// ============================================================
// Test Utilities
// ============================================================

/**
 * Create a map of positions from an array
 */
function createPositions(
  data: Array<{ id: string; x: number; y: number }>
): Map<string, Point> {
  const map = new Map<string, Point>();
  for (const { id, x, y } of data) {
    map.set(id, { x, y });
  }
  return map;
}

// ============================================================
// Tests
// ============================================================

describe("ConstraintManager", () => {
  describe("construction", () => {
    it("should create with default config", () => {
      const manager = new ConstraintManager();
      expect(manager.getAllConstraints()).toHaveLength(0);
    });

    it("should create with custom config", () => {
      const manager = new ConstraintManager({
        defaultPriority: "high",
        autoApply: false,
      });
      expect(manager.getAllConstraints()).toHaveLength(0);
    });

    it("should create using factory function", () => {
      const manager = createConstraintManager({ defaultPriority: "low" });
      expect(manager.getAllConstraints()).toHaveLength(0);
    });
  });

  describe("pin constraints", () => {
    it("should pin a node", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.pinNode("node1", { x: 100, y: 100 });

      expect(constraintId).toBeDefined();
      expect(manager.isNodePinned("node1")).toBe(true);

      const constraint = manager.getNodePinConstraint("node1");
      expect(constraint).toBeDefined();
      expect(constraint!.type).toBe("pin");
      expect(constraint!.position).toEqual({ x: 100, y: 100 });
    });

    it("should unpin a node", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 100, y: 100 });

      expect(manager.isNodePinned("node1")).toBe(true);

      const removed = manager.unpinNode("node1");

      expect(removed).toBe(true);
      expect(manager.isNodePinned("node1")).toBe(false);
    });

    it("should replace existing pin when pinning again", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 100, y: 100 });
      manager.pinNode("node1", { x: 200, y: 200 });

      const pins = manager.getConstraintsByType("pin");
      expect(pins).toHaveLength(1);
      expect(pins[0].position).toEqual({ x: 200, y: 200 });
    });

    it("should toggle pin state", () => {
      const manager = new ConstraintManager();

      // First toggle - pins
      const pinned = manager.togglePinNode("node1", { x: 100, y: 100 });
      expect(pinned).toBe(true);
      expect(manager.isNodePinned("node1")).toBe(true);

      // Second toggle - unpins
      const unpinned = manager.togglePinNode("node1", { x: 100, y: 100 });
      expect(unpinned).toBe(false);
      expect(manager.isNodePinned("node1")).toBe(false);
    });

    it("should respect pin strength", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 100, y: 100 }, 0.5);

      const constraint = manager.getNodePinConstraint("node1");
      expect(constraint!.strength).toBe(0.5);
    });

    it("should clamp pin strength to 0-1", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 100, y: 100 }, 1.5);

      const constraint = manager.getNodePinConstraint("node1");
      expect(constraint!.strength).toBe(1);
    });
  });

  describe("alignment constraints", () => {
    it("should align nodes horizontally", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.alignNodes(
        ["node1", "node2", "node3"],
        "horizontal"
      );

      expect(constraintId).toBeDefined();

      const constraints = manager.getConstraintsByType("alignment");
      expect(constraints).toHaveLength(1);
      expect(constraints[0].axis).toBe("horizontal");
      expect(constraints[0].nodeIds).toEqual(["node1", "node2", "node3"]);
    });

    it("should align nodes vertically", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.alignNodes(
        ["node1", "node2"],
        "vertical",
        { alignmentMethod: "first" }
      );

      const constraint = manager.getConstraint(constraintId) as AlignmentConstraint;
      expect(constraint.axis).toBe("vertical");
      expect(constraint.alignmentMethod).toBe("first");
    });

    it("should use reference position", () => {
      const manager = new ConstraintManager();
      manager.alignNodes(["node1", "node2"], "horizontal", {
        referencePosition: 100,
      });

      const constraints = manager.getConstraintsByType("alignment");
      expect(constraints[0].referencePosition).toBe(100);
    });
  });

  describe("group constraints", () => {
    it("should create a group", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.groupNodes(["node1", "node2", "node3"], {
        label: "My Group",
        color: "#ff0000",
      });

      expect(constraintId).toBeDefined();

      const constraint = manager.getConstraint(constraintId) as GroupConstraint;
      expect(constraint.type).toBe("group");
      expect(constraint.nodeIds).toEqual(["node1", "node2", "node3"]);
      expect(constraint.label).toBe("My Group");
      expect(constraint.color).toBe("#ff0000");
    });

    it("should use default group options", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.groupNodes(["node1", "node2"]);

      const constraint = manager.getConstraint(constraintId) as GroupConstraint;
      expect(constraint.padding).toBe(20);
      expect(constraint.minDistance).toBe(30);
    });

    it("should set group bounding box", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.groupNodes(["node1", "node2"], {
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      });

      const constraint = manager.getConstraint(constraintId) as GroupConstraint;
      expect(constraint.boundingBox).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });
  });

  describe("distance constraints", () => {
    it("should create distance constraint with min distance", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.constrainDistance("node1", "node2", {
        minDistance: 50,
      });

      const constraint = manager.getConstraint(constraintId);
      expect(constraint!.type).toBe("distance");
    });

    it("should create distance constraint with max distance", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.constrainDistance("node1", "node2", {
        maxDistance: 100,
      });

      expect(constraintId).toBeDefined();
    });

    it("should create distance constraint with exact distance", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.constrainDistance("node1", "node2", {
        exactDistance: 75,
      });

      expect(constraintId).toBeDefined();
    });
  });

  describe("region constraints", () => {
    it("should create region constraint", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.constrainToRegion("node1", {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      const constraint = manager.getConstraint(constraintId);
      expect(constraint!.type).toBe("region");
    });
  });

  describe("order constraints", () => {
    it("should create order constraint", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.orderNodes(
        ["node1", "node2", "node3"],
        "x",
        { minSpacing: 50 }
      );

      const constraint = manager.getConstraint(constraintId);
      expect(constraint!.type).toBe("order");
    });
  });

  describe("constraint CRUD", () => {
    it("should get all constraints", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 0, y: 0 });
      manager.alignNodes(["node2", "node3"], "horizontal");

      const all = manager.getAllConstraints();
      expect(all).toHaveLength(2);
    });

    it("should get constraints by type", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 0, y: 0 });
      manager.pinNode("node2", { x: 100, y: 100 });
      manager.alignNodes(["node3", "node4"], "horizontal");

      const pins = manager.getConstraintsByType("pin");
      expect(pins).toHaveLength(2);

      const alignments = manager.getConstraintsByType("alignment");
      expect(alignments).toHaveLength(1);
    });

    it("should get constraints for a node", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 0, y: 0 });
      manager.alignNodes(["node1", "node2"], "horizontal");
      manager.constrainDistance("node1", "node3", { minDistance: 50 });

      const node1Constraints = manager.getConstraintsForNode("node1");
      expect(node1Constraints).toHaveLength(3);

      const node3Constraints = manager.getConstraintsForNode("node3");
      expect(node3Constraints).toHaveLength(1);
    });

    it("should update a constraint", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.pinNode("node1", { x: 0, y: 0 });

      const updated = manager.updateConstraint(constraintId, { enabled: false });

      expect(updated).toBe(true);
      const constraint = manager.getConstraint(constraintId);
      expect(constraint!.enabled).toBe(false);
    });

    it("should remove a constraint", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.pinNode("node1", { x: 0, y: 0 });

      expect(manager.getAllConstraints()).toHaveLength(1);

      const removed = manager.removeConstraint(constraintId);

      expect(removed).toBe(true);
      expect(manager.getAllConstraints()).toHaveLength(0);
    });

    it("should clear all constraints", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 0, y: 0 });
      manager.pinNode("node2", { x: 100, y: 100 });
      manager.alignNodes(["node3", "node4"], "horizontal");

      expect(manager.getAllConstraints()).toHaveLength(3);

      manager.clearAllConstraints();

      expect(manager.getAllConstraints()).toHaveLength(0);
    });

    it("should enable/disable constraints", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.pinNode("node1", { x: 0, y: 0 });

      manager.setConstraintEnabled(constraintId, false);
      expect(manager.getConstraint(constraintId)!.enabled).toBe(false);

      manager.setConstraintEnabled(constraintId, true);
      expect(manager.getConstraint(constraintId)!.enabled).toBe(true);
    });

    it("should set constraint priority", () => {
      const manager = new ConstraintManager();
      const constraintId = manager.pinNode("node1", { x: 0, y: 0 });

      manager.setConstraintPriority(constraintId, "critical");
      expect(manager.getConstraint(constraintId)!.priority).toBe("critical");
    });
  });

  describe("constraint application", () => {
    it("should apply constraints to positions", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 100, y: 100 });

      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
      ]);

      const result = manager.applyConstraints(positions);

      expect(result.converged).toBe(true);
      expect(result.positions.get("node1")!.x).toBeCloseTo(100, 0);
      expect(result.positions.get("node1")!.y).toBeCloseTo(100, 0);
    });

    it("should check if constraints are satisfied", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 100, y: 100 });

      const unsatisfied = createPositions([
        { id: "node1", x: 0, y: 0 },
      ]);

      const satisfied = createPositions([
        { id: "node1", x: 100, y: 100 },
      ]);

      expect(manager.areConstraintsSatisfied(unsatisfied)).toBe(false);
      expect(manager.areConstraintsSatisfied(satisfied)).toBe(true);
    });
  });

  describe("events", () => {
    it("should emit constraintAdded event", () => {
      const manager = new ConstraintManager();
      const events: ConstraintEvent[] = [];

      manager.on("constraintAdded", (event) => events.push(event));

      manager.pinNode("node1", { x: 0, y: 0 });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("constraintAdded");
      expect(events[0].constraint).toBeDefined();
    });

    it("should emit constraintRemoved event", () => {
      const manager = new ConstraintManager();
      const events: ConstraintEvent[] = [];

      manager.on("constraintRemoved", (event) => events.push(event));

      const constraintId = manager.pinNode("node1", { x: 0, y: 0 });
      manager.removeConstraint(constraintId);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("constraintRemoved");
    });

    it("should emit constraintUpdated event", () => {
      const manager = new ConstraintManager();
      const events: ConstraintEvent[] = [];

      manager.on("constraintUpdated", (event) => events.push(event));

      const constraintId = manager.pinNode("node1", { x: 0, y: 0 });
      manager.updateConstraint(constraintId, { enabled: false });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("constraintUpdated");
    });

    it("should emit solver events", () => {
      const manager = new ConstraintManager();
      const events: ConstraintEvent[] = [];

      manager.on("solverStarted", (event) => events.push(event));
      manager.on("solverCompleted", (event) => events.push(event));
      manager.on("constraintsApplied", (event) => events.push(event));

      manager.pinNode("node1", { x: 100, y: 100 });

      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
      ]);

      manager.applyConstraints(positions);

      expect(events).toHaveLength(3);
      expect(events.map((e) => e.type)).toEqual([
        "solverStarted",
        "solverCompleted",
        "constraintsApplied",
      ]);
    });

    it("should remove event listeners", () => {
      const manager = new ConstraintManager();
      const events: ConstraintEvent[] = [];

      const listener = (event: ConstraintEvent) => events.push(event);
      manager.on("constraintAdded", listener);

      manager.pinNode("node1", { x: 0, y: 0 });
      expect(events).toHaveLength(1);

      manager.off("constraintAdded", listener);

      manager.pinNode("node2", { x: 100, y: 100 });
      expect(events).toHaveLength(1); // No new events
    });
  });

  describe("statistics", () => {
    it("should return constraint statistics", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 0, y: 0 });
      manager.pinNode("node2", { x: 100, y: 100 });
      manager.alignNodes(["node3", "node4"], "horizontal");

      const constraintId = manager.groupNodes(["node5", "node6"]);
      manager.setConstraintEnabled(constraintId, false);

      const stats = manager.getStats();

      expect(stats.total).toBe(4);
      expect(stats.byType.pin).toBe(2);
      expect(stats.byType.alignment).toBe(1);
      expect(stats.byType.group).toBe(1);
      expect(stats.enabled).toBe(3);
      expect(stats.disabled).toBe(1);
    });
  });

  describe("cleanup", () => {
    it("should clean up on destroy", () => {
      const manager = new ConstraintManager();
      manager.pinNode("node1", { x: 0, y: 0 });
      manager.alignNodes(["node2", "node3"], "horizontal");

      manager.destroy();

      expect(manager.getAllConstraints()).toHaveLength(0);
    });
  });
});
