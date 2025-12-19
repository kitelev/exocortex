import { Setting } from "obsidian";
import type { DateTimePropertyFieldProps, ValidationResult } from "./types";

/**
 * DateTime property field renderer.
 *
 * Renders a datetime-local input field for date and time values.
 * Values are stored in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ).
 *
 * @example
 * ```typescript
 * const field = new DateTimePropertyField(containerEl, {
 *   property: { uri: "ems:startTimestamp", name: "ems__Effort_startTimestamp", label: "Start Time", fieldType: PropertyFieldType.DateTime },
 *   value: "2024-12-31T14:30:00.000Z",
 *   onChange: (value) => console.log("Changed:", value),
 * });
 * ```
 */
export class DateTimePropertyField {
  private setting: Setting;
  private inputEl: HTMLInputElement | null = null;

  constructor(
    private containerEl: HTMLElement,
    private props: DateTimePropertyFieldProps,
  ) {
    this.setting = this.render();
  }

  /**
   * Render the datetime field.
   */
  private render(): Setting {
    const { property, value, onChange, error, disabled } = this.props;

    const setting = new Setting(this.containerEl)
      .setName(property.label)
      .setDesc(property.description || "Select date and time");

    setting.addText((text) => {
      this.inputEl = text.inputEl;
      text.inputEl.type = "datetime-local";
      text.inputEl.addClass("property-field-datetime-input");

      // Parse and format the value for datetime-local input
      const formattedValue = this.parseToDateTimeLocalValue(value);
      text.setValue(formattedValue);

      text.onChange((newValue) => {
        // Convert to ISO 8601 format for storage
        const isoValue = this.formatToISO(newValue);
        onChange(isoValue);
      });

      if (disabled) {
        text.inputEl.disabled = true;
      }

      // Add required indicator
      if (property.required) {
        setting.nameEl.createSpan({
          text: " *",
          cls: "required-indicator",
        });
      }

      // Show error state
      if (error) {
        text.inputEl.addClass("has-error");
        setting.descEl.createDiv({
          text: error,
          cls: "property-field-error",
        });
      }
    });

    return setting;
  }

  /**
   * Parse various datetime formats to HTML datetime-local input value (YYYY-MM-DDTHH:mm).
   */
  private parseToDateTimeLocalValue(value: string): string {
    if (!value) return "";

    // If already in datetime-local format (YYYY-MM-DDTHH:mm), return as is
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      return value;
    }

    // Handle ISO 8601 format with timezone
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        // Format to local datetime string YYYY-MM-DDTHH:mm
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      }
    } catch {
      // Fall through
    }

    return "";
  }

  /**
   * Format datetime-local input value to local timestamp string.
   * Format: YYYY-MM-DDTHH:mm:ss (no timezone suffix)
   *
   * This format is consistent with DateFormatter.toLocalTimestamp() in @exocortex/core,
   * avoiding timezone conversion issues when the value is later parsed.
   */
  private formatToISO(value: string): string {
    if (!value) return "";

    // datetime-local gives us YYYY-MM-DDTHH:mm format
    try {
      // Create date from the local time input and format as local timestamp
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        // Format as local timestamp (without Z suffix)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
      }
    } catch {
      // Fall through
    }

    return value;
  }

  /**
   * Get the input element for focus management.
   */
  getInputEl(): HTMLInputElement | null {
    return this.inputEl;
  }

  /**
   * Update the field value programmatically.
   */
  setValue(value: string): void {
    if (this.inputEl) {
      this.inputEl.value = this.parseToDateTimeLocalValue(value);
    }
  }

  /**
   * Validate the current value.
   */
  validate(): ValidationResult {
    const { property, value } = this.props;

    // Required validation
    if (property.required && !value) {
      return { valid: false, error: `${property.label} is required` };
    }

    // ISO 8601 format validation
    if (value && !this.isValidISO8601(value)) {
      return {
        valid: false,
        error: `${property.label} must be a valid ISO 8601 datetime`,
      };
    }

    // Check if datetime is actually valid
    if (value && !this.isValidDateTime(value)) {
      return {
        valid: false,
        error: `${property.label} is not a valid date and time`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if value matches ISO 8601 datetime format.
   */
  private isValidISO8601(value: string): boolean {
    // Accept various ISO 8601 formats
    const iso8601Regex =
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
    return iso8601Regex.test(value);
  }

  /**
   * Check if the datetime is actually valid.
   */
  private isValidDateTime(value: string): boolean {
    const date = new Date(value);
    return !isNaN(date.getTime());
  }

  /**
   * Focus the input element.
   */
  focus(): void {
    if (this.inputEl) {
      this.inputEl.focus();
    }
  }

  /**
   * Get current datetime in local timestamp format.
   */
  static now(): string {
    return DateTimePropertyField.formatDate(new Date());
  }

  /**
   * Format a Date object to local timestamp string.
   * Format: YYYY-MM-DDTHH:mm:ss (no timezone suffix)
   */
  static formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  /**
   * Destroy the field and clean up resources.
   */
  destroy(): void {
    this.setting.settingEl.remove();
    this.inputEl = null;
  }
}
