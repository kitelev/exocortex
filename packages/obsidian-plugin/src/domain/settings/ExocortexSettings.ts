/**
 * Per-class display name template configuration
 */
export interface DisplayNameSettings {
  /** Global default template (used when no class-specific template exists) */
  defaultTemplate: string;

  /** Per-class template overrides (key = class name like "ems__Task") */
  classTemplates: Record<string, string>;
}

/**
 * Default display name configuration
 *
 * The defaultTemplate applies to ALL asset types not explicitly listed in classTemplates.
 * Shows only the label — classes that need a suffix (e.g. TaskPrototype) have explicit entries.
 */
export const DEFAULT_DISPLAY_NAME_SETTINGS: DisplayNameSettings = {
  defaultTemplate: "{{exo__Asset_label}}",

  classTemplates: {
    ems__TaskPrototype: "{{exo__Asset_label}} (TaskPrototype)",
    // UID-based identifier for ems__TaskPrototype (Issue #2110)
    "75302770-279e-4a59-ba85-09df29725713":
      "{{exo__Asset_label}} (TaskPrototype)",
    ems__Task: "{{exo__Asset_label}}",
    ems__Project: "{{exo__Asset_label}}",
    ems__Area: "{{exo__Asset_label}}",
    ems__MeetingPrototype: "{{exo__Asset_label}} (MeetingPrototype)",
    ems__Meeting: "{{exo__Asset_label}}",
    // DailyNote uses the basename (date) as its display name since it typically doesn't have a label
    pn__DailyNote: "{{_basename}}",
  },
};

/**
 * Configuration for which channels a log level should route to.
 */
