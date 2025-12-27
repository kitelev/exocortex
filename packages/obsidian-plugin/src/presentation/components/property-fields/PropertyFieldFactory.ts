import { App } from "obsidian";
import { PropertyFieldType, type PropertyDefinition } from "exocortex";
import type { ValidationResult } from "./types";
import { TextPropertyField } from "./TextPropertyField";
import { DatePropertyField } from "./DatePropertyField";
import { DateTimePropertyField } from "./DateTimePropertyField";
import { NumberPropertyField } from "./NumberPropertyField";
import { BooleanPropertyField } from "./BooleanPropertyField";
import { ReferencePropertyField } from "./ReferencePropertyField";
import { EnumPropertyField } from "./EnumPropertyField";
import { StatusSelectPropertyField } from "./StatusSelectPropertyField";
import { SizeSelectPropertyField } from "./SizeSelectPropertyField";
import { WikilinkPropertyField } from "./WikilinkPropertyField";
import { TimestampPropertyField } from "./TimestampPropertyField";

/**
 * Union type of all property field instances.
 */
export type PropertyFieldInstance =
  | TextPropertyField
  | DatePropertyField
  | DateTimePropertyField
  | NumberPropertyField
  | BooleanPropertyField
  | ReferencePropertyField
  | EnumPropertyField
  | StatusSelectPropertyField
  | SizeSelectPropertyField
  | WikilinkPropertyField
  | TimestampPropertyField;

/**
 * Options for creating property fields.
 */
export interface PropertyFieldCreateOptions {
  /** Container element for the field */
  containerEl: HTMLElement;
  /** Property definition from ontology */
  property: PropertyDefinition;
  /** Current field value */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: unknown) => void;
  /** Optional validation error message */
  error?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Obsidian App instance (required for reference fields) */
  app?: App;
  /** Optional class filter for reference fields */
  classFilter?: string[];
}

/**
 * Factory for creating property field renderers.
 *
 * Maps PropertyFieldType to the appropriate field component and creates
 * instances with proper configuration.
 *
 * @example
 * ```typescript
 * const factory = new PropertyFieldFactory(this.app);
 *
 * // Create a text field
 * const textField = factory.create({
 *   containerEl: this.contentEl,
 *   property: { uri: "exo:label", label: "Label", fieldType: PropertyFieldType.Text },
 *   value: "My Asset",
 *   onChange: (value) => this.handleChange(value),
 * });
 *
 * // Create a reference field with autocomplete
 * const refField = factory.create({
 *   containerEl: this.contentEl,
 *   property: { uri: "ems:parent", label: "Parent", fieldType: PropertyFieldType.Reference },
 *   value: "[[Project]]",
 *   onChange: (value) => this.handleChange(value),
 *   classFilter: ["ems__Project"],
 * });
 * ```
 */
export class PropertyFieldFactory {
  constructor(private app?: App) {}

  /**
   * Create a property field renderer based on the property definition.
   *
   * @param options - Field creation options
   * @returns The created field instance
   */
  create(options: PropertyFieldCreateOptions): PropertyFieldInstance {
    const { property, containerEl, value, onChange, error, disabled, classFilter } = options;
    const app = options.app || this.app;

    switch (property.fieldType) {
      case PropertyFieldType.Text:
        return new TextPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.Date:
        return new DatePropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.DateTime:
        return new DateTimePropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.Timestamp:
        return new TimestampPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          error,
        });

      case PropertyFieldType.Number:
        return new NumberPropertyField(containerEl, {
          property,
          value: value !== undefined && value !== null ? Number(value) : null,
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.Boolean:
        return new BooleanPropertyField(containerEl, {
          property,
          value: Boolean(value),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.Reference:
        if (!app) {
          // Fallback to wikilink if no app available
          return new WikilinkPropertyField(containerEl, {
            property,
            value: String(value ?? ""),
            onChange: (v) => onChange(v),
            error,
            disabled,
          });
        }
        return new ReferencePropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
          app,
          classFilter,
          rangeType: property.rangeType,
          boostActiveAssets: true,
        });

      case PropertyFieldType.Enum:
        return new EnumPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.StatusSelect:
        return new StatusSelectPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.SizeSelect:
        return new SizeSelectPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.Wikilink:
        return new WikilinkPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });

      case PropertyFieldType.Unknown:
      default:
        // Default to text field for unknown types
        return new TextPropertyField(containerEl, {
          property,
          value: String(value ?? ""),
          onChange: (v) => onChange(v),
          error,
          disabled,
        });
    }
  }

  /**
   * Create multiple property fields from an array of property definitions.
   *
   * @param containerEl - Container element for all fields
   * @param properties - Array of property definitions
   * @param values - Record of property name to value
   * @param onChange - Callback when any value changes
   * @param errors - Record of property name to error message
   * @returns Array of created field instances
   */
  createAll(
    containerEl: HTMLElement,
    properties: PropertyDefinition[],
    values: Record<string, unknown>,
    onChange: (propertyName: string, value: unknown) => void,
    errors?: Record<string, string>,
  ): PropertyFieldInstance[] {
    return properties.map((property) =>
      this.create({
        containerEl,
        property,
        value: values[property.name],
        onChange: (value) => onChange(property.name, value),
        error: errors?.[property.name],
      }),
    );
  }

  /**
   * Validate all fields and return validation results.
   *
   * @param fields - Array of field instances to validate
   * @returns Array of validation results
   */
  validateAll(fields: PropertyFieldInstance[]): ValidationResult[] {
    return fields.map((field) => {
      if ("validate" in field && typeof field.validate === "function") {
        return field.validate();
      }
      return { valid: true };
    });
  }

  /**
   * Destroy all field instances.
   *
   * @param fields - Array of field instances to destroy
   */
  destroyAll(fields: PropertyFieldInstance[]): void {
    for (const field of fields) {
      if ("destroy" in field && typeof field.destroy === "function") {
        field.destroy();
      }
    }
  }

  /**
   * Check if a property field type is supported.
   */
  static isSupported(fieldType: PropertyFieldType): boolean {
    return [
      PropertyFieldType.Text,
      PropertyFieldType.Date,
      PropertyFieldType.DateTime,
      PropertyFieldType.Timestamp,
      PropertyFieldType.Number,
      PropertyFieldType.Boolean,
      PropertyFieldType.Reference,
      PropertyFieldType.Enum,
      PropertyFieldType.StatusSelect,
      PropertyFieldType.SizeSelect,
      PropertyFieldType.Wikilink,
      PropertyFieldType.Unknown,
    ].includes(fieldType);
  }

  /**
   * Get the field type name for display.
   */
  static getFieldTypeName(fieldType: PropertyFieldType): string {
    const names: Record<PropertyFieldType, string> = {
      [PropertyFieldType.Text]: "Text",
      [PropertyFieldType.Number]: "Number",
      [PropertyFieldType.Date]: "Date",
      [PropertyFieldType.DateTime]: "Date & Time",
      [PropertyFieldType.Boolean]: "Boolean",
      [PropertyFieldType.Reference]: "Reference",
      [PropertyFieldType.Enum]: "Selection",
      [PropertyFieldType.StatusSelect]: "Status",
      [PropertyFieldType.SizeSelect]: "Size",
      [PropertyFieldType.Wikilink]: "Link",
      [PropertyFieldType.Timestamp]: "Timestamp",
      [PropertyFieldType.Unknown]: "Text",
    };
    return names[fieldType] || "Text";
  }
}
