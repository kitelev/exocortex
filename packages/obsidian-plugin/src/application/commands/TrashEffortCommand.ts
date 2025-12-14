import { App, TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canTrashEffort,
  TaskStatusService,
  LoggingService,
} from "exocortex";
import {
  TrashReasonModal,
  type TrashReasonModalResult,
} from "@plugin/presentation/modals/TrashReasonModal";

export class TrashEffortCommand implements ICommand {
  id = "trash-effort";
  name = "Trash";

  constructor(
    private app: App,
    private taskStatusService: TaskStatusService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canTrashEffort(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to trash effort: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Trash effort error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    const result = await this.showModal();

    if (!result.confirmed) {
      return;
    }

    await this.taskStatusService.trashEffort(file, result.reason);
    new Notice(`Trashed: ${file.basename}`);
  }

  private showModal(): Promise<TrashReasonModalResult> {
    return new Promise<TrashReasonModalResult>((resolve) => {
      new TrashReasonModal(this.app, resolve).open();
    });
  }
}
