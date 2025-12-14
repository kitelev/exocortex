import { App, TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCreateProject,
  ProjectCreationService,
  LoggingService,
} from "exocortex";
import { LabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';

export class CreateProjectCommand implements ICommand {
  id = "create-project";
  name = "Create project";

  constructor(
    private app: App,
    private projectCreationService: ProjectCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canCreateProject(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, context);
        } catch (error) {
          new Notice(`Failed to create project: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Create project error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile, _context: CommandVisibilityContext): Promise<void> {
    const result = await new Promise<LabelInputModalResult>((resolve) => {
      new LabelInputModal(this.app, resolve).open();
    });

    if (result.label === null) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter || {};
    const instanceClass = metadata.exo__Instance_class;

    const sourceClass = Array.isArray(instanceClass) ? instanceClass[0] : instanceClass;

    const createdFile = await this.projectCreationService.createProject(
      file,
      metadata,
      sourceClass,
      result.label,
    );

    const leaf = result.openInNewTab
      ? this.app.workspace.getLeaf("tab")
      : this.app.workspace.getLeaf(false);
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

    new Notice(`Project created: ${createdFile.basename}`);
  }
}
