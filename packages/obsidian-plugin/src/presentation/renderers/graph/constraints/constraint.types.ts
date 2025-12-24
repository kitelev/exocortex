/**
 * Layout Constraint Types
 *
 * Defines the types and interfaces for the constraint system that enables
 * user-controlled node positioning in graph layouts.
 *
 * @module presentation/renderers/graph/constraints
 * @since 1.0.0
 */

// ============================================================
// Basic Types
// ============================================================

/**
 * 2D point coordinates
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Bounding box for spatial constraints
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Constraint priority levels
 */
export type ConstraintPriority = "low" | "medium" | "high" | "critical";

/**
 * Constraint types
 */
export type ConstraintType =
  | "pin"
  | "alignment"
  | "group"
  | "distance"
  | "region"
  | "order";

// ============================================================
// Constraint Interfaces
// ============================================================

/**
 * Base constraint interface - all constraints implement this
 */
export interface BaseConstraint {
  /** Unique identifier for the constraint */
  id: string;

  /** Constraint type discriminator */
  type: ConstraintType;

  /** Whether the constraint is currently active */
  enabled: boolean;

  /** Priority level for conflict resolution */
  priority: ConstraintPriority;
}

/**
 * Pin constraint - fixes a node at a specific position
 */
export interface PinConstraint extends BaseConstraint {
  type: "pin";

  /** ID of the node to pin */
  nodeId: string;

  /** Target position for the node */
  position: Point;

  /** Strength of the constraint (0-1), affects how strongly to enforce */
  strength: number;
}

/**
 * Alignment constraint - aligns multiple nodes along an axis
 */
export interface AlignmentConstraint extends BaseConstraint {
  type: "alignment";

  /** Alignment axis */
  axis: "horizontal" | "vertical";

  /** IDs of nodes to align */
  nodeIds: string[];

  /** Fixed reference position on axis (optional) */
  referencePosition?: number;

  /** Alignment method when no reference position is set */
  alignmentMethod: "average" | "first" | "last" | "min" | "max";
}

/**
 * Group constraint - keeps nodes together within a region
 */
export interface GroupConstraint extends BaseConstraint {
  type: "group";

  /** IDs of nodes in the group */
  nodeIds: string[];

  /** Optional fixed bounding box */
  boundingBox?: BoundingBox;

  /** Padding inside the bounding box */
  padding: number;

  /** Minimum distance between nodes in the group */
  minDistance: number;

  /** Maximum distance between nodes in the group (optional) */
  maxDistance?: number;

  /** Label for the group */
  label?: string;

  /** Color for group visual representation */
  color?: string;
}

/**
 * Distance constraint - enforces distance between two nodes
 */
export interface DistanceConstraint extends BaseConstraint {
  type: "distance";

  /** First node ID */
  node1: string;

  /** Second node ID */
  node2: string;

  /** Minimum allowed distance */
  minDistance?: number;

  /** Maximum allowed distance */
  maxDistance?: number;

  /** Exact distance (overrides min/max) */
  exactDistance?: number;
}

/**
 * Region constraint - keeps a node within a bounding box
 */
export interface RegionConstraint extends BaseConstraint {
  type: "region";

  /** ID of the constrained node */
  nodeId: string;

  /** Bounding region the node must stay within */
  region: BoundingBox;
}

/**
 * Order constraint - maintains node ordering along an axis
 */
export interface OrderConstraint extends BaseConstraint {
  type: "order";

  /** Axis for ordering */
  axis: "x" | "y";

  /** Node IDs in order from low to high on the axis */
  nodeIds: string[];

  /** Minimum spacing between ordered nodes */
  minSpacing?: number;
}

/**
 * Union type of all constraint types
 */
export type LayoutConstraint =
  | PinConstraint
  | AlignmentConstraint
  | GroupConstraint
  | DistanceConstraint
  | RegionConstraint
  | OrderConstraint;

// ============================================================
// Constraint Options
// ============================================================

/**
 * Options for creating a group constraint
 */
