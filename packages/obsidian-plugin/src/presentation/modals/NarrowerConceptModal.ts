import { App, Modal } from "obsidian";
import { FilenameValidator } from "exocortex";

export interface NarrowerConceptModalResult {
  fileName: string | null;
  definition: string | null;
  aliases: string[];
}

export class NarrowerConceptModal extends Modal {
  private fileName = "";
  private definition = "";
  private aliases: string[] = [];
  private onSubmit: (result: NarrowerConceptModalResult) => void;
  private fileNameEl: HTMLInputElement | null = null;
  private definitionEl: HTMLTextAreaElement | null = null;
  private aliasesContainer: HTMLElement | null = null;
  private filenameWarningEl: HTMLElement | null = null;

  constructor(
    app: App,
    onSubmit: (result: NarrowerConceptModalResult) => void,
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("exocortex-narrower-concept-modal");

    contentEl.createEl("h2", { text: "Create narrower concept" });

    contentEl.createEl("p", {
      text: "File name (required):",
      cls: "exocortex-modal-description",
    });

    const fileNameContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    this.fileNameEl = fileNameContainer.createEl("input", {
      type: "text",
      placeholder: "concept-file-name",
      cls: "exocortex-modal-input",
    });

    this.fileNameEl.addEventListener("input", (e) => {
      this.fileName = (e.target as HTMLInputElement).value;
      this.validateFilenameAndShowWarning();
    });

    contentEl.createEl("p", {
      text: "Definition (required):",
      cls: "exocortex-modal-description",
    });

    const definitionContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    this.definitionEl = definitionContainer.createEl("textarea", {
      placeholder: "Enter concept definition...",
      cls: "exocortex-modal-textarea",
    });

    this.definitionEl.addEventListener("input", (e) => {
      this.definition = (e.target as HTMLTextAreaElement).value;
    });

    contentEl.createEl("p", {
      text: "Aliases (optional):",
      cls: "exocortex-modal-description",
    });

    this.aliasesContainer = contentEl.createDiv({
      cls: "exocortex-modal-aliases-container",
    });

    this.renderAliases();

    const addAliasButton = contentEl.createEl("button", {
      text: "Add alias",
      cls: "exocortex-modal-add-alias-button",
    });
    addAliasButton.addEventListener("click", () => this.addAlias());

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
      this.fileNameEl?.focus();
    }, 50);
  }

  private renderAliases(): void {
    if (!this.aliasesContainer) return;

    this.aliasesContainer.empty();

    this.aliases.forEach((alias, index) => {
      if (!this.aliasesContainer) return;
      const aliasRow = this.aliasesContainer.createDiv({
        cls: "exocortex-modal-alias-row",
      });

      const aliasInput = aliasRow.createEl("input", {
        type: "text",
        value: alias,
        cls: "exocortex-modal-input",
      });

      aliasInput.addEventListener("input", (e) => {
        this.aliases[index] = (e.target as HTMLInputElement).value;
      });

      const removeButton = aliasRow.createEl("button", {
        text: "×",
        cls: "exocortex-modal-remove-alias-button",
      });

      removeButton.addEventListener("click", () => {
        this.aliases.splice(index, 1);
        this.renderAliases();
      });
    });
  }

  private addAlias(): void {
    this.aliases.push("");
    this.renderAliases();
  }

  private submit(): void {
    const trimmedFileName = this.fileName.trim();
    const trimmedDefinition = this.definition.trim();

    if (!trimmedFileName) {
      this.showError("File name is required");
      return;
    }

    // Validate and sanitize the filename
    const validation = FilenameValidator.validate(trimmedFileName);
    if (!validation.sanitized) {
      this.showError("File name is invalid. Please enter a valid file name.");
      return;
    }

    if (!trimmedDefinition) {
      this.showError("Definition is required");
      return;
    }

    const filteredAliases = this.aliases
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    this.onSubmit({
      fileName: validation.sanitized,
      definition: trimmedDefinition,
      aliases: filteredAliases,
    });
    this.close();
  }

  /**
   * Validates the current filename and shows a warning if it contains invalid characters.
   * The warning informs the user that invalid characters will be replaced.
   */
  private validateFilenameAndShowWarning(): void {
    // Clear any existing warning
    if (this.filenameWarningEl) {
      this.filenameWarningEl.remove();
      this.filenameWarningEl = null;
    }

    const trimmedFileName = this.fileName.trim();
    if (!trimmedFileName) return;

    const validation = FilenameValidator.validate(trimmedFileName);

    if (!validation.valid && validation.sanitized && validation.sanitized !== trimmedFileName) {
      // Show warning that filename will be sanitized
      this.filenameWarningEl = this.contentEl.createDiv({
        cls: "exocortex-modal-warning",
      });
      this.filenameWarningEl.createEl("span", {
        text: `⚠️ Filename contains invalid characters. Will be saved as: "${validation.sanitized}"`,
      });

      // Insert warning after the filename input container
      const fileNameContainer = this.fileNameEl?.parentElement;
      if (fileNameContainer?.nextSibling) {
        fileNameContainer.parentElement?.insertBefore(
          this.filenameWarningEl,
          fileNameContainer.nextSibling,
        );
      }
    }
  }

  private cancel(): void {
    this.onSubmit({ fileName: null, definition: null, aliases: [] });
    this.close();
  }

  private showError(message: string): void {
    const existingError = this.contentEl.querySelector(
      ".exocortex-modal-error",
    );
    if (existingError) {
      existingError.remove();
    }

    const errorEl = this.contentEl.createDiv({
      text: message,
      cls: "exocortex-modal-error",
    });

    setTimeout(() => {
      errorEl.remove();
    }, 3000);
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
