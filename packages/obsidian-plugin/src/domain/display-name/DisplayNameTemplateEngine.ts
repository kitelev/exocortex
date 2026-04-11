/**
 * DisplayNameTemplateEngine - Renders display names from templates
 *
 * Template syntax:
 * - {{field}} - Replaced with frontmatter field value
 * - {{field.nested}} - Dot-notation for nested fields (e.g., {{custom.priority}})
 * - {{_basename}} - Original filename without extension
 * - {{_created}} - File creation date
 *
 * Special handling:
 * - Wikilink syntax [[link]] is stripped from values
 * - Empty template results fall back to label or basename
 *
 * Example templates:
 * - "{{exo__Asset_label}}" - Just the label (default)
 * - "{{exo__Asset_label}}: {{ems__Effort_status}}" - Label with status
 * - "[{{exo__Instance_class}}] {{exo__Asset_label}}" - Class prefix
 * - "{{_basename}} - {{exo__Asset_label}}" - Filename with label
 */
export type MetadataResolver = (wikilinkTarget: string) => Record<string, unknown> | null;

export class DisplayNameTemplateEngine {
  private static readonly PLACEHOLDER_PATTERN = /\{\{([^}]+)\}\}/g;
  private static readonly WIKILINK_PATTERN = /^\[\[|\]\]$/g;

  constructor(private readonly template: string) {}

  /**
   * Render the template with provided metadata
   *
   * @param metadata - Frontmatter metadata object
   * @param basename - Original filename without extension
   * @param createdDate - Optional file creation date
   * @returns Rendered display name, or null if template produces empty result
   */
  render(
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date,
    metadataResolver?: MetadataResolver
  ): string | null {
    if (!this.template || this.template.trim() === "") {
      return null;
    }

    const result = this.template.replace(
      DisplayNameTemplateEngine.PLACEHOLDER_PATTERN,
      (_, key: string) => {
        const trimmedKey = key.trim();
        return this.resolveValue(trimmedKey, metadata, basename, createdDate, metadataResolver);
      }
    );

    // Clean up the result to handle edge cases from missing values
    const cleanedResult = this.cleanupResult(result);

    // Return null if template produces empty or whitespace-only result
    if (cleanedResult === "") {
      return null;
    }

    return cleanedResult;
  }

  /**
   * Clean up rendered result to handle edge cases from missing values
   *
   * Handles cases like:
   * - Empty parentheses at end: "Label ()" -> "Label"
   * - Empty brackets at end: "Label []" -> "Label"
   * - Empty parentheses at start: "() Label" -> "Label"
   * - Standalone parentheses: "()" -> ""
   * - Leading/trailing separators after empty values
   *
   * Note: Only removes empty brackets at string boundaries to avoid
   * affecting content like "function() {}" which is valid text.
   */
  private cleanupResult(result: string): string {
    let cleaned = result;

    // Remove empty parentheses at end of string: "Label ()" -> "Label"
    cleaned = cleaned.replace(/\s+\(\s*\)$/g, "");

    // Remove empty parentheses at start of string: "() Label" -> "Label"
    cleaned = cleaned.replace(/^\(\s*\)\s+/g, "");

    // Remove standalone parentheses (entire string): "()" -> ""
    if (cleaned === "()") {
      cleaned = "";
    }

    // Remove empty brackets at end of string: "Label []" -> "Label"
    cleaned = cleaned.replace(/\s+\[\s*\]$/g, "");

    // Remove empty brackets at start of string: "[] Label" -> "Label"
    cleaned = cleaned.replace(/^\[\s*\]\s+/g, "");

    // Remove standalone brackets (entire string): "[]" -> ""
    if (cleaned === "[]") {
      cleaned = "";
    }

    // Remove multiple consecutive spaces
    cleaned = cleaned.replace(/\s+/g, " ");

    // Trim and return
    return cleaned.trim();
  }

  /**
   * Resolve a placeholder value
   */
  private resolveValue(
    key: string,
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date,
    metadataResolver?: MetadataResolver
  ): string {
    // Handle special variables
    if (key === "_basename") {
      return basename;
    }

    if (key === "_created") {
      if (createdDate) {
        return this.formatDate(createdDate);
      }
      return "";
    }

    // Handle dot notation for nested fields (with cross-asset resolution)
    const value = this.getNestedValue(metadata, key, metadataResolver);
    return this.formatValue(value, metadataResolver);
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(
    obj: Record<string, unknown>,
    path: string,
    metadataResolver?: MetadataResolver
  ): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current !== "object") {
        if (typeof current === "string" && metadataResolver && this.isWikilink(current)) {
          const resolved = metadataResolver(current);
          if (resolved) {
            current = (resolved as Record<string, unknown>)[part];
            continue;
          }
        }
        return undefined;
      }

      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private isWikilink(value: string): boolean {
    return value.startsWith("[[") && value.endsWith("]]");
  }

  /**
   * Format a string value, handling wikilink syntax:
   * - [[target|alias]] → alias
   * - [[target]] with metadataResolver → resolved exo__Asset_label
   * - [[target]] without resolver → target (stripped brackets)
   */
  private formatWikilinkValue(value: string, metadataResolver?: MetadataResolver): string {
    // Match wikilink pattern: [[target]] or [[target|alias]]
    const match = value.match(/^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
    if (!match) {
      // Not a wikilink — strip any partial bracket syntax
      return value.replace(DisplayNameTemplateEngine.WIKILINK_PATTERN, "").trim();
    }

    const target = match[1].trim();
    const alias = match[2]?.trim();

    // If alias exists, use it directly
    if (alias) {
      return alias;
    }

    // Try to resolve label via metadataResolver
    if (metadataResolver) {
      const resolved = metadataResolver(value);
      if (resolved) {
        const label = resolved.exo__Asset_label;
        if (typeof label === "string" && label.trim()) {
          return label.trim();
        }
      }
    }

    // Fallback: return target without brackets
    return target;
  }

  /**
   * Format a value for display.
   * Parses wikilinks to extract alias or resolve label via metadataResolver.
   */
  private formatValue(value: unknown, metadataResolver?: MetadataResolver): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return this.formatWikilinkValue(value, metadataResolver);
    }

    if (Array.isArray(value)) {
      // For arrays, use the first value
      if (value.length === 0) {
        return "";
      }
      return this.formatValue(value[0], metadataResolver);
    }

    if (typeof value === "object") {
      // For objects, try to stringify
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Format a date for display
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Get the template string
   */
  getTemplate(): string {
    return this.template;
  }

  /**
   * Check if template is valid (has at least one placeholder)
   */
  isValid(): boolean {
    if (!this.template || this.template.trim() === "") {
      return false;
    }
    // Use a fresh regex without 'g' flag to avoid state issues
    return /\{\{[^}]+\}\}/.test(this.template);
  }

  /**
   * Extract all placeholder keys from template
   */
  getPlaceholders(): string[] {
    const placeholders: string[] = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(this.template)) !== null) {
      placeholders.push(match[1].trim());
    }

    return placeholders;
  }
}

/**
 * Preset templates for common display name patterns
 */
export const DISPLAY_NAME_PRESETS = {
  default: {
    name: "Label only (default)",
    template: "{{exo__Asset_label}}",
  },
  labelWithStatus: {
    name: "Label with status",
    template: "{{exo__Asset_label}}: {{ems__Effort_status}}",
  },
  classPrefix: {
    name: "Class prefix",
    template: "[{{exo__Instance_class}}] {{exo__Asset_label}}",
  },
  classSuffix: {
    name: "Class suffix",
    template: "{{exo__Asset_label}} ({{exo__Instance_class}})",
  },
  basenameWithLabel: {
    name: "Filename with label",
    template: "{{_basename}} - {{exo__Asset_label}}",
  },
  datePrefix: {
    name: "Date prefix",
    template: "{{_created}} - {{exo__Asset_label}}",
  },
} as const;

export type DisplayNamePresetKey = keyof typeof DISPLAY_NAME_PRESETS;

/**
 * Default template (shows label with class suffix for consistent display across all asset types)
 */
export const DEFAULT_DISPLAY_NAME_TEMPLATE = DISPLAY_NAME_PRESETS.classSuffix.template;
