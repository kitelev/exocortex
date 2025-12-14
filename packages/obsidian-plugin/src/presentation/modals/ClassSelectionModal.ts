import { App, Modal, Setting } from "obsidian";
import type { DiscoveredClass } from '@plugin/application/services/ClassDiscoveryService';

/**
 * Result from ClassSelectionModal.
 */
export interface ClassSelectionModalResult {
  /** The selected class, or null if cancelled */
  selectedClass: DiscoveredClass | null;
}

/**
 * Modal for selecting a class from the ontology.
 *
 * Shows a searchable dropdown of all available classes,
 * allowing users to select which type of asset to create.
 *
 * @example
 * ```typescript
 * const modal = new ClassSelectionModal(
 *   this.app,
 *   availableClasses,
 *   (result) => {
 *     if (result.selectedClass) {
 *       // Create asset of selected class
 *     }
 *   }
 * );
 * modal.open();
 * ```
 */
export class ClassSelectionModal extends Modal {
  private selectedClass: DiscoveredClass | null = null;
  private selectEl: HTMLSelectElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private filteredClasses: DiscoveredClass[] = [];

  constructor(
    app: App,
    private classes: DiscoveredClass[],
    private onSubmit: (result: ClassSelectionModalResult) => void,
  ) {
    super(app);
    this.filteredClasses = [...classes];
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("exocortex-class-selection-modal");

    contentEl.createEl("h2", { text: "Create asset" });

    contentEl.createEl("p", {
      text: "Select the type of asset you want to create:",
      cls: "exocortex-modal-description",
    });

    // Search input for filtering classes
    const searchContainer = contentEl.createDiv({
      cls: "exocortex-modal-search-container",
    });

    new Setting(searchContainer)
      .setName("Search")
      .setDesc("Filter classes by name")
      .addText((text) => {
        this.searchInputEl = text.inputEl;
        text
          .setPlaceholder("Type to search...")
          .onChange((value) => {
            this.filterClasses(value);
          });

        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            this.cancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (this.selectedClass) {
              this.submit();
            }
          }
        });
      });

    // Select dropdown
    const selectContainer = contentEl.createDiv({
      cls: "exocortex-modal-input-container",
    });

    this.selectEl = selectContainer.createEl("select", {
      cls: "exocortex-modal-select dropdown",
    });

    this.renderOptions();

    this.selectEl.addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.selectedClass = this.classes.find(c => c.className === value) || null;
    });

    this.selectEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (this.selectedClass) {
          this.submit();
        }
      }
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });

    const createButton = buttonContainer.createEl("button", {
      text: "Next",
      cls: "mod-cta",
    });
    createButton.addEventListener("click", () => this.submit());

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => this.cancel());

    // Focus search input
    setTimeout(() => {
      this.searchInputEl?.focus();
    }, 50);
  }

  /**
   * Filter classes based on search query.
   */
  private filterClasses(query: string): void {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      this.filteredClasses = [...this.classes];
    } else {
      this.filteredClasses = this.classes.filter(c =>
        c.label.toLowerCase().includes(lowerQuery) ||
        c.className.toLowerCase().includes(lowerQuery) ||
        (c.description?.toLowerCase().includes(lowerQuery) ?? false)
      );
    }

    this.renderOptions();

    // Auto-select first if only one match
    if (this.filteredClasses.length === 1) {
      this.selectedClass = this.filteredClasses[0];
      if (this.selectEl) {
        this.selectEl.value = this.selectedClass.className;
      }
    } else if (this.filteredClasses.length > 0 && !this.selectedClass) {
      this.selectedClass = this.filteredClasses[0];
      if (this.selectEl) {
        this.selectEl.value = this.selectedClass.className;
      }
    }
  }

  /**
   * Render options in the select dropdown.
   */
  private renderOptions(): void {
    if (!this.selectEl) return;

    // Clear existing options
    this.selectEl.empty();

    // Add placeholder option
    const placeholder = this.selectEl.createEl("option", {
      value: "",
      text: "Select a class...",
    });
    placeholder.disabled = true;
    placeholder.selected = !this.selectedClass;

    // Group classes by category (based on prefix)
    const grouped = this.groupClassesByPrefix(this.filteredClasses);

    for (const [groupLabel, groupClasses] of Object.entries(grouped)) {
      if (groupClasses.length === 0) continue;

      const optgroup = this.selectEl.createEl("optgroup");
      optgroup.label = groupLabel;

      for (const cls of groupClasses) {
        const option = optgroup.createEl("option", {
          value: cls.className,
          text: cls.label,
        });

        if (cls.description) {
          option.title = cls.description;
        }

        if (this.selectedClass?.className === cls.className) {
          option.selected = true;
        }
      }
    }
  }

  /**
   * Group classes by their ontology prefix.
   */
  private groupClassesByPrefix(classes: DiscoveredClass[]): Record<string, DiscoveredClass[]> {
    const groups: Record<string, DiscoveredClass[]> = {
      "Effort Management": [],
      "Knowledge Management": [],
      "Personal Notes": [],
      "Core": [],
      "Other": [],
    };

    for (const cls of classes) {
      if (cls.className.startsWith("ems__")) {
        groups["Effort Management"].push(cls);
      } else if (cls.className.startsWith("ims__")) {
        groups["Knowledge Management"].push(cls);
      } else if (cls.className.startsWith("pn__")) {
        groups["Personal Notes"].push(cls);
      } else if (cls.className.startsWith("exo__")) {
        groups["Core"].push(cls);
      } else {
        groups["Other"].push(cls);
      }
    }

    // Remove empty groups
    return Object.fromEntries(
      Object.entries(groups).filter(([, v]) => v.length > 0)
    );
  }

  private submit(): void {
    if (!this.selectedClass) {
      return; // Don't submit without selection
    }

    this.onSubmit({
      selectedClass: this.selectedClass,
    });
    this.close();
  }

  private cancel(): void {
    this.onSubmit({
      selectedClass: null,
    });
    this.close();
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
