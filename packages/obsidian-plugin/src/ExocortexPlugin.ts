import "reflect-metadata";
import {
  MarkdownPostProcessorContext,
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";
import { container } from "tsyringe";
import { UniversalLayoutRenderer } from "./presentation/renderers/UniversalLayoutRenderer";
import { ILogger } from "./adapters/logging/ILogger";
import { LoggerFactory } from "./adapters/logging/LoggerFactory";
import { Logger } from "./adapters/logging/Logger";
import { FileLogChannel } from "./adapters/logging/FileLogChannel";
import { CommandManager } from "./application/services/CommandManager";
import {
  ExocortexSettings,
  DEFAULT_SETTINGS,
  DEFAULT_LOG_CHANNELS,
} from "./domain/settings/ExocortexSettings";
import { ExocortexSettingTab } from "./presentation/settings/ExocortexSettingTab";
import {
  TaskStatusService,
  CommandResolver,
  PreconditionEvaluator,
  GroundingExecutor,
  ServiceRegistry,
  RelationColumnSetResolver,
  LayoutSelector,
} from "exocortex";
import {
  RelationColumnSetRepository,
  ObsidianRelationColumnSetAdapter,
  ExoLayoutRepository,
  ObsidianExoLayoutAdapter,
} from "./infrastructure/repositories";
import { ObsidianVaultAdapter } from "./adapters/ObsidianVaultAdapter";
import { ObsidianQueryBodyResolver } from "./infrastructure/ObsidianQueryBodyResolver";
import { TaskTrackingService } from "./application/services/TaskTrackingService";
import { AliasSyncService } from "./application/services/AliasSyncService";
import { WikilinkAliasService } from "./application/services/WikilinkAliasService";
import { ThemeResolver } from "./application/services/ThemeResolver";
import { PanelResolver } from "./application/services/PanelResolver";
import {
  createCommandPanelFromFrontmatter,
  isLayoutFrontmatter,
} from "./domain/layout";
import { isCommandBindingFrontmatter } from "exocortex";
import { SPARQLCodeBlockProcessor } from "./application/processors/SPARQLCodeBlockProcessor";
import { LayoutCodeBlockProcessor } from "./application/processors/LayoutCodeBlockProcessor";
import { SPARQLApi } from "./application/api/SPARQLApi";
import { ExocortexAPI } from "./application/api/ExocortexAPI";
import { PluginContainer } from "./infrastructure/di/PluginContainer";
import { ObsidianNotificationService } from "./infrastructure/di/ObsidianNotificationService";
import {
  createAliasIconExtension,
  createWikilinkLabelExtension,
} from "./presentation/editor-extensions";
import {
  ChangelogModal,
  shouldShowChangelog,
} from "./presentation/modals/ChangelogModal";
import { TimerManager } from "./infrastructure/timer";
import { LRUCache } from "./infrastructure/cache";
import { TabTitlePatch } from "./presentation/tab-titles/TabTitlePatch";
import { InlineTitlePatch } from "./presentation/tab-titles/InlineTitlePatch";
import { PropertiesLinkPatch } from "./presentation/properties/PropertiesLinkPatch";
import { PropertiesUidCopyPatch } from "./presentation/properties/PropertiesUidCopyPatch";
import { PropertiesLabelPatch } from "./presentation/properties/PropertiesLabelPatch";
import { FileExplorerLabelPatch } from "./presentation/fileexplorer/FileExplorerLabelPatch";
import { FileExplorerIconPatch } from "./presentation/fileexplorer/FileExplorerIconPatch";
import { IconizeDetector } from "./presentation/fileexplorer/IconizeDetector";
import { ReadingModeEnforcer } from "./presentation/reading-mode/ReadingModeEnforcer";
import { BodyLinkPatch } from "./presentation/body/BodyLinkPatch";
import { GraphViewPatch } from "./presentation/graph-view/GraphViewPatch";
import { PrintNameRuleService } from "./domain/display-name/PrintNameRuleService";
import { ObsidianFileSystemAdapter } from "./adapters/ObsidianFileSystemAdapter";
import { populateServiceRegistry } from "./infrastructure/services/ServiceRegistryPopulator";
import { UiOntologyBootstrapper } from "./infrastructure/ontology/UiOntologyBootstrapper";
import { ObsidianUiOntologyBootstrapperVault } from "./infrastructure/ontology/ObsidianUiOntologyBootstrapperVault";
import { ExoLayoutOntologyBootstrapper } from "./infrastructure/ontology/ExoLayoutOntologyBootstrapper";
import { ObsidianExoLayoutOntologyBootstrapperVault } from "./infrastructure/ontology/ObsidianExoLayoutOntologyBootstrapperVault";

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
  themeResolver!: ThemeResolver;
  panelResolver!: PanelResolver;
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
  printNameRuleService!: PrintNameRuleService;
  commandResolver!: CommandResolver;
  preconditionEvaluator!: PreconditionEvaluator;
  groundingExecutor!: GroundingExecutor;
  serviceRegistry!: ServiceRegistry;
  private relationColumnSetRepository: RelationColumnSetRepository | null = null;
  private relationColumnSetResolver: RelationColumnSetResolver | null = null;
  private exoLayoutRepository: ExoLayoutRepository | null = null;
  private layoutSelector: LayoutSelector | null = null;
  private timerManager!: TimerManager;
  // MutationObserver to detect when layout is removed by Obsidian re-renders (e.g., when processing embeds)
  private layoutPersistenceObserver: MutationObserver | null = null;
  private tabTitlePatch!: TabTitlePatch;
  private inlineTitlePatch!: InlineTitlePatch;
  private propertiesLinkPatch!: PropertiesLinkPatch;
  private bodyLinkPatch!: BodyLinkPatch;
  private propertiesUidCopyPatch!: PropertiesUidCopyPatch;
  private propertiesLabelPatch!: PropertiesLabelPatch;
  private fileExplorerLabelPatch!: FileExplorerLabelPatch;
  private fileExplorerIconPatch!: FileExplorerIconPatch;
  private readingModeEnforcer!: ReadingModeEnforcer;
  private graphViewPatch!: GraphViewPatch;
  private fileLogChannel!: FileLogChannel;
  private notifier!: ObsidianNotificationService;
  // Issue #2780: tracked so the post-resolve reindex can await it before
  // calling refresh(), avoiding a concurrent clear()/convertVault() race.
  private eagerInitPromise: Promise<void> | null = null;

  override async onload(): Promise<void> {
    try {
      // Initialize DI container (Phase 1 infrastructure)
      PluginContainer.setup(this.app, this);

      this.logger = LoggerFactory.create("ExocortexPlugin");
      this.logger.info("Loading Exocortex Plugin");

      // Initialize timer manager for lifecycle-safe setTimeout/setInterval
      this.timerManager = new TimerManager();

      await this.loadSettings();

      // Initialize notification service and log channel routing
      this.notifier = new ObsidianNotificationService();
      this.fileLogChannel = new FileLogChannel(this.app.vault.adapter);
      await this.fileLogChannel.ensureFileExists();
      this.configureLogChannels();

      this.printNameRuleService = new PrintNameRuleService(this.app);
      this.printNameRuleService.initialize();

      this.registerEvent(
        this.app.metadataCache.on("changed", () => {
          this.printNameRuleService.refresh();
        }),
      );

      this.vaultAdapter = new ObsidianVaultAdapter(
        this.app.vault,
        this.app.metadataCache,
        this.app,
      );

      const notifier = this.notifier;
      this.sparqlProcessor = new SPARQLCodeBlockProcessor(this, notifier);
      this.layoutProcessor = new LayoutCodeBlockProcessor(this);
      this.sparql = new SPARQLApi(this);
      this.api = new ExocortexAPI(this);

      // RFC-009: Wire Dynamic Command System services BEFORE renderer
      // Construct manually (not via tsyringe) because they need the live triple store
      const tripleStore = this.sparql.getTripleStore();
      this.commandResolver = new CommandResolver(tripleStore, this.logger);
      const queryBodyResolver = new ObsidianQueryBodyResolver(this.app);
      this.preconditionEvaluator = new PreconditionEvaluator(
        tripleStore,
        queryBodyResolver,
      );
      // Vault changes invalidate the cached UID→path index.
      this.registerEvent(
        this.app.metadataCache.on("changed", () =>
          queryBodyResolver.invalidateCache(),
        ),
      );
      this.registerEvent(
        this.app.vault.on("delete", () =>
          queryBodyResolver.invalidateCache(),
        ),
      );
      this.registerEvent(
        this.app.vault.on("rename", () =>
          queryBodyResolver.invalidateCache(),
        ),
      );
      this.serviceRegistry = new ServiceRegistry();
      const obsidianFs = new ObsidianFileSystemAdapter(this.app.vault);
      this.groundingExecutor = new GroundingExecutor(
        obsidianFs,
        obsidianFs,
        this.serviceRegistry,
      );

      populateServiceRegistry(this.serviceRegistry, {
        app: this.app,
        fileSystemAdapter: obsidianFs,
        sparqlApi: this.sparql,
        vaultAdapter: this.vaultAdapter,
      });

      // Issue #2943 — install the `ui__RelationColumnSet` ontology (7 files)
      // into the vault before the repository initialises, so the snapshot
      // can pick up the class + property assets on first rebuild.
      //
      // Idempotency is UID-first (`metadataCache.getFirstLinkpathDest`) then
      // path-level — catches legacy copies at non-default folders (e.g.
      // starter-kit `03 Knowledge/ui/` convention) and prevents duplicate
      // `exo__Asset_uid` assets on plugin upgrade. Errors on individual
      // writes are logged but do not abort plugin load.
      try {
        const bootstrapResult = await new UiOntologyBootstrapper(
          new ObsidianUiOntologyBootstrapperVault(
            this.app.vault,
            this.app.metadataCache,
          ),
        ).bootstrap();
        if (bootstrapResult.created.length > 0) {
          this.logger.info("UiOntologyBootstrapper", {
            message: `installed ${bootstrapResult.created.length} ontology file(s)`,
            created: bootstrapResult.created,
          });
        }
        if (bootstrapResult.errors.length > 0) {
          for (const err of bootstrapResult.errors) {
            this.logger.warn("UiOntologyBootstrapper", {
              message: `failed to install ${err.path}: ${err.error.message}`,
            });
          }
        }
      } catch (err) {
        this.logger.warn("UiOntologyBootstrapper", {
          message: `bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // RFC be70f741 Phase 3 — wire RelationColumnSetRepository + Resolver so
      // `UniversalLayoutRenderer` → `RelationsRenderer` can consult the index
      // when composing `groupSpecificProperties`.  Initialize BEFORE the
      // renderer construction so the snapshot is populated when the resolver
      // is first invoked.  The `enableRelationColumnSetResolver` flag gates
      // consumption — the repository always runs so the snapshot is warm if
      // the flag is toggled at runtime.
      const relationColumnSetLogger = {
        warn: (message: string) =>
          this.logger.warn("RelationColumnSet", { message }),
        info: (message: string) =>
          this.logger.info("RelationColumnSet", { message }),
      };
      this.relationColumnSetRepository = new RelationColumnSetRepository(
        new ObsidianRelationColumnSetAdapter(this.app),
        { logger: relationColumnSetLogger },
      );
      this.relationColumnSetRepository.initialize();
      const repo = this.relationColumnSetRepository;
      this.relationColumnSetResolver = new RelationColumnSetResolver(
        () => repo.getSnapshot().all,
        { logger: relationColumnSetLogger },
      );

      // RFC exo__Layout Phase 4 — install the 18-file `exo__Layout` ontology
      // (4 classes + 14 properties) into the vault before the repository
      // initialises, so the snapshot can pick up the class + property assets
      // on first rebuild. Without this, a vault that has not manually imported
      // the starter-kit `exo/` folder cannot render any `exo__Layout` asset
      // (wikilinks dangle). Idempotency is UID-first then path-level — same
      // semantics as the `ui__RelationColumnSet` bootstrapper (v15.121.1).
      try {
        const exoLayoutBootstrapResult =
          await new ExoLayoutOntologyBootstrapper(
            new ObsidianExoLayoutOntologyBootstrapperVault(
              this.app.vault,
              this.app.metadataCache,
            ),
          ).bootstrap();
        if (exoLayoutBootstrapResult.created.length > 0) {
          this.logger.info("ExoLayoutOntologyBootstrapper", {
            message: `installed ${exoLayoutBootstrapResult.created.length} ontology file(s)`,
            created: exoLayoutBootstrapResult.created,
          });
        }
        if (exoLayoutBootstrapResult.errors.length > 0) {
          for (const err of exoLayoutBootstrapResult.errors) {
            this.logger.warn("ExoLayoutOntologyBootstrapper", {
              message: `failed to install ${err.path}: ${err.error.message}`,
            });
          }
        }
      } catch (err) {
        this.logger.warn("ExoLayoutOntologyBootstrapper", {
          message: `bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // RFC exo__Layout Phase 2 — wire ExoLayoutRepository + LayoutSelector
      // using the same live-snapshot pattern as RelationColumnSet.
      const exoLayoutLogger = {
        warn: (message: string) => this.logger.warn("ExoLayout", { message }),
        info: (message: string) => this.logger.info("ExoLayout", { message }),
      };
      this.exoLayoutRepository = new ExoLayoutRepository(
        new ObsidianExoLayoutAdapter(this.app),
        { logger: exoLayoutLogger },
      );
      this.exoLayoutRepository.initialize();
      const exoLayoutRepo = this.exoLayoutRepository;
      this.layoutSelector = new LayoutSelector({
        get all() {
          return exoLayoutRepo.getSnapshot().layouts;
        },
      });

      // RFC-024 Phase 3 — PanelResolver constructed early so that
      // UniversalLayoutRenderer (and through it, ButtonGroupsBuilder /
      // DynamicCommandButtonGroupBuilder) shares the same instance with
      // the metadata-cache invalidation hooks wired further below.
      //
      // T6.4 — `layoutProvider` scans vault metadata for the `exo__Layout`
      // asset whose `targetClass` matches the requested class reference and
      // returns its parsed `commandPanel` slot. Multiple matches are
      // resolved by `exo__Layout_priority` ASC (RFC-024 §5 rule #1).
      // Result is memoised by PanelResolver per class until a layout /
      // binding / class-membership change invalidates the entry, so the
      // O(N markdown files) scan runs at most once per class until vault
      // state shifts. Only the `commandPanel` slot is extracted (other
      // Layout fields require async block resolution and are out of scope
      // for the panel resolver).
      this.panelResolver = new PanelResolver({
        layoutProvider: (classRef) => {
          const files = this.app.vault.getMarkdownFiles();
          let bestPanel: ReturnType<typeof createCommandPanelFromFrontmatter> =
            null;
          let bestPriority = Number.POSITIVE_INFINITY;
          for (const file of files) {
            const fm = this.app.metadataCache.getFileCache(file)
              ?.frontmatter as Record<string, unknown> | undefined;
            if (!fm || !isLayoutFrontmatter(fm)) continue;
            const targetRaw = fm["exo__Layout_targetClass"];
            if (typeof targetRaw !== "string") continue;
            const target = targetRaw
              .trim()
              .replace(/^\[\[|\]\]$/g, "")
              .split("|")[0]
              .trim();
            if (target !== classRef) continue;
            const priorityRaw = fm["exo__Layout_priority"];
            const priority =
              typeof priorityRaw === "number" && Number.isFinite(priorityRaw)
                ? priorityRaw
                : 0;
            if (priority >= bestPriority) continue;
            const panel = createCommandPanelFromFrontmatter(
              fm["exo__Layout_commandPanel"],
            );
            if (panel === null) continue;
            bestPanel = panel;
            bestPriority = priority;
          }
          return bestPanel === null ? null : { commandPanel: bestPanel };
        },
      });

      this.layoutRenderer = new UniversalLayoutRenderer(
        this.app,
        this.settings,
        this,
        this.vaultAdapter,
        {
          commandResolver: this.commandResolver,
          preconditionEvaluator: this.preconditionEvaluator,
          groundingExecutor: this.groundingExecutor,
          notificationService: notifier,
          relationColumnSetResolver: this.relationColumnSetResolver,
          exoLayoutRepository: this.exoLayoutRepository,
          layoutSelector: this.layoutSelector,
          panelResolver: this.panelResolver,
        },
      );
      this.taskStatusService = container.resolve(TaskStatusService);
      this.taskTrackingService = new TaskTrackingService(
        this.app,
        this.app.vault,
        this.app.metadataCache,
      );
      this.aliasSyncService = new AliasSyncService(
        this.app.metadataCache,
        this.app,
      );
      this.wikilinkAliasService = new WikilinkAliasService(
        this.app,
        this.app.metadataCache,
      );

      // RFC-024 Phase 1 — Theme resolver for class-level visual accents.
      // RFC-024 §4 Phase 4 (T7.3) — `layoutProvider` scans vault metadata for
      // the `exo__Layout` asset whose `targetClass` matches the requested
      // class reference and returns its parsed visual slots (accentColor,
      // icon, labelTypography). Multiple matches are resolved by
      // `exo__Layout_priority` ASC (RFC-024 §5 rule #1). Result is memoised
      // by ThemeResolver per class until a layout edit invalidates the entry,
      // so the O(N markdown files) scan runs at most once per class until
      // vault state shifts. Mirrors the PanelResolver wiring above.
      this.themeResolver = new ThemeResolver({
        layoutProvider: (classRef) => {
          const files = this.app.vault.getMarkdownFiles();
          let bestSlots:
            | {
                accentColor?: string;
                icon?: string;
                labelTypography?: import("@plugin/domain/layout").LabelTypography;
              }
            | null = null;
          let bestPriority = Number.POSITIVE_INFINITY;
          for (const file of files) {
            const fm = this.app.metadataCache.getFileCache(file)
              ?.frontmatter as Record<string, unknown> | undefined;
            if (!fm || !isLayoutFrontmatter(fm)) continue;
            const targetRaw = fm["exo__Layout_targetClass"];
            if (typeof targetRaw !== "string") continue;
            const target = targetRaw
              .trim()
              .replace(/^\[\[|\]\]$/g, "")
              .split("|")[0]
              .trim();
            if (target !== classRef) continue;
            const priorityRaw = fm["exo__Layout_priority"];
            const priority =
              typeof priorityRaw === "number" && Number.isFinite(priorityRaw)
                ? priorityRaw
                : 0;
            if (priority >= bestPriority) continue;
            const accentRaw = fm["exo__Layout_accentColor"];
            const iconRaw = fm["exo__Layout_icon"];
            const typoRaw = fm["exo__Layout_labelTypography"];
            const slots: {
              accentColor?: string;
              icon?: string;
              labelTypography?: import("@plugin/domain/layout").LabelTypography;
            } = {};
            if (typeof accentRaw === "string" && accentRaw.trim().length > 0) {
              slots.accentColor = accentRaw.trim();
            }
            if (typeof iconRaw === "string" && iconRaw.trim().length > 0) {
              slots.icon = iconRaw.trim();
            }
            if (
              typoRaw === "small" ||
              typoRaw === "medium" ||
              typoRaw === "large"
            ) {
              slots.labelTypography = typoRaw;
            }
            bestSlots = slots;
            bestPriority = priority;
          }
          return bestSlots;
        },
      });
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
          if (fm && isLayoutFrontmatter(fm as Record<string, unknown>)) {
            this.themeResolver.invalidate();
          }
        }),
      );

      // RFC-024 Phase 3 — Panel resolver invalidation hooks (3 axes:
      // layout edit / binding edit / class change). The instance itself
      // is created earlier so the layout renderer can share it. The
      // `layoutProvider` is still a placeholder — wiring it to the
      // ExoLayoutRepository lookup is tracked separately; until then
      // `applyFilter` and `isFeatured` are non-breaking no-ops.
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
          if (!fm) return;
          // Axis 1 — Layout asset edited (panel spec / target class / order).
          if (isLayoutFrontmatter(fm)) {
            this.panelResolver.invalidateOnLayoutChange();
            return;
          }
          // Axis 2 — Binding asset edited; may be referenced by
          // featuredBinding / excludeCommands of any panel.
          if (isCommandBindingFrontmatter(fm)) {
            this.panelResolver.invalidateOnBindingChange();
          }
          // Axis 3 — Class membership change is observed via the
          // metadataCache `changed` event itself when `exo__Instance_class`
          // is mutated; the affected file's previous class is unknown
          // here, so the safest invariant is to clear all entries.
          // (Falls through to full invalidation below.)
        }),
      );
      // Axis 3 wiring — explicit hook for class membership renames /
      // deletions that the `changed` predicate above cannot detect.
      this.registerEvent(
        this.app.metadataCache.on("deleted", () => {
          this.panelResolver.invalidateOnClassChange();
        }),
      );
      this.registerEvent(
        this.app.vault.on("rename", () => {
          this.panelResolver.invalidateOnClassChange();
        }),
      );

      this.metadataCache = new LRUCache({
        maxEntries: 1000,
        ttl: 5 * 60 * 1000, // 5 minutes
      });

      // Register the alias icon editor extension for Live Preview mode
      this.registerEditorExtension(
        createAliasIconExtension(
          this.app,
          this.app.metadataCache,
          this.wikilinkAliasService,
          (message: string) => notifier.info(message),
        ),
      );

      // Register wikilink label extension for Live Preview mode
      // Displays wikilinks using DisplayNameResolver + PrintNameRule templates
      this.registerEditorExtension(
        createWikilinkLabelExtension(
          this.app,
          this.app.metadataCache,
          this.settings,
          this.printNameRuleService,
        ),
      );

      // Initialize CommandManager and register all commands
      this.commandManager = new CommandManager(this.app);
      this.commandManager.registerAllCommands(this, () =>
        this.autoRenderLayout(),
      );

      // GTD Capture: one-click fleeting note to inbox.
      // Delegates to the existing `create-fleeting-note` command so the
      // ribbon and command palette share a single implementation.
      this.addRibbonIcon("inbox", "Capture to inbox (fleeting note)", () => {
        void this.commandManager.executeCommand("create-fleeting-note");
      });

      this.addSettingTab(new ExocortexSettingTab(this.app, this));

      this.registerMarkdownCodeBlockProcessor("sparql", (source, el, ctx) =>
        this.sparqlProcessor.process(source, el, ctx),
      );

      this.registerMarkdownCodeBlockProcessor("exoql", (source, el, ctx) =>
        this.sparqlProcessor.process(source, el, ctx),
      );

      this.registerMarkdownCodeBlockProcessor("exo-layout", (source, el, ctx) =>
        this.layoutProcessor.process(source, el, ctx),
      );

      // Issue #2780: Re-index triple store once metadataCache has fully resolved.
      //
      // onLayoutReady (below) triggers an eager store init so buttons render
      // fast on first paint — but at that point Obsidian's metadataCache may
      // still be parsing files, so `getFrontmatter(file)` returns null for
      // any file whose YAML hasn't been parsed yet. NoteToRDFConverter silently
      // skips those files, leaving them with 0 triples in the store.
      //
      // For non-preconditioned commands this is invisible (binding triples come
      // from starter-kit files that are parsed early), but preconditioned
      // commands run SPARQL ASKs like `$target ems:Effort_status ?s` against
      // the TARGET file's triples — and when those are missing, the ASK returns
      // false, fail-closed → every preconditioned command is silently hidden.
      // A later mutation to the file triggers `VaultRDFIndexer.updateFile`,
      // which re-runs convertNote with warm metadata and fills in the missing
      // triples — that's why clicking any mutating command on the file magically
      // "wakes up" the hidden commands.
      //
      // `metadataCache.on("resolved")` is Obsidian's signal that the initial
      // vault parse is complete. Once it fires, we await the eager-init promise
      // (so the two paths serialize — `refresh()` calls clear()+convertVault()
      // and we don't want that interleaved with an in-flight init) and then do
      // a full reindex. The one-shot flag keeps this to a single refresh per
      // plugin load; per-file mutations still go through `vault.on("modify")`.
      let postResolveReindexDone = false;
      this.registerEvent(
        this.app.metadataCache.on("resolved", () => {
          this.layoutRenderer.invalidateBacklinksCache();

          if (postResolveReindexDone) return;
          postResolveReindexDone = true;

          const initPromise = this.eagerInitPromise ?? Promise.resolve();
          void initPromise
            .then(() => this.sparql.refresh())
            .then(() => {
              this.commandResolver.invalidateCache();
              this.preconditionEvaluator.invalidateCache();
              this.autoRenderLayout();
            })
            .catch((err) => {
              this.logger.error(
                "Failed to reindex triple store after metadataCache resolved",
                err,
              );
            });
        }),
      );

      // Issue #2785: hot-mutation cache invalidation.
      //
      // After an inline-button command writes frontmatter (e.g. `Set Status Doing`),
      // `metadataCache.on("changed")` fires with guaranteed-fresh frontmatter —
      // this is the right event to drive a re-index. `vault.on("modify")` alone
      // is insufficient because it can fire before metadataCache has re-parsed
      // the file, causing a re-index against stale values, and even when it
      // doesn't race, nothing triggers `autoRenderLayout` after the mutation —
      // so the COMMANDS panel stays stale until Obsidian restart.
      //
      // Fix: schedule a debounced, per-file re-index that swaps the file's
      // triples → invalidates the command caches → re-renders active layouts.
      // Symmetric to #2780 but for incremental mutations rather than cold start.
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          this.handleMetadataChange(file);
          this.scheduleHotReindex(file);
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
            this.timerManager.setTimeout(
              "auto-layout-file-open",
              () => this.autoRenderLayout(),
              150,
            );
          }
        }),
      );

      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          this.timerManager.setTimeout(
            "auto-layout-leaf-change",
            () => this.autoRenderLayout(),
            150,
          );
        }),
      );

      this.registerEvent(
        this.app.workspace.on("layout-change", () => {
          this.timerManager.setTimeout(
            "auto-layout-change",
            () => this.autoRenderLayout(),
            150,
          );
        }),
      );

      // Initial render
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        this.timerManager.setTimeout(
          "auto-layout-initial",
          () => this.autoRenderLayout(),
          150,
        );
      }

      // RFC-009: Eagerly initialize triple store after vault is ready.
      // onLayoutReady fires after Obsidian finishes mounting vault files.
      // Without this, VaultRDFIndexer.initialize() finds 0 files → 0 triples
      // → CommandResolver finds no bindings → dynamic buttons don't render.
      //
      // NB: At this point metadataCache is typically NOT fully resolved yet.
      // The `metadataCache.on("resolved")` handler above awaits this promise
      // and then refreshes the store to pick up any files that were skipped
      // because their frontmatter wasn't parsed in time. See issue #2780.
      this.eagerInitPromise = new Promise<void>((resolve) => {
        this.app.workspace.onLayoutReady(() => {
          void this.sparql
            .query("ASK { ?s ?p ?o }")
            .then(() => {
              this.commandResolver.invalidateCache();
              this.autoRenderLayout();
            })
            .catch((err) => {
              this.logger.error(
                "Failed to eagerly initialize triple store",
                err,
              );
            })
            .finally(() => {
              resolve();
            });
        });
      });

      // Initialize Tab Title label patch
      this.tabTitlePatch = new TabTitlePatch(this);
      if (this.settings.showLabelsInTabTitles) {
        // Delay enabling to ensure workspace is fully loaded
        this.timerManager.setTimeout(
          "tab-title-patch",
          () => {
            this.tabTitlePatch.enable();
          },
          500,
        );
      }

      // Initialize Inline Title label patch (Issue #2806)
      // Reuses the tab-title label toggle so both headers stay in sync.
      this.inlineTitlePatch = new InlineTitlePatch(this);
      if (this.settings.showLabelsInTabTitles) {
        this.timerManager.setTimeout(
          "inline-title-patch",
          () => {
            this.inlineTitlePatch.enable();
          },
          500,
        );
      }

      // Initialize Properties link patch
      this.propertiesLinkPatch = new PropertiesLinkPatch(this);
      if (this.settings.showLabelsInProperties) {
        // Delay enabling to ensure Properties block is fully loaded
        this.timerManager.setTimeout(
          "properties-link-patch",
          () => {
            this.propertiesLinkPatch.enable();
          },
          500,
        );
      }

      // Initialize Properties UID copy button patch (always enabled)
      this.propertiesUidCopyPatch = new PropertiesUidCopyPatch(this, notifier);
      this.timerManager.setTimeout(
        "properties-uid-copy-patch",
        () => {
          this.propertiesUidCopyPatch.enable();
        },
        500,
      );

      // Initialize Properties readable-label patch (always enabled)
      // Replaces raw predicate names (e.g. ems__Effort_area) with human-readable
      // labels resolved from property definition assets' exo__Asset_label.
      this.propertiesLabelPatch = new PropertiesLabelPatch(this);
      this.timerManager.setTimeout(
        "properties-label-patch",
        () => {
          this.propertiesLabelPatch.enable();
        },
        500,
      );

      // Initialize File Explorer readable-label patch (always enabled).
      // Replaces UUID filenames in the sidebar with `exo__Asset_label`.
      // Finding: Ваня Холькин UX audit 2026-04-12 09:32 — «Структура уродская»;
      // File Explorer still showed bare UUIDs after v15.98.0 fixed inline title.
      // Issue #2802.
      this.fileExplorerLabelPatch = new FileExplorerLabelPatch(this);
      this.timerManager.setTimeout(
        "file-explorer-label-patch",
        () => {
          this.fileExplorerLabelPatch.enable();
        },
        500,
      );

      // RFC-024 Phase 4 — File Explorer icons (DOM overlay, sibling to
      // FileExplorerLabelPatch). Renders Lucide icons resolved via
      // ThemeResolver from `exo__Layout_icon` for class-bearing notes.
      this.fileExplorerIconPatch = new FileExplorerIconPatch(
        this,
        this.themeResolver,
      );
      // RFC-024 §8 (T7.2) — log Iconize plugin coexistence handshake. Per-row
      // skip happens inside FileExplorerIconPatch.hasIconizeOverlay; this
      // startup log lets users see which plugin "wins" on iconized rows.
      const iconize = IconizeDetector.detect(this.app);
      if (iconize.detected) {
        this.logger.info("FileExplorerIconPatch", {
          message:
            `Iconize community plugin detected (${iconize.pluginId}); ` +
            "Exocortex will skip overlay on rows already iconized by Iconize.",
        });
      }
      if (this.settings.showIconsInFileExplorer) {
        this.timerManager.setTimeout(
          "file-explorer-icon-patch",
          () => {
            this.fileExplorerIconPatch.enable();
          },
          500,
        );
      }

      // Initialize Reading Mode enforcer.
      // Obsidian's layout rendering path is Reading Mode only; new leaves open
      // in Live Preview by default, so first-time users see "nothing happens"
      // on Exocortex assets. Enforcer flips the leaf to preview mode on
      // file-open for notes with `exo__Instance_class`. Opt-out via settings.
      // Finding 9, UX audit 2026-04-14.
      this.readingModeEnforcer = new ReadingModeEnforcer(this);
      if (this.settings.autoReadingModeForExocortexAssets) {
        this.timerManager.setTimeout(
          "reading-mode-enforcer",
          () => {
            this.readingModeEnforcer.enable();
          },
          500,
        );
      }

      // Initialize Body link patch
      this.bodyLinkPatch = new BodyLinkPatch(this);
      if (this.settings.showLabelsInBody) {
        // Delay enabling to ensure markdown body is fully loaded
        this.timerManager.setTimeout(
          "body-link-patch",
          () => {
            this.bodyLinkPatch.enable();
          },
          500,
        );
      }

      // Initialize Graph View label patch
      this.graphViewPatch = new GraphViewPatch(this);
      if (this.settings.showLabelsInGraphView) {
        // Delay enabling to ensure Graph View is fully loaded
        this.timerManager.setTimeout(
          "graph-view-patch",
          () => {
            this.graphViewPatch.enable();
          },
          500,
        );
      }

      // RFC-024 Phase 0: first-launch-after-upgrade changelog modal.
      // Fresh installs have no prior behaviour to contrast, so we silently seed
      // `lastShownChangelogVersion` and skip the modal (avoids onboarding noise
      // and unblocks E2E test vaults that boot from an empty data.json).
      // Delayed 500ms so Obsidian's own modal stack has settled and the
      // workspace is interactive before we surface a dialog.
      const currentVersion = this.manifest.version;
      if (this.isFreshInstall) {
        this.settings.lastShownChangelogVersion = currentVersion;
        void this.saveSettings();
      } else if (
        shouldShowChangelog(
          this.settings.lastShownChangelogVersion,
          currentVersion,
        )
      ) {
        this.timerManager.setTimeout(
          "rfc024-changelog-modal",
          () => {
            const modal = new ChangelogModal(
              this.app,
              currentVersion,
              (version) => {
                this.settings.lastShownChangelogVersion = version;
                void this.saveSettings();
              },
            );
            modal.open();
          },
          500,
        );
      }

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

    // RFC be70f741 Phase 3 — release metadataCache subscriptions and pending
    // debounce timers held by the RelationColumnSetRepository.
    if (this.relationColumnSetRepository) {
      this.relationColumnSetRepository.dispose();
      this.relationColumnSetRepository = null;
      this.relationColumnSetResolver = null;
    }

    // RFC exo__Layout Phase 2 — release ExoLayoutRepository subscriptions.
    if (this.exoLayoutRepository) {
      this.exoLayoutRepository.dispose();
      this.exoLayoutRepository = null;
      this.layoutSelector = null;
    }

    // Cleanup metadata cache
    if (this.metadataCache) {
      this.metadataCache.cleanup();
    }

    // Cleanup Tab Title patch
    if (this.tabTitlePatch) {
      this.tabTitlePatch.cleanup();
    }

    // Cleanup Inline Title patch
    if (this.inlineTitlePatch) {
      this.inlineTitlePatch.cleanup();
    }

    // Cleanup Properties link patch
    if (this.propertiesLinkPatch) {
      this.propertiesLinkPatch.cleanup();
    }

    // Cleanup Properties UID copy button patch
    if (this.propertiesUidCopyPatch) {
      this.propertiesUidCopyPatch.cleanup();
    }

    // Cleanup Properties readable-label patch
    if (this.propertiesLabelPatch) {
      this.propertiesLabelPatch.cleanup();
    }

    // Cleanup File Explorer readable-label patch
    if (this.fileExplorerLabelPatch) {
      this.fileExplorerLabelPatch.cleanup();
    }

    // Cleanup File Explorer icon patch (RFC-024 Phase 4)
    if (this.fileExplorerIconPatch) {
      this.fileExplorerIconPatch.cleanup();
    }

    // Cleanup Body link patch
    if (this.bodyLinkPatch) {
      this.bodyLinkPatch.cleanup();
    }

    // Cleanup Graph View patch
    if (this.graphViewPatch) {
      this.graphViewPatch.cleanup();
    }

    // Reset log channel routing
    Logger.resetChannels();

    this.logger?.info("Exocortex Plugin unloaded");
  }

  /**
   * True when the plugin data file did not exist at startup — i.e. this is a
   * brand-new install with no prior user state. Used to suppress the RFC-024
   * Phase 0 changelog modal for users who never had pre-recoloring behaviour
   * (nothing to inform them about).
   */
  private isFreshInstall = false;

  async loadSettings(): Promise<void> {
    const rawData = await this.loadData();
    this.isFreshInstall = rawData == null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);
    // Ensure logChannels exists for users upgrading from older versions
    if (!this.settings.logChannels) {
      this.settings.logChannels = DEFAULT_LOG_CHANNELS;
    }
  }

  /**
   * Apply current log channel settings to the Logger subsystem.
   * Called on init and whenever log channel settings change.
   */
  configureLogChannels(): void {
    const hasFileEnabled = Object.values(this.settings.logChannels).some(
      (c) => c.file,
    );
    Logger.configure({
      channels: this.settings.logChannels,
      fileChannel: hasFileEnabled ? this.fileLogChannel : null,
      noticeCallback: (msg: string) => this.notifier.info(msg),
    });
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
   * Toggle Tab Title label display on/off
   * Called from settings when the showLabelsInTabTitles toggle changes
   */
  toggleTabTitleLabels(enabled: boolean): void {
    if (enabled) {
      this.tabTitlePatch.enable();
      this.inlineTitlePatch?.enable();
    } else {
      this.tabTitlePatch.disable();
      this.inlineTitlePatch?.disable();
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
   * Toggle Graph View label display on/off
   * Called from settings when the showLabelsInGraphView toggle changes
   */
  toggleGraphViewLabels(enabled: boolean): void {
    if (enabled) {
      this.graphViewPatch.enable();
    } else {
      this.graphViewPatch.disable();
    }
  }

  /**
   * Toggle File Explorer class-icon overlay on/off (RFC-024 §4 Phase 4).
   * Called from settings when the showIconsInFileExplorer toggle changes.
   */
  toggleFileExplorerIcons(enabled: boolean): void {
    if (!this.fileExplorerIconPatch) return;
    if (enabled) {
      this.fileExplorerIconPatch.enable();
    } else {
      this.fileExplorerIconPatch.disable();
    }
  }

  /**
   * Apply display name template changes
   * Called from settings when the displayNameTemplate changes
   * Triggers re-evaluation of tab titles, file explorer labels, properties links, and body links
   */
  applyDisplayNameTemplate(): void {
    // Re-apply tab title labels with new template
    if (this.settings.showLabelsInTabTitles && this.tabTitlePatch) {
      this.tabTitlePatch.disable();
      this.tabTitlePatch.enable();
    }

    // Re-apply inline title labels with new template (Issue #2806)
    if (this.settings.showLabelsInTabTitles && this.inlineTitlePatch) {
      this.inlineTitlePatch.disable();
      this.inlineTitlePatch.enable();
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

    // Re-apply graph view labels with new template
    if (this.settings.showLabelsInGraphView && this.graphViewPatch) {
      this.graphViewPatch.disable();
      this.graphViewPatch.enable();
    }
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
        await this.layoutRenderer.render(
          "",
          layoutContainer,
          {} as MarkdownPostProcessorContext,
        );
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
      const layoutExists = viewContainer.querySelector(
        ".exocortex-auto-layout",
      );
      const currentMetadataContainer = viewContainer.querySelector(
        ".metadata-container",
      );

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

        const layoutStillMissing = !viewContainer.querySelector(
          ".exocortex-auto-layout",
        );
        const metadataStillExists = viewContainer.querySelector(
          ".metadata-container",
        );

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
          metadataStillExists.insertAdjacentElement(
            "afterend",
            newLayoutContainer,
          );

          // Render layout
          void (async () => {
            try {
              await this.layoutRenderer.render(
                "",
                newLayoutContainer,
                {} as MarkdownPostProcessorContext,
              );
            } catch (error) {
              this.logger.error(
                "Failed to re-render layout after embed processing",
                error,
              );
            } finally {
              // Reset flag after a short delay to allow for DOM stabilization
              this.timerManager.setTimeout(
                null,
                () => {
                  isReRendering = false;
                },
                100,
              );
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

        // Issue #2142: Check setting before auto-adjusting plannedEndTimestamp
        // When disabled, skip automatic adjustment to prevent double-shift with Obsidian Sync
        if (!this.settings.autoAdjustPlannedEndTimestamp) {
          this.logger.info(
            `Skipping plannedEndTimestamp adjustment - autoAdjustPlannedEndTimestamp is disabled`,
          );
        } else {
          const currentDate = new Date(String(currentPlannedStartTimestamp));
          const previousDate = previousPlannedStartTimestamp
            ? new Date(String(previousPlannedStartTimestamp))
            : null;

          if (
            !isNaN(currentDate.getTime()) &&
            previousDate &&
            !isNaN(previousDate.getTime())
          ) {
            const deltaMs = currentDate.getTime() - previousDate.getTime();

            // Issue #2095: Idempotency check for Obsidian Sync
            // When synced from another device, plannedEndTimestamp may already be shifted.
            // Check if the current plannedEndTimestamp equals the expected value to avoid double-shift.
            const currentPlannedEndTimestamp =
              metadata.ems__Effort_plannedEndTimestamp;
            const previousPlannedEndTimestamp =
              cachedMetadata.ems__Effort_plannedEndTimestamp;

            if (currentPlannedEndTimestamp && previousPlannedEndTimestamp) {
              const currentEndDate = new Date(
                String(currentPlannedEndTimestamp),
              );
              const previousEndDate = new Date(
                String(previousPlannedEndTimestamp),
              );

              if (
                !isNaN(currentEndDate.getTime()) &&
                !isNaN(previousEndDate.getTime())
              ) {
                const expectedEndTimestamp =
                  previousEndDate.getTime() + deltaMs;
                const actualEndTimestamp = currentEndDate.getTime();

                // If plannedEndTimestamp is already at expected value, skip the shift
                // This happens when syncing from another device that already applied the shift
                if (actualEndTimestamp === expectedEndTimestamp) {
                  this.logger.info(
                    `Skipping plannedEndTimestamp shift - already at expected value (sync from another device)`,
                  );
                  // Update cache for plannedEndTimestamp to reflect synced value
                  cachedMetadata.ems__Effort_plannedEndTimestamp =
                    currentPlannedEndTimestamp;
                } else {
                  await this.taskStatusService.shiftPlannedEndTimestamp(
                    file,
                    deltaMs,
                  );
                  this.logger.info(
                    `Shifted ems__Effort_plannedEndTimestamp by ${deltaMs}ms`,
                  );
                }
              } else {
                // Dates are invalid, proceed with shift
                await this.taskStatusService.shiftPlannedEndTimestamp(
                  file,
                  deltaMs,
                );
                this.logger.info(
                  `Shifted ems__Effort_plannedEndTimestamp by ${deltaMs}ms`,
                );
              }
            } else {
              // No plannedEndTimestamp to check, proceed with shift
              await this.taskStatusService.shiftPlannedEndTimestamp(
                file,
                deltaMs,
              );
              this.logger.info(
                `Shifted ems__Effort_plannedEndTimestamp by ${deltaMs}ms`,
              );
            }
          }
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

        this.logger.info(`Auto-synced aliases for exo__Asset_label change`);
      }

      this.metadataCache.set(file.path, { ...metadata });
    } catch (error) {
      this.logger.error(
        `Failed to handle metadata change for ${file.path}`,
        error as Error,
      );
    }
  }

  /**
   * Issue #2785: schedule a debounced, per-file re-index after a frontmatter mutation.
   *
   * Called from the `metadataCache.on("changed")` subscriber — at that point
   * Obsidian has already re-parsed the file, so `sparql.reindexFile(file)`
   * converts it against fresh metadata. After the re-index completes we
   * invalidate the command/precondition caches and trigger `autoRenderLayout`
   * so active leaves pick up the new button visibility without an Obsidian
   * restart.
   *
   * Debouncing key is per-file (`hot-reindex:<path>`) so a burst of changes
   * to the same file collapses to one re-index, while concurrent edits to
   * different files each run their own re-index.
   *
   * Non-markdown files are ignored (binary / config assets).
   */
  private scheduleHotReindex(file: TFile): void {
    if (file.extension !== "md") return;

    const timerName = `hot-reindex:${file.path}`;
    this.timerManager.setTimeout(
      timerName,
      () => {
        void (async () => {
          try {
            await this.sparql.reindexFile(file);
            this.commandResolver.invalidateCache();
            this.preconditionEvaluator.invalidateCache();
            this.autoRenderLayout();
          } catch (err) {
            this.logger.error(
              `Failed to hot-reindex ${file.path} after metadata change`,
              err as Error,
            );
          }
        })();
      },
      150,
    );
  }

  private removeAutoRenderedLayouts(): void {
    document
      .querySelectorAll(".exocortex-auto-layout")
      .forEach((el) => el.remove());
  }
}
