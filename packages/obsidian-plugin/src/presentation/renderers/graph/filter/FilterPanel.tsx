/**
 * FilterPanel Component
 *
 * Provides a UI for managing graph filters including:
 * - Node type filters with counts
 * - Edge type filters with counts
 * - Quick toggle controls
 * - Filter presets
 *
 * @module presentation/renderers/graph/filter
 * @since 1.0.0
 */

import React, { useState, useCallback, useMemo } from "react";
import type { GraphFilter, TypeFilter, PredicateFilter, TypeCounts, FilterPanelConfig } from "./FilterTypes";
import { createTypeFilter, createPredicateFilter, generateFilterId, DEFAULT_FILTER_PANEL_CONFIG } from "./FilterTypes";

/**
 * Props for FilterPanel component
 */
export interface FilterPanelProps {
  /** All unique node types in the graph */
  nodeTypes: string[];
  /** All unique edge types in the graph */
  edgeTypes: string[];
  /** Type counts for display */
  typeCounts: TypeCounts;
  /** Currently active filters */
  activeFilters: GraphFilter[];
  /** Currently visible node types (from simple filter state) */
  visibleNodeTypes: Set<string>;
  /** Currently visible edge types (from simple filter state) */
  visibleEdgeTypes: Set<string>;
  /** Callback when a filter is added */
  onAddFilter?: (filter: GraphFilter) => void;
  /** Callback when a filter is removed */
  onRemoveFilter?: (filterId: string) => void;
  /** Callback when a filter is toggled */
  onToggleFilter?: (filterId: string) => void;
  /** Callback when all filters are cleared */
  onClearFilters?: () => void;
  /** Callback when a node type is toggled (simple filter mode) */
  onToggleNodeType?: (type: string) => void;
  /** Callback when an edge type is toggled (simple filter mode) */
  onToggleEdgeType?: (type: string) => void;
  /** Callback when filters are reset */
  onResetFilters?: () => void;
  /** Panel configuration */
  config?: FilterPanelConfig;
  /** Custom CSS class */
  className?: string;
  /** Whether the panel is collapsed */
  isCollapsed?: boolean;
  /** Callback when collapse state changes */
  onToggleCollapse?: () => void;
}

/**
 * Format type name for display
 * Converts "ems__Task" to "Task"
 */
