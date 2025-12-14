import { MarkdownPostProcessorContext, TFile } from "obsidian";
import { container } from "tsyringe";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ActionButtonsGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import { TaskCreationService, IVaultAdapter, MetadataExtractor } from "exocortex";
import { ProjectCreationService, AreaCreationService, ClassCreationService } from "exocortex";
import { ConceptCreationService, TaskStatusService, PropertyCleanupService } from "exocortex";
import { FolderRepairService, RenameToUidService, EffortVotingService } from "exocortex";
import { LabelToAliasService, AssetConversionService } from "exocortex";
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { EventListenerManager } from '@plugin/adapters/events/EventListenerManager';
import { ButtonGroupsBuilder } from '@plugin/presentation/builders/ButtonGroupsBuilder';
import { DailyTasksRenderer } from "./DailyTasksRenderer";
import { DailyProjectsRenderer } from "./DailyProjectsRenderer";
import { PropertiesRenderer } from "./layout/PropertiesRenderer";
import { AreaTreeRenderer } from "./layout/AreaTreeRenderer";
import { RelationsRenderer, UniversalLayoutConfig } from "./layout/RelationsRenderer";
import { AssetMetadataService } from "./layout/helpers/AssetMetadataService";
import { PropertyDependencyResolver } from '@plugin/application/services/PropertyDependencyResolver';
import { FrontmatterDeltaDetector } from '@plugin/application/services/FrontmatterDeltaDetector';
import {
  SectionStateManager,
  DailyNavigationRenderer,
  LayoutConfigParser,
  IncrementalUpdateHandler,
} from "./helpers";
import { ObsidianApp, ExocortexPluginInterface } from '@plugin/types';
import { LRUCache } from '@plugin/infrastructure/cache';

/**
 * Renders the UniversalLayout view with properties, buttons, daily sections, and relations.
 *
 * Uses specialized renderers for each section:
 * - PropertiesRenderer: Asset properties
 * - ButtonGroupsBuilder: Action buttons
 * - DailyTasksRenderer/DailyProjectsRenderer: Daily note sections
 * - AreaTreeRenderer/RelationsRenderer: Asset relations
 */
export class UniversalLayoutRenderer {
  private logger: ILogger;
  private app: ObsidianApp;
  private settings: ExocortexSettings;
  private plugin: ExocortexPluginInterface;
  private eventListenerManager: EventListenerManager;
  private backlinksCacheManager: BacklinksCacheManager;
  private reactRenderer: ReactRenderer;
  private metadataExtractor: MetadataExtractor;
  private rootContainer: HTMLElement | null = null;
  private buttonGroupsBuilder!: ButtonGroupsBuilder;
  private dailyTasksRenderer!: DailyTasksRenderer;
  private dailyProjectsRenderer!: DailyProjectsRenderer;
  private vaultAdapter: IVaultAdapter;
  private metadataService: AssetMetadataService;
  private propertiesRenderer!: PropertiesRenderer;
  private areaTreeRenderer!: AreaTreeRenderer;
  private relationsRenderer!: RelationsRenderer;
  private sectionStateManager: SectionStateManager;
  private dailyNavRenderer: DailyNavigationRenderer;
  private incrementalUpdateHandler!: IncrementalUpdateHandler;

  private dependencyResolver: PropertyDependencyResolver;
  private deltaDetector: FrontmatterDeltaDetector;
  // Use LRU cache with max 500 entries and 5-minute TTL to prevent unbounded growth
  // TTL ensures stale entries are evicted even if not accessed
  private metadataCache: LRUCache<string, Record<string, unknown>> = new LRUCache({
    maxEntries: 500,
    ttl: 5 * 60 * 1000, // 5 minutes
  });
  private debounceTimeout: NodeJS.Timeout | null = null;
  private currentFilePath: string | null = null;
  private currentConfig: UniversalLayoutConfig = {};

