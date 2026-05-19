import { injectable } from "tsyringe";
import { EffortStatus } from "../domain/constants/EffortStatus";
import { GroundingType } from "../domain/constants/GroundingType";
import type {
  CommandDefinition,
  GroundingDefinition,
  PreconditionDefinition,
} from "../domain/models/CommandDefinition";
import type {
  WorkflowDefinition,
  WorkflowTransitionDefinition,
} from "../domain/models/WorkflowDefinition";
import { WorkflowEngine } from "./WorkflowEngine";

/**
 * Converts WorkflowTransitionDefinitions into CommandDefinitions,
 * bridging the workflow engine with the dynamic command system (RFC-009 §3).
 *
 * Pure domain adapter — no I/O, no vault access, no side effects.
 * Wraps WorkflowEngine for transition queries and adds command semantics.
 *
 * Issue #2431
 *
 * **RFC 31c1a0be Phase 4 PR-C (#3194) descope note.** This adapter depends
 * on the `EffortStatus` enum (symbolic-form values such as
 * `"ems__EffortStatusDoing"`) for its `shortStatus` label derivation and for
 * the SPARQL `ASK` precondition string built in `buildPrecondition`. The
 * `EffortStatus` enum is on the Phase 5 deletion list (see
 * `EffortStatus.ts`); migrating this adapter to UUID-form requires a
 * coordinated change of the enum, `WorkflowDefinition`, `WorkflowEngine`,
 * `WorkflowResolver`, `DefaultWorkflows`, `VisibilityGenerator`,
 * `EffortVisibilityRules`, `ProjectVisibilityRules`, plus all consumer tests
 * — comfortably above the 15-caller cascade-cap. Deferred to Phase 5.
 */
@injectable()
export class WorkflowCommandAdapter {
  private readonly engine: WorkflowEngine;

  constructor(private readonly workflow: WorkflowDefinition) {
    this.engine = new WorkflowEngine(workflow);
  }

  /**
   * Convert all transitions from the current status into CommandDefinitions.
   *
   * For each matching transition (where `from === currentStatus`):
   * - Generates deterministic ID: `workflow-{fromShort}-to-{toShort}`
   * - Uses transition label and icon
   * - Builds precondition: status check for `from` state
   * - Builds composite grounding: set status + set timestamps (from timestampOnEnter)
   * - Sets category: `isRollback ? 'rollback' : 'workflow'`
   */
  adaptTransitions(currentStatus: EffortStatus): CommandDefinition[] {
    const transitions = this.engine.getAllTransitions(currentStatus);
    return transitions.map((t) => this.transitionToCommand(t));
  }

  /**
   * Convert only forward (non-rollback) transitions to commands.
   */
  adaptForwardTransitions(currentStatus: EffortStatus): CommandDefinition[] {
    const transitions = this.engine.getAvailableTransitions(currentStatus);
    return transitions.map((t) => this.transitionToCommand(t));
  }

  /**
   * Convert only rollback transitions to commands.
   */
  adaptRollbackTransitions(currentStatus: EffortStatus): CommandDefinition[] {
    const transitions = this.engine.getRollbackTransitions(currentStatus);
    return transitions.map((t) => this.transitionToCommand(t));
  }

  /**
   * Get the underlying WorkflowEngine for direct queries.
   */
  getEngine(): WorkflowEngine {
    return this.engine;
  }

  /**
   * Get the underlying WorkflowDefinition.
   */
  getWorkflow(): WorkflowDefinition {
    return this.workflow;
  }

  private transitionToCommand(
    transition: WorkflowTransitionDefinition,
  ): CommandDefinition {
    const commandId = this.generateCommandId(transition);
    const precondition = this.buildPrecondition(transition);
    const grounding = this.buildGrounding(transition);
    const category = transition.isRollback ? "rollback" : "workflow";

    return {
      id: commandId,
      name: transition.label,
      icon: transition.icon,
      precondition,
      grounding,
      category,
      confirmMessage: transition.isRollback
        ? `Rollback to ${this.shortStatus(transition.to)}?`
        : undefined,
      successMessage: `Status changed to ${this.shortStatus(transition.to)}`,
    };
  }

  /**
   * Generate a deterministic command ID from transition endpoints.
   * Format: `workflow-{fromShort}-to-{toShort}`
   * Matches VisibilityGenerator's pattern.
   */
  private generateCommandId(
    transition: WorkflowTransitionDefinition,
  ): string {
    const fromShort = this.shortStatus(transition.from);
    const toShort = this.shortStatus(transition.to);
    return `workflow-${fromShort}-to-${toShort}`;
  }

  /**
   * Build a precondition that checks if the asset is in the expected `from` state.
   */
  private buildPrecondition(
    transition: WorkflowTransitionDefinition,
  ): PreconditionDefinition {
    return {
      id: `precond-${this.generateCommandId(transition)}`,
      label: `Asset status is ${this.shortStatus(transition.from)}`,
      sparqlAsk: `ASK { $target ems:Effort_status "${transition.from}" }`,
    };
  }

  /**
   * Build a composite grounding:
   * 1. Set status property to target state
   * 2. Set each timestamp from `timestampOnEnter` of the target state
   */
  private buildGrounding(
    transition: WorkflowTransitionDefinition,
  ): GroundingDefinition {
    const steps: GroundingDefinition[] = [];

    // Step 1: Set the status to the target state
    steps.push({
      id: `gnd-status-${this.shortStatus(transition.to)}`,
      label: `Set status to ${this.shortStatus(transition.to)}`,
      type: GroundingType.PROPERTY_SET,
      targetProperty: "ems__Effort_status",
      targetValue: transition.to,
    });

    // Step 2: Set timestamps defined in timestampOnEnter for the target state
    const timestamps = this.engine.getTimestampsForStatus(transition.to);
    for (const tsProperty of timestamps) {
      steps.push({
        id: `gnd-ts-${tsProperty}`,
        label: `Set ${tsProperty}`,
        type: GroundingType.PROPERTY_SET,
        targetProperty: tsProperty,
        targetValue: "$now",
      });
    }

    // If only one step, return it directly (no need for composite wrapper)
    if (steps.length === 1) {
      return steps[0];
    }

    // Composite grounding wrapping all steps
    return {
      id: `gnd-composite-${this.generateCommandId(transition)}`,
      label: `Transition to ${this.shortStatus(transition.to)}`,
      type: GroundingType.COMPOSITE,
      steps,
    };
  }

  /**
   * Extract short status name from full EffortStatus enum value.
   * e.g., "ems__EffortStatusDoing" → "doing"
   */
  private shortStatus(status: EffortStatus): string {
    return status.replace("ems__EffortStatus", "").toLowerCase();
  }
}
