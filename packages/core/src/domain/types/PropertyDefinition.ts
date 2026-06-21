import { PropertyFieldType } from "./PropertyFieldType";

/**
 * Property definition interface.
 * Describes the metadata for a property that can be used in dynamic forms.
 *
 * @example
 * ```typescript
 * const labelProperty: PropertyDefinition = {
 *   uri: "exo:Asset_label",
 *   name: "exo__Asset_label",
 *   label: "Label",
 *   fieldType: PropertyFieldType.Text,
 *   required: true,
 *   description: "Display label for the asset"
 * };
 *
 * const statusProperty: PropertyDefinition = {
 *   uri: "ems:Effort_status",
 *   name: "ems__Effort_status",
 *   label: "Status",
 *   fieldType: PropertyFieldType.StatusSelect,
 *   rangeType: "https://exocortex.my/ontology/ems#EffortStatus"
 * };
 * ```
 */
export interface PropertyDefinition {
  /**
   * Property URI in prefixed form (e.g., "exo:Asset_label", "ems:Effort_status").
   * This is the RDF identifier for the property.
   */
  uri: string;

  /**
   * Property name in frontmatter format (e.g., "exo__Asset_label").
   * This is the key used in YAML frontmatter.
   */
  name: string;

  /**
   * Human-readable label for the property (e.g., "Label", "Status").
   * Used for UI display in forms and tables.
   */
  label: string;

  /**
   * Field type for rendering in UI forms.
   * Determines how the property value should be input/edited.
   */
  fieldType: PropertyFieldType;

  /**
   * Whether this property is required.
   * Required properties must have a value when creating/editing an asset.
   * @default false
   */
  required?: boolean;

  /**
   * Human-readable description of the property.
   * Often sourced from rdfs:comment in the ontology.
   */
  description?: string;

  /**
   * The RDF range type IRI (e.g., "http://www.w3.org/2001/XMLSchema#string").
   * Used for validation and type inference.
   */
  rangeType?: string;

  /**
   * Whether this property is deprecated.
   * Deprecated properties should still be displayed but marked as such.
   * @default false
   */
  deprecated?: boolean;

  /**
   * For enum/select fields, the allowed values.
   * Each option has a value (stored) and label (displayed).
   */
  options?: PropertyOption[];

  /**
   * Default value for the property.
   * Used when creating new assets.
   */
  defaultValue?: unknown;

  /**
   * Minimum value for numeric fields.
   */
  minValue?: number;

  /**
   * Maximum value for numeric fields.
   */
  maxValue?: number;

  /**
   * Maximum length for text fields.
   */
  maxLength?: number;

  /**
   * Regular expression pattern for validation.
   */
  pattern?: string;

  /**
   * Whether the property can have multiple values (array).
   * @default false
   */
  isMultiValue?: boolean;

  /**
   * Order hint for sorting properties in forms.
   * Lower numbers appear first.
   */
  order?: number;

  /**
   * Grouping category for organizing properties in forms.
   */
  group?: string;
}

/**
 * Option for enum/select property fields.
 */
export interface PropertyOption {
  /**
   * The value to store (e.g., wikilink to status asset).
   */
  value: string;

  /**
   * Human-readable label for display.
   */
  label: string;

  /**
   * Optional description for the option.
   */
  description?: string;

  /**
   * Optional icon or color for visual differentiation.
   */
  icon?: string;
}

/**
 * Convert a frontmatter property name to a prefixed URI.
 *
 * @param propertyName - Property name in frontmatter format (e.g., "exo__Asset_label")
 * @returns Prefixed URI (e.g., "exo:Asset_label")
 *
 * @example
 * ```typescript
 * propertyNameToUri("exo__Asset_label");
 * // Returns: "exo:Asset_label"
 *
 * propertyNameToUri("ems__Effort_status");
 * // Returns: "ems:Effort_status"
 * ```
 */
export function propertyNameToUri(propertyName: string): string {
  // Replace double underscore with colon for prefix
  return propertyName.replace(/^([a-z]+)__/, "$1:");
}

/**
 * Convert a prefixed URI to a frontmatter property name.
 *
 * @param uri - Prefixed URI (e.g., "exo:Asset_label")
 * @returns Property name in frontmatter format (e.g., "exo__Asset_label")
 *
 * @example
 * ```typescript
 * uriToPropertyName("exo:Asset_label");
 * // Returns: "exo__Asset_label"
 *
 * uriToPropertyName("ems:Effort_status");
 * // Returns: "ems__Effort_status"
 * ```
 */
export function uriToPropertyName(uri: string): string {
  // Handle full IRI
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const match = uri.match(/\/([a-z]+)#([A-Za-z0-9_]+)$/);
    if (match) {
      return `${match[1]}__${match[2]}`;
    }
    // Fallback: extract last segment
    const lastHash = uri.lastIndexOf("#");
    const lastSlash = uri.lastIndexOf("/");
    const separator = Math.max(lastHash, lastSlash);
    return separator >= 0 ? uri.substring(separator + 1) : uri;
  }

  // Handle prefixed URI
  return uri.replace(/^([a-z]+):/, "$1__");
}

/**
 * Extract human-readable label from a property name or URI.
 *
 * @param propertyNameOrUri - Property name or URI
 * @returns Human-readable label
 *
 * @example
 * ```typescript
 * extractPropertyLabel("exo__Asset_label");
 * // Returns: "Label"
 *
 * extractPropertyLabel("ems__Effort_startTimestamp");
 * // Returns: "Start Timestamp"
 * ```
 */
export function extractPropertyLabel(propertyNameOrUri: string): string {
  // Convert URI to property name if needed
  const propertyName = propertyNameOrUri.includes(":")
    ? uriToPropertyName(propertyNameOrUri)
    : propertyNameOrUri;

  // Remove prefix (exo__, ems__, etc.)
  const withoutPrefix = propertyName.replace(/^[a-z]+__/, "");

  // Split on underscore (e.g., "Asset_label" -> "label")
  const parts = withoutPrefix.split("_");
  const propertyPart = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];

  // Convert camelCase to spaces and capitalize first letter
  return propertyPart
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
}
