/**
 * Column renderer type for layout columns.
 * Determines how the column value is displayed in the UI.
 */
export type ColumnRenderer =
  | "text"
  | "link"
  | "badge"
  | "progress"
  | "datetime"
  | "duration"
  | "number"
  | "boolean"
  | "tags"
  | "image"
  | "custom";

/**
 * Layout Column interface.
 * Defines a column in a table-based layout.
 *
 * Maps to ontology class: exo__LayoutColumn
 *
 * Properties from ontology:
 * - exo__LayoutColumn_property: Reference to the property to display
 * - exo__LayoutColumn_header: Column header text
 * - exo__LayoutColumn_width: Column width (px, %, auto, fr)
 * - exo__LayoutColumn_renderer: How to render the value
 * - exo__LayoutColumn_editable: Whether inline editing is allowed
 * - exo__LayoutColumn_sortable: Whether column can be sorted
 *
 * @example
 * ```typescript
 * const labelColumn: LayoutColumn = {
 *   uid: "60000000-0000-0000-0000-000000000010",
 *   label: "Task Label Column",
 *   property: "[[exo__Asset_label]]",
 *   header: "Задача",
 *   width: "1fr",
 *   renderer: "link",
 *   editable: true,
 *   sortable: true
 * };
 * ```
 */
export interface LayoutColumn {
  /**
   * Unique identifier for the column definition.
   * Corresponds to exo__Asset_uid in frontmatter.
   */
  uid: string;

  /**
   * Human-readable label for the column definition.
   * Corresponds to exo__Asset_label in frontmatter.
   */
  label: string;

  /**
   * Description of the column.
   * Corresponds to exo__Asset_description in frontmatter.
   */
  description?: string;

  /**
   * Reference to the property to display in this column.
   * Value is a wikilink reference like "[[exo__Asset_label]]".
   * Maps to exo__LayoutColumn_property.
   */
  property: string;

  /**
   * Column header text displayed in the table header.
   * If not specified, derived from property label.
   * Maps to exo__LayoutColumn_header.
   */
  header?: string;

  /**
   * Column width specification.
   * Can be: px value ("100px"), percentage ("20%"), "auto", or grid fr ("1fr").
   * Maps to exo__LayoutColumn_width.
   */
  width?: string;

  /**
   * How to render the column value.
   * Maps to exo__LayoutColumn_renderer.
   * @default "text"
   */
  renderer?: ColumnRenderer;

  /**
   * Whether inline editing is enabled for this column.
   * Maps to exo__LayoutColumn_editable.
   * @default false
   */
  editable?: boolean;

  /**
   * Whether the table can be sorted by this column.
   * Maps to exo__LayoutColumn_sortable.
   * @default false
   */
  sortable?: boolean;
}

/**
 * Create a LayoutColumn from frontmatter data.
 *
 * @param frontmatter - The YAML frontmatter object from an Obsidian note
 * @returns A LayoutColumn object or null if required fields are missing
 *
 * @example
 * ```typescript
 * const frontmatter = {
 *   exo__Asset_uid: "60000000-0000-0000-0000-000000000010",
 *   exo__Asset_label: "Task Label Column",
 *   exo__LayoutColumn_property: "[[exo__Asset_label]]",
 *   exo__LayoutColumn_header: "Задача",
 *   exo__LayoutColumn_width: "1fr",
 *   exo__LayoutColumn_renderer: "link",
 *   exo__LayoutColumn_editable: true,
 *   exo__LayoutColumn_sortable: true
 * };
 * const column = createLayoutColumnFromFrontmatter(frontmatter);
 * ```
 */
export function createLayoutColumnFromFrontmatter(
  frontmatter: Record<string, unknown>,
): LayoutColumn | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;
  const property = frontmatter["exo__LayoutColumn_property"] as
    | string
    | undefined;

  if (!uid || !label || !property) {
    return null;
  }

  const renderer = frontmatter["exo__LayoutColumn_renderer"] as
    | string
    | undefined;

  return {
    uid,
    label,
    description: frontmatter["exo__Asset_description"] as string | undefined,
    property,
    header: frontmatter["exo__LayoutColumn_header"] as string | undefined,
    width: frontmatter["exo__LayoutColumn_width"] as string | undefined,
    renderer: isValidColumnRenderer(renderer) ? renderer : "text",
    editable: Boolean(frontmatter["exo__LayoutColumn_editable"]),
    sortable: Boolean(frontmatter["exo__LayoutColumn_sortable"]),
  };
}

/**
 * Check if a value is a valid ColumnRenderer.
 *
 * @param value - The value to check
 * @returns True if the value is a valid ColumnRenderer
 */
export function isValidColumnRenderer(
  value: unknown,
): value is ColumnRenderer {
  const validRenderers: ColumnRenderer[] = [
    "text",
    "link",
    "badge",
    "progress",
    "datetime",
    "duration",
    "number",
    "boolean",
    "tags",
    "image",
    "custom",
  ];
  return typeof value === "string" && validRenderers.includes(value as ColumnRenderer);
}

/**
 * Get the default header text for a column based on its property.
 *
 * @param property - The property wikilink reference
 * @returns The derived header text
 *
 * @example
 * ```typescript
 * getDefaultColumnHeader("[[exo__Asset_label]]");
 * // Returns: "Label"
 *
 * getDefaultColumnHeader("[[ems__Effort_startTimestamp]]");
 * // Returns: "Start Timestamp"
 * ```
 */
export function getDefaultColumnHeader(property: string): string {
  // Extract property name from wikilink
  const match = property.match(/\[\[([^\]]+)\]\]/);
  const propertyName = match ? match[1] : property;

  // Remove prefix (exo__, ems__, etc.)
  const withoutPrefix = propertyName.replace(/^[a-z]+__/, "");

  // Split on underscore (e.g., "Asset_label" -> ["Asset", "label"])
  const parts = withoutPrefix.split("_");

  // For class properties like "Asset_label", take parts after class name (index 1+)
  // For simple properties like "lowercase_property", use all parts
  // Heuristic: if first part is PascalCase (class name), skip it
  const isPascalCase = parts[0] && /^[A-Z]/.test(parts[0]);
  const propertyParts = isPascalCase && parts.length > 1 ? parts.slice(1) : parts;

  // Join parts with space
  const propertyPart = propertyParts.join(" ");

  // Convert camelCase to spaces and capitalize each word
  return propertyPart
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
