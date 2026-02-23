import { TFile } from "obsidian";
import { ActionButton } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  canSetCriticalityZone,
  CommandVisibilityContext,
  CriticalityZoneService,
} from "exocortex";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import {
  IButtonGroupBuilder,
  ButtonBuilderContext,
} from "./ButtonBuilderTypes";

/**
 * Services required by CriticalityZoneButtonGroupBuilder
 */
export interface CriticalityZoneButtonBuilderServices {
  criticalityZoneService: CriticalityZoneService;
}

/**
 * Builds criticality zone buttons (Today, This week, Someday)
 *
 * These buttons allow quick categorization of tasks by urgency:
 * - Today: High priority, must be done today
 * - This week: Medium priority, should be done this week
 * - Someday: Low priority, no specific deadline
 */
export class CriticalityZoneButtonGroupBuilder implements IButtonGroupBuilder {
  constructor(private services: CriticalityZoneButtonBuilderServices) {}

  getGroupId(): string {
    return "criticality-zone";
  }

  getGroupTitle(): string {
    return "Criticality Zone";
  }

  build(context: ButtonBuilderContext): ActionButton[] {
    const { file, visibilityContext, logger, refresh } = context;

    return [
      this.zoneTodayButton(file, visibilityContext, logger, refresh),
      this.zoneThisWeekButton(file, visibilityContext, logger, refresh),
      this.zoneSomedayButton(file, visibilityContext, logger, refresh),
    ];
  }

  private zoneTodayButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "zone-today",
      label: "Today",
      variant: "primary",
      visible: canSetCriticalityZone(context),
      onClick: async () => {
        await this.services.criticalityZoneService.setZoneToday(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Set zone to Today: ${file.path}`);
      },
    };
  }

  private zoneThisWeekButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "zone-this-week",
      label: "This week",
      variant: "secondary",
      visible: canSetCriticalityZone(context),
      onClick: async () => {
        await this.services.criticalityZoneService.setZoneThisWeek(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Set zone to This week: ${file.path}`);
      },
    };
  }

  private zoneSomedayButton(
    file: TFile,
    context: CommandVisibilityContext,
    logger: ILogger,
    refresh: () => Promise<void>,
  ): ActionButton {
    return {
      id: "zone-someday",
      label: "Someday",
      variant: "secondary",
      visible: canSetCriticalityZone(context),
      onClick: async () => {
        await this.services.criticalityZoneService.setZoneSomeday(file);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await refresh();
        logger.info(`Set zone to Someday: ${file.path}`);
      },
    };
  }
}
