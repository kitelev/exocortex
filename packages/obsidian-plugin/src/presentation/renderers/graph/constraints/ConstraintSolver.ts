/**
 * ConstraintSolver - Iterative projection constraint solver
 *
 * Solves layout constraints using iterative projection methods.
 * Handles constraint conflicts through priority-based resolution
 * and converges to a stable solution within iteration limits.
 *
 * @module presentation/renderers/graph/constraints
 * @since 1.0.0
 */

import type {
  Point,
  BoundingBox,
  LayoutConstraint,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  DistanceConstraint,
  RegionConstraint,
  OrderConstraint,
  ConstraintSolverConfig,
  ConstraintSolverResult,
  ConstraintPriority,
} from "./constraint.types";

// ============================================================
// Default Configuration
// ============================================================

/**
 * Default constraint solver configuration
 */
export const DEFAULT_CONSTRAINT_SOLVER_CONFIG: ConstraintSolverConfig = {
  maxIterations: 50,
  tolerance: 0.1,
  relaxation: 0.9,
  softConstraints: false,
  priorityWeights: {
    critical: 1.0,
    high: 0.9,
    medium: 0.7,
    low: 0.5,
  },
};

// ============================================================
// ConstraintSolver Class
// ============================================================

/**
 * Iterative projection constraint solver
 *
 * Solves layout constraints by iteratively projecting node positions
 * to satisfy each constraint. Uses relaxation to prevent oscillation
 * and priority weights to resolve conflicts.
 *
 * @example
 * ```typescript
 * const solver = new ConstraintSolver({
 *   maxIterations: 100,
 *   tolerance: 0.01,
 * });
 *
 * const constraints = [
 *   { type: 'pin', nodeId: 'node1', position: { x: 0, y: 0 }, ... },
 *   { type: 'distance', node1: 'node1', node2: 'node2', minDistance: 50, ... },
 * ];
 *
 * const result = solver.solve(positions, constraints);
 * console.log(`Converged: ${result.converged} in ${result.iterations} iterations`);
 * ```
 */
export class ConstraintSolver {
  private config: ConstraintSolverConfig;

  constructor(config: Partial<ConstraintSolverConfig> = {}) {
    this.config = { ...DEFAULT_CONSTRAINT_SOLVER_CONFIG, ...config };
  }

  /**
   * Solve constraints for the given positions
   */
  solve(
    positions: Map<string, Point>,
    constraints: LayoutConstraint[]
  ): ConstraintSolverResult {
    // Filter enabled constraints and sort by priority
    const activeConstraints = constraints
      .filter((c) => c.enabled)
      .sort((a, b) => this.comparePriority(a.priority, b.priority));

    if (activeConstraints.length === 0) {
      return {
        positions: new Map(positions),
        converged: true,
        iterations: 0,
        maxDisplacement: 0,
        violations: 0,
      };
    }

    // Create working copy of positions
    const workingPositions = new Map(positions);

    let maxDisplacement = Infinity;
    let iterations = 0;

    // Iterative projection loop
    while (iterations < this.config.maxIterations && maxDisplacement > this.config.tolerance) {
      maxDisplacement = 0;

      for (const constraint of activeConstraints) {
        const displacement = this.projectConstraint(constraint, workingPositions);
        maxDisplacement = Math.max(maxDisplacement, displacement);
      }

      iterations++;
    }

    // Count remaining violations
    const violations = this.countViolations(workingPositions, activeConstraints);

    return {
      positions: workingPositions,
      converged: maxDisplacement <= this.config.tolerance,
      iterations,
      maxDisplacement,
      violations,
    };
  }

  /**
   * Check if constraints are satisfied for given positions (without solving)
   */
  checkViolations(
    positions: Map<string, Point>,
    constraints: LayoutConstraint[]
  ): number {
    const activeConstraints = constraints.filter((c) => c.enabled);
    return this.countViolations(positions, activeConstraints);
  }

