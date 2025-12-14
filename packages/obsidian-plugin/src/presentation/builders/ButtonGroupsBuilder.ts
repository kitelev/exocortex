import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ButtonGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  CommandVisibilityContext,
  TaskCreationService,
  ProjectCreationService,
  AreaCreationService,
  ClassCreationService,
  ConceptCreationService,
  TaskStatusService,
  PropertyCleanupService,
  FolderRepairService,
  RenameToUidService,
  EffortVotingService,
  LabelToAliasService,
  AssetConversionService,
  MetadataExtractor,
} from "exocortex";
import {
  ButtonBuilderContext,
  ButtonBuilderServices,
  IButtonGroupBuilder,
  createButtonGroupIfVisible,
  CreationButtonGroupBuilder,
  StatusButtonGroupBuilder,
  PlanningButtonGroupBuilder,
  MaintenanceButtonGroupBuilder,
} from "./button-groups";
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';

/**
 * Configuration object for ButtonGroupsBuilder.
 * Groups related parameters together for better readability and maintainability.
 */
export interface ButtonGroupsBuilderConfig {
  /** Obsidian app instance */
  app: ObsidianApp;
  /** Plugin settings */
  settings: ExocortexSettings;
  /** Plugin instance for save operations */
  plugin: ExocortexPluginInterface;
  /** Service for creating tasks */
  taskCreationService: TaskCreationService;
  /** Service for creating projects */
  projectCreationService: ProjectCreationService;
  /** Service for creating areas */
  areaCreationService: AreaCreationService;
  /** Service for creating classes */
  classCreationService: ClassCreationService;
  /** Service for creating concepts */
  conceptCreationService: ConceptCreationService;
  /** Service for task status operations */
  taskStatusService: TaskStatusService;
  /** Service for cleaning up properties */
  propertyCleanupService: PropertyCleanupService;
  /** Service for repairing folder locations */
  folderRepairService: FolderRepairService;
  /** Service for renaming files to UID */
  renameToUidService: RenameToUidService;
  /** Service for voting on efforts */
  effortVotingService: EffortVotingService;
  /** Service for copying label to aliases */
  labelToAliasService: LabelToAliasService;
  /** Service for converting between task and project */
  assetConversionService: AssetConversionService;
  /** Extractor for file metadata */
  metadataExtractor: MetadataExtractor;
  /** Logger instance */
  logger: ILogger;
  /** Callback to refresh the view */
  refresh: () => Promise<void>;
}

/**
 * Orchestrator for building button groups.
 *
 * Delegates to specialized button group builders:
 * - CreationButtonGroupBuilder: Create Task, Create Project, etc.
 * - StatusButtonGroupBuilder: Set Draft, Move to Backlog, etc.
 * - PlanningButtonGroupBuilder: Plan on Today, Vote, etc.
 * - MaintenanceButtonGroupBuilder: Trash, Archive, Clean Properties, etc.
 */
export class ButtonGroupsBuilder {
  private app: ObsidianApp;
  private settings: ExocortexSettings;
  private plugin: ExocortexPluginInterface;
  private metadataExtractor: MetadataExtractor;
  private logger: ILogger;
  private refresh: () => Promise<void>;
  private services: ButtonBuilderServices;
  private builders: IButtonGroupBuilder[];

  constructor(config: ButtonGroupsBuilderConfig) {
    const {
      app,
      settings,
      plugin,
      taskCreationService,
      projectCreationService,
      areaCreationService,
      classCreationService,
      conceptCreationService,
      taskStatusService,
      propertyCleanupService,
      folderRepairService,
      renameToUidService,
      effortVotingService,
      labelToAliasService,
      assetConversionService,
      metadataExtractor,
      logger,
      refresh,
    } = config;

    this.app = app;
    this.settings = settings;
    this.plugin = plugin;
    this.metadataExtractor = metadataExtractor;
    this.logger = logger;
    this.refresh = refresh;

    // Aggregate services for button builders
    this.services = {
      taskCreationService,
      projectCreationService,
      areaCreationService,
      classCreationService,
      conceptCreationService,
      taskStatusService,
      propertyCleanupService,
      folderRepairService,
      renameToUidService,
      effortVotingService,
      labelToAliasService,
      assetConversionService,
    };

    // Initialize specialized builders
    this.builders = [
      new CreationButtonGroupBuilder(this.services),
      new StatusButtonGroupBuilder(this.services),
      new PlanningButtonGroupBuilder(this.services),
      new MaintenanceButtonGroupBuilder(this.services),
    ];
  }

  /**
   * Build all button groups for the given file.
   *
   * @param file - The file to build buttons for
   * @returns Array of button groups with visible buttons
   */
  public async build(file: TFile): Promise<ButtonGroup[]> {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const instanceClass = this.metadataExtractor.extractInstanceClass(metadata);
    const currentStatus = this.metadataExtractor.extractStatus(metadata);
    const isArchived = this.metadataExtractor.extractIsArchived(metadata);
    const currentFolder = file.parent?.path || "";
    const expectedFolder = await this.services.folderRepairService.getExpectedFolder(
      file,
      metadata,
    );

    const visibilityContext: CommandVisibilityContext = {
      instanceClass,
      currentStatus,
      metadata,
      isArchived,
      currentFolder,
      expectedFolder,
    };

    const context: ButtonBuilderContext = {
      app: this.app,
      settings: this.settings,
      plugin: this.plugin,
      file,
      metadata,
      instanceClass,
      visibilityContext,
      logger: this.logger,
      refresh: this.refresh,
    };

    // Build groups from all builders, filtering out empty ones
    const groups: ButtonGroup[] = [];
    for (const builder of this.builders) {
      const group = createButtonGroupIfVisible(builder, context);
      if (group) {
        groups.push(group);
      }
    }

    return groups;
  }
}
