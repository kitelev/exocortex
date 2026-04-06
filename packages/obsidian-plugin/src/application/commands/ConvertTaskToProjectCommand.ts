import type { TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canConvertTaskToProject,
  AssetConversionService,
  LoggingService,
  type INotificationService,
} from "exocortex";

export class ConvertTaskToProjectCommand implements ICommand {
  id = "convert-task-to-project";
  name = "Convert Task to Project";

  constructor(
    private conversionService: AssetConversionService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (
    checking: boolean,
    file: TFile,
    context: CommandVisibilityContext | null,
  ): boolean => {
    if (!context || !canConvertTaskToProject(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          this.notifier.error(`Failed to convert Task to Project: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Convert Task to Project error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.conversionService.convertTaskToProject(file);
    this.notifier.success(`Converted to Project: ${file.basename}`);
  }
}
