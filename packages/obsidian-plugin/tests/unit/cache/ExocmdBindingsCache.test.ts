import {
  ExocmdBindingsCache,
  EXOCMD_BINDINGS_CACHE_VERSION,
  fnv1aHex,
  type CacheFileSystem,
  type ExocmdBindingsCacheEntry,
} from "../../../src/cache/ExocmdBindingsCache";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

/**
 * In-memory `CacheFileSystem` for unit tests. Stores files in a Map,
 * mirrors the rename-via-remove+rename quirk of `vault.adapter`, and
 * supports the recursive-mkdir checks the real adapter does.
 */
function createInMemoryFs(): CacheFileSystem & { __files: Map<string, string>; __dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    __files: files,
    __dirs: dirs,
    async exists(path: string): Promise<boolean> {
      return files.has(path) || dirs.has(path);
    },
    async read(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async write(path: string, content: string): Promise<void> {
      files.set(path, content);
    },
    async remove(path: string): Promise<void> {
      if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      const content = files.get(oldPath);
      if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
      files.delete(oldPath);
      files.set(newPath, content);
    },
    async mkdir(path: string): Promise<void> {
      dirs.add(path);
    },
  };
}

describe("ExocmdBindingsCache", () => {
  const CACHE_PATH = ".exocortex/cache/exocmd-bindings.json";
  const PLUGIN_VERSION = "16.9.0";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("load", () => {
    it("returns null when the cache file is absent", async () => {
      const fs = createInMemoryFs();
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(await cache.load()).toBeNull();
    });

    it("returns null and warns when the file is not valid JSON", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(CACHE_PATH, "{ not json");
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(await cache.load()).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("not valid JSON"),
      );
    });

    it("returns null and logs when schema version mismatches", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION + 99,
          plugin_version: PLUGIN_VERSION,
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          bindings: {},
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(await cache.load()).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("cache schema version mismatch"),
      );
    });

    it("returns null and logs when plugin_version mismatches", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION,
          plugin_version: "0.0.1-old",
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          bindings: {},
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(await cache.load()).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("plugin_version mismatch"),
      );
    });

    it("returns null and warns on shape mismatch (missing bindings field)", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION,
          plugin_version: PLUGIN_VERSION,
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          // bindings missing
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(await cache.load()).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("unexpected shape"),
      );
    });

    it("returns null and warns when an entry has bad shape", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION,
          plugin_version: PLUGIN_VERSION,
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          bindings: {
            "class-a": { commands: "not-an-array", preconditions_signature: "x" },
          },
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(await cache.load()).toBeNull();
    });

    it("parses a valid file and exposes the snapshot via lookup", async () => {
      const fs = createInMemoryFs();
      const entry: ExocmdBindingsCacheEntry = {
        commands: [],
        preconditions_signature: "fnv1a:abcdef01",
      };
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION,
          plugin_version: PLUGIN_VERSION,
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          bindings: { "ems__Task": entry },
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      const snapshot = await cache.load();
      expect(snapshot).not.toBeNull();
      expect(cache.lookup("ems__Task")).toEqual(entry);
      expect(cache.lookup("does-not-exist")).toBeNull();
    });
  });

  describe("knownClassKeys", () => {
    it("returns empty array when nothing loaded", () => {
      const fs = createInMemoryFs();
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      expect(cache.knownClassKeys()).toEqual([]);
    });

    it("returns all class keys from the loaded snapshot", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION,
          plugin_version: PLUGIN_VERSION,
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          bindings: {
            "ems__Task": { commands: [], preconditions_signature: "a" },
            "ims__Concept": { commands: [], preconditions_signature: "b" },
          },
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.load();
      expect(cache.knownClassKeys().sort()).toEqual(["ems__Task", "ims__Concept"]);
    });
  });

  describe("save", () => {
    it("writes a valid snapshot that round-trips via load", async () => {
      const fs = createInMemoryFs();
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      const entry: ExocmdBindingsCacheEntry = {
        commands: [],
        preconditions_signature: "fnv1a:11223344",
      };
      await cache.save({ "ems__Task": entry });

      const reread = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      const snapshot = await reread.load();
      expect(snapshot).not.toBeNull();
      expect(reread.lookup("ems__Task")).toEqual(entry);
    });

    it("performs an atomic write via tmp + rename", async () => {
      const fs = createInMemoryFs();
      const writeSpy = jest.spyOn(fs, "write");
      const renameSpy = jest.spyOn(fs, "rename");
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.save({});

      expect(writeSpy).toHaveBeenCalledWith(
        `${CACHE_PATH}.tmp`,
        expect.any(String),
      );
      expect(renameSpy).toHaveBeenCalledWith(`${CACHE_PATH}.tmp`, CACHE_PATH);
    });

    it("removes the target before rename so the adapter does not collide", async () => {
      const fs = createInMemoryFs();
      // Pre-existing target.
      fs.__files.set(CACHE_PATH, "{}");
      const removeSpy = jest.spyOn(fs, "remove");
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.save({});
      expect(removeSpy).toHaveBeenCalledWith(CACHE_PATH);
    });

    it("cleans up orphaned tmp file when rename fails", async () => {
      const fs = createInMemoryFs();
      const renameSpy = jest
        .spyOn(fs, "rename")
        .mockRejectedValueOnce(new Error("rename failed"));
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await expect(cache.save({})).rejects.toThrow("rename failed");
      // Orphan tmp should be cleaned up best-effort.
      expect(fs.__files.has(`${CACHE_PATH}.tmp`)).toBe(false);
      renameSpy.mockRestore();
    });
  });

  describe("clear", () => {
    it("forgets the loaded snapshot so the next lookup returns null", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(
        CACHE_PATH,
        JSON.stringify({
          version: EXOCMD_BINDINGS_CACHE_VERSION,
          plugin_version: PLUGIN_VERSION,
          last_full_scan_at: "2026-05-17T00:00:00.000Z",
          bindings: {
            "ems__Task": { commands: [], preconditions_signature: "x" },
          },
        }),
      );
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.load();
      expect(cache.lookup("ems__Task")).not.toBeNull();
      cache.clear();
      expect(cache.lookup("ems__Task")).toBeNull();
    });
  });
});

describe("fnv1aHex", () => {
  it("is deterministic for the same input", () => {
    expect(fnv1aHex("hello")).toBe(fnv1aHex("hello"));
  });

  it("differs for distinct inputs", () => {
    expect(fnv1aHex("hello")).not.toBe(fnv1aHex("world"));
  });

  it("returns a fixed-length 8-char lowercase hex string", () => {
    const out = fnv1aHex("test");
    expect(out).toMatch(/^[0-9a-f]{8}$/);
  });
});
