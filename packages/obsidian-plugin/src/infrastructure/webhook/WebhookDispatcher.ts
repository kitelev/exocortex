import { App, TFile, TAbstractFile } from "obsidian";
import {
  WebhookService,
  WebhookEventPayload,
  WebhookEventType,
  WebhookConfig,
  LoggingService,
} from "exocortex";

/**
 * WebhookDispatcher integrates with Obsidian events and dispatches webhooks
 * when relevant changes occur in the vault.
 */
export class WebhookDispatcher {
  private webhookService: WebhookService;
  private app: App;
  private previousMetadata: Map<string, Record<string, unknown>> = new Map();
  private isEnabled = false;

  constructor(app: App, webhookService: WebhookService) {
    this.app = app;
    this.webhookService = webhookService;
  }

  /**
   * Enable the webhook dispatcher and start listening to vault events
   */
  enable(): void {
    if (this.isEnabled) {
      return;
    }
    this.isEnabled = true;
    LoggingService.debug("WebhookDispatcher enabled");
  }

  /**
   * Disable the webhook dispatcher
   */
  disable(): void {
    if (!this.isEnabled) {
      return;
    }
    this.isEnabled = false;
    this.previousMetadata.clear();
    LoggingService.debug("WebhookDispatcher disabled");
  }

  /**
   * Check if dispatcher is enabled
   */
  isActive(): boolean {
    return this.isEnabled;
  }

  /**
   * Handle file creation event
   */
  async handleFileCreate(file: TAbstractFile): Promise<void> {
    if (!this.isEnabled || !(file instanceof TFile)) {
      return;
    }

    if (!file.path.endsWith(".md")) {
      return;
    }

    const metadata = this.getFileMetadata(file);
    if (!metadata) {
      return;
    }

    // Cache metadata for future change detection
    this.previousMetadata.set(file.path, { ...metadata });

    const payload = this.createEventPayload("note.created", file, metadata);
    await this.webhookService.dispatchEvent(payload);
  }

  /**
   * Handle file deletion event
   */
  async handleFileDelete(file: TAbstractFile): Promise<void> {
    if (!this.isEnabled || !(file instanceof TFile)) {
      return;
    }

    if (!file.path.endsWith(".md")) {
      return;
    }

    const cachedMetadata = this.previousMetadata.get(file.path);
    this.previousMetadata.delete(file.path);

    const payload: WebhookEventPayload = {
      event: "note.deleted",
      timestamp: new Date().toISOString(),
      filePath: file.path,
      label: cachedMetadata?.exo__Asset_label as string | undefined,
      uid: cachedMetadata?.exo__Asset_uid as string | undefined,
      instanceClass: this.extractInstanceClass(cachedMetadata),
    };

    await this.webhookService.dispatchEvent(payload);
  }

  /**
   * Handle file modification event
   */
  async handleFileModify(file: TFile): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    if (!file.path.endsWith(".md")) {
      return;
    }

    const currentMetadata = this.getFileMetadata(file);
    if (!currentMetadata) {
      return;
    }

    const previousMetadata = this.previousMetadata.get(file.path);

    // Detect specific changes
    const changes = this.detectChanges(previousMetadata, currentMetadata);

    // Dispatch specialized events based on changes
    for (const change of changes) {
      await this.webhookService.dispatchEvent(change);
    }

    // Always dispatch a general note.updated event
    const payload = this.createEventPayload("note.updated", file, currentMetadata, {
      changedProperties: changes.map((c) => c.event),
    });
    await this.webhookService.dispatchEvent(payload);

