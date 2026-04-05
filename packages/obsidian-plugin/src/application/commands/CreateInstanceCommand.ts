import { App, TFile } from "obsidian";
import {
  CommandVisibilityContext,
  canCreateInstance,
  WikiLinkHelpers,
  DateFormatter,
  GenericAssetCreationService,
  type InstantiationRule,
  type InstantiationRuleResolver,
  type IFile,
} from "exocortex";
import { showLabelInputModal, type LabelInputModalResult } from '@plugin/presentation/modals/modalSchemas';
import { ObsidianVaultAdapter } from '@plugin/adapters/ObsidianVaultAdapter';
import { BaseContextAssetCreationCommand } from "./base/BaseContextAssetCreationCommand";
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

export class CreateInstanceCommand extends BaseContextAssetCreationCommand {
  readonly id = "create-instance";
  readonly name = "Create instance";
  private readonly logger = LoggerFactory.create("CreateInstanceCommand");

  constructor(
    app: App,
    private readonly ruleResolver: InstantiationRuleResolver,
    private readonly genericAssetCreationService: GenericAssetCreationService,
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
    _context: CommandVisibilityContext,
    metadata: Record<string, unknown>,
  ): Promise<LabelInputModalResult> {
    const baseLabel = String(metadata.exo__Asset_label || file.basename);
    const defaultLabel = `${baseLabel} ${DateFormatter.toDateString(new Date())}`;

    return showLabelInputModal(this.app, defaultLabel, true);
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

    const rule = await this.ruleResolver.getRule(sourceClass);

    if (rule) {
      return this.createFromRule(file, metadata, sourceClass, modalResult, rule);
    }

    this.logger.warn(`No instantiation rule for ${sourceClass}, using generic fallback`);
    return this.createFallback(file, metadata, sourceClass, modalResult);
  }

  private async createFromRule(
    file: TFile,
    metadata: Record<string, unknown>,
    sourceClass: string,
    modalResult: LabelInputModalResult,
    rule: InstantiationRule,
  ): Promise<IFile> {
    const propertyValues: Record<string, unknown> = {};

    if (rule.prototypeUID) {
      propertyValues["exo__Asset_prototype"] = `"[[${rule.prototypeUID}]]"`;
    }

    if (modalResult.taskSize) {
      propertyValues["ems__Effort_taskSize"] = modalResult.taskSize;
    }

    for (const psr of rule.propertySetRules) {
      if (psr.valueType === "wikilink") {
        propertyValues[psr.property] = `"[[${psr.value}]]"`;
      } else {
        propertyValues[psr.property] = psr.value;
      }
    }

    const folderPath = rule.defaultFolder || file.parent?.path || "";

    return this.genericAssetCreationService.createAsset({
      className: sourceClass,
      label: modalResult.label || undefined,
      folderPath,
      propertyValues,
      parentFile: this.toIFile(file),
      parentMetadata: metadata,
    });
  }

  private async createFallback(
    file: TFile,
    metadata: Record<string, unknown>,
    sourceClass: string,
    modalResult: LabelInputModalResult,
  ): Promise<IFile> {
    const propertyValues: Record<string, unknown> = {};

    if (modalResult.taskSize) {
      propertyValues["ems__Effort_taskSize"] = modalResult.taskSize;
    }

    const folderPath = file.parent?.path || "";

    return this.genericAssetCreationService.createAsset({
      className: sourceClass,
      label: modalResult.label || undefined,
      folderPath,
      propertyValues,
      parentFile: this.toIFile(file),
      parentMetadata: metadata,
    });
  }

  private toIFile(tfile: TFile): IFile {
    return {
      path: tfile.path,
      basename: tfile.basename,
      name: tfile.name,
      parent: tfile.parent ? { path: tfile.parent.path, name: tfile.parent.name } : null,
    } as IFile;
  }
}
