/**
 * Sort direction for layout sorting.
 * Determines whether items are sorted in ascending or descending order.
 */
export type SortDirection = "asc" | "desc";

/**
 * Position for null values in sorted results.
 * Determines whether null/undefined values appear first or last.
 */
export type NullsPosition = "first" | "last";

/**
 * Layout Sort interface.
 * Defines how assets are sorted within a Layout.
 *
 * Maps to ontology class: exo__LayoutSort
 *
 * Properties from ontology:
 * - exo__LayoutSort_property: Reference to the property to sort by
 * - exo__LayoutSort_direction: Sort direction (asc/desc)
 * - exo__LayoutSort_nullsPosition: Where to place null values
 *
 * @example
 * ```typescript
 * const sortByStartTime: LayoutSort = {
 *   uid: "60000000-0000-0000-0000-000000000020",
 *   label: "Sort by Start Time",
 *   property: "[[ems__Effort_startTimestamp]]",
 *   direction: "desc",
 *   nullsPosition: "last"
 * };
 * ```
 */
export interface LayoutSort {
  /**
   * Unique identifier for the sort definition.
   * Corresponds to exo__Asset_uid in frontmatter.
   */
  uid: string;

  /**
   * Human-readable label for the sort definition.
   * Corresponds to exo__Asset_label in frontmatter.
   */
  label: string;

  /**
   * Description of the sort definition.
   * Corresponds to exo__Asset_description in frontmatter.
   */
  description?: string;

  /**
   * Reference to the property to sort by.
   * Value is a wikilink reference like "[[ems__Effort_startTimestamp]]".
   * Maps to exo__LayoutSort_property.
   */
  property: string;

  /**
   * Sort direction: ascending or descending.
   * Maps to exo__LayoutSort_direction.
   * @default "asc"
   */
  direction: SortDirection;

  /**
   * Position for null/undefined values in the sorted list.
   * Maps to exo__LayoutSort_nullsPosition.
   * @default "last"
   */
  nullsPosition?: NullsPosition;
}

/**
 * Create a LayoutSort from frontmatter data.
 *
 * @param frontmatter - The YAML frontmatter object from an Obsidian note
 * @returns A LayoutSort object or null if required fields are missing
 *
 * @example
 * ```typescript
 * const frontmatter = {
 *   exo__Asset_uid: "60000000-0000-0000-0000-000000000020",
 *   exo__Asset_label: "Sort by Start Time",
 *   exo__LayoutSort_property: "[[ems__Effort_startTimestamp]]",
 *   exo__LayoutSort_direction: "desc",
 *   exo__LayoutSort_nullsPosition: "last"
 * };
 * const sort = createLayoutSortFromFrontmatter(frontmatter);
 * ```
 */
export function createLayoutSortFromFrontmatter(
  frontmatter: Record<string, unknown>,
): LayoutSort | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;
  const property = frontmatter["exo__LayoutSort_property"] as string | undefined;
  const direction = frontmatter["exo__LayoutSort_direction"] as
    | string
    | undefined;
  const nullsPosition = frontmatter["exo__LayoutSort_nullsPosition"] as
    | string
    | undefined;

  if (!uid || !label || !property) {
    return null;
  }

  const normalizedDirection: SortDirection =
    direction === "desc" ? "desc" : "asc";
  const normalizedNullsPosition: NullsPosition =
    nullsPosition === "first" ? "first" : "last";

  return {
    uid,
    label,
    description: frontmatter["exo__Asset_description"] as string | undefined,
    property,
    direction: normalizedDirection,
    nullsPosition: normalizedNullsPosition,
  };
}

/**
 * Check if a value is a valid SortDirection.
 *
 * @param value - The value to check
 * @returns True if the value is a valid SortDirection
 */
export function isValidSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

/**
 * Check if a value is a valid NullsPosition.
 *
 * @param value - The value to check
 * @returns True if the value is a valid NullsPosition
 */
export function isValidNullsPosition(value: unknown): value is NullsPosition {
  return value === "first" || value === "last";
}
