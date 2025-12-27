import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SemanticSearchService,
  DEFAULT_SEMANTIC_SEARCH_CONFIG,
} from "../../../src/services/SemanticSearchService";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("SemanticSearchService", () => {
  let service: SemanticSearchService;

  const mockEmbeddingResponse = (embeddings: number[][]) => ({
    ok: true,
    json: async () => ({
      data: embeddings.map((embedding, index) => ({ embedding, index })),
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SemanticSearchService();
  });

  describe("constructor", () => {
    it("should use default config", () => {
      const config = service.getConfig();
      expect(config.maxResults).toBe(DEFAULT_SEMANTIC_SEARCH_CONFIG.maxResults);
      expect(config.minSimilarity).toBe(DEFAULT_SEMANTIC_SEARCH_CONFIG.minSimilarity);
    });
  });

  describe("isConfigured", () => {
    it("should return false when API key not set", () => {
      expect(service.isConfigured()).toBe(false);
    });

    it("should return true when API key is set", () => {
      service.setConfig({ embedding: { apiKey: "test-key" } });
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      service.setConfig({ embedding: { apiKey: "test-key" } });
    });

    it("should return empty array for empty query", async () => {
      const results = await service.search("");
      expect(results).toEqual([]);
    });

    it("should search for similar notes", async () => {
      // First, index some files
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[1, 0, 0]])
      );
      await service.indexFile("file1.md", "Test content", {
        exo__Asset_label: "Test Note",
      });

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.9, 0.1, 0]])
      );
      await service.indexFile("file2.md", "Similar content");

      // Now search
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[1, 0, 0]])
      );

      service.setConfig({ minSimilarity: 0.8 });
      const results = await service.search("test query");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBeDefined();
      expect(results[0].score).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("findSimilar", () => {
    beforeEach(() => {
      service.setConfig({ embedding: { apiKey: "test-key" } });
    });

    it("should return empty for non-indexed file", async () => {
      const results = await service.findSimilar("non-existent.md");
      expect(results).toEqual([]);
    });

    it("should find similar notes", async () => {
      // Index files with similar vectors
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[1, 0, 0]])
      );
      await service.indexFile("file1.md", "First content");

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.95, 0.05, 0]])
      );
      await service.indexFile("file2.md", "Similar content");

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0, 1, 0]])
      );
      await service.indexFile("file3.md", "Different content");

      service.setConfig({ minSimilarity: 0.5 });
      const results = await service.findSimilar("file1.md", 10);

      expect(results.length).toBeGreaterThan(0);
      // Should not include file1.md itself
      expect(results.every((r) => r.path !== "file1.md")).toBe(true);
      // file2 should be more similar than file3
      const file2Index = results.findIndex((r) => r.path === "file2.md");
      const file3Index = results.findIndex((r) => r.path === "file3.md");
      if (file2Index !== -1 && file3Index !== -1) {
        expect(file2Index).toBeLessThan(file3Index);
      }
    });
  });

  describe("indexFile", () => {
    beforeEach(() => {
      service.setConfig({ embedding: { apiKey: "test-key" } });
    });

    it("should return false when not configured", async () => {
      const unconfiguredService = new SemanticSearchService();
      const result = await unconfiguredService.indexFile("file.md", "content");
      expect(result).toBe(false);
    });

    it("should index file and store embedding", async () => {
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      const result = await service.indexFile("test.md", "Test content");

      expect(result).toBe(true);
      expect(service.isIndexed("test.md")).toBe(true);
    });

    it("should skip unchanged files", async () => {
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      await service.indexFile("test.md", "Test content");
      const secondResult = await service.indexFile("test.md", "Test content");

      expect(secondResult).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only called once
    });
  });

  describe("indexBatch", () => {
    beforeEach(() => {
      service.setConfig({ embedding: { apiKey: "test-key" } });
    });

    it("should index multiple files", async () => {
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ])
      );

      const result = await service.indexBatch([
        { path: "file1.md", content: "Content 1" },
        { path: "file2.md", content: "Content 2" },
      ]);

      expect(result.indexed).toBe(2);
      expect(result.failed).toBe(0);
      expect(service.isIndexed("file1.md")).toBe(true);
      expect(service.isIndexed("file2.md")).toBe(true);
    });
  });

  describe("removeFromIndex", () => {
    it("should remove file from index", async () => {
      service.setConfig({ embedding: { apiKey: "test-key" } });

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      await service.indexFile("test.md", "content");
      expect(service.isIndexed("test.md")).toBe(true);

      service.removeFromIndex("test.md");
      expect(service.isIndexed("test.md")).toBe(false);
    });
  });

  describe("indexAll", () => {
    beforeEach(() => {
      service.setConfig({ embedding: { apiKey: "test-key" }, batchSize: 2 });
    });

    it("should throw when not configured", async () => {
      const unconfiguredService = new SemanticSearchService();
      await expect(
        unconfiguredService.indexAll(["file.md"], async () => null)
      ).rejects.toThrow("not properly configured");
    });

    it("should index all files with progress", async () => {
      const progressCalls: number[] = [];

      mockFetch.mockResolvedValue(
        mockEmbeddingResponse([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ])
      );

      const result = await service.indexAll(
        ["file1.md", "file2.md", "file3.md"],
        async (path) => ({ content: `Content of ${path}` }),
        (status) => progressCalls.push(status.progress)
      );

      expect(result.indexed).toBeGreaterThan(0);
      expect(result.aborted).toBe(false);
      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it("should handle provider returning null", async () => {
      mockFetch.mockResolvedValue(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      const result = await service.indexAll(
        ["file1.md", "file2.md"],
        async (path) => (path === "file1.md" ? null : { content: "content" })
      );

      expect(result.failed).toBe(1);
    });
  });

  describe("abortIndexing", () => {
    it("should abort ongoing indexing", async () => {
      service.setConfig({ embedding: { apiKey: "test-key" }, batchSize: 1 });

      // Create a slow mock that allows abort to happen
      mockFetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return mockEmbeddingResponse([[0.1, 0.2, 0.3]]);
      });

      const indexPromise = service.indexAll(
        Array(10).fill("file.md").map((f, i) => `${f}${i}`),
        async () => ({ content: "content" })
      );

      // Abort after a short delay
      setTimeout(() => service.abortIndexing(), 50);

      const result = await indexPromise;
      expect(result.aborted).toBe(true);
    });
  });

  describe("getIndexingStatus", () => {
    it("should return current status", () => {
      const status = service.getIndexingStatus();
      expect(status.isIndexing).toBe(false);
      expect(status.totalFiles).toBe(0);
      expect(status.indexedFiles).toBe(0);
    });
  });

  describe("clearIndex", () => {
    it("should clear all indexed files", async () => {
      service.setConfig({ embedding: { apiKey: "test-key" } });

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      await service.indexFile("test.md", "content");
      expect(service.getIndexedCount()).toBe(1);

      service.clearIndex();
      expect(service.getIndexedCount()).toBe(0);
    });
  });

  describe("pruneDeletedFiles", () => {
    it("should remove entries for deleted files", async () => {
      service.setConfig({ embedding: { apiKey: "test-key" } });

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );
      await service.indexFile("file1.md", "content1");

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.4, 0.5, 0.6]])
      );
      await service.indexFile("file2.md", "content2");

      const pruned = service.pruneDeletedFiles(new Set(["file1.md"]));

      expect(pruned).toBe(1);
      expect(service.isIndexed("file1.md")).toBe(true);
      expect(service.isIndexed("file2.md")).toBe(false);
    });
  });

  describe("serialize/deserialize", () => {
    it("should serialize and deserialize index", async () => {
      service.setConfig({ embedding: { apiKey: "test-key" } });

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      await service.indexFile("test.md", "content", {
        exo__Asset_label: "Test",
      });

      const serialized = service.serializeIndex();
      expect(serialized.entries.length).toBe(1);

      const newService = new SemanticSearchService();
      newService.deserializeIndex(serialized);

      expect(newService.isIndexed("test.md")).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return combined stats", async () => {
      service.setConfig({ embedding: { apiKey: "test-key" } });

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([[0.1, 0.2, 0.3]])
      );

      await service.indexFile("test.md", "content");

      const stats = service.getStats();

      expect(stats.indexStats.entryCount).toBe(1);
      expect(stats.embeddingStats.requestCount).toBe(1);
    });
  });
});
