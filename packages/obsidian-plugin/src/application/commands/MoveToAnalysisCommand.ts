import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canMoveToAnalysis,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class MoveToAnalysisCommand implements ICommand {
  id = "move-to-analysis";
  name = "Move to analysis";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canMoveToAnalysis(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to move to analysis: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Move to analysis error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.moveToAnalysis(file);
    new Notice(`Moved to Analysis: ${file.basename}`);
  }
}
