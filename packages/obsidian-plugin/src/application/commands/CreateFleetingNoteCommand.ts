import { App, Notice } from "obsidian";
import {
  FleetingNoteCreationService,
  LoggingService,
} from "exocortex";
import { ICommand } from "./ICommand";
import { FleetingNoteModal, FleetingNoteModalResult } from '@plugin/presentation/modals/FleetingNoteModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { CommandHelpers } from "./helpers/CommandHelpers";

export class CreateFleetingNoteCommand implements ICommand {
  id = "create-fleeting-note";
  name = "Create fleeting note";

  constructor(
    private app: App,
    private fleetingNoteCreationService: FleetingNoteCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
  ) {}

  callback = async (): Promise<void> => {
    try {
      const result = await new Promise<FleetingNoteModalResult>((resolve) => {
        new FleetingNoteModal(this.app, resolve).open();
      });

      if (result.label === null) {
        return;
      }

      const createdFile = await this.fleetingNoteCreationService.createFleetingNote(
        result.label,
      );

      const tfile = this.vaultAdapter.toTFile(createdFile);
      await CommandHelpers.openFileInNewTab(this.app, tfile);

      new Notice(`Fleeting note created: ${createdFile.basename}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to create fleeting note: ${errorMessage}`);
      LoggingService.error("Create fleeting note error", error instanceof Error ? error : new Error(String(error)));
    }
  };
}
