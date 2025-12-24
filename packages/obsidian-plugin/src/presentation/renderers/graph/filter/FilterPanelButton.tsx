/**
 * FilterPanelButton Component
 *
 * A toolbar button that toggles the filter panel visibility.
 * Shows a badge when filters are active.
 *
 * @module presentation/renderers/graph/filter
 * @since 1.0.0
 */

import React from "react";

/**
 * Props for FilterPanelButton
 */
export interface FilterPanelButtonProps {
  /** Whether the filter panel is currently visible */
  isActive: boolean;
  /** Number of active filters */
  activeFilterCount: number;
  /** Callback when button is clicked */
  onClick: () => void;
  /** Custom CSS class */
  className?: string;
  /** Button title/tooltip */
  title?: string;
}

/**
 * FilterPanelButton - Toolbar button for toggling filter panel
 *
 * @example
 * ```tsx
 * <FilterPanelButton
 *   isActive={isPanelVisible}
 *   activeFilterCount={3}
 *   onClick={() => togglePanel()}
 * />
 * ```
 */
export function FilterPanelButton({
  isActive,
  activeFilterCount,
  onClick,
  className = "",
  title = "Toggle filter panel",
}: FilterPanelButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      className={`exo-filter-btn ${isActive ? "exo-filter-btn--active" : ""} ${className}`}
      onClick={onClick}
      title={title}
      aria-pressed={isActive}
      aria-label={`${title}${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="exo-filter-btn__icon"
      >
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
      {activeFilterCount > 0 && (
        <span className="exo-filter-btn__badge">{activeFilterCount}</span>
      )}
    </button>
  );
}

/**
 * FilterIcon - Just the filter icon SVG
 */
export function FilterIcon({ size = 18, className = "" }: { size?: number; className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
