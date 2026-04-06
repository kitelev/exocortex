import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canPlanForEvening,
  TaskStatusService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class PlanForEveningCommand implements ICommand {
  id = "plan-for-evening";
  name = "Plan for evening (19:00)";

  constructor(
    private taskStatusService: TaskStatusService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canPlanForEvening(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to plan for evening: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Plan for evening error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.planForEvening(file);
    this.notifier.success(`Planned for evening (19:00): ${file.basename}`);
  }
}
