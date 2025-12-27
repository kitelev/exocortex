import { injectable } from "tsyringe";
import { LoggingService } from "./LoggingService";

/**
 * Webhook event types supported by the Exocortex plugin
 */
export type WebhookEventType =
  | "note.created"
  | "note.updated"
  | "note.deleted"
  | "task.completed"
  | "task.started"
  | "task.blocked"
  | "status.changed"
  | "property.changed";

/**
 * Base webhook event payload
 */
export interface WebhookEventPayload {
  /** Event type */
  event: WebhookEventType;
  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;
  /** Path to the affected file */
  filePath: string;
  /** Asset label if available */
  label?: string;
  /** Asset UID if available */
  uid?: string;
  /** Instance class (e.g., "ems__Task") */
  instanceClass?: string;
  /** Additional event-specific data */
  data?: Record<string, unknown>;
}

/**
 * Webhook configuration for a single endpoint
 */
export interface WebhookConfig {
  /** Unique identifier for the webhook */
  id: string;
  /** Human-readable name */
  name: string;
  /** Target URL to send events to */
  url: string;
  /** Events to subscribe to (empty = all events) */
  events: WebhookEventType[];
  /** Whether the webhook is enabled */
  enabled: boolean;
  /** Optional secret for HMAC signature */
  secret?: string;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Retry count on failure (default: 3) */
  retryCount?: number;
}

/**
 * Result of a webhook dispatch attempt
 */
export interface WebhookDispatchResult {
  webhookId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  timestamp: string;
  retryCount: number;
}

/**
 * Configuration for rate limiting
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Rate limiter state for a webhook
 */
interface RateLimitState {
  requests: number;
  windowStart: number;
}

/**
 * Service for managing outgoing webhooks.
 * Handles event dispatching to configured webhook endpoints with rate limiting,
 * retries, and HMAC signature support.
 */
@injectable()
export class WebhookService {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private rateLimitStates: Map<string, RateLimitState> = new Map();
  private defaultRateLimitConfig: RateLimitConfig = {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
  };
  private dispatchHistory: WebhookDispatchResult[] = [];
  private maxHistorySize = 100;

