import { App, PluginSettingTab, Setting } from "obsidian";
import type ExocortexPlugin from "@plugin/ExocortexPlugin";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import {
  DEFAULT_DISPLAY_NAME_SETTINGS,
  DEFAULT_LOG_CHANNELS,
  type DisplayNameSettings,
  type LogLevel,
} from "@plugin/domain/settings/ExocortexSettings";

export class ExocortexSettingTab extends PluginSettingTab {
  plugin: ExocortexPlugin;

  constructor(app: App, plugin: ExocortexPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

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
      .setName("Auto-adjust planned end time")
      .setDesc(
        "Automatically shift plannedEndTimestamp when plannedStartTimestamp changes. " +
          "Disable if using Obsidian Sync to prevent duplicate shifts.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoAdjustPlannedEndTimestamp)
          .onChange(async (value) => {
            this.plugin.settings.autoAdjustPlannedEndTimestamp = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show labels in tab titles")
      .setDesc("Display asset labels instead of filenames in tab headers")
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
        "Display asset labels instead of filenames in the properties block links",
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
      .setName("Replace predicate names with display labels")
      .setDesc(
        "In the Properties block, replace raw predicate keys " +
          "(e.g. ems__Effort_area) with a clickable label resolved from the " +
          "property's exo__Property_displayName (fallback exo__Asset_label). " +
          "Clicking the label opens the property-definition asset. When " +
          "disabled, predicate keys render as raw frontmatter names.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enablePropertiesLabelPatch)
          .onChange(async (value) => {
            this.plugin.settings.enablePropertiesLabelPatch = value;
            await this.plugin.saveSettings();
            this.plugin.togglePropertiesLabelPatch(value);
          }),
      );

    // RFC c7da0bca Phase 3c-3 — deleted the "Enable exocmd bindings
    // cache indexer on mobile" toggle. The indexer it gated was
    // deleted in 3c-2; the toggle had no effect after that PR landed.

    new Setting(containerEl)
      .setName("Enable custom layouts")
      .setDesc(
        "Render class-specific layouts defined via exo__Layout assets. " +
          "When disabled, the plugin falls back to the default Asset Relations section.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableExoLayoutRenderer)
          .onChange(async (value) => {
            this.plugin.settings.enableExoLayoutRenderer = value;
            await this.plugin.saveSettings();
            this.plugin.refreshLayout();
          }),
      );

    new Setting(containerEl)
      .setName("Show class icons in file explorer")
      .setDesc(
        "Render Lucide icons next to file explorer rows for notes whose " +
          "exo__Instance_class resolves to an exo__Layout_icon. " +
          "Skips rows already iconized by the Iconize community plugin.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showIconsInFileExplorer)
          .onChange(async (value) => {
            this.plugin.settings.showIconsInFileExplorer = value;
            await this.plugin.saveSettings();
            this.plugin.toggleFileExplorerIcons(value);
          }),
      );

    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "SPARQL" is an established acronym
      .setName("Auto-execute SPARQL code blocks")
      .setDesc(
        "When enabled, sparql and exoql code blocks are executed as queries " +
          "during note rendering. When disabled (default), those code blocks " +
          "render as plain code so SPARQL snippets can be pasted for " +
          "documentation or reference without side effects. Issue #2992.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableSparqlAutoExecute)
          .onChange(async (value) => {
            this.plugin.settings.enableSparqlAutoExecute = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "SHACL" is an established acronym
      .setName("Enable SHACL validation (experimental)")
      .setDesc(
        "When enabled, validates frontmatter properties against SHACL shapes " +
          "on every file save (50ms debounce). Violations are logged as warnings. " +
          "Default off in v15.x.0; will be enabled by default after soak period.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableShaclValidation)
          .onChange(async (value) => {
            this.plugin.settings.enableShaclValidation = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto reading mode for exocortex assets")
      .setDesc(
        "When opening a note with the `exo__Instance_class` frontmatter property, automatically switch to reading mode so the exocortex layout (create / status / planning panels) is visible. Disable to keep obsidian's default view mode.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoReadingModeForExocortexAssets)
          .onChange(async (value) => {
            this.plugin.settings.autoReadingModeForExocortexAssets = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show labels in note body")
      .setDesc(
        "Display asset labels instead of filenames for links in the note body (reading mode)",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabelsInBody)
          .onChange(async (value) => {
            this.plugin.settings.showLabelsInBody = value;
            await this.plugin.saveSettings();
            this.plugin.toggleBodyLabels(value);
          }),
      );

    new Setting(containerEl)
      .setName("Show labels in graph view")
      .setDesc(
        "Display asset labels instead of filenames for nodes in Obsidian's graph view",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabelsInGraphView)
          .onChange(async (value) => {
            this.plugin.settings.showLabelsInGraphView = value;
            await this.plugin.saveSettings();
            this.plugin.toggleGraphViewLabels(value);
          }),
      );

    new Setting(containerEl)
      .setName("Show labels in live preview")
      .setDesc(
        "Display asset labels instead of UUIDs for wikilinks in live preview mode (edit mode). " +
          "When enabled, [[uuid]] will show as 'Asset Label' while editing.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLabelsInLivePreview)
          .onChange(async (value) => {
            this.plugin.settings.showLabelsInLivePreview = value;
            await this.plugin.saveSettings();
            // Setting change triggers decoration rebuild via settings reference
          }),
      );

    // Excluded folders section — files inside these folders are skipped
    // entirely by the RDF indexer and SHACL-lite validation.
    this.renderExcludedFoldersSection(containerEl);

    // Logging section
    this.renderLogChannelsSection(containerEl);

    // Display Name Template section
    new Setting(containerEl).setName("Display name templates").setHeading();

    // Ensure displayNameSettings is initialized
    if (!this.plugin.settings.displayNameSettings) {
      this.plugin.settings.displayNameSettings = {
        ...DEFAULT_DISPLAY_NAME_SETTINGS,
      };
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
    new Setting(containerEl).setName("Per-class templates").setHeading();

    const classTemplatesDesc = containerEl.createDiv({
      cls: "setting-item-description",
    });
    const classTemplatesP = classTemplatesDesc.createEl("p");
    classTemplatesP.appendText(
      "Configure different display name templates for each asset class.",
    );

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

    // Reset to defaults button
    new Setting(containerEl)
      .setName("Reset to defaults")
      .setDesc("Reset all display name templates to default values")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings.displayNameSettings = {
            ...DEFAULT_DISPLAY_NAME_SETTINGS,
          };
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
    const placeholderList = helpEl.createEl("ul", {
      cls: "exocortex-placeholder-list",
    });
    const placeholders = [
      { code: "{{exo__Asset_label}}", desc: "Asset label" },
      {
        code: "{{exo__Instance_class}}",
        desc: "Asset class (Task, Project, etc.)",
      },
      { code: "{{ems__Effort_status}}", desc: "Current effort status" },
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
   * Render the "Excluded folders" section.
   *
   * Each non-empty line in the textarea is treated as a vault-relative
   * path-prefix. Files whose path starts with any of these prefixes are
   * excluded from RDF indexing AND SHACL-lite validation, so they never
   * produce the "Skipping file with invariant violation" Notice.
   *
   * The default `"09 Templates/"` matches Obsidian's conventional templates
   * folder, whose contents typically violate Exocortex invariants by design.
   * Users can add, edit, or remove entries; an empty textarea clears all
   * exclusions.
   *
   * Changes take effect on the next vault re-index (full Obsidian reload or
   * manual cache refresh). A reload Notice could be added later, but is not
   * required for correctness — live edits to files outside excluded folders
   * keep working immediately because `VaultRDFIndexer.updateFile` consults
   * the prefix list it captured at construction time.
   */
  private renderExcludedFoldersSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Excluded folders").setHeading();

    const desc = containerEl.createDiv({ cls: "setting-item-description" });
    desc.appendText(
      "Vault-relative folder prefixes whose files are excluded from RDF " +
        "indexing and SHACL-lite validation. Files inside these folders do " +
        "NOT trigger the \"Skipping file with invariant violation\" Notice, " +
        "even when their frontmatter is incomplete by design (for example, " +
        "Obsidian template files). One prefix per line. Path-prefix match " +
        "is case-sensitive — use a trailing slash (\"09 Templates/\") to " +
        "avoid matching sibling folders that share a name prefix. Changes " +
        "take effect on next vault reload.",
    );

    // Ensure excludedFolders exists (older settings JSON may not have the key)
    if (!Array.isArray(this.plugin.settings.excludedFolders)) {
      this.plugin.settings.excludedFolders = [];
    }

    new Setting(containerEl)
      .setName("Folder prefixes")
      .setDesc("One folder prefix per line (e.g. \"09 Templates/\")")
      .addTextArea((textArea) => {
        textArea
          .setPlaceholder("09 templates/\n10 drafts/")
          .setValue(this.plugin.settings.excludedFolders.join("\n"))
          .onChange(async (value) => {
            // Split on any line break, trim each entry, drop empties so a
            // trailing newline or accidental blank line does not register
            // as "exclude everything". Persisted form is the cleaned array.
            const folders = value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            this.plugin.settings.excludedFolders = folders;
            await this.plugin.saveSettings();
          });
        // A slightly taller textarea reads better for a list of paths.
        textArea.inputEl.rows = 4;
        textArea.inputEl.cols = 40;
      });
  }

  /**
   * Render the log channel routing matrix.
   * Rows = log levels, columns = channels (Notice / Console / File).
   */
  private renderLogChannelsSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Log channels").setHeading();

    const desc = containerEl.createDiv({ cls: "setting-item-description" });
    desc.appendText(
      "Choose which channels each log level should be routed to. " +
        "File channel writes to exocortex-logs.txt inside the plugin's data " +
        "folder (rotated at 1 MB). Defaults: warn/error only.",
    );

    // Ensure logChannels exists
    if (!this.plugin.settings.logChannels) {
      this.plugin.settings.logChannels = { ...DEFAULT_LOG_CHANNELS };
    }

    const levels: { key: LogLevel; label: string }[] = [
      { key: "debug", label: "Debug" },
      { key: "info", label: "Info" },
      { key: "warn", label: "Warn" },
      { key: "error", label: "Error" },
    ];

    const channels: { key: "notice" | "console" | "file"; label: string }[] = [
      { key: "notice", label: "Notice" },
      { key: "console", label: "Console" },
      { key: "file", label: "File" },
    ];

    for (const level of levels) {
      const setting = new Setting(containerEl).setName(level.label);

      for (const channel of channels) {
        setting.addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.logChannels[level.key][channel.key])
            .onChange(async (value) => {
              this.plugin.settings.logChannels[level.key][channel.key] = value;
              await this.plugin.saveSettings();
              this.plugin.configureLogChannels();
            }),
        );
      }
    }
  }

  /**
   * Update the per-class template preview
   */
  private updatePerClassPreview(
    previewEl: HTMLElement,
    settings: DisplayNameSettings,
  ): void {
    const resolver = new DisplayNameResolver(settings);

    const sampleAssets = [
      {
        metadata: {
          exo__Asset_label: "Fix bug",
          exo__Instance_class: ["[[ems__Task]]"],
          ems__Effort_status: "DOING",
        },
        basename: "fix-bug-123",
        name: "Task",
      },
      {
        metadata: {
          exo__Asset_label: "Morning routine",
          exo__Instance_class: ["[[ems__TaskPrototype]]"],
        },
        basename: "morning-routine",
        name: "TaskPrototype",
      },
      {
        metadata: {
          exo__Asset_label: "Alpha Project",
          exo__Instance_class: ["[[ems__Project]]"],
        },
        basename: "alpha-project",
        name: "Project",
      },
    ];

    // Clear existing content
    previewEl.empty();

    previewEl.createEl("strong", { text: "Preview:" });
    const previewList = previewEl.createEl("ul", {
      cls: "exocortex-preview-list",
    });

    for (const { metadata, basename, name } of sampleAssets) {
      const displayName = resolver.resolve({
        metadata,
        basename,
        createdDate: new Date(),
      });
      const li = previewList.createEl("li");
      li.createEl("strong", { text: `${name}: ` });
      li.appendText(displayName || "(empty)");
    }
  }
}
