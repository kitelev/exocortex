/**
 * ConstraintManager - Layout constraint management system
 *
 * Manages layout constraints for user-controlled node positioning,
 * including pinned nodes, alignment guides, grouping, and spatial
 * constraints that persist across layout recalculations.
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
  GroupOptions,
  AlignmentOptions,
  DistanceOptions,
  OrderOptions,
  ConstraintPriority,
  ConstraintEventType,
  ConstraintEvent,
  ConstraintEventListener,
  ConstraintStore,
} from "./constraint.types";
import {
  ConstraintSolver,
  DEFAULT_CONSTRAINT_SOLVER_CONFIG,
} from "./ConstraintSolver";
import type { ConstraintSolverConfig, ConstraintSolverResult } from "./constraint.types";

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for ConstraintManager
 */
export interface ConstraintManagerConfig {
  /** Constraint solver configuration */
  solverConfig: Partial<ConstraintSolverConfig>;

  /** Whether to auto-apply constraints after changes */
  autoApply: boolean;

  /** Default priority for new constraints */
  defaultPriority: ConstraintPriority;

  /** Optional constraint store for persistence */
  constraintStore?: ConstraintStore;

  /** Graph ID for persistence */
  graphId?: string;
}

/**
 * Default constraint manager configuration
 */
export const DEFAULT_CONSTRAINT_MANAGER_CONFIG: ConstraintManagerConfig = {
  solverConfig: DEFAULT_CONSTRAINT_SOLVER_CONFIG,
  autoApply: true,
  defaultPriority: "medium",
};

// ============================================================
// ConstraintManager Class
// ============================================================

/**
 * Layout constraint management system
 *
 * Provides methods to add, remove, and manage layout constraints
 * that control node positioning in the graph. Supports pinning,
 * alignment, grouping, distance, region, and order constraints.
 *
 * @example
 * ```typescript
 * const manager = new ConstraintManager();
 *
 * // Pin a node at a specific position
 * manager.pinNode('node1', { x: 100, y: 100 });
 *
 * // Align nodes horizontally
 * manager.alignNodes(['node1', 'node2', 'node3'], 'horizontal');
 *
 * // Create a group
 * manager.groupNodes(['node4', 'node5', 'node6'], { label: 'My Group' });
 *
 * // Apply constraints to positions
 * const result = manager.applyConstraints(positions);
 * ```
 */
export class ConstraintManager {
  private config: ConstraintManagerConfig;
  private constraints: Map<string, LayoutConstraint> = new Map();
  private solver: ConstraintSolver;
  private eventListeners: Map<ConstraintEventType, Set<ConstraintEventListener>> = new Map();
  private pinnedNodes: Map<string, string> = new Map(); // nodeId -> constraintId

  constructor(config: Partial<ConstraintManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONSTRAINT_MANAGER_CONFIG, ...config };
    this.solver = new ConstraintSolver(this.config.solverConfig);

