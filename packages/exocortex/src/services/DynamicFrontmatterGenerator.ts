import { injectable } from "tsyringe";
import { v4 as uuidv4 } from "uuid";
import { DateFormatter } from "../utilities/DateFormatter";

/**
 * Legacy property field type for backwards compatibility.
 * @deprecated Use PropertyFieldType enum from domain/types instead.
 */
export type LegacyPropertyFieldType =
  | "text"
  | "status-select"
  | "size-select"
  | "wikilink"
  | "number"
  | "boolean"
  | "timestamp";

/**
 * Simple property definition for frontmatter generation.
 * For more comprehensive property definitions, use PropertyDefinition from domain/types.
 */
export interface FrontmatterPropertyDefinition {
  /** Property name (e.g., "exo__Asset_label") */
  name: string;
  /** Field type for formatting */
  type: LegacyPropertyFieldType;
  /** Whether this property is required */
  required?: boolean;
}

/**
 * DynamicFrontmatterGenerator
 *
 * Service that converts property values to properly formatted YAML frontmatter.
 * Handles different data types with appropriate formatting:
 * - Text: Quoted strings
 * - Wikilink/Reference: `"[[assetName]]"` format
 * - Number: Raw numeric values
 * - Boolean: true/false
 * - Timestamp: ISO 8601 format
 * - Status/Size selects: Quoted wikilinks
 *
 * @example
 * ```typescript
 * const generator = new DynamicFrontmatterGenerator();
 *
 * const values = {
 *   exo__Asset_label: "My Task",
 *   ems__Effort_status: "[[ems__EffortStatusDraft]]",
 *   ems__Effort_votes: 5,
 *   exo__Asset_isArchived: false
 * };
 *
 * const properties = [
 *   { name: "exo__Asset_label", type: "text" },
 *   { name: "ems__Effort_status", type: "status-select" },
 *   { name: "ems__Effort_votes", type: "number" },
 *   { name: "exo__Asset_isArchived", type: "boolean" }
 * ];
 *
 * const frontmatter = generator.generate("ems__Task", values, properties);
 * ```
 */
@injectable()
export class DynamicFrontmatterGenerator {
  /**
   * Generate frontmatter object from property values.
   *
   * @param className - The class name of the asset being created (e.g., "ems__Task")
   * @param values - Record of property names to their values
   * @param properties - Array of property definitions with type information
   * @param options - Optional configuration for frontmatter generation
   * @returns Record<string, any> - Frontmatter object ready for YAML serialization
   */
  generate(
    className: string,
    values: Record<string, any>,
    properties: FrontmatterPropertyDefinition[],
    options?: {
      /** Custom UID to use instead of generating a new one */
      uid?: string;
      /** Custom creation timestamp to use */
      createdAt?: string;
      /** isDefinedBy value for ontology reference */
      isDefinedBy?: string;
    },
  ): Record<string, any> {
    const frontmatter: Record<string, any> = {};
    const now = new Date();

    // Set required system properties
    if (options?.isDefinedBy) {
      frontmatter["exo__Asset_isDefinedBy"] = this.ensureQuoted(
        options.isDefinedBy,
      );
    }
    frontmatter["exo__Asset_uid"] = options?.uid || uuidv4();
    frontmatter["exo__Asset_createdAt"] =
      options?.createdAt || DateFormatter.toLocalTimestamp(now);
    frontmatter["exo__Instance_class"] = [this.formatWikilink(className)];

    // Create a map of property names to their types for quick lookup
    const propertyTypeMap = new Map<string, LegacyPropertyFieldType>();
    for (const prop of properties) {
      propertyTypeMap.set(prop.name, prop.type);
    }

    // Process each value according to its property type
    for (const [propertyName, value] of Object.entries(values)) {
      // Skip null/undefined values
      if (value === null || value === undefined) {
        continue;
      }

      // Skip system properties that are already set
      if (
        propertyName === "exo__Asset_uid" ||
        propertyName === "exo__Asset_createdAt" ||
        propertyName === "exo__Instance_class" ||
        propertyName === "exo__Asset_isDefinedBy"
      ) {
        continue;
      }

      const propertyType = propertyTypeMap.get(propertyName);
      frontmatter[propertyName] = this.formatValue(value, propertyType);
    }

    // Handle aliases if label is provided
    const label = values["exo__Asset_label"];
    if (label && typeof label === "string" && label.trim() !== "") {
      const trimmedLabel = label.trim();
      frontmatter["exo__Asset_label"] = trimmedLabel;
      frontmatter["aliases"] = [trimmedLabel];
    }

    return frontmatter;
  }