  /**
   * Register a webhook configuration
   */
  registerWebhook(config: WebhookConfig): void {
    if (!config.id) {
      throw new Error("Webhook ID is required");
    }
    if (!config.url) {
      throw new Error("Webhook URL is required");
    }

    // Validate URL format
    try {
      new URL(config.url);
    } catch {
      throw new Error(`Invalid webhook URL: ${config.url}`);
    }

    this.webhooks.set(config.id, {
      ...config,
      timeout: config.timeout ?? 30000,
      retryCount: config.retryCount ?? 3,
    });

    LoggingService.debug(`Registered webhook: ${config.name} (${config.id})`);
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(id: string): boolean {
    const deleted = this.webhooks.delete(id);
    this.rateLimitStates.delete(id);
    if (deleted) {
      LoggingService.debug(`Unregistered webhook: ${id}`);
    }
    return deleted;
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Get a specific webhook by ID
   */
  getWebhook(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  /**
   * Update an existing webhook configuration
   */
  updateWebhook(id: string, updates: Partial<WebhookConfig>): boolean {
    const existing = this.webhooks.get(id);
    if (!existing) {
      return false;
    }

    if (updates.url) {
      try {
        new URL(updates.url);
      } catch {
        throw new Error(`Invalid webhook URL: ${updates.url}`);
      }
    }

    this.webhooks.set(id, { ...existing, ...updates, id });
    LoggingService.debug(`Updated webhook: ${id}`);
    return true;
  }

  /**
   * Get webhooks subscribed to a specific event type
   */
  getWebhooksForEvent(eventType: WebhookEventType): WebhookConfig[] {
    return Array.from(this.webhooks.values()).filter(
      (webhook) =>
        webhook.enabled &&
        (webhook.events.length === 0 || webhook.events.includes(eventType))
    );
  }

  /**
   * Check if a webhook is rate limited
   */
  isRateLimited(webhookId: string): boolean {
    const state = this.rateLimitStates.get(webhookId);
    if (!state) {
      return false;
    }

    const now = Date.now();
    const { maxRequests, windowMs } = this.defaultRateLimitConfig;

    // Reset window if expired
    if (now - state.windowStart >= windowMs) {
      this.rateLimitStates.set(webhookId, { requests: 0, windowStart: now });
      return false;
    }

    return state.requests >= maxRequests;
  }

  /**
   * Record a request for rate limiting
   */
  private recordRequest(webhookId: string): void {
    const now = Date.now();
    const state = this.rateLimitStates.get(webhookId);
    const { windowMs } = this.defaultRateLimitConfig;

    if (!state || now - state.windowStart >= windowMs) {
      this.rateLimitStates.set(webhookId, { requests: 1, windowStart: now });
    } else {
      state.requests++;
    }
  }

  /**
   * Set custom rate limit configuration
   */
  setRateLimitConfig(config: RateLimitConfig): void {
    this.defaultRateLimitConfig = config;
  }

  /**
   * Dispatch an event to all subscribed webhooks
   */
  async dispatchEvent(payload: WebhookEventPayload): Promise<WebhookDispatchResult[]> {
    const webhooks = this.getWebhooksForEvent(payload.event);
    const results: WebhookDispatchResult[] = [];

    for (const webhook of webhooks) {
      const result = await this.dispatchToWebhook(webhook, payload);
      results.push(result);
      this.addToHistory(result);
    }

    return results;
  }

  /**
   * Dispatch event to a single webhook with retries
   */
  private async dispatchToWebhook(
    webhook: WebhookConfig,
    payload: WebhookEventPayload
  ): Promise<WebhookDispatchResult> {
    const maxRetries = webhook.retryCount ?? 3;
    let lastError: string | undefined;
    let attempt = 0;

    while (attempt <= maxRetries) {
      // Check rate limit
      if (this.isRateLimited(webhook.id)) {
        return {
          webhookId: webhook.id,
          success: false,
          error: "Rate limit exceeded",
          timestamp: new Date().toISOString(),
          retryCount: attempt,
        };
      }

      try {
        this.recordRequest(webhook.id);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": "Exocortex-Webhook/1.0",
          "X-Webhook-Event": payload.event,
          "X-Webhook-Timestamp": payload.timestamp,
          ...webhook.headers,
        };

        // Add HMAC signature if secret is configured
        const body = JSON.stringify(payload);
        if (webhook.secret) {
          const signature = await this.createHmacSignature(body, webhook.secret);
          headers["X-Webhook-Signature"] = signature;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          webhook.timeout ?? 30000
        );

        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            LoggingService.debug(
              `Webhook ${webhook.name} dispatched successfully: ${response.status}`
            );
            return {
              webhookId: webhook.id,
              success: true,
              statusCode: response.status,
              timestamp: new Date().toISOString(),
              retryCount: attempt,
            };
          }

          lastError = `HTTP ${response.status}: ${response.statusText}`;
          LoggingService.warn(`Webhook ${webhook.name} failed: ${lastError}`);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : "Unknown error";

        if (error instanceof Error && error.name === "AbortError") {
          lastError = "Request timeout";
        }

        LoggingService.warn(
          `Webhook ${webhook.name} error (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError}`
        );
      }

      attempt++;

      // Exponential backoff between retries
      if (attempt <= maxRetries) {
        await this.delay(Math.pow(2, attempt) * 100);
      }
    }

    return {
      webhookId: webhook.id,
      success: false,
      error: lastError,
      timestamp: new Date().toISOString(),
      retryCount: attempt - 1,
    };
  }

  /**
   * Create HMAC-SHA256 signature for payload
   */
  private async createHmacSignature(payload: string, secret: string): Promise<string> {
    // Use Web Crypto API for HMAC
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(payload);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    return "sha256=" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Delay utility for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Add result to dispatch history
   */
  private addToHistory(result: WebhookDispatchResult): void {
    this.dispatchHistory.push(result);
    if (this.dispatchHistory.length > this.maxHistorySize) {
      this.dispatchHistory.shift();
    }
  }

  /**
   * Get recent dispatch history
   */
  getDispatchHistory(limit = 50): WebhookDispatchResult[] {
    return this.dispatchHistory.slice(-limit);
  }

  /**
   * Clear dispatch history
   */
  clearDispatchHistory(): void {
    this.dispatchHistory = [];
  }

  /**
   * Test a webhook by sending a test event
   */
  async testWebhook(webhookId: string): Promise<WebhookDispatchResult> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      return {
        webhookId,
        success: false,
        error: "Webhook not found",
        timestamp: new Date().toISOString(),
        retryCount: 0,
      };
    }

    const testPayload: WebhookEventPayload = {
      event: "note.updated",
      timestamp: new Date().toISOString(),
      filePath: "/test/webhook-test.md",
      label: "Webhook Test",
      data: {
        test: true,
        message: "This is a test webhook event from Exocortex",
      },
    };

    // Temporarily enable webhook for test
    const originalEnabled = webhook.enabled;
    webhook.enabled = true;

    const result = await this.dispatchToWebhook(webhook, testPayload);

    // Restore original state
    webhook.enabled = originalEnabled;

    return result;
  }

  /**
   * Clear all webhooks and state
   */
  cleanup(): void {
    this.webhooks.clear();
    this.rateLimitStates.clear();
    this.dispatchHistory = [];
  }
}
