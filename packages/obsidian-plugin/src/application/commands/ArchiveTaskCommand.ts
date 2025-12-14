import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canArchiveTask,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class ArchiveTaskCommand implements ICommand {
  id = "archive-task";
  name = "Archive task";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canArchiveTask(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to archive task: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Archive task error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.archiveTask(file);
    new Notice(`Archived: ${file.basename}`);
  }
}
