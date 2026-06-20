import "reflect-metadata";
import {
  type Editor,
  MarkdownPostProcessorContext,
  MarkdownView,
  MetadataCache,
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
import { ActivityLogService } from "./adapters/logging/ActivityLogService";
import {
  journalEntryToActivity,
  progressToActivity,
} from "./adapters/logging/activityFanIn";
import { ActivityLogModal } from "./presentation/modals/ActivityLogModal";
import { LogFileModal } from "./presentation/modals/LogFileModal";
import {
  TEMPLATE_TOKEN_CHOICES,
  insertTemplateToken,
} from "./infrastructure/adapters/TemplateTokenInserter";
import { pickTemplateToken } from "./infrastructure/adapters/TemplateTokenFuzzyModal";
import {
  collectTemplateChoices,
  insertTemplate,
  resolveTemplateForInsert,
  type TemplateChoice,
  type TemplateInserterApp,
} from "./infrastructure/adapters/TemplateInserter";
import { fuzzySelect } from "./infrastructure/adapters/FuzzySelectModal";
import { CommandManager } from "./application/services/CommandManager";
import { IndexingCompleteNotifier } from "./application/services/IndexingCompleteNotifier";
import {
  ExocortexSettings,
  DEFAULT_SETTINGS,
  DEFAULT_LOG_CHANNELS,
} from "./domain/settings/ExocortexSettings";
import { ExocortexSettingTab } from "./presentation/settings/ExocortexSettingTab";
import {
  DEFAULT_SETTINGS_FOLDER,
  VAULT_SETTINGS_REGISTRY,
} from "./domain/settings/VaultSettingsRegistry";
import { VaultSettingsStore } from "./infrastructure/adapters/VaultSettingsStore";
import {
  TaskStatusService,
  CommandResolver,
  PreconditionEvaluator,
  registerDefaultHostFunctions,
  FolderRepairService,
  GroundingExecutor,
  ServiceRegistry,
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
  NamedQueryRunner,
} from "exocortex";
import { ObsidianFileResolver } from "./infrastructure/ObsidianFileResolver";
import { registerOrderSpecFromObsidianVault } from "./infrastructure/registerOrderSpecFromObsidianVault";
import {
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
import {
  ObsidianNotificationService,
  setDefaultNotificationActivityRecorder,
  type NotificationActivityRecorder,
} from "./infrastructure/di/ObsidianNotificationService";
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
import { createObsidianRefToFolderResolver } from "./infrastructure/services/ObsidianRefToFolderResolver";
import { ExocmdCommandPaletteRegistrar } from "./application/services/ExocmdCommandPaletteRegistrar";
import { ObsidianCommandPromptAdapter } from "./infrastructure/adapters/ObsidianCommandPromptAdapter";
import {
  ProfileCommands,
  type ProfileChoice,
  type IAssetSpacePusher,
} from "./infrastructure/adapters/ProfileCommands";
import { ProfileApplyManager } from "./infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "./infrastructure/adapters/PluginLockManager";
import { VaultProfileResolver } from "./infrastructure/adapters/VaultProfileResolver";
import { PluginRdfIndexerAdapter } from "./infrastructure/adapters/PluginRdfIndexerAdapter";
import { createProfileApplyRefreshHook } from "./infrastructure/adapters/profileApplyRefreshHook";
import { LinkLabelRefreshService } from "./application/services/LinkLabelRefreshService";
import { registerRefreshLinkLabelsCommand } from "./infrastructure/adapters/registerRefreshLinkLabelsCommand";
import { PluginSettingsStoreAdapter } from "./infrastructure/adapters/PluginSettingsStoreAdapter";
import { PluginLocalDataStore } from "./infrastructure/adapters/PluginLocalDataStore";
import { StagingDirTracker } from "./infrastructure/adapters/StagingDirTracker";
import { ProfileFuzzyModal } from "./infrastructure/adapters/ProfileFuzzyModal";
import { buildProfileChoice } from "./infrastructure/adapters/profileChoiceFactory";
import { lookupAssetSpaceUidByFolder } from "./infrastructure/adapters/AssetSpaceLookupHelper";
import { createAssetSpacePusher } from "./infrastructure/adapters/AssetSpacePusherFactory";
import { LocalSecretsStore } from "./infrastructure/adapters/LocalSecretsStore";
import { SwitchCacheLayer } from "./infrastructure/adapters/SwitchCacheLayer";
import { ClearSwitchCacheConfirmModal } from "./infrastructure/adapters/ClearSwitchCacheConfirmModal";
import {
  parseGitHubURL,
  type AssetSpaceInfo,
} from "./infrastructure/adapters/AssetSpaceManager";
import { BootstrapAssetSpaceCommands } from "./infrastructure/adapters/BootstrapAssetSpaceCommands";
import {
  UnmountAssetSpaceCommand,
  buildUnmountableList,
  type UnmountableAssetSpace,
} from "./infrastructure/adapters/UnmountAssetSpaceCommand";
import { BootstrapVaultModal } from "./presentation/modals/BootstrapVaultModal";
import { BootstrapResultModal } from "./presentation/modals/BootstrapResultModal";
import { AddAssetSpaceModal } from "./presentation/modals/AddAssetSpaceModal";
import { SimpleConfirmModal } from "./presentation/modals/SimpleConfirmModal";
import { FirstRunOnboardingModal } from "./presentation/modals/FirstRunOnboardingModal";
import { testPatConnection } from "./presentation/settings/patConnectionTest";
import {
  registerOnboardingCommands,
  shouldShowFirstRunPanel,
  persistOnboardingPat,
  REGISTRY_ASSETSPACE_URL,
  PROFILES_ASSETSPACE_URL,
} from "./infrastructure/adapters/firstRunOnboarding";
import {
  GROOMED_COMMAND_NAMES,
  REMOVE_PACK_CONFIRM_TITLE,
  REMOVE_PACK_CONFIRM_LABEL,
} from "./application/services/commandPaletteContract";
import { resolvePastedSecret } from "./presentation/settings/patClipboard";
import { AssetSpaceMaterializationTracker } from "./infrastructure/adapters/AssetSpaceMaterializationTracker";
import { injectAssetSpaceMaterializationTriples } from "./infrastructure/adapters/injectAssetSpaceMaterializationTriples";
import { AssetSpaceStatusIconPatch } from "./presentation/asset-space/AssetSpaceStatusIconPatch";
import { GitHubRestClient } from "./infrastructure/adapters/GitHubRestClient";
import { GitSubmoduleOps } from "./infrastructure/adapters/GitSubmoduleOps";
import {
  buildApplyDeps,
  buildAssetSpacePuller,
  buildRestAssetSpaceMount,
  type ApplyDeps,
} from "./infrastructure/adapters/ApplyDepsFactory";
import { ModalConfirmGate } from "./infrastructure/adapters/ModalConfirmGate";
import type { RestAssetSpaceMount } from "./infrastructure/adapters/RestAssetSpaceMount";
import { SyncCommands } from "./infrastructure/adapters/SyncCommands";
import { registerExoSyncCommands } from "./infrastructure/adapters/registerExoSyncCommands";
import { buildParityCheck } from "./infrastructure/adapters/ExoSyncParityFactory";
import {
  buildSyncEngine,
  collectSyncRepoSpecs,
} from "./infrastructure/adapters/SyncDepsFactory";
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
   * Two prefix dialects (mixed freely in one list):
   *
   *  1. **Plain prefix** (no `*`) — matched via `String.startsWith` against
   *     the vault-relative path. Fast path; backward-compatible with the
   *     legacy two-vault layout (`assetspaces/ems/`, `assetspaces/exocmd/`).
   *     Caller must end each prefix with `/` so `assetspaces/ems/` does not
   *     over-match `assetspaces/ems-commands/` (Settings UI auto-appends —
   *     see ExocortexSettingTab).
   *
   *  2. **Segment-wildcard glob** (#3588) — a prefix containing a `*` is
   *     matched segment-by-segment, where each `*` matches EXACTLY ONE path
   *     segment. This reaches the EKA audience-layered layout, which mounts
   *     assetspaces at `assetspaces/<owner>/<assetspace>/<namespace>/<uid>.md`
   *     (e.g. `assetspaces/kitelev/exoas-exocmd/exocmd/<uid>.md`). A plain
   *     `startsWith` never matches that depth → bootstrap walked 0 files →
   *     command/binding/grounding triples arrived only via the slow
   *     incremental `convertVault` cold-start (root of the #3587 partial-store
   *     race). The glob `assetspaces/<star>/<star>/exocmd/` (two wildcard
   *     segments, written `<star>` here only to avoid closing this comment)
   *     reaches the namespace folder under ANY owner+assetspace while staying
   *     scope-tight: it targets the SAME 5 TBox namespaces the legacy default
   *     did (exo, ems, ems-commands, ims, exocmd), NOT every assetspace (no
   *     leaf ABox like `exoas-my/pn`) and NOT the whole of `exoas-public` (its
   *     30+ framework namespaces concept, person, ui, …). Folder semantics
   *     preserved: the path must extend BEYOND the glob (a file lives inside
   *     the namespace folder), and a wildcard never spans two segments, so a
   *     single-wildcard `assetspaces/<star>/exocmd/` does NOT collapse the EKA
   *     owner+assetspace nesting.
   *
   * Returns empty array if `folderPrefixes` is empty (degraded mode —
   * bootstrap walks nothing; buttons appear later via convertVault).
   */
  static filterTBoxFiles<T extends { path: string }>(
    files: T[],
    folderPrefixes: string[],
  ): T[] {
    if (folderPrefixes.length === 0) return [];
    // Precompile matchers once (not per-file): plain prefixes keep the cheap
    // startsWith; glob prefixes are pre-split into segments (trailing empty
    // from the required trailing `/` dropped, so the segment array is the
    // folder path the file must live inside).
    const plainPrefixes: string[] = [];
    const globSegmentSets: string[][] = [];
    for (const prefix of folderPrefixes) {
      if (prefix.includes("*")) {
        const segs = prefix.split("/");
        if (segs[segs.length - 1] === "") segs.pop();
        globSegmentSets.push(segs);
      } else {
        plainPrefixes.push(prefix);
      }
    }
    const matchesGlob = (path: string): boolean => {
      if (globSegmentSets.length === 0) return false;
      const pathSegs = path.split("/");
      return globSegmentSets.some((glob) => {
        // Folder prefix: the file must live INSIDE the folder, so it needs
        // strictly more segments than the glob (the filename, at least).
        if (pathSegs.length <= glob.length) return false;
        for (let i = 0; i < glob.length; i++) {
          if (glob[i] !== "*" && glob[i] !== pathSegs[i]) return false;
        }
        return true;
      });
    };
    return files.filter(
      (f) =>
        plainPrefixes.some((p) => f.path.startsWith(p)) || matchesGlob(f.path),
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
  /**
   * #3540 — in-memory activity stream (ring buffer + pub/sub) backing the
   * «Open activity log» modal. Created in `onload()` and hoisted so every
   * activity source (ExoSync, profile apply, mount/unmount, bootstrap) can
   * `record(...)` from onload onward, independent of whether the modal is open.
   */
  private activityLog!: ActivityLogService;
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
   * Issue #3320 — ProfileApplyManager hoisted onto the plugin instance
   * so onload recovery / reconcile reuse the single manager без re-constructing
   * a second one (which would race the original on the same persisted lock
   * file). Initialized in `registerProfileCommands()`; null until that
   * call succeeds.
   */
  public profileApplyManager: ProfileApplyManager | null = null;

  /**
   * Issue #3320 — profile choice lister hoisted alongside the switch
   * manager. Returns the same FuzzySuggestModal-shaped choices the palette
   * command uses, so the Settings dropdown matches Cmd+P ordering.
   * Initialized in `registerProfileCommands()`; null until that
   * call succeeds.
   */
  public listProfileChoices: (() => Promise<ProfileChoice[]>) | null = null;

  /**
   * Issue #3327 Item #3 — device-local switch state store (Sync-excluded).
   * Holds `activeProfileUid` + `_switchInProgress` per-device so profile
   * selection does not replicate cross-device. Initialized в
   * `registerProfileCommands` after one-time legacy-keys migration;
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
   * onto-RFC 981b6070 Phase 5 (ExoSync Phase D / D2) — vault-asset
   * settings store. Constructed lazily in the `metadataCache.resolved`
   * one-shot init (scan before resolve misreads unparsed files as
   * missing). Null until then; `saveSettings()` no-ops the vault push
   * while null and the data.json mirror keeps working as before.
   */
  public vaultSettingsStore: VaultSettingsStore | null = null;

  /**
   * Registry-field snapshot taken at the end of `loadSettings()` —
   * cold-start dirty-field detection input for the vault-settings
   * overlay (user toggles between onload and the first scan win over
   * stale asset values).
   */
  private settingsBaseline: Record<string, unknown> = {};

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
  public assetSpaceMaterializationTracker: AssetSpaceMaterializationTracker | null =
    null;

  override async onload(): Promise<void> {
    try {
      // Initialize DI container (Phase 1 infrastructure)
      PluginContainer.setup(this.app, this);

      this.logger = LoggerFactory.create("ExocortexPlugin");
      this.logger.info("Loading Exocortex Plugin");

      // Initialize timer manager for lifecycle-safe setTimeout/setInterval
      this.timerManager = new TimerManager();

      await this.loadSettings();

      // #3540 — always-on activity buffer; sources fan in from onload onward.
      // Created BEFORE the notifier so every toast routed through the central
      // INotificationService sink (ObsidianNotificationService) records here.
      this.activityLog = new ActivityLogService();
      // Initialize notification service + log channel routing. The notifier is
      // the single `new Notice` sink (eslint forbids `new Notice` elsewhere),
      // so wiring it to the activity log makes the log COMPLETE — every toast
      // appears, not just the few structured producer feeds. The module-level
      // default recorder also covers ObsidianNotificationService instances built
      // inside command flows that never receive `activityLog` directly (the
      // exocmd palette flow, CommandManager) — see #3540 follow-up.
      const recordToast: NotificationActivityRecorder = ({ level, message }) =>
        this.activityLog.record({ category: "notice", level, message });
      setDefaultNotificationActivityRecorder(recordToast);
      this.notifier = new ObsidianNotificationService({
        recordActivity: recordToast,
      });
      this.fileLogChannel = new FileLogChannel(
        this.app.vault.adapter,
        this.manifest.dir ??
          `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
      );
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
      // RFC 78c2b7d0 C4 — read-side value-source. Reuses the same
      // ObsidianQueryBodyResolver (```sparql block, M2 lock) the precondition
      // path uses; resolves a property_set `targetValueQuery` to a scalar with
      // `$currentAsset` auto-injected (the CQRS bridge consumed by C5).
      const namedQueryRunner = new NamedQueryRunner(
        queryBodyResolver,
        tripleStore,
      );
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
          groundingLoader: (uid) =>
            this.commandResolver.loadGroundingByUid(uid),
          namedQueryRunner,
          // T1 "Create Instance" (project bbe40f8c) — co-locate new instances in
          // their chosen ontology's folder via the `$isDefinedByFolder` token.
          refToFolder: createObsidianRefToFolderResolver(this.app),
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

      // RFC exo__Layout Phase 2 — wire ExoLayoutRepository + LayoutSelector
      // using a live-snapshot pattern.
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
          // RFC 0002 §3.8 P13 (#3588) — cold-start COMMANDS skeleton gate.
          // `isReady()` flips true after the first `convertVault()`; while it
          // is false the renderer shows an "indexing…" placeholder in place of
          // an empty COMMANDS region instead of a blank layout.
          isStoreReady: () => this.sparql.isReady(),
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

      // Веха 1 / MVP (WBS bb1c98af + 844ced36) — «Exocortex: Refresh link
      // labels». After materialising an AssetSpace, bare `[[uid]]` wikilinks
      // whose target lived in the previously-unmounted space keep showing the
      // raw `uid` until an Obsidian restart (open editor views hold a stale
      // DecorationSet; nothing re-runs `buildDecorations`). This command
      // re-resolves them in place — ensure the index is fresh
      // (`sparql.refresh()` → `convertVault()`, so even NEW tabs resolve),
      // reconfigure all open editor views (`updateOptions()` recreates the
      // WikilinkLabelViewPlugin instances → fresh decorations), and re-render
      // dynamic layouts. The same `LinkLabelRefreshService.refresh()` is the
      // unit the Веха 2 auto-hook will reuse. Registered UNCONDITIONALLY (no
      // Platform gate): pure in-memory re-resolve, no Node/fs/git
      // (Desktop↔Mobile Command Parity). Graceful — never throws / shows a
      // Notice; unresolvable links simply stay `uid`.
      const linkLabelRefreshService = new LinkLabelRefreshService({
        ensureIndexFresh: () => this.sparql.refresh(),
        rebuildEditorViews: () => this.app.workspace.updateOptions(),
        rerenderLayouts: () => this.autoRenderLayout(),
        logger: {
          debug: (message, ...args) => this.logger.debug(message, ...args),
          warn: (message, ...args) => this.logger.warn(message, ...args),
        },
      });
      registerRefreshLinkLabelsCommand(this, linkLabelRefreshService);

      // RFC 0a0791c1 #3322 — register Profile palette commands
      // (Switch / Push current assetspace). Wraps the B.7 handler with
      // real adapters. Wrapped в try/catch: any failure here должен NOT
      // abort the rest of onload — commands simply won't appear in
      // Cmd+P, but plugin remains usable.
      try {
        await this.registerProfileCommands();
      } catch (error) {
        this.logger.error(
          "[ExocortexPlugin] Profile commands registration failed",
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

      // Issue #3472 — one-shot «Exocortex: indexing complete (N files,
      // M skipped, X.Xs)» notice, emitted when the initial full vault walk
      // finishes and SPARQL / dynamic buttons / layouts are actually ready.
      // Two callsites share this emitter (the internal latch dedupes):
      //   1. the eager-init warm-up chain below (covers mid-session plugin
      //      enable, where `metadataCache.on("resolved")` may not fire
      //      again until the user edits a file);
      //   2. the post-resolve one-shot reindex chain (covers cold boot,
      //      where the eager walk runs against a partially-parsed
      //      metadataCache and the resolved-chain refresh is the
      //      authoritative initial pass).
      // All later full refreshes (profile switch, FileSpace declaration
      // edits) and incremental per-file updates never call the emitter —
      // they stay quiet by design.
      const indexingCompleteNotifier = new IndexingCompleteNotifier(
        this.notifier,
      );

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

          if (postResolveReindexDone) return;
          postResolveReindexDone = true;

          // onto-RFC 981b6070 Phase 5 (D2) — vault-asset settings init,
          // one-shot on the same authoritative "metadata fully parsed"
          // signal (shares the postResolveReindexDone gate). Scanning
          // earlier (e.g. onLayoutReady) reads null frontmatter for
          // unparsed files, misclassifies existing Setting assets as
          // missing, and the migration would create duplicates on every
          // cold start (advisor F5). Because data.json is a
          // write-through mirror, the late overlay produces a non-empty
          // diff ONLY on real cross-device drift — the common boot path
          // is a no-op. Fire-and-forget: settings init must not delay
          // (or be delayed by) the reindex chain below.
          void this.initVaultSettings().catch((err) => {
            this.logger.error(
              "Failed to initialize vault-asset settings (D2)",
              err,
            );
          });

          const initPromise = this.eagerInitPromise ?? Promise.resolve();
          // RFC 22b50a17 Phase 4 — after each `sparql.refresh()` (which
          // clears+rebuilds the store from frontmatter), re-inject the
          // runtime-derived `exo:AssetSpace_materialized` triples via
          // `refreshAndInjectAssetSpaceMaterialization`. Soft- and hard-
          // switch paths via `ProfileApplyManager` are covered by
          // `PluginRdfIndexerAdapter.onAfterRefresh`; these onload chain
          // callsites use `sparql.refresh()` directly which bypasses the
          // adapter, so they call the helper explicitly.
          // Issue #3472 — taken right before refresh() is invoked (inside
          // the chain, after the eager-init promise settles) so the
          // stale-stats guard in `notifyOnce` can reject stats from a walk
          // that finished before THIS refresh started (coalesced-refresh
          // false-positive path — see IndexingCompleteNotifier JSDoc).
          let postResolveRefreshStartedAt = 0;
          void initPromise
            .then(() => {
              postResolveRefreshStartedAt = Date.now();
              return this.sparql.refresh();
            })
            .then(() => this.refreshAndInjectAssetSpaceMaterialization())
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
              // Issue #3472 — the initial full reindex is done AND the
              // dependent surfaces (palette, layouts) just re-rendered:
              // this is the moment «indexing complete» is true for the
              // user. On refresh failure the .catch below short-circuits
              // this call — no false-positive notice. Quiet no-op when the
              // eager-init callsite already emitted (one-shot latch).
              indexingCompleteNotifier.notifyOnce(
                this.sparql.getLastIndexWalkStats(),
                postResolveRefreshStartedAt,
              );
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
            // Issue #3472 — see the stale-stats guard note at the
            // post-resolve callsite; the ASK below lazily triggers
            // `VaultRDFIndexer.initialize()` (the walk being reported).
            // The metadataCache warmth flag is captured HERE, at walk
            // start — NOT at emit time. On a cold boot Obsidian's initial
            // metadata scan can finish DURING the multi-second eager
            // walk; reading the live flag after the walk would route a
            // partially-parsed-cache walk to the eager notice instead of
            // deferring to the authoritative post-resolve refresh.
            // `initialized` is undocumented-but-stable Obsidian API
            // (Dataview relies on it); if it ever disappears the
            // comparison is `undefined === true` → false → safe fallback
            // to the post-resolve callsite.
            const eagerWarmupStartedAt = Date.now();
            const cacheWasWarmAtWalkStart =
              (
                this.app.metadataCache as MetadataCache & {
                  initialized?: boolean;
                }
              ).initialized === true;
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

                // Issue #3472 — emit «indexing complete» from the eager
                // path ONLY when metadataCache had already finished its
                // initial scan BEFORE this walk started (mid-session
                // plugin enable / first install: cache is warm, counts
                // are honest, and the `metadataCache.on("resolved")`
                // chain may not fire again until the user edits a file —
                // without this callsite the notice would never appear for
                // that persona). On a cold boot the flag was still false
                // at walk start, the guard skips, and the post-resolve
                // chain emits after the authoritative refresh instead.
                // One-shot latch dedupes the two callsites.
                if (cacheWasWarmAtWalkStart) {
                  indexingCompleteNotifier.notifyOnce(
                    this.sparql.getLastIndexWalkStats(),
                    eagerWarmupStartedAt,
                  );
                }

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
    // #3540 follow-up — drop the module-level toast→activity-log recorder so a
    // reloaded plugin's notifications don't fan into this (now-stale) buffer.
    setDefaultNotificationActivityRecorder(undefined);

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

    // onto-RFC 981b6070 (D2) — snapshot registry fields for cold-start
    // dirty detection: the vault-settings overlay (metadataCache
    // resolved, possibly tens of seconds later) must not roll back
    // toggles the user made in the meantime (advisor F12).
    const baseline: Record<string, unknown> = {};
    for (const d of VAULT_SETTINGS_REGISTRY) {
      const v = (this.settings as Record<string, unknown>)[d.field];
      baseline[d.field] = Array.isArray(v) ? [...v] : v;
    }
    this.settingsBaseline = baseline;
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
    // onto-RFC 981b6070 (D2) — write-through to vault assets for
    // homoiconizable fields. Every UI surface funnels through this
    // method (SettingTab × 32 controls, palette commands,
    // DailyTasksRenderer), so intercepting here covers them all without
    // touching call sites. Diff-based + debounced inside the store;
    // remote applies go through `saveData` directly, so this cannot
    // loop.
    this.vaultSettingsStore?.pushChangedFields();
  }

  /**
   * One-shot init of the vault-asset settings layer (D2). Runs on the
   * first `metadataCache.resolved`:
   *  1. class-based scan of `exo__Setting` assets (location-independent
   *     — assets moved into an AssetSpace mount keep working and get
   *     ExoSync coverage for free);
   *  2. overlay: vault values → live settings (+ side-effect hooks +
   *     data.json mirror); dirty fields (user toggles since onload) are
   *     pushed to the vault instead;
   *  3. one-shot idempotent migration: data.json values → assets for
   *     registry keys that have none (skipped mid profile-switch);
   *  4. live watchers for cross-device changes arriving via sync.
   */
  private async initVaultSettings(): Promise<void> {
    // Issue #3539 — master switch (default OFF). When disabled, skip the
    // entire D2 pipeline: no scanAll / applyScan / migrateMissing and no
    // metadataCache watcher. `vaultSettingsStore` stays null, so
    // `saveSettings()` write-back is a no-op (optional-chained) and the
    // plugin behaves exactly as pre-D2 (reads/writes only data.json). No
    // `exocortex-settings/` folder is created for new users; any already-
    // migrated assets are left on disk untouched (re-adopted on re-enable).
    // The gate is checked once here on load, so flipping the toggle in the
    // SettingTab takes effect on the next plugin reload.
    if (this.settings.settingsHomoiconizationEnabled !== true) {
      this.logger.info(
        "[D2] settings-homoiconization disabled (settingsHomoiconizationEnabled=false) — skipping vault-asset settings init",
      );
      return;
    }

    const store = new VaultSettingsStore({
      app: this.app,
      logger: this.logger,
      getSettings: () => this.settings as Record<string, unknown>,
      baseline: this.settingsBaseline,
      applyRemote: async (field, value) => {
        (this.settings as Record<string, unknown>)[field] = value;
        this.applySettingSideEffect(field, value);
        await this.saveData(this.settings);
      },
    });

    const scan = store.scanAll();
    const overlaid = await store.applyScan(scan);
    if (overlaid.length > 0) {
      this.logger.info(
        `[D2] applied ${overlaid.length} vault setting(s) over data.json: ` +
          overlaid.join(", "),
      );
    }

    // Publish only after scan+overlay so saveSettings() cannot race a
    // half-initialized store.
    this.vaultSettingsStore = store;

    // Migration is skipped while a profile switch is in flight —
    // AssetSpace mounts (a legal home for relocated Setting assets) are
    // being torn down/rebuilt and "missing" is not trustworthy (F2).
    if (this.localDataStore?.isSwitchInProgress() !== true) {
      const created = await store.migrateMissing();
      if (created.length > 0) {
        this.notifier.info(
          `Exocortex: migrated ${created.length} setting(s) to vault assets in "${DEFAULT_SETTINGS_FOLDER}/"`,
        );
        this.logger.info(
          `[D2] one-shot settings migration created ${created.length} asset(s): ` +
            created.join(", "),
        );
      }
    } else {
      this.logger.info(
        "[D2] settings migration deferred — profile switch in progress",
      );
    }

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        void store.onMetadataChanged(file).catch((err) => {
          this.logger.warn(
            `[D2] settings watcher failed for ${file.path}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        store.onFileDeleted(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          store.onFileRenamed(file, oldPath);
        }
      }),
    );
  }

  /**
   * Side-effect hooks for settings applied from the vault (overlay /
   * watcher) — mirrors what the SettingTab onChange handlers do after
   * mutating the same field. Fields not listed are read-on-use
   * (no immediate hook needed); `excludedFolders` /
   * `lazyBootstrapFolders` are snapshotted by indexer components at
   * startup — same reload-required semantics as editing them in the
   * SettingTab (documented in ExocortexSettings.ts).
   */
  private applySettingSideEffect(field: string, value: unknown): void {
    try {
      switch (field) {
        case "layoutVisible":
        case "showArchivedAssets":
        case "showEffortArea":
        case "showEffortVotes":
        case "showFullDateInEffortTimes":
        case "showTimeEstimate":
        case "enableExoLayoutRenderer":
          this.refreshLayout();
          break;
        case "showLabelsInTabTitles":
          this.toggleTabTitleLabels(value === true);
          break;
        case "showLabelsInProperties":
          this.togglePropertiesLabels(value === true);
          break;
        case "enablePropertiesLabelPatch":
          this.togglePropertiesLabelPatch(value === true);
          break;
        case "showIconsInFileExplorer":
          this.toggleFileExplorerIcons(value === true);
          break;
        case "showLabelsInBody":
          this.toggleBodyLabels(value === true);
          break;
        case "showLabelsInGraphView":
          this.toggleGraphViewLabels(value === true);
          break;
        case "displayNameTemplate":
          this.applyDisplayNameTemplate();
          break;
        default:
          break;
      }
    } catch (err) {
      this.logger.warn(
        `[D2] side-effect for setting "${field}" failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
              if (!(subj instanceof DomainIRI) || !(pred instanceof DomainIRI))
                continue;
              let algObj:
                | { type: "iri"; value: string }
                | { type: "literal"; value: string; datatype?: string }
                | null = null;
              if (obj instanceof DomainIRI) {
                algObj = { type: "iri", value: obj.value };
              } else if (obj instanceof DomainLiteral) {
                algObj = {
                  type: "literal",
                  value: obj.value,
                  datatype: obj.datatype?.value,
                };
              }
              if (!algObj) continue;
              algebraTriples.push({
                subject: { type: "iri", value: subj.value },
                predicate: { type: "iri", value: pred.value },
                object: algObj,
              });
            }

            const shaclRegistry = new ShaclShapeRegistry(
              shapeRegistry.getAll(),
            );
            const hierarchy: ShaclClassHierarchy = {
              isSubClassOf: (c, p) => c === p,
            };
            const report = shaclValidate(
              algebraTriples,
              shaclRegistry,
              hierarchy,
            );

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
              console.debug(
                `[Exocortex SHACL] Info in ${file.path}: ${v.message}`,
              );
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
   * RFC 0a0791c1 #3322 — register the two Profile palette commands
   * («Switch focus profile», «Push current assetspace»). Wires the B.7
   * `ProfileCommands` handler with real adapters:
   *
   *   - B.4 `ProfileApplyManager`: persisted lock + journal + RDF
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
   *    Profile re-apply path),
   *  - `PluginRdfIndexerAdapter.onAfterRefresh` so soft- and hard-
   *    switch paths via `ProfileApplyManager` re-inject
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

  /**
   * RFC 0002 §3.4 P7b — collect every `exo__Asset_uid` present in the vault so
   * the profile picker can decide which profiles are locally relevant (their
   * `exo__Profile_includes` AssetSpaces resolve to assets on disk). One
   * in-memory `metadataCache` pass; called per picker open (infrequent).
   */
  private collectPresentAssetUids(): Set<string> {
    const uids = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      const uid = fm?.["exo__Asset_uid"];
      if (typeof uid === "string" && uid.length > 0) uids.add(uid);
    }
    return uids;
  }

  /**
   * Open the live in-memory «Open activity log» modal (#3540), wired with a
   * cross-nav hook to the persisted log-file modal. The two log views are easy
   * to confuse in the command palette, so each opens the other in one click —
   * the hook re-enters via {@link openLogFileModal}, which in turn wires the
   * reciprocal hook, so the bridge stays bidirectional at every hop.
   */
  private openActivityLogModal(): void {
    new ActivityLogModal(this.app, this.activityLog, () =>
      this.openLogFileModal(),
    ).open();
  }

  /**
   * Open the persisted «Open log file» modal (RFC 0002 §3.8 / #3588), wired with
   * a cross-nav hook back to the live activity-log modal. Reciprocal of
   * {@link openActivityLogModal}.
   */
  private openLogFileModal(): void {
    new LogFileModal(this.app, this.fileLogChannel, () =>
      this.openActivityLogModal(),
    ).open();
  }

  private async registerProfileCommands(): Promise<void> {
    const lockMgr = new PluginLockManager({ app: this.app });
    const resolver = new VaultProfileResolver(this.app);
    // RFC 22b50a17 Phase 4 (H1 cascade catch — advisor round-2) — wire a
    // post-refresh hook so apply paths via `ProfileApplyManager` re-inject
    // `exo:AssetSpace_materialized` triples automatically after every
    // `rdfIndexer.refresh()`. Without this, profile switching would
    // silently drop the runtime-derived materialization triples until the
    // next `metadataCache.resolved` event.
    //
    // GUI-smoke D1 — the hook ALSO invalidates the command/precondition
    // resolver caches + lazy-loader marks and re-renders active layouts.
    // A mount-state rebuild leaves the store complete but the resolver
    // caches stale: inline create-buttons resolved (and cached empty)
    // against the pre-mount store otherwise stay hidden on
    // `ems__Project` / `ems__MeetingPrototype` until a full plugin reload.
    // This mirrors the cold-start (`metadataCache.on("resolved")`) and
    // hot-reindex (`scheduleHotReindex`) paths, which already do this.
    const rdfIndexer = new PluginRdfIndexerAdapter(
      this.sparql.getRdfIndexer(),
      createProfileApplyRefreshHook({
        refreshAndInject: () =>
          this.refreshAndInjectAssetSpaceMaterialization(),
        clearLazyLoader: () => this.lazyAssetGraphLoader?.clearAll(),
        invalidateCommandResolverCache: () =>
          this.commandResolver.invalidateCache(),
        invalidatePreconditionCache: () =>
          this.preconditionEvaluator.invalidateCache(),
        rerenderLayouts: () => this.autoRenderLayout(),
      }),
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

    // RFC 0a0791c1 Phase 5 T2 — the dual Knowledge/Focus active-state slots
    // were retired together with the soft RDF filter. `activeProfileUid` is
    // now the single last-applied cache; any leftover dual keys on disk are
    // ignored (read-modify-write preserves them harmlessly).
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

    // Phase 5 P3 — apply dependencies (desktop-only). On mobile, the
    // palette command throws via the AssetSpaceManager pull guard, so we skip
    // wiring entirely. Extracted to `buildApplyDeps` for testability —
    // an empty-PAT GitHubRestClient ctor throw previously left this `null` and
    // silently hid the gated Bootstrap / knowledge-switch palette commands.
    const applyDeps: ApplyDeps | null = Platform.isMobile
      ? null
      : await buildApplyDeps({
          app: this.app,
          localDataStore,
          notifier: this.notifier,
          logger: this.logger,
        });

    // RFC 01a83de8 Phase 3 T2 — cross-platform (incl. iOS) REST/tarball mount.
    // Built on BOTH platforms: the mobile profile-switch path consumes it
    // (`ProfileApplyManager.applyProfileViaRest`), and it's harmless on
    // desktop (the desktop apply keeps the git-binary path). Best-effort
    // — a wiring failure logs + leaves restMount null (mobile switch then
    // surfaces a clear "not wired" error instead of crashing onload).
    let restMount: RestAssetSpaceMount | null = null;
    try {
      restMount = await buildRestAssetSpaceMount({ app: this.app });
    } catch (err) {
      this.logger.warn(
        "[ExocortexPlugin] buildRestAssetSpaceMount failed — mobile profile switch unavailable",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    // The mobile REST switch needs a ConfirmGate; on desktop it comes from
    // applyDeps. ModalConfirmGate only needs `app` (mobile-safe).
    const confirmGate =
      applyDeps?.confirmGate ?? new ModalConfirmGate(this.app);

    // ExoSync Phase B (RFC 4e4dc453) — manual «Sync» over the requestUrl
    // transport (iOS-capable, no git binary). Built BEFORE the apply manager
    // so its busy flag feeds the D11 apply→sync exclusion below. The engine
    // is composed fresh per invocation (fresh-PAT pattern, Issue #3382).
    const syncCommands = new SyncCommands({
      collectSpecs: () => collectSyncRepoSpecs(this.app),
      buildEngine: (asUidByRepoKey) =>
        buildSyncEngine({
          app: this.app,
          localDataStore,
          asUidByRepoKey,
          quarantineRepoUrl: this.settings.exosyncQuarantineRepoUrl,
        }),
      isSwitchInProgress: () => localDataStore.isSwitchInProgress(),
      notify: (message) => this.notifier.info(message),
      log: (message) => {
        this.logger.warn(message);
        // #3540 — surface ExoSync warnings in the activity stream.
        this.activityLog.record({
          category: "exosync",
          level: "warn",
          message,
        });
      },
      logInfo: (message) => {
        this.logger.info(message);
        // #3540 — always-on ExoSync step feed (onProgress info channel).
        this.activityLog.record({
          category: "exosync",
          level: "info",
          message,
        });
      },
      // #3498 — opt-in durable verbose FILE trace (default off). Appends the
      // step lines directly to the plugin file log, INDEPENDENT of
      // logChannels.info.file. Read live so the Settings toggle takes effect on
      // the next sync without a reload; no-op (no file write) when off.
      logVerbose: (message) => {
        if (this.settings.verboseSyncLogging) {
          this.fileLogChannel.append("info", "ExoSync", message);
        }
      },
      // #3499 — opt-in verbose per-step toasts (default off). Read live (like
      // isSwitchInProgress) so the Settings toggle takes effect on the next
      // sync without a plugin reload.
      stepNoticesEnabled: () => this.settings.exosyncStepNotices,
      // ExoSync Phase E (E1) — automatic M1/M2 parity round after every
      // sync + the standalone palette report (parallel-run validation).
      parity: buildParityCheck({
        app: this.app,
        log: (message) => this.logger.warn(message),
      }),
    });

    const switchMgr = new ProfileApplyManager({
      app: this.app,
      lockMgr,
      resolver,
      rdfIndexer,
      settingsStore,
      notify: (message) => this.notifier.info(message),
      // #3540 — fan profile apply / mount / unmount phases into the activity log.
      onPhase: (entry) =>
        this.activityLog.record(journalEntryToActivity(entry)),
      // Live per-AssetSpace "Mounting X (2 of 5)" progress during materialize —
      // activity-log-only (never toasted), so a long apply visibly progresses.
      onProgress: (event) => this.activityLog.record(progressToActivity(event)),
      assetSpaceManager: applyDeps?.assetSpaceManager,
      gitOps: applyDeps?.gitOps,
      restMount: restMount ?? undefined,
      // Fresh-PAT rebuild at switch time (Issue #3382 pattern) so a PAT set
      // after onload is honoured without a reload — the primary mobile flow.
      restMountFactory: () => buildRestAssetSpaceMount({ app: this.app }),
      // Issue #3557 — desktop analogue: rebuild the apply puller from the CURRENT
      // PAT at switch time so a PAT configured after onload authenticates a
      // PRIVATE-AssetSpace apply without a reload (lazy closure — only invoked on
      // the desktop materialize path, never on mobile's REST path).
      assetSpaceManagerFactory: () =>
        buildAssetSpacePuller({
          app: this.app,
          localDataStore,
          notifier: this.notifier,
        }),
      uncommittedGuard: applyDeps?.uncommittedGuard,
      confirmGate,
      cacheLayer: applyDeps?.cacheLayer,
      vaultRootPath: applyDeps?.vaultRootPath,
      localDataStore,
      // ExoSync D11 composition — apply refuses to start mid-sync.
      isSyncBusy: () => syncCommands.isBusy(),
    });

    // Issue #3320 — expose the manager на plugin instance so onload recovery /
    // reconcile reuse it. Re-constructing a second manager would race the
    // original on the same lock file.
    this.profileApplyManager = switchMgr;

    // Issue #3554 — DEFER crash-recovery + cross-device reconcile to
    // `onLayoutReady`. These best-effort ops were previously awaited INLINE here,
    // and `registerProfileCommands` is itself awaited by `onload`. When an applied
    // profile leaves `activeProfileUid` set, `reconcileToLocal()` can compute a
    // divergence and open a blocking `ApplyConfirmModal` (via
    // `confirmGate.confirmApply`). During onload — BEFORE `layoutReady` — that modal
    // can never be confirmed, so the `await` deadlocked: `onload` never resolved and
    // Obsidian hung forever at "Loading plugins…" (`layoutReady` never fired, the
    // vault stayed unusable; clearing `activeProfileUid → null` was the only
    // recovery). Running them AFTER `layoutReady` lets onload return promptly AND
    // lets the reconcile confirm modal (if any) be shown + confirmed normally once
    // the UI is interactive. All three ops are idempotent best-effort (each its own
    // try/catch) and none gate the command registration below, so deferral is safe
    // on both desktop and mobile.
    this.app.workspace.onLayoutReady(() => {
      void this.runDeferredProfileRecovery(
        settingsStore,
        switchMgr,
        applyDeps !== null,
      );
    });

    const pushMgr = await this.buildAssetSpacePusher();

    // Shared choice-builder for the per-class palette pickers (RFC 13da049f
    // AC17). `activeUid` drives the `isActive` flag the picker surfaces.
    //
    // RFC 0002 §3.4 — also surfaces, per profile asset (all RDF-sourced;
    // Homoiconicity — never hardcoded):
    //   - `exo__Profile_description` → one-line description (P7)
    //   - `exo__Profile_recommended: true` → «recommended» badge (P7, starter)
    //   - locality (P7b): a profile is locally relevant when EVERY
    //     `exo__Profile_includes` AssetSpace UID resolves to an asset present
    //     on disk (`presentUids`). Empty includes ⇒ vacuously relevant.
    const buildProfileChoices = (
      files: TFile[],
      activeUid: string | null,
      presentUids: Set<string>,
    ): ProfileChoice[] => {
      const choices: ProfileChoice[] = [];
      for (const file of files) {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter as Record<string, unknown> | undefined;
        if (!fm) continue;
        const choice = buildProfileChoice(
          fm,
          file.basename,
          activeUid,
          presentUids,
        );
        if (choice !== null) choices.push(choice);
      }
      // Sort alphabetically by label so picker order is stable across
      // vault scans (vault.getMarkdownFiles() is filesystem-order, not
      // semantic).
      choices.sort((a, b) => a.label.localeCompare(b.label));
      return choices;
    };

    // RFC 0a0791c1 Phase 5 T2 — single `exo__Profile` picker (the former dual
    // soft/Knowledge listers collapsed into one). `activeProfileUid` is the
    // last-applied selection; Item #3 — device-local store (no Sync replication).
    const profileLister: () => Promise<ProfileChoice[]> = async () =>
      buildProfileChoices(
        resolver.listProfileFiles(),
        localDataStore.getActiveProfileUid(),
        this.collectPresentAssetUids(),
      );

    // Issue #3320 — share the same lister с Settings UI so its dropdown
    // matches the Cmd+P fuzzy-pick ordering exactly.
    this.listProfileChoices = profileLister;

    const fuzzyPick = (
      options: ProfileChoice[],
      title: string,
      initialQuery?: string,
    ): Promise<ProfileChoice | null> => {
      return new Promise<ProfileChoice | null>((resolve) => {
        const modal = new ProfileFuzzyModal(
          this.app,
          options,
          title,
          resolve,
          initialQuery,
        );
        modal.open();
      });
    };

    const commandsHandler = new ProfileCommands({
      switchMgr,
      pushMgr,
      // Issue #3557 — rebuild the pusher from the current PAT per push so a PAT
      // set after onload authenticates without a reload (desktop + mobile both
      // read the same stored PAT via buildAssetSpacePusher).
      pushMgrFactory: () => this.buildAssetSpacePusher(),
      profileLister,
      fuzzyPick,
      getActiveFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      getActiveProfileUid: () => localDataStore.getActiveProfileUid(),
      // RFC 0002 §3.10 — undo target for «Undo last profile apply».
      getPreviousProfileUid: () => localDataStore.getPreviousProfileUid(),
      notify: (message) => this.notifier.info(message),
    });

    // RFC 0002 §3.2 (P3) — de-jargon: «Push current assetspace» → «Push current
    // knowledge pack». Name sourced from the palette grooming contract.
    this.addCommand({
      id: "push-current-assetspace",
      name: GROOMED_COMMAND_NAMES["push-current-assetspace"],
      callback: () => {
        void commandsHandler.invokePushCurrentAssetSpace();
      },
    });

    // RFC 0002 §3.2 (P3) — de-jargon: «Show current state» → «Show active
    // profile». Reports the last-applied profile (RFC 0a0791c1 Phase 5 T2 —
    // single slot). Available regardless of platform / wiring.
    this.addCommand({
      id: "show-profile-state",
      name: GROOMED_COMMAND_NAMES["show-profile-state"],
      callback: () => {
        void commandsHandler.invokeShowCurrentState();
      },
    });

    // #3540 — «Open activity log (live)»: real-time modal over the in-memory
    // activity stream (ExoSync / profile apply / mount-unmount / bootstrap).
    // Pure UI + in-memory buffer (no Node/fs/git) → registered UNCONDITIONALLY
    // so it works identically on desktop and mobile (Desktop↔Mobile Command
    // Parity). The «(live)» qualifier disambiguates it from «Open log file
    // (saved)» below — the in-memory stream is ephemeral (cleared on reload),
    // the file persists across reloads (the dedup is naming + cross-nav, not a
    // merge — the two are functionally distinct: live stream vs saved file).
    this.addCommand({
      id: "open-activity-log",
      name: "Open activity log (live)",
      callback: () => {
        this.openActivityLogModal();
      },
    });

    // RFC 0002 §3.8 P12 (#3588) — «Open log file (saved)»: surfaces the
    // persisted `exocortex-logs.txt` and its REAL location (the plugin data
    // folder, not the vault root — reconciling the long-standing docs mismatch).
    // Reads via the DataAdapter + renders a pure-DOM modal → registered
    // UNCONDITIONALLY so it works identically on desktop and mobile
    // (Desktop↔Mobile Command Parity). The «(saved)» qualifier disambiguates it
    // from «Open activity log (live)» — this is the persistent file (survives
    // reload/crash, the cold-start / post-mortem use-case), the live stream is
    // in-memory only. The command id stays `open-logs` so existing hotkeys keep
    // working.
    this.addCommand({
      id: "open-logs",
      name: "Open log file (saved)",
      callback: () => {
        this.openLogFileModal();
      },
    });

    // Homoiconic templating MVP (project 17f58ebe / vision 09a3fbec) —
    // «Insert template token»: editor-only command → fuzzy picker
    // (Random UUID / Current Timestamp / Current Date) → insert at cursor.
    // `editorCallback` makes Obsidian auto-hide the command outside an active
    // Markdown editor (interview Q4). Pure editor op — no Node/git/fs deps — so
    // it is registered UNCONDITIONALLY (Desktop↔Mobile Command Parity; the
    // editorCallback signature is identical on both surfaces). Token values come
    // from the shared SubstitutionResolverRegistry (interview Q6 — reuse, not a
    // duplicate vocabulary).
    this.addCommand({
      id: "insert-template-token",
      name: "Insert template token",
      editorCallback: (editor: Editor) => {
        void this.invokeInsertTemplateToken(editor);
      },
    });

    // Homoiconic templating Веха 2 (project 17f58ebe / vision 09a3fbec) —
    // «Insert template»: editor-only command → fuzzy picker over the vault's
    // `exotemplate__Template` assets (homoiconic — blocks ARE vault assets) →
    // inserts the chosen template's body at the cursor with `$token` markers
    // resolved via the shared registry (Веха 4). Same editor-only, unconditional
    // (Desktop↔Mobile parity), no Node/git/fs deps as the MVP token command.
    this.addCommand({
      id: "insert-template",
      name: "Insert template",
      editorCallback: (editor: Editor) => {
        void this.invokeInsertTemplate(editor);
      },
    });

    // RFC 0a0791c1 Phase 5 T2 — «Apply profile» (the single consolidated
    // profile command; the former soft «Switch focus profile» was removed and
    // the mount-state «Switch knowledge profile» was renamed here). Needs the
    // apply deps wired (filesystem materialisation).
    //
    // Command id `apply-profile` matches the apply-model (Phase 5 T6). The
    // previous command id is dropped, so any hotkey bound to
    // the old id must be re-bound (Obsidian persists hotkeys by command id).
    // Register on desktop (git-binary apply) OR mobile when the REST
    // mount is wired (ProfileApplyManager dispatches to applyProfileViaRest
    // on mobile). Without either, the filesystem materialisation can't run, so
    // the command stays hidden.
    if (applyDeps !== null || (Platform.isMobile && restMount !== null)) {
      this.addCommand({
        id: "apply-profile",
        name: "Apply profile",
        callback: () => {
          void commandsHandler.invokeApplyProfile();
        },
      });

      // RFC 0002 §3.10 (resolves P15) — «Undo last profile apply»: revert to the
      // profile active before the most recent apply in one click. Gated like
      // apply-profile (registration parity desktop↔mobile — undoLastApply routes
      // through the same applyProfile path). `checkCallback` hides it from the
      // palette until an undo target exists (no dead command on a fresh vault),
      // so it only appears once the user has actually switched profiles.
      this.addCommand({
        id: "undo-profile-apply",
        name: "Undo last profile apply",
        checkCallback: (checking: boolean) => {
          const hasUndoTarget = localDataStore.getPreviousProfileUid() !== null;
          if (checking) return hasUndoTarget;
          if (!hasUndoTarget) return false;
          void commandsHandler.invokeUndoLastApply();
          return true;
        },
      });
    }

    // ExoSync palette set (RFC 4e4dc453 Phase B/E + #3473 Pull/Push split):
    // Sync (default full cycle) + Pull / Push (split directions) + parity
    // report. Extracted into a helper so the registration contract
    // (stable ids, Sync first) is unit-tested.
    registerExoSyncCommands(this, syncCommands);

    // RFC 22b50a17 Decision #6 — wipe-all switch cache clearing. RFC 0002 §3.2
    // (P3/P4) — de-jargon + destructive flag: «Clear switch cache (wipe-all)» →
    // «Reset profile cache (advanced)». Name sourced from the grooming contract.
    this.addCommand({
      id: "clear-switch-cache",
      name: GROOMED_COMMAND_NAMES["clear-switch-cache"],
      callback: () => {
        void this.invokeClearSwitchCache();
      },
    });

    // RFC 13da049f Phase 6.2/6.3 — Bootstrap vault + Add AssetSpace by URL.
    // Desktop reuses the Phase 5 apply deps (AssetSpaceManager REST pull +
    // GitSubmoduleOps staging move / .gitmodules). Mobile (#3535) reuses the
    // cross-platform RestAssetSpaceMount (RFC 01a83de8) — the same adapter
    // apply-profile already mounts through — so a fresh mobile vault can
    // cold-start (bootstrap → add registry/profiles → apply-profile) without a
    // desktop. The Desktop↔Mobile Command Parity invariant requires both
    // surfaces; the gate mirrors the apply-profile gate above.
    let bootstrapCommands: BootstrapAssetSpaceCommands | null = null;
    if (applyDeps !== null || (Platform.isMobile && restMount !== null)) {
      bootstrapCommands = this.registerBootstrapCommands(
        applyDeps,
        restMount,
        localDataStore,
      );
    }

    // RFC 0002 §3.1/§3.2 — first-run onboarding panel + guided «Setup
    // (Getting Started)» command. The Setup command registers UNCONDITIONALLY
    // (no Platform gate) so the panel is reachable on desktop AND mobile
    // (Desktop↔Mobile Command Parity). The panel auto-shows once, on a
    // not-yet-bootstrapped vault, deferred to onLayoutReady. `bootstrapCommands`
    // (cross-platform vault-state detector + Bootstrap/Add driver) and
    // `commandsHandler` (Apply-profile) drive the canonical `starter` path.
    this.registerOnboardingPanel(
      bootstrapCommands,
      commandsHandler,
      localDataStore,
    );

    // #e6b8827c — «Unmount assetspace»: the inverse of «Add assetspace by URL».
    // Unmount mechanics already existed only INSIDE apply-profile's strict
    // mount-state replace; this surfaces a single-AssetSpace unmount as a
    // first-class palette action (CLI parity: `assetspace-remove`). Uses the
    // git-free cross-platform `RestAssetSpaceMount.unmount`, so it registers on
    // BOTH desktop and mobile when the REST mount is wired (Desktop↔Mobile
    // Command Parity). A TS-floor AssetSpace is refused (floor-policy A).
    if (restMount !== null) {
      this.registerUnmountCommand(restMount, switchMgr);
    }

    this.logger.info("[ExocortexPlugin] Profile palette commands registered");
  }

  /**
   * RFC 0002 §3.1/§3.2 — wire the first-run onboarding panel and its re-entry
   * `Setup (Getting Started)` command.
   *
   * The Setup command is registered UNCONDITIONALLY (no `Platform.isMobile`
   * gate) so the panel is reachable on both desktop and mobile (Desktop↔Mobile
   * Command Parity). The panel auto-shows ONCE, on a not-yet-bootstrapped vault,
   * deferred to `onLayoutReady` — opening a Modal during onload (before
   * `layoutReady`) can wedge "Loading plugins…" (same hazard as the reconcile
   * deferral above).
   *
   * `bootstrapCommands` is the cross-platform vault-state detector + Bootstrap /
   * Add-AssetSpace driver (null only in a degenerate no-deps environment, where
   * bootstrap itself is impossible — the step actions then surface a notice).
   * `profileCommands` drives Apply-profile. Both are pre-narrowed to the
   * canonical `starter` path.
   */
  private registerOnboardingPanel(
    bootstrapCommands: BootstrapAssetSpaceCommands | null,
    profileCommands: ProfileCommands,
    localDataStore: PluginLocalDataStore,
  ): void {
    const unavailable = (what: string): void =>
      this.notifier.info(
        `${what} is unavailable in this environment — see the Getting Started guide.`,
      );

    // Device-local secrets store for the optional token-first step (cd9444bd).
    // The same store + canonical "pat" key the materialise steps read at
    // command-execution time, so a token saved here is in place for them.
    const secretsStore = new LocalSecretsStore({ app: this.app });

    const openPanel = (): void => {
      new FirstRunOnboardingModal(this.app, {
        // Step 1 (optional, token-first): persist the PAT device-local BEFORE
        // the materialise steps run (cd9444bd). Empty value clears it (skip
        // path). A failure is surfaced as a notice but never blocks onboarding.
        onSavePat: async (pat: string) => {
          try {
            await persistOnboardingPat(secretsStore, pat);
            this.notifier.info(
              pat.trim().length > 0
                ? "Token saved. The next steps can now reach your private repos."
                : "Token cleared.",
            );
          } catch (err) {
            this.notifier.error(
              "Saving the token failed: " +
                (err instanceof Error ? err.message : String(err)),
            );
          }
        },
        // Step 1 paste affordance (mobile parity §3.9) — read + normalise the
        // clipboard; works on desktop AND the mobile WebView under a user
        // gesture (the button click), so no Platform gate.
        onPastePat: async () => {
          const raw = await navigator.clipboard.readText();
          const outcome = resolvePastedSecret(raw);
          return outcome.kind === "filled" ? outcome.value : null;
        },
        // Step 1 "Test connection" — verify the entered token reaches GitHub
        // BEFORE saving/relying on it, reusing the Settings validate logic
        // (single source). Works on desktop AND mobile (GitHubRestClient is a
        // requestUrl REST call, not Node fs/git). Total — resolves a
        // {ok:false} result on a rejected token / network error, never throws.
        onTestPat: (pat: string) =>
          testPatConnection(
            pat,
            (token) => new GitHubRestClient({ pat: token, app: this.app }),
          ),
        onSetupEngine: () => {
          if (bootstrapCommands === null) {
            unavailable("Bootstrap");
            return;
          }
          void bootstrapCommands.invokeBootstrap();
        },
        onAddRegistry: () => {
          if (bootstrapCommands === null) {
            unavailable("Add the AssetSpace registry");
            return;
          }
          void bootstrapCommands.invokeAddAssetSpace(REGISTRY_ASSETSPACE_URL);
        },
        onAddProfiles: () => {
          if (bootstrapCommands === null) {
            unavailable("Add the profiles AssetSpace");
            return;
          }
          void bootstrapCommands.invokeAddAssetSpace(PROFILES_ASSETSPACE_URL);
        },
        onApplyProfile: () => {
          void profileCommands.invokeApplyProfile();
        },
        onClosePanel: () => {
          void localDataStore.setOnboardingCompleted(true).catch((err) => {
            this.logger.warn(
              "[ExocortexPlugin] persisting onboarding-completed flag failed: " +
                (err instanceof Error ? err.message : String(err)),
            );
          });
        },
      }).open();
    };

    // Guided Setup command — unconditional (parity); the re-entry point the
    // first-run panel depends on (RFC 0002 §3.2 bullet 1).
    registerOnboardingCommands(this, openPanel);

    // First-run auto-show — deferred to layoutReady (a Modal during onload can
    // wedge "Loading plugins…"). Best-effort: a detection failure must not
    // break onload.
    this.app.workspace.onLayoutReady(() => {
      void this.maybeShowFirstRunPanel(
        bootstrapCommands,
        localDataStore,
        openPanel,
      );
    });
  }

  /**
   * Decide whether to auto-show the first-run panel and do so (RFC 0002 §3.1).
   * Shows only on a not-yet-bootstrapped vault that the user has not already
   * dismissed onboarding on this device. All reads are cross-platform
   * (`vault.adapter`), so the check behaves identically on mobile. Best-effort
   * — any failure is logged, never thrown.
   */
  private async maybeShowFirstRunPanel(
    bootstrapCommands: BootstrapAssetSpaceCommands | null,
    localDataStore: PluginLocalDataStore,
    openPanel: () => void,
  ): Promise<void> {
    try {
      // No bootstrap driver → cannot detect vault state (and bootstrap itself
      // would be impossible), so there is nothing to guide.
      if (bootstrapCommands === null) return;
      const completed = await localDataStore.getOnboardingCompleted();
      const state = await bootstrapCommands.detectVaultState();
      // Genuinely-fresh guard — `detectVaultState` reports "empty" for any vault
      // without `assetspaces/`, including an established content-rich vault; the
      // markdown-file count keeps the auto-show to actual first-run vaults (the
      // Setup command remains the re-entry point for everyone else).
      const markdownFileCount = this.app.vault.getMarkdownFiles().length;
      if (shouldShowFirstRunPanel(state, completed, markdownFileCount)) {
        openPanel();
      }
    } catch (err) {
      this.logger.warn(
        "[ExocortexPlugin] first-run onboarding check failed: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Issue #3554 — crash-recovery + cross-device reconcile, run AFTER
   * `onLayoutReady` (never inline in `onload`).
   *
   * `reconcileToLocal()` can open a blocking `ApplyConfirmModal`; awaiting it
   * during onload (before `layoutReady`) deadlocks Obsidian on "Loading plugins…"
   * because the modal can never be confirmed. Deferred to `onLayoutReady`, onload
   * returns promptly and the modal — if a divergence is found — is shown only once
   * the UI is interactive.
   *
   * All three steps are best-effort: each is independently try/catch'd so a single
   * failure (or a never-terminating reconcile) can't take down the others, and the
   * whole thing runs detached (`void`) so it never blocks layout.
   */
  private async runDeferredProfileRecovery(
    settingsStore: PluginSettingsStoreAdapter,
    switchMgr: ProfileApplyManager,
    hasApplyDeps: boolean,
  ): Promise<void> {
    // Crash-recovery: если previous session left `_switchInProgress=true`
    // в settings (ProfileApplyManager docstring line 18), re-trigger
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
          `[ExocortexPlugin] Profile switch recovery completed for ${recovery.targetUid}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        "[ExocortexPlugin] Profile switch recovery failed",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // RFC 22b50a17 Phase 3 — apply recovery worker. Resolves an interrupted
    // apply to a consistent state. #1d1bcde0 — runs on BOTH platforms (NOT
    // gated by `hasApplyDeps`): the production REST apply path (#3567) is wired
    // on desktop AND mobile, and an interrupted REST apply is resumed by driving
    // the mount-delta to the target. The desktop-git cache-restore branch
    // self-guards on the cache layer. Covers the «reload mid-apply» case where
    // soft recoverIfNeeded() would (pre-fix) re-trigger a no-op refresh + leave
    // the vault filesystem partial-applied while prematurely declaring it
    // Applied.
    try {
      const result = await switchMgr.recoverIncompleteSwitch();
      if (result.resumed) {
        this.logger.info(
          `[ExocortexPlugin] apply recovery resumed the interrupted REST apply to ${result.resumedTo}`,
        );
      }
      if (result.restored.length > 0) {
        this.logger.info(
          `[ExocortexPlugin] apply recovery restored ${result.restored.length} AssetSpace(s): ${result.restored.join(", ")}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        "[ExocortexPlugin] apply recovery failed",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    if (hasApplyDeps) {
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
  }

  /**
   * Wire + register the RFC 13da049f Phase 6.2/6.3 palette commands
   * («Bootstrap vault» + «Add AssetSpace by URL»). On DESKTOP reuses the Phase 5
   * `AssetSpaceManager` (REST tarball pull) + `GitSubmoduleOps` (staging move +
   * `.gitmodules`) — no REST/security logic duplicated. On MOBILE (#3535,
   * `applyDeps === null`) reuses the cross-platform `RestAssetSpaceMount`
   * (RFC 01a83de8) — `vault.adapter` materialise, no Node `fs`. Both commands
   * register on both platforms (Desktop↔Mobile Command Parity).
   *
   * Prefers the desktop git path when wired; falls back to the REST mount only
   * when `applyDeps === null` (mobile — the gate guarantees `restMount !== null`
   * there).
   */
  private registerBootstrapCommands(
    applyDeps: {
      gitOps: GitSubmoduleOps;
    } | null,
    restMount: RestAssetSpaceMount | null,
    localDataStore: PluginLocalDataStore,
  ): BootstrapAssetSpaceCommands {
    const deriveFolderName = (url: string): string => {
      const { repo } = parseGitHubURL(url);
      return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
    };

    // Mobile path: desktop deps unavailable (`applyDeps === null`) but the
    // cross-platform `RestAssetSpaceMount` is wired. `RestAssetSpaceMount`
    // structurally satisfies `IRestBootstrapMount` (mount() → {sha},
    // readGitmodulesEntries()).
    const restStrategy =
      applyDeps === null && restMount !== null ? restMount : undefined;

    const bootstrapCommands = new BootstrapAssetSpaceCommands({
      // Issue #3382 — rebuild the AssetSpaceManager per invocation from the
      // CURRENT stored PAT instead of reusing the onload-captured
      // `applyDeps.assetSpaceManager` (which froze an empty-PAT client
      // when the vault had no PAT at load time). A PAT configured after onload
      // now authenticates Bootstrap / Add-AssetSpace pulls without a reload.
      // Omitted on the mobile REST path (restStrategy handles materialise).
      getPuller: restStrategy
        ? undefined
        : () =>
            buildAssetSpacePuller({
              app: this.app,
              localDataStore,
              notifier: this.notifier,
            }),
      gitOps: applyDeps?.gitOps,
      restMount: restStrategy,
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
      promptAddAssetSpaceUrl: (prefillUrl?: string) =>
        new Promise((resolve) => {
          new AddAssetSpaceModal(
            this.app,
            deriveFolderName,
            resolve,
            prefillUrl,
          ).open();
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
      // #3540 follow-up — `notifier.info` now fans every toast into the
      // activity log itself (category "notice"), so no manual record() here.
      notify: (message) => this.notifier.info(message),
      // Durable, in-context result panel (RFC 0002 §3.3, resolves P5) — opens
      // ON TOP of the (transient) toast + (always-on) activity-log entry, so the
      // user can read "what happened + what next" after the toast fades. The
      // next-step nudge routes to the same Add-AssetSpace flow the onboarding
      // panel's step 3 uses, pre-filled with the public EKA registry — the
      // natural next step after bootstrapping the exo floor (`bootstrapCommands`
      // is in scope by the time this closure runs).
      showResult: (result) =>
        new BootstrapResultModal(this.app, result, {
          onAddRegistry: () =>
            void bootstrapCommands.invokeAddAssetSpace(REGISTRY_ASSETSPACE_URL),
          // RFC 0002 §3.10 — one-click retry of the failed operation: re-open
          // the same Bootstrap / Add flow (its modal collects the URL again) so
          // the user can fix the URL / token / connection and retry in place.
          onRetry: (operation) =>
            operation === "bootstrap"
              ? void bootstrapCommands.invokeBootstrap()
              : void bootstrapCommands.invokeAddAssetSpace(),
        }).open(),
      onMaterialized: () => this.refreshAndInjectAssetSpaceMaterialization(),
    });

    // RFC 0002 §3.2 (P3) — de-jargon: «Bootstrap vault» → «Set up the engine»
    // (matches the §3.1 panel step 1 + §3.3 dialog title). Name sourced from the
    // palette grooming contract.
    this.addCommand({
      id: "bootstrap-vault",
      name: GROOMED_COMMAND_NAMES["bootstrap-vault"],
      callback: () => {
        void bootstrapCommands.invokeBootstrap();
      },
    });

    // RFC 0002 §3.2 (P3) — de-jargon: «Add assetspace by URL» → «Add a knowledge
    // pack» (pairs with «Remove knowledge pack»). Name from the grooming contract.
    this.addCommand({
      id: "add-assetspace",
      name: GROOMED_COMMAND_NAMES["add-assetspace"],
      callback: () => {
        void bootstrapCommands.invokeAddAssetSpace();
      },
    });

    // Returned so `registerProfileCommands` can wire the first-run onboarding
    // panel's step-2 (Bootstrap exo) and steps 3-4 (Add registry / profiles,
    // prefilled) actions to this same handler — RFC 0002 §3.1.
    return bootstrapCommands;
  }

  /**
   * Wire + register the «Exocortex: Unmount assetspace» palette command
   * (#e6b8827c) — the inverse of «Add assetspace by URL». Lists the currently
   * mounted AssetSpaces (the `.gitmodules` registry, cross-referenced with the
   * AssetSpace descriptor scan for uid/namespace → TS-floor identity), fuzzy-
   * picks one, and tears it down via the git-free cross-platform
   * {@link RestAssetSpaceMount.unmount}.
   *
   * Floor-policy A — a TS-floor AssetSpace (`{exo}`, matched by UID or
   * namespace via {@link isTsFloorAssetSpace}) surfaces in the picker as
   * protected and is REFUSED on selection (no mutation), mirroring
   * apply-profile's R24 guard. `restMount` is the unified git-free path
   * (post git-elim), so this registers on both desktop + mobile (Desktop↔Mobile
   * Command Parity).
   */
  private registerUnmountCommand(
    restMount: RestAssetSpaceMount,
    switchMgr: ProfileApplyManager,
  ): void {
    const unmountCommand = new UnmountAssetSpaceCommand({
      listMounted: async (): Promise<UnmountableAssetSpace[]> => {
        // `.gitmodules` is the canonical "what's mounted" registry (the same
        // source apply-profile reads). The descriptor scan (a full-vault
        // markdown walk, run once per command open — not per keystroke) supplies
        // uid + namespace so the TS-floor identity can be computed.
        // buildUnmountableList does the join + dual floor guard (descriptor-based
        // AND path-based, so a floor mounted flat / with an un-derivable
        // descriptor is still recognised).
        const entries = await restMount.readGitmodulesEntries();
        const infos: AssetSpaceInfo[] = switchMgr.listAllAssetSpaceInfos();
        return buildUnmountableList(entries, infos);
      },
      // Reuse the shared ProfileFuzzyModal (keyed by submodulePath) — floor
      // entries are decorated so the user sees why they cannot be removed.
      fuzzyPick: (items, title) =>
        new Promise<UnmountableAssetSpace | null>((resolve) => {
          const choices: ProfileChoice[] = items.map((m) => ({
            uid: m.submodulePath,
            label: m.isFloor ? `${m.label} ✕ floor (protected)` : m.label,
          }));
          const byPath = new Map(items.map((m) => [m.submodulePath, m]));
          const modal = new ProfileFuzzyModal(
            this.app,
            choices,
            title,
            (chosen) =>
              resolve(
                chosen === null ? null : (byPath.get(chosen.uid) ?? null),
              ),
          );
          modal.open();
        }),
      confirm: (message) =>
        new Promise<boolean>((resolve) => {
          new SimpleConfirmModal(
            this.app,
            {
              // RFC 0002 §3.2 — coherent plain-language flow copy (no jargon
              // re-entry after the «Remove knowledge pack (advanced)» palette name).
              title: REMOVE_PACK_CONFIRM_TITLE,
              body: message,
              confirmLabel: REMOVE_PACK_CONFIRM_LABEL,
            },
            resolve,
          ).open();
        }),
      unmount: (submodulePath) => restMount.unmount(submodulePath),
      // #3540 follow-up — toast auto-records into the activity log via notifier.
      notify: (message) => this.notifier.info(message),
      onUnmounted: () => this.refreshAndInjectAssetSpaceMaterialization(),
    });

    // RFC 0002 §3.2 (P3/P4) — de-jargon + destructive flag: «Unmount assetspace»
    // → «Remove knowledge pack (advanced)». Name sourced from the grooming
    // contract; id stays stable (Obsidian persists hotkeys by id).
    this.addCommand({
      id: "unmount-assetspace",
      name: GROOMED_COMMAND_NAMES["unmount-assetspace"],
      callback: () => {
        void unmountCommand.invokeUnmount();
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
      this.notifier.info(`Cleared ${result.entriesRemoved} cache entries.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.notifier.error(`Clear switch cache failed: ${msg}`);
    }
  }

  /**
   * «Insert template token» (homoiconic templating MVP, project 17f58ebe).
   * Opens the fuzzy picker; on a choice, resolves the token via the shared
   * SubstitutionResolverRegistry and inserts it at the cursor (replacing any
   * selection). A dismissed picker (Escape) is a silent no-op. A resolver error
   * (e.g. unregistered id — a programming error) is surfaced, not swallowed —
   * the inserted text is otherwise its own success feedback, so the happy path
   * emits no extra Notice.
   */
  private async invokeInsertTemplateToken(editor: Editor): Promise<void> {
    // Single try covers both the picker await (Modal.open could throw) and the
    // resolve+insert — so no failure escapes as an unhandled rejection (the
    // command body calls this via bare `void`).
    try {
      const choice = await pickTemplateToken(
        this.app,
        TEMPLATE_TOKEN_CHOICES,
        "Insert template token",
      );
      if (choice === null) return; // dismissed without a selection — no-op
      insertTemplateToken(editor, choice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.notifier.error(`Insert template token failed: ${msg}`);
    }
  }

  /**
   * «Insert template» (homoiconic templating Веха 2, project 17f58ebe). Lists
   * the vault's `exotemplate__Template` assets, opens the fuzzy picker; on a
   * choice, reads the template file, strips its frontmatter, resolves `$token`
   * markers in the body via the shared registry, and inserts the result at the
   * cursor. An empty vault (no templates) surfaces a guiding Notice rather than
   * an empty picker; a dismissed picker is a silent no-op; a read/resolve error
   * is surfaced, not swallowed.
   */
  private async invokeInsertTemplate(editor: Editor): Promise<void> {
    try {
      const choices = collectTemplateChoices(
        this.app as unknown as TemplateInserterApp,
      );
      if (choices.length === 0) {
        this.notifier.info(
          "No templates found. Create an exotemplate__Template asset (with a body) to insert it here.",
        );
        return;
      }
      const choice = await fuzzySelect<TemplateChoice>(
        this.app,
        choices,
        (c) => ({ title: c.label, description: c.path }),
        "Insert template",
      );
      if (choice === null) return; // dismissed without a selection — no-op
      const content = await this.app.vault.cachedRead(choice.file);
      insertTemplate(editor, resolveTemplateForInsert(content));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.notifier.error(`Insert template failed: ${msg}`);
    }
  }

  /**
   * Constructs an `IAssetSpacePusher` for {@link registerProfileCommands}.
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
