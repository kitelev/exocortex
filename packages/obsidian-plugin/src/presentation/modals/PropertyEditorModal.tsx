import { Modal, App, Notice, TFile } from "obsidian";
import React from "react";
import { FrontmatterService } from "exocortex";
import { ExocortexPluginInterface } from '@plugin/types';
import { ReactRenderer } from '@plugin/presentation/utils/ReactRenderer';
import { PropertyEditorForm } from '@plugin/presentation/components/property-editor/PropertyEditorForm';
import { ErrorBoundary } from '@plugin/presentation/components/ErrorBoundary';
import { formatPropertyValue } from '@plugin/domain/property-editor/formatPropertyValue';
import { extractInstanceClass } from '@plugin/domain/property-editor/extractInstanceClass';

export class PropertyEditorModal extends Modal {
  private plugin: ExocortexPluginInterface;
  private reactRenderer: ReactRenderer;
  private file: TFile;
  private frontmatter: Record<string, unknown>;
  private instanceClass: string;

  constructor(
    app: App,
    plugin: ExocortexPluginInterface,
    file: TFile,
    frontmatter: Record<string, unknown>,
  ) {
    super(app);
    this.plugin = plugin;
    this.reactRenderer = new ReactRenderer();
    this.file = file;
    this.frontmatter = frontmatter;
    this.instanceClass = extractInstanceClass(frontmatter);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("property-editor-modal");

    const titleEl = contentEl.createEl("div", { cls: "modal-title" });
    titleEl.textContent = "Edit properties";

    const subtitleEl = contentEl.createEl("div", { cls: "property-editor-subtitle" });
    subtitleEl.textContent = `${this.file.basename} (${this.instanceClass})`;

    const container = contentEl.createEl("div", { cls: "property-editor-container" });

    this.reactRenderer.render(
      container,
      React.createElement(
        ErrorBoundary,
        {
          children: React.createElement(PropertyEditorForm, {
            instanceClass: this.instanceClass,
            frontmatter: this.frontmatter,
            onSave: this.handleSave.bind(this),
            onCancel: this.handleCancel.bind(this),
          }),
          onError: (error: Error) => {
            console.error("[Exocortex Property Editor] Error:", error);
            new Notice(`Error in property editor: ${error.message}`);
          },
        },
      ),
    );
  }

  private async handleSave(updatedFrontmatter: Record<string, unknown>): Promise<void> {
    try {
      let fileContent = await this.app.vault.read(this.file);
      const frontmatterService = new FrontmatterService();

      for (const [key, value] of Object.entries(updatedFrontmatter)) {
        const formattedValue = formatPropertyValue(value);
        fileContent = frontmatterService.updateProperty(
          fileContent,
          key,
          formattedValue,
        );
      }

      await this.app.vault.modify(this.file, fileContent);
      new Notice("Properties saved successfully");
      this.close();
      this.plugin.refreshLayout?.();
    } catch (error) {
      console.error("[Exocortex Property Editor] Save error:", error);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to save properties: ${message}`, 5000);
    }
  }

  private handleCancel(): void {
    this.close();
  }

  override onClose(): void {
    const { contentEl } = this;
    this.reactRenderer.unmount(contentEl);
    contentEl.empty();
  }
}