    // Update cached metadata
    this.previousMetadata.set(file.path, { ...currentMetadata });
  }

  /**
   * Handle metadata change event (more reliable than file modify for frontmatter)
   */
  async handleMetadataChange(file: TFile): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    await this.handleFileModify(file);
  }

  /**
   * Detect specific changes between metadata states
   */
  private detectChanges(
    previous: Record<string, unknown> | undefined,
    current: Record<string, unknown>
  ): WebhookEventPayload[] {
    const changes: WebhookEventPayload[] = [];
    const timestamp = new Date().toISOString();

    // Status change detection
    const prevStatus = previous?.ems__Effort_status;
    const currStatus = current.ems__Effort_status;

    if (prevStatus !== currStatus && currStatus) {
      const statusPayload: WebhookEventPayload = {
        event: "status.changed",
        timestamp,
        filePath: "", // Will be filled by caller
        label: current.exo__Asset_label as string | undefined,
        uid: current.exo__Asset_uid as string | undefined,
        instanceClass: this.extractInstanceClass(current),
        data: {
          previousStatus: prevStatus,
          currentStatus: currStatus,
        },
      };
      changes.push(statusPayload);

      // Specialized task events
      if (currStatus === "DONE" || currStatus === "Completed") {
        changes.push({
          ...statusPayload,
          event: "task.completed",
        });
      } else if (currStatus === "DOING" || currStatus === "Active" || currStatus === "IN_PROGRESS") {
        changes.push({
          ...statusPayload,
          event: "task.started",
        });
      } else if (currStatus === "BLOCKED" || currStatus === "Blocked") {
        changes.push({
          ...statusPayload,
          event: "task.blocked",
        });
      }
    }

    // General property change detection
    const trackedProperties = [
      "exo__Asset_label",
      "ems__Effort_plannedStartTimestamp",
      "ems__Effort_plannedEndTimestamp",
      "ems__Effort_startTimestamp",
      "ems__Effort_endTimestamp",
      "ems__Effort_status",
      "ems__Effort_parent",
      "ems__Effort_project",
    ];

    const changedProperties: Record<string, { old: unknown; new: unknown }> = {};
    for (const prop of trackedProperties) {
      const prevValue = previous?.[prop];
      const currValue = current[prop];
      if (prevValue !== currValue) {
        changedProperties[prop] = { old: prevValue, new: currValue };
      }
    }

    if (Object.keys(changedProperties).length > 0) {
      changes.push({
        event: "property.changed",
        timestamp,
        filePath: "",
        label: current.exo__Asset_label as string | undefined,
        uid: current.exo__Asset_uid as string | undefined,
        instanceClass: this.extractInstanceClass(current),
        data: {
          changedProperties,
        },
      });
    }

    return changes;
  }

  /**
   * Get file metadata from Obsidian cache
   */
  private getFileMetadata(file: TFile): Record<string, unknown> | null {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter ?? null;
  }

  /**
   * Extract instance class from metadata
   */
  private extractInstanceClass(metadata: Record<string, unknown> | undefined): string | undefined {
    if (!metadata) {
      return undefined;
    }

    const instanceClass = metadata.exo__Instance_class;
    if (!instanceClass) {
      return undefined;
    }

    if (Array.isArray(instanceClass)) {
      // Return first non-empty class
      const first = instanceClass[0];
      return typeof first === "string" ? this.cleanWikiLink(first) : undefined;
    }

    return typeof instanceClass === "string" ? this.cleanWikiLink(instanceClass) : undefined;
  }

  /**
   * Clean wiki-link format from string
   */
  private cleanWikiLink(value: string): string {
    return value
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .replace(/^"/, "")
      .replace(/"$/, "");
  }

  /**
   * Create a standard event payload
   */
  private createEventPayload(
    event: WebhookEventType,
    file: TFile,
    metadata: Record<string, unknown>,
    additionalData?: Record<string, unknown>
  ): WebhookEventPayload {
    return {
      event,
      timestamp: new Date().toISOString(),
      filePath: file.path,
      label: metadata.exo__Asset_label as string | undefined,
      uid: metadata.exo__Asset_uid as string | undefined,
      instanceClass: this.extractInstanceClass(metadata),
      data: additionalData,
    };
  }

  /**
   * Register a new webhook
   */
  registerWebhook(config: WebhookConfig): void {
    this.webhookService.registerWebhook(config);
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(id: string): boolean {
    return this.webhookService.unregisterWebhook(id);
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return this.webhookService.getWebhooks();
  }

  /**
   * Update a webhook configuration
   */
  updateWebhook(id: string, updates: Partial<WebhookConfig>): boolean {
    return this.webhookService.updateWebhook(id, updates);
  }

  /**
   * Test a webhook
   */
  async testWebhook(webhookId: string): ReturnType<WebhookService["testWebhook"]> {
    return this.webhookService.testWebhook(webhookId);
  }

  /**
   * Get dispatch history
   */
  getDispatchHistory(limit = 50): ReturnType<WebhookService["getDispatchHistory"]> {
    return this.webhookService.getDispatchHistory(limit);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.disable();
    this.webhookService.cleanup();
  }
}
