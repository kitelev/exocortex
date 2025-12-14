import { App, Modal } from "obsidian";
import { FilenameValidator } from "exocortex";

export interface LabelInputModalResult {
  label: string | null;
  taskSize: string | null;
  openInNewTab: boolean;
}

/**
 * Modal for inputting asset label and task size during creation
 * Allows optional label input and task size selection with Create/Cancel actions
 */
export class LabelInputModal extends Modal {
  private label = "";
  private taskSize: string | null = null;
  private openInNewTab = false;
  private onSubmit: (result: LabelInputModalResult) => void;
  private inputEl: HTMLInputElement | null = null;
  private taskSizeSelectEl: HTMLSelectElement | null = null;
  private showTaskSize: boolean;
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    onSubmit: (result: LabelInputModalResult) => void,
    defaultValue = "",
    showTaskSize = true,
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.label = defaultValue;
    this.showTaskSize = showTaskSize;
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("exocortex-label-input-modal");

    contentEl.createEl("h2", { text: "Create asset" });

    contentEl.createEl("p", {
      text: "Enter a display label for the new asset (optional):",
      cls: "exocortex-modal-description",
    });

    const inputContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: "Asset label (optional)",
      cls: "exocortex-modal-input",
    });

    this.inputEl.value = this.label;

    this.inputEl.addEventListener("input", (e) => {
      this.label = (e.target as HTMLInputElement).value;
      this.validateAndShowWarning();
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      }
    });

    if (this.showTaskSize) {
      contentEl.createEl("p", {
        text: "Task size:",
        cls: "exocortex-modal-description",
      });

      const selectContainer = contentEl.createDiv({
        cls: "exocortex-modal-input-container",
      });

      this.taskSizeSelectEl = selectContainer.createEl("select", {
        cls: "exocortex-modal-select dropdown",
      });

      const taskSizeOptions = [
        { value: "", label: "Not specified" },
        { value: '"[[ems__TaskSize_XXS]]"', label: "XXS" },
        { value: '"[[ems__TaskSize_XS]]"', label: "XS" },
        { value: '"[[ems__TaskSize_S]]"', label: "S" },
        { value: '"[[ems__TaskSize_M]]"', label: "M" },
      ];

      taskSizeOptions.forEach((option) => {
        if (this.taskSizeSelectEl) {
          this.taskSizeSelectEl.createEl("option", {
            value: option.value,
            text: option.label,
          });
        }
      });

      this.taskSizeSelectEl.addEventListener("change", (e) => {
        const selectedValue = (e.target as HTMLSelectElement).value;
        this.taskSize = selectedValue || null;
      });
    }

    const tabPreferenceContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    const checkboxWrapper = tabPreferenceContainer.createDiv({
      cls: "exocortex-modal-checkbox-wrapper",
    });

    const checkboxId = `exocortex-open-in-new-tab-${Date.now()}`;
    const checkboxEl = checkboxWrapper.createEl("input", {
      type: "checkbox",
    });
    checkboxEl.id = checkboxId;
    checkboxEl.checked = this.openInNewTab;
    checkboxEl.addEventListener("change", (e) => {
      this.openInNewTab = (e.target as HTMLInputElement).checked;
    });

    checkboxWrapper.createEl("label", {
      text: "Open created asset in a new tab",
      attr: { for: checkboxId },
    });

    tabPreferenceContainer.createEl("p", {
      text: "Uncheck to use the current tab instead.",
      cls: "exocortex-modal-description",
    });

    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const createButton = buttonContainer.createEl("button", {
      text: "Create",
      cls: "mod-cta",
    });
    createButton.addEventListener("click", () => this.submit());

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.cancel());

    setTimeout(() => {
      this.inputEl?.focus();
    }, 50);
  }

  private submit(): void {
    const trimmedLabel = this.label.trim();

    // Sanitize the label to remove any invalid characters
    const sanitizedLabel = trimmedLabel
      ? FilenameValidator.sanitize(trimmedLabel)
      : null;

    this.onSubmit({
      label: sanitizedLabel || null,
      taskSize: this.taskSize,
      openInNewTab: this.openInNewTab,
    });
    this.close();
  }

  /**
   * Validates the current label and shows a warning if it contains invalid characters.
   * The warning informs the user that invalid characters will be replaced.
   */
  private validateAndShowWarning(): void {
    // Clear any existing warning
    if (this.errorEl) {
      this.errorEl.remove();
      this.errorEl = null;
    }

    const trimmedLabel = this.label.trim();
    if (!trimmedLabel) return;

    const validation = FilenameValidator.validate(trimmedLabel, {
      allowEmpty: true,
    });

    if (!validation.valid && validation.sanitized !== trimmedLabel) {
      // Show warning that label will be sanitized
      this.errorEl = this.contentEl.createDiv({
        cls: "exocortex-modal-warning",
      });
      this.errorEl.createEl("span", {
        text: `⚠️ Label contains invalid characters. Will be saved as: "${validation.sanitized}"`,
      });

      // Insert warning after the input container
      const inputContainer = this.inputEl?.parentElement;
      if (inputContainer?.nextSibling) {
        inputContainer.parentElement?.insertBefore(
          this.errorEl,
          inputContainer.nextSibling,
        );
      }
    }
  }

  private cancel(): void {
    this.onSubmit({
      label: null,
      taskSize: null,
      openInNewTab: this.openInNewTab,
    });
    this.close();
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
