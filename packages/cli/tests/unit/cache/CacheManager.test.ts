import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";

// Mock exocortex dependencies
const mockConvertVault = jest.fn();
const mockConvertVaultWithValidation = jest.fn();
jest.unstable_mockModule("exocortex", () => ({
  NoteToRDFConverter: jest.fn(() => ({
    convertVault: mockConvertVault,
    convertVaultWithValidation: mockConvertVaultWithValidation,
    validateVault: jest.fn().mockResolvedValue([]),
  })),
  Triple: jest.fn(),
  IRI: jest.fn(),
  Literal: jest.fn(),
  BlankNode: jest.fn(),
}));

jest.unstable_mockModule("../../../src/adapters/FileSystemVaultAdapter.js", () => ({
  FileSystemVaultAdapter: jest.fn(),
}));

const { CacheManager } = await import("../../../src/cache/CacheManager.js");

describe("CacheManager", () => {
  let tempDir: string;
  let vaultPath: string;
  let cacheManager: InstanceType<typeof CacheManager>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create temp directories for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    vaultPath = path.join(tempDir, "vault");
    await fs.mkdir(vaultPath);
    await fs.mkdir(path.join(vaultPath, ".exocortex"));

    cacheManager = new CacheManager(vaultPath);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe("getCachePath", () => {
    it("should return path to cache file in .exocortex directory", () => {
      const cachePath = cacheManager.getCachePath();
      expect(cachePath).toBe(path.join(vaultPath, ".exocortex", "cache", "triples.json"));
    });
  });

  describe("isCacheValid", () => {
    it("should return false when cache file does not exist", async () => {
      const isValid = await cacheManager.isCacheValid();
      expect(isValid).toBe(false);
    });

    it("should return false when cache metadata is invalid", async () => {
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));
      await fs.writeJson(cachePath, { invalid: "data" });

      const isValid = await cacheManager.isCacheValid();
      expect(isValid).toBe(false);
    });

    it("should return false when vault has been modified since cache creation", async () => {
      // Create cache with old timestamp
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));
      const oldTimestamp = Date.now() - 1000 * 60 * 60; // 1 hour ago
      await fs.writeJson(cachePath, {
        metadata: {
          version: "1.0.0",
          timestamp: oldTimestamp,
          vaultPath: vaultPath,
          tripleCount: 0,
        },
        triples: [],
      });

      // Touch vault to update mtime
      await fs.writeFile(path.join(vaultPath, "test.md"), "content");

      const isValid = await cacheManager.isCacheValid();
      expect(isValid).toBe(false);
    });

    it("should return true when cache is valid and vault has not been modified", async () => {
      // Create valid cache
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));

      // Write cache with current timestamp
      const cache = {
        metadata: {
          version: "1.0.0",
          timestamp: Date.now(),
          vaultPath: vaultPath,
          tripleCount: 0,
          vaultMtime: (await fs.stat(vaultPath)).mtimeMs,
        },
        triples: [],
      };
      await fs.writeJson(cachePath, cache);

      const isValid = await cacheManager.isCacheValid();
      expect(isValid).toBe(true);
    });
  });

  describe("loadOrBuild", () => {
    it("should build cache when cache does not exist", async () => {
      const mockTriples = [
        {
          subject: { value: "obsidian://vault/test.md" },
          predicate: { value: "https://exocortex.my/ontology/exo#Asset_label" },
          object: { value: "Test" },
        },
      ];
      mockConvertVaultWithValidation.mockResolvedValue({
        triples: mockTriples,
        skippedFiles: [],
        summary: { total: 1, indexed: 1, skipped: 0 },
      });

      const result = await cacheManager.loadOrBuild();

      expect(result.triples).toHaveLength(1);
      expect(result.cacheHit).toBe(false);
      expect(mockConvertVaultWithValidation).toHaveBeenCalled();
    });

    it("should load from cache when cache is valid", async () => {
      // Create valid cache
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));

      const cachedTriples = [
        {
          subject: { type: "IRI", value: "obsidian://vault/cached.md" },
          predicate: { type: "IRI", value: "https://exocortex.my/ontology/exo#Asset_label" },
          object: { type: "Literal", value: "Cached" },
        },
      ];

      const cache = {
        metadata: {
          version: "1.0.0",
          timestamp: Date.now(),
          vaultPath: vaultPath,
          tripleCount: 1,
          vaultMtime: (await fs.stat(vaultPath)).mtimeMs,
        },
        triples: cachedTriples,
      };
      await fs.writeJson(cachePath, cache);

      const result = await cacheManager.loadOrBuild();

      expect(result.triples).toHaveLength(1);
      expect(result.cacheHit).toBe(true);
      expect(mockConvertVault).not.toHaveBeenCalled();
    });

    it("should rebuild cache when cache is stale", async () => {
      // Create stale cache
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));

      const staleCache = {
        metadata: {
          version: "1.0.0",
          timestamp: Date.now() - 1000 * 60 * 60, // 1 hour ago
          vaultPath: vaultPath,
          tripleCount: 0,
          vaultMtime: 0, // Invalid mtime
        },
        triples: [],
      };
      await fs.writeJson(cachePath, staleCache);

      // Touch vault to update mtime
      await fs.writeFile(path.join(vaultPath, "test.md"), "content");

      const mockTriples = [
        {
          subject: { value: "obsidian://vault/test.md" },
          predicate: { value: "https://exocortex.my/ontology/exo#Asset_label" },
          object: { value: "Fresh" },
        },
      ];
      mockConvertVaultWithValidation.mockResolvedValue({
        triples: mockTriples,
        skippedFiles: [],
        summary: { total: 1, indexed: 1, skipped: 0 },
      });

      const result = await cacheManager.loadOrBuild();

      expect(result.cacheHit).toBe(false);
      expect(mockConvertVaultWithValidation).toHaveBeenCalled();
    });
  });

  describe("invalidate", () => {
    it("should delete cache file if it exists", async () => {
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));
      await fs.writeJson(cachePath, { metadata: {}, triples: [] });

      expect(await fs.pathExists(cachePath)).toBe(true);

      await cacheManager.invalidate();

      expect(await fs.pathExists(cachePath)).toBe(false);
    });

    it("should not throw if cache file does not exist", async () => {
      await expect(cacheManager.invalidate()).resolves.not.toThrow();
    });
  });

  describe("getCacheStats", () => {
    it("should return stats when cache exists", async () => {
      const cachePath = cacheManager.getCachePath();
      await fs.ensureDir(path.dirname(cachePath));

      const cache = {
        metadata: {
          version: "1.0.0",
          timestamp: Date.now(),
          vaultPath: vaultPath,
          tripleCount: 100,
          vaultMtime: (await fs.stat(vaultPath)).mtimeMs,
        },
        triples: Array(100).fill({
          subject: { type: "IRI", value: "test" },
          predicate: { type: "IRI", value: "test" },
          object: { type: "Literal", value: "test" },
        }),
      };
      await fs.writeJson(cachePath, cache);

      const stats = await cacheManager.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats!.tripleCount).toBe(100);
      expect(stats!.isValid).toBe(true);
    });

    it("should return null when cache does not exist", async () => {
      const stats = await cacheManager.getCacheStats();
      expect(stats).toBeNull();
    });
  });

  describe("buildCache", () => {
    it("should convert vault and save triples to cache file", async () => {
      const mockTriples = [
        {
          subject: { value: "obsidian://vault/note1.md" },
          predicate: { value: "https://exocortex.my/ontology/exo#Asset_label" },
          object: { value: "Note 1" },
        },
        {
          subject: { value: "obsidian://vault/note2.md" },
          predicate: { value: "https://exocortex.my/ontology/exo#Asset_label" },
          object: { value: "Note 2" },
        },
      ];
      mockConvertVaultWithValidation.mockResolvedValue({
        triples: mockTriples,
        skippedFiles: [],
        summary: { total: 2, indexed: 2, skipped: 0 },
      });

      const result = await cacheManager.buildCache();

      expect(result.tripleCount).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify cache file was created
      const cachePath = cacheManager.getCachePath();
      expect(await fs.pathExists(cachePath)).toBe(true);

      // Verify cache content
      const savedCache = await fs.readJson(cachePath);
      expect(savedCache.metadata.tripleCount).toBe(2);
      expect(savedCache.triples).toHaveLength(2);
    });
  });
});