  /**
   * Project a single constraint onto positions
   */
  private projectConstraint(
    constraint: LayoutConstraint,
    positions: Map<string, Point>
  ): number {
    const weight = this.config.priorityWeights[constraint.priority];
    const relaxation = this.config.relaxation * weight;

    switch (constraint.type) {
      case "pin":
        return this.projectPinConstraint(constraint, positions, relaxation);
      case "alignment":
        return this.projectAlignmentConstraint(constraint, positions, relaxation);
      case "group":
        return this.projectGroupConstraint(constraint, positions, relaxation);
      case "distance":
        return this.projectDistanceConstraint(constraint, positions, relaxation);
      case "region":
        return this.projectRegionConstraint(constraint, positions, relaxation);
      case "order":
        return this.projectOrderConstraint(constraint, positions, relaxation);
      default:
        return 0;
    }
  }

  /**
   * Project pin constraint - move node towards pinned position
   */
  private projectPinConstraint(
    constraint: PinConstraint,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    const current = positions.get(constraint.nodeId);
    if (!current) return 0;

    const target = constraint.position;
    const strength = constraint.strength;

    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const displacement = Math.sqrt(dx * dx + dy * dy);

    if (displacement < this.config.tolerance) return 0;

    const factor = relaxation * strength;
    positions.set(constraint.nodeId, {
      x: current.x + dx * factor,
      y: current.y + dy * factor,
    });

    return displacement * factor;
  }

  /**
   * Project alignment constraint - align nodes along an axis
   */
  private projectAlignmentConstraint(
    constraint: AlignmentConstraint,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    const nodePositions = constraint.nodeIds
      .map((id) => ({ id, pos: positions.get(id) }))
      .filter((n): n is { id: string; pos: Point } => n.pos !== undefined);

    if (nodePositions.length === 0) return 0;

    // Calculate target alignment position
    let targetPos: number;
    if (constraint.referencePosition !== undefined) {
      targetPos = constraint.referencePosition;
    } else {
      targetPos = this.calculateAlignmentTarget(
        nodePositions.map((n) => n.pos),
        constraint.axis,
        constraint.alignmentMethod
      );
    }

    let maxDisplacement = 0;

    for (const { id, pos } of nodePositions) {
      const currentValue = constraint.axis === "horizontal" ? pos.y : pos.x;
      const delta = targetPos - currentValue;
      const displacement = Math.abs(delta);

      if (displacement < this.config.tolerance) continue;

      const factor = relaxation;
      if (constraint.axis === "horizontal") {
        positions.set(id, { x: pos.x, y: pos.y + delta * factor });
      } else {
        positions.set(id, { x: pos.x + delta * factor, y: pos.y });
      }

      maxDisplacement = Math.max(maxDisplacement, displacement * factor);
    }

    return maxDisplacement;
  }

  /**
   * Calculate alignment target position based on method
   */
  private calculateAlignmentTarget(
    positions: Point[],
    axis: "horizontal" | "vertical",
    method: "average" | "first" | "last" | "min" | "max"
  ): number {
    const values = positions.map((p) => (axis === "horizontal" ? p.y : p.x));

    switch (method) {
      case "first":
        return values[0];
      case "last":
        return values[values.length - 1];
      case "min":
        return Math.min(...values);
      case "max":
        return Math.max(...values);
      case "average":
      default:
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }
  }

