/**
 * Unit tests for StreamingLoader
 */

import { StreamingLoader, createStreamingSource } from "../../../../src/infrastructure/memory/StreamingLoader";
import { CompactGraphStore } from "../../../../src/infrastructure/memory/CompactGraphStore";
import type { GraphChunk, ChunkNode, ChunkEdge } from "../../../../src/infrastructure/memory/types";

describe("StreamingLoader", () => {
  let store: CompactGraphStore;
  let loader: StreamingLoader;

  beforeEach(() => {
    store = new CompactGraphStore();
    loader = new StreamingLoader(store, {
      chunkSize: 2,
      chunkDelay: 0,
    });
  });

  describe("constructor", () => {
    it("should create loader in idle state", () => {
      expect(loader.getState()).toBe("idle");
    });

    it("should have zero progress initially", () => {
      const progress = loader.getProgress();
      expect(progress.nodesLoaded).toBe(0);
      expect(progress.edgesLoaded).toBe(0);
      expect(progress.isComplete).toBe(false);
    });
  });

  describe("loadChunk", () => {
    it("should load a single chunk", () => {
      loader.loadChunk({
        chunkIndex: 0,
        totalChunks: 1,
        nodes: [
          { id: "n1", label: "Node 1" },
          { id: "n2", label: "Node 2" },
        ],
        edges: [{ sourceId: "n1", targetId: "n2" }],
        isLast: true,
      });

      expect(store.getNodeCount()).toBe(2);
      expect(store.getEdgeCount()).toBe(1);
      expect(loader.getState()).toBe("completed");
    });

    it("should transition to loading state", () => {
      loader.loadChunk({
        chunkIndex: 0,
        nodes: [{ id: "n1", label: "1" }],
        edges: [],
        isLast: false,
      });

      expect(loader.getState()).toBe("loading");
    });

    it("should track progress across chunks", () => {
      loader.loadChunk({
        chunkIndex: 0,
        totalChunks: 2,
        nodes: [{ id: "n1", label: "1" }],
        edges: [],
        isLast: false,
      });

      const progress = loader.getProgress();
      expect(progress.currentChunk).toBe(1);
      expect(progress.totalChunks).toBe(2);
      expect(progress.nodesLoaded).toBe(1);
    });

    it("should queue edges when target nodes not yet loaded", () => {
      loader.loadChunk({
        chunkIndex: 0,
        nodes: [{ id: "n1", label: "1" }],
        edges: [{ sourceId: "n1", targetId: "n2" }], // n2 doesn't exist yet
        isLast: false,
      });

      expect(store.getEdgeCount()).toBe(0);
      expect(loader.getPendingEdgeCount()).toBe(1);
    });

    it("should resolve pending edges when last chunk is loaded", () => {
      loader.loadChunk({
        chunkIndex: 0,
        nodes: [{ id: "n1", label: "1" }],
        edges: [{ sourceId: "n1", targetId: "n2" }],
        isLast: false,
      });

      loader.loadChunk({
        chunkIndex: 1,
        nodes: [{ id: "n2", label: "2" }],
        edges: [],
        isLast: true,
      });

      expect(store.getEdgeCount()).toBe(1);
      expect(loader.getPendingEdgeCount()).toBe(0);
    });
  });

  describe("onProgress", () => {
    it("should call progress callbacks", () => {
      const callback = jest.fn();
      loader.onProgress(callback);

      loader.loadChunk({
        chunkIndex: 0,
        nodes: [{ id: "n1", label: "1" }],
        edges: [],
        isLast: true,
      });

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          nodesLoaded: 1,
          isComplete: true,
        })
      );
    });

    it("should allow unsubscribing", () => {
      const callback = jest.fn();
      const unsubscribe = loader.onProgress(callback);

      unsubscribe();

      loader.loadChunk({
        chunkIndex: 0,
        nodes: [{ id: "n1", label: "1" }],
        edges: [],
        isLast: true,
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("loadFromIterator", () => {
    async function* createChunks(): AsyncGenerator<GraphChunk> {
      yield {
        chunkIndex: 0,
        totalChunks: 2,
        nodes: [{ id: "n1", label: "1" }],
        edges: [],
        isLast: false,
      };
      yield {
        chunkIndex: 1,
        totalChunks: 2,
        nodes: [{ id: "n2", label: "2" }],
        edges: [{ sourceId: "n1", targetId: "n2" }],
        isLast: true,
      };
    }

    it("should load from async iterator", async () => {
      await loader.loadFromIterator(createChunks());

      expect(store.getNodeCount()).toBe(2);
      expect(store.getEdgeCount()).toBe(1);
      expect(loader.getState()).toBe("completed");
    });

    it("should reset state before loading", async () => {
      // Load once
      await loader.loadFromIterator(createChunks());

      // Reset and load again
      loader.reset();
      await loader.loadFromIterator(createChunks());

      const progress = loader.getProgress();
      expect(progress.nodesLoaded).toBe(2);
    });
  });

  describe("loadFromArrays", () => {
    it("should chunk and load arrays", async () => {
      const nodes: ChunkNode[] = [
        { id: "n1", label: "1" },
        { id: "n2", label: "2" },
        { id: "n3", label: "3" },
        { id: "n4", label: "4" },
      ];

      const edges: ChunkEdge[] = [
        { sourceId: "n1", targetId: "n2" },
        { sourceId: "n2", targetId: "n3" },
      ];

      await loader.loadFromArrays(nodes, edges);

      expect(store.getNodeCount()).toBe(4);
      expect(store.getEdgeCount()).toBe(2);
      expect(loader.getState()).toBe("completed");
    });
  });

  describe("cancel", () => {
    it("should cancel loading", async () => {
      async function* slowChunks(): AsyncGenerator<GraphChunk> {
        yield {
          chunkIndex: 0,
          nodes: [{ id: "n1", label: "1" }],
          edges: [],
          isLast: false,
        };
        // Simulate slow loading
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield {
          chunkIndex: 1,
          nodes: [{ id: "n2", label: "2" }],
          edges: [],
          isLast: true,
        };
      }

      const loadPromise = loader.loadFromIterator(slowChunks());

      // Cancel immediately
      loader.cancel();

      await loadPromise;

      expect(loader.getState()).toBe("paused");
      // Only first chunk should be loaded
      expect(store.getNodeCount()).toBe(1);
    });
  });

  describe("reset", () => {
    it("should reset all state", async () => {
      await loader.loadFromArrays(
        [{ id: "n1", label: "1" }],
        []
      );

      loader.reset();

      expect(loader.getState()).toBe("idle");
      expect(loader.getProgress().nodesLoaded).toBe(0);
      expect(loader.getPendingEdgeCount()).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return comprehensive statistics", async () => {
      await loader.loadFromArrays(
        [
          { id: "n1", label: "1" },
          { id: "n2", label: "2" },
        ],
        [{ sourceId: "n1", targetId: "n2" }]
      );

      const stats = loader.getStats();
      expect(stats.state).toBe("completed");
      expect(stats.nodesLoaded).toBe(2);
      expect(stats.edgesLoaded).toBe(1);
      expect(stats.storeStats).toBeDefined();
      expect(stats.storeStats.nodeCount).toBe(2);
    });
  });

  describe("error handling", () => {
    it("should set error state on failure", async () => {
      async function* failingChunks(): AsyncGenerator<GraphChunk> {
        yield {
          chunkIndex: 0,
          nodes: [{ id: "n1", label: "1" }],
          edges: [],
          isLast: false,
        };
        throw new Error("Loading failed");
      }

      await expect(loader.loadFromIterator(failingChunks())).rejects.toThrow(
        "Loading failed"
      );

      expect(loader.getState()).toBe("error");
    });

    it("should reject loadChunk in error state", async () => {
      async function* failingChunks(): AsyncGenerator<GraphChunk> {
        throw new Error("Failed");
      }

      try {
        await loader.loadFromIterator(failingChunks());
      } catch {
        // Expected
      }

      expect(() =>
        loader.loadChunk({
          chunkIndex: 0,
          nodes: [],
          edges: [],
          isLast: true,
        })
      ).toThrow("Loader is in error state");
    });
  });
});

describe("createStreamingSource", () => {
  it("should create an async generator from fetch function", async () => {
    const mockFetch = jest.fn();

    mockFetch
      .mockResolvedValueOnce({
        nodes: [{ id: "n1", label: "1" }],
        edges: [],
        hasMore: true,
        totalCount: 3,
      })
      .mockResolvedValueOnce({
        nodes: [{ id: "n2", label: "2" }],
        edges: [],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        nodes: [{ id: "n3", label: "3" }],
        edges: [],
        hasMore: false,
      });

    const chunks: GraphChunk[] = [];
    for await (const chunk of createStreamingSource("source", mockFetch, 1)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3);
    expect(chunks[0].totalChunks).toBe(3);
    expect(chunks[0].isLast).toBe(false);
    expect(chunks[2].isLast).toBe(true);
  });

  it("should pass correct offset and limit to fetch function", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      nodes: [],
      edges: [],
      hasMore: false,
    });

    for await (const _ of createStreamingSource("test-source", mockFetch, 100)) {
      // Just iterate
    }

    expect(mockFetch).toHaveBeenCalledWith("test-source", 0, 100);
  });
});
