import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";

// Mock CacheManager
const mockBuildCacheWithValidation = jest.fn();
const mockGetCacheStats = jest.fn();
const mockInvalidate = jest.fn();
const mockGetCachePath = jest.fn();

jest.unstable_mockModule("../../../src/cache/CacheManager.js", () => ({
  CacheManager: jest.fn(() => ({
    buildCacheWithValidation: mockBuildCacheWithValidation,
    getCacheStats: mockGetCacheStats,
    invalidate: mockInvalidate,
    getCachePath: mockGetCachePath,
  })),
}));

const { sparqlIndexCommand } = await import("../../../src/commands/sparql-index.js");

describe("sparqlIndexCommand", () => {
  let tempDir: string;
  let vaultPath: string;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create temp vault directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sparql-index-test-"));
    vaultPath = path.join(tempDir, "vault");
    await fs.mkdir(vaultPath);

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as never);

    // Default mock return values
    mockGetCachePath.mockReturnValue(path.join(vaultPath, ".exocortex", "cache", "triples.json"));
    mockBuildCacheWithValidation.mockResolvedValue({
      tripleCount: 1000,
      durationMs: 500,
      skippedFiles: [],
      summary: { total: 100, indexed: 100, skipped: 0 },
    });
    mockGetCacheStats.mockResolvedValue({
      tripleCount: 1000,
      createdAt: new Date(),
      isValid: true,
      sizeBytes: 50000,
    });
    mockInvalidate.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    jest.restoreAllMocks();
  });

  describe("command setup", () => {
    it("should create command with correct name", () => {
      const cmd = sparqlIndexCommand();
      expect(cmd.name()).toBe("index");
    });

    it("should have correct description", () => {
      const cmd = sparqlIndexCommand();
      expect(cmd.description()).toBe("Build or refresh the triple cache for faster SPARQL queries");
    });
  });

  describe("index building", () => {
    it("should build cache and output success message", async () => {
      const cmd = sparqlIndexCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", vaultPath,
      ]);

      expect(mockBuildCacheWithValidation).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Created cache with")
      );
    });

    it("should output JSON when format is json", async () => {
      const cmd = sparqlIndexCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", vaultPath,
        "--output", "json",
      ]);

      expect(mockBuildCacheWithValidation).toHaveBeenCalled();
      // JSON output should contain success and data
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('"success"')
      );
    });

    it("should show stats when --stats flag is provided", async () => {
      const cmd = sparqlIndexCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", vaultPath,
        "--stats",
      ]);

      expect(mockGetCacheStats).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cache Statistics")
      );
    });

    it("should force rebuild when --force flag is provided", async () => {
      const cmd = sparqlIndexCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", vaultPath,
        "--force",
      ]);

      expect(mockInvalidate).toHaveBeenCalled();
      expect(mockBuildCacheWithValidation).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle vault not found error", async () => {
      const cmd = sparqlIndexCommand();
      await cmd.parseAsync([
        "node", "test",
        "--vault", "/nonexistent/vault",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalled();
    });
  });
});
