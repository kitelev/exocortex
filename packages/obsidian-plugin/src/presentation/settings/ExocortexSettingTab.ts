import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ExocortexPlugin from '@plugin/ExocortexPlugin';
import { DEFAULT_DISPLAY_NAME_TEMPLATE } from "@plugin/domain/display-name/DisplayNameTemplateEngine";
import { DisplayNameResolver } from "@plugin/domain/display-name/DisplayNameResolver";
import {
  DEFAULT_DISPLAY_NAME_SETTINGS,
  DEFAULT_WEBHOOK_SETTINGS,
  type DisplayNameSettings,
  type StoredWebhookConfig,
  type WebhookSettings,
} from "@plugin/domain/settings/ExocortexSettings";
import type { WebhookEventType } from "exocortex";

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

    // Webhook Integration section
    this.renderWebhookSettings(containerEl);
  }

  /**
   * Render webhook settings section
   */
  private renderWebhookSettings(containerEl: HTMLElement): void {
    // Ensure webhookSettings is initialized
    if (!this.plugin.settings.webhookSettings) {
      this.plugin.settings.webhookSettings = { ...DEFAULT_WEBHOOK_SETTINGS };
    }

    const webhookSettings = this.plugin.settings.webhookSettings;

    new Setting(containerEl)
      .setName("Webhook integrations")
      .setHeading();

    const webhookDesc = containerEl.createDiv({ cls: "setting-item-description" });
    webhookDesc.createEl("p", {
      text: "Send events to external services (n8n, Zapier, etc.) when changes occur in your vault", // eslint-disable-line obsidianmd/ui/sentence-case
    });

    // Global webhook toggle
    new Setting(containerEl)
      .setName("Enable webhooks")
      .setDesc("Globally enable or disable all webhook integrations")
      .addToggle((toggle) =>
        toggle
          .setValue(webhookSettings.enabled)
          .onChange(async (value) => {
            webhookSettings.enabled = value;
            await this.plugin.saveSettings();
            this.plugin.toggleWebhooks(value);
          }),
      );

    // Webhooks list container
    const webhooksListContainer = containerEl.createDiv({
      cls: "exocortex-webhooks-list",
    });

    this.renderWebhooksList(webhooksListContainer, webhookSettings);

    // Add new webhook button
    new Setting(containerEl)
      .setName("Add webhook")
      .setDesc("Add a new webhook endpoint")
      .addButton((button) =>
        button
          .setButtonText("Add webhook")
          .setCta()
          .onClick(() => {
            const newWebhook: StoredWebhookConfig = {
              id: this.generateWebhookId(),
              name: "New webhook",
              url: "",
              events: [],
              enabled: true,
            };
            webhookSettings.webhooks.push(newWebhook);
            this.renderWebhooksList(webhooksListContainer, webhookSettings);
          }),
      );
  }

  /**
   * Render the list of configured webhooks
   */
  private renderWebhooksList(container: HTMLElement, webhookSettings: WebhookSettings): void {
    container.empty();

    if (webhookSettings.webhooks.length === 0) {
      container.createEl("p", {
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        text: "No webhooks configured. Click 'Add webhook' to create one.",
        cls: "exocortex-webhooks-empty",
      });
      return;
    }

    for (let i = 0; i < webhookSettings.webhooks.length; i++) {
      const webhook = webhookSettings.webhooks[i];
      this.renderWebhookItem(container, webhook, i, webhookSettings);
    }
  }

  /**
   * Render a single webhook configuration item
   */
  private renderWebhookItem(
    container: HTMLElement,
    webhook: StoredWebhookConfig,
    index: number,
    webhookSettings: WebhookSettings
  ): void {
    const webhookContainer = container.createDiv({
      cls: "exocortex-webhook-item",
    });

    webhookContainer.style.cssText = `
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    `;

    // Webhook name and enable toggle
    new Setting(webhookContainer)
      .setName("Webhook name")
      .addText((text) =>
        text
          .setPlaceholder("My webhook")
          .setValue(webhook.name)
          .onChange(async (value) => {
            webhook.name = value;
            await this.plugin.saveSettings();
            this.plugin.updateWebhookConfig(webhook);
          }),
      )
      .addToggle((toggle) =>
        toggle
          .setValue(webhook.enabled)
          .setTooltip("Enable/disable this webhook")
          .onChange(async (value) => {
            webhook.enabled = value;
            await this.plugin.saveSettings();
            this.plugin.updateWebhookConfig(webhook);
          }),
      );

    // Webhook URL
    new Setting(webhookContainer)
      .setName("URL")
      .setDesc("The endpoint to send events to")
      .addText((text) =>
        text
          .setPlaceholder("https://your-service.com/webhook")
          .setValue(webhook.url)
          .onChange(async (value) => {
            webhook.url = value;
            await this.plugin.saveSettings();
            this.plugin.updateWebhookConfig(webhook);
          }),
      );

    // Event types
    const eventTypes: { value: WebhookEventType; label: string }[] = [
      { value: "note.created", label: "Note created" },
      { value: "note.updated", label: "Note updated" },
      { value: "note.deleted", label: "Note deleted" },
      { value: "task.completed", label: "Task completed" },
      { value: "task.started", label: "Task started" },
      { value: "task.blocked", label: "Task blocked" },
      { value: "status.changed", label: "Status changed" },
      { value: "property.changed", label: "Property changed" },
    ];

    const eventsContainer = webhookContainer.createDiv({
      cls: "exocortex-webhook-events",
    });
    eventsContainer.addClass("exocortex-webhook-events-container");

    new Setting(eventsContainer)
      .setName("Events")
      .setDesc("Select which events trigger this webhook (empty = all events)");

    const eventsGrid = eventsContainer.createDiv({
      cls: "exocortex-events-grid",
    });
    eventsGrid.addClass("exocortex-events-grid-layout");

    for (const eventType of eventTypes) {
      const eventLabel = eventsGrid.createEl("label", {
        cls: "exocortex-event-checkbox",
      });
      eventLabel.addClass("exocortex-event-checkbox-label");

      const checkbox = eventLabel.createEl("input", {
        type: "checkbox",
      });
      checkbox.checked = webhook.events.includes(eventType.value);
      checkbox.addEventListener("change", async () => {
        if (checkbox.checked) {
          if (!webhook.events.includes(eventType.value)) {
            webhook.events.push(eventType.value);
          }
        } else {
          const idx = webhook.events.indexOf(eventType.value);
          if (idx !== -1) {
            webhook.events.splice(idx, 1);
          }
        }
        await this.plugin.saveSettings();
        this.plugin.updateWebhookConfig(webhook);
      });

      eventLabel.createSpan({ text: eventType.label });
    }

    // Advanced settings (collapsed by default)
    const advancedDetails = webhookContainer.createEl("details");
    advancedDetails.addClass("exocortex-webhook-advanced");

    const advancedSummary = advancedDetails.createEl("summary");
    advancedSummary.textContent = "Advanced settings";
    advancedSummary.addClass("exocortex-webhook-advanced-summary");

    const advancedContent = advancedDetails.createDiv();

    // Secret for HMAC
    new Setting(advancedContent)
      .setName("Secret")
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc("Optional secret for HMAC signature verification")
      .addText((text) =>
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder("your-secret-key")
          .setValue(webhook.secret || "")
          .onChange(async (value) => {
            webhook.secret = value || undefined;
            await this.plugin.saveSettings();
            this.plugin.updateWebhookConfig(webhook);
          }),
      );

    // Timeout
    new Setting(advancedContent)
      .setName("Timeout (ms)")
      .setDesc("Request timeout in milliseconds (default: 30000)")
      .addText((text) =>
        text
          .setPlaceholder("30000")
          .setValue(webhook.timeout?.toString() || "")
          .onChange(async (value) => {
            const timeout = parseInt(value, 10);
            webhook.timeout = isNaN(timeout) ? undefined : timeout;
            await this.plugin.saveSettings();
            this.plugin.updateWebhookConfig(webhook);
          }),
      );

    // Retry count
    new Setting(advancedContent)
      .setName("Retry count")
      .setDesc("Number of retries on failure (default: 3)")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(webhook.retryCount?.toString() || "")
          .onChange(async (value) => {
            const retryCount = parseInt(value, 10);
            webhook.retryCount = isNaN(retryCount) ? undefined : retryCount;
            await this.plugin.saveSettings();
            this.plugin.updateWebhookConfig(webhook);
          }),
      );

    // Action buttons
    new Setting(webhookContainer)
      .addButton((button) =>
        button
          .setButtonText("Test")
          .setTooltip("Send a test event to this webhook")
          .onClick(async () => {
            const result = await this.plugin.testWebhook(webhook.id);
            if (result.success) {
              new Notice(`Webhook test successful (${result.statusCode})`);
            } else {
              new Notice(`Webhook test failed: ${result.error}`);
            }
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Delete")
          .setWarning()
          .onClick(async () => {
            webhookSettings.webhooks.splice(index, 1);
            await this.plugin.saveSettings();
            this.plugin.removeWebhook(webhook.id);
            this.renderWebhooksList(container, webhookSettings);
          }),
      );
  }

  /**
   * Generate a unique webhook ID
   */
  private generateWebhookId(): string {
    return `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
