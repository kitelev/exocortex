/**
 * ColorLegend Component
 *
 * Displays a visual legend of node types with their colors, icons, and counts.
 * Features:
 * - Collapsible legend panel
 * - Type visibility toggling
 * - Inline color customization
 * - Palette switching
 * - Export/import configuration
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

import React, { useState, useCallback, useMemo } from "react";
import type { LegendItem, LegendState, ColorPalette, NodeShape } from "./SearchTypes";
import { BUILT_IN_PALETTES } from "./SearchTypes";

/**
 * Props for ColorLegend component
 */
export interface ColorLegendProps {
  /** Current legend state */
  legendState: LegendState;
  /** Available color palettes */
  palettes?: ColorPalette[];
  /** Callback when a type's color is clicked for editing */
  onColorClick?: (typeUri: string, color: string, position: { x: number; y: number }) => void;
  /** Callback when a type's visibility is toggled */
  onVisibilityToggle?: (typeUri: string) => void;
  /** Callback when palette changes */
  onPaletteChange?: (paletteId: string) => void;
  /** Callback to reset a type's color */
  onColorReset?: (typeUri: string) => void;
  /** Callback to export configuration */
  onExport?: () => void;
  /** Callback to import configuration */
  onImport?: (config: string) => void;
  /** Whether legend is collapsed */
  isCollapsed?: boolean;
  /** Callback when collapse state changes */
  onToggleCollapse?: () => void;
  /** Custom CSS class */
  className?: string;
  /** Maximum height before scrolling */
  maxHeight?: number;
}

/**
 * Render a shape indicator SVG
 */
function ShapeIndicator({
  shape,
  color,
  size = 16,
}: {
  shape?: NodeShape;
  color: string;
  size?: number;
}): React.ReactElement {
  const halfSize = size / 2;
  const style = { fill: color };

  switch (shape) {
    case "rect":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <rect
            x={size * 0.15}
            y={size * 0.15}
            width={size * 0.7}
            height={size * 0.7}
            style={style}
          />
        </svg>
      );

    case "roundedRect":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <rect
            x={size * 0.15}
            y={size * 0.15}
            width={size * 0.7}
            height={size * 0.7}
            rx={size * 0.1}
            style={style}
          />
        </svg>
      );

    case "diamond":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={`${halfSize},${size * 0.1} ${size * 0.9},${halfSize} ${halfSize},${size * 0.9} ${size * 0.1},${halfSize}`}
            style={style}
          />
        </svg>
      );

    case "hexagon": {
      const points = Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const x = halfSize + halfSize * 0.8 * Math.cos(angle);
        const y = halfSize + halfSize * 0.8 * Math.sin(angle);
        return `${x},${y}`;
      }).join(" ");
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon points={points} style={style} />
        </svg>
      );
    }

    case "triangle":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={`${halfSize},${size * 0.1} ${size * 0.9},${size * 0.9} ${size * 0.1},${size * 0.9}`}
            style={style}
          />
        </svg>
      );

    case "circle":
    default:
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={halfSize} cy={halfSize} r={halfSize * 0.8} style={style} />
        </svg>
      );
  }
}

/**
 * ColorLegend - Visual legend for node type colors
 */
