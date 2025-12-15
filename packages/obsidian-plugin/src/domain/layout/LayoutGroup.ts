/**
 * Sort order for groups.
 * Determines how groups are ordered when displaying grouped data.
 */
export type GroupSortOrder = "asc" | "desc" | "custom";

/**
 * Layout Group interface.
 * Defines how assets are grouped within a Layout.
 *
 * Maps to ontology class: exo__LayoutGroup
 *
 * Properties from ontology:
 * - exo__LayoutGroup_property: Reference to the property to group by
 * - exo__LayoutGroup_collapsed: Whether groups are collapsed by default
 * - exo__LayoutGroup_showCount: Whether to show item count in group header
 * - exo__LayoutGroup_sortGroups: How to order the groups
 *
 * @example
 * ```typescript
 * const groupByProject: LayoutGroup = {
 *   uid: "group-001",
 *   label: "Group by Project",
 *   property: "[[ems__Task_project]]",
 *   collapsed: false,
 *   showCount: true,
 *   sortGroups: "asc"
 * };
 * ```
 */
export interface LayoutGroup {
  /**
   * Unique identifier for the group definition.
   * Corresponds to exo__Asset_uid in frontmatter.
   */
  uid: string;

  /**
   * Human-readable label for the group definition.
   * Corresponds to exo__Asset_label in frontmatter.
   */
  label: string;

  /**
   * Description of the grouping.
   * Corresponds to exo__Asset_description in frontmatter.
   */
  description?: string;

  /**
   * Reference to the property to group by.
   * Value is a wikilink reference like "[[ems__Task_project]]".
   * Maps to exo__LayoutGroup_property.
   */
  property: string;

  /**
   * Whether groups are collapsed by default.
   * Maps to exo__LayoutGroup_collapsed.
   * @default false
   */
  collapsed?: boolean;

  /**
   * Whether to show the count of items in each group header.
   * Maps to exo__LayoutGroup_showCount.
   * @default true
   */
  showCount?: boolean;

  /**
   * How to order the groups.
   * - "asc": Alphabetically ascending
   * - "desc": Alphabetically descending
   * - "custom": Custom order (defined elsewhere)
   * Maps to exo__LayoutGroup_sortGroups.
   * @default "asc"
   */
  sortGroups?: GroupSortOrder;
}

/**
 * Create a LayoutGroup from frontmatter data.
 *
 * @param frontmatter - The YAML frontmatter object from an Obsidian note
 * @returns A LayoutGroup object or null if required fields are missing
 *
 * @example
 * ```typescript
 * const frontmatter = {
 *   exo__Asset_uid: "group-001",
 *   exo__Asset_label: "Group by Project",
 *   exo__LayoutGroup_property: "[[ems__Task_project]]",
 *   exo__LayoutGroup_collapsed: false,
 *   exo__LayoutGroup_showCount: true,
 *   exo__LayoutGroup_sortGroups: "asc"
 * };
 * const group = createLayoutGroupFromFrontmatter(frontmatter);
 * ```
 */
export function createLayoutGroupFromFrontmatter(
  frontmatter: Record<string, unknown>,
): LayoutGroup | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;
  const property = frontmatter["exo__LayoutGroup_property"] as
    | string
    | undefined;

  if (!uid || !label || !property) {
    return null;
  }

  const sortGroups = frontmatter["exo__LayoutGroup_sortGroups"] as
    | string
    | undefined;

  return {
    uid,
    label,
    description: frontmatter["exo__Asset_description"] as string | undefined,
    property,
    collapsed: Boolean(frontmatter["exo__LayoutGroup_collapsed"]),
    showCount: frontmatter["exo__LayoutGroup_showCount"] !== false,
    sortGroups: isValidGroupSortOrder(sortGroups) ? sortGroups : "asc",
  };
}

/**
 * Check if a value is a valid GroupSortOrder.
 *
 * @param value - The value to check
 * @returns True if the value is a valid GroupSortOrder
 */
export function isValidGroupSortOrder(
  value: unknown,
): value is GroupSortOrder {
  return value === "asc" || value === "desc" || value === "custom";
}
