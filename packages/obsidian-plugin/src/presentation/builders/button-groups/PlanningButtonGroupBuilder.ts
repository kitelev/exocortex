import { TFile } from "obsidian";
import { ActionButton } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  canPlanOnToday,
  canPlanForEvening,
  canShiftDayBackward,
  canShiftDayForward,
  canVoteOnEffort,
  canSetActiveFocus,
  CommandVisibilityContext,
} from "exocortex";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
  ButtonBuilderServices,
} from "./ButtonBuilderTypes";
import { ExocortexPluginInterface, MetadataRecord } from '@plugin/types';

/**
 * Builds planning-related buttons (Plan on Today, Vote, Set Active Focus, etc.)
 */
export class PlanningButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private services: ButtonBuilderServices) {}

  getGroupId(): string {
    return "planning";
  }

  getGroupTitle(): string {
    return "Planning";
  }

  build(context: ButtonBuilderContext): ActionButton[] {
    const { settings, plugin, file, metadata, visibilityContext, logger, refresh } = context;

    return [
      this.setActiveFocusButton(settings, plugin, file, visibilityContext, logger, refresh),
      this.planOnTodayButton(file, visibilityContext, logger, refresh),
      this.planForEveningButton(file, visibilityContext, logger, refresh),
      this.shiftDayBackwardButton(file, visibilityContext, logger, refresh),
      this.shiftDayForwardButton(file, visibilityContext, logger, refresh),
      this.voteOnEffortButton(file, metadata, visibilityContext, logger, refresh),
    ];
  }

  private setActiveFocusButton(
    settings: ExocortexSettings,
    plugin: ExocortexPluginInterface,
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "set-active-focus",
      label:
        settings.activeFocusArea === file.basename
          ? "Clear Active Focus"
          : "Set Active Focus",
      variant: "warning",
      visible: canSetActiveFocus(context),
      onClick: async () => {
        if (settings.activeFocusArea === file.basename) {
          settings.activeFocusArea = null;
        } else {
          settings.activeFocusArea = file.basename;
        }
        await plugin.saveSettings();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Active focus area set to: ${settings.activeFocusArea}`);
      },
    };
  }

  private planOnTodayButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "plan-on-today",
      label: "Plan on Today",
      variant: "warning",
      visible: canPlanOnToday(context),
      onClick: async () => {
        await this.services.taskStatusService.planOnToday(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Planned on today: ${file.path}`);
      },
    };
  }

  private planForEveningButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "plan-for-evening",
      label: "Plan for Evening (19:00)",
      variant: "warning",
      visible: canPlanForEvening(context),
      onClick: async () => {
        await this.services.taskStatusService.planForEvening(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Planned for evening: ${file.path}`);
      },
    };
  }

  private shiftDayBackwardButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "shift-day-backward",
      label: "Shift Day ◀",
      variant: "warning",
      visible: canShiftDayBackward(context),
      onClick: async () => {
        await this.services.taskStatusService.shiftDayBackward(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Day shifted backward: ${file.path}`);
      },
    };
  }

  private shiftDayForwardButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "shift-day-forward",
      label: "Shift Day ▶",
      variant: "warning",
      visible: canShiftDayForward(context),
      onClick: async () => {
        await this.services.taskStatusService.shiftDayForward(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Day shifted forward: ${file.path}`);
      },
    };
  }

  private voteOnEffortButton(
    file: TFile,
    metadata: MetadataRecord,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "vote-on-effort",
      label:
        metadata.ems__Effort_votes &&
        typeof metadata.ems__Effort_votes === "number" &&
        metadata.ems__Effort_votes > 0
          ? `Vote (${metadata.ems__Effort_votes})`
          : "Vote",
      variant: "warning",
      visible: canVoteOnEffort(context),
      onClick: async () => {
        const newVoteCount =
          await this.services.effortVotingService.incrementEffortVotes(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Voted on effort: ${file.path} (votes: ${newVoteCount})`);
      },
    };
  }
}
