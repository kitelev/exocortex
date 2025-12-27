import {
  WebhookService,
  WebhookConfig,
  WebhookEventPayload,
  WebhookEventType,
} from "../../../src/services/WebhookService";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock crypto.subtle for HMAC
Object.defineProperty(global, "crypto", {
  value: {
    subtle: {
      importKey: jest.fn().mockResolvedValue({}),
      sign: jest.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  },
});

describe("WebhookService", () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService();
    mockFetch.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    service.cleanup();
    jest.useRealTimers();
  });

  describe("registerWebhook", () => {
    it("should register a valid webhook", () => {
      const config: WebhookConfig = {
        id: "test-webhook",
        name: "Test Webhook",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
      };

      service.registerWebhook(config);

      const webhooks = service.getWebhooks();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].id).toBe("test-webhook");
    });

    it("should throw error for missing ID", () => {
      const config = {
        id: "",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      } as WebhookConfig;

      expect(() => service.registerWebhook(config)).toThrow("Webhook ID is required");
    });

    it("should throw error for missing URL", () => {
      const config: WebhookConfig = {
        id: "test",
        name: "Test",
        url: "",
        events: [],
        enabled: true,
      };

      expect(() => service.registerWebhook(config)).toThrow("Webhook URL is required");
    });

    it("should throw error for invalid URL", () => {
      const config: WebhookConfig = {
        id: "test",
        name: "Test",
        url: "not-a-valid-url",
        events: [],
        enabled: true,
      };

      expect(() => service.registerWebhook(config)).toThrow("Invalid webhook URL");
    });

    it("should set default timeout and retryCount", () => {
      const config: WebhookConfig = {
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      };

      service.registerWebhook(config);

      const webhook = service.getWebhook("test-webhook");
      expect(webhook?.timeout).toBe(30000);
      expect(webhook?.retryCount).toBe(3);
    });
  });

  describe("unregisterWebhook", () => {
    it("should remove a registered webhook", () => {
      const config: WebhookConfig = {
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      };

      service.registerWebhook(config);
      expect(service.getWebhooks()).toHaveLength(1);

      const result = service.unregisterWebhook("test-webhook");

      expect(result).toBe(true);
      expect(service.getWebhooks()).toHaveLength(0);
    });

    it("should return false for non-existent webhook", () => {
      const result = service.unregisterWebhook("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("updateWebhook", () => {
    it("should update an existing webhook", () => {
      const config: WebhookConfig = {
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      };

      service.registerWebhook(config);

      const result = service.updateWebhook("test-webhook", {
        name: "Updated Name",
        enabled: false,
      });

      expect(result).toBe(true);

      const webhook = service.getWebhook("test-webhook");
      expect(webhook?.name).toBe("Updated Name");
      expect(webhook?.enabled).toBe(false);
    });

    it("should return false for non-existent webhook", () => {
      const result = service.updateWebhook("non-existent", { name: "New Name" });
      expect(result).toBe(false);
    });

    it("should validate new URL if provided", () => {
      const config: WebhookConfig = {
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      };

      service.registerWebhook(config);

      expect(() => service.updateWebhook("test-webhook", { url: "invalid" })).toThrow(
        "Invalid webhook URL"
      );
    });
  });

  describe("getWebhooksForEvent", () => {
    beforeEach(() => {
      service.registerWebhook({
        id: "webhook-all",
        name: "All Events",
        url: "https://example.com/all",
        events: [],
        enabled: true,
      });

      service.registerWebhook({
        id: "webhook-notes",
        name: "Notes Only",
        url: "https://example.com/notes",
        events: ["note.created", "note.updated"],
        enabled: true,
      });

      service.registerWebhook({
        id: "webhook-disabled",
        name: "Disabled",
        url: "https://example.com/disabled",
        events: ["note.created"],
        enabled: false,
      });
    });

    it("should return webhooks subscribed to all events", () => {
      const webhooks = service.getWebhooksForEvent("task.completed");

      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].id).toBe("webhook-all");
    });

    it("should return webhooks subscribed to specific event", () => {
      const webhooks = service.getWebhooksForEvent("note.created");

      expect(webhooks).toHaveLength(2);
      expect(webhooks.map((w) => w.id)).toContain("webhook-all");
      expect(webhooks.map((w) => w.id)).toContain("webhook-notes");
    });

    it("should not return disabled webhooks", () => {
      const webhooks = service.getWebhooksForEvent("note.created");

      expect(webhooks.find((w) => w.id === "webhook-disabled")).toBeUndefined();
    });
  });

  describe("dispatchEvent", () => {
    it("should dispatch event to subscribed webhooks", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
        label: "Test File",
      };

      const results = await service.dispatchEvent(payload);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].webhookId).toBe("test-webhook");
      expect(results[0].statusCode).toBe(200);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          method: "POST",
          body: expect.any(String),
        })
      );
    });

    it("should not dispatch to unsubscribed webhooks", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "task-only",
        name: "Task Only",
        url: "https://example.com/webhook",
        events: ["task.completed"],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      const results = await service.dispatchEvent(payload);

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should handle failed requests with retry", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
        });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
        retryCount: 3,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      // Run timers for exponential backoff
      const resultPromise = service.dispatchEvent(payload);

      // Fast-forward through retries
      await jest.runAllTimersAsync();

      const results = await resultPromise;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].retryCount).toBe(2);
    });

    it("should return error after max retries exceeded", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
        retryCount: 2,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      const resultPromise = service.dispatchEvent(payload);
      await jest.runAllTimersAsync();
      const results = await resultPromise;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Network error");
    });

    it("should handle HTTP error responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
        retryCount: 0,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      const results = await service.dispatchEvent(payload);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("500");
    });

    it("should include custom headers", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
        headers: {
          "X-Custom-Header": "custom-value",
        },
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      await service.dispatchEvent(payload);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Custom-Header": "custom-value",
          }),
        })
      );
    });

    it("should include HMAC signature when secret is configured", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
        secret: "my-secret",
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      await service.dispatchEvent(payload);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Webhook-Signature": expect.stringMatching(/^sha256=/),
          }),
        })
      );
    });
  });

  describe("rate limiting", () => {
    it("should rate limit excessive requests", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.setRateLimitConfig({
        maxRequests: 2,
        windowMs: 60000,
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      // First two should succeed
      await service.dispatchEvent(payload);
      await service.dispatchEvent(payload);

      // Third should be rate limited
      const results = await service.dispatchEvent(payload);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Rate limit exceeded");
    });

    it("should reset rate limit after window expires", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.setRateLimitConfig({
        maxRequests: 1,
        windowMs: 1000,
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      // First should succeed
      await service.dispatchEvent(payload);

      // Second should be rate limited
      const limitedResults = await service.dispatchEvent(payload);
      expect(limitedResults[0].success).toBe(false);

      // Advance time past the window
      jest.advanceTimersByTime(1001);

      // Third should succeed after window reset
      const successResults = await service.dispatchEvent(payload);
      expect(successResults[0].success).toBe(true);
    });

    it("should report rate limit status correctly", () => {
      service.setRateLimitConfig({
        maxRequests: 1,
        windowMs: 60000,
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      expect(service.isRateLimited("test-webhook")).toBe(false);
    });
  });

  describe("testWebhook", () => {
    it("should send a test event", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: true,
      });

      const result = await service.testWebhook("test-webhook");

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.test).toBe(true);
    });

    it("should return error for non-existent webhook", async () => {
      const result = await service.testWebhook("non-existent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Webhook not found");
    });

    it("should work even for disabled webhooks", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: ["note.created"],
        enabled: false, // Disabled
      });

      const result = await service.testWebhook("test-webhook");

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("dispatch history", () => {
    it("should record dispatch results", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      await service.dispatchEvent(payload);

      const history = service.getDispatchHistory();
      expect(history).toHaveLength(1);
      expect(history[0].success).toBe(true);
    });

    it("should limit history size", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      // Dispatch more than max history size (100)
      for (let i = 0; i < 110; i++) {
        await service.dispatchEvent(payload);
      }

      const history = service.getDispatchHistory(200);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it("should clear history", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });

      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      const payload: WebhookEventPayload = {
        event: "note.created",
        timestamp: new Date().toISOString(),
        filePath: "/test/file.md",
      };

      await service.dispatchEvent(payload);
      expect(service.getDispatchHistory()).toHaveLength(1);

      service.clearDispatchHistory();
      expect(service.getDispatchHistory()).toHaveLength(0);
    });
  });

  describe("cleanup", () => {
    it("should clear all state", () => {
      service.registerWebhook({
        id: "test-webhook",
        name: "Test",
        url: "https://example.com/webhook",
        events: [],
        enabled: true,
      });

      expect(service.getWebhooks()).toHaveLength(1);

      service.cleanup();

      expect(service.getWebhooks()).toHaveLength(0);
      expect(service.getDispatchHistory()).toHaveLength(0);
    });
  });
});
