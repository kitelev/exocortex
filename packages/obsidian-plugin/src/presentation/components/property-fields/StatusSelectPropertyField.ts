import { Setting } from "obsidian";
import type { StatusSelectPropertyFieldProps, ValidationResult } from "./types";
import { WikilinkLabelResolver } from "@plugin/presentation/utils/WikilinkLabelResolver";
import { EFFORT_STATUS_OPTIONS } from "@kitelev/exocortex-core";
export { EFFORT_STATUS_OPTIONS };

/**
 * Status select property field renderer.
 *
 * Renders a dropdown for selecting effort status values.
 * Pre-configured with standard EMS effort status options.
 *
 * @example
 * ```typescript
 * const field = new StatusSelectPropertyField(containerEl, {
 *   property: { uri: "ems:status", name: "ems__Effort_status", label: "Status", fieldType: PropertyFieldType.StatusSelect },
 *   value: "[[ems__EffortStatusDoing]]",
 *   onChange: (value) => console.log("Changed:", value),
 * });
 * ```
 */
export class StatusSelectPropertyField {
  private setting: Setting;
  private selectEl: HTMLSelectElement | null = null;

  constructor(
    private containerEl: HTMLElement,
    private props: StatusSelectPropertyFieldProps,
  ) {
    this.setting = this.render();
  }

  /**
   * Render the status select field.
   */
  private render(): Setting {
    const { property, value, onChange, error, disabled } = this.props;

    const setting = new Setting(this.containerEl)
      .setName(property.label)
      .setDesc(property.description || "Select workflow status");

    setting.addDropdown((dropdown) => {
      this.selectEl = dropdown.selectEl;
      dropdown.selectEl.addClass("property-field-status-select");

      // Add empty option if not required
      if (!property.required) {
        dropdown.addOption("", "Not specified");
      }

      // Add status options
      for (const option of EFFORT_STATUS_OPTIONS) {
        dropdown.addOption(option.value, option.label);
      }

      // Set current value (normalize format)
      const normalizedValue = this.normalizeValue(value);
      if (normalizedValue) {
        dropdown.setValue(normalizedValue);
      }

      dropdown.onChange((newValue) => {
        onChange(newValue);
      });

      if (disabled) {
        dropdown.setDisabled(true);
      }

      // Show error state
      if (error) {
        dropdown.selectEl.addClass("has-error");
        setting.descEl.createDiv({
          text: error,
          cls: "property-field-error",
        });
      }
    });

    // Add required indicator
    if (property.required) {
      setting.nameEl.createSpan({
        text: " *",
        cls: "required-indicator",
      });
    }

    return setting;
  }

  /**
   * Normalize value to match option format.
   * Supports wikilinks with aliases (e.g., [[ems__EffortStatusBacklog|Беклог]])
   */
  private normalizeValue(value: string): string {
    if (!value) return "";

    // If already in correct format, return as is
    for (const option of EFFORT_STATUS_OPTIONS) {
      if (option.value === value) {
        return value;
      }
    }

    // Strip quotes first
    let cleanValue = value.replace(/^"|"$/g, "");

    // Parse wikilink to extract target (handles aliases like [[target|alias]])
    const parsed = WikilinkLabelResolver.parseWikilink(cleanValue);
    if (parsed) {
      cleanValue = parsed.target;
    } else {
      // Fallback: remove brackets if not a valid wikilink format
      cleanValue = cleanValue.replace(/^\[\[|\]\]$/g, "");
    }

    for (const option of EFFORT_STATUS_OPTIONS) {
      const cleanOption = option.value.replace(/^\[\[|\]\]$/g, "");
      if (cleanOption === cleanValue) {
        return option.value;
      }
    }

    return value;
  }

  /**
   * Get the select element.
   */
  getSelectEl(): HTMLSelectElement | null {
    return this.selectEl;
  }

  /**
   * Update the field value programmatically.
   */
  setValue(value: string): void {
    if (this.selectEl) {
      const normalizedValue = this.normalizeValue(value);
      this.selectEl.value = normalizedValue;
    }
  }

  /**
   * Get the display label for a status value.
   * Supports wikilinks with aliases (e.g., [[ems__EffortStatusBacklog|Беклог]])
   */
  static getLabel(value: string): string {
    if (!value) return "-";

    // Remove outer quotes first
    let cleanValue = value.replace(/^"|"$/g, "");

    // Parse wikilink to extract target (handles aliases like [[target|alias]])
    const parsed = WikilinkLabelResolver.parseWikilink(cleanValue);
    if (parsed) {
      cleanValue = parsed.target;
    } else {
      // Fallback: remove brackets if not a valid wikilink format
      cleanValue = cleanValue.replace(/^\[\[|\]\]$/g, "");
    }

    for (const option of EFFORT_STATUS_OPTIONS) {
      const cleanOption = option.value.replace(/^\[\[|\]\]$/g, "");
      if (cleanOption === cleanValue) {
        return option.label;
      }
    }

    return value;
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

    return { valid: true };
  }

  /**
   * Focus the select element.
   */
  focus(): void {
    if (this.selectEl) {
      this.selectEl.focus();
    }
  }

  /**
   * Destroy the field and clean up resources.
   */
  destroy(): void {
    this.setting.settingEl.remove();
    this.selectEl = null;
  }
}
