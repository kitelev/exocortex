import { Setting, setIcon } from "obsidian";
import type { TextPropertyFieldProps, ValidationResult } from "./types";
import type { INotificationService } from "exocortex";

/**
 * Text property field renderer.
 *
 * Renders a text input field for plain text property values.
 * Supports optional pattern validation and max length constraints.
 *
 * @example
 * ```typescript
 * const field = new TextPropertyField(containerEl, {
 *   property: { uri: "exo:label", name: "exo__Asset_label", label: "Label", fieldType: PropertyFieldType.Text },
 *   value: "My Asset",
 *   onChange: (value) => console.log("Changed:", value),
 * });
 * ```
 */
export class TextPropertyField {
  private setting: Setting;
  private inputEl: HTMLInputElement | null = null;

  private notificationService?: INotificationService;

  constructor(
    private containerEl: HTMLElement,
    private props: TextPropertyFieldProps,
    notificationService?: INotificationService,
  ) {
    this.notificationService = notificationService;
    this.setting = this.render();
  }

  /**
   * Render the text field.
   */
  private render(): Setting {
    const { property, value, onChange, error, disabled } = this.props;

    const setting = new Setting(this.containerEl)
      .setName(property.label)
      .setDesc(property.description || "");

    setting.addText((text) => {
      this.inputEl = text.inputEl;

      text
        .setPlaceholder(`Enter ${property.label.toLowerCase()}...`)
        .setValue(value || "")
        .onChange((newValue) => {
          onChange(newValue);
        });

      // Apply constraints
      if (property.maxLength) {
        text.inputEl.maxLength = property.maxLength;
      }

      if (property.pattern) {
        text.inputEl.pattern = property.pattern;
      }

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

    if (property.name === "exo__Asset_uid" && value && this.notificationService) {
      this.addCopyButton(setting, value, this.notificationService);
    }

    return setting;
  }

  private addCopyButton(setting: Setting, value: string, notifier: INotificationService): void {
    const btn = setting.controlEl.createEl("button", {
      cls: "clickable-icon",
      attr: {
        "aria-label": "Copy uid",
      },
    });
    setIcon(btn, "copy");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(value);
        setIcon(btn, "check");
        notifier.success("Uid copied to clipboard");
        setTimeout(() => setIcon(btn, "copy"), 1500);
      } catch {
        notifier.error("Failed to copy uid");
      }
    });
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
      this.inputEl.value = value;
    }
  }

  /**
   * Validate the current value against property constraints.
   */
  validate(): ValidationResult {
    const { property, value } = this.props;

    // Required validation
    if (property.required && (!value || value.trim() === "")) {
      return { valid: false, error: `${property.label} is required` };
    }

    // Max length validation
    if (property.maxLength && value && value.length > property.maxLength) {
      return {
        valid: false,
        error: `${property.label} must be at most ${property.maxLength} characters`,
      };
    }

    // Pattern validation
    if (property.pattern && value) {
      const regex = new RegExp(property.pattern);
      if (!regex.test(value)) {
        return {
          valid: false,
          error: `${property.label} format is invalid`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Add keyboard event listener for Enter key submission.
   */
  onEnter(callback: () => void): void {
    if (this.inputEl) {
      this.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          callback();
        }
      });
    }
  }

  /**
   * Add keyboard event listener for Escape key cancellation.
   */
  onEscape(callback: () => void): void {
    if (this.inputEl) {
      this.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          callback();
        }
      });
    }
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
