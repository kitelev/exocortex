import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canShiftDayForward,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class ShiftDayForwardCommand implements ICommand {
  id = "shift-day-forward";
  name = "Shift day forward";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canShiftDayForward(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to shift day forward: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Shift day forward error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.shiftDayForward(file);
    new Notice(`Day shifted forward: ${file.basename}`);
  }
}
