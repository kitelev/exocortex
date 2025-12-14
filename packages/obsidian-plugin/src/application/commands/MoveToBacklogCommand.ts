import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canMoveToBacklog,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class MoveToBacklogCommand implements ICommand {
  id = "move-to-backlog";
  name = "Move to backlog";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canMoveToBacklog(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to move to backlog: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Move to backlog error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.moveToBacklog(file);
    new Notice(`Moved to Backlog: ${file.basename}`);
  }
}
