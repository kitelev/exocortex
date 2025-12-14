import { App, TFile, Notice, EventRef } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCreateInstance,
  TaskCreationService,
  WikiLinkHelpers,
  AssetClass,
  LoggingService,
} from "exocortex";
import { LabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { DynamicAssetCreationModal, type DynamicAssetCreationResult } from '@plugin/presentation/modals/DynamicAssetCreationModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { ExocortexPluginInterface } from '@plugin/types';
import type { OntologySchemaService } from '@plugin/application/services/OntologySchemaService';

export class CreateInstanceCommand implements ICommand {
  id = "create-instance";
  name = "Create instance";

  constructor(
    private app: App,
    private taskCreationService: TaskCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
    private plugin: ExocortexPluginInterface,
    private schemaService?: OntologySchemaService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !canCreateInstance(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, context);
        } catch (error) {
          new Notice(`Failed to create instance: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error("Create instance error", error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  private async execute(file: TFile, context: CommandVisibilityContext): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = cache?.frontmatter || {};

    const instanceClass = context.instanceClass;
    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
    const firstClass = classes[0] || "";
    const sourceClass = WikiLinkHelpers.normalize(firstClass);

    const useDynamicFields = this.plugin.settings.useDynamicPropertyFields ?? false;
    const showTaskSize = sourceClass !== AssetClass.MEETING_PROTOTYPE;

    const result = await this.showModal(useDynamicFields, sourceClass, showTaskSize);

    if (result.label === null) {
      return;
    }

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
    if (!tfile) {
      throw new Error(`Failed to convert created file to TFile: ${createdFile.path}`);
    }
    await leaf.openFile(tfile);

    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    await this.waitForFileActive(tfile.path);

    new Notice(`Instance created: ${createdFile.basename}`);
  }

  /**
   * Shows the appropriate modal based on the useDynamicPropertyFields setting.
   * @param useDynamicFields - If true, shows DynamicAssetCreationModal; otherwise LabelInputModal
   * @param className - The class name for dynamic modal (e.g., 'ems__Task', 'ems__Effort')
   * @param showTaskSize - Whether to show task size in LabelInputModal (fallback)
   * @returns Promise resolving to the modal result
   */
  private showModal(
    useDynamicFields: boolean,
    className: string,
    showTaskSize: boolean,
  ): Promise<LabelInputModalResult> {
    if (useDynamicFields) {
      return new Promise<DynamicAssetCreationResult>((resolve) => {
        new DynamicAssetCreationModal(
          this.app,
          className,
          resolve,
          this.schemaService,
        ).open();
      });
    }

    return new Promise<LabelInputModalResult>((resolve) => {
      new LabelInputModal(this.app, resolve, "", showTaskSize).open();
    });
  }

  /**
   * Waits for a file to become active using event listeners instead of polling.
   * Uses file-open event for efficient, non-blocking detection.
   * @param targetPath - Path of the file to wait for
   * @param timeoutMs - Maximum time to wait (default: 2000ms to match original behavior)
   */
  private waitForFileActive(targetPath: string, timeoutMs: number = 2000): Promise<void> {
    return new Promise((resolve) => {
      // Check immediately if file is already active
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile?.path === targetPath) {
        resolve();
        return;
      }

      let eventRef: EventRef | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (): void => {
        if (eventRef) {
          this.app.workspace.offref(eventRef);
          eventRef = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      // Set up timeout - resolves anyway to not block indefinitely
      // This matches the original behavior where the loop would eventually finish
      timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);

      // Listen for file-open event
      eventRef = this.app.workspace.on("file-open", (file) => {
        if (file?.path === targetPath) {
          cleanup();
          resolve();
        }
      });
    });
  }
}
