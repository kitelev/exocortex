/**
 * TextRenderer - Renders plain text cell values
 */
import React, { useState, useRef, useEffect } from "react";
import type { CellRendererProps } from "./types";

/**
 * Renders a plain text cell value.
 * Supports inline editing when column.editable is true.
 */
export const TextRenderer: React.FC<CellRendererProps> = ({
  value,
  column,
  onChange,
  isEditing,
  onBlur,
}) => {
  const [localValue, setLocalValue] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setLocalValue(String(value ?? ""));
  }, [value]);

  if (isEditing && column.editable) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="exo-cell-input exo-cell-input-text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== String(value ?? "")) {
            onChange?.(localValue);
          }
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (localValue !== String(value ?? "")) {
              onChange?.(localValue);
            }
            onBlur?.();
          } else if (e.key === "Escape") {
            setLocalValue(String(value ?? ""));
            onBlur?.();
          }
        }}
      />
    );
  }

  const displayValue = value != null && value !== "" ? String(value) : "-";
  const isEmpty = displayValue === "-";

  return (
    <span className={`exo-cell-text${isEmpty ? " exo-cell-text-empty" : ""}`}>
      {displayValue}
    </span>
  );
};
