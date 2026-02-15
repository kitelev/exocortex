import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canMarkReviewed,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class MarkReviewedCommand implements ICommand {
  id = "mark-reviewed";
  name = "Mark as reviewed";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canMarkReviewed(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to mark as reviewed: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Mark reviewed error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.markAsReviewed(file);
    new Notice(`Marked as reviewed: ${file.basename}`);
  }
}