  /**
   * Format a single value according to its property type.
   *
   * @param value - The value to format
   * @param type - The property type (optional, defaults to text)
   * @returns Formatted value for YAML frontmatter
   */
  formatValue(value: any, type?: LegacyPropertyFieldType): any {
    // Handle empty/null values
    if (value === null || value === undefined) {
      return null;
    }

    // If type is not specified, infer from value
    if (!type) {
      return this.formatInferredValue(value);
    }

    switch (type) {
      case "text":
        return this.formatText(value);

      case "wikilink":
        return this.formatWikilink(value);

      case "status-select":
      case "size-select":
        // These are wikilinks that should be quoted
        return this.formatWikilink(value);

      case "number":
        return this.formatNumber(value);

      case "boolean":
        return this.formatBoolean(value);

      case "timestamp":
        return this.formatTimestamp(value);

      default:
        // Unknown type, treat as text
        return this.formatText(value);
    }
  }

  /**
   * Format a text value as a string.
   * Numbers and booleans are converted to strings for text fields.
   */
  private formatText(value: any): string {
    if (typeof value === "string") {
      return value;
    }
    return String(value);
  }

  /**
   * Format a value as a wikilink.
   * Ensures the value is in `"[[assetName]]"` format.
   *
   * @param value - The value to format as wikilink
   * @returns Quoted wikilink string
   */
  private formatWikilink(value: any): string {
    const strValue = String(value);

    // Already in quoted wikilink format
    if (strValue.startsWith('"[[') && strValue.endsWith(']]"')) {
      return strValue;
    }

    // Already in wikilink format, just quote it
    if (strValue.startsWith("[[") && strValue.endsWith("]]")) {
      return `"${strValue}"`;
    }

    // Raw value, wrap in wikilink and quote
    return `"[[${strValue}]]"`;
  }

  /**
   * Format a value as a number.
   * Parses strings to numbers, returns 0 for invalid values.
   */
  private formatNumber(value: any): number {
    if (typeof value === "number") {
      return value;
    }
    const parsed = Number(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Format a value as a boolean.
   * Handles various truthy/falsy representations.
   */
  private formatBoolean(value: any): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.toLowerCase().trim();
      return normalized === "true" || normalized === "yes" || normalized === "1";
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    return Boolean(value);
  }

  /**
   * Format a value as an ISO 8601 timestamp.
   * Handles Date objects, ISO strings, and timestamps.
   *
   * @param value - Date, string, or number to format
   * @returns ISO 8601 timestamp string (YYYY-MM-DDTHH:mm:ss)
   */
  private formatTimestamp(value: any): string {
    if (value instanceof Date) {
      return DateFormatter.toLocalTimestamp(value);
    }

    if (typeof value === "string") {
      // If already in local timestamp format, return as-is
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
        return value;
      }
      // If in ISO UTC format, convert to local format
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
        return value.replace("Z", "");
      }
      // Try to parse as date
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return DateFormatter.toLocalTimestamp(date);
      }
      return value;
    }

    if (typeof value === "number") {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return DateFormatter.toLocalTimestamp(date);
      }
    }

    return String(value);
  }

  /**
   * Format a value with inferred type when no type is specified.
   */
  private formatInferredValue(value: any): any {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value;
    }
    if (value instanceof Date) {
      return DateFormatter.toLocalTimestamp(value);
    }
    if (typeof value === "string") {
      // Check if it looks like a wikilink
      if (value.startsWith("[[") || value.startsWith('"[[')) {
        return this.formatWikilink(value);
      }
      return value;
    }
    return String(value);
  }

  /**
   * Ensure a string value is quoted for YAML.
   * Used for string values that need explicit quoting.
   */
  private ensureQuoted(value: string): string {
    if (!value || value === '""') return '""';
    if (value.startsWith('"') && value.endsWith('"')) return value;
    return `"${value}"`;
  }

  /**
   * Generate frontmatter content as a YAML string.
   * Convenience method that combines generation and serialization.
   *
   * @param className - The class name of the asset
   * @param values - Record of property names to their values
   * @param properties - Array of property definitions
   * @param options - Optional configuration
   * @returns YAML frontmatter string with --- delimiters
   */
  generateYAML(
    className: string,
    values: Record<string, any>,
    properties: FrontmatterPropertyDefinition[],
    options?: {
      uid?: string;
      createdAt?: string;
      isDefinedBy?: string;
    },
  ): string {
    const frontmatter = this.generate(className, values, properties, options);
    return this.toYAML(frontmatter);
  }

  /**
   * Convert a frontmatter object to YAML string format.
   *
   * @param frontmatter - The frontmatter object
   * @returns YAML string with --- delimiters
   */
  private toYAML(frontmatter: Record<string, any>): string {
    const lines = Object.entries(frontmatter).map(([key, value]) => {
      if (Array.isArray(value)) {
        const arrayItems = value.map((item) => `  - ${item}`).join("\n");
        return `${key}:\n${arrayItems}`;
      }
      return `${key}: ${value}`;
    });

    return `---\n${lines.join("\n")}\n---`;
  }
}
