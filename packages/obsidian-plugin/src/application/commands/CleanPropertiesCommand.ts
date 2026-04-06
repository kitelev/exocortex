import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCleanProperties,
  PropertyCleanupService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class CleanPropertiesCommand implements ICommand {
  id = "clean-properties";
  name = "Clean empty properties";

  constructor(
    private propertyCleanupService: PropertyCleanupService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canCleanProperties(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to clean properties: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Clean properties error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.propertyCleanupService.cleanEmptyProperties(file);
    this.notifier.success(`Cleaned empty properties: ${file.basename}`);
  }
}
