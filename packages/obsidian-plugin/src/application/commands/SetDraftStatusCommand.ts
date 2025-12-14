import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canSetDraftStatus,
  TaskStatusService,
  LoggingService,
} from "exocortex";

export class SetDraftStatusCommand implements ICommand {
  id = "set-draft-status";
  name = "Set draft status";

  constructor(private taskStatusService: TaskStatusService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canSetDraftStatus(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to set draft status: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Set draft status error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.taskStatusService.setDraftStatus(file);
    new Notice(`Set Draft status: ${file.basename}`);
  }
}
