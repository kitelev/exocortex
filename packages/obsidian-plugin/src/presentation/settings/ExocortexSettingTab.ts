import { App, PluginSettingTab, Setting } from "obsidian";
import { normaliseExcludedFolders } from "exocortex";
import type ExocortexPlugin from "@plugin/ExocortexPlugin";
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import {
  DEFAULT_DISPLAY_NAME_SETTINGS,
  DEFAULT_LOG_CHANNELS,
  type DisplayNameSettings,
  type LogLevel,
} from "@plugin/domain/settings/ExocortexSettings";
import { GitHubRestClient } from "@plugin/infrastructure/adapters/GitHubRestClient";
import { LocalSecretsStore } from "@plugin/infrastructure/adapters/LocalSecretsStore";
import { OperationsLogReader } from "@plugin/infrastructure/adapters/OperationsLogReader";
import { SwitchCacheLayer } from "@plugin/infrastructure/adapters/SwitchCacheLayer";
import { resolvePastedSecret } from "@plugin/presentation/settings/patClipboard";
import { renderPatSetupHelper } from "@plugin/presentation/settings/patSetupHelper";

/**
 * Issue #3320 §1 — secret key used by buildAssetSpacePusher and now the
 * Settings UI. The Issue body says `"github.pat"`, but every existing
 * site in code AND tests (LocalSecretsStore.test.ts × 8) uses `"pat"`.
 * Mismatching the key would silently break Push (PAT entered in UI would
 * never reach buildAssetSpacePusher). Keep the canonical key.
 */
const PAT_SECRET_KEY = "pat";

export class ExocortexSettingTab extends PluginSettingTab {
  plugin: ExocortexPlugin;

  constructor(app: App, plugin: ExocortexPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // RFC 0002 §3.6 (P8) — settings information architecture. The settings tab
    // used to be a single ~25-toggle flat scroll with the onboarding-critical
    // GitHub PAT / profile / sync controls buried at the very bottom. It is now
    // split into three top-level sections, rendered in this order:
    //
    //   1. «Onboarding & sync» — PAT, profiles, ExoSync (what a new tester
    //      needs first), moved to the TOP so PAT is no longer buried.
    //   2. «Display» — visual / label / layout toggles + display-name templates.
    //   3. «Advanced» — power-user behaviour, experimental flags, the free-text
    //      path editors (gated with a caution), and the log-channel matrix.
    //
    // Every user-facing string here is also stripped of internal IDs (issue
    // numbers, design-decision tags, security-requirement tags) per the §7
    // grep gate (M4) — see ExocortexSettingTab.informationArchitecture.test.ts.
    this.renderOnboardingAndSyncSection(containerEl);
    this.renderDisplaySection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  /**
   * RFC 0002 §3.6 — «Onboarding & sync» section (top of the tab).
   *
   * Surfaces the onboarding-critical GitHub PAT, profiles, and ExoSync
   * controls first — previously they were the last thing rendered, so a
   * first-run tester had to scroll past every power-user toggle to find the
   * PAT field the Getting Started flow needs.
   */
  private renderOnboardingAndSyncSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Onboarding & sync").setHeading();

    const intro = containerEl.createDiv({ cls: "setting-item-description" });
    intro.appendText(
      "Set up GitHub access, profiles, and sync here — start with these when " +
        "you first install the plugin.",
    );

    // Profiles overview, GitHub PAT, ExoSync, Active profile, Switch cache,
    // and the Operations log. Moved to the top of the tab (RFC 0002 §3.6).
    this.renderProfileSections(containerEl);
  }

  /**
   * RFC 0002 §3.6 — «Display» section: the visual / label / layout toggles a
   * user changes day-to-day, plus the display-name template editor.
   */
  private renderDisplaySection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Display").setHeading();

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

