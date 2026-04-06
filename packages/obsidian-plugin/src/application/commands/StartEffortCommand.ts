import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canStartEffort,
  TaskStatusService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class StartEffortCommand implements ICommand {
  id = "start-effort";
  name = "Start effort";

  constructor(
    private taskStatusService: TaskStatusService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canStartEffort(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to start effort: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Start effort error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.startEffort(file);
    this.notifier.success(`Started effort: ${file.basename}`);
  }
}
