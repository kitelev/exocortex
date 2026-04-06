import type { App, TFile } from "obsidian";
import {
  CommandVisibilityContext,
  canCreateChildArea,
  AreaCreationService,
  type IFile,
  type INotificationService,
} from "exocortex";
import type { LabelInputModalResult } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { BaseContextAssetCreationCommand } from "./base/BaseContextAssetCreationCommand";

export class CreateAreaCommand extends BaseContextAssetCreationCommand {
  readonly id = "create-area";
  readonly name = "Create area";

  constructor(
    app: App,
    private areaCreationService: AreaCreationService,
    vaultAdapter: ObsidianVaultAdapter,
    notifier: INotificationService,
  ) {
    super(app, vaultAdapter, notifier);
  }

  protected canCreate(context: CommandVisibilityContext): boolean {
    return canCreateChildArea(context);
  }

  protected getAssetTypeName(): string {
    return "Area";
  }

  protected getErrorLogPrefix(): string {
    return "Create area error";
  }

  protected async createAsset(
    file: TFile,
    metadata: Record<string, unknown>,
    _context: CommandVisibilityContext,
    modalResult: LabelInputModalResult,
  ): Promise<IFile> {
    return this.areaCreationService.createChildArea(
      file,
      metadata,
      modalResult.label as string,
    );
  }
}
