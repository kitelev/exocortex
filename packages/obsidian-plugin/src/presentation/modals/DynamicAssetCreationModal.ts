import { App, Modal, Setting } from "obsidian";
import type { LabelInputModalResult } from "./LabelInputModal";
import type {
  OntologySchemaService,
  OntologyPropertyDefinition,
} from '@plugin/application/services/OntologySchemaService';
import { PropertyFieldType, FilenameValidator } from "exocortex";
import {
  PropertyFieldFactory,
  type PropertyFieldInstance,
} from '@plugin/presentation/components/property-fields';
import { LoggerFactory } from '@plugin/adapters/logging/LoggerFactory';

/**
 * Result from DynamicAssetCreationModal
 * Extends base result with additional property values from dynamic fields
 */
export interface DynamicAssetCreationResult extends LabelInputModalResult {
  /** Additional property values collected from dynamic fields */
  propertyValues: Record<string, unknown>;
}

/**
 * Dynamic modal for creating assets with ontology-driven fields.
 *
 * When provided with an OntologySchemaService, queries class properties
 * from the RDF ontology and renders appropriate field types dynamically.
 * Falls back to basic fields (label + task size) when no schema service available.
 *
 * @example
 * ```typescript
 * // With schema service (Phase 2 - dynamic fields)
 * const modal = new DynamicAssetCreationModal(
 *   this.app,
 *   'ems__Task',
 *   (result) => {
 *     if (result.label !== null) {
 *       // Create asset with result.label, result.taskSize, result.propertyValues
 *     }
 *   },
 *   schemaService // Optional - enables dynamic field rendering
 * );
 * modal.open();
 *
 * // Without schema service (Phase 1 - basic fields only)
 * const basicModal = new DynamicAssetCreationModal(
 *   this.app,
 *   'ems__Task',
 *   (result) => { ... }
 * );
 * basicModal.open();
 * ```
 */
export class DynamicAssetCreationModal extends Modal {
  private label = "";
  private taskSize: string | null = null;
  private openInNewTab = false;
  private propertyValues: Record<string, unknown> = {};
  private inputEl: HTMLInputElement | null = null;
  private properties: OntologyPropertyDefinition[] = [];
  private fieldFactory: PropertyFieldFactory;
  private createdFields: PropertyFieldInstance[] = [];
  private readonly logger = LoggerFactory.create("DynamicAssetCreationModal");

  constructor(
    app: App,
    private className: string,
    private onSubmit: (result: DynamicAssetCreationResult) => void,
    private schemaService?: OntologySchemaService,
  ) {
    super(app);
    this.fieldFactory = new PropertyFieldFactory(app);
  }

  override onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("exocortex-dynamic-asset-modal");

    // Title based on class name
    const displayClassName = this.getDisplayClassName(this.className);
    contentEl.createEl("h2", { text: `Create ${displayClassName}` });

