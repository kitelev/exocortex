import { App, TFile, Notice, EventRef } from "obsidian";
import { ICommand } from "./ICommand";
import {
  CommandVisibilityContext,
  canCreateInstance,
  TaskCreationService,
  WikiLinkHelpers,
  AssetClass,
  DateFormatter,
  LoggingService,
} from "exocortex";
import { LabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';

export class CreateInstanceCommand implements ICommand {
  id = "create-instance";
  name = "Create instance";

  constructor(
    private app: App,
    private taskCreationService: TaskCreationService,
    private vaultAdapter: ObsidianVaultAdapter,
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

    const showTaskSize = sourceClass !== AssetClass.MEETING_PROTOTYPE;

    // Generate default label: prototype label + current date (Issue #2261)
    const baseLabel = String(metadata.exo__Asset_label || file.basename);
    const defaultLabel = `${baseLabel} ${DateFormatter.toDateString(new Date())}`;

    const result = await this.showModal(showTaskSize, defaultLabel);

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
   * Shows the label input modal for creating a new instance.
   * @param showTaskSize - Whether to show task size selector
   * @returns Promise resolving to the modal result
   */
  private showModal(showTaskSize: boolean, defaultLabel: string = ""): Promise<LabelInputModalResult> {
    return new Promise<LabelInputModalResult>((resolve) => {
      new LabelInputModal(this.app, resolve, defaultLabel, showTaskSize).open();
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
