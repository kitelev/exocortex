import type { LayoutColumn } from "./LayoutColumn";
import type { LayoutFilter } from "./LayoutFilter";
import type { LayoutSort } from "./LayoutSort";
import type { LayoutGroup } from "./LayoutGroup";

/**
 * Layout type enumeration.
 * Defines the visual representation style for the layout.
 */
export enum LayoutType {
  /** Table layout with rows and columns */
  Table = "exo__TableLayout",

  /** Kanban board with lanes/columns */
  Kanban = "exo__KanbanLayout",

  /** Graph visualization of relationships */
  Graph = "exo__GraphLayout",

  /** Calendar view for time-based data */
  Calendar = "exo__CalendarLayout",

  /** Simple list view */
  List = "exo__ListLayout",
}

/**
 * Calendar view modes.
 */
export type CalendarView = "day" | "week" | "month";

/**
 * Base Layout interface.
 * Defines the common structure for all layout types.
 *
 * Maps to ontology class: exo__Layout
 *
 * Properties from ontology:
 * - exo__Layout_targetClass: The class of assets to display
 * - exo__Layout_columns: Array of column definitions (for table layouts)
 * - exo__Layout_filters: Array of filter definitions
 * - exo__Layout_defaultSort: Default sort definition
 * - exo__Layout_groupBy: Grouping definition
 */
export interface BaseLayout {
  /**
   * Unique identifier for the layout.
   * Corresponds to exo__Asset_uid in frontmatter.
   */
  uid: string;

  /**
   * Human-readable label for the layout.
   * Corresponds to exo__Asset_label in frontmatter.
   */
  label: string;

  /**
   * Description of the layout.
   * Corresponds to exo__Asset_description in frontmatter.
   */
  description?: string;

  /**
   * The layout type (table, kanban, graph, calendar, list).
   * Derived from exo__Instance_class.
   */
  type: LayoutType;

  /**
   * Reference to the target class of assets to display.
   * Value is a wikilink reference like "[[ems__Task]]".
   * Maps to exo__Layout_targetClass.
   */
  targetClass: string;

  /**
   * Array of filter definitions.
   * Maps to exo__Layout_filters.
   */
  filters?: LayoutFilter[];

  /**
   * Default sort definition.
   * Maps to exo__Layout_defaultSort.
   */
  defaultSort?: LayoutSort;

  /**
   * Grouping definition.
   * Maps to exo__Layout_groupBy.
   */
  groupBy?: LayoutGroup;
}

/**
 * Table Layout interface.
 * Extends BaseLayout with table-specific properties.
 */
export interface TableLayout extends BaseLayout {
  type: LayoutType.Table;

  /**
   * Array of column definitions.
   * Maps to exo__Layout_columns.
   */
  columns: LayoutColumn[];
}

/**
 * Kanban Layout interface.
 * Extends BaseLayout with kanban-specific properties.
 */
export interface KanbanLayout extends BaseLayout {
  type: LayoutType.Kanban;

  /**
   * Reference to the property used for lane grouping.
   * Typically a status property like "[[ems__Effort_status]]".
   * Maps to exo__KanbanLayout_laneProperty.
   */
  laneProperty: string;

  /**
   * Explicit list of lanes (columns) in order.
   * Each lane is a wikilink to a status/value asset.
   * Maps to exo__KanbanLayout_lanes.
   */
  lanes?: string[];

  /**
   * Optional column definitions for card content.
   * Maps to exo__Layout_columns.
   */
  columns?: LayoutColumn[];
}

/**
 * Graph Layout interface.
 * Extends BaseLayout with graph-specific properties.
 */
export interface GraphLayout extends BaseLayout {
  type: LayoutType.Graph;

  /**
   * Reference to the property used for node labels.
   * Maps to exo__GraphLayout_nodeLabel.
   */
  nodeLabel?: string;

  /**
   * Array of property references for edges.
   * Maps to exo__GraphLayout_edgeProperties.
   */
  edgeProperties?: string[];

  /**
   * Maximum depth of graph traversal.
   * Maps to exo__GraphLayout_depth.
   * @default 1
   */
  depth?: number;
}

/**
 * Calendar Layout interface.
 * Extends BaseLayout with calendar-specific properties.
 */
export interface CalendarLayout extends BaseLayout {
  type: LayoutType.Calendar;

  /**
   * Reference to the property containing start date/time.
   * Maps to exo__CalendarLayout_startProperty.
   */
  startProperty: string;