export interface LogChannelConfig {
  notice: boolean;
  console: boolean;
  file: boolean;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogChannelsSettings = Record<LogLevel, LogChannelConfig>;

export const DEFAULT_LOG_CHANNELS: LogChannelsSettings = {
  // Diagnostic levels: console only by default. Persisting every INFO/DEBUG
  // line to disk produced ~6 MB / 54k lines per 2 days from renderer traces
  // alone (#3186). Users can re-enable file routing per-level in settings.
  debug: { notice: false, console: true, file: false },
  info: { notice: false, console: true, file: false },
  warn: { notice: true, console: true, file: true },
  error: { notice: true, console: true, file: true },
};

export interface ExocortexSettings {
  layoutVisible: boolean;
  showArchivedAssets: boolean;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  showFullDateInEffortTimes: boolean;
  showTimeEstimate: boolean;
  showLabelsInTabTitles: boolean;
  /** Apply display name templates to links in Obsidian's Properties block */
  showLabelsInProperties: boolean;
  /** Apply display name templates to links in markdown body content (reading mode) */
  showLabelsInBody: boolean;
  /** Apply display name templates to nodes in Obsidian's Graph View */
  showLabelsInGraphView: boolean;
  /** Display wikilinks by exo__Asset_label in live preview mode (edit mode) */
  showLabelsInLivePreview: boolean;
  /** @deprecated Use displayNameSettings.defaultTemplate instead */
  displayNameTemplate: string;
  /** Per-class display name template settings */
  displayNameSettings: DisplayNameSettings;
  /**
   * Auto-adjust plannedEndTimestamp when plannedStartTimestamp changes.
   * Disabled by default to prevent double-shift issues with Obsidian Sync.
   * @see Issue #2142
   */
  autoAdjustPlannedEndTimestamp: boolean;
  /** Per-level log channel routing configuration */
  logChannels: LogChannelsSettings;
  /**
   * Automatically switch to Reading Mode when opening a note whose frontmatter
   * contains `exo__Instance_class`. Without this, the Exocortex layout
   * (CREATE / STATUS / PLANNING panels) is invisible because layout rendering
   * is Reading Mode only and Obsidian defaults new leaves to Live Preview.
   * See Finding 9 of the 2026-04-14 UX audit.
   */
  autoReadingModeForExocortexAssets: boolean;
  /**
   * RFC exo__Layout Phase 2 — enable `ExoLayoutRenderer`.  When `true` and an
   * `exo__Layout` asset targets one of the current asset's classes, the
   * renderer replaces (or coexists with, depending on the Layout's
   * `coexistsWithDefault` flag) the default Asset Relations section.  When
   * `false`, the plugin behaves identically to pre-RFC exo__Layout versions.
   * Default `true` is safe because the starter-kit ships only class/property
   * definitions, not Layout instances — rendering is a no-op until the user
   * authors a Layout.
   */
  enableExoLayoutRenderer: boolean;
  /**
   * RFC-024 Phase 4 — render Lucide icons next to File Explorer rows whose
   * frontmatter declares `exo__Instance_class` and whose resolved
   * `exo__Layout_icon` is non-null. DOM overlay pattern (sibling to
   * `FileExplorerLabelPatch`). Set to `false` to opt out.
   */
  showIconsInFileExplorer: boolean;
  /**
   * When `true`, ` ```sparql ` and ` ```exoql ` markdown code blocks are
   * executed as queries during note rendering (legacy behaviour). When
   * `false` (default), those code blocks render as plain code so users can
   * paste SPARQL snippets for documentation/reference without side effects.
   * Issue #2992.
   */
  enableSparqlAutoExecute: boolean;
  /**
   * P1.12 — enable the metadataCache SHACL-lite validation debounce (P1.10).
   * Default `false` in v15.x.0; will flip to `true` in v15.y.0 after soak.
   * Hot-toggle: the `scheduleValidation` guard reads this flag on every
   * invocation — no plugin reload required.
   */
  enableShaclValidation: boolean;
  /**
   * RFC-030 — enable the `PropertiesLabelPatch` which patches predicate keys
   * in Obsidian's Properties block (Reading Mode) to:
   * - Replace raw predicate name (e.g. `ems__Effort_area`) with clickable span
   *   whose text is `exo__Property_displayName` (fallback to `exo__Asset_label`)
   * - Open the property-definition asset on click
   *
   * Default `true`. When `false`, the Properties block renders native Obsidian
   * (raw predicate names, no click-to-definition). Hot-toggleable — change
   * takes effect immediately, no plugin reload required.
   */
  enablePropertiesLabelPatch: boolean;
  /**
   * Folders whose markdown files are excluded from the cold-start RDF
   * indexing walk and the per-file live-edit indexing path, and therefore
   * from the SHACL-lite validation that runs as part of that walk.
   * Matching is path-prefix on the forward-slash form of `file.path`,
   * case-sensitive. Entries are auto-normalised to end with a trailing
   * slash so a user-typed `"09 Templates"` cannot silently exclude
   * sibling folders like `"09 Templates Archive/"`. Excluded files never
   * enter `NoteToRDFConverter.convertVaultWithValidation`, so they
   * produce no per-file "Skipping file with invariant violation" log
   * entries and do not count toward the aggregated "Skipped N files"
   * indexing Notice (Issue #3468).
   *
   * Default: `["09 Templates/"]` — Obsidian's conventional templates
   * folder, whose files are known to violate Exocortex invariants by
   * design (template placeholders, missing required properties).
   *
   * Scope caveats (called out so future contributors do not over-promise
   * to users in UI copy):
   *   - The list is snapshotted by every component that builds its own
   *     indexer (`SPARQLApi`, `CommandManager`, `LayoutService`). Editing
   *     the list in Settings only takes effect after reloading Obsidian.
   *     `SPARQLCodeBlockProcessor` re-reads the current setting on each
   *     render and is therefore self-healing.
   *   - `LazyAssetGraphLoader` (the per-render lazy walker) is NOT gated
   *     on this list. Opening an excluded-folder file directly may push
   *     its triples into the in-memory store, but `convertNote` does not
   *     emit the "invariant violation" skip log, so the user-facing
   *     indexing Notice stays silenced.
   */
  excludedFolders: string[];
  // RFC c7da0bca Phase 3c-3 — dropped `exocmdBindingsCacheEnabledOnMobile`
  // setting. The indexer it gated has been deleted (Phase 3c-2); the
  // toggle had no remaining effect. Existing user settings JSON
  // containing this key will be silently ignored by Object.assign
  // merge in `loadSettings` — no migration needed.
  /**
   * RFC c7da0bca Phase 5 — folder prefixes loaded eagerly by
   * `lazy-tbox-bootstrap` at `onLayoutReady`. The bootstrap walks
   * these folders so that `exocmd__CommandBinding`, `exocmd__Command`,
   * `exocmd__Grounding`, `exo__Class` and `exo__Property` triples are
   * present in the store before the first asset render — eliminating
   * the «buttons appear after 10-20 s» mobile cold-start regression
   * caused by deferred convertVault.
   *
   * Each entry is a path prefix matched via `String.startsWith` against
   * vault-relative file paths. Trailing slash required to prevent
   * `assetspaces/ems/` matching `assetspaces/ems-commands/...`.
   *
   * Default covers the 5 production submodules. Users with extra
   * submodules (e.g. `assetspaces/kitelev/`, `assetspaces/pmbok-ontology/`)
   * should append to this list — change applies on next plugin reload.
   *
   * Empty / undefined → bootstrap walks zero files (degraded mode,
   * buttons appear via convertVault path eventually).
   *
   * Issue #3279 — `loadSettings` **union-merges** this list with the
   * current `DEFAULT_SETTINGS.lazyBootstrapFolders` on every load:
   * defaults first, then any user-added extras, de-duplicated. This
   * guarantees that adding a new submodule to the defaults in a future
   * release reaches existing users automatically and prevents the 10-20 s
   * mobile cold-start regression from returning silently.
   *
   * Trade-off: if a user explicitly removed a default folder, it will
   * re-appear after reload. `excludedFolders` gates the per-file RDF
   * index pipeline but does NOT short-circuit the lazy-bootstrap walk,
   * so it is not a workaround. A future enhancement could honour
   * `excludedFolders` in `filterTBoxFiles` (issue #3279 follow-up).
   */
  lazyBootstrapFolders: string[];
  /**
   * RFC 0a0791c1 — UID of the active `exo__Profile` (or `null` for the
   * full-vault default). When non-null the plugin at onload computes the
   * effective AssetSpace set declared by the profile (transitive `_extends`),
   * translates Ontology references to the AssetSpaces
   * containing them, layers in the TS-floor (Vision Lock #17 — `$exo`,
   * `$exocmd`, `$shared-identities` AS UIDs), and wires the result into the
   * `VaultRDFIndexer` so cold-start `convertVault()` skips files outside the
   * effective set.
   *
   * Persisted by the «Apply profile» mount-state switch BEFORE the RDF
   * re-index runs (Architect #2 atomicity invariant) — the field formalises
   * what `PluginSettingsStoreAdapter` already round-tripped via the loose
   * `[key: string]: unknown` index signature, so existing user data.json
   * entries continue to load without migration.
   *
   * Issue #3324 — onload wiring.
   */
  activeProfileUid: string | null;
  /**
   * ExoSync (RFC 4e4dc453 Phase B) — dedicated quarantine repo URL
   * (`https://github.com/<owner>/<repo>`). Unresolvable merge conflicts are
   * committed there as both-versions JSON entries (D17, durable cross-device).
   * Empty string (default) ⇒ no durable quarantine sink; the engine still
   * preserves data via watermark pins (conflicts re-derive every sync).
   * Shared config, not a secret — synced data.json is the right home.
   */
  exosyncQuarantineRepoUrl: string;
  /**
   * ExoSync (#3499) — opt-in verbose step toasts. When `true`, each sync step
   * (the start line and every per-repo outcome line, #3496) is ALSO surfaced
   * as an Obsidian Notice on top of its console line. Default `false`: a Sync
   * touches 14+ repos = 14+ toasts per run, so this is only for users actively
   * watching a sync. The summary toast (#3489) is unaffected — it always fires
   * exactly once and is never double-emitted by this toggle.
   */
  exosyncStepNotices: boolean;
  /**
   * ExoSync (#3498) — opt-in durable verbose file log. When `true`, every sync
   * step trace line (the start line, each in-flight per-step line — `detecting…`
   * / `pulling remote tree…` / `merge layer firing…` — and each per-repo
   * outcome line, #3496) is ALSO appended to the plugin file log, independent of
   * the global `logChannels.info.file` toggle. Default `false`: the step trace
   * stays console-only (#3186, no file spam). This is the low-friction switch
   * for capturing a durable debug trace of one misbehaving run without enabling
   * file logging for every channel.
   */
  verboseSyncLogging: boolean;
  /**
   * Issue #3539 — master switch for the settings-homoiconization feature
   * (onto-RFC 981b6070, ExoSync Phase D2). When `true`, plugin settings are
   * mirrored as `exo__Setting` vault assets: on plugin load (after
   * `metadataCache` `"resolved"`) `initVaultSettings` runs a one-shot
   * migration that creates an `exocortex-settings/` folder with one asset per
   * registry setting, overlays vault values over `data.json`, installs a
   * cross-device watcher, and write-backs UI changes. When `false` (default)
   * the feature is **off**: `initVaultSettings` early-returns before any
   * scan/overlay/migrate/watcher, so the plugin behaves exactly as pre-D2
   * (reads/writes only `data.json`) and no `exocortex-settings/` folder is
   * created for new users.
   *
   * ⛔ This flag is itself **NOT homoiconized** — it cannot live as a vault
   * asset because it gates the very feature that materialises those assets (a
   * master switch must not depend on the thing it controls). It lives only in
   * `data.json`, is absent from `VAULT_SETTINGS_REGISTRY`, and is listed in
   * `NON_HOMOICONIZABLE_FIELDS`. Turning the toggle off leaves any
   * already-migrated `exocortex-settings/` assets on disk untouched (zero
   * data-loss); turning it back on re-adopts them via `migrateMissing`
   * (no duplicates). The gate runs once on plugin load, so a change applies
   * on the next plugin reload.
   */
  settingsHomoiconizationEnabled: boolean;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: ExocortexSettings = {
  layoutVisible: true,
  showArchivedAssets: false,
  showEffortArea: false,
  showEffortVotes: false,
  showFullDateInEffortTimes: false,
  showTimeEstimate: false,
  showLabelsInTabTitles: true,
  showLabelsInProperties: true,
  showLabelsInBody: true,
  showLabelsInGraphView: true,
  showLabelsInLivePreview: true,
  displayNameTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",
  displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS,
  autoAdjustPlannedEndTimestamp: false,
  logChannels: DEFAULT_LOG_CHANNELS,
  autoReadingModeForExocortexAssets: true,
  enableExoLayoutRenderer: true,
  showIconsInFileExplorer: true,
  enableSparqlAutoExecute: false,
  enableShaclValidation: false,
  enablePropertiesLabelPatch: true,
  excludedFolders: ["09 Templates/"],
  lazyBootstrapFolders: [
    "assetspaces/exo/",
    "assetspaces/ems/",
    "assetspaces/ems-commands/",
    "assetspaces/ims/",
    "assetspaces/exocmd/",
  ],
  activeProfileUid: null,
  exosyncQuarantineRepoUrl: "",
  exosyncStepNotices: false,
  verboseSyncLogging: false,
  // Issue #3539 — settings-homoiconization is opt-in; default OFF so a fresh
  // install reads/writes only data.json and never creates exocortex-settings/.
  settingsHomoiconizationEnabled: false,
};
