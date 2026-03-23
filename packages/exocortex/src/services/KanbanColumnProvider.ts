import type { WorkflowDefinition } from "../domain/models/WorkflowDefinition";
import { EffortStatus } from "../domain/constants/EffortStatus";

/**
 * A single Kanban board column derived from a WorkflowStateDefinition.
 */
export interface KanbanColumn {
  readonly status: EffortStatus;
  readonly label: string;
  readonly order: number;
  readonly badgeColor?: string;
}

/**
 * Generates ordered Kanban column definitions from a WorkflowDefinition.
 *
 * Translates workflow states into board columns with human-readable labels,
 * preserving badge colors and display order.
 *
 * Issue #2367
 */
export class KanbanColumnProvider {
  /**
   * Generate ordered columns from a WorkflowDefinition.
   * Includes all states defined in the workflow.
   */
  getColumns(definition: WorkflowDefinition): KanbanColumn[] {
    return definition.states
      .map((state) => ({
        status: state.status,
        label: this.statusToLabel(state.status),
        order: state.order,
        badgeColor: state.badgeColor,
      }))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Generate columns excluding specified disabled states.
   * Useful for hiding optional workflow states the user has turned off.
   */
  getActiveColumns(
    definition: WorkflowDefinition,
    disabledStates: EffortStatus[] = [],
  ): KanbanColumn[] {
    return this.getColumns(definition).filter(
      (col) => !disabledStates.includes(col.status),
    );
  }

  /**
   * Convert an EffortStatus enum value to a human-readable label.
   * Strips the "ems__EffortStatus" prefix.
   *
   * Example: "ems__EffortStatusDoing" → "Doing"
   */
  private statusToLabel(status: EffortStatus): string {
    return status.replace("ems__EffortStatus", "");
  }
}
