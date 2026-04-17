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
 * It uses the "label (class)" format to provide consistent, readable display names
 * across all asset types in the Properties block.
 */
export const DEFAULT_DISPLAY_NAME_SETTINGS: DisplayNameSettings = {
  defaultTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",

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
   * Plugin version that last displayed the RFC-024 changelog modal.
   * Used to show the modal exactly once per upgrade. Undefined on fresh
   * installs (which will see the modal on first load).
   */
  lastShownChangelogVersion?: string;
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
};
