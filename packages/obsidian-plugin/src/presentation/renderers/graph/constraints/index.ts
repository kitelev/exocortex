/**
 * Layout Constraints Module
 *
 * Exports the constraint system components for user-controlled node positioning
 * in graph layouts, including constraint management, solving, snapping, and persistence.
 *
 * @module presentation/renderers/graph/constraints
 * @since 1.0.0
 */

// Types and interfaces
export type {
  Point,
  BoundingBox,
  ConstraintPriority,
  ConstraintType,
  BaseConstraint,
  PinConstraint,
  AlignmentConstraint,
  GroupConstraint,
  DistanceConstraint,
  RegionConstraint,
  OrderConstraint,
  LayoutConstraint,
  GroupOptions,
  AlignmentOptions,
  DistanceOptions,
  OrderOptions,
  ConstraintSolverResult,
  ConstraintSolverConfig,
  SnapResult,
  AlignmentGuide,
  ConstraintEventType,
  ConstraintEvent,
  ConstraintEventListener,
  SerializedConstraint,
  ConstraintStore,
} from "./constraint.types";

// Constraint Manager
export {
  ConstraintManager,
  createConstraintManager,
  DEFAULT_CONSTRAINT_MANAGER_CONFIG,
} from "./ConstraintManager";
export type { ConstraintManagerConfig } from "./ConstraintManager";

// Constraint Solver
export {
  ConstraintSolver,
  createConstraintSolver,
  DEFAULT_CONSTRAINT_SOLVER_CONFIG,
} from "./ConstraintSolver";

// Snap Manager
export {
  SnapManager,
  createSnapManager,
  DEFAULT_SNAP_CONFIG,
} from "./SnapManager";
export type { SnapConfig } from "./SnapManager";

// Persistence
export {
  LocalStorageConstraintStore,
  createLocalStorageConstraintStore,
} from "./LocalStorageConstraintStore";
