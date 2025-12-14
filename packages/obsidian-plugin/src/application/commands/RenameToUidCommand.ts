import { TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canRenameToUid,
  RenameToUidService,
  LoggingService,
} from "exocortex";

export class RenameToUidCommand implements ICommand {
  id = "rename-to-uid";
  name = "Rename to uid";

  constructor(private renameToUidService: RenameToUidService) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canRenameToUid(context, file.basename)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, context.metadata);
        } catch (error) {
          new Notice(`Failed to rename: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Rename to UID error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile, metadata: Record<string, unknown>): Promise<void> {
    const oldName = file.basename;
    const uid = String(metadata.exo__Asset_uid);

    await this.renameToUidService.renameToUid(file, metadata);

    new Notice(`Renamed "${oldName}" to "${uid}"`);
  }
}
