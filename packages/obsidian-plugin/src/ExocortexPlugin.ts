import "reflect-metadata";
import {
  MarkdownPostProcessorContext,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import { container } from "tsyringe";
import { UniversalLayoutRenderer } from "./presentation/renderers/UniversalLayoutRenderer";
import { ILogger } from "./adapters/logging/ILogger";
import { LoggerFactory } from "./adapters/logging/LoggerFactory";
import { CommandManager } from "./application/services/CommandManager";
import {
  ExocortexSettings,
  DEFAULT_SETTINGS,
  type StoredWebhookConfig,
} from "./domain/settings/ExocortexSettings";
import { ExocortexSettingTab } from "./presentation/settings/ExocortexSettingTab";
import { TaskStatusService, WebhookService, type WebhookDispatchResult, LoggingService } from "exocortex";
import { WebhookDispatcher } from "./infrastructure/webhook";
import { SemanticSearchManager } from "./infrastructure/semantic-search";
import { SemanticSearchModal } from "./presentation/modals/SemanticSearchModal";
import { ObsidianVaultAdapter } from "./adapters/ObsidianVaultAdapter";
import { TaskTrackingService } from "./application/services/TaskTrackingService";
import { AliasSyncService } from "./application/services/AliasSyncService";
import { WikilinkAliasService } from "./application/services/WikilinkAliasService";
import { SPARQLCodeBlockProcessor } from "./application/processors/SPARQLCodeBlockProcessor";
import { LayoutCodeBlockProcessor } from "./application/processors/LayoutCodeBlockProcessor";
import { SPARQLApi } from "./application/api/SPARQLApi";
import { ExocortexAPI } from "./application/api/ExocortexAPI";
import { PluginContainer } from "./infrastructure/di/PluginContainer";
import { createAliasIconExtension } from "./presentation/editor-extensions";
import { TimerManager } from "./infrastructure/timer";
import { LRUCache } from "./infrastructure/cache";
import { FileExplorerPatch } from "./presentation/file-explorer/FileExplorerPatch";
import { FileExplorerSortPatch } from "./presentation/file-explorer/FileExplorerSortPatch";
import { TabTitlePatch } from "./presentation/tab-titles/TabTitlePatch";
import { PropertiesLinkPatch } from "./presentation/properties/PropertiesLinkPatch";
import { BodyLinkPatch } from "./presentation/body/BodyLinkPatch";

/**
 * Exocortex Plugin - Automatic layout rendering
 * Automatically displays related assets table in all notes (below metadata in reading mode)
 * Provides Command Palette integration for all asset commands
 */
export default class ExocortexPlugin extends Plugin {
  private logger!: ILogger;
  private layoutRenderer!: UniversalLayoutRenderer;
  private commandManager!: CommandManager;
  private taskStatusService!: TaskStatusService;
  private taskTrackingService!: TaskTrackingService;
  private aliasSyncService!: AliasSyncService;
  private wikilinkAliasService!: WikilinkAliasService;
  // Use LRU cache with max 1000 entries and 5-minute TTL to prevent unbounded memory growth
  // TTL ensures stale entries are evicted even if not accessed
  private metadataCache!: LRUCache<string, Record<string, unknown>>;
  vaultAdapter!: ObsidianVaultAdapter;
  private sparqlProcessor!: SPARQLCodeBlockProcessor;
  private layoutProcessor!: LayoutCodeBlockProcessor;
  sparql!: SPARQLApi;
  /**
   * Public API for external plugin integration.
   * Accessible via `app.plugins.getPlugin('exocortex').api`
   */
  api!: ExocortexAPI;
  settings!: ExocortexSettings;
  private timerManager!: TimerManager;
  // MutationObserver to detect when layout is removed by Obsidian re-renders (e.g., when processing embeds)
  private layoutPersistenceObserver: MutationObserver | null = null;
  private fileExplorerPatch!: FileExplorerPatch;
  private fileExplorerSortPatch!: FileExplorerSortPatch;
  private tabTitlePatch!: TabTitlePatch;
  private propertiesLinkPatch!: PropertiesLinkPatch;
  private bodyLinkPatch!: BodyLinkPatch;
  private webhookService!: WebhookService;
  private webhookDispatcher!: WebhookDispatcher;
  private semanticSearchManager!: SemanticSearchManager;

  override async onload(): Promise<void> {
    try {
      // Initialize DI container (Phase 1 infrastructure)
      PluginContainer.setup(this.app, this);

      this.logger = LoggerFactory.create("ExocortexPlugin");
      this.logger.info("Loading Exocortex Plugin");

      // Initialize timer manager for lifecycle-safe setTimeout/setInterval
      this.timerManager = new TimerManager();

      await this.loadSettings();

      this.vaultAdapter = new ObsidianVaultAdapter(
        this.app.vault,
        this.app.metadataCache,
        this.app,
      );
      this.layoutRenderer = new UniversalLayoutRenderer(
        this.app,
        this.settings,
        this,
        this.vaultAdapter,
      );
      this.taskStatusService = container.resolve(TaskStatusService);
      this.taskTrackingService = new TaskTrackingService(
        this.app,
        this.app.vault,
        this.app.metadataCache
      );
      this.aliasSyncService = new AliasSyncService(
        this.app.metadataCache,
        this.app
      );
      this.wikilinkAliasService = new WikilinkAliasService(
        this.app,
        this.app.metadataCache,
      );
      this.metadataCache = new LRUCache({
        maxEntries: 1000,
        ttl: 5 * 60 * 1000, // 5 minutes
      });
      this.sparqlProcessor = new SPARQLCodeBlockProcessor(this);
      this.layoutProcessor = new LayoutCodeBlockProcessor(this);
      this.sparql = new SPARQLApi(this);
      this.api = new ExocortexAPI(this);

      // Register the alias icon editor extension for Live Preview mode
      this.registerEditorExtension(
        createAliasIconExtension(
          this.app,
          this.app.metadataCache,
          this.wikilinkAliasService,
          (message: string) => new Notice(message),
        ),
      );

      // Initialize CommandManager and register all commands
      this.commandManager = new CommandManager(this.app);
      this.commandManager.registerAllCommands(this, () =>
        this.autoRenderLayout(),
      );

      this.addSettingTab(new ExocortexSettingTab(this.app, this));

      this.registerMarkdownCodeBlockProcessor(
        "sparql",
        (source, el, ctx) => this.sparqlProcessor.process(source, el, ctx)
      );

      this.registerMarkdownCodeBlockProcessor(
        "exo-layout",
        (source, el, ctx) => this.layoutProcessor.process(source, el, ctx)
      );

      this.registerEvent(
        this.app.metadataCache.on("resolved", () => {
          this.layoutRenderer.invalidateBacklinksCache();
        }),
      );

      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          this.handleMetadataChange(file);
        }),
      );

      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (file instanceof TFile) {
            this.handleMetadataChange(file);
          }
        }),
      );

      // AutoLayout: Automatic rendering on file open
      // Using TimerManager for lifecycle-safe timers that are cleared on plugin unload
      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          if (file) {
            this.timerManager.setTimeout("auto-layout-file-open", () => this.autoRenderLayout(), 150);
          }
        }),
      );

      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          this.timerManager.setTimeout("auto-layout-leaf-change", () => this.autoRenderLayout(), 150);
        }),
      );

      this.registerEvent(
        this.app.workspace.on("layout-change", () => {
          this.timerManager.setTimeout("auto-layout-change", () => this.autoRenderLayout(), 150);
        }),
      );

      // Initial render
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        this.timerManager.setTimeout("auto-layout-initial", () => this.autoRenderLayout(), 150);
      }

      // Initialize File Explorer label patch
      this.fileExplorerPatch = new FileExplorerPatch(this);
      if (this.settings.showLabelsInFileExplorer) {
        // Delay enabling to ensure File Explorer is fully loaded
        this.timerManager.setTimeout("file-explorer-patch", () => {
          this.fileExplorerPatch.enable();
        }, 500);
      }

      // Initialize File Explorer sort patch
      this.fileExplorerSortPatch = new FileExplorerSortPatch(this);
      if (this.settings.sortByDisplayName) {
        // Delay enabling to ensure File Explorer is fully loaded
        this.timerManager.setTimeout("file-explorer-sort-patch", () => {
          this.fileExplorerSortPatch.enable();
        }, 600); // Slightly after label patch
      }

      // Initialize Tab Title label patch
      this.tabTitlePatch = new TabTitlePatch(this);
      if (this.settings.showLabelsInTabTitles) {
        // Delay enabling to ensure workspace is fully loaded
        this.timerManager.setTimeout("tab-title-patch", () => {
          this.tabTitlePatch.enable();
        }, 500);
      }

      // Initialize Properties link patch
      this.propertiesLinkPatch = new PropertiesLinkPatch(this);
      if (this.settings.showLabelsInProperties) {
        // Delay enabling to ensure Properties block is fully loaded
        this.timerManager.setTimeout("properties-link-patch", () => {
          this.propertiesLinkPatch.enable();
        }, 500);
      }

      // Initialize Body link patch
      this.bodyLinkPatch = new BodyLinkPatch(this);
      if (this.settings.showLabelsInBody) {
        // Delay enabling to ensure markdown body is fully loaded
        this.timerManager.setTimeout("body-link-patch", () => {
          this.bodyLinkPatch.enable();
        }, 500);
      }

      // Initialize Webhook integration
      this.webhookService = new WebhookService();
      this.webhookDispatcher = new WebhookDispatcher(this.app, this.webhookService);
      this.initializeWebhooks();

      // Register webhook event handlers
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          void this.webhookDispatcher.handleFileCreate(file);
        }),
      );

      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          void this.webhookDispatcher.handleFileDelete(file);
        }),
      );

      // Initialize Semantic Search
      this.semanticSearchManager = new SemanticSearchManager(
        this.app,
        this.settings.semanticSearchSettings
      );
      await this.initializeSemanticSearch();

      // Register semantic search commands
      this.addCommand({
        id: "semantic-search",
        name: "Semantic search",
        callback: () => {
          new SemanticSearchModal(
            this.app,
            this.semanticSearchManager,
            this.app.workspace.getActiveFile()
          ).open();
        },
      });

      this.addCommand({
        id: "find-similar-notes",
        name: "Find similar notes",
        checkCallback: (checking: boolean) => {
          const file = this.app.workspace.getActiveFile();
          if (!file) {
            return false;
          }
          if (!checking) {
            new SemanticSearchModal(
              this.app,
              this.semanticSearchManager,
              file
            ).open();
          }
          return true;
        },
      });

      this.addCommand({
        id: "index-all-notes",
        name: "Index all notes for semantic search",
        callback: async () => {
          if (!this.semanticSearchManager.isConfigured()) {
            new Notice("Semantic search is not configured. Please add your API key in settings.");
            return;
          }
          new Notice("Starting semantic search indexing...");
          try {
            const result = await this.semanticSearchManager.indexAll((status) => {
              if (status.progress % 10 === 0) {
                new Notice(`Indexing: ${status.progress}%`, 1000);
              }
            });
            new Notice(
              `Indexing complete: ${result.indexed} indexed, ${result.failed} failed${result.aborted ? " (aborted)" : ""}`
            );
          } catch (error) {
            new Notice(`Indexing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        },
      });

      this.addCommand({
        id: "clear-semantic-index",
        name: "Clear semantic search index",
        callback: async () => {
          await this.semanticSearchManager.clearIndex();
          new Notice("Semantic search index cleared");
        },
      });

      this.logger.info("Exocortex Plugin loaded successfully");
    } catch (error) {
      this.logger?.error("Failed to load Exocortex Plugin", error as Error);
      throw error;
    }
  }

  override async onunload(): Promise<void> {
    // Dispose timer manager first to prevent any more timer callbacks from firing
    if (this.timerManager) {
      this.timerManager.dispose();
    }

    // Disconnect MutationObserver for layout persistence
    if (this.layoutPersistenceObserver) {
      this.layoutPersistenceObserver.disconnect();
      this.layoutPersistenceObserver = null;
    }

    this.removeAutoRenderedLayouts();

    // Cleanup SPARQL processor
    if (this.sparqlProcessor) {
      this.sparqlProcessor.cleanup();
    }

    // Cleanup Layout processor
    if (this.layoutProcessor) {
      this.layoutProcessor.cleanup();
    }

    if (this.sparql) {
      await this.sparql.dispose();
    }

    // Cleanup public API
    if (this.api) {
      this.api.cleanup();
    }

    // Cleanup layout renderer (includes backlinks cache, metadata cache, etc.)
    if (this.layoutRenderer) {
      this.layoutRenderer.cleanup();
    }

    // Cleanup metadata cache
    if (this.metadataCache) {
      this.metadataCache.cleanup();
    }

    // Cleanup File Explorer patch
    if (this.fileExplorerPatch) {
      this.fileExplorerPatch.cleanup();
    }

    // Cleanup File Explorer sort patch
    if (this.fileExplorerSortPatch) {
      this.fileExplorerSortPatch.cleanup();
    }

    // Cleanup Tab Title patch
    if (this.tabTitlePatch) {
      this.tabTitlePatch.cleanup();
    }

    // Cleanup Properties link patch
    if (this.propertiesLinkPatch) {
      this.propertiesLinkPatch.cleanup();
    }

    // Cleanup Body link patch
    if (this.bodyLinkPatch) {
      this.bodyLinkPatch.cleanup();
    }

    // Cleanup Webhook dispatcher
    if (this.webhookDispatcher) {
      this.webhookDispatcher.cleanup();
    }

    // Cleanup Semantic Search manager
    if (this.semanticSearchManager) {
      this.semanticSearchManager.cleanup();
    }

    this.logger?.info("Exocortex Plugin unloaded");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshLayout(): void {
    this.autoRenderLayout();
  }

  getSPARQLApi(): SPARQLApi | null {
    return this.sparql ?? null;
  }

  /**
   * Returns the public API for external plugin integration.
   *
   * @returns The ExocortexAPI instance, or null if not initialized
   *
   * @example
   * ```typescript
   * // In another plugin
   * const exocortex = app.plugins.getPlugin('exocortex');
   * const api = exocortex?.getAPI();
   * if (api) {
   *   const label = api.getAssetLabel(file.path);
   *   console.log(`Asset label: ${label}`);
   * }
   * ```
   */
  getAPI(): ExocortexAPI | null {
    return this.api ?? null;
  }

  /**
   * Toggle File Explorer label display on/off
   * Called from settings when the showLabelsInFileExplorer toggle changes
   */
  toggleFileExplorerLabels(enabled: boolean): void {
    if (enabled) {
      this.fileExplorerPatch.enable();
    } else {
      this.fileExplorerPatch.disable();
    }
  }

  /**
   * Toggle Tab Title label display on/off
   * Called from settings when the showLabelsInTabTitles toggle changes
   */
  toggleTabTitleLabels(enabled: boolean): void {
    if (enabled) {
      this.tabTitlePatch.enable();
    } else {
      this.tabTitlePatch.disable();
    }
  }

  /**
   * Toggle File Explorer sort by display name on/off
   * Called from settings when the sortByDisplayName toggle changes
   */
  toggleFileExplorerSort(enabled: boolean): void {
    if (enabled) {
      this.fileExplorerSortPatch.enable();
    } else {
      this.fileExplorerSortPatch.disable();
    }
  }

  /**
   * Toggle Properties link label display on/off
   * Called from settings when the showLabelsInProperties toggle changes
   */
  togglePropertiesLabels(enabled: boolean): void {
    if (enabled) {
      this.propertiesLinkPatch.enable();
    } else {
      this.propertiesLinkPatch.disable();
    }
  }

  /**
   * Toggle Body link label display on/off
   * Called from settings when the showLabelsInBody toggle changes
   */
  toggleBodyLabels(enabled: boolean): void {
    if (enabled) {
      this.bodyLinkPatch.enable();
    } else {
      this.bodyLinkPatch.disable();
    }
  }

  /**
   * Apply display name template changes
   * Called from settings when the displayNameTemplate changes
   * Triggers re-evaluation of tab titles, file explorer labels, properties links, and body links
   */
  applyDisplayNameTemplate(): void {
    // Re-apply file explorer labels with new template
    if (this.settings.showLabelsInFileExplorer && this.fileExplorerPatch) {
      this.fileExplorerPatch.disable();
      this.fileExplorerPatch.enable();
    }

    // Re-apply tab title labels with new template
    if (this.settings.showLabelsInTabTitles && this.tabTitlePatch) {
      this.tabTitlePatch.disable();
      this.tabTitlePatch.enable();
    }

    // Re-apply properties link labels with new template
    if (this.settings.showLabelsInProperties && this.propertiesLinkPatch) {
      this.propertiesLinkPatch.disable();
      this.propertiesLinkPatch.enable();
    }

    // Re-apply body link labels with new template
    if (this.settings.showLabelsInBody && this.bodyLinkPatch) {
      this.bodyLinkPatch.disable();
      this.bodyLinkPatch.enable();
    }
  }

  /**
   * Initialize webhooks from saved settings
   */
  private initializeWebhooks(): void {
    const webhookSettings = this.settings.webhookSettings;
    if (!webhookSettings) {
      return;
    }

    // Register all saved webhooks
    for (const webhook of webhookSettings.webhooks) {
      try {
        this.webhookService.registerWebhook(webhook);
      } catch (error) {
        this.logger.warn(`Failed to register webhook ${webhook.name}: ${String(error)}`);
      }
    }

    // Enable dispatcher if webhooks are globally enabled
    if (webhookSettings.enabled) {
      this.webhookDispatcher.enable();
    }
  }

  /**
   * Toggle webhook integration on/off
   * Called from settings when the global webhook toggle changes
   */
  toggleWebhooks(enabled: boolean): void {
    if (enabled) {
      this.webhookDispatcher.enable();
    } else {
      this.webhookDispatcher.disable();
    }
  }

  /**
   * Update a webhook configuration
   * Called from settings when webhook details change
   */
  updateWebhookConfig(webhook: StoredWebhookConfig): void {
    this.webhookService.updateWebhook(webhook.id, webhook);
  }

  /**
   * Remove a webhook
   * Called from settings when a webhook is deleted
   */
  removeWebhook(webhookId: string): void {
    this.webhookService.unregisterWebhook(webhookId);
  }

  /**
   * Test a webhook by sending a test event
   * Called from settings to verify webhook configuration
   */
  async testWebhook(webhookId: string): Promise<WebhookDispatchResult> {
    return this.webhookDispatcher.testWebhook(webhookId);
  }

  /**
   * Initialize Semantic Search
   */
  private async initializeSemanticSearch(): Promise<void> {
    try {
      await this.semanticSearchManager.initialize();

      // Register file event handlers for auto-embedding
      if (this.settings.semanticSearchSettings.autoEmbed) {
        this.registerEvent(
          this.app.vault.on("create", (file) => {
            void this.semanticSearchManager.handleFileCreate(file);
          }),
        );

        this.registerEvent(
          this.app.vault.on("modify", (file) => {
            if (file instanceof TFile) {
              void this.semanticSearchManager.handleFileModify(file);
            }
          }),
        );

        this.registerEvent(
          this.app.vault.on("delete", (file) => {
            this.semanticSearchManager.handleFileDelete(file);
          }),
        );

        this.registerEvent(
          this.app.vault.on("rename", (file, oldPath) => {
            void this.semanticSearchManager.handleFileRename(file, oldPath);
          }),
        );
      }

      LoggingService.debug("SemanticSearch initialized");
    } catch (error) {
      LoggingService.warn(
        `Failed to initialize SemanticSearch: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Toggle semantic search on/off
   */
  toggleSemanticSearch(enabled: boolean): void {
    this.settings.semanticSearchSettings.enabled = enabled;
    if (enabled) {
      void this.semanticSearchManager.initialize();
    } else {
      this.semanticSearchManager.cleanup();
    }
  }

  /**
   * Update semantic search settings
   */
  updateSemanticSearchSettings(): void {
    this.semanticSearchManager.updateSettings(
      this.settings.semanticSearchSettings
    );
  }

  /**
   * Get semantic search manager (for settings tab)
   */
  getSemanticSearchManager(): SemanticSearchManager {
    return this.semanticSearchManager;
  }

  private autoRenderLayout(): void {
    // Remove existing auto-rendered layouts
    this.removeAutoRenderedLayouts();

    // Disconnect previous MutationObserver if any
    if (this.layoutPersistenceObserver) {
      this.layoutPersistenceObserver.disconnect();
      this.layoutPersistenceObserver = null;
    }

    // If layout is hidden by settings, do not render
    if (!this.settings.layoutVisible) {
      return;
    }

    // Get the active MarkdownView using Obsidian API
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!view) {
      return;
    }

    // Only render in Reading Mode (Preview), not in Edit Mode (Source/Live Preview)
    // getMode() returns 'preview' for Reading Mode, 'source' for Edit Mode
    const mode = view.getMode();
    if (mode !== "preview") {
      return;
    }

    // Get the container element from the view
    // Use containerEl which contains the entire view DOM
    const viewContainer = view.containerEl;

    if (!viewContainer) {
      return;
    }

    // Find metadata container within the active view
    const metadataContainer = viewContainer.querySelector(
      ".metadata-container",
    ) as HTMLElement;

    if (!metadataContainer) {
      return;
    }

    // Create layout container
    const layoutContainer = document.createElement("div");
    layoutContainer.className = "exocortex-auto-layout";
    layoutContainer.style.cssText = `
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--background-modifier-border);
    `;

    // Insert after metadata container using insertAdjacentElement
    // This ensures it always goes right after the metadata, not before
    metadataContainer.insertAdjacentElement("afterend", layoutContainer);

    // Render layout
    void (async () => {
      try {
        await this.layoutRenderer.render("", layoutContainer, {} as MarkdownPostProcessorContext);
      } catch (error) {
        this.logger.error("Failed to auto-render layout", error);
      }
    })();

    // Set up MutationObserver to detect when layout is removed by Obsidian re-renders
    // This happens when the note body contains embedded assets (![[...]]) that trigger
    // a view re-render after the initial layout is inserted
    this.setupLayoutPersistenceObserver(viewContainer, metadataContainer);
  }

  /**
   * Sets up a MutationObserver to watch for layout removal and re-render when necessary.
   *
   * When Obsidian processes embedded assets (![[image.png]] or ![[note]]) in reading mode,
   * it may re-render the preview view, which removes any custom elements that were inserted
   * after .metadata-container. This observer detects when our layout is removed and
   * re-inserts it to ensure the layout persists.
   *
   * @param viewContainer - The container element of the MarkdownView
   * @param metadataContainer - The metadata container element to observe
   */
  private setupLayoutPersistenceObserver(
    viewContainer: HTMLElement,
    _metadataContainer: HTMLElement,
  ): void {
    // Track if we're currently re-rendering to prevent infinite loops
    let isReRendering = false;
    // Debounce timeout for re-render
    let debounceTimeout: NodeJS.Timeout | null = null;

    this.layoutPersistenceObserver = new MutationObserver((_mutations) => {
      // Skip if we're already re-rendering or layout is hidden
      if (isReRendering || !this.settings.layoutVisible) {
        return;
      }

      // Check current state of layout and metadata
      const layoutExists = viewContainer.querySelector(".exocortex-auto-layout");
      const currentMetadataContainer = viewContainer.querySelector(".metadata-container");

      // If layout exists, nothing to do
      if (layoutExists) {
        return;
      }

      // If metadata doesn't exist, don't try to render yet
      // The view might be switching or doing a full re-render
      // When metadata comes back, this callback will fire again and we'll re-render then
      if (!currentMetadataContainer) {
        return;
      }

      // At this point: layout is missing, metadata exists
      // Two scenarios trigger re-render:
      // 1. Layout was removed while metadata stayed (simple embed case)
      // 2. Both were removed, metadata came back, layout didn't (section anchor embed case)
      // The MutationObserver will fire when metadata is re-added, at which point
      // we detect: layout missing + metadata exists = need to re-render

      // Clear existing debounce
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      // Debounce the re-render to avoid rapid multiple renders
      debounceTimeout = setTimeout(() => {
        // Double-check conditions before re-rendering
        if (isReRendering || !this.settings.layoutVisible) {
          return;
        }

        const layoutStillMissing = !viewContainer.querySelector(".exocortex-auto-layout");
        const metadataStillExists = viewContainer.querySelector(".metadata-container");

        if (layoutStillMissing && metadataStillExists) {
          isReRendering = true;

          // Create new layout container
          const newLayoutContainer = document.createElement("div");
          newLayoutContainer.className = "exocortex-auto-layout";
          newLayoutContainer.style.cssText = `
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--background-modifier-border);
          `;

          // Insert after metadata container
          metadataStillExists.insertAdjacentElement("afterend", newLayoutContainer);

          // Render layout
          void (async () => {
            try {
              await this.layoutRenderer.render("", newLayoutContainer, {} as MarkdownPostProcessorContext);
            } catch (error) {
              this.logger.error("Failed to re-render layout after embed processing", error);
            } finally {
              // Reset flag after a short delay to allow for DOM stabilization
              this.timerManager.setTimeout(null, () => {
                isReRendering = false;
              }, 100);
            }
          })();
        }
      }, 50); // 50ms debounce
    });

    // Observe the view container for changes in its child list
    // This will detect when the preview content is re-rendered
    this.layoutPersistenceObserver.observe(viewContainer, {
      childList: true,
      subtree: true,
    });
  }

  private async handleMetadataChange(file: TFile): Promise<void> {
    try {
      const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;

      if (!metadata) {
        return;
      }

      // iOS Live Activities: Track status changes to DOING
      await this.taskTrackingService.handleFileChange(file);

      const currentAssetLabel = metadata.exo__Asset_label;
      const currentEndTimestamp = metadata.ems__Effort_endTimestamp;
      const currentPlannedStartTimestamp =
        metadata.ems__Effort_plannedStartTimestamp;
      const cachedMetadata = this.metadataCache.get(file.path);

      if (!cachedMetadata) {
        this.metadataCache.set(file.path, { ...metadata });
        return;
      }

      const previousAssetLabel = cachedMetadata.exo__Asset_label;
      const previousEndTimestamp = cachedMetadata.ems__Effort_endTimestamp;
      const previousPlannedStartTimestamp =
        cachedMetadata.ems__Effort_plannedStartTimestamp;

      if (currentEndTimestamp && currentEndTimestamp !== previousEndTimestamp) {
        this.logger.info(
          `Detected ems__Effort_endTimestamp change in ${file.path}: ${String(previousEndTimestamp)} → ${String(currentEndTimestamp)}`,
        );

        cachedMetadata.ems__Effort_endTimestamp = currentEndTimestamp;

        const parsedDate = new Date(currentEndTimestamp);
        if (!isNaN(parsedDate.getTime())) {
          await this.taskStatusService.syncEffortEndTimestamp(file, parsedDate);
          this.logger.info(
            `Auto-synced ems__Effort_resolutionTimestamp to ${currentEndTimestamp}`,
          );
        }
      }

      if (
        currentPlannedStartTimestamp &&
        currentPlannedStartTimestamp !== previousPlannedStartTimestamp
      ) {
        this.logger.info(
          `Detected ems__Effort_plannedStartTimestamp change in ${file.path}: ${String(previousPlannedStartTimestamp)} → ${String(currentPlannedStartTimestamp)}`,
        );

        cachedMetadata.ems__Effort_plannedStartTimestamp =
          currentPlannedStartTimestamp;

        const currentDate = new Date(
          String(currentPlannedStartTimestamp),
        );
        const previousDate = previousPlannedStartTimestamp
          ? new Date(String(previousPlannedStartTimestamp))
          : null;

        if (
          !isNaN(currentDate.getTime()) &&
          previousDate &&
          !isNaN(previousDate.getTime())
        ) {
          const deltaMs = currentDate.getTime() - previousDate.getTime();
          await this.taskStatusService.shiftPlannedEndTimestamp(file, deltaMs);
          this.logger.info(
            `Shifted ems__Effort_plannedEndTimestamp by ${deltaMs}ms`,
          );
        }
      }

      if (
        currentAssetLabel &&
        typeof currentAssetLabel === "string" &&
        currentAssetLabel !== previousAssetLabel
      ) {
        this.logger.info(
          `Detected exo__Asset_label change in ${file.path}: ${String(previousAssetLabel)} → ${currentAssetLabel}`,
        );

        cachedMetadata.exo__Asset_label = currentAssetLabel;

        await this.aliasSyncService.syncAliases(
          file,
          typeof previousAssetLabel === "string" ? previousAssetLabel : null,
          currentAssetLabel,
        );

        this.logger.info(
          `Auto-synced aliases for exo__Asset_label change`,
        );
      }

      this.metadataCache.set(file.path, { ...metadata });

      // Dispatch webhook events for metadata changes
      await this.webhookDispatcher.handleMetadataChange(file);
    } catch (error) {
      this.logger.error(
        `Failed to handle metadata change for ${file.path}`,
        error as Error,
      );
    }
  }

  private removeAutoRenderedLayouts(): void {
    document
      .querySelectorAll(".exocortex-auto-layout")
      .forEach((el) => el.remove());
  }
}
