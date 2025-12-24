/**
 * ColorPickerModal Component
 *
 * Provides a color picker popup for customizing node type colors.
 * Features:
 * - Preset color swatches from current palette
 * - Custom hex color input
 * - Live preview
 * - Reset to default option
 *
 * @module presentation/renderers/graph/search
 * @since 1.0.0
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import type { ColorPalette } from "./SearchTypes";
import { BUILT_IN_PALETTES, calculateContrastRatio } from "./SearchTypes";

/**
 * Props for ColorPickerModal component
 */
export interface ColorPickerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Type URI being edited */
  typeUri: string | null;
  /** Display name of the type */
  typeName?: string;
  /** Current color value */
  currentColor: string;
  /** Position for the modal */
  position: { x: number; y: number };
  /** Current palette for presets */
  palette?: ColorPalette;
  /** Callback when color changes */
  onColorChange: (color: string) => void;
  /** Callback to reset color */
  onReset?: () => void;
  /** Callback when modal closes */
  onClose: () => void;
  /** Background color for contrast checking */
  backgroundColor?: string;
}

/**
 * Common colors for quick selection
 */
const COMMON_COLORS: string[] = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#eab308", // Yellow
  "#84cc16", // Lime
  "#22c55e", // Green
  "#10b981", // Emerald
  "#14b8a6", // Teal
  "#06b6d4", // Cyan
  "#0ea5e9", // Sky
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#a855f7", // Purple
  "#d946ef", // Fuchsia
  "#ec4899", // Pink
  "#f43f5e", // Rose
  "#64748b", // Slate
  "#6b7280", // Gray
  "#000000", // Black
];

/**
 * Validate hex color string
 */
function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{6})$/.test(color);
}

/**
 * ColorPickerModal - Inline color picker for type customization
 */
export function ColorPickerModal({
  isOpen,
  typeUri,
  typeName,
  currentColor,
  position,
  palette = BUILT_IN_PALETTES[0],
  onColorChange,
  onReset,
  onClose,
  backgroundColor = "#1e1e1e",
}: ColorPickerModalProps): React.ReactElement | null {
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localColor, setLocalColor] = useState(currentColor);
  const [inputValue, setInputValue] = useState(currentColor);
  const [isValidInput, setIsValidInput] = useState(true);

  // Sync local state when props change
  useEffect(() => {
    setLocalColor(currentColor);
    setInputValue(currentColor);
    setIsValidInput(true);
  }, [currentColor, typeUri]);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Handle preset color click
  const handlePresetClick = useCallback(
    (color: string) => {
      setLocalColor(color);
      setInputValue(color);
      setIsValidInput(true);
      onColorChange(color);
    },
    [onColorChange]
  );

  // Handle input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let value = e.target.value;

      // Add # if missing
      if (value && !value.startsWith("#")) {
        value = "#" + value;
      }

      setInputValue(value);

      if (isValidHexColor(value)) {
        setIsValidInput(true);
        setLocalColor(value);
        onColorChange(value);
      } else {
        setIsValidInput(value.length <= 7); // Show error only when length exceeds max
      }
    },
    [onColorChange]
  );

  // Handle form submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (isValidHexColor(inputValue)) {
        onColorChange(inputValue);
        onClose();
      }
    },
    [inputValue, onColorChange, onClose]
  );

  // Calculate contrast ratio
  const contrastRatio = calculateContrastRatio(localColor, backgroundColor);
  const hasGoodContrast = contrastRatio >= 3;

  if (!isOpen || !typeUri) {
    return null;
  }

  // Calculate modal position (ensure it stays in viewport)
  const modalStyle: React.CSSProperties = {
    position: "absolute",
    left: `${position.x}px`,
    top: `${position.y}px`,
    zIndex: 1000,
  };

  return (
    <div
      ref={modalRef}
      className="exo-color-picker"
      style={modalStyle}
      role="dialog"
      aria-label={`Choose color for ${typeName || typeUri}`}
    >
      {/* Header */}
      <div className="exo-color-picker__header">
        <span className="exo-color-picker__title">
          {typeName || typeUri}
        </span>
        <button
          type="button"
          className="exo-color-picker__close-btn"
          onClick={onClose}
          aria-label="Close color picker"
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Preview */}
      <div className="exo-color-picker__preview">
        <div
          className="exo-color-picker__preview-swatch"
          style={{ backgroundColor: localColor }}
        />
        <div className="exo-color-picker__preview-info">
          <span className="exo-color-picker__preview-color">{localColor}</span>
          <span
            className={`exo-color-picker__contrast ${hasGoodContrast ? "exo-color-picker__contrast--good" : "exo-color-picker__contrast--poor"}`}
          >
            Contrast: {contrastRatio.toFixed(1)}:1
            {hasGoodContrast ? " ✓" : " ⚠"}
          </span>
        </div>
      </div>

      {/* Palette colors */}
      <div className="exo-color-picker__section">
        <span className="exo-color-picker__section-title">
          {palette.name} Palette
        </span>
        <div className="exo-color-picker__swatches">
          {palette.colors.map((color) => (
            <button
              key={color}
              type="button"
              className={`exo-color-picker__swatch ${color === localColor ? "exo-color-picker__swatch--selected" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => handlePresetClick(color)}
              title={color}
              aria-label={`Select ${color}`}
            />
          ))}
        </div>
      </div>

      {/* Common colors */}
      <div className="exo-color-picker__section">
        <span className="exo-color-picker__section-title">Common Colors</span>
        <div className="exo-color-picker__swatches">
          {COMMON_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`exo-color-picker__swatch ${color === localColor ? "exo-color-picker__swatch--selected" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => handlePresetClick(color)}
              title={color}
              aria-label={`Select ${color}`}
            />
          ))}
        </div>
      </div>

      {/* Custom color input */}
      <form className="exo-color-picker__custom" onSubmit={handleSubmit}>
        <label className="exo-color-picker__input-label">
          Custom Color
          <div className="exo-color-picker__input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className={`exo-color-picker__input ${isValidInput ? "" : "exo-color-picker__input--invalid"}`}
              value={inputValue}
              onChange={handleInputChange}
              placeholder="#000000"
              maxLength={7}
              aria-label="Custom hex color"
            />
            <input
              type="color"
              className="exo-color-picker__native-picker"
              value={localColor}
              onChange={(e) => handlePresetClick(e.target.value)}
              aria-label="Native color picker"
            />
          </div>
        </label>
        {!isValidInput && (
          <span className="exo-color-picker__error">
            Enter a valid hex color (e.g., #3b82f6)
          </span>
        )}
      </form>

      {/* Actions */}
      <div className="exo-color-picker__actions">
        {onReset && (
          <button
            type="button"
            className="exo-color-picker__btn exo-color-picker__btn--reset"
            onClick={() => {
              onReset();
              onClose();
            }}
          >
            Reset to Default
          </button>
        )}
        <button
          type="button"
          className="exo-color-picker__btn exo-color-picker__btn--apply"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}