  /**
   * Reference to the property containing end date/time.
   * Maps to exo__CalendarLayout_endProperty.
   */
  endProperty?: string;

  /**
   * Default calendar view mode.
   * Maps to exo__CalendarLayout_view.
   * @default "week"
   */
  view?: CalendarView;
}

/**
 * List Layout interface.
 * Extends BaseLayout with list-specific properties.
 */
export interface ListLayout extends BaseLayout {
  type: LayoutType.List;

  /**
   * Template string for list item rendering.
   * Can include property placeholders like {{label}} or {{status}}.
   * Maps to exo__ListLayout_template.
   */
  template?: string;

  /**
   * Whether to show the class icon for each item.
   * Maps to exo__ListLayout_showIcon.
   * @default false
   */
  showIcon?: boolean;
}

/**
 * Union type for all layout types.
 */
export type Layout =
  | TableLayout
  | KanbanLayout
  | GraphLayout
  | CalendarLayout
  | ListLayout;

/**
 * Extract the LayoutType from an instance class wikilink or array of wikilinks.
 *
 * @param instanceClass - The instance class value from frontmatter
 * @returns The corresponding LayoutType or null if not a layout type
 */
export function getLayoutTypeFromInstanceClass(
  instanceClass: unknown,
): LayoutType | null {
  const classes = Array.isArray(instanceClass) ? instanceClass : [instanceClass];

  for (const cls of classes) {
    if (typeof cls !== "string") continue;

    // Extract class name from wikilink
    const match = cls.match(/\[\[([^\]]+)\]\]/);
    const className = match ? match[1] : cls;

    switch (className) {
      case "exo__TableLayout":
        return LayoutType.Table;
      case "exo__KanbanLayout":
        return LayoutType.Kanban;
      case "exo__GraphLayout":
        return LayoutType.Graph;
      case "exo__CalendarLayout":
        return LayoutType.Calendar;
      case "exo__ListLayout":
        return LayoutType.List;
    }
  }

  return null;
}

/**
 * Check if a frontmatter object represents a Layout asset.
 *
 * @param frontmatter - The frontmatter object to check
 * @returns True if this is a layout asset
 */
export function isLayoutFrontmatter(
  frontmatter: Record<string, unknown>,
): boolean {
  const instanceClass = frontmatter["exo__Instance_class"];
  return getLayoutTypeFromInstanceClass(instanceClass) !== null;
}

/**
 * Create a base Layout object from frontmatter data.
 * Use this when you don't need the specific layout type properties.
 *
 * @param frontmatter - The YAML frontmatter object from an Obsidian note
 * @returns A BaseLayout object or null if required fields are missing
 */
export function createBaseLayoutFromFrontmatter(
  frontmatter: Record<string, unknown>,
): BaseLayout | null {
  const uid = frontmatter["exo__Asset_uid"] as string | undefined;
  const label = frontmatter["exo__Asset_label"] as string | undefined;
  const instanceClass = frontmatter["exo__Instance_class"];
  const targetClass = frontmatter["exo__Layout_targetClass"] as
    | string
    | undefined;

  const layoutType = getLayoutTypeFromInstanceClass(instanceClass);

  if (!uid || !label || !layoutType || !targetClass) {
    return null;
  }

  return {
    uid,
    label,
    description: frontmatter["exo__Asset_description"] as string | undefined,
    type: layoutType,
    targetClass,
    // Note: filters, defaultSort, and groupBy would need to be resolved
    // from their wikilink references - this requires vault access
  };
}

/**
 * Type guard for TableLayout.
 */
export function isTableLayout(layout: Layout): layout is TableLayout {
  return layout.type === LayoutType.Table;
}

/**
 * Type guard for KanbanLayout.
 */
export function isKanbanLayout(layout: Layout): layout is KanbanLayout {
  return layout.type === LayoutType.Kanban;
}

/**
 * Type guard for GraphLayout.
 */
export function isGraphLayout(layout: Layout): layout is GraphLayout {
  return layout.type === LayoutType.Graph;
}

/**
 * Type guard for CalendarLayout.
 */
export function isCalendarLayout(layout: Layout): layout is CalendarLayout {
  return layout.type === LayoutType.Calendar;
}

/**
 * Type guard for ListLayout.
 */
export function isListLayout(layout: Layout): layout is ListLayout {
  return layout.type === LayoutType.List;
}

/**
 * Check if a calendar view value is valid.
 */
export function isValidCalendarView(value: unknown): value is CalendarView {
  return value === "day" || value === "week" || value === "month";
}
