import React, { useState, useRef, useEffect } from "react";
import {
  parseLocalDate,
  formatForInput,
  formatDisplayValue,
  formatToLocalTimestamp,
} from '@plugin/presentation/utils/dateTimeUtils';

export interface DateTimePropertyFieldProps {
  value: string | null;
  onChange: (newValue: string | null) => void;
  onBlur?: () => void;
}

export const DateTimePropertyField: React.FC<DateTimePropertyFieldProps> = ({
  value,
  onChange,
  onBlur,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearClickedRef = useRef(false);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      if (value) {
        const formatted = formatForInput(value);
        setTextInput(formatted);
      } else {
        setTextInput("");
      }
      setError(null);
    }
  }, [isOpen, value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        onBlur?.();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onBlur]);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    setTextInput(input);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setError(null);
      onBlur?.();
    }
  };

  const handleSubmit = () => {
    if (!textInput.trim()) {
      onChange(null);
      setIsOpen(false);
      onBlur?.();
      return;
    }

    const parsed = parseLocalDate(textInput);

    if (parsed) {
      // Store as local timestamp (without Z suffix) for consistency with the rest of codebase
      // This avoids timezone conversion issues when the value is later parsed
      onChange(formatToLocalTimestamp(parsed));
      setIsOpen(false);
      setError(null);
      onBlur?.();
    } else {
      setError("Invalid date format. Try: YYYY-MM-DD, tomorrow, next week");
    }
  };

  const handleBlur = () => {
    // Skip submission if Clear button was clicked
    if (clearClickedRef.current) {
      clearClickedRef.current = false;
      return;
    }
    handleSubmit();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearClickedRef.current = true;
    onChange(null);
    setIsOpen(false);
    onBlur?.();
  };

  return (
    <div className="exocortex-property-datetime-container">
      <div
        ref={buttonRef}
        className="exocortex-property-datetime-display clickable-icon"
        onMouseDown={handleToggle}
        style={{
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          padding: "2px 6px",
          borderRadius: "3px",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginRight: "6px", pointerEvents: "none" }}
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>{formatDisplayValue(value)}</span>
      </div>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="exocortex-property-datetime-dropdown"
          style={{
            position: "absolute",
            zIndex: 1000,
            background: "var(--background-primary)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "var(--radius-m)",
            padding: "var(--size-4-3)",
            boxShadow: "var(--shadow-s)",
            marginTop: "4px",
            minWidth: "250px",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={textInput}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="tomorrow, 2025-01-15, next week"
            className="exocortex-property-datetime-input"
            style={{
              width: "100%",
              padding: "var(--size-4-2)",
              border: error
                ? "1px solid var(--text-error)"
                : "1px solid var(--background-modifier-border)",
              borderRadius: "var(--radius-s)",
              marginBottom: "var(--size-4-2)",
              backgroundColor: "var(--background-primary)",
              color: "var(--text-normal)",
            }}
          />

          {error && (
            <div
              style={{
                color: "var(--text-error)",
                fontSize: "var(--font-smallest)",
                marginBottom: "var(--size-4-2)",
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              fontSize: "var(--font-smallest)",
              color: "var(--text-muted)",
              marginBottom: "var(--size-4-2)",
            }}
          >
            Examples: tomorrow, 2025-01-15, next week, in 3 days
          </div>

          <div style={{ display: "flex", gap: "var(--size-4-2)" }}>
            <button
              onMouseDown={handleClear}
              className="exocortex-property-datetime-clear mod-warning"
              style={{
                flex: 1,
                padding: "var(--size-4-2)",
                border: "1px solid var(--background-modifier-border)",
                borderRadius: "var(--radius-s)",
                backgroundColor: "var(--background-secondary)",
                color: "var(--text-normal)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
