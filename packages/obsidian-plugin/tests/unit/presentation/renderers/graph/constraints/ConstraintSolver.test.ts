/**
 * ConstraintSolver Tests
 *
 * Tests for the iterative projection constraint solver that handles
 * layout constraints for graph node positioning.
 */

import {
  ConstraintSolver,
  createConstraintSolver,
  DEFAULT_CONSTRAINT_SOLVER_CONFIG,
} from "../../../../../../src/presentation/renderers/graph/constraints/ConstraintSolver";
import type {
  Point,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  DistanceConstraint,
  RegionConstraint,
  OrderConstraint,
  LayoutConstraint,
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

/**
 * Create a basic pin constraint
 */
function createPinConstraint(
  nodeId: string,
  position: Point,
  strength: number = 1.0
): PinConstraint {
  return {
    id: `pin-${nodeId}`,
    type: "pin",
    enabled: true,
    priority: "high",
    nodeId,
    position,
    strength,
  };
}

/**
 * Create a basic alignment constraint
 */
function createAlignmentConstraint(
  nodeIds: string[],
  axis: "horizontal" | "vertical"
): AlignmentConstraint {
  return {
    id: `align-${axis}-${nodeIds.join("-")}`,
    type: "alignment",
    enabled: true,
    priority: "medium",
    axis,
    nodeIds,
    alignmentMethod: "average",
  };
}

/**
 * Create a basic distance constraint
 */
function createDistanceConstraint(
  node1: string,
  node2: string,
  options: { minDistance?: number; maxDistance?: number; exactDistance?: number }
): DistanceConstraint {
  return {
    id: `distance-${node1}-${node2}`,
    type: "distance",
    enabled: true,
    priority: "medium",
    node1,
    node2,
    ...options,
  };
}

/**
 * Create a basic region constraint
 */
function createRegionConstraint(
  nodeId: string,
  region: { x: number; y: number; width: number; height: number }
): RegionConstraint {
  return {
    id: `region-${nodeId}`,
    type: "region",
    enabled: true,
    priority: "medium",
    nodeId,
    region,
  };
}

/**
 * Create a basic order constraint
 */
function createOrderConstraint(
  nodeIds: string[],
  axis: "x" | "y",
  minSpacing?: number
): OrderConstraint {
  return {
    id: `order-${axis}-${nodeIds.join("-")}`,
    type: "order",
    enabled: true,
    priority: "medium",
    axis,
    nodeIds,
    minSpacing,
  };
}

/**
 * Create a basic group constraint
 */
function createGroupConstraint(
  nodeIds: string[],
  minDistance: number = 30
): GroupConstraint {
  return {
    id: `group-${nodeIds.join("-")}`,
    type: "group",
    enabled: true,
    priority: "medium",
    nodeIds,
    padding: 20,
    minDistance,
  };
}

// ============================================================
// Tests
// ============================================================

describe("ConstraintSolver", () => {
  describe("construction", () => {
    it("should create with default config", () => {
      const solver = new ConstraintSolver();
      const config = solver.getConfig();

      expect(config.maxIterations).toBe(DEFAULT_CONSTRAINT_SOLVER_CONFIG.maxIterations);
      expect(config.tolerance).toBe(DEFAULT_CONSTRAINT_SOLVER_CONFIG.tolerance);
      expect(config.relaxation).toBe(DEFAULT_CONSTRAINT_SOLVER_CONFIG.relaxation);
    });

    it("should create with custom config", () => {
      const solver = new ConstraintSolver({
        maxIterations: 100,
        tolerance: 0.01,
      });
      const config = solver.getConfig();

      expect(config.maxIterations).toBe(100);
      expect(config.tolerance).toBe(0.01);
    });

    it("should create using factory function", () => {
      const solver = createConstraintSolver({ maxIterations: 75 });
      expect(solver.getConfig().maxIterations).toBe(75);
    });
  });

  describe("solve with no constraints", () => {
    it("should return original positions when no constraints", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 100, y: 100 },
      ]);

      const result = solver.solve(positions, []);

      expect(result.converged).toBe(true);
      expect(result.iterations).toBe(0);
      expect(result.violations).toBe(0);
      expect(result.positions.get("node1")).toEqual({ x: 0, y: 0 });
      expect(result.positions.get("node2")).toEqual({ x: 100, y: 100 });
    });

    it("should handle empty positions", () => {
      const solver = new ConstraintSolver();
      const result = solver.solve(new Map(), []);

      expect(result.converged).toBe(true);
      expect(result.positions.size).toBe(0);
    });
  });

  describe("pin constraints", () => {
    it("should pin node at specified position", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 50, y: 50 },
      ]);

      const constraints: LayoutConstraint[] = [
        createPinConstraint("node1", { x: 100, y: 100 }),
      ];

      const result = solver.solve(positions, constraints);

      expect(result.converged).toBe(true);
      const finalPos = result.positions.get("node1")!;
      expect(finalPos.x).toBeCloseTo(100, 0);
      expect(finalPos.y).toBeCloseTo(100, 0);
    });

    it("should respect pin strength", () => {
      const solver = new ConstraintSolver({ maxIterations: 1 });
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
      ]);

      // Weak pin (strength 0.5)
      const constraints: LayoutConstraint[] = [
        createPinConstraint("node1", { x: 100, y: 100 }, 0.5),
      ];

      const result = solver.solve(positions, constraints);
      const finalPos = result.positions.get("node1")!;

      // Should move partially toward target
      expect(finalPos.x).toBeGreaterThan(0);
      expect(finalPos.x).toBeLessThan(100);
    });

    it("should handle disabled pin constraint", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 50, y: 50 },
      ]);

      const constraints: LayoutConstraint[] = [
        { ...createPinConstraint("node1", { x: 100, y: 100 }), enabled: false },
      ];

      const result = solver.solve(positions, constraints);

      // Position should not change
      expect(result.positions.get("node1")).toEqual({ x: 50, y: 50 });
    });
  });

  describe("alignment constraints", () => {
    it("should align nodes horizontally", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 50, y: 50 },
        { id: "node3", x: 100, y: 100 },
      ]);

      const constraints: LayoutConstraint[] = [
        createAlignmentConstraint(["node1", "node2", "node3"], "horizontal"),
      ];

      const result = solver.solve(positions, constraints);

      const y1 = result.positions.get("node1")!.y;
      const y2 = result.positions.get("node2")!.y;
      const y3 = result.positions.get("node3")!.y;

      // All Y values should be the same (or very close)
      expect(Math.abs(y1 - y2)).toBeLessThan(1);
      expect(Math.abs(y2 - y3)).toBeLessThan(1);
    });

    it("should align nodes vertically", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 50, y: 50 },
        { id: "node3", x: 100, y: 100 },
      ]);

      const constraints: LayoutConstraint[] = [
        createAlignmentConstraint(["node1", "node2", "node3"], "vertical"),
      ];

      const result = solver.solve(positions, constraints);

      const x1 = result.positions.get("node1")!.x;
      const x2 = result.positions.get("node2")!.x;
      const x3 = result.positions.get("node3")!.x;

      // All X values should be the same (or very close)
      expect(Math.abs(x1 - x2)).toBeLessThan(1);
      expect(Math.abs(x2 - x3)).toBeLessThan(1);
    });

    it("should use reference position when provided", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 50, y: 50 },
      ]);

      const constraint: AlignmentConstraint = {
        ...createAlignmentConstraint(["node1", "node2"], "horizontal"),
        referencePosition: 75,
      };

      const result = solver.solve(positions, [constraint]);

      const y1 = result.positions.get("node1")!.y;
      const y2 = result.positions.get("node2")!.y;

      expect(y1).toBeCloseTo(75, 0);
      expect(y2).toBeCloseTo(75, 0);
    });
  });

  describe("distance constraints", () => {
    it("should enforce minimum distance", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 10, y: 0 }, // Too close
      ]);

      const constraints: LayoutConstraint[] = [
        createDistanceConstraint("node1", "node2", { minDistance: 50 }),
      ];

      const result = solver.solve(positions, constraints);

      const p1 = result.positions.get("node1")!;
      const p2 = result.positions.get("node2")!;
      const distance = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
      );

      expect(distance).toBeGreaterThanOrEqual(49); // Allow small tolerance
    });

    it("should enforce maximum distance", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 200, y: 0 }, // Too far
      ]);

      const constraints: LayoutConstraint[] = [
        createDistanceConstraint("node1", "node2", { maxDistance: 100 }),
      ];

      const result = solver.solve(positions, constraints);

      const p1 = result.positions.get("node1")!;
      const p2 = result.positions.get("node2")!;
      const distance = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
      );

      expect(distance).toBeLessThanOrEqual(101); // Allow small tolerance
    });

    it("should enforce exact distance", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 30, y: 0 },
      ]);

      const constraints: LayoutConstraint[] = [
        createDistanceConstraint("node1", "node2", { exactDistance: 50 }),
      ];

      const result = solver.solve(positions, constraints);

      const p1 = result.positions.get("node1")!;
      const p2 = result.positions.get("node2")!;
      const distance = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
      );

      expect(distance).toBeCloseTo(50, 0);
    });

    it("should handle nodes at same position", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 0, y: 0 }, // Same position
      ]);

      const constraints: LayoutConstraint[] = [
        createDistanceConstraint("node1", "node2", { minDistance: 50 }),
      ];

      const result = solver.solve(positions, constraints);

      const p1 = result.positions.get("node1")!;
      const p2 = result.positions.get("node2")!;
      const distance = Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
      );

      // Should push apart
      expect(distance).toBeGreaterThan(0);
    });
  });

  describe("region constraints", () => {
    it("should keep node within region", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 150, y: 150 }, // Outside region
      ]);

      const constraints: LayoutConstraint[] = [
        createRegionConstraint("node1", { x: 0, y: 0, width: 100, height: 100 }),
      ];

      const result = solver.solve(positions, constraints);

      const pos = result.positions.get("node1")!;
      // Allow small tolerance for solver convergence
      expect(pos.x).toBeLessThanOrEqual(101);
      expect(pos.y).toBeLessThanOrEqual(101);
      expect(pos.x).toBeGreaterThanOrEqual(-1);
      expect(pos.y).toBeGreaterThanOrEqual(-1);
    });

    it("should not move node already in region", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 50, y: 50 }, // Inside region
      ]);

      const constraints: LayoutConstraint[] = [
        createRegionConstraint("node1", { x: 0, y: 0, width: 100, height: 100 }),
      ];

      const result = solver.solve(positions, constraints);

      const pos = result.positions.get("node1")!;
      expect(pos.x).toBeCloseTo(50, 0);
      expect(pos.y).toBeCloseTo(50, 0);
    });
  });

  describe("order constraints", () => {
    it("should maintain node order on x-axis", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 100, y: 0 },
        { id: "node2", x: 50, y: 0 }, // Wrong order
        { id: "node3", x: 150, y: 0 },
      ]);

      const constraints: LayoutConstraint[] = [
        createOrderConstraint(["node1", "node2", "node3"], "x"),
      ];

      const result = solver.solve(positions, constraints);

      const x1 = result.positions.get("node1")!.x;
      const x2 = result.positions.get("node2")!.x;
      const x3 = result.positions.get("node3")!.x;

      // Allow small tolerance for solver convergence (within 1 pixel)
      expect(x1).toBeLessThan(x2 + 1);
      expect(x2).toBeLessThan(x3 + 1);
    });

    it("should maintain node order on y-axis", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 100 },
        { id: "node2", x: 0, y: 50 }, // Wrong order
        { id: "node3", x: 0, y: 150 },
      ]);

      const constraints: LayoutConstraint[] = [
        createOrderConstraint(["node1", "node2", "node3"], "y"),
      ];

      const result = solver.solve(positions, constraints);

      const y1 = result.positions.get("node1")!.y;
      const y2 = result.positions.get("node2")!.y;
      const y3 = result.positions.get("node3")!.y;

      // Allow small tolerance for solver convergence (within 1 pixel)
      expect(y1).toBeLessThan(y2 + 1);
      expect(y2).toBeLessThan(y3 + 1);
    });

    it("should respect minimum spacing", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 10, y: 0 }, // Too close
        { id: "node3", x: 20, y: 0 },
      ]);

      const constraints: LayoutConstraint[] = [
        createOrderConstraint(["node1", "node2", "node3"], "x", 30),
      ];

      const result = solver.solve(positions, constraints);

      const x1 = result.positions.get("node1")!.x;
      const x2 = result.positions.get("node2")!.x;
      const x3 = result.positions.get("node3")!.x;

      expect(x2 - x1).toBeGreaterThanOrEqual(29); // Allow tolerance
      expect(x3 - x2).toBeGreaterThanOrEqual(29);
    });
  });

  describe("group constraints", () => {
    it("should enforce minimum distance between group members", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 5, y: 0 }, // Too close
        { id: "node3", x: 10, y: 0 },
      ]);

      const constraints: LayoutConstraint[] = [
        createGroupConstraint(["node1", "node2", "node3"], 30),
      ];

      const result = solver.solve(positions, constraints);

      // Check all pairs have minimum distance
      const p1 = result.positions.get("node1")!;
      const p2 = result.positions.get("node2")!;
      const p3 = result.positions.get("node3")!;

      const dist12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      const dist23 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));
      const dist13 = Math.sqrt(Math.pow(p3.x - p1.x, 2) + Math.pow(p3.y - p1.y, 2));

      expect(dist12).toBeGreaterThanOrEqual(28); // Allow tolerance
      expect(dist23).toBeGreaterThanOrEqual(28);
      expect(dist13).toBeGreaterThanOrEqual(28);
    });

    it("should constrain group to bounding box", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 150, y: 150 }, // Outside box
        { id: "node2", x: 200, y: 200 },
      ]);

      const constraint: GroupConstraint = {
        ...createGroupConstraint(["node1", "node2"], 10),
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      };

      const result = solver.solve(positions, [constraint]);

      const p1 = result.positions.get("node1")!;
      const p2 = result.positions.get("node2")!;

      // Both should be inside (with padding) - allow small tolerance
      expect(p1.x).toBeLessThanOrEqual(81); // 100 - padding + tolerance
      expect(p1.y).toBeLessThanOrEqual(81);
      expect(p2.x).toBeLessThanOrEqual(81);
      expect(p2.y).toBeLessThanOrEqual(81);
    });
  });

  describe("constraint priorities", () => {
    it("should respect constraint priorities", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 50, y: 50 },
      ]);

      // Two conflicting constraints with different priorities
      const constraints: LayoutConstraint[] = [
        { ...createPinConstraint("node1", { x: 0, y: 0 }), priority: "low" },
        { ...createPinConstraint("node1", { x: 100, y: 100 }), priority: "critical" },
      ];

      const result = solver.solve(positions, constraints);

      const pos = result.positions.get("node1")!;
      // Should be closer to critical priority target
      expect(pos.x).toBeGreaterThan(50);
      expect(pos.y).toBeGreaterThan(50);
    });
  });

  describe("convergence", () => {
    it("should converge for satisfiable constraints", () => {
      const solver = new ConstraintSolver();
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 100, y: 0 },
      ]);

      const constraints: LayoutConstraint[] = [
        createPinConstraint("node1", { x: 0, y: 0 }),
        createDistanceConstraint("node1", "node2", { exactDistance: 100 }),
      ];

      const result = solver.solve(positions, constraints);

      expect(result.converged).toBe(true);
      expect(result.violations).toBe(0);
    });

    it("should complete within iteration limit", () => {
      const solver = new ConstraintSolver({ maxIterations: 10 });
      const positions = createPositions([
        { id: "node1", x: 0, y: 0 },
        { id: "node2", x: 1000, y: 1000 },
      ]);

      const constraints: LayoutConstraint[] = [
        createDistanceConstraint("node1", "node2", { exactDistance: 1 }),
      ];

      const result = solver.solve(positions, constraints);

      expect(result.iterations).toBeLessThanOrEqual(10);
    });
  });

  describe("configuration", () => {
    it("should allow config updates", () => {
      const solver = new ConstraintSolver();

      solver.setConfig({ maxIterations: 200, tolerance: 0.001 });

      const config = solver.getConfig();
      expect(config.maxIterations).toBe(200);
      expect(config.tolerance).toBe(0.001);
    });
  });
});
