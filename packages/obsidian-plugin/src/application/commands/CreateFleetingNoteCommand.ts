import type { App } from "obsidian";
import {
  FleetingNoteCreationService,
  LoggingService,
  type INotificationService,
} from "exocortex";
import { ICommand } from "./ICommand";
import { showFleetingNoteModal } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { CommandHelpers } from "./helpers/CommandHelpers";

export class CreateFleetingNoteCommand implements ICommand {
  id = "create-fleeting-note";
  name = "Create fleeting note";

  constructor(
    private app: App,
    private fleetingNoteCreationService: FleetingNoteCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
    private notifier: INotificationService,
  ) {}

  callback = async (): Promise<void> => {
    try {
      const result = await showFleetingNoteModal(this.app);

      if (result.label === null) {
        return;
      }

      const createdFile = await this.fleetingNoteCreationService.createFleetingNote(
        result.label,
      );

      const tfile = this.vaultAdapter.toTFile(createdFile);
      await CommandHelpers.openFileInNewTab(this.app, tfile);

      this.notifier.success(`Fleeting note created: ${createdFile.basename}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.notifier.error(`Failed to create fleeting note: ${errorMessage}`);
      LoggingService.error("Create fleeting note error", error instanceof Error ? error : new Error(String(error)));
    }
  };
}
