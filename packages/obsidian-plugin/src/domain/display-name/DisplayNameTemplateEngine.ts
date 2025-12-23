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
    createdDate?: Date
  ): string | null {
    if (!this.template || this.template.trim() === "") {
      return null;
    }

    const result = this.template.replace(
      DisplayNameTemplateEngine.PLACEHOLDER_PATTERN,
      (_, key: string) => {
        const trimmedKey = key.trim();
        return this.resolveValue(trimmedKey, metadata, basename, createdDate);
      }
    );

    // Return null if template produces empty or whitespace-only result
    const trimmedResult = result.trim();
    if (trimmedResult === "") {
      return null;
    }

    return trimmedResult;
  }

  /**
   * Resolve a placeholder value
   */
  private resolveValue(
    key: string,
    metadata: Record<string, unknown>,
    basename: string,
    createdDate?: Date
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

    // Handle dot notation for nested fields
    const value = this.getNestedValue(metadata, key);
    return this.formatValue(value);
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current !== "object") {
        return undefined;
      }

      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Format a value for display
   */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      // Strip wikilink syntax
      return value.replace(DisplayNameTemplateEngine.WIKILINK_PATTERN, "").trim();
    }

    if (Array.isArray(value)) {
      // For arrays, use the first value
      if (value.length === 0) {
        return "";
      }
      return this.formatValue(value[0]);
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
 * Default template (just shows label)
 */
export const DEFAULT_DISPLAY_NAME_TEMPLATE = DISPLAY_NAME_PRESETS.default.template;
