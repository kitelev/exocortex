import { App, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import { SupervisionCreationService, LoggingService } from "exocortex";
import { SupervisionInputModal, SupervisionFormData } from '@plugin/presentation/modals/SupervisionInputModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';

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
      const formData = await new Promise<SupervisionFormData | null>((resolve) => {
        new SupervisionInputModal(this.app, resolve).open();
      });

      if (formData === null) {
        return;
      }

      const createdFile = await this.supervisionCreationService.createSupervision(formData);

      const leaf = this.app.workspace.getLeaf("tab");
      const tfile = this.vaultAdapter.toTFile(createdFile);
      await leaf.openFile(tfile);

      this.app.workspace.setActiveLeaf(leaf, { focus: true });

      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        if (this.app.workspace.getActiveFile()?.path === tfile.path) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      new Notice(`Supervision created: ${createdFile.basename}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to create supervision: ${errorMessage}`);
      LoggingService.error("Add supervision error", error instanceof Error ? error : new Error(String(error)));
    }
  };
}