function formatTypeName(typeName: string): string {
  // Remove namespace prefix (e.g., "ems__" or "exo__")
  const parts = typeName.split("__");
  const name = parts[parts.length - 1];
  // Convert camelCase or PascalCase to Title Case
  return name.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Get color for a type (deterministic based on type name)
 */
function getTypeColor(typeName: string): string {
  const colors = [
    "var(--color-blue)",
    "var(--color-green)",
    "var(--color-yellow)",
    "var(--color-orange)",
    "var(--color-red)",
    "var(--color-purple)",
    "var(--color-pink)",
    "var(--color-cyan)",
  ];
  // Simple hash to get consistent color
  let hash = 0;
  for (let i = 0; i < typeName.length; i++) {
    hash = typeName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * FilterPanel - Interactive panel for managing graph filters
 */
export function FilterPanel({
  nodeTypes,
  edgeTypes,
  typeCounts,
  activeFilters,
  visibleNodeTypes,
  visibleEdgeTypes,
  onAddFilter,
  onRemoveFilter,
  onToggleFilter,
  onClearFilters,
  onToggleNodeType,
  onToggleEdgeType,
  onResetFilters,
  config = DEFAULT_FILTER_PANEL_CONFIG,
  className = "",
  isCollapsed = false,
  onToggleCollapse,
}: FilterPanelProps): React.ReactElement {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["nodeTypes", "edgeTypes"])
  );

  // Toggle section expansion
  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return visibleNodeTypes.size > 0 || visibleEdgeTypes.size > 0 || activeFilters.length > 0;
  }, [visibleNodeTypes, visibleEdgeTypes, activeFilters]);

  // Calculate total filtered vs total
  const stats = useMemo(() => {
    let totalNodes = 0;
    let totalEdges = 0;
    for (const count of typeCounts.nodeTypes.values()) {
      totalNodes += count;
    }
    for (const count of typeCounts.edgeTypes.values()) {
      totalEdges += count;
    }
    return { totalNodes, totalEdges };
  }, [typeCounts]);

  // Handle node type checkbox change
  const handleNodeTypeToggle = useCallback(
    (type: string) => {
      onToggleNodeType?.(type);
    },
    [onToggleNodeType]
  );

  // Handle edge type checkbox change
  const handleEdgeTypeToggle = useCallback(
    (type: string) => {
      onToggleEdgeType?.(type);
    },
    [onToggleEdgeType]
  );

  // Handle show all node types
  const handleShowAllNodeTypes = useCallback(() => {
    // Clear node type filters by resetting
    onResetFilters?.();
  }, [onResetFilters]);

  if (isCollapsed) {
    return (
      <div
        className={`exo-filter-panel exo-filter-panel--collapsed ${className}`}
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onToggleCollapse?.();
          }
        }}
      >
        <div className="exo-filter-panel__collapsed-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z" />
          </svg>
          {hasActiveFilters && <span className="exo-filter-panel__badge">{activeFilters.length || (visibleNodeTypes.size + visibleEdgeTypes.size)}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`exo-filter-panel ${className}`}>
      {/* Header */}
      <div className="exo-filter-panel__header">
        <h3 className="exo-filter-panel__title">Filters</h3>
        <div className="exo-filter-panel__actions">
          {hasActiveFilters && (
            <button
              type="button"
              className="exo-filter-panel__reset-btn"
              onClick={onResetFilters}
              title="Reset all filters"
            >
              Reset
            </button>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              className="exo-filter-panel__collapse-btn"
              onClick={onToggleCollapse}
              title="Collapse panel"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13H5v-2h14v2z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="exo-filter-panel__stats">
        <span>{stats.totalNodes} nodes</span>
        <span className="exo-filter-panel__stats-separator">|</span>
        <span>{stats.totalEdges} edges</span>
      </div>

      {/* Node Types Section */}
      {config.showTypeFilters && nodeTypes.length > 0 && (
        <div className="exo-filter-panel__section">
          <button
            type="button"
            className="exo-filter-panel__section-header"
            onClick={() => toggleSection("nodeTypes")}
            aria-expanded={expandedSections.has("nodeTypes")}
          >
            <svg
              className={`exo-filter-panel__chevron ${expandedSections.has("nodeTypes") ? "exo-filter-panel__chevron--expanded" : ""}`}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
            >
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            </svg>
            <span className="exo-filter-panel__section-title">Node Types</span>
            <span className="exo-filter-panel__section-count">
              {visibleNodeTypes.size > 0 ? `${visibleNodeTypes.size}/${nodeTypes.length}` : nodeTypes.length}
            </span>
          </button>

          {expandedSections.has("nodeTypes") && (
            <div className="exo-filter-panel__section-content">
              {/* Quick actions */}
              <div className="exo-filter-panel__quick-actions">
                <button
                  type="button"
                  className="exo-filter-panel__quick-btn"
                  onClick={handleShowAllNodeTypes}
                >
                  Show All
                </button>
              </div>

              {/* Type list */}
              <div className="exo-filter-panel__type-list">
                {nodeTypes.map((type) => {
                  const count = typeCounts.nodeTypes.get(type) ?? 0;
                  const isVisible = visibleNodeTypes.size === 0 || visibleNodeTypes.has(type);

                  return (
                    <label
                      key={type}
                      className={`exo-filter-panel__type-item ${isVisible ? "" : "exo-filter-panel__type-item--hidden"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => handleNodeTypeToggle(type)}
                        className="exo-filter-panel__checkbox"
                      />
                      <span
                        className="exo-filter-panel__type-indicator"
                        style={{ backgroundColor: getTypeColor(type) }}
                      />
                      <span className="exo-filter-panel__type-name">
                        {formatTypeName(type)}
                      </span>
                      <span className="exo-filter-panel__type-count">{count}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edge Types Section */}
      {config.showPredicateFilters && edgeTypes.length > 0 && (
        <div className="exo-filter-panel__section">
          <button
            type="button"
            className="exo-filter-panel__section-header"
            onClick={() => toggleSection("edgeTypes")}
            aria-expanded={expandedSections.has("edgeTypes")}
          >
            <svg
              className={`exo-filter-panel__chevron ${expandedSections.has("edgeTypes") ? "exo-filter-panel__chevron--expanded" : ""}`}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
            >
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            </svg>
            <span className="exo-filter-panel__section-title">Edge Types</span>
            <span className="exo-filter-panel__section-count">
              {visibleEdgeTypes.size > 0 ? `${visibleEdgeTypes.size}/${edgeTypes.length}` : edgeTypes.length}
            </span>
          </button>

          {expandedSections.has("edgeTypes") && (
            <div className="exo-filter-panel__section-content">
              {/* Type list */}
              <div className="exo-filter-panel__type-list">
                {edgeTypes.map((type) => {
                  const count = typeCounts.edgeTypes.get(type) ?? 0;
                  const isVisible = visibleEdgeTypes.size === 0 || visibleEdgeTypes.has(type);

                  return (
                    <label
                      key={type}
                      className={`exo-filter-panel__type-item ${isVisible ? "" : "exo-filter-panel__type-item--hidden"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => handleEdgeTypeToggle(type)}
                        className="exo-filter-panel__checkbox"
                      />
                      <span
                        className="exo-filter-panel__type-indicator exo-filter-panel__type-indicator--edge"
                        style={{ backgroundColor: getTypeColor(type) }}
                      />
                      <span className="exo-filter-panel__type-name">
                        {formatTypeName(type)}
                      </span>
                      <span className="exo-filter-panel__type-count">{count}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Filters Section */}
      {activeFilters.length > 0 && (
        <div className="exo-filter-panel__section">
          <button
            type="button"
            className="exo-filter-panel__section-header"
            onClick={() => toggleSection("activeFilters")}
            aria-expanded={expandedSections.has("activeFilters")}
          >
            <svg
              className={`exo-filter-panel__chevron ${expandedSections.has("activeFilters") ? "exo-filter-panel__chevron--expanded" : ""}`}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
            >
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            </svg>
            <span className="exo-filter-panel__section-title">Active Filters</span>
            <span className="exo-filter-panel__section-count">{activeFilters.length}</span>
          </button>

          {expandedSections.has("activeFilters") && (
            <div className="exo-filter-panel__section-content">
              <div className="exo-filter-panel__filter-list">
                {activeFilters.map((filter) => (
                  <div
                    key={filter.id}
                    className={`exo-filter-panel__filter-item ${filter.enabled ? "" : "exo-filter-panel__filter-item--disabled"}`}
                  >
                    <button
                      type="button"
                      className="exo-filter-panel__filter-toggle"
                      onClick={() => onToggleFilter?.(filter.id)}
                      title={filter.enabled ? "Disable filter" : "Enable filter"}
                    >
                      {filter.enabled ? (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                        </svg>
                      )}
                    </button>
                    <span className="exo-filter-panel__filter-type">{filter.type}</span>
                    <span className="exo-filter-panel__filter-desc">
                      {getFilterDescription(filter)}
                    </span>
                    <button
                      type="button"
                      className="exo-filter-panel__filter-remove"
                      onClick={() => onRemoveFilter?.(filter.id)}
                      title="Remove filter"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="exo-filter-panel__clear-btn"
                onClick={onClearFilters}
              >
                Clear All Filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Presets Section */}
      {config.showPresets && (
        <div className="exo-filter-panel__section">
          <button
            type="button"
            className="exo-filter-panel__section-header"
            onClick={() => toggleSection("presets")}
            aria-expanded={expandedSections.has("presets")}
          >
            <svg
              className={`exo-filter-panel__chevron ${expandedSections.has("presets") ? "exo-filter-panel__chevron--expanded" : ""}`}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
            >
              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
            </svg>
            <span className="exo-filter-panel__section-title">Quick Filters</span>
          </button>

          {expandedSections.has("presets") && (
            <div className="exo-filter-panel__section-content">
              <div className="exo-filter-panel__preset-list">
                <button
                  type="button"
                  className="exo-filter-panel__preset-btn"
                  onClick={() => {
                    onAddFilter?.(createTypeFilter(
                      generateFilterId("preset"),
                      ["ems__Task"],
                      true,
                      false
                    ));
                  }}
                >
                  Show Tasks Only
                </button>
                <button
                  type="button"
                  className="exo-filter-panel__preset-btn"
                  onClick={() => {
                    onAddFilter?.(createTypeFilter(
                      generateFilterId("preset"),
                      ["ems__Project"],
                      true,
                      false
                    ));
                  }}
                >
                  Show Projects Only
                </button>
                <button
                  type="button"
                  className="exo-filter-panel__preset-btn"
                  onClick={() => {
                    onAddFilter?.(createPredicateFilter(
                      generateFilterId("preset"),
                      ["hierarchy"],
                      true,
                      "both"
                    ));
                  }}
                >
                  Hierarchy Only
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Get human-readable description for a filter
 */
function getFilterDescription(filter: GraphFilter): string {
  switch (filter.type) {
    case "type": {
      const f = filter as TypeFilter;
      const action = f.include ? "Show" : "Hide";
      return `${action} ${f.typeUris.map(formatTypeName).join(", ")}`;
    }
    case "predicate": {
      const f = filter as PredicateFilter;
      const action = f.include ? "Show" : "Hide";
      return `${action} ${f.predicateUris.map(formatTypeName).join(", ")}`;
    }
    case "literal":
      return `Property filter`;
    case "path":
      return `Path from node (${filter.maxDistance} hops)`;
    case "sparql":
      return filter.name;
    case "composite":
      return `${filter.operator} (${filter.filters.length} filters)`;
    default:
      return "Filter";
  }
}
