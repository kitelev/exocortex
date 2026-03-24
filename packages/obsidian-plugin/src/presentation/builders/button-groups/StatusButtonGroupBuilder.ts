import { TFile } from "obsidian";
import { ActionButton } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  canSetDraftStatus,
  canMoveToBacklog,
  canMoveToAnalysis,
  canMoveToToDo,
  canStartEffort,
  canMarkDone,
  canRollbackStatus,
  CommandVisibilityContext,
  WorkflowEngine,
  WorkflowResolver,
  VisibilityGenerator,
  EffortStatus,
  AssetClass,
} from "exocortex";
import { InMemoryTripleStore } from "exocortex";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
  ButtonBuilderServices,
} from "./ButtonBuilderTypes";

/**
 * Builds status-related buttons (Set Draft, Move to Backlog, Start Effort, etc.)
 */
export class StatusButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private services: ButtonBuilderServices) {}

  getGroupId(): string {
    return "status";
  }

  getGroupTitle(): string {
    return "Status";
  }

  build(context: ButtonBuilderContext): ActionButton[] {
    const { file, visibilityContext, logger, refresh, metadata } = context;

    const standardButtons = [
      this.setDraftStatusButton(file, visibilityContext, logger, refresh),
      this.moveToBacklogButton(file, visibilityContext, logger, refresh),
      this.moveToAnalysisButton(file, visibilityContext, logger, refresh),
      this.moveToToDoButton(file, visibilityContext, logger, refresh),
      this.startEffortButton(file, visibilityContext, logger, refresh),
      this.markDoneButton(file, visibilityContext, logger, refresh),
      this.rollbackStatusButton(file, visibilityContext, logger, refresh),
    ];

    const hasVisibleStandard = standardButtons.some((b) => b.visible);
    if (hasVisibleStandard) {
      return standardButtons;
    }

    const workflowButtons = this.buildWorkflowButtons(file, metadata, logger, refresh);
    if (workflowButtons.length > 0) {
      return workflowButtons;
    }

    return standardButtons;
  }

  private buildWorkflowButtons(
    file: TFile,
    metadata: Record<string, unknown>,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton[] {
    const statusRaw = metadata["ems__Effort_status"] as string | undefined;
    if (!statusRaw) return [];

    const normalized = statusRaw.replace(/["'[\]]/g, "").trim();
    const currentStatus = Object.values(EffortStatus).find((s) => s === normalized);
    if (!currentStatus) return [];

    const store = this.services.tripleStore ?? new InMemoryTripleStore();
    const resolver = new WorkflowResolver(store);
    const instanceClassRaw = metadata["exo__Instance_class"];
    const isTask = Array.isArray(instanceClassRaw)
      ? instanceClassRaw.some((c: string) => String(c).includes("ems__Task") || String(c).includes("ems__Meeting"))
      : typeof instanceClassRaw === "string" && (instanceClassRaw.includes("ems__Task") || instanceClassRaw.includes("ems__Meeting"));

    const assetClass = isTask ? AssetClass.TASK : AssetClass.PROJECT;
    const definition = resolver.getHardcodedFallback(assetClass);
    const engine = new WorkflowEngine(definition);
    const generator = new VisibilityGenerator(engine);

    const commands = generator.getVisibleCommands(currentStatus);
    return commands.map((cmd) => ({
      id: cmd.commandId,
      label: cmd.label,
      variant: cmd.isRollback ? "warning" as const : "secondary" as const,
      visible: true,
      onClick: async () => {
        const wrappedStatus = `"[[${cmd.targetStatus}]]"`;
        const content = await file.vault.read(file);
        const updatedContent = content.replace(
          /ems__Effort_status:\s*"?\[\[[^\]]*\]\]"?/,
          `ems__Effort_status: ${wrappedStatus}`,
        );
        await file.vault.modify(file, updatedContent);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Workflow transition: ${cmd.label} → ${cmd.targetStatus} on ${file.path}`);
      },
    }));
  }

  private setDraftStatusButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "set-draft-status",
      label: "Set Draft Status",
      variant: "secondary",
      visible: canSetDraftStatus(context),
      onClick: async () => {
        await this.services.taskStatusService.setDraftStatus(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Set Draft status: ${file.path}`);
      },
    };
  }

  private moveToBacklogButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "move-to-backlog",
      label: "Move to Backlog",
      variant: "secondary",
      visible: canMoveToBacklog(context),
      onClick: async () => {
        await this.services.taskStatusService.moveToBacklog(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Moved to Backlog: ${file.path}`);
      },
    };
  }

  private moveToAnalysisButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "move-to-analysis",
      label: "Move to Analysis",
      variant: "secondary",
      visible: canMoveToAnalysis(context),
      onClick: async () => {
        await this.services.taskStatusService.moveToAnalysis(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Moved to Analysis: ${file.path}`);
      },
    };
  }

  private moveToToDoButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "move-to-todo",
      label: "Move to ToDo",
      variant: "secondary",
      visible: canMoveToToDo(context),
      onClick: async () => {
        await this.services.taskStatusService.moveToToDo(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Moved to ToDo: ${file.path}`);
      },
    };
  }

  private startEffortButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "start-effort",
      label: "Start Effort",
      variant: "secondary",
      visible: canStartEffort(context),
      onClick: async () => {
        await this.services.taskStatusService.startEffort(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Started effort: ${file.path}`);
      },
    };
  }

  private markDoneButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "mark-done",
      label: "Mark Done",
      variant: "success",
      visible: canMarkDone(context),
      onClick: async () => {
        await this.services.taskStatusService.markTaskAsDone(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Marked task as Done: ${file.path}`);
      },
    };
  }

  private rollbackStatusButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "rollback-status",
      label: "Rollback Status",
      variant: "warning",
      visible: canRollbackStatus(context),
      onClick: async () => {
        await this.services.taskStatusService.rollbackStatus(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Rolled back status: ${file.path}`);
      },
    };
  }
}
