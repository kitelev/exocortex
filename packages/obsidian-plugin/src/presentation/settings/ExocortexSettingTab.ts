import { App, PluginSettingTab, Setting } from "obsidian";
import type ExocortexPlugin from '@plugin/ExocortexPlugin';

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
      .setName("Show labels in File Explorer")
      .setDesc(
        "Display exo__Asset_label instead of filenames in the File Explorer sidebar",
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
  }
}
