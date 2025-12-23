/**
 * Per-class display name template configuration
 */
export interface DisplayNameSettings {
  /** Global default template (used when no class-specific template exists) */
  defaultTemplate: string;

  /** Per-class template overrides (key = class name like "ems__Task") */
  classTemplates: Record<string, string>;

  /** Status emoji mapping (key = status value, value = emoji) */
  statusEmojis: Record<string, string>;
}

/**
 * Default display name configuration
 */
export const DEFAULT_DISPLAY_NAME_SETTINGS: DisplayNameSettings = {
  defaultTemplate: "{{exo__Asset_label}}",

  classTemplates: {
    "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
    "ems__Task": "{{exo__Asset_label}} {{statusEmoji}}",
    "ems__Project": "{{exo__Asset_label}}",
    "ems__Area": "{{exo__Asset_label}}",
    "ems__MeetingPrototype": "{{exo__Asset_label}} (MeetingPrototype)",
    "ems__Meeting": "{{exo__Asset_label}} {{statusEmoji}}",
  },

  statusEmojis: {
    "Active": "🟢",
    "Blocked": "🔴",
    "Paused": "⏸️",
    "Completed": "✅",
    "Cancelled": "❌",
    "Pending": "⏳",
    "IN_PROGRESS": "🟢",
    "DONE": "✅",
    "TRASHED": "🗑️",
    "BACKLOG": "📋",
    "BLOCKED": "🔴",
    "DOING": "🟢",
  },
};

export interface ExocortexSettings {
  showPropertiesSection: boolean;
  layoutVisible: boolean;
  showArchivedAssets: boolean;
  activeFocusArea: string | null;
  showEffortArea: boolean;
  showEffortVotes: boolean;
  defaultOntologyAsset: string | null;
  showFullDateInEffortTimes: boolean;
  showDailyNoteProjects: boolean;
  useDynamicPropertyFields: boolean;
  showLabelsInFileExplorer: boolean;
  showLabelsInTabTitles: boolean;
  /** @deprecated Use displayNameSettings.defaultTemplate instead */
  displayNameTemplate: string;
  sortByDisplayName: boolean;
  /** Per-class display name template settings */
  displayNameSettings: DisplayNameSettings;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: ExocortexSettings = {
  showPropertiesSection: true,
  layoutVisible: true,
  showArchivedAssets: false,
  activeFocusArea: null,
  showEffortArea: false,
  showEffortVotes: false,
  defaultOntologyAsset: null,
  showFullDateInEffortTimes: false,
  showDailyNoteProjects: true,
  useDynamicPropertyFields: false,
  showLabelsInFileExplorer: true,
  showLabelsInTabTitles: true,
  displayNameTemplate: "{{exo__Asset_label}}",
  sortByDisplayName: false,
  displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS,
};
