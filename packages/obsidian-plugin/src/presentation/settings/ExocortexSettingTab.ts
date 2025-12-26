import { App, PluginSettingTab, Setting } from "obsidian";
import type ExocortexPlugin from '@plugin/ExocortexPlugin';
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import { DEFAULT_DISPLAY_NAME_SETTINGS, type DisplayNameSettings } from "@plugin/domain/settings/ExocortexSettings";

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

    new Setting(containerEl)
      .setName("Show labels in properties block")
      .setDesc(
        "Display asset labels instead of filenames in the Properties block links",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabelsInProperties)
          .onChange(async (value) => {
            this.plugin.settings.showLabelsInProperties = value;
            await this.plugin.saveSettings();
            this.plugin.togglePropertiesLabels(value);
          }),
      );

    new Setting(containerEl)
      .setName("Sort file explorer by display name")
      .setDesc(
        "Sort files by their display name (exo__Asset_label) instead of filename. " +
        "Useful for vaults with UUID-based filenames. Folders are always shown first.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sortByDisplayName)
          .onChange(async (value) => {
            this.plugin.settings.sortByDisplayName = value;
            await this.plugin.saveSettings();
            this.plugin.toggleFileExplorerSort(value);
          }),
      );

    // Display Name Template section
    new Setting(containerEl)
      .setName("Display name templates")
      .setHeading();

    // Ensure displayNameSettings is initialized
    if (!this.plugin.settings.displayNameSettings) {
      this.plugin.settings.displayNameSettings = { ...DEFAULT_DISPLAY_NAME_SETTINGS };
    }

    const displayNameSettings = this.plugin.settings.displayNameSettings;

    // Preview element for the templates
    const previewEl = containerEl.createDiv({
      cls: "exocortex-template-preview",
    });
    this.updatePerClassPreview(previewEl, displayNameSettings);

    // Default template
    new Setting(containerEl)
      .setName("Default template")
      .setDesc("Template used when no class-specific template is defined")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_DISPLAY_NAME_TEMPLATE)
          .setValue(displayNameSettings.defaultTemplate)
          .onChange(async (value) => {
            const template = value.trim() || DEFAULT_DISPLAY_NAME_TEMPLATE;
            displayNameSettings.defaultTemplate = template;
            await this.plugin.saveSettings();
            this.plugin.applyDisplayNameTemplate();
            this.updatePerClassPreview(previewEl, displayNameSettings);
          }),
      );

    // Per-class templates section
    new Setting(containerEl)
      .setName("Per-class templates")
      .setHeading();

    const classTemplatesDesc = containerEl.createDiv({ cls: "setting-item-description" });
    const classTemplatesP = classTemplatesDesc.createEl("p");
    classTemplatesP.appendText("Configure different display name templates for each asset class. Use ");
    classTemplatesP.createEl("code", { text: "{{statusEmoji}}" });
    classTemplatesP.appendText(" to show status as an emoji (e.g., 🟢 for Active).");

    // Common classes to configure
    const commonClasses = [
      { key: "ems__Task", name: "Task" },
      { key: "ems__TaskPrototype", name: "Task Prototype" },
      { key: "ems__Project", name: "Project" },
      { key: "ems__Area", name: "Area" },
      { key: "ems__Meeting", name: "Meeting" },
      { key: "ems__MeetingPrototype", name: "Meeting Prototype" },
    ];

    for (const { key, name } of commonClasses) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(`Template for ${name} assets`)
        .addText((text) =>
          text
            .setPlaceholder(displayNameSettings.defaultTemplate)
            .setValue(displayNameSettings.classTemplates[key] || "")
            .onChange(async (value) => {
              const template = value.trim();
              if (template) {
                displayNameSettings.classTemplates[key] = template;
              } else {
                delete displayNameSettings.classTemplates[key];
              }
              await this.plugin.saveSettings();
              this.plugin.applyDisplayNameTemplate();
              this.updatePerClassPreview(previewEl, displayNameSettings);
            }),
        );
    }

    // Status emoji configuration
    new Setting(containerEl)
      .setName("Status emoji mapping")
      .setHeading();

    const statusEmojiDesc = containerEl.createDiv({ cls: "setting-item-description" });
    const statusEmojiP = statusEmojiDesc.createEl("p");
    statusEmojiP.appendText("Map status values to emojis for use with ");
    statusEmojiP.createEl("code", { text: "{{statusEmoji}}" });
    statusEmojiP.appendText(".");

    const commonStatuses = [
      { key: "DOING", name: "Doing/Active", defaultEmoji: "🟢" },
      { key: "DONE", name: "Done/Completed", defaultEmoji: "✅" },
      { key: "BLOCKED", name: "Blocked", defaultEmoji: "🔴" },
      { key: "BACKLOG", name: "Backlog/Pending", defaultEmoji: "📋" },
      { key: "TRASHED", name: "Trashed/Cancelled", defaultEmoji: "🗑️" },
    ];

    for (const { key, name, defaultEmoji } of commonStatuses) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(`Emoji for "${key}" status`)
        .addText((text) =>
          text
            .setPlaceholder(defaultEmoji)
            .setValue(displayNameSettings.statusEmojis[key] || "")
            .onChange(async (value) => {
              const emoji = value.trim();
              if (emoji) {
                displayNameSettings.statusEmojis[key] = emoji;
              } else {
                delete displayNameSettings.statusEmojis[key];
              }
              await this.plugin.saveSettings();
              this.plugin.applyDisplayNameTemplate();
              this.updatePerClassPreview(previewEl, displayNameSettings);
            }),
        );
    }

    // Reset to defaults button
    new Setting(containerEl)
      .setName("Reset to defaults")
      .setDesc("Reset all display name templates to default values")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .onClick(async () => {
            this.plugin.settings.displayNameSettings = { ...DEFAULT_DISPLAY_NAME_SETTINGS };
            await this.plugin.saveSettings();
            this.plugin.applyDisplayNameTemplate();
            this.display(); // Refresh UI
          }),
      );

    // Template syntax help
    const helpEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    helpEl.createEl("strong", { text: "Available placeholders:" });
    const placeholderList = helpEl.createEl("ul", { cls: "exocortex-placeholder-list" });
    const placeholders = [
      { code: "{{exo__Asset_label}}", desc: "Asset label" },
      { code: "{{exo__Instance_class}}", desc: "Asset class (Task, Project, etc.)" },
      { code: "{{ems__Effort_status}}", desc: "Current effort status" },
      { code: "{{statusEmoji}}", desc: "Status as emoji (🟢, ✅, 🔴, etc.)" },
      { code: "{{_basename}}", desc: "Original filename" },
      { code: "{{_created}}", desc: "File creation date" },
      { code: "{{field.nested}}", desc: "Dot notation for nested fields" },
    ];
    for (const { code, desc } of placeholders) {
      const li = placeholderList.createEl("li");
      li.createEl("code", { text: code });
      li.appendText(` - ${desc}`);
    }
  }

  /**
   * Update the per-class template preview
   */
  private updatePerClassPreview(previewEl: HTMLElement, settings: DisplayNameSettings): void {
    const resolver = new DisplayNameResolver(settings);

    const sampleAssets = [
      {
        metadata: { exo__Asset_label: "Fix bug", exo__Instance_class: "ems__Task", ems__Effort_status: "DOING" },
        basename: "fix-bug-123",
        name: "Task",
      },
      {
        metadata: { exo__Asset_label: "Morning routine", exo__Instance_class: "ems__TaskPrototype" },
        basename: "morning-routine",
        name: "TaskPrototype",
      },
      {
        metadata: { exo__Asset_label: "Alpha Project", exo__Instance_class: "ems__Project" },
        basename: "alpha-project",
        name: "Project",
      },
    ];

    // Clear existing content
    previewEl.empty();

    previewEl.createEl("strong", { text: "Preview:" });
    const previewList = previewEl.createEl("ul", { cls: "exocortex-preview-list" });

    for (const { metadata, basename, name } of sampleAssets) {
      const displayName = resolver.resolve({ metadata, basename, createdDate: new Date() });
      const li = previewList.createEl("li");
      li.createEl("strong", { text: `${name}: ` });
      li.appendText(displayName || "(empty)");
    }
  }
}
