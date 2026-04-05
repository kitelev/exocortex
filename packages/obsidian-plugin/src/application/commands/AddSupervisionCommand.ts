import { App, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import { SupervisionCreationService, LoggingService } from "exocortex";
import { showSupervisionModal } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { CommandHelpers } from "./helpers/CommandHelpers";

export class AddSupervisionCommand implements ICommand {
  id = "add-supervision";
  name = "Add supervision";

  constructor(
    private app: App,
    private supervisionCreationService: SupervisionCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
  ) {}

  callback = async (): Promise<void> => {
    try {
      const formData = await showSupervisionModal(this.app);

      if (formData === null) {
        return;
      }

      const createdFile = await this.supervisionCreationService.createSupervision(formData);

      const tfile = this.vaultAdapter.toTFile(createdFile);
      await CommandHelpers.openFileInNewTab(this.app, tfile);

      new Notice(`Supervision created: ${createdFile.basename}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to create supervision: ${errorMessage}`);
      LoggingService.error("Add supervision error", error instanceof Error ? error : new Error(String(error)));
    }
  };
}
