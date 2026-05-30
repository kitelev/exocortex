import type { App, TFile } from "obsidian";
import { ICommand } from "./ICommand";
import {
  FolderRepairService,
  LoggingService,
  needsFolderRepair,
  type INotificationService,
} from "exocortex";

export class RepairFolderCommand implements ICommand {
  id = "repair-folder";
  name = "Repair folder";

  constructor(
    private app: App,
    private folderRepairService: FolderRepairService,
    private notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile): boolean => {
    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter || {};

    if (!metadata?.exo__Asset_isDefinedBy) return false;

    const expectedFolder = this.folderRepairService.getExpectedFolderSync(
      file,
      metadata,
    );
    const currentFolder = file.parent?.path || "";
    if (!needsFolderRepair(currentFolder, expectedFolder)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, metadata);
        } catch (error) {
          this.notifier.error(`Failed to repair folder: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Repair folder error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile, metadata: Record<string, unknown>): Promise<void> {
    const expectedFolder = await this.folderRepairService.getExpectedFolder(file, metadata);

    if (!expectedFolder) {
      this.notifier.warn("No expected folder found");
      return;
    }

    const currentFolder = file.parent?.path || "";
    if (!needsFolderRepair(currentFolder, expectedFolder)) {
      this.notifier.info("Asset is already in correct folder");
      return;
    }

    await this.folderRepairService.repairFolder(file, expectedFolder);
    this.notifier.success(`Moved to ${expectedFolder}`);
  }
}
