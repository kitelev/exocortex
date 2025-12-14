import { App, TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import { FolderRepairService, LoggingService } from "exocortex";

export class RepairFolderCommand implements ICommand {
  id = "repair-folder";
  name = "Repair folder";

  constructor(
    private app: App,
    private folderRepairService: FolderRepairService,
  ) {}

  checkCallback = (checking: boolean, file: TFile): boolean => {
    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter || {};

    if (!metadata?.exo__Asset_isDefinedBy) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, metadata);
        } catch (error) {
          new Notice(`Failed to repair folder: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Repair folder error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile, metadata: Record<string, unknown>): Promise<void> {
    const expectedFolder = await this.folderRepairService.getExpectedFolder(file, metadata);

    if (!expectedFolder) {
      new Notice("No expected folder found");
      return;
    }

    const currentFolder = file.parent?.path || "";
    if (currentFolder === expectedFolder) {
      new Notice("Asset is already in correct folder");
      return;
    }

    await this.folderRepairService.repairFolder(file, expectedFolder);
    new Notice(`Moved to ${expectedFolder}`);
  }
}
