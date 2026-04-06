import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canArchiveTask,
  TaskStatusService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class ArchiveTaskCommand implements ICommand {
  id = "archive-task";
  name = "Archive task";

  constructor(
    private taskStatusService: TaskStatusService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canArchiveTask(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to archive task: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Archive task error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.archiveTask(file);
    this.notifier.success(`Archived: ${file.basename}`);
  }
}
