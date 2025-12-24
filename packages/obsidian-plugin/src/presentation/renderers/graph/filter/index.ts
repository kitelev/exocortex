/**
 * Graph Filter Module
 *
 * Provides semantic filtering for graph visualization.
 *
 * @module presentation/renderers/graph/filter
 * @since 1.0.0
 */

// Types
export type {
  GraphFilter,
  TypeFilter,
  PredicateFilter,
  LiteralFilter,
  PathFilter,
  CustomSPARQLFilter,
  CompositeFilter,
  FilterPreset,
  AdvancedFilterState,
  TypeCounts,
  FilterPanelConfig,
  BaseFilter,
} from "./FilterTypes";

// Type creators and utilities
export {
  createTypeFilter,
  createPredicateFilter,
  createLiteralFilter,
  createPathFilter,
  createCompositeFilter,
  generateFilterId,
  DEFAULT_FILTER_PANEL_CONFIG,
} from "./FilterTypes";

// FilterManager
export {
  FilterManager,
  getFilterManager,
  resetFilterManager,
  type FilterChangeCallback,
  type GraphData,
} from "./FilterManager";

// React components
export { FilterPanel } from "./FilterPanel";
export type { FilterPanelProps } from "./FilterPanel";
export { FilterPanelButton, FilterIcon } from "./FilterPanelButton";
export type { FilterPanelButtonProps } from "./FilterPanelButton";
