import { Setting } from "obsidian";
import { DateFormatter } from "@kitelev/exocortex-core";
import type { DatePropertyFieldProps, ValidationResult } from "./types";

/**
 * Date property field renderer (date-only, no time component).
 *
 * Renders a date input field with proper date picker support.
 * Values are stored in ISO 8601 date format (YYYY-MM-DD).
 *
 * @example
 * ```typescript
 * const field = new DatePropertyField(containerEl, {
 *   property: { uri: "exo:dueDate", name: "exo__Asset_dueDate", label: "Due Date", fieldType: PropertyFieldType.Date },
 *   value: "2024-12-31",
 *   onChange: (value) => console.log("Changed:", value),
 * });
 * ```
 */
export class DatePropertyField {
  private setting: Setting;
  private inputEl: HTMLInputElement | null = null;

  constructor(
    private containerEl: HTMLElement,
    private props: DatePropertyFieldProps,
  ) {
    this.setting = this.render();
  }

  /**
   * Render the date field.
   */
  private render(): Setting {
    const { property, value, onChange, error, disabled } = this.props;

    const setting = new Setting(this.containerEl)
      .setName(property.label)
      .setDesc(property.description || "Select a date (YYYY-MM-DD format)");

    setting.addText((text) => {
      this.inputEl = text.inputEl;
      text.inputEl.type = "date";
      text.inputEl.addClass("property-field-date-input");

      // Parse and format the value
      const formattedValue = this.parseToDateInputValue(value);
      text.setValue(formattedValue);

      text.onChange((newValue) => {
        // Convert to ISO format for storage
        const isoValue = this.formatToISODate(newValue);
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
   * Parse various date formats to HTML date input value (YYYY-MM-DD).
   */
  private parseToDateInputValue(value: string): string {
    if (!value) return "";

    // If already in YYYY-MM-DD format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    // Try to parse ISO 8601 datetime format and extract date
    if (value.includes("T")) {
      const dateMatch = value.match(/^(\d{4}-\d{2}-\d{2})T/);
      if (dateMatch) {
        return dateMatch[1];
      }
    }

    // Try to parse as Date object
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        // #3811 — derive the LOCAL calendar day (via DateFormatter.toDateString)
        // so a near-midnight datetime value doesn't slide the date-input prefill
        // to the previous UTC day in a UTC+N timezone. The former
        // `toISOString().split("T")[0]` produced the UTC day.
        return DateFormatter.toDateString(date);
      }
    } catch {
      // Fall through
    }

    return "";
  }

  /**
   * Format date input value to ISO date string.
   */
  private formatToISODate(value: string): string {
    if (!value) return "";

    // Date input already gives us YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
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
      this.inputEl.value = this.parseToDateInputValue(value);
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

    // Date format validation
    if (value && !this.isValidDateFormat(value)) {
      return {
        valid: false,
        error: `${property.label} must be a valid date (YYYY-MM-DD)`,
      };
    }

    // Check if date is valid
    if (value && !this.isValidDate(value)) {
      return {
        valid: false,
        error: `${property.label} is not a valid date`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if value matches ISO date format (YYYY-MM-DD).
   */
  private isValidDateFormat(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  /**
   * Check if the date is actually valid (e.g., not 2024-02-31).
   */
  private isValidDate(value: string): boolean {
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
   * Destroy the field and clean up resources.
   */
  destroy(): void {
    this.setting.settingEl.remove();
    this.inputEl = null;
  }
}
