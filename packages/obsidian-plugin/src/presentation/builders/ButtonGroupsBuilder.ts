import { TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ButtonGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  CommandVisibilityContext,
  WikiLinkHelpers,
  MetadataExtractor,
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
  FolderRepairService,
  INotificationService,
} from "exocortex";
import {
  ButtonBuilderContext,
  IButtonGroupBuilder,
  createButtonGroupIfVisible,
  DynamicCommandButtonGroupBuilder,
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
  /** Resolver for dynamic commands from vault assets */
  commandResolver?: CommandResolver;
  /** Evaluator for command preconditions */
  preconditionEvaluator?: PreconditionEvaluator;
  /** Executor for grounding actions */
  groundingExecutor?: GroundingExecutor;
  /** Service for repairing folder locations (used for visibility context) */
  folderRepairService: FolderRepairService;
  /** Extractor for file metadata */
  metadataExtractor: MetadataExtractor;
  /** Logger instance */
  logger: ILogger;
  /** Callback to refresh the view */
  refresh: () => Promise<void>;
  /** Notification service for user feedback */
  notificationService?: INotificationService;
}

/**
 * Orchestrator for building button groups.
 *
 * All button groups are now served from vault command assets
 * via the universal DynamicCommandButtonGroupBuilder (RFC-009).
 */
export class ButtonGroupsBuilder {
  private app: ObsidianApp;
  private settings: ExocortexSettings;
  private plugin: ExocortexPluginInterface;
  private folderRepairService: FolderRepairService;
  private metadataExtractor: MetadataExtractor;
  private logger: ILogger;
  private refresh: () => Promise<void>;
  private builders: IButtonGroupBuilder[];

  constructor(config: ButtonGroupsBuilderConfig) {
    const {
      app,
      settings,
      plugin,
      commandResolver,
      preconditionEvaluator,
      groundingExecutor,
      folderRepairService,
      metadataExtractor,
      logger,
      refresh,
      notificationService,
    } = config;

    this.app = app;
    this.settings = settings;
    this.plugin = plugin;
    this.folderRepairService = folderRepairService;
    this.metadataExtractor = metadataExtractor;
    this.logger = logger;
    this.refresh = refresh;

    this.builders = [];

    if (commandResolver && preconditionEvaluator && groundingExecutor && notificationService) {
      this.builders.push(
        new DynamicCommandButtonGroupBuilder({
          commandResolver,
          preconditionEvaluator,
          groundingExecutor,
          notificationService,
        }),
      );
    }
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
    const expectedFolder = await this.folderRepairService.getExpectedFolder(
      file,
      metadata,
    );

    // Resolve whether the asset's class is a prototype (Issue #2261)
    // This handles UUID-based instanceClass refs like [[64e14e5e-...|ztlk__FleetingNotePrototype]]
    const classIsPrototype = this.resolveClassIsPrototype(instanceClass);

    const visibilityContext: CommandVisibilityContext = {
      instanceClass,
      currentStatus,
      metadata,
      isArchived,
      currentFolder,
      expectedFolder,
      classIsPrototype,
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
      const group = await createButtonGroupIfVisible(builder, context);
      if (group) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Check if any of the asset's instance classes is a prototype.
   * Resolves UUID-based class references by looking up the class file's metadata.
   */
  private resolveClassIsPrototype(instanceClass: string | string[] | null): boolean {
    if (!instanceClass) return false;
    if (!this.app.metadataCache?.getFirstLinkpathDest) return false;

    const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

    for (const cls of classes) {
      const normalized = WikiLinkHelpers.normalize(cls);
      if (!normalized) continue;

      // Try to resolve the class file
      const classFile = this.app.metadataCache.getFirstLinkpathDest(normalized, "");
      if (!classFile) continue;

      const classCache = this.app.metadataCache.getFileCache(classFile);
      const classMeta = classCache?.frontmatter;
      if (!classMeta) continue;

      // Check if the class file has exo__Prototype in its instanceClass
      const classInstanceClass = classMeta.exo__Instance_class;
      if (!classInstanceClass) continue;

      const classClasses = Array.isArray(classInstanceClass) ? classInstanceClass : [classInstanceClass];
      for (const cc of classClasses) {
        const normalizedCC = WikiLinkHelpers.normalize(cc);
        if (normalizedCC === "exo__Prototype" || normalizedCC === "ebf717aa-4070-4b37-abde-10a700e354fc") {
          return true;
        }
      }
    }

    return false;
  }

}
