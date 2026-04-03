import { App, TFile } from "obsidian";
import {
  CommandVisibilityContext,
  canCreateRelatedTask,
  TaskCreationService,
  type IFile,
} from "exocortex";
import type { LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { BaseContextAssetCreationCommand } from "./base/BaseContextAssetCreationCommand";

export class CreateRelatedTaskCommand extends BaseContextAssetCreationCommand {
  readonly id = "create-related-task";
  readonly name = "Create related task";

  constructor(
    app: App,
    private taskCreationService: TaskCreationService,
    vaultAdapter: ObsidianVaultAdapter,
  ) {
    super(app, vaultAdapter);
  }

  protected canCreate(context: CommandVisibilityContext): boolean {
    return canCreateRelatedTask(context);
  }

  protected getAssetTypeName(): string {
    return "Related task";
  }

  protected getErrorLogPrefix(): string {
    return "Create related task error";
  }

  protected async createAsset(
    file: TFile,
    metadata: Record<string, unknown>,
    _context: CommandVisibilityContext,
    modalResult: LabelInputModalResult,
  ): Promise<IFile> {
    return this.taskCreationService.createRelatedTask(
      file,
      metadata,
      modalResult.label as string,
      modalResult.taskSize,
    );
  }
}