export function ColorLegend({
  legendState,
  palettes = BUILT_IN_PALETTES,
  onColorClick,
  onVisibilityToggle,
  onPaletteChange,
  onColorReset,
  onExport,
  onImport,
  isCollapsed = false,
  onToggleCollapse,
  className = "",
  maxHeight = 300,
}: ColorLegendProps): React.ReactElement {
  const [showPaletteSelector, setShowPaletteSelector] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importValue, setImportValue] = useState("");

  // Get current palette
  const currentPalette = useMemo(
    () => palettes.find((p) => p.id === legendState.paletteId) || palettes[0],
    [palettes, legendState.paletteId]
  );

  // Calculate totals
  const totalCount = useMemo(
    () => legendState.items.reduce((sum, item) => sum + item.count, 0),
    [legendState.items]
  );

  const visibleCount = useMemo(
    () =>
      legendState.items
        .filter((item) => item.visible)
        .reduce((sum, item) => sum + item.count, 0),
    [legendState.items]
  );

  // Handle color click
  const handleColorClick = useCallback(
    (item: LegendItem, e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      onColorClick?.(item.typeUri, item.color, {
        x: rect.right + 8,
        y: rect.top,
      });
    },
    [onColorClick]
  );

  // Handle visibility toggle
  const handleVisibilityToggle = useCallback(
    (item: LegendItem, e: React.MouseEvent) => {
      e.stopPropagation();
      onVisibilityToggle?.(item.typeUri);
    },
    [onVisibilityToggle]
  );

  // Handle palette change
  const handlePaletteChange = useCallback(
    (paletteId: string) => {
      onPaletteChange?.(paletteId);
      setShowPaletteSelector(false);
    },
    [onPaletteChange]
  );

  // Handle import
  const handleImport = useCallback(() => {
    if (importValue.trim()) {
      onImport?.(importValue);
      setImportValue("");
      setShowImportDialog(false);
    }
  }, [importValue, onImport]);

  // Collapsed state
  if (isCollapsed) {
    return (
      <button
        type="button"
        className={`exo-color-legend exo-color-legend--collapsed ${className}`}
        onClick={onToggleCollapse}
        title="Expand legend"
        aria-label="Expand color legend"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </svg>
        <span className="exo-color-legend__collapsed-label">
          {legendState.items.length} types
        </span>
      </button>
    );
  }

  return (
    <div className={`exo-color-legend ${className}`}>
      {/* Header */}
      <div className="exo-color-legend__header">
        <h4 className="exo-color-legend__title">Node Types</h4>
        <div className="exo-color-legend__actions">
          {/* Palette selector button */}
          <button
            type="button"
            className="exo-color-legend__action-btn"
            onClick={() => setShowPaletteSelector(!showPaletteSelector)}
            title="Change color palette"
            aria-label="Change color palette"
            aria-expanded={showPaletteSelector}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>

          {/* Export button */}
          {onExport && (
            <button
              type="button"
              className="exo-color-legend__action-btn"
              onClick={onExport}
              title="Export colors"
              aria-label="Export color configuration"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
          )}

          {/* Import button */}
          {onImport && (
            <button
              type="button"
              className="exo-color-legend__action-btn"
              onClick={() => setShowImportDialog(!showImportDialog)}
              title="Import colors"
              aria-label="Import color configuration"
              aria-expanded={showImportDialog}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}

          {/* Collapse button */}
          {onToggleCollapse && (
            <button
              type="button"
              className="exo-color-legend__action-btn"
              onClick={onToggleCollapse}
              title="Collapse legend"
              aria-label="Collapse color legend"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Palette selector dropdown */}
      {showPaletteSelector && (
        <div className="exo-color-legend__palette-selector">
          {palettes.map((palette) => (
            <button
              key={palette.id}
              type="button"
              className={`exo-color-legend__palette-option ${palette.id === currentPalette.id ? "exo-color-legend__palette-option--active" : ""}`}
              onClick={() => handlePaletteChange(palette.id)}
            >
              <div className="exo-color-legend__palette-preview">
                {palette.colors.slice(0, 6).map((color, i) => (
                  <span
                    key={i}
                    className="exo-color-legend__palette-swatch"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <span className="exo-color-legend__palette-name">
                {palette.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Import dialog */}
      {showImportDialog && (
        <div className="exo-color-legend__import-dialog">
          <textarea
            className="exo-color-legend__import-input"
            value={importValue}
            onChange={(e) => setImportValue(e.target.value)}
            placeholder="Paste color configuration JSON..."
            rows={4}
          />
          <div className="exo-color-legend__import-actions">
            <button
              type="button"
              className="exo-color-legend__import-btn exo-color-legend__import-btn--cancel"
              onClick={() => {
                setShowImportDialog(false);
                setImportValue("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="exo-color-legend__import-btn exo-color-legend__import-btn--confirm"
              onClick={handleImport}
              disabled={!importValue.trim()}
            >
              Import
            </button>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="exo-color-legend__stats">
        <span>
          {visibleCount === totalCount
            ? `${totalCount} nodes`
            : `${visibleCount}/${totalCount} nodes`}
        </span>
        <span className="exo-color-legend__stats-sep">•</span>
        <span>{legendState.items.length} types</span>
      </div>

      {/* Legend items */}
      <div
        className="exo-color-legend__items"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {legendState.items.length === 0 ? (
          <div className="exo-color-legend__empty">No node types found</div>
        ) : (
          legendState.items.map((item) => (
            <div
              key={item.typeUri}
              className={`exo-color-legend__item ${item.visible ? "" : "exo-color-legend__item--hidden"}`}
            >
              {/* Visibility checkbox */}
              <button
                type="button"
                className="exo-color-legend__visibility-btn"
                onClick={(e) => handleVisibilityToggle(item, e)}
                title={item.visible ? "Hide this type" : "Show this type"}
                aria-label={`${item.visible ? "Hide" : "Show"} ${item.displayName}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {item.visible ? (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  )}
                </svg>
              </button>

              {/* Color/shape indicator (clickable) */}
              <button
                type="button"
                className="exo-color-legend__color-btn"
                onClick={(e) => handleColorClick(item, e)}
                title="Click to change color"
                aria-label={`Change color for ${item.displayName}`}
              >
                <ShapeIndicator shape={item.shape} color={item.color} size={18} />
              </button>

              {/* Icon (if any) */}
              {item.icon && (
                <span className="exo-color-legend__icon">{item.icon}</span>
              )}

              {/* Type name */}
              <span className="exo-color-legend__name">{item.displayName}</span>

              {/* Count */}
              <span className="exo-color-legend__count">{item.count}</span>

              {/* Reset button (if custom color) */}
              {legendState.customColors.has(item.typeUri) && onColorReset && (
                <button
                  type="button"
                  className="exo-color-legend__reset-btn"
                  onClick={() => onColorReset(item.typeUri)}
                  title="Reset to default color"
                  aria-label={`Reset color for ${item.displayName}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
