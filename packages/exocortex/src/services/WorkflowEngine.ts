import { EffortStatus } from "../domain/constants/EffortStatus";
import type {
  WorkflowDefinition,
  WorkflowTransitionDefinition,
} from "../domain/models/WorkflowDefinition";

/**
 * Validation result for a WorkflowDefinition.
 */
export interface WorkflowValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Stateless engine that drives state transitions based on a WorkflowDefinition.
 *
 * Pure domain service — no I/O, no vault access, no side effects.
 * Construct with a definition, then query available transitions.
 *
 * Issue #2360
 */
export class WorkflowEngine {
  constructor(private readonly definition: WorkflowDefinition) {}

  /**
   * Get all available forward (non-rollback) transitions from the current status.
   */
  getAvailableTransitions(
    currentStatus: EffortStatus,
  ): readonly WorkflowTransitionDefinition[] {
    return this.definition.transitions.filter(
      (t) => t.from === currentStatus && !t.isRollback,
    );
  }

  /**
   * Get all available rollback transitions from the current status.
   */
  getRollbackTransitions(
    currentStatus: EffortStatus,
  ): readonly WorkflowTransitionDefinition[] {
    return this.definition.transitions.filter(
      (t) => t.from === currentStatus && t.isRollback,
    );
  }

  /**
   * Get ALL transitions (forward + rollback) from the current status.
   */
  getAllTransitions(
    currentStatus: EffortStatus,
  ): readonly WorkflowTransitionDefinition[] {
    return this.definition.transitions.filter(
      (t) => t.from === currentStatus,
    );
  }

  /**
   * Check if a specific transition is allowed.
   */
  canTransition(from: EffortStatus, to: EffortStatus): boolean {
    return this.definition.transitions.some(
      (t) => t.from === from && t.to === to,
    );
  }

  /**
   * Get the previous status for rollback.
   * Returns the target of the first rollback transition from currentStatus.
   */
  getPreviousStatus(currentStatus: EffortStatus): EffortStatus | null {
    const rollback = this.definition.transitions.find(
      (t) => t.from === currentStatus && t.isRollback,
    );
    return rollback?.to ?? null;
  }

  /**
   * Get all statuses reachable via forward transitions from current status.
   */
  getNextStates(currentStatus: EffortStatus): readonly EffortStatus[] {
    return this.getAvailableTransitions(currentStatus).map((t) => t.to);
  }

  /**
   * Check if the status is a terminal state (Done, Trashed, etc.).
   */
  isTerminalState(status: EffortStatus): boolean {
    return this.definition.terminalStates.includes(status);
  }

  /**
   * Check if the status is the initial state.
   */
  isInitialState(status: EffortStatus): boolean {
    return this.definition.initialState === status;
  }

  /**
   * Get timestamp property names that should be set when entering a status.
   */
  getTimestampsForStatus(status: EffortStatus): readonly string[] {
    const state = this.definition.states.find((s) => s.status === status);
    return state?.timestampOnEnter ?? [];
  }

  /**
   * Get the transition definition for a specific from→to pair.
   */
  getTransition(
    from: EffortStatus,
    to: EffortStatus,
  ): WorkflowTransitionDefinition | undefined {
    return this.definition.transitions.find(
      (t) => t.from === from && t.to === to,
    );
  }

  /**
   * Get all states in display order.
   */
  getOrderedStates(): readonly EffortStatus[] {
    return this.definition.states.map((s) => s.status);
  }

  /**
   * Get the underlying definition.
   */
  getDefinition(): WorkflowDefinition {
    return this.definition;
  }

  /**
   * Validate the workflow definition for structural correctness.
   *
   * Checks:
   * - Has at least one state
   * - Initial state exists in states
   * - All terminal states exist in states
   * - All transition endpoints reference existing states
   * - All non-terminal states have at least one outgoing forward transition
   * - No duplicate transitions (same from→to)
   */
  validate(): WorkflowValidationResult {
    const errors: string[] = [];
    const stateStatuses = new Set(this.definition.states.map((s) => s.status));

    // Must have at least one state
    if (this.definition.states.length === 0) {
      errors.push("Workflow must have at least one state");
    }

    // Initial state must exist in states
    if (!stateStatuses.has(this.definition.initialState)) {
      errors.push(
        `Initial state "${this.definition.initialState}" is not in the states list`,
      );
    }

    // Terminal states must exist in states
    for (const ts of this.definition.terminalStates) {
      if (!stateStatuses.has(ts)) {
        errors.push(
          `Terminal state "${ts}" is not in the states list`,
        );
      }
    }

    // Transition endpoints must reference valid states
    for (const t of this.definition.transitions) {
      if (!stateStatuses.has(t.from)) {
        errors.push(
          `Transition "${t.label}" references unknown source state "${t.from}"`,
        );
      }
      if (!stateStatuses.has(t.to)) {
        errors.push(
          `Transition "${t.label}" references unknown target state "${t.to}"`,
        );
      }
    }

    // Non-terminal states must have at least one outgoing forward transition
    for (const state of this.definition.states) {
      if (this.definition.terminalStates.includes(state.status)) continue;

      const outgoing = this.definition.transitions.filter(
        (t) => t.from === state.status && !t.isRollback,
      );
      if (outgoing.length === 0) {
        errors.push(
          `State "${state.status}" has no outgoing forward transitions (dead end)`,
        );
      }
    }

    // No duplicate transitions
    const seen = new Set<string>();
    for (const t of this.definition.transitions) {
      const key = `${t.from}→${t.to}`;
      if (seen.has(key)) {
        errors.push(`Duplicate transition: ${key}`);
      }
      seen.add(key);
    }

    return { valid: errors.length === 0, errors };
  }
}