  constructor(app: ObsidianApp, settings: ExocortexSettings, plugin: ExocortexPluginInterface, vaultAdapter: IVaultAdapter) {
    this.app = app;
    this.settings = settings;
    this.plugin = plugin;
    this.vaultAdapter = vaultAdapter;
    this.logger = LoggerFactory.create("UniversalLayoutRenderer");

    // Create ReactRenderer with ErrorBoundary enabled for graceful error handling.
    // All React components rendered through this instance will be wrapped with
    // ErrorBoundary, ensuring render errors don't crash the entire plugin UI.
    this.reactRenderer = new ReactRenderer({
      useErrorBoundary: true,
      onError: (error, errorInfo) => {
        this.logger.error("Layout component render error", {
          error: error.message,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          filePath: this.currentFilePath,
        });
      },
    });

    this.eventListenerManager = new EventListenerManager();
    this.backlinksCacheManager = new BacklinksCacheManager(this.app);
    this.metadataExtractor = new MetadataExtractor(this.vaultAdapter);
    this.metadataService = new AssetMetadataService(this.app);
    this.sectionStateManager = new SectionStateManager();
    this.dailyNavRenderer = new DailyNavigationRenderer(
      this.app, this.vaultAdapter, this.metadataExtractor, this.logger);

    this.initializeRenderers();
    this.dependencyResolver = new PropertyDependencyResolver();
    this.deltaDetector = new FrontmatterDeltaDetector();
  }

  private initializeRenderers(): void {
    const services = this.resolveServices();

    this.propertiesRenderer = new PropertiesRenderer(
      this.app, this.reactRenderer, this.metadataExtractor, this.metadataService);

    this.areaTreeRenderer = new AreaTreeRenderer(
      this.app, this.reactRenderer, this.metadataExtractor,
      this.vaultAdapter, this.metadataService, this.logger);

    this.relationsRenderer = new RelationsRenderer(
      this.app, this.settings, this.reactRenderer, this.backlinksCacheManager,
      this.metadataService, this.plugin, () => this.refresh(), this.vaultAdapter);

    this.buttonGroupsBuilder = new ButtonGroupsBuilder({
      app: this.app,
      settings: this.settings,
      plugin: this.plugin,
      taskCreationService: services.taskCreation,
      projectCreationService: services.projectCreation,
      areaCreationService: services.areaCreation,
      classCreationService: services.classCreation,
      conceptCreationService: services.conceptCreation,
      taskStatusService: services.taskStatus,
      propertyCleanupService: services.propertyCleanup,
      folderRepairService: services.folderRepair,
      renameToUidService: services.renameToUid,
      effortVotingService: services.effortVoting,
      labelToAliasService: services.labelToAlias,
      assetConversionService: services.assetConversion,
      metadataExtractor: this.metadataExtractor,
      logger: this.logger,
      refresh: () => this.refresh(),
    });

    this.dailyTasksRenderer = new DailyTasksRenderer(
      this.app, this.settings, this.plugin, this.logger,
      this.metadataExtractor, this.reactRenderer, () => this.refresh(),
      this.metadataService, this.vaultAdapter);

    this.dailyProjectsRenderer = new DailyProjectsRenderer(
      this.app, this.settings, this.plugin, this.logger,
      this.metadataExtractor, this.reactRenderer, () => this.refresh(),
      (path: string) => this.metadataService.getAssetLabel(path),
      (metadata: Record<string, unknown>) => this.metadataService.getEffortArea(metadata),
      this.vaultAdapter);

    this.incrementalUpdateHandler = new IncrementalUpdateHandler({
      propertiesRenderer: this.propertiesRenderer,
      buttonGroupsBuilder: this.buttonGroupsBuilder,
      dailyTasksRenderer: this.dailyTasksRenderer,
      dailyProjectsRenderer: this.dailyProjectsRenderer,
      areaTreeRenderer: this.areaTreeRenderer,
      relationsRenderer: this.relationsRenderer,
      reactRenderer: this.reactRenderer,
      backlinksCacheManager: this.backlinksCacheManager,
      sectionStateManager: this.sectionStateManager,
      eventListenerManager: this.eventListenerManager,
    });
  }

  private resolveServices() {
    return {
      taskCreation: container.resolve(TaskCreationService),
      projectCreation: container.resolve(ProjectCreationService),
      areaCreation: container.resolve(AreaCreationService),
      classCreation: container.resolve(ClassCreationService),
      conceptCreation: container.resolve(ConceptCreationService),
      taskStatus: container.resolve(TaskStatusService),
      propertyCleanup: container.resolve(PropertyCleanupService),
      folderRepair: container.resolve(FolderRepairService),
      renameToUid: container.resolve(RenameToUidService),
      effortVoting: container.resolve(EffortVotingService),
      labelToAlias: container.resolve(LabelToAliasService),
      assetConversion: container.resolve(AssetConversionService),
    };
  }

  public invalidateBacklinksCache(): void {
    this.backlinksCacheManager.invalidate();
  }

