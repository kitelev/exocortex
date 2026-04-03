import { App, TFile } from "obsidian";
import {
  CommandVisibilityContext,
  canCreateProject,
  ProjectCreationService,
  type IFile,
} from "exocortex";
import type { LabelInputModalResult } from '@plugin/presentation/modals/LabelInputModal';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { BaseContextAssetCreationCommand } from "./base/BaseContextAssetCreationCommand";

export class CreateProjectCommand extends BaseContextAssetCreationCommand {
  readonly id = "create-project";
  readonly name = "Create project";

  constructor(
    app: App,
    private projectCreationService: ProjectCreationService,
    vaultAdapter: ObsidianVaultAdapter,
  ) {
    super(app, vaultAdapter);
  }

  protected canCreate(context: CommandVisibilityContext): boolean {
    return canCreateProject(context);
  }

  protected getAssetTypeName(): string {
    return "Project";
  }

  protected getErrorLogPrefix(): string {
    return "Create project error";
  }

  protected async createAsset(
    file: TFile,
    metadata: Record<string, unknown>,
    _context: CommandVisibilityContext,
    modalResult: LabelInputModalResult,
  ): Promise<IFile> {
    const instanceClass = metadata.exo__Instance_class;
    const sourceClass = Array.isArray(instanceClass) ? instanceClass[0] : instanceClass;

    return this.projectCreationService.createProject(
      file,
      metadata,
      sourceClass,
      modalResult.label as string,
    );
  }
}
