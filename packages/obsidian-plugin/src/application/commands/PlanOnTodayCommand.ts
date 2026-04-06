import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canPlanOnToday,
  TaskStatusService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class PlanOnTodayCommand implements ICommand {
  id = "plan-on-today";
  name = "Plan on today";

  constructor(
    private taskStatusService: TaskStatusService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canPlanOnToday(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to plan on today: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Plan on today error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.planOnToday(file);
    this.notifier.success(`Planned on today: ${file.basename}`);
  }
}