  cleanup(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    this.eventListenerManager.cleanup();
    this.reactRenderer.cleanup();
    this.backlinksCacheManager.cleanup();
    this.metadataCache.cleanup();
    this.sectionStateManager.cleanup();
    this.currentFilePath = null;
    this.rootContainer = null;
  }

  public async handleMetadataChange(filePath: string): Promise<void> {
    if (this.debounceTimeout) clearTimeout(this.debounceTimeout);

    this.debounceTimeout = setTimeout(async () => {
      if (!this.rootContainer || filePath !== this.currentFilePath) return;

      // Use app.vault to get proper TFile instance (not IFile from adapter)
      const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
      if (!abstractFile || !(abstractFile instanceof TFile)) return;
      const currentFile = abstractFile;

      const oldMetadata = this.metadataCache.get(filePath) || {};
      const newMetadata = this.metadataExtractor.extractMetadata(currentFile);
      const delta = this.deltaDetector.detectChanges(oldMetadata, newMetadata);
      const changedProps = this.deltaDetector.getAllChangedProperties(delta);

      if (changedProps.length === 0) return;

      this.metadataCache.set(filePath, newMetadata);
      const affectedSections = this.dependencyResolver.getAffectedSections(changedProps);
      await this.incrementalUpdateHandler.updateSections(
        this.rootContainer, currentFile, affectedSections, this.currentConfig);
    }, 50);
  }

  public async render(source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext): Promise<void> {
    try {
      this.rootContainer = el;
      const config = LayoutConfigParser.parse(source);
      const currentFile = this.app.workspace.getActiveFile();

      if (!currentFile) {
        el.createDiv({ text: "No active file", cls: "exocortex-message" });
        return;
      }

      this.dailyNavRenderer.render(el, currentFile);

      const backlinks = this.backlinksCacheManager.getBacklinks(currentFile.path);
      const hasRelations = backlinks && backlinks.size > 0;
      const renderHeader = (c: HTMLElement, id: string, t: string) =>
        this.sectionStateManager.renderHeader(c, id, t, this.eventListenerManager);

      if (this.settings.showPropertiesSection) {
        await this.propertiesRenderer.render(el, currentFile, { hideAliases: hasRelations },
          renderHeader, this.sectionStateManager.isCollapsed("properties"));
      }

      const buttonGroups = await this.buttonGroupsBuilder.build(currentFile);
      if (buttonGroups.length > 0) {
        const buttonsContainer = el.createDiv({ cls: "exocortex-buttons-section" });
        this.reactRenderer.render(buttonsContainer, React.createElement(ActionButtonsGroup, { groups: buttonGroups }));
      }

      await this.dailyTasksRenderer.render(el, currentFile, renderHeader, this.sectionStateManager.isCollapsed("daily-tasks"));
      if (this.settings.showDailyNoteProjects) {
        await this.dailyProjectsRenderer.render(el, currentFile, renderHeader, this.sectionStateManager.isCollapsed("daily-projects"));
      }

      const relations = await this.relationsRenderer.getAssetRelations(currentFile, config);
      await this.areaTreeRenderer.render(el, currentFile, relations, renderHeader, this.sectionStateManager.isCollapsed("area-tree"));
      await this.relationsRenderer.render(el, relations, config, renderHeader, this.sectionStateManager.isCollapsed("relations"));

      this.currentFilePath = currentFile.path;
      this.currentConfig = config;
      this.metadataCache.set(currentFile.path, this.metadataExtractor.extractMetadata(currentFile));

      this.logger.info(`Rendered UniversalLayout with ${relations.length} asset relations`);
    } catch (error) {
      this.logger.error("Failed to render UniversalLayout", { error });
      el.createDiv({ text: `Error: ${error instanceof Error ? error.message : String(error)}`, cls: "exocortex-error-message" });
    }
  }

  public async refresh(_el?: HTMLElement): Promise<void> {
    if (!this.rootContainer) {
      this.logger.error("Cannot refresh: root container not set");
      return;
    }

    const scrollParent = this.rootContainer.closest(".cm-scroller") ||
      this.rootContainer.closest(".markdown-preview-view") ||
      this.rootContainer.closest(".workspace-leaf-content");
    const scrollTop = scrollParent?.scrollTop || 0;

    const source = this.rootContainer.getAttribute("data-source") || "";
    this.rootContainer.empty();
    await this.render(source, this.rootContainer, {} as MarkdownPostProcessorContext);

    setTimeout(() => { if (scrollParent) scrollParent.scrollTop = scrollTop; }, 50);
  }
}