    // If schema service is provided, load properties dynamically
    if (this.schemaService) {
      this.loadPropertiesAndRender(contentEl);
    } else {
      // Fallback to basic fields
      this.renderBasicFields(contentEl);
      this.renderButtons(contentEl);
      this.focusInput();
    }
  }

  /**
   * Load properties from schema service and render fields.
   */
  private async loadPropertiesAndRender(contentEl: HTMLElement): Promise<void> {
    // Show loading indicator
    const loadingEl = contentEl.createDiv({ cls: "loading-message" });
    loadingEl.setText("Loading properties...");

    try {
      // Fetch properties from ontology
      this.properties = await this.schemaService!.getClassProperties(
        this.className,
      );

      // Filter out deprecated properties
      const activeProperties = this.properties.filter((p) => !p.deprecated);

      // Remove loading indicator
      loadingEl.remove();

      // If no properties found, use defaults
      if (activeProperties.length === 0) {
        const defaultProps =
          this.schemaService!.getDefaultProperties(this.className);
        this.renderDynamicFields(contentEl, defaultProps);
      } else {
        this.renderDynamicFields(contentEl, activeProperties);
      }

      // Always show open in new tab toggle
      this.renderOpenInNewTabToggle(contentEl);

      this.renderButtons(contentEl);
      this.focusInput();
    } catch (error) {
      this.logger.warn("Failed to load properties, falling back to basic fields", error);
      loadingEl.remove();
      this.renderBasicFields(contentEl);
      this.renderButtons(contentEl);
      this.focusInput();
    }
  }

  /**
   * Render fields dynamically based on property definitions.
   */
  private renderDynamicFields(
    contentEl: HTMLElement,
    properties: OntologyPropertyDefinition[],
  ): void {
    for (const prop of properties) {
      this.renderPropertyField(contentEl, prop);
    }
  }

  /**
   * Render a single property field based on its type.
   * Uses PropertyFieldFactory for advanced field types like Reference with autocomplete.
   */
  private renderPropertyField(
    contentEl: HTMLElement,
    prop: OntologyPropertyDefinition,
  ): void {
    // Use factory for reference fields to get autocomplete support
    if (prop.fieldType === PropertyFieldType.Reference) {
      const field = this.fieldFactory.create({
        containerEl: contentEl,
        property: {
          uri: prop.uri,
          name: prop.uri,
          label: prop.label,
          fieldType: PropertyFieldType.Reference,
          description: prop.description,
          required: prop.required,
        },
        value: this.propertyValues[prop.uri] || "",
        onChange: (value) => {
          this.propertyValues[prop.uri] = value;
        },
        app: this.app,
      });
      this.createdFields.push(field);
      return;
    }

    // Use factory for date fields
    if (prop.fieldType === PropertyFieldType.Date) {
      const field = this.fieldFactory.create({
        containerEl: contentEl,
        property: {
          uri: prop.uri,
          name: prop.uri,
          label: prop.label,
          fieldType: PropertyFieldType.Date,
          description: prop.description,
          required: prop.required,
        },
        value: this.propertyValues[prop.uri] || "",
        onChange: (value) => {
          this.propertyValues[prop.uri] = value;
        },
      });
      this.createdFields.push(field);
      return;
    }

    // Use factory for datetime fields
    if (prop.fieldType === PropertyFieldType.DateTime) {
      const field = this.fieldFactory.create({
        containerEl: contentEl,
        property: {
          uri: prop.uri,
          name: prop.uri,
          label: prop.label,
          fieldType: PropertyFieldType.DateTime,
          description: prop.description,
          required: prop.required,
        },
        value: this.propertyValues[prop.uri] || "",
        onChange: (value) => {
          this.propertyValues[prop.uri] = value;
        },
      });
      this.createdFields.push(field);
      return;
    }

    // For other field types, use the existing inline rendering
    const setting = new Setting(contentEl)
      .setName(prop.label)
      .setDesc(prop.description || prop.uri);

    switch (prop.fieldType) {
      case "text":
        this.renderTextField(setting, prop);
        break;

      case "timestamp":
        this.renderDateTimeField(setting, prop);
        break;

      case "number":
        this.renderNumberField(setting, prop);
        break;

      case "boolean":
        this.renderBooleanField(setting, prop);
        break;

      case "status-select":
        this.renderStatusSelectField(setting, prop);
        break;

      case "size-select":
        this.renderSizeSelectField(setting, prop);
        break;

      case "wikilink":
        this.renderWikilinkField(setting, prop);
        break;

      default:
        // Default to text field for unknown types
        this.renderTextField(setting, prop);
    }
  }

  /**
   * Render a text input field.
   */
  private renderTextField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    setting.addText((text) => {
      // Special handling for label field
      if (prop.uri === "exo__Asset_label") {
        this.inputEl = text.inputEl;
        text
          .setPlaceholder("Enter label...")
          .setValue(this.label)
          .onChange((value) => {
            this.label = value;
            this.propertyValues[prop.uri] = value;
          });

        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            this.cancel();
          }
        });
      } else {
        text
          .setPlaceholder(`Enter ${prop.label.toLowerCase()}...`)
          .setValue(String(this.propertyValues[prop.uri] || ""))
          .onChange((value) => {
            this.propertyValues[prop.uri] = value;
          });
      }
    });
  }

  /**
   * Render a datetime input field.
   */
  private renderDateTimeField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    setting.addText((text) => {
      text.inputEl.type = "datetime-local";
      text
        .setValue(String(this.propertyValues[prop.uri] || ""))
        .onChange((value) => {
          this.propertyValues[prop.uri] = value;
        });
    });
  }

  /**
   * Render a number input field.
   */
  private renderNumberField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    setting.addText((text) => {
      text.inputEl.type = "number";
      text
        .setValue(String(this.propertyValues[prop.uri] || ""))
        .onChange((value) => {
          const numValue = parseFloat(value);
          this.propertyValues[prop.uri] = isNaN(numValue) ? null : numValue;
        });
    });
  }

  /**
   * Render a boolean toggle field.
   */
  private renderBooleanField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    setting.addToggle((toggle) => {
      toggle
        .setValue(Boolean(this.propertyValues[prop.uri]))
        .onChange((value) => {
          this.propertyValues[prop.uri] = value;
        });
    });
  }

  /**
   * Render a status select field.
   */
  private renderStatusSelectField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    const selectContainer = setting.controlEl.createEl("select", {
      cls: "dropdown",
    });

    const statusOptions = [
      { value: "", label: "Not specified" },
      { value: '"[[ems__EffortStatus_Draft]]"', label: "Draft" },
      { value: '"[[ems__EffortStatus_Active]]"', label: "Active" },
      { value: '"[[ems__EffortStatus_Done]]"', label: "Done" },
      { value: '"[[ems__EffortStatus_Cancelled]]"', label: "Cancelled" },
    ];

    statusOptions.forEach((option) => {
      selectContainer.createEl("option", {
        value: option.value,
        text: option.label,
      });
    });

    selectContainer.addEventListener("change", (e) => {
      const selectedValue = (e.target as HTMLSelectElement).value;
      this.propertyValues[prop.uri] = selectedValue || null;
    });
  }

  /**
   * Render a task size select field.
   */
  private renderSizeSelectField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    const selectContainer = setting.controlEl.createEl("select", {
      cls: "dropdown",
    });

    const taskSizeOptions = [
      { value: "", label: "Not specified" },
      { value: '"[[ems__TaskSize_XXS]]"', label: "XXS" },
      { value: '"[[ems__TaskSize_XS]]"', label: "XS" },
      { value: '"[[ems__TaskSize_S]]"', label: "S" },
      { value: '"[[ems__TaskSize_M]]"', label: "M" },
    ];

    taskSizeOptions.forEach((option) => {
      selectContainer.createEl("option", {
        value: option.value,
        text: option.label,
      });
    });

    selectContainer.addEventListener("change", (e) => {
      const selectedValue = (e.target as HTMLSelectElement).value;
      // For ems__Effort_taskSize, also update taskSize for backward compatibility
      if (prop.uri === "ems__Effort_taskSize") {
        this.taskSize = selectedValue || null;
      }
      this.propertyValues[prop.uri] = selectedValue || null;
    });
  }

  /**
   * Render a wikilink reference field.
   */
  private renderWikilinkField(
    setting: Setting,
    prop: OntologyPropertyDefinition,
  ): void {
    setting.addText((text) => {
      text
        .setPlaceholder("[[Note name]]") // eslint-disable-line obsidianmd/ui/sentence-case
        .setValue(String(this.propertyValues[prop.uri] || ""))
        .onChange((value) => {
          // Auto-wrap in wikilink syntax if not already
          let formattedValue = value.trim();
          if (formattedValue && !formattedValue.startsWith("[[")) {
            formattedValue = `[[${formattedValue}]]`;
          }
          this.propertyValues[prop.uri] = formattedValue || null;
        });
    });
  }

  /**
   * Render the open in new tab toggle.
   */
  private renderOpenInNewTabToggle(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName("Open in new tab")
      .setDesc("Open the created asset in a new tab instead of the current one")
      .addToggle((toggle) => {
        toggle.setValue(this.openInNewTab).onChange((value) => {
          this.openInNewTab = value;
        });
      });
  }

  /**
   * Renders basic fields for fallback when no schema service available.
   */
  private renderBasicFields(contentEl: HTMLElement): void {
    // Label field
    new Setting(contentEl)
      .setName("Label")
      .setDesc("Display label for the new asset (optional)")
      .addText((text) => {
        this.inputEl = text.inputEl;
        text
          .setPlaceholder("Enter label...")
          .setValue(this.label)
          .onChange((value) => {
            this.label = value;
          });

        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            this.cancel();
          }
        });
      });

    // Task size field (only for Task class)
    if (this.isTaskClass(this.className)) {
      const taskSizeSetting = new Setting(contentEl)
        .setName("Task size")
        .setDesc("Estimated size of the task");

      const selectContainer = taskSizeSetting.controlEl.createEl("select", {
        cls: "dropdown",
      });

      const taskSizeOptions = [
        { value: "", label: "Not specified" },
        { value: '"[[ems__TaskSize_XXS]]"', label: "XXS" },
        { value: '"[[ems__TaskSize_XS]]"', label: "XS" },
        { value: '"[[ems__TaskSize_S]]"', label: "S" },
        { value: '"[[ems__TaskSize_M]]"', label: "M" },
      ];

      taskSizeOptions.forEach((option) => {
        selectContainer.createEl("option", {
          value: option.value,
          text: option.label,
        });
      });

      selectContainer.addEventListener("change", (e) => {
        const selectedValue = (e.target as HTMLSelectElement).value;
        this.taskSize = selectedValue || null;
      });
    }

    // Open in new tab checkbox
    new Setting(contentEl)
      .setName("Open in new tab")
      .setDesc("Open the created asset in a new tab instead of the current one")
      .addToggle((toggle) => {
        toggle.setValue(this.openInNewTab).onChange((value) => {
          this.openInNewTab = value;
        });
      });
  }

  /**
   * Render submit and cancel buttons.
   */
  private renderButtons(contentEl: HTMLElement): void {
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
  }

  /**
   * Focus on the first input field.
   */
  private focusInput(): void {
    setTimeout(() => {
      this.inputEl?.focus();
    }, 50);
  }

  /**
   * Checks if the class is a Task class (or subclass of Task).
   */
  private isTaskClass(className: string): boolean {
    return className === "ems__Task" || className.startsWith("ems__Task_");
  }

  /**
   * Converts internal class name to human-readable display name.
   */
  private getDisplayClassName(className: string): string {
    // Remove prefix (ems__, exo__, etc.)
    const withoutPrefix = className.replace(/^[a-z]+__/, "");
    // Convert underscores to spaces and add proper spacing for camelCase
    return withoutPrefix
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
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
      propertyValues: this.propertyValues,
    });
    this.close();
  }

  private cancel(): void {
    this.onSubmit({
      label: null,
      taskSize: null,
      openInNewTab: this.openInNewTab,
      propertyValues: {},
    });
    this.close();
  }

  override onClose(): void {
    const { contentEl } = this;
    // Cleanup created field instances
    this.fieldFactory.destroyAll(this.createdFields);
    this.createdFields = [];
    contentEl.empty();
  }
}
