import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EmbeddingService,
  DEFAULT_EMBEDDING_CONFIG,
} from "../../../src/services/EmbeddingService";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmbeddingService();
  });

  describe("constructor", () => {
    it("should use default config when no config provided", () => {
      const config = service.getConfig();
      expect(config.provider).toBe(DEFAULT_EMBEDDING_CONFIG.provider);
      expect(config.model).toBe(DEFAULT_EMBEDDING_CONFIG.model);
      expect(config.timeout).toBe(DEFAULT_EMBEDDING_CONFIG.timeout);
    });

    it("should merge provided config with defaults", () => {
      const customService = new EmbeddingService({
        provider: "openai",
        model: "text-embedding-ada-002",
      });
      const config = customService.getConfig();
      expect(config.provider).toBe("openai");
      expect(config.model).toBe("text-embedding-ada-002");
      expect(config.timeout).toBe(DEFAULT_EMBEDDING_CONFIG.timeout);
    });
  });

  describe("isConfigured", () => {
    it("should return false when OpenAI provider has no API key", () => {
      expect(service.isConfigured()).toBe(false);
    });

    it("should return true when OpenAI provider has API key", () => {
      service.setConfig({ apiKey: "test-api-key" });
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe("setConfig", () => {
    it("should update config", () => {
      service.setConfig({
        model: "text-embedding-3-large",
        maxTextLength: 10000,
      });
      const config = service.getConfig();
      expect(config.model).toBe("text-embedding-3-large");
      expect(config.maxTextLength).toBe(10000);
    });

    it("should not expose apiKey in getConfig", () => {
      service.setConfig({ apiKey: "secret-key" });
      const config = service.getConfig();
      expect("apiKey" in config).toBe(false);
    });
  });

  describe("generateEmbedding", () => {
    it("should throw when not configured", async () => {
      await expect(service.generateEmbedding("test")).rejects.toThrow(
        "EmbeddingService is not properly configured"
      );
    });

    it("should call OpenAI API with correct parameters", async () => {
      service.setConfig({ apiKey: "test-key", model: "text-embedding-3-small" });

      const mockEmbedding = Array(1536).fill(0.1);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding, index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      });

      const result = await service.generateEmbedding("test text");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-key",
          }),
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: ["test text"],
          }),
        })
      );

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.model).toBe("text-embedding-3-small");
    });

    it("should handle API error", async () => {
      service.setConfig({ apiKey: "test-key" });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid API key",
      });

      await expect(service.generateEmbedding("test")).rejects.toThrow(
        /OpenAI API error: 401/
      );
    });

    it("should truncate long text", async () => {
      service.setConfig({ apiKey: "test-key", maxTextLength: 100 });

      const longText = "a".repeat(200);
      const mockEmbedding = Array(1536).fill(0.1);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding, index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 50, total_tokens: 50 },
        }),
      });

      await service.generateEmbedding(longText);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(callBody.input[0].length).toBe(100);
    });
  });

  describe("generateBatchEmbeddings", () => {
    it("should return empty array for empty input", async () => {
      service.setConfig({ apiKey: "test-key" });
      const results = await service.generateBatchEmbeddings([]);
      expect(results).toEqual([]);
    });

    it("should process multiple texts in batch", async () => {
      service.setConfig({ apiKey: "test-key" });

      const mockEmbeddings = [
        Array(1536).fill(0.1),
        Array(1536).fill(0.2),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { embedding: mockEmbeddings[0], index: 0 },
            { embedding: mockEmbeddings[1], index: 1 },
          ],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      });

      const results = await service.generateBatchEmbeddings([
        { id: "file1.md", text: "First text" },
        { id: "file2.md", text: "Second text" },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("file1.md");
      expect(results[0].result?.embedding).toEqual(mockEmbeddings[0]);
      expect(results[1].id).toBe("file2.md");
      expect(results[1].result?.embedding).toEqual(mockEmbeddings[1]);
    });

    it("should handle batch failure", async () => {
      service.setConfig({ apiKey: "test-key" });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      const results = await service.generateBatchEmbeddings([
        { id: "file1.md", text: "Text 1" },
        { id: "file2.md", text: "Text 2" },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].result).toBeNull();
      expect(results[0].error).toBeDefined();
      expect(results[1].result).toBeNull();
    });
  });

  describe("prepareTextForEmbedding", () => {
    it("should clean markdown content", () => {
      const content = `---
title: Test
---

# Header

Some **bold** text with \`code\`.

\`\`\`typescript
const x = 1;
\`\`\`

[[wiki-link]] and [regular link](http://example.com).
`;

      const result = service.prepareTextForEmbedding(content);

      // Should remove frontmatter
      expect(result).not.toContain("---");
      expect(result).not.toContain("title: Test");

      // Should preserve text content
      expect(result).toContain("Header");
      expect(result).toContain("bold");
      expect(result).toContain("code");

      // Should preserve code block content
      expect(result).toContain("const x = 1");

      // Should clean wiki-links
      expect(result).toContain("wiki-link");
      expect(result).not.toContain("[[");

      // Should clean regular links
      expect(result).toContain("regular link");
      expect(result).not.toContain("http://example.com");
    });

    it("should include metadata in prepared text", () => {
      const content = "Some content";
      const metadata = {
        exo__Asset_label: "Test Label",
        exo__Instance_class: ["[[ems__Task]]"],
      };

      const result = service.prepareTextForEmbedding(content, metadata);

      expect(result).toContain("Title: Test Label");
      expect(result).toContain("Type: ems__Task");
      expect(result).toContain("Some content");
    });
  });

  describe("getStats", () => {
    it("should track request and token counts", async () => {
      service.setConfig({ apiKey: "test-key" });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      });

      const statsBefore = service.getStats();
      expect(statsBefore.requestCount).toBe(0);
      expect(statsBefore.tokenCount).toBe(0);

      await service.generateEmbedding("test");

      const statsAfter = service.getStats();
      expect(statsAfter.requestCount).toBe(1);
      expect(statsAfter.tokenCount).toBe(5);
    });

    it("should reset stats", async () => {
      service.setConfig({ apiKey: "test-key" });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: Array(1536).fill(0.1), index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      });

      await service.generateEmbedding("test");
      service.resetStats();

      const stats = service.getStats();
      expect(stats.requestCount).toBe(0);
      expect(stats.tokenCount).toBe(0);
    });
  });
});
