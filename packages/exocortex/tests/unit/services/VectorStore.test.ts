import { describe, it, expect, beforeEach } from "vitest";
import {
  VectorStore,
  VectorEntry,
  DEFAULT_VECTOR_STORE_CONFIG,
} from "../../../src/services/VectorStore";

describe("VectorStore", () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore();
  });

  const createEntry = (
    id: string,
    values: number[] = [0.1, 0.2, 0.3],
    metadata?: Record<string, unknown>
  ): VectorEntry => ({
    id,
    vector: values,
    metadata,
    timestamp: Date.now(),
    contentHash: `hash-${id}`,
  });

  describe("constructor", () => {
    it("should use default config when no config provided", () => {
      expect(store.size()).toBe(0);
    });

    it("should accept custom config", () => {
      const customStore = new VectorStore({ maxEntries: 100 });
      expect(customStore.size()).toBe(0);
    });
  });

  describe("upsert", () => {
    it("should add new entry", () => {
      const entry = createEntry("file1.md");
      store.upsert(entry);
      expect(store.size()).toBe(1);
      expect(store.has("file1.md")).toBe(true);
    });

    it("should update existing entry", () => {
      const entry1 = createEntry("file1.md", [0.1, 0.2, 0.3]);
      const entry2 = createEntry("file1.md", [0.4, 0.5, 0.6]);

      store.upsert(entry1);
      store.upsert(entry2);

      expect(store.size()).toBe(1);
      expect(store.get("file1.md")?.vector).toEqual([0.4, 0.5, 0.6]);
    });

    it("should throw for empty vector", () => {
      const entry = createEntry("file1.md", []);
      expect(() => store.upsert(entry)).toThrow("Vector cannot be empty");
    });

    it("should throw for dimension mismatch", () => {
      store.upsert(createEntry("file1.md", [0.1, 0.2, 0.3]));

      expect(() =>
        store.upsert(createEntry("file2.md", [0.1, 0.2]))
      ).toThrow(/dimension mismatch/);
    });

    it("should enforce maxEntries with LRU eviction", () => {
      const limitedStore = new VectorStore({ maxEntries: 2 });

      limitedStore.upsert(createEntry("file1.md"));
      limitedStore.upsert(createEntry("file2.md"));
      limitedStore.upsert(createEntry("file3.md"));

      expect(limitedStore.size()).toBe(2);
      expect(limitedStore.has("file1.md")).toBe(false);
      expect(limitedStore.has("file2.md")).toBe(true);
      expect(limitedStore.has("file3.md")).toBe(true);
    });
  });

  describe("remove", () => {
    it("should remove existing entry", () => {
      store.upsert(createEntry("file1.md"));
      const removed = store.remove("file1.md");

      expect(removed).toBe(true);
      expect(store.has("file1.md")).toBe(false);
      expect(store.size()).toBe(0);
    });

    it("should return false for non-existent entry", () => {
      const removed = store.remove("non-existent.md");
      expect(removed).toBe(false);
    });
  });

  describe("get", () => {
    it("should return entry by id", () => {
      const entry = createEntry("file1.md");
      store.upsert(entry);

      const result = store.get("file1.md");
      expect(result?.id).toBe("file1.md");
      expect(result?.vector).toEqual([0.1, 0.2, 0.3]);
    });

    it("should return undefined for non-existent entry", () => {
      expect(store.get("non-existent.md")).toBeUndefined();
    });
  });

  describe("needsUpdate", () => {
    it("should return true for non-existent entry", () => {
      expect(store.needsUpdate("file1.md", "hash1")).toBe(true);
    });

    it("should return true when hash differs", () => {
      store.upsert(createEntry("file1.md"));
      expect(store.needsUpdate("file1.md", "different-hash")).toBe(true);
    });

    it("should return false when hash matches", () => {
      store.upsert(createEntry("file1.md"));
      expect(store.needsUpdate("file1.md", "hash-file1.md")).toBe(false);
    });
  });

  describe("getAllIds", () => {
    it("should return all entry ids", () => {
      store.upsert(createEntry("file1.md"));
      store.upsert(createEntry("file2.md"));
      store.upsert(createEntry("file3.md"));

      const ids = store.getAllIds();
      expect(ids).toHaveLength(3);
      expect(ids).toContain("file1.md");
      expect(ids).toContain("file2.md");
      expect(ids).toContain("file3.md");
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      store.upsert(createEntry("file1.md"));
      store.upsert(createEntry("file2.md"));

      store.clear();

      expect(store.size()).toBe(0);
      expect(store.getAllIds()).toEqual([]);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      // Create entries with distinct vectors
      store.setConfig({ similarityThreshold: 0.5 });
      store.upsert(createEntry("file1.md", [1, 0, 0]));
      store.upsert(createEntry("file2.md", [0.9, 0.1, 0]));
      store.upsert(createEntry("file3.md", [0, 1, 0]));
    });

    it("should return empty array for empty store", () => {
      const emptyStore = new VectorStore();
      const results = emptyStore.search([1, 0, 0]);
      expect(results).toEqual([]);
    });

    it("should find similar vectors", () => {
      const results = store.search([1, 0, 0], 10);

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].entry.id).toBe("file1.md");
      expect(results[0].score).toBeCloseTo(1, 5);
    });

    it("should respect limit", () => {
      const results = store.search([1, 0, 0], 1);
      expect(results).toHaveLength(1);
    });

    it("should sort by score descending", () => {
      const results = store.search([1, 0, 0], 10);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should respect similarity threshold", () => {
      store.setConfig({ similarityThreshold: 0.95 });
      const results = store.search([1, 0, 0], 10);

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0.95);
      }
    });

    it("should throw for dimension mismatch", () => {
      expect(() => store.search([1, 0], 10)).toThrow(/dimension mismatch/);
    });
  });

  describe("findSimilar", () => {
    beforeEach(() => {
      store.setConfig({ similarityThreshold: 0.5 });
      store.upsert(createEntry("file1.md", [1, 0, 0]));
      store.upsert(createEntry("file2.md", [0.9, 0.1, 0]));
      store.upsert(createEntry("file3.md", [0, 1, 0]));
    });

    it("should find similar entries to existing entry", () => {
      const results = store.findSimilar("file1.md", 10);

      expect(results.length).toBeGreaterThan(0);
      // Should not include the query entry itself
      expect(results.every((r) => r.entry.id !== "file1.md")).toBe(true);
    });

    it("should return empty array for non-existent entry", () => {
      const results = store.findSimilar("non-existent.md", 10);
      expect(results).toEqual([]);
    });
  });

  describe("serialize/deserialize", () => {
    it("should serialize store to JSON-compatible format", () => {
      store.upsert(createEntry("file1.md", [0.1, 0.2], { label: "Test" }));
      store.upsert(createEntry("file2.md", [0.3, 0.4]));

      const serialized = store.serialize();

      expect(serialized.version).toBe(1);
      expect(serialized.entries).toHaveLength(2);
      expect(serialized.createdAt).toBeDefined();
      expect(serialized.updatedAt).toBeDefined();
    });

    it("should deserialize from serialized format", () => {
      store.upsert(createEntry("file1.md", [0.1, 0.2]));
      store.upsert(createEntry("file2.md", [0.3, 0.4]));

      const serialized = store.serialize();

      const newStore = new VectorStore();
      newStore.deserialize(serialized);

      expect(newStore.size()).toBe(2);
      expect(newStore.has("file1.md")).toBe(true);
      expect(newStore.has("file2.md")).toBe(true);
    });

    it("should throw for unsupported version", () => {
      const invalidData = {
        version: 999,
        entries: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(() => store.deserialize(invalidData)).toThrow(/Unsupported/);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      store.upsert(createEntry("file1.md", [0.1, 0.2, 0.3]));
      store.upsert(createEntry("file2.md", [0.4, 0.5, 0.6]));

      const stats = store.getStats();

      expect(stats.entryCount).toBe(2);
      expect(stats.dimension).toBe(3);
      expect(stats.createdAt).toBeDefined();
      expect(stats.updatedAt).toBeDefined();
      expect(stats.estimatedMemoryMB).toBeGreaterThanOrEqual(0);
    });

    it("should return null dimension for empty store", () => {
      const stats = store.getStats();
      expect(stats.dimension).toBeNull();
    });
  });

  describe("pruneInvalidEntries", () => {
    it("should remove entries not in valid set", () => {
      store.upsert(createEntry("file1.md"));
      store.upsert(createEntry("file2.md"));
      store.upsert(createEntry("file3.md"));

      const pruned = store.pruneInvalidEntries(
        new Set(["file1.md", "file3.md"])
      );

      expect(pruned).toBe(1);
      expect(store.size()).toBe(2);
      expect(store.has("file1.md")).toBe(true);
      expect(store.has("file2.md")).toBe(false);
      expect(store.has("file3.md")).toBe(true);
    });

    it("should return 0 when all entries are valid", () => {
      store.upsert(createEntry("file1.md"));
      store.upsert(createEntry("file2.md"));

      const pruned = store.pruneInvalidEntries(
        new Set(["file1.md", "file2.md"])
      );

      expect(pruned).toBe(0);
      expect(store.size()).toBe(2);
    });
  });
});
