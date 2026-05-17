import { MarkdownPostProcessorContext, TFile } from "obsidian";
import { container } from "tsyringe";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ActionButtonsGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import { IVaultAdapter, MetadataExtractor, INotificationService } from "exocortex";
import { FolderRepairService } from "exocortex";
import { CommandResolver, PreconditionEvaluator, GroundingExecutor } from "exocortex";
import type { LayoutSelector, RelationColumnSetResolver, ITripleStore } from "exocortex";
import type { ExoLayoutRepository } from "@plugin/infrastructure/repositories";
import { ExoLayoutRenderer } from "./ExoLayoutRenderer";
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { EventListenerManager } from '@plugin/adapters/events/EventListenerManager';
import { ButtonGroupsBuilder } from '@plugin/presentation/builders/ButtonGroupsBuilder';
import type { ExocmdFastResolver } from '@plugin/presentation/builders/button-groups/ExocmdFastResolver';
import { PanelResolver } from '@plugin/application/services/PanelResolver';
import { DailyTasksRenderer } from "./DailyTasksRenderer";

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
 * - ButtonGroupsBuilder: Action buttons
 * - DailyTasksRenderer: Daily note tasks section
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
  private vaultAdapter: IVaultAdapter;
  private metadataService: AssetMetadataService;
  private areaTreeRenderer!: AreaTreeRenderer;
  private relationsRenderer!: RelationsRenderer;
  private sectionStateManager: SectionStateManager;
  private dailyNavRenderer: DailyNavigationRenderer;
  private incrementalUpdateHandler!: IncrementalUpdateHandler;

  private commandResolver?: CommandResolver;
  private preconditionEvaluator?: PreconditionEvaluator;
  private groundingExecutor?: GroundingExecutor;
  private notificationService?: INotificationService;
  private tripleStore?: ITripleStore;
  private relationColumnSetResolver: RelationColumnSetResolver | null = null;
  private exoLayoutRepository: ExoLayoutRepository | null = null;
  private layoutSelector: LayoutSelector | null = null;
  private panelResolver: PanelResolver | null = null;
  // Issue #3171 — cold-start fast path
  private fastResolver?: ExocmdFastResolver;
  private isFullPathReady?: () => boolean;
  private exoLayoutRenderer!: ExoLayoutRenderer;

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

  constructor(
    app: ObsidianApp,
    settings: ExocortexSettings,
    plugin: ExocortexPluginInterface,
    vaultAdapter: IVaultAdapter,
    rfc009Services?: {
      commandResolver?: CommandResolver;
      preconditionEvaluator?: PreconditionEvaluator;
      groundingExecutor?: GroundingExecutor;
      notificationService?: INotificationService;
      tripleStore?: ITripleStore;
      relationColumnSetResolver?: RelationColumnSetResolver | null;
      exoLayoutRepository?: ExoLayoutRepository | null;
      layoutSelector?: LayoutSelector | null;
      panelResolver?: PanelResolver;
      // Issue #3171
      fastResolver?: ExocmdFastResolver;
      isFullPathReady?: () => boolean;
    },
  ) {
    this.app = app;
    this.settings = settings;
    this.plugin = plugin;
    this.vaultAdapter = vaultAdapter;
    this.commandResolver = rfc009Services?.commandResolver;
    this.preconditionEvaluator = rfc009Services?.preconditionEvaluator;
    this.groundingExecutor = rfc009Services?.groundingExecutor;
    this.notificationService = rfc009Services?.notificationService;
    this.tripleStore = rfc009Services?.tripleStore;
    this.relationColumnSetResolver =
      rfc009Services?.relationColumnSetResolver ?? null;
    this.exoLayoutRepository = rfc009Services?.exoLayoutRepository ?? null;
    this.layoutSelector = rfc009Services?.layoutSelector ?? null;
    this.panelResolver = rfc009Services?.panelResolver ?? null;
    this.fastResolver = rfc009Services?.fastResolver;
    this.isFullPathReady = rfc009Services?.isFullPathReady;
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

    const exoLayoutRepo = this.exoLayoutRepository;
    this.exoLayoutRenderer = new ExoLayoutRenderer({
      app: this.app,
      reactRenderer: this.reactRenderer,
      logger: this.logger,
      snapshotProvider: () =>
        exoLayoutRepo?.getSnapshot() ?? {
          layouts: [],
          blocks: [],
          blocksByUid: new Map(),
          blocksByLabel: new Map(),
        },
    });
  }

  private initializeRenderers(): void {
    const services = this.resolveServices();

    this.areaTreeRenderer = new AreaTreeRenderer(
      this.app, this.reactRenderer, this.metadataExtractor,
      this.vaultAdapter, this.metadataService, this.logger);

    this.relationsRenderer = new RelationsRenderer(
      this.app, this.settings, this.reactRenderer, this.backlinksCacheManager,
      this.metadataService, this.plugin, () => this.refresh(), this.vaultAdapter,
      this.relationColumnSetResolver);

    this.buttonGroupsBuilder = new ButtonGroupsBuilder({
      app: this.app,
      settings: this.settings,
      plugin: this.plugin,
      commandResolver: this.commandResolver,
      preconditionEvaluator: this.preconditionEvaluator,
      groundingExecutor: this.groundingExecutor,
      tripleStore: this.tripleStore,
      folderRepairService: services.folderRepair,
      metadataExtractor: this.metadataExtractor,
      logger: this.logger,
      refresh: () => this.refresh(),
      notificationService: this.notificationService,
      panelResolver: this.panelResolver ?? undefined,
      fastResolver: this.fastResolver,
      isFullPathReady: this.isFullPathReady,
    });

    this.dailyTasksRenderer = new DailyTasksRenderer(
      this.app, this.settings, this.plugin, this.logger,
      this.metadataExtractor, this.reactRenderer, () => this.refresh(),
      this.metadataService, this.vaultAdapter);

    this.incrementalUpdateHandler = new IncrementalUpdateHandler({
      buttonGroupsBuilder: this.buttonGroupsBuilder,
      dailyTasksRenderer: this.dailyTasksRenderer,
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
      folderRepair: container.resolve(FolderRepairService),
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

      const renderHeader = (c: HTMLElement, id: string, t: string) =>
        this.sectionStateManager.renderHeader(c, id, t, this.eventListenerManager);

      const buttonGroups = await this.buttonGroupsBuilder.build(currentFile);
      if (buttonGroups.length > 0) {
        const buttonsContainer = el.createDiv({ cls: "exocortex-buttons-section" });
        this.reactRenderer.render(buttonsContainer, React.createElement(ActionButtonsGroup, { groups: buttonGroups }));
      }

      await this.dailyTasksRenderer.render(el, currentFile, renderHeader, this.sectionStateManager.isCollapsed("daily-tasks"));

      const relations = await this.relationsRenderer.getAssetRelations(currentFile, config);

      // RFC exo__Layout Phase 2 — resolve Layout for current asset's classes.
      // When a layout is found AND the feature flag is on, render its blocks.
      // If the layout's `coexistsWithDefault` is false, skip the default
      // AreaTree + Relations sections (full replace mode). Properties block
      // and action buttons are always preserved per RFC §62.
      const layout = this.resolveLayoutForFile(currentFile);
      const layoutActive = layout !== null && this.settings.enableExoLayoutRenderer;
      if (layoutActive && layout !== null) {
        await this.exoLayoutRenderer.render(el, currentFile, layout, relations);
        if (!layout.coexistsWithDefault) {
          this.currentFilePath = currentFile.path;
          this.currentConfig = config;
          this.metadataCache.set(
            currentFile.path,
            this.metadataExtractor.extractMetadata(currentFile),
          );
          el.addClass("exocortex-layout-rendered");
          this.logger.info(
            `Rendered ExoLayout ${layout.uid} (replace) for ${currentFile.path}`,
          );
          return;
        }
      }

      await this.areaTreeRenderer.render(el, currentFile, relations, renderHeader, this.sectionStateManager.isCollapsed("area-tree"));
      await this.relationsRenderer.render(el, relations, config, renderHeader, this.sectionStateManager.isCollapsed("relations"));

      this.currentFilePath = currentFile.path;
      this.currentConfig = config;
      this.metadataCache.set(currentFile.path, this.metadataExtractor.extractMetadata(currentFile));

      el.addClass("exocortex-layout-rendered");
      this.logger.info(`Rendered UniversalLayout with ${relations.length} asset relations`);
    } catch (error) {
      this.logger.error("Failed to render UniversalLayout", { error });
      el.createDiv({ text: `Error: ${error instanceof Error ? error.message : String(error)}`, cls: "exocortex-error-message" });
    }
  }

  private resolveLayoutForFile(
    file: TFile,
  ): import("exocortex").Layout | null {
    if (this.layoutSelector === null) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    const raw = cache?.frontmatter?.["exo__Instance_class"];
    const classes = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string")
      : typeof raw === "string"
        ? [raw]
        : [];
    if (classes.length === 0) return null;
    return this.layoutSelector.resolve(classes);
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
