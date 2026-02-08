import { MarkdownPostProcessorContext, TFile } from "obsidian";
import { ILogger } from '@plugin/adapters/logging/ILogger';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';
import React from "react";
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { ExocortexSettings } from '@plugin/domain/settings/ExocortexSettings';
import { ActionButtonsGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  IVaultAdapter,
  MetadataExtractor,
  ActionInterpreter as CoreActionInterpreter,
  ConditionEvaluator as CoreConditionEvaluator,
} from "exocortex";
import { BacklinksCacheManager } from '@plugin/adapters/caching/BacklinksCacheManager';
import { EventListenerManager } from '@plugin/adapters/events/EventListenerManager';
import { RdfButtonGroupsBuilder } from '@plugin/presentation/builders/RdfButtonGroupsBuilder';
import type { ActionInterpreter, ConditionEvaluator } from '@plugin/presentation/builders/RdfButtonGroupsBuilder';
import type { ButtonGroup } from '@plugin/presentation/components/ActionButtonsGroup';
import {
  ActionInterpreterAdapter,
  ConditionEvaluatorAdapter,
  createNoOpActionInterpreter,
  createAlwaysTrueConditionEvaluator,
} from '@plugin/presentation/adapters/RdfButtonAdapters';
import { ObsidianUIProvider } from '@plugin/infrastructure/ObsidianUIProvider';
import { SPARQLQueryService } from '@plugin/application/services/SPARQLQueryService';
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
 * - RdfButtonGroupsBuilder: RDF-driven action buttons
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
  private rdfButtonGroupsBuilder?: RdfButtonGroupsBuilder;
  private actionInterpreter?: ActionInterpreter;
  private conditionEvaluator?: ConditionEvaluator;
  private sparqlQueryService?: SPARQLQueryService;
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
    // Initialize RDF button support (always enabled after validation)
    this.initializeRdfButtonSupport();

    this.propertiesRenderer = new PropertiesRenderer(
      this.app, this.reactRenderer, this.metadataExtractor, this.metadataService);

    this.areaTreeRenderer = new AreaTreeRenderer(
      this.app, this.reactRenderer, this.metadataExtractor,
      this.vaultAdapter, this.metadataService, this.logger);

    this.relationsRenderer = new RelationsRenderer(
      this.app, this.settings, this.reactRenderer, this.backlinksCacheManager,
      this.metadataService, this.plugin, () => this.refresh(), this.vaultAdapter);

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
      rdfButtonGroupsBuilder: this.rdfButtonGroupsBuilder,
      dailyTasksRenderer: this.dailyTasksRenderer,
      dailyProjectsRenderer: this.dailyProjectsRenderer,
      areaTreeRenderer: this.areaTreeRenderer,
      relationsRenderer: this.relationsRenderer,
      reactRenderer: this.reactRenderer,
      backlinksCacheManager: this.backlinksCacheManager,
      sectionStateManager: this.sectionStateManager,
      eventListenerManager: this.eventListenerManager,
      metadataExtractor: this.metadataExtractor,
    });
  }

  /**
   * Initialize RDF-driven button support.
   *
   * Creates ActionInterpreter, ConditionEvaluator, and RdfButtonGroupsBuilder
   * for RDF-driven button rendering.
   *
   * Uses real implementations from @exocortex/core wrapped with plugin-layer adapters:
   * - CoreConditionEvaluator: Evaluates RDF conditions via SPARQL ASK queries
   * - CoreActionInterpreter: Executes RDF actions (UpdatePropertyAction, etc.)
   */
  private initializeRdfButtonSupport(): void {
    try {
      // Create SPARQL query service for RDF queries
      this.sparqlQueryService = new SPARQLQueryService(this.app);

      // Initialize SPARQL service to get triple store
      // Note: initialization is async, but we handle it in buildButtonGroups
      void this.sparqlQueryService.initialize().then(() => {
        this.initializeRealAdapters();
      }).catch((error) => {
        this.logger.warn("Failed to initialize SPARQL service, using fallback adapters", { error });
        this.initializeFallbackAdapters();
      });

      // Use fallback adapters initially until SPARQL service is ready
      this.initializeFallbackAdapters();

      this.logger.info("RDF button support initialized (pending SPARQL initialization)");
    } catch (error) {
      this.logger.error("Failed to initialize RDF button support", { error });
      // rdfButtonGroupsBuilder will be undefined - no buttons will be rendered
    }
  }

  /**
   * Initialize real adapters using core implementations.
   * Called after SPARQL service is initialized.
   */
  private initializeRealAdapters(): void {
    if (!this.sparqlQueryService) return;

    try {
      const tripleStore = this.sparqlQueryService.getTripleStore();

      // Create UI provider for Obsidian environment
      const uiProvider = new ObsidianUIProvider(this.app);

      // Create core ConditionEvaluator with triple store access
      const coreConditionEvaluator = new CoreConditionEvaluator(tripleStore);
      this.conditionEvaluator = new ConditionEvaluatorAdapter(coreConditionEvaluator);

      // Create core ActionInterpreter with required dependencies
      const coreActionInterpreter = new CoreActionInterpreter(
        tripleStore,
        undefined, // assetCreationService - not needed for UpdatePropertyAction
        this.vaultAdapter,
        undefined, // fileSystem - not needed for UpdatePropertyAction
        undefined, // webhookService - not needed for basic actions
        uiProvider
      );

      // Create ActionInterpreterAdapter with file resolver
      this.actionInterpreter = new ActionInterpreterAdapter(
        coreActionInterpreter,
        tripleStore,
        uiProvider,
        (assetUri: string) => this.resolveAssetUriToFile(assetUri)
      );

      // Recreate RdfButtonGroupsBuilder with real adapters
      this.rdfButtonGroupsBuilder = new RdfButtonGroupsBuilder(
        this.sparqlQueryService,
        this.actionInterpreter,
        this.conditionEvaluator
      );

      this.logger.info("RDF button support initialized with real adapters");
    } catch (error) {
      this.logger.error("Failed to initialize real adapters, keeping fallback", { error });
    }
  }

  /**
   * Initialize fallback adapters (no-op action, always-true condition).
   * Used when SPARQL service is not ready or fails.
   */
  private initializeFallbackAdapters(): void {
    this.actionInterpreter = createNoOpActionInterpreter();
    this.conditionEvaluator = createAlwaysTrueConditionEvaluator();

    this.rdfButtonGroupsBuilder = new RdfButtonGroupsBuilder(
      this.sparqlQueryService!,
      this.actionInterpreter,
      this.conditionEvaluator
    );
  }

  /**
   * Resolve asset URI to IFile.
   * Extracts UUID from URI and looks up the file.
   *
   * @param assetUri - Asset URI (e.g., https://exocortex.my/assets/uuid)
   * @returns IFile or null if not found
   */
  private resolveAssetUriToFile(assetUri: string): import("exocortex").IFile | null {
    // Extract UUID from URI - it's typically the last path segment
    const uuid = assetUri.split("/").pop();
    if (!uuid) return null;

    // Search through all files for matching UID
    const allFiles = this.vaultAdapter.getAllFiles();
    for (const file of allFiles) {
      const frontmatter = this.vaultAdapter.getFrontmatter(file);
      if (frontmatter?.exo__Asset_uid === uuid) {
        return file;
      }
    }

    return null;
  }

  /**
   * Build button groups for the current file using RDF-driven button definitions.
   *
   * Returns empty array if RdfButtonGroupsBuilder is not available or fails.
   */
  private async buildButtonGroups(file: TFile): Promise<ButtonGroup[]> {
    if (!this.rdfButtonGroupsBuilder) {
      this.logger.debug("RDF button builder not available, skipping buttons");
      return [];
    }

    try {
      const assetUri = this.buildAssetUri(file);
      const rdfGroups = await this.rdfButtonGroupsBuilder.buildButtonGroups(assetUri);

      if (rdfGroups.length > 0) {
        this.logger.debug("Using RDF buttons", { count: rdfGroups.length });
      }

      return rdfGroups;
    } catch (error) {
      this.logger.warn("RDF button loading failed", { error });
      return [];
    }
  }

  /**
   * Build asset URI from file path.
   * Uses the file's UID if available, otherwise the file path.
   */
  private buildAssetUri(file: TFile): string {
    const metadata = this.metadataExtractor.extractMetadata(file);
    const uid = metadata?.exo__Asset_uid as string;

    if (uid) {
      return `https://exocortex.my/assets/${uid}`;
    }

    // Fall back to file path
    return `file://${file.path}`;
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

    // Cleanup RDF button support
    if (this.sparqlQueryService) {
      void this.sparqlQueryService.dispose();
    }

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

      const buttonGroups = await this.buildButtonGroups(currentFile);
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
