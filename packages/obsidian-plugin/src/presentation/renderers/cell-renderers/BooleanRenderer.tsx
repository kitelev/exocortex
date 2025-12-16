/**
 * BooleanRenderer - Renders boolean cell values with visual indicators
 */
import React from "react";
import type { CellRendererProps } from "./types";

/**
 * Parse a value into a boolean.
 */
function parseBoolean(value: unknown): boolean | null {
  if (value == null) return null;

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true" || lower === "yes" || lower === "1" || lower === "on") {
      return true;
    }
    if (lower === "false" || lower === "no" || lower === "0" || lower === "off" || lower === "") {
      return false;
    }
    return null;
  }

  return null;
}

/**
 * Renders a cell value as a boolean indicator.
 * Supports inline editing when column.editable is true.
 */
export const BooleanRenderer: React.FC<CellRendererProps> = ({
  value,
  column,
  onChange,
  isEditing,
}) => {
  const boolValue = parseBoolean(value);

  // Unknown/null value
  if (boolValue == null) {
    return <span className="exo-cell-boolean exo-cell-boolean-unknown">-</span>;
  }

  // Editable mode - show checkbox
  if (column.editable && (isEditing || onChange)) {
    return (
      <label className="exo-cell-boolean exo-cell-boolean-editable">
        <input
          type="checkbox"
          checked={boolValue}
          onChange={(e) => {
            onChange?.(e.target.checked);
          }}
          className="exo-cell-checkbox"
        />
        <span className="exo-cell-boolean-label">
          {boolValue ? "Yes" : "No"}
        </span>
      </label>
    );
  }

  // Read-only mode - show icon
  return (
    <span
      className={`exo-cell-boolean ${boolValue ? "exo-cell-boolean-true" : "exo-cell-boolean-false"}`}
      title={boolValue ? "Yes" : "No"}
    >
      {boolValue ? "✓" : "✗"}
    </span>
  );
};
