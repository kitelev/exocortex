/**
 * ObsidianUIProvider - Implements IUIProvider for Obsidian environment
 *
 * Provides native Obsidian UI interactions (modals, notices, navigation)
 * for the unified UI abstraction layer.
 *
 * @see Issue #1398: [Plugin] Implement ObsidianUIProvider
 * @see /Users/kitelev/vault-2025/03 Knowledge/concepts/RDF-Driven Architecture Implementation Plan (Note).md (lines 1300-1342)
 */

import { App, Modal, Notice, TFile } from "obsidian";
import type { IUIProvider, ModalOptions, SelectOptions } from "exocortex";

/**
 * Obsidian-specific modal for text input
 */
class InputModal extends Modal {
  private result = "";
  private submitted = false;

  constructor(
    app: App,
    private options: ModalOptions,
    private onSubmit: (value: string) => void,
    private onCancel: () => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: this.options.title });

    const inputContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    const inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: this.options.placeholder || "",
      cls: "exocortex-modal-input",
    });

    if (this.options.defaultValue) {
      inputEl.value = this.options.defaultValue;
      this.result = this.options.defaultValue;
    }

    inputEl.addEventListener("input", (e) => {
      this.result = (e.target as HTMLInputElement).value;
    });

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      }
    });

    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const submitButton = buttonContainer.createEl("button", {
      text: this.options.submitLabel || "Submit",
      cls: "mod-cta",
    });
    submitButton.addEventListener("click", () => this.submit());

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.cancel());

    // Focus input after modal is open
    setTimeout(() => inputEl.focus(), 50);
  }

  private submit(): void {
    this.submitted = true;
    this.close();
    this.onSubmit(this.result);
  }

  private cancel(): void {
    this.close();
    this.onCancel();
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();

    // If modal was closed without submitting (e.g., clicking outside)
    if (!this.submitted) {
      this.onCancel();
    }
  }
}

/**
 * Obsidian-specific modal for selecting from a list
 */
class SelectModal<T> extends Modal {
  private selectedItem: T | null = null;
  private submitted = false;
  private filteredItems: T[];
  private selectEl: HTMLSelectElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    private options: SelectOptions<T>,
    private onSubmit: (value: T) => void,
    private onCancel: () => void
  ) {
    super(app);
    this.filteredItems = [...options.items];
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: this.options.title });

    // Search input for filtering
    if (this.options.placeholder) {
      const searchContainer = contentEl.createDiv({
        cls: "exocortex-modal-search-container",
      });

      this.searchInputEl = searchContainer.createEl("input", {
        type: "text",
        placeholder: this.options.placeholder,
        cls: "exocortex-modal-input",
      });

      this.searchInputEl.addEventListener("input", (e) => {
        this.filterItems((e.target as HTMLInputElement).value);
      });

      this.searchInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.cancel();
        } else if (e.key === "Enter" && this.selectedItem) {
          e.preventDefault();
          this.submit();
        }
      });
    }

    // Select dropdown
    const selectContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    this.selectEl = selectContainer.createEl("select", {
      cls: "exocortex-modal-select dropdown",
    });

    this.renderOptions();

    this.selectEl.addEventListener("change", (e) => {
      const index = parseInt((e.target as HTMLSelectElement).value, 10);
      if (!isNaN(index) && index >= 0 && index < this.filteredItems.length) {
        this.selectedItem = this.filteredItems[index];
      }
    });

    this.selectEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      } else if (e.key === "Enter" && this.selectedItem) {
        e.preventDefault();
        this.submit();
      }
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const submitButton = buttonContainer.createEl("button", {
      text: "Select",
      cls: "mod-cta",
    });
    submitButton.addEventListener("click", () => this.submit());

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.cancel());

    // Focus search or select
    setTimeout(() => {
      if (this.searchInputEl) {
        this.searchInputEl.focus();
      } else {
        this.selectEl?.focus();
      }
    }, 50);
  }

  private filterItems(query: string): void {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      this.filteredItems = [...this.options.items];
    } else {
      this.filteredItems = this.options.items.filter((item) =>
        this.options.getLabel(item).toLowerCase().includes(lowerQuery)
      );
    }

    this.renderOptions();

    // Auto-select first if available
    if (this.filteredItems.length > 0) {
      this.selectedItem = this.filteredItems[0];
      if (this.selectEl) {
        this.selectEl.value = "0";
      }
    } else {
      this.selectedItem = null;
    }
  }

  private renderOptions(): void {
    if (!this.selectEl) return;

    // Clear existing options
    while (this.selectEl.firstChild) {
      this.selectEl.removeChild(this.selectEl.firstChild);
    }

    // Add placeholder option
    const placeholder = this.selectEl.createEl("option", {
      value: "",
      text: "Select an item...",
    });
    placeholder.disabled = true;
    placeholder.selected = !this.selectedItem;

    // Add items
    this.filteredItems.forEach((item, index) => {
      const selectEl = this.selectEl;
      if (!selectEl) return;

      const option = selectEl.createEl("option", {
        value: String(index),
        text: this.options.getLabel(item),
      });

      if (this.selectedItem === item) {
        option.selected = true;
      }
    });
  }

  private submit(): void {
    if (!this.selectedItem) return;

    this.submitted = true;
    this.close();
    this.onSubmit(this.selectedItem);
  }

  private cancel(): void {
    this.close();
    this.onCancel();
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();

    // If modal was closed without submitting
    if (!this.submitted) {
      this.onCancel();
    }
  }
}

