import "reflect-metadata";
import {
  MarkdownPostProcessorContext,
  MarkdownView,
  Platform,
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
  registerDefaultHostFunctions,
  FolderRepairService,
  GroundingExecutor,
  ServiceRegistry,
  RelationColumnSetResolver,
  LayoutSelector,
  ShapeLoader,
  ShaclShapeRegistry,
  shaclValidate,
  type ClassHierarchy as ShaclClassHierarchy,
  DomainIRI,
  DomainLiteral,
  LazyAssetGraphLoader,
  NoteToRDFConverter,
  WorkflowResolver,
} from "exocortex";
import { ObsidianFileResolver } from "./infrastructure/ObsidianFileResolver";
import { registerOrderSpecFromObsidianVault } from "./infrastructure/registerOrderSpecFromObsidianVault";
import {
  RelationColumnSetRepository,
  ObsidianRelationColumnSetAdapter,
  ExoLayoutRepository,
  ObsidianExoLayoutAdapter,
} from "./infrastructure/repositories";
import { ObsidianVaultAdapter } from "./adapters/ObsidianVaultAdapter";
import { ObsidianQueryBodyResolver } from "./infrastructure/ObsidianQueryBodyResolver";
import { createIsInWrongFolderHostFunction } from "./infrastructure/precondition/createIsInWrongFolderHostFunction";
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
import { ObsidianFileOpener } from "./infrastructure/services/ObsidianFileOpener";
import { createObsidianClassLabelResolver } from "./infrastructure/services/ObsidianClassLabelResolver";
import { ExocmdCommandPaletteRegistrar } from "./application/services/ExocmdCommandPaletteRegistrar";
import { ObsidianCommandPromptAdapter } from "./infrastructure/adapters/ObsidianCommandPromptAdapter";
import {
  FocusProfileCommands,
  type FocusProfileChoice,
  type IAssetSpacePusher,
} from "./infrastructure/adapters/FocusProfileCommands";
import { FocusProfileSwitchManager } from "./infrastructure/adapters/FocusProfileSwitchManager";
import { PluginLockManager } from "./infrastructure/adapters/PluginLockManager";
import { VaultProfileResolver } from "./infrastructure/adapters/VaultProfileResolver";
import { PluginRdfIndexerAdapter } from "./infrastructure/adapters/PluginRdfIndexerAdapter";
import { PluginSettingsStoreAdapter } from "./infrastructure/adapters/PluginSettingsStoreAdapter";
import { PluginLocalDataStore } from "./infrastructure/adapters/PluginLocalDataStore";
import { StagingDirTracker } from "./infrastructure/adapters/StagingDirTracker";
import { ProfileFuzzyModal } from "./infrastructure/adapters/ProfileFuzzyModal";
import { applyActiveProfileFilter } from "./infrastructure/adapters/FocusProfileOnloadWiring";
import { lookupAssetSpaceUidByFolder } from "./infrastructure/adapters/AssetSpaceLookupHelper";
import { createAssetSpacePusher } from "./infrastructure/adapters/AssetSpacePusherFactory";
import { LocalSecretsStore } from "./infrastructure/adapters/LocalSecretsStore";
import { SwitchCacheLayer } from "./infrastructure/adapters/SwitchCacheLayer";
import { ClearSwitchCacheConfirmModal } from "./infrastructure/adapters/ClearSwitchCacheConfirmModal";
import {
  AssetSpaceManager,
  parseGitHubURL,
} from "./infrastructure/adapters/AssetSpaceManager";
import { BootstrapAssetSpaceCommands } from "./infrastructure/adapters/BootstrapAssetSpaceCommands";
import { BootstrapVaultModal } from "./presentation/modals/BootstrapVaultModal";
import { AddAssetSpaceModal } from "./presentation/modals/AddAssetSpaceModal";
import { SimpleConfirmModal } from "./presentation/modals/SimpleConfirmModal";
import { AssetSpaceMaterializationTracker } from "./infrastructure/adapters/AssetSpaceMaterializationTracker";
import { injectAssetSpaceMaterializationTriples } from "./infrastructure/adapters/injectAssetSpaceMaterializationTriples";
import { AssetSpaceStatusIconPatch } from "./presentation/asset-space/AssetSpaceStatusIconPatch";
import { GitHubRestClient } from "./infrastructure/adapters/GitHubRestClient";
import { GitSubmoduleOps } from "./infrastructure/adapters/GitSubmoduleOps";
import { UncommittedChangesGuard } from "./infrastructure/adapters/UncommittedChangesGuard";
import { ModalConfirmGate } from "./infrastructure/adapters/ModalConfirmGate";
import {
  CommandExecutionFlow,
  DI_TOKENS,
  type IVaultSettings,
} from "exocortex";

/**
 * Exocortex Plugin - Automatic layout rendering
 * Automatically displays related assets table in all notes (below metadata in reading mode)
 * Provides Command Palette integration for all asset commands
 */
export default class ExocortexPlugin extends Plugin {
  /**
   * RFC c7da0bca Phase 5 — pure filter used by lazy-tbox-bootstrap to
   * select TBox files from the full vault file list. Extracted as static
   * for direct unit testing without standing up the whole plugin
   * scaffold (code-reviewer HIGH catch — settings → bootstrap wiring
   * was previously empirically untested, which is exactly how the
   * `bb00efed → ems-commands/` migration silently stayed unindexed).
   *
   * Match is `String.startsWith` against vault-relative path. Caller is
   * responsible for ensuring each prefix in `folderPrefixes` ends with
   * `/` so `assetspaces/ems/` does not over-match `assetspaces/ems-commands/`
   * (Settings UI auto-appends — see ExocortexSettingTab).
   *
   * Returns empty array if `folderPrefixes` is empty (degraded mode —
   * bootstrap walks nothing; buttons appear later via convertVault).
   */
  static filterTBoxFiles<T extends { path: string }>(
    files: T[],
    folderPrefixes: string[],
  ): T[] {
    if (folderPrefixes.length === 0) return [];
    return files.filter((f) =>
      folderPrefixes.some((folder) => f.path.startsWith(folder)),
    );
  }

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
  // RFC 36347daf Phase 2 — production triple-store-backed workflow resolver.
  // Wired into groundingExecutor for workflow_transition dispatch and into
  // ServiceRegistryPopulator for EffortStatusWorkflow (sync rollback path
  // currently falls through to hardcoded fallback; injection prepares for a
  // future async migration).
  workflowResolver!: WorkflowResolver;
  // RFC c7da0bca Phase 3 — on-demand asset-graph loader; the sole source
  // of pre-render frontmatter+chain coverage in the triple store. The
  // legacy fast/full-path cold-start resolvers (`ExocmdFastResolver` +
  // `ExocmdBindingsCache` + `ExocmdBindingsIndexer`) were deleted in
  // Phase 3c-2 once parallel-mode parity was confirmed via PR #3257.
  lazyAssetGraphLoader?: LazyAssetGraphLoader;
  private relationColumnSetRepository: RelationColumnSetRepository | null =
    null;
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
  /** RFC 22b50a17 Phase 4 — AssetSpace status badge (✅/⏸). */
  private assetSpaceStatusIconPatch: AssetSpaceStatusIconPatch | null = null;
  private fileLogChannel!: FileLogChannel;
  // Issue #3320 — promoted from private so the Settings UI can route its
  // Save / Test connection / Switch failure messages via the same notifier
  // that powers the rest of the plugin (lint `no-restricted-syntax` rule
  // forbids `new Notice()` outside ObsidianNotificationService).
  notifier!: ObsidianNotificationService;
  private shaclStatusBar: HTMLElement | null = null;
  // Issue #2780: tracked so the post-resolve reindex can await it before
  // calling refresh(), avoiding a concurrent clear()/convertVault() race.
  private eagerInitPromise: Promise<void> | null = null;

  /**
   * Issue #3320 — FocusProfileSwitchManager hoisted onto the plugin instance
   * so the Settings UI dropdown can dispatch switchProfile() directly
   * без re-constructing a second manager (which would race the original on
   * the same persisted lock file). Initialized in
   * `registerFocusProfileCommands()`; null until that call succeeds.
   */
  public focusProfileSwitchManager: FocusProfileSwitchManager | null = null;

  /**
   * Issue #3320 — profile choice lister hoisted alongside the switch
   * manager. Returns the same FuzzySuggestModal-shaped choices the palette
   * command uses, so the Settings dropdown matches Cmd+P ordering.
   * Initialized in `registerFocusProfileCommands()`; null until that
   * call succeeds.
   */
  public listFocusProfileChoices: (() => Promise<FocusProfileChoice[]>) | null = null;

  /**
   * Issue #3327 Item #3 — device-local switch state store (Sync-excluded).
   * Holds `activeProfileUid` + `_switchInProgress` per-device so profile
   * selection does not replicate cross-device. Initialized в
   * `registerFocusProfileCommands` after one-time legacy-keys migration;
   * remains null before that point.
   *
   * Readers treat the null state as «no active profile» (matches the
   * default for fresh installs and для users who never selected a profile).
   * No fallback к legacy `this.settings.activeProfileUid` — migration
   * runs early enough that production reads always see the initialized
   * store, and any legacy keys are cleared in the same migration pass.
   */
  public localDataStore: PluginLocalDataStore | null = null;

