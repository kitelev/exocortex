import { injectable } from "tsyringe";
import { WorkflowEngine } from "./WorkflowEngine";
import { EffortStatus } from "../domain/constants/EffortStatus";
import type { WorkflowTransitionDefinition } from "../domain/models/WorkflowDefinition";

export interface VisibleCommand {
  readonly commandId: string;
  readonly label: string;
  readonly icon?: string;
  readonly targetStatus: EffortStatus;
  readonly isRollback: boolean;
}

@injectable()
export class VisibilityGenerator {
  constructor(private readonly engine: WorkflowEngine) {}

  getVisibleCommands(currentStatus: EffortStatus): VisibleCommand[] {
    return this.engine.getAllTransitions(currentStatus).map(t => this.toCommand(t));
  }

  getForwardCommands(currentStatus: EffortStatus): VisibleCommand[] {
    return this.engine.getAvailableTransitions(currentStatus).map(t => this.toCommand(t));
  }

  getRollbackCommands(currentStatus: EffortStatus): VisibleCommand[] {
    return this.engine.getRollbackTransitions(currentStatus).map(t => this.toCommand(t));
  }

  private toCommand(t: WorkflowTransitionDefinition): VisibleCommand {
    const fromShort = t.from.replace("ems__EffortStatus", "").toLowerCase();
    const toShort = t.to.replace("ems__EffortStatus", "").toLowerCase();
    return {
      commandId: `workflow-${fromShort}-to-${toShort}`,
      label: t.label,
      icon: t.icon,
      targetStatus: t.to,
      isRollback: t.isRollback,
    };
  }
}
