/**
 * Search and Highlight Module
 *
 * Provides search functionality, type-based coloring, and visual legend
 * components for graph visualization.
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

// Types
export type {
  TypeColorConfig,
  ColorPalette,
  SearchMatch,
  SearchState,
  SearchOptions,
  HighlightStyle,
  LegendItem,
  LegendState,
  ColorPickerState,
  SearchEventType,
  SearchEvent,
  SearchEventListener,
} from "./SearchTypes";

export {
  BUILT_IN_PALETTES,
  DEFAULT_TYPE_COLORS,
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_HIGHLIGHT_STYLE,
  generateColorFromString,
  generateGoldenRatioColor,
  hslToHex,
  calculateContrastRatio,
  getRelativeLuminance,
  meetsWCAGAA,
  formatTypeUri,
} from "./SearchTypes";

// TypeColorManager
export {
  TypeColorManager,
  createTypeColorManager,
  DEFAULT_TYPE_COLOR_MANAGER_CONFIG,
} from "./TypeColorManager";
export type {
  TypeColorManagerConfig,
  OntologyInfo,
} from "./TypeColorManager";

// SearchManager
export {
  SearchManager,
  createSearchManager,
  DEFAULT_SEARCH_MANAGER_CONFIG,
} from "./SearchManager";
export type {
  SearchManagerConfig,
} from "./SearchManager";

// React Components
export { SearchBox, SearchButton } from "./SearchBox";
export type { SearchBoxProps, SearchButtonProps } from "./SearchBox";

export { ColorLegend } from "./ColorLegend";
export type { ColorLegendProps } from "./ColorLegend";

export { ColorPickerModal } from "./ColorPickerModal";
export type { ColorPickerModalProps } from "./ColorPickerModal";
