import { App, TFile, Notice } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCreateTask,
  TaskCreationService,
  WikiLinkHelpers,
  LoggingService,
} from "exocortex";
import { LabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { DynamicAssetCreationModal, type DynamicAssetCreationResult } from '@plugin/presentation/modals/DynamicAssetCreationModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { ExocortexPluginInterface } from '@plugin/types';
import type { OntologySchemaService } from '@plugin/application/services/OntologySchemaService';

export class CreateTaskCommand implements ICommand {
  id = "create-task";
  name = "Create task";

  constructor(
    private app: App,
    private taskCreationService: TaskCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
    private plugin: ExocortexPluginInterface,
    private schemaService?: OntologySchemaService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canCreateTask(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, context);
        } catch (error) {
          new Notice(`Failed to create task: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Create task error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile, context: CommandVisibilityContext): Promise<void> {
    const useDynamicFields = this.plugin.settings.useDynamicPropertyFields ?? false;

    const result = await this.showModal(useDynamicFields);

    if (result.label === null) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter || {};

    const instanceClass = context.instanceClass;
    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
    const firstClass = classes[0] || "";
    const sourceClass = WikiLinkHelpers.normalize(firstClass);

    const createdFile = await this.taskCreationService.createTask(
      file,
      metadata,
      sourceClass,
      result.label,
      result.taskSize,
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

    new Notice(`Task created: ${createdFile.basename}`);
  }

  /**
   * Shows the appropriate modal based on the useDynamicPropertyFields setting.
   * @param useDynamicFields - If true, shows DynamicAssetCreationModal; otherwise LabelInputModal
   * @returns Promise resolving to the modal result
   */
  private showModal(useDynamicFields: boolean): Promise<LabelInputModalResult> {
    if (useDynamicFields) {
      return new Promise<DynamicAssetCreationResult>((resolve) => {
        new DynamicAssetCreationModal(
          this.app,
          "ems__Task",
          resolve,
          this.schemaService,
        ).open();
      });
    }

    return new Promise<LabelInputModalResult>((resolve) => {
      new LabelInputModal(this.app, resolve).open();
    });
  }
}
