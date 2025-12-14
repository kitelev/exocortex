import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canConvertProjectToTask,
  AssetConversionService,
  LoggingService,
} from "exocortex";

export class ConvertProjectToTaskCommand implements ICommand {
  id = "convert-project-to-task";
  name = "Convert Project to Task";

  constructor(
    private conversionService: AssetConversionService,
  ) {}

  checkCallback = (
    checking: boolean,
    file: TFile,
    context: CommandVisibilityContext | null,
  ): boolean => {
    if (!context || !canConvertProjectToTask(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file);
        } catch (error) {
          new Notice(`Failed to convert Project to Task: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Convert Project to Task error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile): Promise<void> {
    await this.conversionService.convertProjectToTask(file);
    new Notice(`Converted to Task: ${file.basename}`);
  }
}
