import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCopyLabelToAliases,
  LabelToAliasService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class CopyLabelToAliasesCommand implements ICommand {
  id = "copy-label-to-aliases";
  name = "Copy label to aliases";

  constructor(
    private labelToAliasService: LabelToAliasService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canCopyLabelToAliases(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to copy label: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Copy label to aliases error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.labelToAliasService.copyLabelToAliases(file);
    this.notifier.success("Label copied to aliases");
  }
}
