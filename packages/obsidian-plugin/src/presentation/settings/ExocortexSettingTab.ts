import { App, PluginSettingTab, Setting } from "obsidian";
import type ExocortexPlugin from '@plugin/ExocortexPlugin';
import {
  DisplayNameTemplateEngine,
  DISPLAY_NAME_PRESETS,
  DEFAULT_DISPLAY_NAME_TEMPLATE,
} from "@plugin/domain/display-name/DisplayNameTemplateEngine";

export class ExocortexSettingTab extends PluginSettingTab {
  plugin: ExocortexPlugin;

  constructor(app: App, plugin: ExocortexPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getOntologyAssets(): string[] {
    const files = this.app.vault.getMarkdownFiles();
    const ontologyAssets: string[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;

      if (!frontmatter) continue;

      // Check if file has exo__Instance_class containing exo__Ontology
      const instanceClass = frontmatter.exo__Instance_class;
      if (!instanceClass) continue;

      const classArray = Array.isArray(instanceClass)
        ? instanceClass
        : [instanceClass];

      const hasOntologyClass = classArray.some(
        (cls: string) =>
          cls === "exo__Ontology" ||
          cls === '"[[exo__Ontology]]"' ||
          cls === "[[exo__Ontology]]",
      );

      if (hasOntologyClass) {
        ontologyAssets.push(file.basename);
      }
    }

    return ontologyAssets.sort((a, b) => a.localeCompare(b));
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Cache ontology assets once per display
    const ontologyAssets = this.getOntologyAssets();

    new Setting(containerEl)
      .setName("Default ontology asset")
      .setDesc("Choose the ontology asset to use for created events")
      .addDropdown((dropdown) => {

        dropdown.addOption("", "None (use events folder)");
        
        ontologyAssets.forEach((assetName) => {
          dropdown.addOption(assetName, assetName);
        });
        
        dropdown
          .setValue(this.plugin.settings.defaultOntologyAsset || "")
          .onChange(async (value) => {
            this.plugin.settings.defaultOntologyAsset = value || null;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Show layout")
      .setDesc("Display the automatic layout below metadata in reading mode")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.layoutVisible)
          .onChange(async (value) => {
            this.plugin.settings.layoutVisible = value;
            await this.plugin.saveSettings();
            this.plugin.refreshLayout();
          }),
      );

    new Setting(containerEl)
      .setName("Show properties section")
      .setDesc("Display the properties table in the layout")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPropertiesSection)
          .onChange(async (value) => {
            this.plugin.settings.showPropertiesSection = value;
            await this.plugin.saveSettings();
            this.plugin.refreshLayout();
          }),
      );

    new Setting(containerEl)
      .setName("Show archived assets")
      .setDesc(
        "Display archived assets in relations table with visual distinction",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showArchivedAssets)
          .onChange(async (value) => {
            this.plugin.settings.showArchivedAssets = value;
            await this.plugin.saveSettings();
            this.plugin.refreshLayout();
          }),
      );

    new Setting(containerEl)
      .setName("Show projects in daily notes")
      .setDesc(
        "Display the projects section in the layout for daily notes",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDailyNoteProjects)
          .onChange(async (value) => {
            this.plugin.settings.showDailyNoteProjects = value;
            await this.plugin.saveSettings();
            this.plugin.refreshLayout();
          }),
      );

    new Setting(containerEl)
      .setName("Use dynamic property fields")
      .setDesc(
        "Generate modal fields from ontology (experimental)",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useDynamicPropertyFields)
          .onChange(async (value) => {
            this.plugin.settings.useDynamicPropertyFields = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show labels in file explorer")
      .setDesc(
        "Display asset labels instead of filenames in the file explorer sidebar",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabelsInFileExplorer)
          .onChange(async (value) => {
            this.plugin.settings.showLabelsInFileExplorer = value;
            await this.plugin.saveSettings();
            this.plugin.toggleFileExplorerLabels(value);
          }),
      );

    new Setting(containerEl)
      .setName("Show labels in tab titles")
      .setDesc(
        "Display asset labels instead of filenames in tab headers",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabelsInTabTitles)
          .onChange(async (value) => {
            this.plugin.settings.showLabelsInTabTitles = value;
            await this.plugin.saveSettings();
            this.plugin.toggleTabTitleLabels(value);
          }),
      );

