import type { TFile } from "obsidian";
import type { App } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canTrashEffort,
  TaskStatusService,
  LoggingService,
  type INotificationService,
} from "exocortex";
import {
  showTrashReasonModal,
  type TrashReasonModalResult,
} from "@plugin/presentation/modals/modalSchemas";

export class TrashEffortCommand implements ICommand {
  id = "trash-effort";
  name = "Trash";

  constructor(
    private app: App,
    private taskStatusService: TaskStatusService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canTrashEffort(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to trash effort: ${error instanceof Error ? error.message : String(error)}`);
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
    this.notifier.success(`Trashed: ${file.basename}`);
  }

  private showModal(): Promise<TrashReasonModalResult> {
    return showTrashReasonModal(this.app);
  }
}
