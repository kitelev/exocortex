import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canMarkDone,
  TaskStatusService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class MarkDoneCommand implements ICommand {
  id = "mark-done";
  name = "Mark as done";

  constructor(
    private taskStatusService: TaskStatusService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canMarkDone(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to mark as done: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Mark done error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.markTaskAsDone(file);
    this.notifier.success(`Marked as done: ${file.basename}`);
  }
}
