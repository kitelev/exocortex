import {
  IncrementalIndexer,
  type FileChange,
} from "../../../../../src/infrastructure/sparql/cache/IncrementalIndexer";

describe("IncrementalIndexer", () => {
  let indexer: IncrementalIndexer;

  beforeEach(() => {
    indexer = new IncrementalIndexer({ throttleMs: 10 });
  });

  afterEach(() => {
    indexer.dispose();
  });

  describe("constructor", () => {
    it("should create indexer with default options", () => {
      const defaultIndexer = new IncrementalIndexer();
      expect(defaultIndexer.size()).toBe(0);
      defaultIndexer.dispose();
    });

    it("should create indexer with custom options", () => {
      const customIndexer = new IncrementalIndexer({
        throttleMs: 100,
        maxBatchSize: 50,
      });
      expect(customIndexer.size()).toBe(0);
      customIndexer.dispose();
    });
  });

  describe("recordChange", () => {
    it("should record and process file changes", async () => {
      const changes: FileChange[] = [];
      indexer.onInvalidate((c) => changes.push(...c));

      indexer.recordChange({
        path: "/path/to/file.md",
        type: "modified",
        timestamp: Date.now(),
      });

      // Wait for throttle
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(changes.length).toBe(1);
      expect(changes[0].path).toBe("/path/to/file.md");
      expect(changes[0].type).toBe("modified");
    });

    it("should deduplicate changes to same file", async () => {
      const changes: FileChange[] = [];
      indexer.onInvalidate((c) => changes.push(...c));

      const now = Date.now();
      indexer.recordChange({ path: "/path/to/file.md", type: "modified", timestamp: now });
      indexer.recordChange({ path: "/path/to/file.md", type: "modified", timestamp: now + 1 });
      indexer.recordChange({ path: "/path/to/file.md", type: "modified", timestamp: now + 2 });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should only trigger once with latest change
      expect(changes.length).toBe(1);
    });

    it("should batch changes within throttle window", async () => {
      let callCount = 0;
      indexer.onInvalidate(() => callCount++);

      indexer.recordChange({ path: "/file1.md", type: "created", timestamp: Date.now() });
      indexer.recordChange({ path: "/file2.md", type: "created", timestamp: Date.now() });
      indexer.recordChange({ path: "/file3.md", type: "created", timestamp: Date.now() });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // All changes should be batched into single callback
      expect(callCount).toBe(1);
    });
  });

  describe("flush", () => {
    it("should force immediate processing", () => {
      const changes: FileChange[] = [];
      indexer.onInvalidate((c) => changes.push(...c));

      indexer.recordChange({
        path: "/path/to/file.md",
        type: "modified",
        timestamp: Date.now(),
      });

      indexer.flush();

      expect(changes.length).toBe(1);
    });
  });

  describe("updateMetadata / hasChanged", () => {
    it("should detect new files", () => {
      expect(indexer.hasChanged("/new/file.md", Date.now())).toBe(true);
    });

    it("should detect unchanged files", () => {
      const mtime = Date.now();
      indexer.updateMetadata("/file.md", mtime, 100);

      expect(indexer.hasChanged("/file.md", mtime, 100)).toBe(false);
    });

    it("should detect changed modification time", () => {
      const oldMtime = Date.now() - 1000;
      const newMtime = Date.now();

      indexer.updateMetadata("/file.md", oldMtime, 100);

      expect(indexer.hasChanged("/file.md", newMtime)).toBe(true);
    });

    it("should detect changed file size", () => {
      const mtime = Date.now();

      indexer.updateMetadata("/file.md", mtime, 100);

      expect(indexer.hasChanged("/file.md", mtime, 200)).toBe(true);
    });
  });

  describe("getChangedFiles", () => {
    it("should return files modified since timestamp", () => {
      const past = Date.now() - 1000;
      const now = Date.now();

      indexer.updateMetadata("/old.md", past, 100);
      indexer.updateMetadata("/new.md", now, 100);

      const changed = indexer.getChangedFiles(past + 1);

      expect(changed).toContain("/new.md");
      expect(changed).not.toContain("/old.md");
    });

    it("should return empty array when no changes", () => {
      const now = Date.now();
      indexer.updateMetadata("/file.md", now - 1000, 100);

      const changed = indexer.getChangedFiles(now);

      expect(changed).toHaveLength(0);
    });
  });

  describe("onInvalidate", () => {
    it("should register callback and return unsubscribe function", async () => {
      let called = false;
      const unsubscribe = indexer.onInvalidate(() => {
        called = true;
      });

      indexer.recordChange({ path: "/file.md", type: "modified", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(called).toBe(true);

      // Unsubscribe and verify no more calls
      called = false;
      unsubscribe();

      indexer.recordChange({ path: "/file2.md", type: "modified", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(called).toBe(false);
    });

    it("should handle errors in callbacks gracefully", async () => {
      indexer.onInvalidate(() => {
        throw new Error("Test error");
      });

      // Should not throw
      indexer.recordChange({ path: "/file.md", type: "modified", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  });

  describe("statistics", () => {
    it("should track total changes", async () => {
      indexer.recordChange({ path: "/file1.md", type: "created", timestamp: Date.now() });
      indexer.recordChange({ path: "/file2.md", type: "modified", timestamp: Date.now() });
      indexer.recordChange({ path: "/file3.md", type: "deleted", timestamp: Date.now() });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const stats = indexer.getStats();
      expect(stats.totalChanges).toBe(3);
    });

    it("should track invalidations", async () => {
      indexer.onInvalidate(() => {});

      indexer.recordChange({ path: "/file.md", type: "modified", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const stats = indexer.getStats();
      expect(stats.invalidations).toBe(1);
    });

    it("should track tracked files", () => {
      indexer.updateMetadata("/file1.md", Date.now(), 100);
      indexer.updateMetadata("/file2.md", Date.now(), 200);

      const stats = indexer.getStats();
      expect(stats.trackedFiles).toBe(2);
    });

    it("should reset stats", async () => {
      indexer.recordChange({ path: "/file.md", type: "modified", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 20));

      indexer.resetStats();

      const stats = indexer.getStats();
      expect(stats.totalChanges).toBe(0);
      expect(stats.invalidations).toBe(0);
    });
  });

  describe("clear", () => {
    it("should clear all tracked metadata", () => {
      indexer.updateMetadata("/file1.md", Date.now(), 100);
      indexer.updateMetadata("/file2.md", Date.now(), 200);

      expect(indexer.size()).toBe(2);

      indexer.clear();

      expect(indexer.size()).toBe(0);
    });

    it("should clear pending changes", () => {
      indexer.recordChange({ path: "/file.md", type: "modified", timestamp: Date.now() });
      indexer.clear();

      // Should not trigger invalidation
      let called = false;
      indexer.onInvalidate(() => {
        called = true;
      });

      indexer.flush();

      expect(called).toBe(false);
    });
  });

  describe("isTracked / getMetadata", () => {
    it("should return true for tracked files", () => {
      indexer.updateMetadata("/file.md", Date.now(), 100);

      expect(indexer.isTracked("/file.md")).toBe(true);
      expect(indexer.isTracked("/other.md")).toBe(false);
    });

    it("should return metadata for tracked files", () => {
      const mtime = Date.now();
      indexer.updateMetadata("/file.md", mtime, 100);

      const metadata = indexer.getMetadata("/file.md");

      expect(metadata).toBeDefined();
      expect(metadata!.mtime).toBe(mtime);
      expect(metadata!.size).toBe(100);
    });

    it("should return undefined for untracked files", () => {
      expect(indexer.getMetadata("/unknown.md")).toBeUndefined();
    });
  });

  describe("dispose", () => {
    it("should cleanup resources", () => {
      indexer.updateMetadata("/file.md", Date.now(), 100);
      indexer.recordChange({ path: "/file.md", type: "modified", timestamp: Date.now() });

      indexer.dispose();

      expect(indexer.size()).toBe(0);
    });
  });
});
