import { EffortStatus } from "../constants/EffortStatus";
import { AssetClass } from "../constants/AssetClass";

/**
 * Declarative workflow definition loaded from vault assets (Issue #2359).
 *
 * Represents a complete workflow graph: states + transitions.
 * Immutable after construction — create a new instance to modify.
 */
export interface WorkflowDefinition {
  /** Asset UID of the ems__Workflow file */
  readonly id: string;
  /** Human-readable workflow name */
  readonly name: string;
  /** Which asset class this workflow applies to */
  readonly targetClass: AssetClass;
  /** Ordered list of states in this workflow */
  readonly states: readonly WorkflowStateDefinition[];
  /** List of allowed transitions */
  readonly transitions: readonly WorkflowTransitionDefinition[];
  /** Status assigned to new assets */
  readonly initialState: EffortStatus;
  /** Statuses that end the workflow (e.g., Done, Trashed) */
  readonly terminalStates: readonly EffortStatus[];
  /** Whether this is the default workflow for the target class */
  readonly isDefault: boolean;
}

/**
 * A single state within a workflow.
 */
export interface WorkflowStateDefinition {
  /** The EffortStatus this state represents */
  readonly status: EffortStatus;
  /** Display order (lower = earlier in workflow) */
  readonly order: number;
  /** Whether this state can be skipped by the user */
  readonly optional: boolean;
  /** Property names to set when entering this state (e.g., "ems__Effort_startTimestamp") */
  readonly timestampOnEnter: readonly string[];
  /** CSS color for badge display (optional) */
  readonly badgeColor?: string;
}

/**
 * A transition between two states in a workflow.
 */
export interface WorkflowTransitionDefinition {
  /** Source status */
  readonly from: EffortStatus;
  /** Target status */
  readonly to: EffortStatus;
  /** Button label text (e.g., "→ Analysis", "✓ Done") */
  readonly label: string;
  /** Lucide icon name (optional) */
  readonly icon?: string;
  /** Whether this is a rollback (undo) transition */
  readonly isRollback: boolean;
}