    // Initialize event listener maps
    const eventTypes: ConstraintEventType[] = [
      "constraintAdded",
      "constraintRemoved",
      "constraintUpdated",
      "constraintsApplied",
      "solverStarted",
      "solverCompleted",
    ];
    for (const type of eventTypes) {
      this.eventListeners.set(type, new Set());
    }
  }

  // ============================================================
  // Constraint CRUD Operations
  // ============================================================

  /**
   * Add a constraint
   */
  addConstraint(constraint: LayoutConstraint): string {
    this.constraints.set(constraint.id, constraint);

    // Track pinned nodes for quick lookup
    if (constraint.type === "pin") {
      this.pinnedNodes.set(constraint.nodeId, constraint.id);
    }

    this.emit("constraintAdded", { type: "constraintAdded", constraint });

    return constraint.id;
  }

  /**
   * Remove a constraint by ID
   */
  removeConstraint(constraintId: string): boolean {
    const constraint = this.constraints.get(constraintId);
    if (!constraint) return false;

    // Remove from pinned nodes tracking
    if (constraint.type === "pin") {
      this.pinnedNodes.delete(constraint.nodeId);
    }

    this.constraints.delete(constraintId);

    this.emit("constraintRemoved", {
      type: "constraintRemoved",
      constraintId,
      constraint,
    });

    return true;
  }

  /**
   * Update a constraint
   */
  updateConstraint(constraintId: string, updates: Partial<LayoutConstraint>): boolean {
    const constraint = this.constraints.get(constraintId);
    if (!constraint) return false;

    const updated = { ...constraint, ...updates } as LayoutConstraint;
    this.constraints.set(constraintId, updated);

    this.emit("constraintUpdated", { type: "constraintUpdated", constraint: updated });

    return true;
  }

  /**
   * Get a constraint by ID
   */
  getConstraint(constraintId: string): LayoutConstraint | undefined {
    return this.constraints.get(constraintId);
  }

  /**
   * Get all constraints
   */
  getAllConstraints(): LayoutConstraint[] {
    return Array.from(this.constraints.values());
  }

  /**
   * Get constraints by type
   */
  getConstraintsByType<T extends LayoutConstraint["type"]>(
    type: T
  ): Extract<LayoutConstraint, { type: T }>[] {
    return this.getAllConstraints().filter(
      (c): c is Extract<LayoutConstraint, { type: T }> => c.type === type
    );
  }

  /**
   * Get constraints affecting a specific node
   */
  getConstraintsForNode(nodeId: string): LayoutConstraint[] {
    return this.getAllConstraints().filter((c) => {
      switch (c.type) {
        case "pin":
        case "region":
          return c.nodeId === nodeId;
        case "alignment":
        case "group":
        case "order":
          return c.nodeIds.includes(nodeId);
        case "distance":
          return c.node1 === nodeId || c.node2 === nodeId;
        default:
          return false;
      }
    });
  }

  /**
   * Clear all constraints
   */
  clearAllConstraints(): void {
    const ids = Array.from(this.constraints.keys());
    for (const id of ids) {
      this.removeConstraint(id);
    }
  }

  // ============================================================
  // High-Level Constraint Creation
  // ============================================================

  /**
   * Pin a node at a specific position
   */
  pinNode(nodeId: string, position: Point, strength: number = 1.0): string {
    // Remove existing pin if any
    this.unpinNode(nodeId);

    const constraint: PinConstraint = {
      id: this.generateId(),
      type: "pin",
      enabled: true,
      priority: this.config.defaultPriority,
      nodeId,
      position: { ...position },
      strength: Math.max(0, Math.min(1, strength)),
    };

    return this.addConstraint(constraint);
  }

  /**
   * Unpin a node
   */
  unpinNode(nodeId: string): boolean {
    const constraintId = this.pinnedNodes.get(nodeId);
    if (constraintId) {
      return this.removeConstraint(constraintId);
    }
    return false;
  }

  /**
   * Check if a node is pinned
   */
  isNodePinned(nodeId: string): boolean {
    return this.pinnedNodes.has(nodeId);
  }

  /**
   * Get pin constraint for a node
   */
  getNodePinConstraint(nodeId: string): PinConstraint | undefined {
    const constraintId = this.pinnedNodes.get(nodeId);
    if (constraintId) {
      return this.constraints.get(constraintId) as PinConstraint;
    }
    return undefined;
  }

  /**
   * Toggle pin state for a node
   */
  togglePinNode(nodeId: string, position: Point): boolean {
    if (this.isNodePinned(nodeId)) {
      this.unpinNode(nodeId);
      return false;
    } else {
      this.pinNode(nodeId, position);
      return true;
    }
  }

  /**
   * Align nodes along an axis
   */
  alignNodes(
    nodeIds: string[],
    axis: "horizontal" | "vertical",
    options: AlignmentOptions = {}
  ): string {
    const constraint: AlignmentConstraint = {
      id: this.generateId(),
      type: "alignment",
      enabled: true,
      priority: this.config.defaultPriority,
      axis,
      nodeIds: [...nodeIds],
      referencePosition: options.referencePosition,
      alignmentMethod: options.alignmentMethod ?? "average",
    };

    return this.addConstraint(constraint);
  }

  /**
   * Group nodes together
   */
  groupNodes(nodeIds: string[], options: GroupOptions = {}): string {
    const constraint: GroupConstraint = {
      id: this.generateId(),
      type: "group",
      enabled: true,
      priority: this.config.defaultPriority,
      nodeIds: [...nodeIds],
      padding: options.padding ?? 20,
      minDistance: options.minDistance ?? 30,
      maxDistance: options.maxDistance,
      boundingBox: options.boundingBox ? { ...options.boundingBox } : undefined,
      label: options.label,
      color: options.color,
    };

    return this.addConstraint(constraint);
  }

  /**
   * Add distance constraint between two nodes
   */
  constrainDistance(
    node1: string,
    node2: string,
    options: DistanceOptions
  ): string {
    const constraint: DistanceConstraint = {
      id: this.generateId(),
      type: "distance",
      enabled: true,
      priority: this.config.defaultPriority,
      node1,
      node2,
      minDistance: options.minDistance,
      maxDistance: options.maxDistance,
      exactDistance: options.exactDistance,
    };

    return this.addConstraint(constraint);
  }

  /**
   * Constrain a node to a region
   */
  constrainToRegion(nodeId: string, region: BoundingBox): string {
    const constraint: RegionConstraint = {
      id: this.generateId(),
      type: "region",
      enabled: true,
      priority: this.config.defaultPriority,
      nodeId,
      region: { ...region },
    };

    return this.addConstraint(constraint);
  }

  /**
   * Order nodes along an axis
   */
  orderNodes(
    nodeIds: string[],
    axis: "x" | "y",
    options: OrderOptions = {}
  ): string {
    const constraint: OrderConstraint = {
      id: this.generateId(),
      type: "order",
      enabled: true,
      priority: this.config.defaultPriority,
      axis,
      nodeIds: [...nodeIds],
      minSpacing: options.minSpacing,
    };

    return this.addConstraint(constraint);
  }

  // ============================================================
  // Constraint Application
  // ============================================================

  /**
   * Apply constraints to positions
   */
  applyConstraints(positions: Map<string, Point>): ConstraintSolverResult {
    this.emit("solverStarted", { type: "solverStarted" });

    const constraints = this.getAllConstraints();
    const result = this.solver.solve(positions, constraints);

    this.emit("solverCompleted", { type: "solverCompleted", solverResult: result });
    this.emit("constraintsApplied", {
      type: "constraintsApplied",
      positions: result.positions,
      solverResult: result,
    });

    return result;
  }

  /**
   * Check if constraints are satisfied for given positions
   */
  areConstraintsSatisfied(positions: Map<string, Point>): boolean {
    const violations = this.solver.checkViolations(positions, this.getAllConstraints());
    return violations === 0;
  }

  // ============================================================
  // Persistence
  // ============================================================

  /**
   * Save constraints to store
   */
  async saveConstraints(): Promise<void> {
    if (!this.config.constraintStore || !this.config.graphId) {
      return;
    }

    await this.config.constraintStore.save(
      this.config.graphId,
      this.getAllConstraints()
    );
  }

  /**
   * Load constraints from store
   */
  async loadConstraints(): Promise<void> {
    if (!this.config.constraintStore || !this.config.graphId) {
      return;
    }

    const constraints = await this.config.constraintStore.load(this.config.graphId);

    // Clear existing and add loaded
    this.clearAllConstraints();
    for (const constraint of constraints) {
      this.addConstraint(constraint);
    }
  }

  // ============================================================
  // Events
  // ============================================================

  /**
   * Add event listener
   */
  on(eventType: ConstraintEventType, listener: ConstraintEventListener): void {
    this.eventListeners.get(eventType)?.add(listener);
  }

  /**
   * Remove event listener
   */
  off(eventType: ConstraintEventType, listener: ConstraintEventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /**
   * Emit event
   */
  private emit(eventType: ConstraintEventType, event: ConstraintEvent): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in ConstraintManager event listener:`, error);
        }
      }
    }
  }

  // ============================================================
  // Configuration
  // ============================================================

  /**
   * Update solver configuration
   */
  setSolverConfig(config: Partial<ConstraintSolverConfig>): void {
    this.solver.setConfig(config);
  }

  /**
   * Get solver configuration
   */
  getSolverConfig(): Readonly<ConstraintSolverConfig> {
    return this.solver.getConfig();
  }

  /**
   * Set constraint store for persistence
   */
  setConstraintStore(store: ConstraintStore, graphId: string): void {
    this.config.constraintStore = store;
    this.config.graphId = graphId;
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Generate a unique constraint ID
   */
  private generateId(): string {
    // Use browser crypto API if available, otherwise fallback
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `constraint-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get constraint statistics
   */
  getStats(): {
    total: number;
    byType: Record<LayoutConstraint["type"], number>;
    enabled: number;
    disabled: number;
  } {
    const constraints = this.getAllConstraints();
    const byType: Record<LayoutConstraint["type"], number> = {
      pin: 0,
      alignment: 0,
      group: 0,
      distance: 0,
      region: 0,
      order: 0,
    };

    let enabled = 0;
    let disabled = 0;

    for (const c of constraints) {
      byType[c.type]++;
      if (c.enabled) {
        enabled++;
      } else {
        disabled++;
      }
    }

    return {
      total: constraints.length,
      byType,
      enabled,
      disabled,
    };
  }

  /**
   * Enable/disable a constraint
   */
  setConstraintEnabled(constraintId: string, enabled: boolean): boolean {
    return this.updateConstraint(constraintId, { enabled });
  }

  /**
   * Set constraint priority
   */
  setConstraintPriority(constraintId: string, priority: ConstraintPriority): boolean {
    return this.updateConstraint(constraintId, { priority });
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clearAllConstraints();
    this.eventListeners.clear();
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a constraint manager instance
 */
export function createConstraintManager(
  config?: Partial<ConstraintManagerConfig>
): ConstraintManager {
  return new ConstraintManager(config);
}
