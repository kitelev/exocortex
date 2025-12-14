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
} from "exocortex";
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
    const { file, visibilityContext, logger, refresh } = context;

    return [
      this.setDraftStatusButton(file, visibilityContext, logger, refresh),
      this.moveToBacklogButton(file, visibilityContext, logger, refresh),
      this.moveToAnalysisButton(file, visibilityContext, logger, refresh),
      this.moveToToDoButton(file, visibilityContext, logger, refresh),
      this.startEffortButton(file, visibilityContext, logger, refresh),
      this.markDoneButton(file, visibilityContext, logger, refresh),
      this.rollbackStatusButton(file, visibilityContext, logger, refresh),
    ];
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
