import { Setting } from "obsidian";
import type { SizeSelectPropertyFieldProps, ValidationResult } from "./types";
import { WikilinkLabelResolver } from "@plugin/presentation/utils/WikilinkLabelResolver";

/**
 * Task size options for size select.
 * Values are in wikilink format for storage in frontmatter.
 */
export const TASK_SIZE_OPTIONS = [
  { value: "[[ems__TaskSize_XXS]]", label: "XXS" },
  { value: "[[ems__TaskSize_XS]]", label: "XS" },
  { value: "[[ems__TaskSize_S]]", label: "S" },
  { value: "[[ems__TaskSize_M]]", label: "M" },
  { value: "[[ems__TaskSize_L]]", label: "L" },
  { value: "[[ems__TaskSize_XL]]", label: "XL" },
];

/**
 * Size select property field renderer.
 *
 * Renders a dropdown for selecting task size values.
 * Pre-configured with standard EMS task size options (XXS, XS, S, M, L, XL).
 *
 * @example
 * ```typescript
 * const field = new SizeSelectPropertyField(containerEl, {
 *   property: { uri: "ems:taskSize", name: "ems__Effort_taskSize", label: "Task Size", fieldType: PropertyFieldType.SizeSelect },
 *   value: "[[ems__TaskSize_M]]",
 *   onChange: (value) => console.log("Changed:", value),
 * });
 * ```
 */
export class SizeSelectPropertyField {
  private setting: Setting;
  private selectEl: HTMLSelectElement | null = null;

  constructor(
    private containerEl: HTMLElement,
    private props: SizeSelectPropertyFieldProps,
  ) {
    this.setting = this.render();
  }

  /**
   * Render the size select field.
   */
  private render(): Setting {
    const { property, value, onChange, error, disabled } = this.props;

    const setting = new Setting(this.containerEl)
      .setName(property.label)
      .setDesc(property.description || "Select task size estimate");

    setting.addDropdown((dropdown) => {
      this.selectEl = dropdown.selectEl;
      dropdown.selectEl.addClass("property-field-size-select");

      // Add empty option if not required
      if (!property.required) {
        dropdown.addOption("", "Not specified");
      }

      // Add size options
      for (const option of TASK_SIZE_OPTIONS) {
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
   * Supports wikilinks with aliases (e.g., [[ems__TaskSize_M|Medium]])
   */
  private normalizeValue(value: string): string {
    if (!value) return "";

    // If already in correct format, return as is
    for (const option of TASK_SIZE_OPTIONS) {
      if (option.value === value) {
        return value;
      }
    }

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

    for (const option of TASK_SIZE_OPTIONS) {
      const cleanOption = option.value.replace(/^\[\[|\]\]$/g, "");
      if (cleanOption === cleanValue) {
        return option.value;
      }
    }

    // Try to match by label (e.g., "M" -> "[[ems__TaskSize_M]]")
    for (const option of TASK_SIZE_OPTIONS) {
      if (option.label === cleanValue.toUpperCase()) {
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
   * Get the display label for a size value.
   * Supports wikilinks with aliases (e.g., [[ems__TaskSize_M|Medium]])
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

    for (const option of TASK_SIZE_OPTIONS) {
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
