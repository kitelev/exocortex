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
  debug: { notice: false, console: true, file: true },
  info: { notice: false, console: true, file: true },
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
   * RFC be70f741 Phase 1 — enable the `RelationColumnSetRepository` and the
   * future `RelationColumnSetResolver`.  Phase 1 is behaviour-neutral (no
   * consumer wired yet) so the flag defaults to `true`; it exists so the
   * Phase 3 integration can be bisected if a regression surfaces in the
   * UniversalLayout auto-backlinks table.
   */
  enableRelationColumnSetResolver: boolean;
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
  enableRelationColumnSetResolver: true,
  enableExoLayoutRenderer: true,
  showIconsInFileExplorer: true,
  enableSparqlAutoExecute: false,
  enableShaclValidation: false,
};
