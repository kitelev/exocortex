import { App, TFile } from "obsidian";
import {
  CommandVisibilityContext,
  canCreateTask,
  TaskCreationService,
  WikiLinkHelpers,
  type IFile,
} from "exocortex";
import type { LabelInputModalResult } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { BaseContextAssetCreationCommand } from "./base/BaseContextAssetCreationCommand";

export class CreateTaskCommand extends BaseContextAssetCreationCommand {
  readonly id = "create-task";
  readonly name = "Create task";

  constructor(
    app: App,
    private taskCreationService: TaskCreationService,
    vaultAdapter: ObsidianVaultAdapter,
  ) {
    super(app, vaultAdapter);
  }

  protected canCreate(context: CommandVisibilityContext): boolean {
    return canCreateTask(context);
  }

  protected getAssetTypeName(): string {
    return "Task";
  }

  protected getErrorLogPrefix(): string {
    return "Create task error";
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