  /**
   * RFC 22b50a17 Phase 5 Phase 4 — runtime-derived AssetSpace materialization
   * tracker. Walks the vault on plugin load + after `metadataCache.resolved`
   * and refreshes a Set of currently-materialized AssetSpace UIDs by probing
   * `assetspaces/<namespace>/` folder existence. Per Vision Lock #12 the
   * status is never persisted — manual `rm`/`cp` of folders cannot create
   * stale state.
   *
   * Read by:
   *  - `SPARQLApi.injectMaterializationTriples` (filter by status)
   *  - markdown post-processor (✅/⏸ status icon)
   */
  public assetSpaceMaterializationTracker: AssetSpaceMaterializationTracker | null = null;

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
      this.fileLogChannel = new FileLogChannel(this.app.vault.adapter, this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
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

      // RFC 27a7a877 — wire OrderSpecResolver via vault scan.
      // Loader is invoked lazily on first frontmatter creation; closes over
      // `app` so vault edits to the spec asset picked up без plugin reload.
      registerOrderSpecFromObsidianVault(this.app);

      const notifier = this.notifier;
      this.sparqlProcessor = new SPARQLCodeBlockProcessor(this, notifier);
      this.layoutProcessor = new LayoutCodeBlockProcessor(this);
      this.sparql = new SPARQLApi(this);
      this.api = new ExocortexAPI(this);

      // RFC 22b50a17 Phase 4 — AssetSpace materialization tracker.
      // Constructed eagerly; first `refresh()` runs inside the
      // `metadataCache.resolved` chain so the walk sees fully-parsed
      // AS ABox frontmatter. Status snapshot used by SPARQL injection +
      // AssetSpace status-icon post-processor.
      this.assetSpaceMaterializationTracker =
        new AssetSpaceMaterializationTracker(this.app);

      // RFC-009: Wire Dynamic Command System services BEFORE renderer
      // Construct manually (not via tsyringe) because they need the live triple store
      const tripleStore = this.sparql.getTripleStore();
      this.commandResolver = new CommandResolver(tripleStore, this.logger);
      const queryBodyResolver = new ObsidianQueryBodyResolver(this.app);
      this.preconditionEvaluator = new PreconditionEvaluator(
        tripleStore,
        queryBodyResolver,
      );
      registerDefaultHostFunctions(this.preconditionEvaluator);

      // Register `isInWrongFolder` host function used by the homoiconic
      // `Repair Folder` exocmd command (vault asset
      // `2afd04ae-218d-4ee9-8ee1-7c61f4d40a91`). Without this registration
      // `evaluateHostFunction` fails open (`return true`) and the inline
      // button + Cmd+P entry would show on every asset.
      this.preconditionEvaluator.registerHostFunction(
        "isInWrongFolder",
        createIsInWrongFolderHostFunction(
          this.app,
          new FolderRepairService(this.vaultAdapter),
        ),
      );

      // RFC c7da0bca Phase 3a — construct lazy loader. Parallel-mode: runs
      // alongside the existing fast/full-path chain. The dedicated
      // NoteToRDFConverter instance keeps the loader decoupled from the
      // VaultRDFIndexer's converter so the indexer's mid-session reindex
      // operations don't race with the loader's per-render walks. Both
      // converters call `vault.getFrontmatter()` which is read-only, so
      // multiple converters are safe.
      const lazyConverter = new NoteToRDFConverter(
        this.vaultAdapter,
        LoggerFactory.create("NoteToRDFConverter-Lazy"),
      );
      const obsidianFileResolver = new ObsidianFileResolver(this.vaultAdapter);
      this.lazyAssetGraphLoader = new LazyAssetGraphLoader(
        lazyConverter,
        obsidianFileResolver,
        tripleStore,
      );

      // RFC c7da0bca Phase 3b-main — wire forget() into metadataCache
      // changes. When Obsidian re-parses a file's frontmatter, the
      // VaultRDFIndexer's own changed-handler is already responsible
      // for store-side cleanup (removeFileTriples + re-convert + addAll);
      // here we just invalidate the loader's monotonic load-mark so the
      // next render re-walks. IRI built via `lazyConverter.notePathToIRI`
      // to honour the canonical-form precondition documented on
      // `LazyAssetGraphLoader.forget`. The forget is no-op when the
      // file was never loaded.
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          this.lazyAssetGraphLoader?.forget(
            lazyConverter.notePathToIRI(file.path),
          );
        }),
      );
      // Rename: forget the OLD path's IRI — that's the load-mark the
      // loader keyed by. Obsidian fires the post-rename `changed`
      // event for the new path separately, so the new path's
      // freshly-loaded mark lands on the next render.
      this.registerEvent(
        this.app.vault.on("rename", (_file, oldPath) => {
          this.lazyAssetGraphLoader?.forget(
            lazyConverter.notePathToIRI(oldPath),
          );
        }),
      );
      // Delete: forget the IRI so its load-mark is reclaimed.
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          this.lazyAssetGraphLoader?.forget(
            lazyConverter.notePathToIRI(file.path),
          );
        }),
      );

      // Vault changes invalidate the cached UID→path index.
      this.registerEvent(
        this.app.metadataCache.on("changed", () =>
          queryBodyResolver.invalidateCache(),
        ),
      );
      this.registerEvent(
        this.app.vault.on("delete", () => queryBodyResolver.invalidateCache()),
      );
      this.registerEvent(
        this.app.vault.on("rename", () => queryBodyResolver.invalidateCache()),
      );
      this.serviceRegistry = new ServiceRegistry();
      const obsidianFs = new ObsidianFileSystemAdapter(this.app.vault);
      // RFC 36347daf Phase 2 — wire WorkflowResolver + GroundingLoader so
      // executeWorkflowTransition can resolve vault Workflow ABox at runtime
      // and execute postActions referenced from WorkflowTransition assets.
      // Both are optional (executor falls back gracefully without them); the
      // plugin always wires them so the workflow_transition grounding type is
      // fully functional in production.
      this.workflowResolver = new WorkflowResolver(tripleStore);
      this.groundingExecutor = new GroundingExecutor(
        obsidianFs,
        obsidianFs,
        this.serviceRegistry,
        // Issue #3220: execution-time label→UID class resolution via the
        // always-warm Obsidian metadata cache. Closes the cold-start gap where
        // create_instance baked label-form `exo__Instance_class` because the
        // fast resolver / disk cache store lacked the `assetspaces/ems` TBox.
        createObsidianClassLabelResolver(this.app),
        {
          workflowResolver: this.workflowResolver,
          groundingLoader: (uid) => this.commandResolver.loadGroundingByUid(uid),
        },
      );

      populateServiceRegistry(this.serviceRegistry, {
        app: this.app,
        fileSystemAdapter: obsidianFs,
        sparqlApi: this.sparql,
        vaultAdapter: this.vaultAdapter,
        // RFC 36347daf Phase 2 — pass production workflow resolver so
        // EffortStatusWorkflow can later migrate from sync hardcoded
        // fallback to async vault-backed resolution without a wiring change.
        workflowResolver: this.workflowResolver,
      });

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

      // RFC c7da0bca Phase 3c-2 — legacy cold-start optimisation paths
      // (`ExocmdFastResolver`, `ExocmdBindingsCache`,
      // `ExocmdBindingsIndexer`) were deleted in this phase. Their
      // bootstrap construction + disk-cache load + post-convertVault
      // indexer pass lived here. After Phase 3b-main wired
      // `LazyAssetGraphLoader.ensureLoadedByIRI` into the renderer's
      // hot-path (PR #3257), the legacy paths became redundant — the
      // lazy loader populates the triple store per-render with the
      // same byte-identical output the cache/indexer used to pre-build.
      // Cache-invalidation handlers (`metadataCache.on("changed")` for
      // `assetspaces/exocmd/*`, plus `vault.delete` + `vault.rename`)
      // and the `bootstrapResolved` gating that paired with them were
      // deleted alongside the construction sites.

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
          tripleStore,
          relationColumnSetResolver: this.relationColumnSetResolver,
          exoLayoutRepository: this.exoLayoutRepository,
          layoutSelector: this.layoutSelector,
          panelResolver: this.panelResolver,
          // RFC c7da0bca Phase 3c-1 — stop wiring the legacy
          // cold-start optimisation paths (fast-resolver + bindings-
          // cache + isFullPathReady) into the renderer. The lazy
          // loader populates the triple store before every render,
          // so the builder's `useFastPath` / `cachedBindings`
          // branches in `DynamicCommandButtonGroupBuilder`
          // naturally degrade to the full path
          // (`resolveForAssetMulti` against the lazy-fed store)
          // when these are undefined. Construction sites for the
          // legacy objects were deleted in Phase 3c-2 (see deletion
          // note above near line 387). Phase 3c-3 will drop the
          // now-permanently-undefined ctor params from the renderer
          // signature.
          //
          // RFC c7da0bca Phase 3b-main — renderer drives the lazy
          // loader on every render. `ensureLoadedByIRI` primes the
          // store for the active file before button resolution.
          lazyAssetGraphLoader: this.lazyAssetGraphLoader,
          // Issue followup to #3279 — re-index per-file triples + drop
          // command/precondition caches BEFORE the incremental section
          // refresh runs. The BUTTONS section's precondition ASKs query
          // the triple store; without this, a click that mutates the
          // frontmatter (e.g. `ems__Task_zone`) would refresh the section
          // against pre-mutation triples and the buttons would not flip.
          prepareForRefresh: async (file) => {
            await this.sparql.reindexFile(file);
            this.commandResolver.invalidateCache();
            this.preconditionEvaluator.invalidateCache();
          },
        },
      );

      // RFC c7da0bca Phase 3c-2 — deleted the bootstrap-resolved-gated
      // cache invalidation block (3 `registerEvent` listeners for
      // `metadataCache.on("changed")` + `vault.on("delete")` +
      // `vault.on("rename")` filtered to `assetspaces/exocmd/*`, plus
      // the `bootstrapResolved` flag flipped by the resolved handler).
      // Their sole purpose was invalidating `exocmdFastResolver` +
      // `bindingsCache` — both deleted above. The lazy loader's own
      // `metadataCache.on("changed")` → `forget(iri)` + `vault.on
      // ("rename")` + `vault.on("delete")` handlers (wired in 3b-main)
      // provide invalidation for the new render path.

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
          let bestSlots: {
            accentColor?: string;
            icon?: string;
            labelTypography?: import("@plugin/domain/layout").LabelTypography;
          } | null = null;
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

      // RFC 0a0791c1 #3322 — register FocusProfile palette commands
      // (Switch / Push current assetspace). Wraps the B.7 handler with
      // real adapters. Wrapped в try/catch: any failure here должен NOT
      // abort the rest of onload — commands simply won't appear in
      // Cmd+P, but plugin remains usable.
      //
      // RFC 0a0791c1 #3324 — returns `reapplyActiveProfileFilter` so the
      // post-`metadataCache.on("resolved")` chain can re-run the wiring
      // against a fully-parsed cache. The initial invocation at line ~713
      // may scan a partial cache; the re-run closes the race.
      let reapplyActiveProfileFilter: (() => Promise<void>) | null = null;
      try {
        reapplyActiveProfileFilter = await this.registerFocusProfileCommands();
      } catch (error) {
        this.logger.error(
          "[ExocortexPlugin] FocusProfile commands registration failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      // RFC 1429fcd0 PR-2: register vault-described palette-enabled exocmd
      // commands as Obsidian Command Palette entries. Runs **after**
      // `eagerInitPromise` resolves below — the registrar SPARQLs the
      // triple store, which is empty until `onLayoutReady` fires and the
      // ASK query populates `VaultRDFIndexer`. The original wiring tried
      // to init synchronously in `onload()`; that left the registrar
      // looking at an empty graph and silently registering zero commands.
      // See user-visible regression: v16.6.0 shipped without
      // "Create fleeting note" in Cmd-P.
      //
      // Known limitation: Obsidian's public API has no `removeCommand`,
      // so newly-added paletteEnabled assets surface only after plugin
      // reload — that's a separate gap.
      const initExocmdPalette = async (): Promise<void> => {
        try {
          const vaultSettings = container.resolve<IVaultSettings>(
            DI_TOKENS.IVaultSettings,
          );
          const paletteFlow = new CommandExecutionFlow(
            this.groundingExecutor,
            new ObsidianNotificationService(),
            this.logger,
            new ObsidianCommandPromptAdapter(this.app),
            tripleStore,
            new ObsidianFileOpener(this.app),
          );
          await new ExocmdCommandPaletteRegistrar(
            this,
            this.commandResolver,
            paletteFlow,
            vaultSettings,
            this.logger,
            this.app,
            this.preconditionEvaluator,
          ).init();
        } catch (error) {
          this.logger.error(
            "[ExocortexPlugin] ExocmdCommandPaletteRegistrar init failed",
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      };

      // GTD Capture: one-click fleeting note to inbox.
      // Triggers the same Obsidian Command Palette entry as Cmd-P → "Create
      // fleeting note". The command itself is registered by
      // `ExocmdCommandPaletteRegistrar` from the vault `exocmd__Command`
      // asset `692aa011-...` (RFC 1429fcd0 PR-3 migration). Using
      // `app.commands.executeCommandById` keeps a single source of truth.
      // The id is prefixed with the plugin manifest id at registration time,
      // so the canonical form is `<manifest.id>:create-fleeting-note`.
      this.addRibbonIcon("inbox", "Capture to inbox (fleeting note)", () => {
        const commandId = `${this.manifest.id}:create-fleeting-note`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const commands = (this.app as any).commands;
        if (typeof commands?.executeCommandById === "function") {
          commands.executeCommandById(commandId);
        } else {
          this.logger.warn(
            "[ExocortexPlugin] app.commands.executeCommandById unavailable; ribbon click no-op",
          );
        }
      });

      this.addSettingTab(new ExocortexSettingTab(this.app, this));

      // Issue #2992: gate auto-execution behind opt-in setting. When
      // `enableSparqlAutoExecute` is `false` (default), render the code block
      // as plain `<pre><code>` so users can paste SPARQL snippets for
      // documentation/reference without triggering query execution on every
      // render. The setting is read at render time, so flipping the toggle
      // takes effect on next render without a plugin reload.
      const renderSparqlBlock = (
        source: string,
        el: HTMLElement,
        ctx: Parameters<
          Parameters<typeof this.registerMarkdownCodeBlockProcessor>[1]
        >[2],
        language: "sparql" | "exoql",
      ): void | Promise<void> => {
        if (this.settings.enableSparqlAutoExecute) {
          return this.sparqlProcessor.process(source, el, ctx);
        }
        const pre = el.createEl("pre");
        pre.addClass(`language-${language}`);
        const code = pre.createEl("code");
        code.addClass(`language-${language}`);
        code.setText(source);
      };

      this.registerMarkdownCodeBlockProcessor("sparql", (source, el, ctx) =>
        renderSparqlBlock(source, el, ctx, "sparql"),
      );

      this.registerMarkdownCodeBlockProcessor("exoql", (source, el, ctx) =>
        renderSparqlBlock(source, el, ctx, "exoql"),
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
          // RFC c7da0bca Phase 3c-2 — deleted the `flipBootstrapResolved()`
          // call that paired with the now-deleted `invalidateExocmdCaches`
          // gating block.

          this.layoutRenderer.invalidateBacklinksCache();

          // Issue #3368 — DO NOT REMOVE this line without re-running the
          // exo-layout-smoke e2e spec end-to-end on warm Obsidian boots
          // (full shard-4 sequence in Docker). Unit tests in
          // `ExoLayoutRepository.test.ts` exercise `rebuildNow()` semantics
          // in isolation but do NOT guard this integration call site.
          //
          // Closes the cold-start race between
          // `ExoLayoutRepository.initialize()` (which calls `rebuildSync()`
          // in onload, BEFORE metadataCache has parsed Layout fixtures) and
          // the `metadataCache.on("changed")` subscription it wires there.
          // After Phase 3c (#3260-3262) deleted the legacy fast-resolver +
          // disk-cache chain, plugin onload became fast enough that on
          // "warm" Obsidian boots (e.g. e2e shard-4 where exo-layout-smoke
          // runs after sibling specs have already pre-warmed the binary)
          // metadataCache finishes parsing some Layout / LayoutBlock
          // fixtures BEFORE the repository's `on("changed")` listener is
          // wired — `rebuildSync()` sees an empty cache + no later events
          // ⇒ empty snapshot ⇒ `LayoutSelector.resolve` returns null ⇒
          // `ExoLayoutRenderer` is never invoked ⇒ `.exocortex-exo-layout`
          // is never emitted. Forcing a rebuild here on the authoritative
          // "metadata fully parsed" signal closes the race.
          //
          // `rebuildNow()` is idempotent + synchronous; it bypasses the
          // internal 150 ms debounce so the snapshot is published before
          // any consumer of the resolved-event chain runs (notably the
          // `autoRenderLayout()` call at the end of the async chain
          // below, which resolves layouts via the published snapshot).
          // Intentionally outside the `postResolveReindexDone` one-shot
          // guard — "resolved" is rare and the rebuild is cheap
          // (microseconds for typical vault sizes; bounded by
          // `getFrontmatter` calls against an already-warm metadataCache),
          // so re-emissions after large vault-level reindexes correctly
          // refresh the snapshot too.
          //
          // Optional chaining: `exoLayoutRepository` is nulled in
          // `onunload()`; guards the unload race where a queued
          // "resolved" event fires post-dispose.
          this.exoLayoutRepository?.rebuildNow();

          // Issue #3372 — DO NOT REMOVE this line without re-running the
          // relation-column-set-smoke e2e spec end-to-end on warm Obsidian
          // boots (full shard-3 sequence in Docker). Unit tests in
          // `RelationColumnSetRepository.test.ts` exercise `rebuildNow()`
          // semantics in isolation but do NOT guard this integration call
          // site.
          //
          // Sibling cold-start race in
          // `RelationColumnSetRepository`. Same shape as #3368: the repo
          // calls synchronous `rebuildSync()` in `initialize()` BEFORE
          // metadataCache has parsed `ui__RelationColumnSet` fixtures, then
          // subscribes to `metadataCache.on("changed" / "deleted" /
          // "renamed")` (NOT `on("resolved")`). On warm Obsidian boots
          // metadataCache can finish parsing RelationColumnSet assets
          // BEFORE that listener is wired ⇒ empty snapshot ⇒
          // `RelationColumnSetResolver` silently falls back to defaults
          // (custom RCS column overrides never apply). Mirror the
          // ExoLayoutRepository fix above: invoke `rebuildNow()` from this
          // authoritative "metadata fully parsed" handler. Same rationale
          // re: idempotency, cheapness, optional chaining (nulled in
          // `onunload()`), and placement outside `postResolveReindexDone`
          // (re-emissions on large vault reindexes refresh the snapshot
          // too). Unit tests in `RelationColumnSetRepository.test.ts`
          // exercise `rebuildNow()` semantics; this integration call site
          // is guarded by this comment + JSDoc on `rebuildNow()`, not by
          // an automated test (mirrors #3368 verification scope).
          this.relationColumnSetRepository?.rebuildNow();

          if (postResolveReindexDone) return;
          postResolveReindexDone = true;

          const initPromise = this.eagerInitPromise ?? Promise.resolve();
          // RFC 22b50a17 Phase 4 — after each `sparql.refresh()` (which
          // clears+rebuilds the store from frontmatter), re-inject the
          // runtime-derived `exo:AssetSpace_materialized` triples via
          // `refreshAndInjectAssetSpaceMaterialization`. Soft- and hard-
          // switch paths via `FocusProfileSwitchManager` are covered by
          // `PluginRdfIndexerAdapter.onAfterRefresh`; these onload chain
          // callsites use `sparql.refresh()` directly which bypasses the
          // adapter, so they call the helper explicitly.
          void initPromise
            .then(() => this.sparql.refresh())
            .then(() => this.refreshAndInjectAssetSpaceMaterialization())
            .then(async () => {
              // RFC 0a0791c1 #3324 — re-apply the active FocusProfile
              // filter now that metadataCache has fully resolved. The
              // first invocation at registerFocusProfileCommands time
              // may have scanned a partial cache (AS files not yet
              // parsed → empty containsOntology map → R15 degradation
              // to no-filter). Re-running here closes the race; the
              // helper is idempotent and recomputes from current vault
              // state. Then a single follow-up sparql.refresh() walks
              // the vault with the now-correct effective set.
              //
              // Gated on the active Focus profile (AC14) being non-null to
              // avoid an extra refresh in the default null-profile path
              // (which is the case covered by the post-resolve one-shot
              // regression tests). When the Focus slot is null the helper
              // would no-op and the second refresh would only re-walk the
              // same data.
              //
              // Item #3 — device-local store (no Sync replication). Null
              // before `registerFocusProfileCommands` resolves; treat as
              // no-active-profile (matches current behaviour). Loose
              // truthiness check handles unit-test mocks where the field
              // may be undefined rather than initialised to null.
              const hasActiveProfile =
                !!this.localDataStore &&
                this.localDataStore.getActiveFocusProfileUid() !== null;
              if (reapplyActiveProfileFilter !== null && hasActiveProfile) {
                try {
                  await reapplyActiveProfileFilter();
                  await this.sparql.refresh();
                  // RFC 22b50a17 Phase 4 (H1 fix) — re-inject after the
                  // active-profile sparql.refresh() that just wiped the
                  // store.
                  await this.refreshAndInjectAssetSpaceMaterialization();
                } catch (err) {
                  this.logger.warn(
                    "[ExocortexPlugin] active FocusProfile filter re-apply failed — indexer keeps prior wiring",
                    err instanceof Error ? err : new Error(String(err)),
                  );
                }
              }
            })
            .then(() => {
              // RFC c7da0bca Phase 3b-main — drop the lazy loader's
              // monotonic load-mark now that the store has been
              // rebuilt from scratch by `sparql.refresh()`. Order
              // matters: `clearAll()` MUST run AFTER refresh()'s
              // await chain (`clear` + `convertVault` + `addAll`
              // + `runInference`) resolves, so a concurrent render
              // cannot re-populate `loadedIRIs` mid-rebuild.
              this.lazyAssetGraphLoader?.clearAll();
            })
            .then(async () => {
              this.commandResolver.invalidateCache();
              this.preconditionEvaluator.invalidateCache();
              // RFC 1429fcd0 hotfix #2: rerun the palette registrar after
              // the full reindex completes. The earlier call inside
              // `eagerInitPromise.then(...)` ran against a partially-loaded
              // graph — files under `assetspaces/` (where the production
              // 692aa011-... Create-fleeting-note asset lives) weren't yet
              // indexed → `findPaletteEnabledCommands()` returned 0. After
              // `sparql.refresh()` the store contains every vault file →
              // the second call sees the asset and registers the Palette
              // command. Idempotent: Obsidian's `plugin.addCommand`
              // overwrites by id, so this is safe even if the first
              // attempt registered nothing.
              await initExocmdPalette();
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
          this.scheduleValidation(file);
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

      // Initial render — Issue #3192.
      //
      // Previously this used `setTimeout(_, 150)` so the call landed
      // 150ms after `onload()` regardless of whether Obsidian's view
      // had finished mounting. On cold start the view is rarely ready
      // that early; the call almost always returned at the
      // "no active view / no metadata-container" guards in
      // `autoRenderLayout` and the real first render came from one of
      // the workspace events further above (also 150ms-debounced) —
      // worst-case adding 150ms of pure wait to the
      // `cache-read-start` → `cache-applied` window.
      //
      // `onLayoutReady` is Obsidian's authoritative "view tree mounted"
      // signal: it fires once on cold start and immediately if layout
      // is already ready (e.g. plugin re-enabled after vault load).
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        this.app.workspace.onLayoutReady(() => {
          this.autoRenderLayout();
        });
      }
      // RFC c7da0bca Phase 3c-2 — deleted the `cacheLoadPromise.then`
      // chained re-render. The disk cache that fed it is gone; the
      // lazy loader's render-time `ensureLoadedByIRI` provides the
      // store coverage that snapshot previously short-circuited.

      // RFC-009: Eagerly initialize triple store after vault is ready.
      // onLayoutReady fires after Obsidian finishes mounting vault files.
      // Without this, VaultRDFIndexer.initialize() finds 0 files → 0 triples
      // → CommandResolver finds no bindings → dynamic buttons don't render.
      //
      // NB: At this point metadataCache is typically NOT fully resolved yet.
      // The `metadataCache.on("resolved")` handler above awaits this promise
      // and then refreshes the store to pick up any files that were skipped
      // because their frontmatter wasn't parsed in time. See issue #2780.
      //
      // Issue #3171 cold-start fast path: the SPARQL query (which triggers
      // `convertVault()` on the 12k+ file vault) is launched via
      // `setTimeout(0)` so it is fully deferred to the next macrotask —
      // the `Initial render` block above (150ms) runs first and takes
      // the fast path through `ExocmdFastResolver`, giving the user
      // visible buttons within ~tens of ms instead of ~40s on mobile.
      // The post-init re-render below upgrades the open file to the
      // full-resolver path once `convertVault()` finishes.
      // `performance.mark` / `performance.measure` instrumentation lets
      // us read cold-start latency against the issue's AC #1 / AC #2
      // targets via `performance.getEntriesByName(...)` — works on
      // desktop and mobile without Verbose log level (Issue #3175).
      // RFC c7da0bca Phase 3a — TBox bootstrap via the lazy loader,
      // running in parallel with the existing fast/full-path chain.
      // Purpose at this phase: exercise the loader at cold start so its
      // desktop timing can be measured via `performance.measure`. The
      // store ends up with the same triples regardless of which path
      // adds them first (triple insertion is idempotent in
      // InMemoryTripleStore). Phase 3b switches renders to use the
      // loader; Phase 3c deletes the parallel old path.
      //
      // Reads `lazyAssetGraphLoader` field (set above in onload). The
      // bootstrap is fire-and-forget — errors get logged but never
      // propagate to the existing chain.
      this.app.workspace.onLayoutReady(() => {
        const loader = this.lazyAssetGraphLoader;
        if (!loader) return;
        // RFC c7da0bca Phase 4 — bootstrap runs on both desktop AND
        // mobile. The original Phase 3a mobile-skip guard was
        // motivated by the concern that walking the TBox folders
        // alongside the legacy fast-resolver + convertVault chain
        // would *double* the cold-start work on iPhone — the exact
        // metric we were trying to improve (Issue #3250: 10-30 s
        // MISC→empty→buttons cycle).
        //
        // After Phase 3c-2/3c-3 deleted the parallel fast-resolver
        // + bindings-cache + ExocmdBindingsIndexer chain, the
        // bootstrap is the *only* startup walk. On mobile the
        // lazy loader is the sole code path that places
        // `exocmd__CommandBinding` triples into the store before
        // first render — without bootstrap those bindings are not
        // reachable from the current asset via class/prototype
        // walks, so the renderer surfaces zero MISC buttons until
        // the unrelated SPARQL ASK warm-up eventually triggers
        // convertVault() (~20-30 s on iPhone). Loading the TBox
        // folders at onLayoutReady restores parity with desktop
        // and eliminates the "buttons appear with the second
        // Notice" UX regression observed on v16.26.5.
        //
        // Phase 3b loader-invalidation hooks (`forget` on
        // metadataCache `changed` + vault `rename` + vault
        // `delete`) live at the eager-init block above (~line 237)
        // so the loader stays coherent across edits. If
        // `metadataCache` is not yet fully resolved at
        // `onLayoutReady`, `ensureFileLoaded` may insert empty
        // frontmatter triples; the `metadataCache.on("resolved")`
        // re-index handler downstream covers that race.
        performance.mark("lazy-tbox-bootstrap-start");
        void (async () => {
          try {
            // RFC c7da0bca Phase 5 — folder list moved to user
            // settings (`lazyBootstrapFolders`). Phase 3a hardcoded
            // 4 folders, but RFC aaaa2dea Phase 2 Task 2.2
            // (2026-05-23) migrated bb00efed Command + a6ef8fda
            // Grounding из `exocmd/creation/` в новый submodule
            // `ems-commands/` — а hardcoded list никто не обновил.
            // На mobile это означало Bindings (в `exocmd/creation/`,
            // indexed) ссылались на Commands (в `ems-commands/`,
            // NOT indexed) → unresolved refs → 0 buttons → wait для
            // convertVault (~10-20 s на iPhone). Phase 4 autoRender
            // hook re-renders после bootstrap, но bootstrap который
            // не загрузил Commands — no-op для visible outcome.
            //
            // Per Homoiconicity Invariant: список path prefixes —
            // user-configurable семантика (где у пользователя живут
            // ontology submodules), не hardcoded. Default settings
            // покрывает 5 production submodules; users с extra
            // submodules (kitelev/, pmbok-ontology/, aiknow-ontology/,
            // shared-identities/, ...) могут append через Settings tab.
            //
            // `?? []` fallback: defensive coverage for jest mocks +
            // legacy user settings без этого поля (Object.assign
            // в loadSettings заполнит default).
            // Defensive `?? []` for jest mocks that omit
            // `lazyBootstrapFolders` from the synthetic settings
            // object. Production users always have the field
            // populated by `Object.assign({}, DEFAULT_SETTINGS,
            // rawData)` in `loadSettings`.
            const ontologyFolders = this.settings.lazyBootstrapFolders ?? [];
            // `?? []` is defensive coverage for jest mocks that
            // under-specify the IVaultFileReader surface — the
            // production `ObsidianVaultAdapter.getAllFiles()` is
            // typed `IFile[]` and always returns an array.
            const allFiles = this.vaultAdapter.getAllFiles() ?? [];
            const tboxFiles = ExocortexPlugin.filterTBoxFiles(
              allFiles,
              ontologyFolders,
            );
            let loadedCount = 0;
            let errorCount = 0;
            for (const file of tboxFiles) {
              try {
                await loader.ensureFileLoaded(file);
                loadedCount++;
              } catch (err) {
                errorCount++;
                this.logger.warn(
                  `[lazy-tbox-bootstrap] skip ${file.path}: ${String(err)}`,
                );
              }
            }
            performance.mark("lazy-tbox-bootstrap-done");
            performance.measure(
              "lazy-tbox-bootstrap",
              "lazy-tbox-bootstrap-start",
              "lazy-tbox-bootstrap-done",
            );
            this.logger.info(
              `[lazy-tbox-bootstrap] loaded ${loadedCount} ontology assets ` +
                `(errors=${errorCount}, total loaded set size=${loader.loadedCount})`,
            );
            // RFC c7da0bca Phase 4 — drop the precondition/command
            // resolver caches and re-trigger autoRenderLayout once the
            // bootstrap is done. Without this, the first render
            // (`file-open + 150 ms` or `onLayoutReady`) wins the race
            // against the IIFE — the active asset renders with an
            // empty bindings store, both caches lock in a "0
            // buttons" decision, and there is no later trigger until
            // `metadataCache.on("resolved")` chain finally finishes
            // `sparql.refresh()` (~20-30 s on iPhone). Mirrors the
            // post-`sparql.refresh()` invalidate-and-re-render
            // triplet at line ~759 so the bootstrap-completion path
            // and the refresh-completion path produce the same
            // observable behaviour. Both invalidate/render calls are
            // cheap idempotent re-runs when there is nothing to
            // re-render (no active markdown view, etc.). The
            // active-file guard mirrors the renderInitial gate
            // above (line ~862) — if no file is open at
            // bootstrap-done, there is nothing to re-render and the
            // workspace file-open event will trigger autoRenderLayout
            // when a file is later opened.
            this.commandResolver.invalidateCache();
            this.preconditionEvaluator.invalidateCache();
            if (this.app.workspace.getActiveFile()) {
              this.autoRenderLayout();
            }
          } catch (err) {
            // Bootstrap failure must not propagate — convertVault() still
            // runs as part of the SPARQL ASK warm-up downstream and will
            // eventually populate the store, so buttons still appear
            // (with the legacy 20-30 s mobile latency). Keep the warn
            // logged so users can attach it to bug reports.
            this.logger.warn(
              `[lazy-tbox-bootstrap] failed (non-fatal — buttons will still appear via convertVault warm-up): ${String(err)}`,
            );
          }
        })();
      });

      this.eagerInitPromise = new Promise<void>((resolve) => {
        this.app.workspace.onLayoutReady(() => {
          // Issue #3171 perf instrumentation (Issue #3175 migrated from
          // `console.time` to Web Performance API). Two distinct
          // start-marks paired with `performance.measure` calls so the
          // developer can read the cold-start UX *and* the full-path
          // completion separately — fusing them under one label would
          // falsely suggest the fast path takes ~10–40 s.
          //   `exocmd-fastpath`  — onload → first `autoRenderLayout()`
          //                        that takes the ExocmdFastResolver
          //                        branch (AC #1 / AC #2 metric).
          //   `exocmd-fullpath`  — onload → background `convertVault()`
          //                        completion + post-init re-render.
          performance.mark("exocmd-fastpath-start");
          performance.mark("exocmd-fullpath-start");
          setTimeout(() => {
            void this.sparql
              .query("ASK { ?s ?p ?o }")
              .then(async () => {
                this.commandResolver.invalidateCache();
                // Triple store is now populated — RFC 1429fcd0 PR-2 registrar
                // can run its SPARQL match and see paletteEnabled assets. Must
                // happen before `autoRenderLayout` so the Command Palette is
                // ready for the very first user Cmd-P invocation.
                await initExocmdPalette();
                // Issue #3171 — re-render to upgrade currently-open file
                // from the fast path to the full resolver. The strategy
                // switch in `DynamicCommandButtonGroupBuilder` is per-call,
                // so this single `autoRenderLayout()` is enough.
                this.autoRenderLayout();
                performance.mark("exocmd-fullpath-ready");
                performance.measure(
                  "exocmd-fullpath",
                  "exocmd-fullpath-start",
                  "exocmd-fullpath-ready",
                );

                // RFC c7da0bca Phase 3c-2 — deleted the post-convertVault
                // indexer block. `ExocmdBindingsIndexer.runFullScan()`
                // pre-built the disk cache that the next cold start
                // would have read in ~10 ms. With the cache gone, the
                // lazy loader populates the store per-render instead,
                // so the indexer's pre-build has no consumer. The
                // mobile-skip guard from the band-aid (#3250 / v16.22.1)
                // becomes moot — there is nothing to skip.
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
          }, 0);
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

      // RFC 22b50a17 Phase 4 — AssetSpace status icon badge (✅/⏸) rendered
      // near the inline title of `exo__AssetSpace` ABox notes. Reads
      // runtime-derived status from `AssetSpaceMaterializationTracker`.
      // Always-on (no setting flag) — non-AS notes pass through unchanged
      // because frontmatter check fails fast.
      if (this.assetSpaceMaterializationTracker !== null) {
        this.assetSpaceStatusIconPatch = new AssetSpaceStatusIconPatch(
          this,
          this.assetSpaceMaterializationTracker,
        );
        this.timerManager.setTimeout(
          "asset-space-status-icon-patch",
          () => {
            this.assetSpaceStatusIconPatch?.enable();
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

      // Initialize Properties readable-label patch (RFC-030).
      // Replaces raw predicate names (e.g. ems__Effort_area) with human-readable
      // labels resolved from property definition assets' exo__Property_displayName
      // (fallback exo__Asset_label). Gated by settings.enablePropertiesLabelPatch
      // (default true; user-toggleable for users who prefer native predicate
      // rendering or who hit edge cases with custom TBox conventions).
      this.propertiesLabelPatch = new PropertiesLabelPatch(this);
      this.timerManager.setTimeout(
        "properties-label-patch",
        () => {
          if (this.settings.enablePropertiesLabelPatch) {
            this.propertiesLabelPatch.enable();
          }
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

      this.shaclStatusBar = this.addStatusBarItem();

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

    // Cleanup AssetSpace status icon patch (RFC 22b50a17 Phase 4)
    if (this.assetSpaceStatusIconPatch !== null) {
      this.assetSpaceStatusIconPatch.cleanup();
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

  async loadSettings(): Promise<void> {
    const rawData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);
    // Ensure logChannels exists for users upgrading from older versions
    if (!this.settings.logChannels) {
      this.settings.logChannels = DEFAULT_LOG_CHANNELS;
    }
    // Repair a corrupted `excludedFolders` shape (e.g. a hand-edited
    // settings JSON that stored a comma-joined string instead of an
    // array). `Object.assign` overlays default-on-missing, but a
    // *present* non-array value would otherwise survive into the UI
    // and break the textarea's `.join("\n")`.
    if (!Array.isArray(this.settings.excludedFolders)) {
      this.settings.excludedFolders = [
        ...(DEFAULT_SETTINGS.excludedFolders ?? []),
      ];
    }
    // Issue #3279 — union-merge `lazyBootstrapFolders` to prevent
    // saved user JSON from silently shadowing newly-added defaults.
    // `Object.assign` replaces array fields wholesale; if a future
    // release adds e.g. `assetspaces/aiknow-ontology/` to the default
    // list, an existing user's persisted (older) array would override
    // it and the new submodule would stay un-indexed, bringing back
    // the 10-20s mobile cold-start regression that PR #3277 fixed for
    // the current entry set.
    //
    // Strategy: union of defaults + saved entries, preserving order
    // (defaults first, user extras appended) and de-duplicated via
    // `Set`. Non-array saved values are discarded as corrupted shape;
    // non-string entries are filtered out to keep the textarea binding
    // robust against hand-edited garbage.
    //
    // Trade-off (issue body AC #2): if a user explicitly removed a
    // default folder, it will re-appear after reload. This is the
    // conscious cost of the failure-class fix — `excludedFolders`
    // gates the per-file RDF index pipeline (`VaultRDFIndexer`) but
    // does NOT short-circuit the lazy-bootstrap walk
    // (`filterTBoxFiles` reads `lazyBootstrapFolders` only), so it
    // is not a true workaround. A future enhancement could honour
    // `excludedFolders` in `filterTBoxFiles` to give users an escape
    // hatch (issue #3279 follow-up candidate).
    const rawLazyBootstrap = rawData?.lazyBootstrapFolders;
    const savedLazyBootstrap: string[] = Array.isArray(rawLazyBootstrap)
      ? rawLazyBootstrap.filter(
          (entry: unknown): entry is string => typeof entry === "string",
        )
      : [];
    this.settings.lazyBootstrapFolders = Array.from(
      new Set([
        ...(DEFAULT_SETTINGS.lazyBootstrapFolders ?? []),
        ...savedLazyBootstrap,
      ]),
    );
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
   * Toggle PropertiesLabelPatch (RFC-030 predicate-key resolver) on/off.
   * Called from settings when `enablePropertiesLabelPatch` changes. Hot-toggle:
   * `enable()` rebuilds the property-class subClass closure + cache from
   * scratch; `disable()` restores any patched DOM and disconnects observers.
   */
  togglePropertiesLabelPatch(enabled: boolean): void {
    if (enabled) {
      this.propertiesLabelPatch.enable();
    } else {
      this.propertiesLabelPatch.disable();
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

  /**
   * P1.10: Schedule a 50ms-debounced SHACL-lite validation run for a changed file.
   *
   * Frontmatter is already parsed by Obsidian's metadataCache when this fires,
   * so there is no need to re-parse the file. The engine is strictly read-only —
   * it never writes back to vault files (no save-loop risk).
   *
   * Timer key is per-file (`shacl-validate:<path>`) so burst edits collapse to
   * one validation while concurrent file changes each get their own timer.
   */
  private scheduleValidation(file: TFile): void {
    if (!this.settings.enableShaclValidation) return;
    if (file.extension !== "md") return;

    const timerName = `shacl-validate:${file.path}`;
    this.timerManager.setTimeout(
      timerName,
      () => {
        void (async () => {
          try {
            const store = this.sparql.getTripleStore();
            const shapeRegistry = await ShapeLoader.loadFromRDFGraph(store);
            if (shapeRegistry.size === 0) return;

            const domainTriples = await store.match();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const algebraTriples: any[] = [];
            for (const t of domainTriples) {
              const subj = t.subject;
              const pred = t.predicate;
              const obj = t.object;
              if (!(subj instanceof DomainIRI) || !(pred instanceof DomainIRI)) continue;
              let algObj: { type: 'iri'; value: string } | { type: 'literal'; value: string; datatype?: string } | null = null;
              if (obj instanceof DomainIRI) {
                algObj = { type: 'iri', value: obj.value };
              } else if (obj instanceof DomainLiteral) {
                algObj = { type: 'literal', value: obj.value, datatype: obj.datatype?.value };
              }
              if (!algObj) continue;
              algebraTriples.push({
                subject: { type: 'iri', value: subj.value },
                predicate: { type: 'iri', value: pred.value },
                object: algObj,
              });
            }

            const shaclRegistry = new ShaclShapeRegistry(shapeRegistry.getAll());
            const hierarchy: ShaclClassHierarchy = { isSubClassOf: (c, p) => c === p };
            const report = shaclValidate(algebraTriples, shaclRegistry, hierarchy);

            const violations = report.violations.filter(
              (v) => v.severity === "sh:Violation",
            );
            const warnings = report.violations.filter(
              (v) => v.severity === "sh:Warning",
            );
            const infos = report.violations.filter(
              (v) => v.severity === "sh:Info",
            );

            for (const v of violations) {
              this.notifier.warn(`SHACL: ${v.message}`);
            }

            if (this.shaclStatusBar) {
              if (warnings.length > 0) {
                this.shaclStatusBar.setText(`⚠ ${warnings.length}`);
                this.shaclStatusBar.title = warnings
                  .map((w) => w.message)
                  .join("\n");
              } else {
                this.shaclStatusBar.setText("");
                this.shaclStatusBar.title = "";
              }
            }

            for (const v of infos) {
              console.debug(`[Exocortex SHACL] Info in ${file.path}: ${v.message}`);
            }
          } catch (err) {
            console.error("[Exocortex] SHACL engine error", err);
          }
        })();
      },
      50,
    );
  }

  private removeAutoRenderedLayouts(): void {
    document
      .querySelectorAll(".exocortex-auto-layout")
      .forEach((el) => el.remove());
  }

  /**
   * RFC 0a0791c1 #3322 — register the two FocusProfile palette commands
   * («Switch focus profile», «Push current assetspace»). Wires the B.7
   * `FocusProfileCommands` handler with real adapters:
   *
   *   - B.4 `FocusProfileSwitchManager`: persisted lock + journal + RDF
   *     re-index с effective ontology filter.
   *   - B.3 `AssetSpaceManager`: GitHub PAT-backed AssetSpace push (only
   *     constructed when PAT is configured in `data.local.json`; absent
   *     PAT yields a lookup-only stub that surfaces a Configure-PAT
   *     Notice on push).
   *   - `ProfileFuzzyModal`: Obsidian `FuzzySuggestModal` wrapper that
   *     resolves the handler's Promise on choose/dismiss.
   *
   * The handler's logic gracefully reports failure через `notify`, so all
   * branches surface к the user as a Notice — never a silent log-only
   * crash. Construction errors here are caught by the caller's try/catch
   * in `onload()`.
   */
  /**
   * RFC 22b50a17 Phase 4 (H1 cascade catch — advisor round-2) —
   * refresh AssetSpace materialization tracker + re-inject
   * `exo:AssetSpace_materialized` triples into the store + notify
   * the UI patch.
   *
   * Wired into:
   *  - `metadataCache.resolved` chain (initial cold-start + active-
   *    FocusProfile re-apply path),
   *  - `PluginRdfIndexerAdapter.onAfterRefresh` so soft- and hard-
   *    switch paths via `FocusProfileSwitchManager` re-inject
   *    automatically.
   *
   * Best-effort: tracker / injection failures are logged warn but do
   * not propagate. UI badge remains correct (it reads tracker
   * directly); SPARQL filter degrades to «all available» (fail-closed
   * default) if tracker fails.
   */
  private async refreshAndInjectAssetSpaceMaterialization(): Promise<void> {
    if (this.assetSpaceMaterializationTracker === null) return;
    try {
      await this.assetSpaceMaterializationTracker.refresh();
      await injectAssetSpaceMaterializationTriples(
        this.sparql.getTripleStore(),
        this.assetSpaceMaterializationTracker.getStatuses(),
        // L3 catch — wire the plugin logger so per-AS injection failures
        // are visible at debug level instead of being silently swallowed.
        { debug: (msg) => this.logger.debug(msg) },
      );
      this.assetSpaceStatusIconPatch?.onTrackerRefreshed();
    } catch (err) {
      this.logger.warn(
        "[ExocortexPlugin] AssetSpace materialization injection failed",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private async registerFocusProfileCommands(): Promise<() => Promise<void>> {
    const lockMgr = new PluginLockManager({ app: this.app });
    const resolver = new VaultProfileResolver(this.app);
    // RFC 22b50a17 Phase 4 (H1 cascade catch — advisor round-2) — wire
    // `refreshAndInjectAssetSpaceMaterialization` as the post-refresh
    // hook so soft- + hard-switch paths via `FocusProfileSwitchManager`
    // re-inject `exo:AssetSpace_materialized` triples automatically after
    // every `rdfIndexer.refresh()`. Without this, profile switching
    // would silently drop the runtime-derived materialization triples
    // until the next `metadataCache.resolved` event.
    const rdfIndexer = new PluginRdfIndexerAdapter(
      this.sparql.getRdfIndexer(),
      () => this.refreshAndInjectAssetSpaceMaterialization(),
    );

    // Issue #3327 Item #3 — initialize device-local switch state store and
    // run one-time migration from legacy `plugin.settings` keys. After
    // migration, switch state lives в `data.local.json` (Sync-excluded);
    // legacy keys are cleared from `plugin.settings` so they do not
    // re-arrive via Sync на another device.
    const localDataStore = new PluginLocalDataStore({ app: this.app });
    const legacySettings = this.settings as Record<string, unknown>;
    const migrationOutcome = await localDataStore.migrateFromLegacyIfNeeded({
      activeProfileUid: legacySettings.activeProfileUid,
      _switchInProgress: legacySettings._switchInProgress,
    });
    if (migrationOutcome === "legacy") {
      this.logger.info(
        "[ExocortexPlugin] migrated legacy activeProfileUid/_switchInProgress " +
          "from plugin.settings → data.local.json (per-device)",
      );
      delete legacySettings.activeProfileUid;
      delete legacySettings._switchInProgress;
      await this.saveSettings();
    } else if (
      legacySettings.activeProfileUid !== undefined ||
      legacySettings._switchInProgress !== undefined
    ) {
      // Stale-sync edge: local already populated AND legacy fields present.
      // Local takes precedence (idempotency); clear legacy так stale-sync
      // value не trumps the device's choice on next migration cycle.
      this.logger.info(
        "[ExocortexPlugin] clearing stale legacy switch keys (local " +
          "data.local.json already populated — Issue #3327 Item #3 idempotency)",
      );
      delete legacySettings.activeProfileUid;
      delete legacySettings._switchInProgress;
      await this.saveSettings();
    }

    // RFC 13da049f Phase 6.5b AC14 — seed the dual Knowledge/Focus active
    // slots from the legacy single `activeProfileUid` (R38: Knowledge only,
    // Focus stays null). Idempotent; safe to resume after a crash between the
    // legacy and dual migration steps. Runs AFTER the settings→local migration
    // so the legacy value is already in data.local.json.
    const dualMigration = await localDataStore.migrateToDualActiveState();
    if (dualMigration === "migrated") {
      this.logger.info(
        "[ExocortexPlugin] seeded activeKnowledgeProfileUid from legacy " +
          "activeProfileUid (RFC 13da049f AC14 — Focus left null per R38)",
      );
      // One-time, on-upgrade only: the Focus (RDF-filter) slot is left null
      // per R38 — so a user whose pre-AC14 selection was a soft switch finds
      // their query-time filter disengaged (full vault indexed) until they
      // re-select. Surface that explicitly so the change is not silent (the
      // filter being off is exactly what drives the mobile reindex cost the
      // FocusProfile feature exists to avoid). Idempotent: `migrated` fires
      // only on the first post-upgrade load.
      this.notifier.info(
        "Focus profile filter was reset after upgrade — re-select your " +
          "Focus profile via «Exocortex: Switch focus profile» to re-enable it.",
      );
    }
    this.localDataStore = localDataStore;

    // RFC 22b50a17 R26 — sweep staging-dir orphans left over from a crash
    // mid-pullAssetSpace. Desktop-only (Node.js fs/os/path required); on
    // mobile, pullAssetSpace itself refuses, so there's nothing to sweep.
    // Best-effort: failure logged but does not block onload (staging dirs
    // leak rather than crash plugin).
    if (!Platform.isMobile) {
      try {
        const stagingTracker = new StagingDirTracker({ localDataStore });
        const sweepResult = await stagingTracker.sweepOrphans();
        if (sweepResult.tracked > 0) {
          this.logger.info(
            `[ExocortexPlugin] swept ${sweepResult.swept}/${sweepResult.tracked} orphan staging dirs (RFC 22b50a17 R26)`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[ExocortexPlugin] StagingDirTracker.sweepOrphans failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const settingsStore = new PluginSettingsStoreAdapter(localDataStore);

    // Phase 5 P3 — hard switch dependencies (desktop-only). On mobile, the
    // palette command throws via the AssetSpaceManager pull guard; here we
    // just leave the dependencies wired but inert.
    let hardSwitchDeps: {
      assetSpaceManager: AssetSpaceManager;
      gitOps: GitSubmoduleOps;
      uncommittedGuard: UncommittedChangesGuard;
      confirmGate: ModalConfirmGate;
      cacheLayer: SwitchCacheLayer;
      vaultRootPath: string;
    } | null = null;
    if (!Platform.isMobile) {
      try {
        const secretsStore = new LocalSecretsStore({ app: this.app });
        const pat = await secretsStore.getSecret("pat");
        const githubClient = new GitHubRestClient({
          app: this.app,
          pat: pat ?? "",
        });
        const stagingTrackerHs = new StagingDirTracker({ localDataStore });
        const assetSpaceManager = new AssetSpaceManager({
          app: this.app,
          client: githubClient,
          notifications: this.notifier,
          stagingTracker: stagingTrackerHs,
        });
        const vaultRootPath = (
          this.app.vault.adapter as unknown as { basePath?: string }
        ).basePath ?? "";
        if (vaultRootPath.length > 0) {
          const gitOps = new GitSubmoduleOps({ vaultRootPath });
          const uncommittedGuard = new UncommittedChangesGuard({ gitOps });
          const confirmGate = new ModalConfirmGate(this.app);
          const cacheLayer = new SwitchCacheLayer();
          hardSwitchDeps = {
            assetSpaceManager,
            gitOps,
            uncommittedGuard,
            confirmGate,
            cacheLayer,
            vaultRootPath,
          };
        } else {
          this.logger.warn(
            "[ExocortexPlugin] vault.adapter.basePath unavailable — hard switch palette will be hidden",
          );
        }
      } catch (err) {
        this.logger.warn(
          "[ExocortexPlugin] failed to wire hard-switch deps; soft switch only",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    const switchMgr = new FocusProfileSwitchManager({
      app: this.app,
      lockMgr,
      resolver,
      rdfIndexer,
      settingsStore,
      notify: (message) => this.notifier.info(message),
      assetSpaceManager: hardSwitchDeps?.assetSpaceManager,
      gitOps: hardSwitchDeps?.gitOps,
      uncommittedGuard: hardSwitchDeps?.uncommittedGuard,
      confirmGate: hardSwitchDeps?.confirmGate,
      cacheLayer: hardSwitchDeps?.cacheLayer,
      vaultRootPath: hardSwitchDeps?.vaultRootPath,
      localDataStore,
    });

    // Issue #3320 — expose the manager на plugin instance so the Settings
    // UI dropdown can dispatch switchProfile() directly. Re-constructing a
    // second manager would race the original on the same lock file.
    this.focusProfileSwitchManager = switchMgr;

    // Issue #3324 — apply the persisted `activeProfileUid` to the indexer's
    // filter setters BEFORE the eager-init / metadataCache-resolved chain
    // first calls `convertVault`. The helper is no-op when the field is
    // null (default), translates Ontology UIDs declared in the profile to
    // AS UIDs via `exo__AssetSpace_containsOntology`, and degrades to no-
    // filter when the translation produces zero folder overlap (R15 self-
    // brick mitigation surfaced one layer earlier than the converter).
    //
    // Wrapped in try/catch so a scan failure here cannot abort the rest
    // of `registerFocusProfileCommands` — the indexer falls back to full
    // vault, matching the no-profile default.
    //
    // Re-runnable closure: the resolved-handler chain in `onload` calls
    // `reapplyActiveProfileFilter()` again after `sparql.refresh()` to
    // close the cold-start race where `metadataCache.getFileCache` may
    // still return null for AS files at this earlier timing.
    const reapplyActiveProfileFilter = async (): Promise<void> => {
      // Item #3 — read from device-local store (no Sync replication).
      // AC14 — the RDF query-time filter tracks the Focus profile (soft
      // switch). Null Focus = no filter active (full vault). After the
      // legacy→dual migration the Focus slot stays null (R38), so a
      // pre-AC14 user's cold start indexes the full vault until they pick
      // a Focus profile explicitly.
      const persistedProfileUid = localDataStore.getActiveFocusProfileUid();
      await applyActiveProfileFilter({
        app: this.app,
        switchMgr,
        indexer: this.sparql.getRdfIndexer(),
        activeProfileUid: persistedProfileUid,
        logger: this.logger,
      });
    };
    try {
      await reapplyActiveProfileFilter();
    } catch (error) {
      this.logger.warn(
        "[ExocortexPlugin] applyActiveProfileFilter failed — indexer falls back to full vault",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Crash-recovery: если previous session left `_switchInProgress=true`
    // в settings (FocusProfileSwitchManager docstring line 18), re-trigger
    // the idempotent re-index so the flag self-clears. Failure swallowed —
    // user-facing recovery is а Phase D follow-up; the only side-effect
    // of skipping this is the «stuck switch in progress» footgun (code-
    // reviewer HIGH catch).
    try {
      const initialSettings = await settingsStore.load();
      if (initialSettings._switchInProgress) {
        this.logger.warn(
          "[ExocortexPlugin] previous session left _switchInProgress=true — attempting idempotent recovery",
        );
      }
      const recovery = await switchMgr.recoverIfNeeded();
      if (recovery.recovered) {
        this.logger.info(
          `[ExocortexPlugin] FocusProfile switch recovery completed for ${recovery.targetUid}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        "[ExocortexPlugin] FocusProfile switch recovery failed",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // RFC 22b50a17 Phase 3 — hard-switch recovery worker. Only fires when
    // hard-switch deps are wired AND the journal tail shows destroyed-not-
    // materialized AS — covers the «plugin crashed mid-Phase 2» case where
    // soft recoverIfNeeded() would re-trigger a no-op refresh but leave
    // vault filesystem partial-destroyed.
    if (hardSwitchDeps !== null) {
      try {
        const result = await switchMgr.recoverIncompleteSwitch();
        if (result.restored.length > 0) {
          this.logger.info(
            `[ExocortexPlugin] hard-switch recovery restored ${result.restored.length} AssetSpace(s): ${result.restored.join(", ")}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          "[ExocortexPlugin] hard-switch recovery failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      // Cross-device divergence detection (RFC 22b50a17 §Cross-device).
      // Best-effort: failure не block onload; user can manually re-trigger
      // by switching profiles в Cmd+P.
      try {
        const reconcile = await switchMgr.reconcileToLocal();
        if (reconcile.outcome === "reconciled") {
          this.logger.info(
            "[ExocortexPlugin] cross-device profile divergence reconciled to local activeProfileUid",
          );
        } else if (reconcile.outcome === "declined") {
          this.logger.info(
            "[ExocortexPlugin] cross-device divergence detected, user declined reconcile",
          );
        }
      } catch (error) {
        this.logger.warn(
          "[ExocortexPlugin] cross-device reconcile failed",
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    const pushMgr = await this.buildAssetSpacePusher();

    // Shared choice-builder for the per-class palette pickers (RFC 13da049f
    // AC17). `activeUid` drives the `isActive` flag the picker surfaces.
    const buildProfileChoices = (
      files: TFile[],
      activeUid: string | null,
    ): FocusProfileChoice[] => {
      const choices: FocusProfileChoice[] = [];
      for (const file of files) {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter as Record<string, unknown> | undefined;
        if (!fm) continue;
        const uid =
          typeof fm["exo__Asset_uid"] === "string"
            ? (fm["exo__Asset_uid"] as string)
            : null;
        if (uid === null) continue;
        const label =
          typeof fm["exo__Asset_label"] === "string"
            ? (fm["exo__Asset_label"] as string)
            : file.basename;
        choices.push({ uid, label, isActive: uid === activeUid });
      }
      // Sort alphabetically by label so picker order is stable across
      // vault scans (vault.getMarkdownFiles() is filesystem-order, not
      // semantic).
      choices.sort((a, b) => a.label.localeCompare(b.label));
      return choices;
    };

    const profileLister: () => Promise<FocusProfileChoice[]> = async () =>
      // Item #3 — device-local store (no Sync replication). Legacy
      // `activeProfileUid` mirrors the active Focus selection (soft switch).
      buildProfileChoices(
        resolver.listFocusProfileFiles(),
        localDataStore.getActiveProfileUid(),
      );

    // AC17 — KnowledgeProfile picker source. Dual-class assets surface in both
    // listers because the discrimination is by `exo__Instance_class` membership.
    const knowledgeProfileLister: () => Promise<
      FocusProfileChoice[]
    > = async () =>
      buildProfileChoices(
        resolver.listKnowledgeProfileFiles(),
        localDataStore.getActiveKnowledgeProfileUid(),
      );

    // Issue #3320 — share the same lister с Settings UI so its dropdown
    // matches the Cmd+P fuzzy-pick ordering exactly.
    this.listFocusProfileChoices = profileLister;

    const fuzzyPick = (
      options: FocusProfileChoice[],
      title: string,
    ): Promise<FocusProfileChoice | null> => {
      return new Promise<FocusProfileChoice | null>((resolve) => {
        const modal = new ProfileFuzzyModal(this.app, options, title, resolve);
        modal.open();
      });
    };

    const commandsHandler = new FocusProfileCommands({
      switchMgr,
      pushMgr,
      profileLister,
      knowledgeProfileLister,
      fuzzyPick,
      getActiveFilePath: () =>
        this.app.workspace.getActiveFile()?.path ?? null,
      getActiveKnowledgeProfileUid: () =>
        localDataStore.getActiveKnowledgeProfileUid(),
      getActiveFocusProfileUid: () => localDataStore.getActiveFocusProfileUid(),
      notify: (message) => this.notifier.info(message),
    });

    this.addCommand({
      id: "switch-focus-profile",
      name: "Switch focus profile",
      callback: () => {
        void commandsHandler.invokeSwitchProfile();
      },
    });

    this.addCommand({
      id: "push-current-assetspace",
      name: "Push current assetspace",
      callback: () => {
        void commandsHandler.invokePushCurrentAssetSpace();
      },
    });

    // RFC 13da049f Phase 6.5b AC17 — «Show current state» (active Knowledge +
    // Focus). Available regardless of platform / hard-switch wiring.
    this.addCommand({
      id: "show-profile-state",
      name: "Show current state",
      callback: () => {
        void commandsHandler.invokeShowCurrentState();
      },
    });

    // RFC 13da049f Phase 6.5b AC17 — «Switch knowledge profile» (hard switch;
    // supersedes the RFC 22b50a17 «Hard switch focus profile» command). Needs
    // desktop hard-switch deps wired (filesystem materialisation).
    //
    // Command id is intentionally kept as the legacy `hard-switch-focus-profile`
    // so any hotkey a user already bound to the hard-switch command survives the
    // Knowledge/Focus split (Obsidian persists hotkeys by command id). Only the
    // user-facing name + picker source change.
    if (hardSwitchDeps !== null) {
      this.addCommand({
        id: "hard-switch-focus-profile",
        name: "Switch knowledge profile (filesystem destroy + materialize)",
        callback: () => {
          void commandsHandler.invokeSwitchKnowledgeProfile();
        },
      });
    }

    // RFC 22b50a17 Decision #6 — wipe-all switch cache clearing.
    this.addCommand({
      id: "clear-switch-cache",
      name: "Clear switch cache (wipe-all)",
      callback: () => {
        void this.invokeClearSwitchCache();
      },
    });

    // RFC 13da049f Phase 6.2/6.3 — Bootstrap vault + Add AssetSpace by URL.
    // Desktop-only: both reuse the Phase 5 hard-switch deps (AssetSpaceManager
    // REST pull + GitSubmoduleOps staging move / .gitmodules). Registered only
    // when those deps are wired (desktop + vault.adapter.basePath available).
    if (hardSwitchDeps !== null) {
      this.registerBootstrapCommands(hardSwitchDeps, localDataStore);
    }

    this.logger.info(
      "[ExocortexPlugin] FocusProfile palette commands registered",
    );

    return reapplyActiveProfileFilter;
  }

  /**
   * Wire + register the RFC 13da049f Phase 6.2/6.3 palette commands
   * («Bootstrap vault» + «Add AssetSpace by URL»). Reuses the Phase 5
   * `AssetSpaceManager` (REST tarball pull) and `GitSubmoduleOps` (staging
   * move + `.gitmodules` text manipulation) — no REST/security logic is
   * duplicated. Desktop-only; the caller gates on `hardSwitchDeps !== null`.
   */
  private registerBootstrapCommands(
    hardSwitchDeps: {
      assetSpaceManager: AssetSpaceManager;
      gitOps: GitSubmoduleOps;
    },
    localDataStore: PluginLocalDataStore,
  ): void {
    const deriveFolderName = (url: string): string => {
      const { repo } = parseGitHubURL(url);
      return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
    };

    const bootstrapCommands = new BootstrapAssetSpaceCommands({
      puller: hardSwitchDeps.assetSpaceManager,
      gitOps: hardSwitchDeps.gitOps,
      localStore: localDataStore,
      vaultExists: (p) => this.app.vault.adapter.exists(p),
      listFolder: (dir) => this.app.vault.adapter.list(dir),
      isGitVault: () => this.app.vault.adapter.exists(".git"),
      validateUrl: (url) => GitHubRestClient.validateRepoURL(url),
      deriveFolderName,
      promptBootstrapUrls: () =>
        new Promise((resolve) => {
          new BootstrapVaultModal(this.app, resolve).open();
        }),
      promptAddAssetSpaceUrl: () =>
        new Promise((resolve) => {
          new AddAssetSpaceModal(this.app, deriveFolderName, resolve).open();
        }),
      confirm: (message) =>
        new Promise((resolve) => {
          new SimpleConfirmModal(
            this.app,
            {
              title: "Fetch tracked AssetSpaces?",
              body: message,
              confirmLabel: "Fetch",
            },
            resolve,
          ).open();
        }),
      notify: (message) => this.notifier.info(message),
      onMaterialized: () => this.refreshAndInjectAssetSpaceMaterialization(),
    });

    this.addCommand({
      id: "bootstrap-vault",
      name: "Bootstrap vault",
      callback: () => {
        void bootstrapCommands.invokeBootstrap();
      },
    });

    this.addCommand({
      id: "add-assetspace",
      name: "Add assetspace by URL",
      callback: () => {
        void bootstrapCommands.invokeAddAssetSpace();
      },
    });
  }

  /**
   * Handler for the «Exocortex: Clear switch cache» palette command
   * (RFC 22b50a17 Decision #6 — wipe-all semantics).
   *
   * Flow:
   *   1. Read current cache stats synchronously (count + totalSize).
   *   2. If empty → surface a Notice and return.
   *   3. Otherwise open `ClearSwitchCacheConfirmModal` — user must explicitly
   *      click «Clear» to commit.
   *   4. On commit, invoke `SwitchCacheLayer.clear()` and surface result.
   *
   * Errors from `clear()` surface as a user-facing error Notice — the
   * cache directory is best-effort writable; partial clear is acceptable.
   */
  private async invokeClearSwitchCache(): Promise<void> {
    const cache = new SwitchCacheLayer();
    const stats = cache.getCacheStats();

    if (stats.count === 0) {
      this.notifier.info("Switch cache is already empty.");
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new ClearSwitchCacheConfirmModal(
        this.app,
        { entryCount: stats.count, totalSize: stats.totalSize },
        resolve,
      );
      modal.open();
    });
    if (!confirmed) return;

    try {
      const result = await cache.clear();
      this.notifier.info(
        `Cleared ${result.entriesRemoved} cache entries.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.notifier.error(`Clear switch cache failed: ${msg}`);
    }
  }

  /**
   * Constructs an `IAssetSpacePusher` for {@link registerFocusProfileCommands}.
   *
   * When a GitHub PAT is configured в `data.local.json` (per RFC 0a0791c1
   * Vision Lock #1), returns a real `AssetSpaceManager` — push works
   * end-to-end. When PAT is absent, returns a lookup-only stub backed
   * by a direct vault scan (mirrors `AssetSpaceManager.lookupAssetSpaceForPath`)
   * — push surfaces a «Configure GitHub PAT» Notice без crashing onload.
   *
   * This split lets the Switch command remain fully operational regardless
   * of PAT presence, while the Push command degrades gracefully.
   */
  private async buildAssetSpacePusher(): Promise<IAssetSpacePusher> {
    const secretsStore = new LocalSecretsStore({ app: this.app });
    const pat = await secretsStore.getSecret("pat");
    return createAssetSpacePusher({
      app: this.app,
      pat,
      notifier: this.notifier,
      logger: this.logger,
      lookupOnly: (folderName) =>
        lookupAssetSpaceUidByFolder(this.app, folderName),
    });
  }

}
