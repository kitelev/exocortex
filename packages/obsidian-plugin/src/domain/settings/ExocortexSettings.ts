import type { EmbeddingProvider } from "exocortex";

/**
 * Semantic search settings configuration
 */
export interface SemanticSearchSettings {
  /** Whether semantic search is enabled */
  enabled: boolean;
  /** Embedding provider to use */
  provider: EmbeddingProvider;
  /** API key for the embedding provider (encrypted/stored separately) */
  apiKey?: string;
  /** Model to use for embeddings */
  model: string;
  /** Whether to automatically embed new/changed files */
  autoEmbed: boolean;
  /** Minimum similarity threshold for search results (0-1) */
  minSimilarity: number;
  /** Maximum number of search results */
  maxResults: number;
}

/**
 * Default semantic search settings
 */
export const DEFAULT_SEMANTIC_SEARCH_SETTINGS: SemanticSearchSettings = {
  enabled: false,
  provider: "openai",
  model: "text-embedding-3-small",
  autoEmbed: true,
  minSimilarity: 0.7,
  maxResults: 10,
};

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
    "ems__TaskPrototype": "{{exo__Asset_label}} (TaskPrototype)",
    // UID-based identifier for ems__TaskPrototype (Issue #2110)
    "75302770-279e-4a59-ba85-09df29725713": "{{exo__Asset_label}} (TaskPrototype)",
    "ems__Task": "{{exo__Asset_label}}",
    "ems__Project": "{{exo__Asset_label}}",
    "ems__Area": "{{exo__Asset_label}}",
    "ems__MeetingPrototype": "{{exo__Asset_label}} (MeetingPrototype)",
    "ems__Meeting": "{{exo__Asset_label}}",
    // DailyNote uses the basename (date) as its display name since it typically doesn't have a label
    "pn__DailyNote": "{{_basename}}",
  },
};

export interface ExocortexSettings {
  showPropertiesSection: boolean;
  layoutVisible: boolean;
  showArchivedAssets: boolean;
  activeFocusArea: string | null;
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
  /** Show asset labels in Quick Switcher (Ctrl+O / Cmd+O) instead of file basenames */
  showLabelsInQuickSwitcher: boolean;
  /** Show asset labels in wikilink autocomplete ([[ suggestions) instead of file basenames */
  showLabelsInWikilinkAutocomplete: boolean;
  /** @deprecated Use displayNameSettings.defaultTemplate instead */
  displayNameTemplate: string;
  sortByDisplayName: boolean;
  /** Per-class display name template settings */
  displayNameSettings: DisplayNameSettings;
  /** Semantic search settings */
  semanticSearchSettings: SemanticSearchSettings;
  /**
   * Auto-adjust plannedEndTimestamp when plannedStartTimestamp changes.
   * Disabled by default to prevent double-shift issues with Obsidian Sync.
   * @see Issue #2142
   */
  autoAdjustPlannedEndTimestamp: boolean;
  [key: string]: unknown;
}

export const DEFAULT_SETTINGS: ExocortexSettings = {
  showPropertiesSection: true,
  layoutVisible: true,
  showArchivedAssets: false,
  activeFocusArea: null,
  showEffortArea: false,
  showEffortVotes: false,
  showFullDateInEffortTimes: false,
  showTimeEstimate: false,
  showLabelsInTabTitles: true,
  showLabelsInProperties: true,
  showLabelsInBody: true,
  showLabelsInGraphView: true,
  showLabelsInLivePreview: true,
  showLabelsInQuickSwitcher: true,
  showLabelsInWikilinkAutocomplete: true,
  displayNameTemplate: "{{exo__Asset_label}} ({{exo__Instance_class}})",
  sortByDisplayName: false,
  displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS,
  semanticSearchSettings: DEFAULT_SEMANTIC_SEARCH_SETTINGS,
  autoAdjustPlannedEndTimestamp: false,
};
