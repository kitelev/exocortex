import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canMoveToToDo,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class MoveToToDoCommand implements ICommand {
  id = "move-to-todo";
  name = "Move to to-do";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canMoveToToDo(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to move to todo: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Move to todo error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.moveToToDo(file);
    new Notice(`Moved to ToDo: ${file.basename}`);
  }
}
