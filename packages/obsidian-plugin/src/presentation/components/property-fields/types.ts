import type { PropertyDefinition } from "exocortex";
import type { App } from "obsidian";

/**
 * Base props for all property field renderers (without value and onChange).
 * Provides common functionality for rendering property fields in forms.
 */
export interface PropertyFieldBaseProps {
  /** Property definition from ontology */
  property: PropertyDefinition;
  /** Optional validation error message */
  error?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Obsidian App instance for vault access (needed for autocomplete) */
  app?: App;
}

/**
 * Props for text property field renderer.
 */
export interface TextPropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for date property field renderer (date-only, no time).
 */
export interface DatePropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for datetime property field renderer.
 */
export interface DateTimePropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for number property field renderer.
 */
export interface NumberPropertyFieldProps extends PropertyFieldBaseProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

/**
 * Props for boolean property field renderer.
 */
export interface BooleanPropertyFieldProps extends PropertyFieldBaseProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

/**
 * Props for reference property field renderer with autocomplete.
 */
export interface ReferencePropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
  /** Obsidian App instance for vault file lookup */
  app: App;
  /** Optional filter for asset classes to suggest */
  classFilter?: string[];
  /** Whether to boost active assets in suggestions (default: true) */
  boostActiveAssets?: boolean;
  /** Property range type for smart filtering (e.g., "ems__Project") */
  rangeType?: string;
}

/**
 * Props for enum property field renderer (dropdown with fixed values).
 */
export interface EnumPropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for status select property field renderer.
 */
export interface StatusSelectPropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for size select property field renderer.
 */
export interface SizeSelectPropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for wikilink property field renderer.
 */
export interface WikilinkPropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Props for timestamp property field renderer (read-only display).
 */
export interface TimestampPropertyFieldProps extends PropertyFieldBaseProps {
  value: string;
}

/**
 * Union type of all property field props.
 */
export type PropertyFieldProps =
  | TextPropertyFieldProps
  | DatePropertyFieldProps
  | DateTimePropertyFieldProps
  | NumberPropertyFieldProps
  | BooleanPropertyFieldProps
  | ReferencePropertyFieldProps
  | EnumPropertyFieldProps
  | StatusSelectPropertyFieldProps
  | SizeSelectPropertyFieldProps
  | WikilinkPropertyFieldProps
  | TimestampPropertyFieldProps;

/**
 * Validation result for property field values.
 */
export interface ValidationResult {
  /** Whether the value is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Validator function type for property field values.
 */
export type PropertyFieldValidator = (
  value: unknown,
  property: PropertyDefinition,
) => ValidationResult;
