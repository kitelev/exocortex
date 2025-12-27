import type { WebhookEventType, EmbeddingProvider } from "exocortex";

/**
 * Webhook configuration stored in settings
 * Excludes runtime-only fields from WebhookConfig
 */
export interface StoredWebhookConfig {
  /** Unique identifier for the webhook */
  id: string;
  /** Human-readable name */
  name: string;
  /** Target URL to send events to */
  url: string;
  /** Events to subscribe to (empty = all events) */
  events: WebhookEventType[];
  /** Whether the webhook is enabled */
  enabled: boolean;
  /** Optional secret for HMAC signature */
  secret?: string;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Retry count on failure (default: 3) */
  retryCount?: number;
}

/**
 * Webhook settings configuration
 */
export interface WebhookSettings {
  /** Whether webhooks are globally enabled */
  enabled: boolean;
  /** Configured webhooks */
  webhooks: StoredWebhookConfig[];
}

/**
 * Default webhook settings
 */
export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = {
  enabled: false,
  webhooks: [],
};

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
  /** Apply display name templates to links in Obsidian's Properties block */
  showLabelsInProperties: boolean;
  /** @deprecated Use displayNameSettings.defaultTemplate instead */
  displayNameTemplate: string;
  sortByDisplayName: boolean;
  /** Per-class display name template settings */
  displayNameSettings: DisplayNameSettings;
  /** Webhook integration settings */
  webhookSettings: WebhookSettings;
  /** Semantic search settings */
  semanticSearchSettings: SemanticSearchSettings;
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
  showLabelsInProperties: true,
  displayNameTemplate: "{{exo__Asset_label}}",
  sortByDisplayName: false,
  displayNameSettings: DEFAULT_DISPLAY_NAME_SETTINGS,
  webhookSettings: DEFAULT_WEBHOOK_SETTINGS,
  semanticSearchSettings: DEFAULT_SEMANTIC_SEARCH_SETTINGS,
};