/**
 * Obsidian-specific modal for confirmation dialogs
 */
class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private message: string,
    private onResolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Confirm" });
    contentEl.createEl("p", { text: this.message });

    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const confirmButton = buttonContainer.createEl("button", {
      text: "Confirm",
      cls: "mod-cta",
    });
    confirmButton.addEventListener("click", () => this.confirm());

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.cancel());

    // Handle keyboard
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.confirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      }
    });

    // Focus confirm button
    setTimeout(() => confirmButton.focus(), 50);
  }

  private confirm(): void {
    this.resolved = true;
    this.close();
    this.onResolve(true);
  }

  private cancel(): void {
    this.resolved = true;
    this.close();
    this.onResolve(false);
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();

    // If modal was closed without explicit choice
    if (!this.resolved) {
      this.onResolve(false);
    }
  }
}

/**
 * Obsidian UI Provider - implements IUIProvider for native Obsidian interactions
 *
 * Provides:
 * - Input modals using Obsidian Modal API
 * - Selection modals with search/filter
 * - Confirmation dialogs
 * - Notification via Obsidian Notice
 * - Navigation using Obsidian workspace
 *
 * @example
 * ```typescript
 * const provider = new ObsidianUIProvider(app);
 *
 * // Show input modal
 * const name = await provider.showInputModal({
 *   title: "Enter name",
 *   placeholder: "Name..."
 * });
 *
 * // Show selection modal
 * const selected = await provider.showSelectModal({
 *   title: "Select item",
 *   items: items,
 *   getLabel: (item) => item.name
 * });
 *
 * // Show confirmation
 * const confirmed = await provider.showConfirm("Delete this?");
 *
 * // Show notification
 * provider.notify("Operation completed!");
 *
 * // Navigate to file
 * await provider.navigate("path/to/file.md");
 * ```
 */
export class ObsidianUIProvider implements IUIProvider {
  /**
   * Obsidian provider is NOT headless - it has full UI capabilities
   */
  readonly isHeadless = false;

  constructor(private app: App) {}

  /**
   * Show an input modal and return the entered value
   *
   * @param options - Modal configuration
   * @returns Promise resolving to the entered string
   * @throws Error if modal is cancelled (rejected promise)
   */
  async showInputModal(options: ModalOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const modal = new InputModal(
        this.app,
        options,
        resolve,
        () => reject(new Error("Modal cancelled"))
      );
      modal.open();
    });
  }

  /**
   * Show a selection modal and return the selected item
   *
   * @template T - Type of items in the selection list
   * @param options - Selection modal configuration
   * @returns Promise resolving to the selected item
   * @throws Error if modal is cancelled (rejected promise)
   */
  async showSelectModal<T>(options: SelectOptions<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const modal = new SelectModal(
        this.app,
        options,
        resolve,
        () => reject(new Error("Modal cancelled"))
      );
      modal.open();
    });
  }

  /**
   * Show a confirmation dialog
   *
   * @param message - Message to display
   * @returns Promise resolving to true (confirmed) or false (cancelled)
   */
  async showConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmModal(this.app, message, resolve);
      modal.open();
    });
  }

  /**
   * Display a notification using Obsidian Notice
   *
   * @param message - Message to display
   * @param duration - Display duration in milliseconds (default: 3000)
   */
  notify(message: string, duration = 3000): void {
    new Notice(message, duration);
  }

  /**
   * Navigate to an asset by opening its file in the workspace
   *
   * @param target - File path to navigate to
   */
  async navigate(target: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(target);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf().openFile(file);
    }
  }
}
