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

    // Issue #3320 — RFC 0a0791c1 §B.8 — 4 FocusProfile-related sections
    // (PAT, Active profile, Switch cache, Operations log). Rendered after
    // the existing sections so the diff stays additive.
    this.renderFocusProfileSections(containerEl);

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
      "Vault-relative folder prefixes whose files are excluded from the " +
        "cold-start RDF indexing walk and live-edit indexing. Files inside " +
        "these folders do NOT trigger the \"Skipping file with invariant " +
        "violation\" Notice, even when their frontmatter is incomplete by " +
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
   * Issue #3320 — render the 4 FocusProfile sections (PAT, Active profile,
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
   *   - FocusProfileSwitchManager is NOT constructed here — it would race
   *     the manager from registerFocusProfileCommands on the persisted
   *     lock file. Plugin exposes a hoisted instance via
   *     `plugin.focusProfileSwitchManager`.
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
  private renderFocusProfileSections(containerEl: HTMLElement): void {
    const app = this.plugin.app;
    const notifier = this.plugin.notifier;
    const secretsStore = new LocalSecretsStore({ app });
    const switchCache = new SwitchCacheLayer();
    const operationsLog = new OperationsLogReader({ app });

    // ─────── Section 0 — Knowledge vs Focus overview (RFC 13da049f R35) ───────
    // R35: users were confused about «which profile do I edit?». The two
    // profile types are independent slots with different mechanisms; this
    // overview block names them up-front so the sections below read clearly.
    new Setting(containerEl).setName("Knowledge and focus profiles").setHeading();

    const profilesOverviewEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    profilesOverviewEl.createEl("p", {
      text:
        "Two independent profile types control what you see. They are " +
        "separate slots — a Knowledge profile and a Focus profile can be " +
        "active at the same time, and switching one never touches the other.",
    });
    const profilesOverviewList = profilesOverviewEl.createEl("ul");
    const knowledgeLi = profilesOverviewList.createEl("li");
    knowledgeLi.createEl("strong", { text: "Knowledge profile — storage." });
    knowledgeLi.appendText(
      " A hard switch that physically materializes or tears down AssetSpace " +
        "submodules on disk (and rewrites .gitmodules). Heavyweight: a " +
        "confirmation gate, an uncommitted-changes guard, and ~30 s per " +
        "freshly-pulled AssetSpace. Pick a KnowledgeProfile asset via the " +
        "«Exocortex: Switch knowledge profile (filesystem destroy + " +
        "materialize)» command (Cmd+P). Use it to " +
        "install or remove whole ontology bundles and to keep " +
        "privacy-sensitive content physically off the device.",
    );
    const focusLi = profilesOverviewList.createEl("li");
    focusLi.createEl("strong", { text: "Focus profile — filter." });
    focusLi.appendText(
      " A soft switch that applies a query-time RDF filter; nothing changes " +
        "on disk. Lightweight: ~1–2 s reindex, instantly reversible. Pick a " +
        "FocusProfile asset via the dropdown below or the «Exocortex: Switch " +
        "focus profile» command. Use it to narrow search / SPARQL / graph " +
        "view to the slice you are working in right now.",
    );
    profilesOverviewEl.createEl("p", {
      text:
        "Adding an ontology to a profile is NOT transitive — listing pmbok " +
        "does not auto-add ems. Add each AssetSpace the profile needs " +
        "explicitly. See docs/profiles.md for the full distinction, " +
        "examples, and composition rules.",
    });

    // ─────── Section 1 — PAT (GitHub Personal Access Token) ───────
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- "GitHub" + "PAT" are proper noun + established acronym
    new Setting(containerEl).setName("FocusProfile: GitHub PAT").setHeading();

    const patDesc = containerEl.createDiv({ cls: "setting-item-description" });
    patDesc.appendText(
      "Fine-grained Personal Access Token used to push AssetSpace " +
        "submodules to GitHub. Stored в data.local.json (NOT data.json) so " +
        "Obsidian Sync excludes it from network replication (Vision Lock #1, " +
        "Security #1). Required for the «Push current assetspace» command; " +
        "the «Switch focus profile» command works without a PAT.",
    );

    let patInputValue = "";
    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- "PAT" is an established acronym for Personal Access Token
      .setName("Personal Access Token")
      .setDesc(
        "Recommended: fine-grained PAT с per-repository allowlist scoped " +
          "to your exoas-* repos. Leave blank and click Save to clear.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder shows literal PAT format
        text.setPlaceholder("github_pat_…");
        text.onChange((value) => {
          patInputValue = value;
        });
      })
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

    // ─────── Section 2 — Active focus profile ───────
    new Setting(containerEl).setName("Active focus profile").setHeading();

    // Issue #3327 Item #3 — read switch state from device-local store
    // (data.local.json). `plugin.localDataStore` is null until
    // `registerFocusProfileCommands` resolves (and undefined in unit
    // tests с partial plugin mocks); treat as no-active-profile before
    // then, matching the previous fallback behaviour.
    //
    // RFC 13da049f AC14 — the two slots are independent. The dropdown below
    // drives the FOCUS slot (soft switch); the KNOWLEDGE slot is set by the
    // «Switch knowledge profile» palette command. Surface both so the user
    // sees the full state, not just the slot this section edits.
    const activeKnowledgeProfileUid = this.plugin.localDataStore
      ? this.plugin.localDataStore.getActiveKnowledgeProfileUid()
      : null;
    const activeFocusProfileUid = this.plugin.localDataStore
      ? this.plugin.localDataStore.getActiveFocusProfileUid()
      : null;

    const profileStatusEl = containerEl.createDiv({
      cls: "setting-item-description",
    });
    profileStatusEl.appendText(
      `Active — Knowledge (storage): ${activeKnowledgeProfileUid ?? "(none — full vault on disk)"}` +
        ` · Focus (filter): ${activeFocusProfileUid ?? "(none — no query filter)"}`,
    );

    const profileSetting = new Setting(containerEl)
      .setName("Switch profile")
      .setDesc(
        "Soft switch (FOCUS slot) — applies a query-time RDF filter; nothing " +
          "changes on disk. Same code path as the Cmd+P «Switch focus " +
          "profile» command. Triggers an RDF re-index. To change which " +
          "ontologies are materialized on disk (the KNOWLEDGE slot, a hard " +
          "switch), use the «Switch knowledge profile» palette command " +
          "instead — it is gated behind a confirmation prompt because it " +
          "mutates the filesystem. No «none» option here: clear the focus " +
          "filter via plugin reload.",
      );

    profileSetting.addDropdown((dropdown) => {
      dropdown.addOption("", "— select profile —");
      dropdown.setValue("");

      // Populate asynchronously: dropdown options can be added after the
      // initial render; the dropdown re-renders on each addOption().
      void (async () => {
        const lister = this.plugin.listFocusProfileChoices;
        if (lister === null) {
          // Plugin's FocusProfile commands failed to wire — surface as
          // disabled-with-explanation rather than empty silent dropdown.
          dropdown.addOption(
            "__unwired__",
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- "FocusProfile" is a product class name preserved verbatim from RFC nomenclature
            "(FocusProfile commands not wired — see plugin logs)",
          );
          return;
        }
        let choices;
        try {
          choices = await lister();
        } catch {
          dropdown.addOption("__error__", "(listing profiles failed)");
          return;
        }
        for (const choice of choices) {
          const label = choice.isActive
            ? `${choice.label} (active)`
            : choice.label;
          dropdown.addOption(choice.uid, label);
        }
        if (activeFocusProfileUid !== null) {
          dropdown.setValue(activeFocusProfileUid);
        }
      })();

      dropdown.onChange(async (uid) => {
        if (uid === "" || uid === "__unwired__" || uid === "__error__") return;
        const switchMgr = this.plugin.focusProfileSwitchManager;
        if (switchMgr === null) {
          notifier.warn(
            "FocusProfile switch manager not initialised — reload plugin.",
          );
          return;
        }
        try {
          await switchMgr.softSwitchFocusProfile(uid);
        } catch (error) {
          notifier.error(`Switch failed: ${errorMessage(error)}`);
        }
      });
    });

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
        // UID → label lookup uses the same profile lister как dropdown,
        // so labels match Cmd+P / Section 2 exactly. Fall back to UID[:8]
        // when an entry references a since-deleted profile.
        const lister = this.plugin.listFocusProfileChoices;
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
