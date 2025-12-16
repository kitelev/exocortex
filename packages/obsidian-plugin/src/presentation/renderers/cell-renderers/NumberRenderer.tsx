/**
 * NumberRenderer - Renders numeric cell values with formatting
 */
import React, { useState, useRef, useEffect } from "react";
import type { CellRendererProps } from "./types";

/**
 * Parse a value into a number.
 */
function parseNumber(value: unknown): number | null {
  if (value == null) return null;

  if (typeof value === "number") {
    return isNaN(value) ? null : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Remove thousand separators and parse
    const normalized = trimmed.replace(/,/g, "");
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  }

  return null;
}

/**
 * Format a number for display.
 */
function formatNumber(num: number): string {
  // Use Intl.NumberFormat for locale-aware formatting
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Renders a cell value as a formatted number.
 * Supports inline editing when column.editable is true.
 */
export const NumberRenderer: React.FC<CellRendererProps> = ({
  value,
  column,
  onChange,
  isEditing,
  onBlur,
}) => {
  const numValue = parseNumber(value);
  const [localValue, setLocalValue] = useState(
    numValue != null ? String(numValue) : ""
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setLocalValue(numValue != null ? String(numValue) : "");
  }, [numValue]);

  if (isEditing && column.editable) {
    return (
      <input
        ref={inputRef}
        type="number"
        className="exo-cell-input exo-cell-input-number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          const newNum = parseNumber(localValue);
          if (newNum !== numValue) {
            onChange?.(newNum);
          }
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const newNum = parseNumber(localValue);
            if (newNum !== numValue) {
              onChange?.(newNum);
            }
            onBlur?.();
          } else if (e.key === "Escape") {
            setLocalValue(numValue != null ? String(numValue) : "");
            onBlur?.();
          }
        }}
      />
    );
  }

  if (numValue == null) {
    return <span className="exo-cell-number exo-cell-number-empty">-</span>;
  }

  const formatted = formatNumber(numValue);

  return (
    <span className="exo-cell-number" title={String(numValue)}>
      {formatted}
    </span>
  );
};
