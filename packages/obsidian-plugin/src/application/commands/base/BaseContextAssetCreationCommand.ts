import type { App, TFile } from "obsidian";
import { ICommand } from "../ICommand";
import {
  CommandVisibilityContext,
  LoggingService,
  type IFile,
  type INotificationService,
} from "exocortex";
import { showLabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { CommandHelpers } from "../helpers/CommandHelpers";

export abstract class BaseContextAssetCreationCommand implements ICommand {
  abstract readonly id: string;
  abstract readonly name: string;

  constructor(
    protected readonly app: App,
    protected readonly vaultAdapter: ObsidianVaultAdapter,
    protected readonly notifier: INotificationService,
  ) {}

  checkCallback = (checking: boolean, file: TFile, context: CommandVisibilityContext | null): boolean => {
    if (!context || !this.canCreate(context)) return false;

    if (!checking) {
      void (async () => {
        try {
          await this.execute(file, context);
        } catch (error) {
          this.notifier.error(`Failed to create ${this.getAssetTypeName().toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`);
          LoggingService.error(this.getErrorLogPrefix(), error instanceof Error ? error : undefined);
        }
      })();
    }

    return true;
  };

  protected abstract canCreate(context: CommandVisibilityContext): boolean;

  protected abstract getAssetTypeName(): string;

  protected abstract getErrorLogPrefix(): string;

  protected abstract createAsset(
    file: TFile,
    metadata: Record<string, unknown>,
    context: CommandVisibilityContext,
    modalResult: LabelInputModalResult,
  ): Promise<IFile>;

  protected showModal(
    _file: TFile,
    _context: CommandVisibilityContext,
    _metadata: Record<string, unknown>,
  ): Promise<LabelInputModalResult> {
    return showLabelInputModal(this.app);
  }

  private async execute(file: TFile, context: CommandVisibilityContext): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const metadata = (cache?.frontmatter || {}) as Record<string, unknown>;

    const result = await this.showModal(file, context, metadata);

    if (result.label === null) {
      return;
    }

    const createdFile = await this.createAsset(file, metadata, context, result);

    const leaf = result.openInNewTab
      ? this.app.workspace.getLeaf("tab")
      : this.app.workspace.getLeaf(false);
    const tfile = this.vaultAdapter.toTFile(createdFile);
    if (!tfile) {
      throw new Error(`Failed to convert created file to TFile: ${createdFile.path}`);
    }
    await leaf.openFile(tfile);

    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    await CommandHelpers.waitForFileActivation(this.app, tfile.path);

    this.notifier.success(`${this.getAssetTypeName()} created: ${createdFile.basename}`);
  }
}