  /**
   * Project group constraint - keep nodes together with minimum distance
   */
  private projectGroupConstraint(
    constraint: GroupConstraint,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    let maxDisplacement = 0;

    // First, constrain to bounding box if specified
    if (constraint.boundingBox) {
      for (const nodeId of constraint.nodeIds) {
        const pos = positions.get(nodeId);
        if (!pos) continue;

        const displacement = this.constrainToBoundingBox(
          nodeId,
          positions,
          constraint.boundingBox,
          constraint.padding,
          relaxation
        );
        maxDisplacement = Math.max(maxDisplacement, displacement);
      }
    }

    // Then, enforce minimum distance between nodes
    const nodeCount = constraint.nodeIds.length;
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const pos1 = positions.get(constraint.nodeIds[i]);
        const pos2 = positions.get(constraint.nodeIds[j]);
        if (!pos1 || !pos2) continue;

        const displacement = this.enforceMinDistance(
          constraint.nodeIds[i],
          constraint.nodeIds[j],
          constraint.minDistance,
          positions,
          relaxation
        );
        maxDisplacement = Math.max(maxDisplacement, displacement);
      }
    }

    // Enforce maximum distance if specified
    if (constraint.maxDistance !== undefined) {
      for (let i = 0; i < nodeCount; i++) {
        for (let j = i + 1; j < nodeCount; j++) {
          const displacement = this.enforceMaxDistance(
            constraint.nodeIds[i],
            constraint.nodeIds[j],
            constraint.maxDistance,
            positions,
            relaxation
          );
          maxDisplacement = Math.max(maxDisplacement, displacement);
        }
      }
    }

    return maxDisplacement;
  }

  /**
   * Project distance constraint - enforce distance between two nodes
   */
  private projectDistanceConstraint(
    constraint: DistanceConstraint,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    const p1 = positions.get(constraint.node1);
    const p2 = positions.get(constraint.node2);
    if (!p1 || !p2) return 0;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const currentDist = Math.sqrt(dx * dx + dy * dy);

    let targetDist = currentDist;

    if (constraint.exactDistance !== undefined) {
      targetDist = constraint.exactDistance;
    } else if (constraint.minDistance !== undefined && currentDist < constraint.minDistance) {
      targetDist = constraint.minDistance;
    } else if (constraint.maxDistance !== undefined && currentDist > constraint.maxDistance) {
      targetDist = constraint.maxDistance;
    } else {
      return 0; // Constraint satisfied
    }

    if (currentDist < 0.001) {
      // Nodes are at the same position, push apart in arbitrary direction
      const angle = Math.random() * 2 * Math.PI;
      const halfTarget = (targetDist / 2) * relaxation;
      positions.set(constraint.node1, {
        x: p1.x - Math.cos(angle) * halfTarget,
        y: p1.y - Math.sin(angle) * halfTarget,
      });
      positions.set(constraint.node2, {
        x: p2.x + Math.cos(angle) * halfTarget,
        y: p2.y + Math.sin(angle) * halfTarget,
      });
      return targetDist * relaxation;
    }

    const diff = targetDist - currentDist;
    const correction = (diff / 2) * relaxation;

    const nx = dx / currentDist;
    const ny = dy / currentDist;

    positions.set(constraint.node1, {
      x: p1.x - nx * correction,
      y: p1.y - ny * correction,
    });
    positions.set(constraint.node2, {
      x: p2.x + nx * correction,
      y: p2.y + ny * correction,
    });

    return Math.abs(diff) * relaxation;
  }

  /**
   * Project region constraint - keep node within bounding box
   */
  private projectRegionConstraint(
    constraint: RegionConstraint,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    return this.constrainToBoundingBox(
      constraint.nodeId,
      positions,
      constraint.region,
      0,
      relaxation
    );
  }

  /**
   * Project order constraint - maintain node ordering along axis
   */
  private projectOrderConstraint(
    constraint: OrderConstraint,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    let maxDisplacement = 0;
    const minSpacing = constraint.minSpacing ?? 0;

    for (let i = 0; i < constraint.nodeIds.length - 1; i++) {
      const id1 = constraint.nodeIds[i];
      const id2 = constraint.nodeIds[i + 1];
      const p1 = positions.get(id1);
      const p2 = positions.get(id2);

      if (!p1 || !p2) continue;

      const v1 = constraint.axis === "x" ? p1.x : p1.y;
      const v2 = constraint.axis === "x" ? p2.x : p2.y;

      // v2 should be >= v1 + minSpacing
      const requiredV2 = v1 + minSpacing;
      if (v2 < requiredV2) {
        const diff = requiredV2 - v2;
        const correction = (diff / 2) * relaxation;

        if (constraint.axis === "x") {
          positions.set(id1, { x: p1.x - correction, y: p1.y });
          positions.set(id2, { x: p2.x + correction, y: p2.y });
        } else {
          positions.set(id1, { x: p1.x, y: p1.y - correction });
          positions.set(id2, { x: p2.x, y: p2.y + correction });
        }

        maxDisplacement = Math.max(maxDisplacement, diff * relaxation);
      }
    }

    return maxDisplacement;
  }

  /**
   * Helper: Constrain a node to a bounding box
   */
  private constrainToBoundingBox(
    nodeId: string,
    positions: Map<string, Point>,
    box: BoundingBox,
    padding: number,
    relaxation: number
  ): number {
    const pos = positions.get(nodeId);
    if (!pos) return 0;

    const minX = box.x + padding;
    const maxX = box.x + box.width - padding;
    const minY = box.y + padding;
    const maxY = box.y + box.height - padding;

    let newX = pos.x;
    let newY = pos.y;
    let displacement = 0;

    if (pos.x < minX) {
      const diff = minX - pos.x;
      newX = pos.x + diff * relaxation;
      displacement = Math.max(displacement, diff * relaxation);
    } else if (pos.x > maxX) {
      const diff = pos.x - maxX;
      newX = pos.x - diff * relaxation;
      displacement = Math.max(displacement, diff * relaxation);
    }

    if (pos.y < minY) {
      const diff = minY - pos.y;
      newY = pos.y + diff * relaxation;
      displacement = Math.max(displacement, diff * relaxation);
    } else if (pos.y > maxY) {
      const diff = pos.y - maxY;
      newY = pos.y - diff * relaxation;
      displacement = Math.max(displacement, diff * relaxation);
    }

    if (displacement > 0) {
      positions.set(nodeId, { x: newX, y: newY });
    }

    return displacement;
  }

  /**
   * Helper: Enforce minimum distance between two nodes
   */
  private enforceMinDistance(
    id1: string,
    id2: string,
    minDistance: number,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    const p1 = positions.get(id1);
    const p2 = positions.get(id2);
    if (!p1 || !p2) return 0;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= minDistance) return 0;

    if (dist < 0.001) {
      // Same position, push apart in arbitrary direction
      const angle = Math.random() * 2 * Math.PI;
      const halfMin = (minDistance / 2) * relaxation;
      positions.set(id1, {
        x: p1.x - Math.cos(angle) * halfMin,
        y: p1.y - Math.sin(angle) * halfMin,
      });
      positions.set(id2, {
        x: p2.x + Math.cos(angle) * halfMin,
        y: p2.y + Math.sin(angle) * halfMin,
      });
      return minDistance * relaxation;
    }

    const diff = minDistance - dist;
    const correction = (diff / 2) * relaxation;
    const nx = dx / dist;
    const ny = dy / dist;

    positions.set(id1, {
      x: p1.x - nx * correction,
      y: p1.y - ny * correction,
    });
    positions.set(id2, {
      x: p2.x + nx * correction,
      y: p2.y + ny * correction,
    });

    return diff * relaxation;
  }

  /**
   * Helper: Enforce maximum distance between two nodes
   */
  private enforceMaxDistance(
    id1: string,
    id2: string,
    maxDistance: number,
    positions: Map<string, Point>,
    relaxation: number
  ): number {
    const p1 = positions.get(id1);
    const p2 = positions.get(id2);
    if (!p1 || !p2) return 0;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= maxDistance) return 0;

    const diff = dist - maxDistance;
    const correction = (diff / 2) * relaxation;
    const nx = dx / dist;
    const ny = dy / dist;

    positions.set(id1, {
      x: p1.x + nx * correction,
      y: p1.y + ny * correction,
    });
    positions.set(id2, {
      x: p2.x - nx * correction,
      y: p2.y - ny * correction,
    });

    return diff * relaxation;
  }

  /**
   * Compare constraint priorities for sorting
   */
  private comparePriority(a: ConstraintPriority, b: ConstraintPriority): number {
    const order: Record<ConstraintPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return order[a] - order[b];
  }

  /**
   * Count constraint violations
   */
  private countViolations(
    positions: Map<string, Point>,
    constraints: LayoutConstraint[]
  ): number {
    let violations = 0;

    for (const constraint of constraints) {
      if (this.isViolated(constraint, positions)) {
        violations++;
      }
    }

    return violations;
  }

  /**
   * Check if a constraint is violated
   */
  private isViolated(constraint: LayoutConstraint, positions: Map<string, Point>): boolean {
    const tolerance = this.config.tolerance * 2; // Slightly larger tolerance for violation check

    switch (constraint.type) {
      case "pin": {
        const pos = positions.get(constraint.nodeId);
        if (!pos) return false;
        const dx = pos.x - constraint.position.x;
        const dy = pos.y - constraint.position.y;
        return Math.sqrt(dx * dx + dy * dy) > tolerance;
      }
      case "alignment": {
        const nodePositions = constraint.nodeIds
          .map((id) => positions.get(id))
          .filter((p): p is Point => p !== undefined);
        if (nodePositions.length < 2) return false;
        const values = nodePositions.map((p) =>
          constraint.axis === "horizontal" ? p.y : p.x
        );
        const max = Math.max(...values);
        const min = Math.min(...values);
        return max - min > tolerance;
      }
      case "distance": {
        const p1 = positions.get(constraint.node1);
        const p2 = positions.get(constraint.node2);
        if (!p1 || !p2) return false;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (constraint.exactDistance !== undefined) {
          return Math.abs(dist - constraint.exactDistance) > tolerance;
        }
        if (constraint.minDistance !== undefined && dist < constraint.minDistance - tolerance) {
          return true;
        }
        if (constraint.maxDistance !== undefined && dist > constraint.maxDistance + tolerance) {
          return true;
        }
        return false;
      }
      case "region": {
        const pos = positions.get(constraint.nodeId);
        if (!pos) return false;
        const { x, y, width, height } = constraint.region;
        return pos.x < x - tolerance ||
               pos.x > x + width + tolerance ||
               pos.y < y - tolerance ||
               pos.y > y + height + tolerance;
      }
      case "order": {
        for (let i = 0; i < constraint.nodeIds.length - 1; i++) {
          const p1 = positions.get(constraint.nodeIds[i]);
          const p2 = positions.get(constraint.nodeIds[i + 1]);
          if (!p1 || !p2) continue;
          const v1 = constraint.axis === "x" ? p1.x : p1.y;
          const v2 = constraint.axis === "x" ? p2.x : p2.y;
          if (v2 < v1 - tolerance) return true;
        }
        return false;
      }
      case "group":
        // Group constraints are compound - check min distance
        for (let i = 0; i < constraint.nodeIds.length; i++) {
          for (let j = i + 1; j < constraint.nodeIds.length; j++) {
            const p1 = positions.get(constraint.nodeIds[i]);
            const p2 = positions.get(constraint.nodeIds[j]);
            if (!p1 || !p2) continue;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < constraint.minDistance - tolerance) return true;
          }
        }
        return false;
      default:
        return false;
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ConstraintSolverConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ConstraintSolverConfig> {
    return { ...this.config };
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a constraint solver instance
 */
export function createConstraintSolver(
  config?: Partial<ConstraintSolverConfig>
): ConstraintSolver {
  return new ConstraintSolver(config);
}