    // Display Name Template section
    containerEl.createEl("h3", { text: "Display Name Template" });

    // Preview element for the template
    const previewEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    previewEl.style.marginBottom = "16px";
    previewEl.style.padding = "8px";
    previewEl.style.backgroundColor = "var(--background-secondary)";
    previewEl.style.borderRadius = "4px";
    this.updateTemplatePreview(previewEl, this.plugin.settings.displayNameTemplate);

    new Setting(containerEl)
      .setName("Template presets")
      .setDesc("Choose a common template pattern")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Custom...");
        Object.entries(DISPLAY_NAME_PRESETS).forEach(([key, preset]) => {
          dropdown.addOption(key, preset.name);
        });

        // Set current selection based on template value
        const currentTemplate = this.plugin.settings.displayNameTemplate;
        const matchingPreset = Object.entries(DISPLAY_NAME_PRESETS).find(
          ([_, preset]) => preset.template === currentTemplate
        );
        dropdown.setValue(matchingPreset ? matchingPreset[0] : "");

        dropdown.onChange(async (value) => {
          if (value && value in DISPLAY_NAME_PRESETS) {
            const preset = DISPLAY_NAME_PRESETS[value as keyof typeof DISPLAY_NAME_PRESETS];
            this.plugin.settings.displayNameTemplate = preset.template;
            await this.plugin.saveSettings();
            this.plugin.applyDisplayNameTemplate();
            this.updateTemplatePreview(previewEl, preset.template);
            // Refresh to update the text input
            this.display();
          }
        });
      });

    new Setting(containerEl)
      .setName("Custom template")
      .setDesc(
        "Use {{field}} placeholders for frontmatter values. " +
        "Special variables: {{_basename}} (filename), {{_created}} (creation date)"
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_DISPLAY_NAME_TEMPLATE)
          .setValue(this.plugin.settings.displayNameTemplate)
          .onChange(async (value) => {
            const template = value.trim() || DEFAULT_DISPLAY_NAME_TEMPLATE;
            this.plugin.settings.displayNameTemplate = template;
            await this.plugin.saveSettings();
            this.plugin.applyDisplayNameTemplate();
            this.updateTemplatePreview(previewEl, template);
          }),
      );

    // Template syntax help
    const helpEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    helpEl.innerHTML = `
      <strong>Available placeholders:</strong>
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li><code>{{exo__Asset_label}}</code> - Asset label</li>
        <li><code>{{exo__Instance_class}}</code> - Asset class (Task, Project, etc.)</li>
        <li><code>{{ems__Effort_status}}</code> - Current effort status</li>
        <li><code>{{_basename}}</code> - Original filename</li>
        <li><code>{{_created}}</code> - File creation date</li>
        <li><code>{{field.nested}}</code> - Dot notation for nested fields</li>
      </ul>
    `;
  }

  private updateTemplatePreview(previewEl: HTMLElement, template: string): void {
    const engine = new DisplayNameTemplateEngine(template);
    const sampleMetadata = {
      exo__Asset_label: "Sample Task",
      exo__Instance_class: "ems__Task",
      ems__Effort_status: "🟡 IN_PROGRESS",
    };
    const preview = engine.render(sampleMetadata, "sample-file", new Date());

    if (preview) {
      previewEl.innerHTML = `<strong>Preview:</strong> ${preview}`;
    } else {
      previewEl.innerHTML = `<strong>Preview:</strong> <em>(empty - will fall back to label or filename)</em>`;
    }
  }
}
