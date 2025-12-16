/**
 * Layout Domain Models
 *
 * This module exports TypeScript types and interfaces for the Exocortex Layout system.
 * These types map to the ontology classes defined in exo__Layout and related classes.
 *
 * Layout System Overview:
 * - Layout: Base class for visual representations (Table, Kanban, Graph, Calendar, List)
 * - LayoutColumn: Column definition for table-based layouts
 * - LayoutFilter: Filter conditions for asset selection
 * - LayoutSort: Sort order definition
 * - LayoutGroup: Grouping definition for organizing assets
 *
 * @example
 * ```typescript
 * import {
 *   Layout,
 *   LayoutType,
 *   TableLayout,
 *   KanbanLayout,
 *   LayoutColumn,
 *   LayoutFilter,
 *   LayoutSort,
 *   LayoutGroup,
 *   isTableLayout,
 *   isKanbanLayout,
 * } from "./domain/layout";
 *
 * // Check layout type
 * if (isTableLayout(layout)) {
 *   console.log("Columns:", layout.columns.length);
 * }
 *
 * // Create from frontmatter
 * const filter = createLayoutFilterFromFrontmatter(frontmatter);
 * ```
 *
 * @packageDocumentation
 */

// Layout types
export {
  LayoutType,
  type CalendarView,
  type BaseLayout,
  type TableLayout,
  type KanbanLayout,
  type GraphLayout,
  type CalendarLayout,
  type ListLayout,
  type Layout,
  getLayoutTypeFromInstanceClass,
  isLayoutFrontmatter,
  createBaseLayoutFromFrontmatter,
  isTableLayout,
  isKanbanLayout,
  isGraphLayout,
  isCalendarLayout,
  isListLayout,
  isValidCalendarView,
} from "./Layout";

// LayoutColumn types
export {
  type ColumnRenderer,
  type LayoutColumn,
  createLayoutColumnFromFrontmatter,
  isValidColumnRenderer,
  getDefaultColumnHeader,
} from "./LayoutColumn";

// LayoutFilter types
export {
  type FilterOperator,
  type LayoutFilter,
  createLayoutFilterFromFrontmatter,
  isValidFilterOperator,
  isSimpleFilter,
  isSparqlFilter,
} from "./LayoutFilter";

// LayoutSort types
export {
  type SortDirection,
  type NullsPosition,
  type LayoutSort,
  createLayoutSortFromFrontmatter,
  isValidSortDirection,
  isValidNullsPosition,
} from "./LayoutSort";

// LayoutGroup types
export {
  type GroupSortOrder,
  type LayoutGroup,
  createLayoutGroupFromFrontmatter,
  isValidGroupSortOrder,
} from "./LayoutGroup";

// LayoutActions types
export {
  type ActionPosition,
  type CommandRef,
  type LayoutActions,
  isValidActionPosition,
  createLayoutActionsFromFrontmatter,
  createCommandRefFromFrontmatter,
  isLayoutActionsFrontmatter,
  isCommandFrontmatter,
  isPreconditionFrontmatter,
  isSparqlGroundingFrontmatter,
} from "./LayoutActions";
