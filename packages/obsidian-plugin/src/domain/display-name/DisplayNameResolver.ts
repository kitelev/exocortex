/**
 * DisplayNameResolver - Resolves display names with per-class template support
 *
 * This service:
 * - Determines the appropriate template based on asset class
 * - Uses DisplayNameTemplateEngine for template rendering
 * - Falls back to default template if no class-specific template exists
 * - Handles status emoji mapping
 *
 * Resolution algorithm:
 * 1. Extract exo__Instance_class from metadata
 * 2. Look up class-specific template in classTemplates
 * 3. Fall back to defaultTemplate if not found
 * 4. Render template with metadata using DisplayNameTemplateEngine
 */
import { DisplayNameTemplateEngine } from "./DisplayNameTemplateEngine";
import type { DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

/**
 * Context for display name resolution
 */
export interface DisplayNameContext {
  /** Frontmatter metadata */
  metadata: Record<string, unknown>;
  /** Original filename without extension */
  basename: string;
  /** File creation date (optional) */
  createdDate?: Date;
}

export class DisplayNameResolver {
  constructor(private readonly settings: DisplayNameSettings) {}

  /**
   * Resolve display name for an asset
   *
   * @param context - Display name context containing metadata and file info
   * @returns Resolved display name, or null if template produces empty result
   */
  resolve(context: DisplayNameContext): string | null {
    const { metadata, basename, createdDate } = context;

    // Extract asset class
    const assetClass = this.extractAssetClass(metadata);

    // Get appropriate template for this class
    const template = this.getTemplateForClass(assetClass);

    // Render using template engine with status emoji support
    const engine = new DisplayNameTemplateEngine(
      template,
      this.settings.statusEmojis
    );

    return engine.render(metadata, basename, createdDate);
  }

  /**
   * Get the template for a specific asset class
   *
   * @param assetClass - The asset class (e.g., "ems__Task")
   * @returns The template string to use
   */
  getTemplateForClass(assetClass: string | null): string {
    if (assetClass && this.settings.classTemplates[assetClass]) {
      return this.settings.classTemplates[assetClass];
    }
    return this.settings.defaultTemplate;
  }

  /**
   * Extract asset class from metadata
   *
   * Handles various formats:
   * - String: "ems__Task"
   * - Wikilink: "[[ems__Task]]"
   * - Array: ["ems__Task"]
   */
  private extractAssetClass(metadata: Record<string, unknown>): string | null {
    const instanceClass = metadata.exo__Instance_class;

    if (!instanceClass) {
      return null;
    }

    // Handle array - take first element
    if (Array.isArray(instanceClass)) {
      if (instanceClass.length === 0) return null;
      return this.cleanClassValue(instanceClass[0]);
    }

    // Handle string
    if (typeof instanceClass === "string") {
      return this.cleanClassValue(instanceClass);
    }

    return null;
  }

  /**
   * Clean class value by removing wikilink syntax and trimming
   */
  private cleanClassValue(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const cleaned = value
      .replace(/^\[\[|\]\]$/g, "") // Remove wikilink brackets
      .replace(/^"|"$/g, "") // Remove quotes
      .trim();

    return cleaned || null;
  }

  /**
   * Get list of all configured class templates
   */
  getConfiguredClasses(): string[] {
    return Object.keys(this.settings.classTemplates);
  }

  /**
   * Get list of all configured status emojis
   */
  getConfiguredStatuses(): string[] {
    return Object.keys(this.settings.statusEmojis);
  }

  /**
   * Get emoji for a status value
   */
  getStatusEmoji(status: string): string | null {
    // Try direct match
    if (this.settings.statusEmojis[status]) {
      return this.settings.statusEmojis[status];
    }

    // Try case-insensitive match
    const upperStatus = status.toUpperCase();
    for (const [key, emoji] of Object.entries(this.settings.statusEmojis)) {
      if (key.toUpperCase() === upperStatus) {
        return emoji;
      }
    }

    return null;
  }

  /**
   * Check if per-class templates are enabled
   * (i.e., if there are any class-specific templates configured)
   */
  hasClassTemplates(): boolean {
    return Object.keys(this.settings.classTemplates).length > 0;
  }
}

/**
 * Create a DisplayNameResolver with default settings
 */
export function createDefaultResolver(): DisplayNameResolver {
  const { DEFAULT_DISPLAY_NAME_SETTINGS } = require("@plugin/domain/settings/ExocortexSettings");
  return new DisplayNameResolver(DEFAULT_DISPLAY_NAME_SETTINGS);
}
