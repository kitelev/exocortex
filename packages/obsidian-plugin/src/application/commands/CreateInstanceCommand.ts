import { App, TFile } from "obsidian";
import {
  CommandVisibilityContext,
  canCreateInstance,
  TaskCreationService,
  WikiLinkHelpers,
  AssetClass,
  DateFormatter,
  type IFile,
} from "exocortex";
import { LabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { BaseContextAssetCreationCommand } from "./base/BaseContextAssetCreationCommand";

export class CreateInstanceCommand extends BaseContextAssetCreationCommand {
  readonly id = "create-instance";
  readonly name = "Create instance";

  constructor(
    app: App,
    private taskCreationService: TaskCreationService,
    vaultAdapter: ObsidianVaultAdapter,
  ) {
    super(app, vaultAdapter);
  }

  protected canCreate(context: CommandVisibilityContext): boolean {
    return canCreateInstance(context);
  }

  protected getAssetTypeName(): string {
    return "Instance";
  }

  protected getErrorLogPrefix(): string {
    return "Create instance error";
  }

  protected override showModal(
    file: TFile,
    context: CommandVisibilityContext,
    metadata: Record<string, unknown>,
  ): Promise<LabelInputModalResult> {
    const instanceClass = context.instanceClass;
    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
    const firstClass = classes[0] || "";
    const sourceClass = WikiLinkHelpers.normalize(firstClass);

    const showTaskSize = sourceClass !== AssetClass.MEETING_PROTOTYPE;

    const baseLabel = String(metadata.exo__Asset_label || file.basename);
    const defaultLabel = `${baseLabel} ${DateFormatter.toDateString(new Date())}`;

    return new Promise<LabelInputModalResult>((resolve) => {
      new LabelInputModal(this.app, resolve, defaultLabel, showTaskSize).open();
    });
  }

  protected async createAsset(
    file: TFile,
    metadata: Record<string, unknown>,
    context: CommandVisibilityContext,
    modalResult: LabelInputModalResult,
  ): Promise<IFile> {
    const instanceClass = context.instanceClass;
    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];
    const firstClass = classes[0] || "";
    const sourceClass = WikiLinkHelpers.normalize(firstClass);

    return this.taskCreationService.createTask(
      file,
      metadata,
      sourceClass,
      modalResult.label as string,
      modalResult.taskSize,
    );
  }
}