    this.renderDisplayNameTemplatesSection(containerEl);
  }

  /**
   * Display-name template editor (default + per-class templates + preview +
   * placeholder help). Extracted from the old flat `display()` so it lives
   * under the «Display» section (RFC 0002 §3.6).
   */
  private renderDisplayNameTemplatesSection(containerEl: HTMLElement): void {
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
   * RFC 0002 §3.6 — «Advanced» section: power-user behaviour, experimental
   * flags, the free-text path editors (gated behind a caution), and the
   * log-channel routing matrix (now with labeled columns).
   */
  private renderAdvancedSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Advanced").setHeading();

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
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "SPARQL" is an established acronym
      .setName("Auto-execute SPARQL code blocks")
      .setDesc(
        "When enabled, sparql and exoql code blocks are executed as queries " +
          "during note rendering. When disabled (default), those code blocks " +
          "render as plain code so SPARQL snippets can be pasted for " +
          "documentation or reference without side effects.",
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
      .setName("Settings homoiconization")
      .setDesc(
        "When enabled, plugin settings are materialised as vault assets in an " +
          'exocortex-settings/ folder so they are editable as notes and synced ' +
          "alongside other assets. When disabled (default), settings live only " +
          "in data.json and that folder is never created. Turning this off " +
          "leaves any already-migrated assets on disk untouched (never deleted). " +
          "Change applies on the next plugin reload.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.settingsHomoiconizationEnabled)
          .onChange(async (value) => {
            this.plugin.settings.settingsHomoiconizationEnabled = value;
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

    // RFC 0002 §3.6 — gate the free-text path editors behind a caution. A
    // wrong vault-relative path here silently stops files from being indexed,
    // so warn the user before they reach the two textareas below.
    const pathCaution = containerEl.createDiv({
      cls: "setting-item-description exocortex-settings-caution",
    });
    pathCaution.createEl("strong", { text: "Caution: " });
    pathCaution.appendText(
      "the folder-path fields below control which files get indexed. A wrong " +
        "path can break indexing — assets may stop loading or vanish from " +
        "search. Leave the defaults unless you know the exact vault-relative " +
        "paths you want to change.",
    );

    new Setting(containerEl)
      .setName("Lazy bootstrap folders")
      .setDesc(
        "Path prefixes (one per line, trailing slash required) walked eagerly " +
          "at plugin load so exocmd Commands/Bindings/Groundings and exo Classes/Properties " +
          "are indexed before first render. Add extra submodules here " +
          "(e.g. assetspaces/kitelev/, assetspaces/pmbok-ontology/) — change applies on next plugin reload. " +
          "Empty list = bootstrap skips all folders (buttons may take 10-20s to appear on mobile).",
      )
      .addTextArea((textarea) => {
        textarea
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- example shows literal vault-relative folder paths, not prose UI text
          .setPlaceholder("assetspaces/exo/\nassetspaces/ems/")
          .setValue((this.plugin.settings.lazyBootstrapFolders ?? []).join("\n"))
          .onChange(async (value) => {
            // Auto-append trailing slash to prevent `assetspaces/ems`
            // over-matching `assetspaces/ems-commands/...` (the exact
            // failure mode this PR fixes — see ExocortexPlugin Phase 5
            // comment block). Code-reviewer MED catch.
            this.plugin.settings.lazyBootstrapFolders = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .map((line) => (line.endsWith("/") ? line : line + "/"));
            await this.plugin.saveSettings();
          });
        textarea.inputEl.rows = 6;
        textarea.inputEl.cols = 50;
      });

    // Excluded folders section — files inside these folders are skipped
    // entirely by the RDF indexer and SHACL-lite validation.
    this.renderExcludedFoldersSection(containerEl);

    // Logging section
    this.renderLogChannelsSection(containerEl);
  }

  /**
   * Render the "Excluded folders" section.
   *
   * Each non-empty line in the textarea is treated as a vault-relative
   * path-prefix. Files whose path starts with any of these prefixes are
   * excluded from RDF indexing AND SHACL-lite validation, so they never
   * contribute to the aggregated "Skipped N files" indexing Notice
   * (Issue #3468) or its per-file console log entries.
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
      "Vault-relative folder prefixes whose files are excluded from the " +
        "cold-start RDF indexing walk and live-edit indexing. Files inside " +
        "these folders do NOT count toward the \"Skipped N files\" " +
        "indexing Notice, even when their frontmatter is incomplete by " +
        "design (for example, Obsidian template files). One prefix per " +
        "line; case-sensitive path-prefix match. A trailing slash is " +
        "auto-appended on save so a sibling folder sharing a name prefix " +
        "is not silently excluded. Reload Obsidian after editing the list — " +
        "indexer, command manager, and layout service each snapshot this " +
        "list at startup. SPARQL code-blocks honour the current setting on " +
        "next render.",
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
            // Persist the FULLY-NORMALISED list so storage matches what the
            // runtime actually uses (trailing slashes auto-appended,
            // whitespace stripped, empties dropped). Without this round-trip
            // the user could type `"09 Templates"` and on reopen still see
            // `"09 Templates"` while the converter is silently treating it
            // as `"09 Templates/"` — confusing if the user later tries to
            // exclude a `"09 Templates2/"`-style sibling and wonders why
            // their entry "looks different" than what is being matched.
            const parsed = value.split(/\r?\n/);
            this.plugin.settings.excludedFolders =
              normaliseExcludedFolders(parsed);
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

    // RFC 0002 §3.6 — label the matrix columns. Each level row below renders 3
    // otherwise-unlabeled toggles; this header (plus per-toggle aria-labels)
    // tells the user which toggle routes to Notice / Console / File.
    const header = containerEl.createDiv({
      cls: "exocortex-log-channel-header",
    });
    header.createEl("span", {
      cls: "exocortex-log-channel-level-label",
      text: "Level",
    });
    for (const channel of channels) {
      header.createEl("span", {
        cls: "exocortex-log-channel-col-label",
        text: channel.label,
      });
    }

    for (const level of levels) {
      const setting = new Setting(containerEl).setName(level.label);

      for (const channel of channels) {
        setting.addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.logChannels[level.key][channel.key])
            .onChange(async (value) => {
              this.plugin.settings.logChannels[level.key][channel.key] = value;
              await this.plugin.saveSettings();
              this.plugin.configureLogChannels();
            });
          // a11y — name the otherwise-anonymous toggle by its (level, channel)
          // so screen readers and hover tooltips identify which column it is.
          const ariaLabel = `${level.label}: route to ${channel.label} channel`;
          toggle.toggleEl?.setAttribute("aria-label", ariaLabel);
          toggle.toggleEl?.setAttribute("title", ariaLabel);
        });
      }
    }
  }

  /**
   * Issue #3320 — render the 4 Profile sections (PAT, Active profile,
   * Switch cache, Operations log) per RFC 0a0791c1 §B.8.
   *
   * Architectural notes:
   *
   *   - LocalSecretsStore / OperationsLogReader / SwitchCacheLayer are
   *     constructed locally here. They are cheap, stateless wrappers over
   *     the vault adapter (or, in SwitchCacheLayer's case, intentionally
   *     empty in v3 — its docstring explicitly says «Settings UI wires
   *     getCacheStats() and shows zeros — acceptable»).
   *
   *   - ProfileApplyManager is NOT constructed here — it would race
   *     the manager from registerProfileCommands on the persisted
   *     lock file. Plugin exposes a hoisted instance via
   *     `plugin.profileApplyManager`.
   *
   *   - GitHubRestClient requires the PAT, so it cannot be a stable field;
   *     constructed inside the Test-connection callback against the freshly
   *     persisted secret (ensures Test reads the same byte sequence Push
   *     will see after reload).
   *
   *   - PAT persistence uses an explicit Save button — not keystroke
   *     onChange — to avoid persisting partial PAT bytes that Test could
   *     then race against (advisor catch).
   *
   *   - buildAssetSpacePusher captures the PAT at onload time, so changing
   *     the PAT in this UI does not retroactively activate Push. Save flow
   *     surfaces a Notice asking the user to reload the plugin.
   *
   *   - Section 4 reads the journal asynchronously; the `<pre>` element is
   *     created synchronously and populated via an IIFE so display() stays
   *     synchronous per Obsidian's PluginSettingTab contract.
   */
  private renderProfileSections(containerEl: HTMLElement): void {
    const app = this.plugin.app;
    const notifier = this.plugin.notifier;
    const secretsStore = new LocalSecretsStore({ app });
    const switchCache = new SwitchCacheLayer();
    const operationsLog = new OperationsLogReader({ app });

    // ─────── Section 0 — Profile overview (Phase 5 apply-model) ───────
    // A profile is a named group of AssetSpaces. Applying it makes the vault's
    // on-disk mount-state match the profile (materialize what it includes,
    // tear down the rest), so users edit ONE thing — the profile's AssetSpace
    // list — and run ONE operation, «Apply profile».
    new Setting(containerEl).setName("Profiles").setHeading();

    const profilesOverviewEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    profilesOverviewEl.createEl("p", {
      text:
        "A profile (an exo__Profile asset) is a named group of AssetSpaces. " +
        "Applying a profile makes the vault's on-disk mount-state match it: " +
        "the AssetSpaces it includes are materialized, everything else " +
        "(except the always-on floor) is torn down — a strict replace.",
    });
    const applyLi = profilesOverviewEl.createEl("ul").createEl("li");
    applyLi.createEl("strong", { text: "Apply profile." });
    applyLi.appendText(
      " Pick a Profile asset via the «Exocortex: Apply profile» command " +
        "(Cmd+P). It physically materializes or tears down AssetSpace " +
        "submodules on disk (and rewrites .gitmodules), so it is gated by a " +
        "confirmation prompt and an uncommitted-changes guard, and costs " +
        "~30 s per freshly-pulled AssetSpace. The floor AssetSpaces " +
        "(exo, exocmd, shared-identities) are never torn down. Use it to " +
        "install or remove whole ontology bundles and to keep " +
        "privacy-sensitive content physically off the device.",
    );
    profilesOverviewEl.createEl("p", {
      text:
        "Adding an ontology to a profile is NOT transitive — listing pmbok " +
        "does not auto-add ems. Add each AssetSpace the profile needs " +
        "explicitly. See docs/explanation/profile.md for the full model, examples, and " +
        "composition rules.",
    });

    // ─────── Section 1 — PAT (GitHub Personal Access Token) ───────
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "GitHub" + "PAT" are proper noun + established acronym
    new Setting(containerEl).setName("Profile: GitHub PAT").setHeading();

    const patDesc = containerEl.createDiv({ cls: "setting-item-description" });
    patDesc.appendText(
      "Fine-grained Personal Access Token used to push AssetSpace " +
        "submodules to GitHub. Stored in data.local.json (not data.json) so " +
        "Obsidian Sync never replicates it over the network. Required for the " +
        "«Push current assetspace» and «Apply profile» commands.",
    );
    // RFC 0002 §3.9 (P14) — mobile onboarding parity. Typing a long
    // fine-grained token on a phone keyboard is painful, so point users at the
    // Paste button (works on desktop AND mobile — no Platform gate).
    patDesc.appendText(
      " On mobile, use the Paste button to fill the field from your " +
        "clipboard instead of typing the token by hand.",
    );

    // RFC 0002 §3.5 (P9) — create-token helper: a deep-link to GitHub's
    // fine-grained token page + an inline list of the permissions the token
    // needs. Reusable renderer (patSetupHelper) so the first-run Welcome PAT
    // step (cd9444bd) shows identical guidance without copy drift.
    renderPatSetupHelper(containerEl);

    let patInputValue = "";
    // Captured from `addText` below so the Paste button can write into the same
    // input (and the password masking stays applied).
    let patTextComponent: { setValue(value: string): void } | undefined;
    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "PAT" is an established acronym for Personal Access Token
      .setName("Personal Access Token")
      .setDesc(
        "Recommended: fine-grained PAT with a per-repository allowlist scoped " +
          "to your exoas-* repos. Leave blank and click Save to clear.",
      )
      .addText((text) => {
        patTextComponent = text;
        text.inputEl.type = "password";
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder shows literal PAT format
        text.setPlaceholder("github_pat_…");
        text.onChange((value) => {
          patInputValue = value;
        });
      })
      // RFC 0002 §3.9 (P14) — paste-from-clipboard affordance. A native
      // Obsidian button (keyboard-focusable, Enter/Space-activatable) so PAT
      // entry is mobile-friendly without typing the whole token. Works on both
      // platforms (`navigator.clipboard.readText()` resolves on a user gesture
      // in Electron AND the mobile WebView) — no Platform gate, mobile parity.
      .addButton((button) =>
        button
          .setButtonText("Paste")
          .setTooltip("Paste a GitHub token from the clipboard")
          .onClick(async () => {
            try {
              const raw = await navigator.clipboard.readText();
              const outcome = resolvePastedSecret(raw);
              if (outcome.kind === "empty") {
                notifier.warn(
                  "Clipboard is empty — copy your token first, then Paste.",
                );
                return;
              }
              patTextComponent?.setValue(outcome.value);
              patInputValue = outcome.value;
              notifier.info("Pasted from clipboard. Click Save PAT to store it.");
            } catch (error) {
              notifier.error(
                `Couldn't read the clipboard (${errorMessage(error)}) — ` +
                  "paste into the field manually instead.",
              );
            }
          }),
      )
      .addButton((button) =>
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- "PAT" is an established acronym
        button.setButtonText("Save PAT").onClick(async () => {
          try {
            const trimmed = patInputValue.trim();
            await secretsStore.setSecret(
              PAT_SECRET_KEY,
              trimmed.length > 0 ? trimmed : null,
            );
            if (trimmed.length > 0) {
              notifier.info(
                "PAT saved. Reload Obsidian to activate push (the plugin captures the PAT at onload).",
              );
            } else {
              notifier.info("PAT cleared.");
            }
          } catch (error) {
            notifier.error(`Save PAT failed: ${errorMessage(error)}`);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("Test connection").onClick(async () => {
          try {
            const pat = await secretsStore.getSecret(PAT_SECRET_KEY);
            if (pat === null || pat.length === 0) {
              notifier.warn(
                "No PAT stored. Enter a PAT and click Save first.",
              );
              return;
            }
            const client = new GitHubRestClient({ pat, app });
            const rate = await client.checkRateLimit();
            let reposNote = "";
            try {
              const repos = await client.listRepos(5);
              reposNote =
                repos.length === 0
                  ? "; no repos visible to this PAT"
                  : `; sample: ${repos.slice(0, 5).join(", ")}`;
            } catch (reposError) {
              reposNote = `; listRepos failed: ${errorMessage(reposError)}`;
            }
            notifier.info(
              `GitHub OK — ${rate.remaining} requests remaining` +
                `, resets ${rate.resetAt.toISOString()}${reposNote}`,
              8000,
            );
          } catch (error) {
            notifier.error(`Test connection failed: ${errorMessage(error)}`);
          }
        }),
      );

    // ─────── ExoSync (RFC 4e4dc453 Phase B) ───────
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "ExoSync" is the feature's proper name
    new Setting(containerEl).setName("ExoSync").setHeading();

    new Setting(containerEl)
      .setName("Quarantine repo URL")
      .setDesc(
        "Optional dedicated GitHub repo (https://github.com/<owner>/<repo>) " +
          "where unresolvable sync conflicts are preserved as both-versions " +
          "entries. Leave empty to skip the durable quarantine sink — " +
          "conflicts still re-derive on every sync until resolved.",
      )
      .addText((text) => {
        text.setPlaceholder("https://github.com/owner/exosync-quarantine");
        text.setValue(this.plugin.settings.exosyncQuarantineRepoUrl ?? "");
        text.onChange(async (value) => {
          const trimmed = value.trim();
          let valid = true;
          if (trimmed.length > 0) {
            try {
              GitHubRestClient.validateRepoURL(trimmed);
            } catch {
              valid = false;
            }
          }
          // Visual cue instead of a silent no-persist (code-reviewer LOW,
          // PR #3461): the field keeps the draft text, the red border tells
          // the user the stored value did NOT change.
          text.inputEl.toggleClass("exocortex-invalid-input", !valid);
          text.inputEl.setAttribute("aria-invalid", valid ? "false" : "true");
          if (!valid) return;
          this.plugin.settings.exosyncQuarantineRepoUrl = trimmed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Show a notice for each sync step")
      .setDesc(
        "Verbose: surface every sync step (start + each repo) as a toast on " +
          "top of the console line. Default off — a Sync touches 14+ repos = " +
          "14+ toasts per run. Turn on only while actively watching a sync. " +
          "The single summary toast is unaffected.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.exosyncStepNotices)
          .onChange(async (value) => {
            this.plugin.settings.exosyncStepNotices = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Write a verbose sync log to file")
      .setDesc(
        "Append every sync step (start, the in-flight detecting / pulling / " +
          "merging lines, and each per-repo outcome) to the plugin log file " +
          "for a durable debug trace. Independent of the global file-logging " +
          "channel and default off — turn on to capture one misbehaving run.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.verboseSyncLogging)
          .onChange(async (value) => {
            this.plugin.settings.verboseSyncLogging = value;
            await this.plugin.saveSettings();
          }),
      );

    // ─────── Section 2 — Active profile ───────
    new Setting(containerEl).setName("Active profile").setHeading();

    // Issue #3327 Item #3 — read switch state from device-local store
    // (data.local.json). `plugin.localDataStore` is null until
    // `registerProfileCommands` resolves (and undefined in unit
    // tests с partial plugin mocks); treat as no-active-profile before
    // then, matching the previous fallback behaviour.
    //
    // RFC 0a0791c1 Phase 5 T2 — single last-applied slot. Switching is the
    // «Exocortex: Apply profile» Cmd+P command (mount-state strict replace,
    // gated behind a confirmation prompt because it mutates the filesystem);
    // the former soft-filter dropdown was removed with the query-time RDF filter.
    const activeProfileUid = this.plugin.localDataStore
      ? this.plugin.localDataStore.getActiveProfileUid()
      : null;

    const profileStatusEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    if (activeProfileUid === null) {
      profileStatusEl.appendText("Last applied: (none — full vault on disk)");
    } else {
      // RFC 0002 §3.4 P10 — show the human label, not the raw UID. The lister
      // is async (it scans the vault), so render the UID synchronously and
      // upgrade to the label once resolved (same pattern as Operations log
      // below). Falls back to the UID for a since-deleted profile / lister
      // failure.
      profileStatusEl.appendText(`Last applied: ${activeProfileUid}`);
      void (async () => {
        const lister = this.plugin.listProfileChoices;
        if (lister === null || lister === undefined) return;
        try {
          const choices = await lister();
          const match = choices.find((c) => c.uid === activeProfileUid);
          if (match !== undefined) {
            profileStatusEl.empty();
            profileStatusEl.appendText(`Last applied: ${match.label}`);
          }
        } catch {
          // Keep the UID fallback already rendered — not fatal.
        }
      })();
    }

    new Setting(containerEl)
      .setName("Apply profile")
      .setDesc(
        "To switch profiles, run the «Exocortex: Apply profile» command " +
          "(Cmd+P). It materialises the selected profile's AssetSpaces and " +
          "unmounts the rest (the TS-floor is never unmounted). A " +
          "confirmation prompt guards it because it mutates the filesystem.",
      );

    // ─────── Section 3 — Switch cache ───────
    new Setting(containerEl).setName("Switch cache").setHeading();

    // In v3 the SwitchCacheLayer is constructed here freshly per display()
    // и therefore reports zeros — by design, per its docstring. Phase C+D
    // would hoist a singleton to retain populated stats.
    const stats = switchCache.getCacheStats();
    const sizeMb = (stats.totalSize / (1024 * 1024)).toFixed(2);
    new Setting(containerEl)
      .setName("Cache stats")
      .setDesc(
        `${stats.count} cached AssetSpaces · ${sizeMb} MB · ` +
          `oldest: ${stats.oldestEntry ?? "(empty)"}`,
      )
      .addButton((button) =>
        button.setButtonText("Clear cache").onClick(() => {
          notifier.info(
            "Clear cache: Phase C+D feature, not implemented in v3. " +
              "The cache is currently empty by construction.",
          );
        }),
      );

    // ─────── Section 4 — Operations log ───────
    new Setting(containerEl).setName("Operations log").setHeading();

    const opsDesc = containerEl.createDiv({ cls: "setting-item-description" });
    opsDesc.appendText(
      "Last 10 entries from .exocortex/switch-journal.jsonl, newest first. " +
        "Format: <timestamp> | <profile-label> | <elapsedMs>ms | <status>.",
    );

    const opsPre = containerEl.createEl("pre", { cls: "exocortex-ops-log" });
    opsPre.appendText("Loading…");

    void (async () => {
      try {
        // UID → label lookup uses the same profile lister как the Cmd+P
        // picker, so labels match exactly. Fall back to UID[:8] when an
        // entry references a since-deleted profile.
        const lister = this.plugin.listProfileChoices;
        const labelByUid: Map<string, string> = new Map();
        if (lister !== null) {
          try {
            const choices = await lister();
            for (const c of choices) labelByUid.set(c.uid, c.label);
          } catch {
            // Fall back to UID-only labels; not a fatal error.
          }
        }
        const entries = await operationsLog.readLast(
          10,
          (uid) => labelByUid.get(uid) ?? null,
        );
        opsPre.empty();
        if (entries.length === 0) {
          opsPre.appendText("(no journal entries yet)");
          return;
        }
        for (const entry of entries) {
          opsPre.createEl("div", {
            text: OperationsLogReader.formatEntry(entry),
          });
        }
      } catch (error) {
        opsPre.empty();
        opsPre.appendText(`Failed to read log: ${errorMessage(error)}`);
      }
    })();
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

/** Issue #3320 — unwrap unknown errors safely for Notice text. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
