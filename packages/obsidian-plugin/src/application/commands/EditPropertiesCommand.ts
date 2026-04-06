import type { App, TFile } from "obsidian";
import { ICommand } from "./ICommand";
import { ExocortexPluginInterface } from '@plugin/types';
import { PropertyEditorModal } from '@plugin/presentation/modals/PropertyEditorModal';
import type { CommandVisibilityContext, INotificationService } from "exocortex";

export class EditPropertiesCommand implements ICommand {
  id = "edit-properties";
  name = "edit properties";

  constructor(
    private app: App,
    private plugin: ExocortexPluginInterface,
    private notifier: INotificationService,
  ) {}

  checkCallback = (
    checking: boolean,
    file: TFile,
    _context: CommandVisibilityContext | null,
  ): boolean | void => {
    const cache = this.app.metadataCache.getFileCache(file);
    const hasFrontmatter = cache?.frontmatter !== undefined;

    if (checking) {
      return hasFrontmatter;
    }

    if (hasFrontmatter && cache?.frontmatter) {
      const modal = new PropertyEditorModal(
        this.app,
        this.plugin,
        file,
        cache.frontmatter as Record<string, unknown>,
      );
      modal.open();
    } else {
      this.notifier.info("This file has no frontmatter properties to edit");
    }
  };
}
