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
  InMemoryTripleStore,
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

  async build(context: ButtonBuilderContext): Promise<ActionButton[]> {
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

    const workflowButtons = await this.buildWorkflowButtons(file, metadata, logger, refresh);
    if (workflowButtons.length > 0) {
      return workflowButtons;
    }

    return standardButtons;
  }

  private async buildWorkflowButtons(
    file: TFile,
    metadata: Record<string, unknown>,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): Promise<ActionButton[]> {
    const statusRaw = metadata["ems__Effort_status"] as string | undefined;
    if (!statusRaw) return [];

    const normalized = statusRaw.replace(/["'[\]]/g, "").trim();
    const currentStatus = Object.values(EffortStatus).find((s) => s === normalized);
    if (!currentStatus) return [];

    const store = this.services.tripleStore ?? new InMemoryTripleStore();
    const resolver = new WorkflowResolver(store);
    const instanceClassRaw = metadata["exo__Instance_class"];

    const rawClass = Array.isArray(instanceClassRaw)
      ? (instanceClassRaw[0] as string ?? "")
      : (typeof instanceClassRaw === "string" ? instanceClassRaw : "");
    const normalizedClass = rawClass.replace(/["'[\]]/g, "").trim() as AssetClass;

    const isKnownTask = normalizedClass === AssetClass.TASK || normalizedClass === AssetClass.MEETING;
    const isKnownProject = normalizedClass === AssetClass.PROJECT;
    const fallbackClass = isKnownTask ? AssetClass.TASK : AssetClass.PROJECT;

    let definition;
    if (!isKnownTask && !isKnownProject) {
      try {
        const storeCount = await store.count();
        if (storeCount > 0) {
          definition = await resolver.resolveForClass(normalizedClass);
          if (definition.states.length === 0 && definition.transitions.length === 0) {
            definition = null;
          }
        }
      } catch {
        // Fall through to hardcoded
      }
    }
    if (!definition) {
      definition = resolver.getHardcodedFallback(fallbackClass);
    }
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
        let content = await file.vault.read(file);
        content = content.replace(
          /ems__Effort_status:\s*"?\[\[[^\]]*\]\]"?/,
          `ems__Effort_status: ${wrappedStatus}`,
        );

        const targetState = definition.states.find(
          (s: { status: string }) => s.status === cmd.targetStatus,
        );
        if (targetState && targetState.timestampOnEnter.length > 0) {
          const now = new Date();
          const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
          for (const prop of targetState.timestampOnEnter) {
            const propRegex = new RegExp(`${prop}:\\s*.*`);
            if (propRegex.test(content)) {
              content = content.replace(propRegex, `${prop}: ${ts}`);
            } else {
              content = content.replace(
                /ems__Effort_status:/,
                `${prop}: ${ts}\nems__Effort_status:`,
              );
            }
          }
        }

        await file.vault.modify(file, content);
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