export interface GroupOptions {
  /** Padding inside the bounding box */
  padding?: number;

  /** Minimum distance between nodes */
  minDistance?: number;

  /** Maximum distance between nodes */
  maxDistance?: number;

  /** Fixed bounding box */
  boundingBox?: BoundingBox;

  /** Group label */
  label?: string;

  /** Group color */
  color?: string;
}

/**
 * Options for creating an alignment constraint
 */
export interface AlignmentOptions {
  /** Fixed reference position on axis */
  referencePosition?: number;

  /** Alignment method */
  alignmentMethod?: "average" | "first" | "last" | "min" | "max";
}

/**
 * Options for creating a distance constraint
 */
export interface DistanceOptions {
  /** Minimum allowed distance */
  minDistance?: number;

  /** Maximum allowed distance */
  maxDistance?: number;

  /** Exact distance */
  exactDistance?: number;
}

/**
 * Options for creating an order constraint
 */
export interface OrderOptions {
  /** Minimum spacing between ordered nodes */
  minSpacing?: number;
}

// ============================================================
// Constraint Solver Types
// ============================================================

/**
 * Result of solving constraints
 */
export interface ConstraintSolverResult {
  /** Final node positions */
  positions: Map<string, Point>;

  /** Whether the solver converged */
  converged: boolean;

  /** Number of iterations performed */
  iterations: number;

  /** Maximum displacement in the final iteration */
  maxDisplacement: number;

  /** Total constraint violations */
  violations: number;
}

/**
 * Configuration for the constraint solver
 */
export interface ConstraintSolverConfig {
  /** Maximum number of iterations */
  maxIterations: number;

  /** Convergence tolerance */
  tolerance: number;

  /** Relaxation factor for iterative projection */
  relaxation: number;

  /** Whether to use soft constraints (gradual enforcement) */
  softConstraints: boolean;

  /** Constraint priority weights */
  priorityWeights: Record<ConstraintPriority, number>;
}

// ============================================================
// Snap and Guide Types
// ============================================================

/**
 * Snap result when dragging a node
 */
export interface SnapResult {
  /** Position after snapping */
  position: Point;

  /** Whether snapping occurred */
  snapped: boolean;

  /** Horizontal snap target (if any) */
  horizontalTarget?: Point;

  /** Vertical snap target (if any) */
  verticalTarget?: Point;
}

/**
 * Alignment guide for visual feedback
 */
export interface AlignmentGuide {
  /** Guide axis */
  axis: "horizontal" | "vertical";

  /** Position on the perpendicular axis */
  position: number;

  /** Start and end points of the guide line */
  start: Point;
  end: Point;

  /** Node IDs that form this guide */
  nodeIds: string[];
}

// ============================================================
// Event Types
// ============================================================

/**
 * Constraint manager event types
 */
export type ConstraintEventType =
  | "constraintAdded"
  | "constraintRemoved"
  | "constraintUpdated"
  | "constraintsApplied"
  | "solverStarted"
  | "solverCompleted";

/**
 * Constraint event data
 */
export interface ConstraintEvent {
  type: ConstraintEventType;
  constraint?: LayoutConstraint;
  constraintId?: string;
  positions?: Map<string, Point>;
  solverResult?: ConstraintSolverResult;
}

/**
 * Constraint event listener
 */
export type ConstraintEventListener = (event: ConstraintEvent) => void;

// ============================================================
// Persistence Types
// ============================================================

/**
 * Serialized constraint for storage
 */
export interface SerializedConstraint {
  id: string;
  type: ConstraintType;
  enabled: boolean;
  priority: ConstraintPriority;
  data: Record<string, unknown>;
}

/**
 * Constraint store for persistence
 */
export interface ConstraintStore {
  /** Save constraints for a graph */
  save(graphId: string, constraints: LayoutConstraint[]): Promise<void>;

  /** Load constraints for a graph */
  load(graphId: string): Promise<LayoutConstraint[]>;

  /** Delete constraints for a graph */
  delete(graphId: string): Promise<void>;
}
