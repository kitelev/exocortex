import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ActionButton, ButtonGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import { CommandVisibilityContext } from "exocortex";
import { TaskCreationService } from "exocortex";
import { ProjectCreationService } from "exocortex";
import { AreaCreationService } from "exocortex";
import { ClassCreationService } from "exocortex";
import { ConceptCreationService } from "exocortex";
import { TaskStatusService } from "exocortex";
import { PropertyCleanupService } from "exocortex";
import { FolderRepairService } from "exocortex";
import { RenameToUidService } from "exocortex";
import { EffortVotingService } from "exocortex";
import { LabelToAliasService } from "exocortex";
import { AssetConversionService } from "exocortex";
import { ObsidianApp, ExocortexPluginInterface, MetadataRecord } from '@plugin/types';

/**
 * Context passed to button group builders
 */
export interface ButtonBuilderContext {
  app: ObsidianApp;
  settings: ExocortexSettings;
  plugin: ExocortexPluginInterface;
  file: TFile;
  metadata: MetadataRecord;
  instanceClass: string | string[] | null;
  visibilityContext: CommandVisibilityContext;
  logger: ILogger;
  refresh: () => Promise<void>;
}

/**
 * Services container for button actions
 */
export interface ButtonBuilderServices {
  taskCreationService: TaskCreationService;
  projectCreationService: ProjectCreationService;
  areaCreationService: AreaCreationService;
  classCreationService: ClassCreationService;
  conceptCreationService: ConceptCreationService;
  taskStatusService: TaskStatusService;
  propertyCleanupService: PropertyCleanupService;
  folderRepairService: FolderRepairService;
  renameToUidService: RenameToUidService;
  effortVotingService: EffortVotingService;
  labelToAliasService: LabelToAliasService;
  assetConversionService: AssetConversionService;
}

/**
 * Interface for button group builders
 */
export interface IButtonGroupBuilder {
  build(context: ButtonBuilderContext): ActionButton[];
  getGroupId(): string;
  getGroupTitle(): string;
}

/**
 * Helper to create button group if it has visible buttons
 */
export function createButtonGroupIfVisible(
  builder: IButtonGroupBuilder,
  context: ButtonBuilderContext,
): ButtonGroup | null {
  const buttons = builder.build(context);
  if (buttons.some((btn) => btn.visible)) {
    return {
      id: builder.getGroupId(),
      title: builder.getGroupTitle(),
      buttons,
    };
  }
  return null;
}
