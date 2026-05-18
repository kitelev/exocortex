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

  describe("Issue #3190 — diagnostic console.error on cache load failures", () => {
    // The original PR #3185 routed every cache failure through
    // `ILogger.warn`, which `Logger` only emits when the user has the
    // `warn` console channel enabled. In production with the default
    // settings the channel is on, but `logger.warn` calls were invisible
    // when the user had silenced their log channels for noise reasons.
    // Issue #3190 surfaces these failures unconditionally via
    // `console.error` so future regressions stay observable.

    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("logs to console.error when the cache file cannot be read", async () => {
      const fs = createInMemoryFs();
      // exists() returns true but read() throws — simulate a permission
      // / corruption I/O failure.
      jest.spyOn(fs, "exists").mockResolvedValue(true);
      jest.spyOn(fs, "read").mockRejectedValue(new Error("EACCES"));
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.load();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[exocortex] cache read failed:",
        expect.any(Error),
      );
    });

    it("logs to console.error when the JSON payload cannot be parsed", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(CACHE_PATH, "{ not json");
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.load();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[exocortex] cache parse failed:",
        expect.any(Error),
      );
    });

    it("logs to console.error when the file shape is invalid", async () => {
      const fs = createInMemoryFs();
      fs.__files.set(CACHE_PATH, JSON.stringify({ wrong: "shape" }));
      const cache = new ExocmdBindingsCache(
        fs,
        CACHE_PATH,
        PLUGIN_VERSION,
        mockLogger,
      );
      await cache.load();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[exocortex] cache shape-validation failed:",
        expect.any(String),
      );
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

describe("ExocmdBindingsCache — load() performance (Issue #3192)", () => {
  // Cold-start fixture: the production cache file in vault-2025 is ~1.1 MB
  // spanning ~140 class signatures. We build a synthetic equivalent (10
  // ResolvedCommand-shaped entries × 140 classes ≈ 1.2 MB serialized JSON)
  // and assert the load pipeline finishes inside an envelope generous
  // enough to absorb CI runner jitter (Linux GitHub Actions noise can add
  // 100–200 ms vs local Mac runs) while still failing if a future change
  // regresses the in-memory parse path back to the 1.9 s baseline that
  // Issue #3192 was filed against.
  const CACHE_PATH = ".exocortex/cache/exocmd-bindings.json";
  const PLUGIN_VERSION = "16.9.0";

  function buildFixture(numClasses: number, commandsPerClass: number): string {
    // Synthetic command shaped to match production `ResolvedCommand`
    // serialized payloads — long IRIs, SPARQL ASK preconditions,
    // grounding metadata. Sized to land in the same byte envelope as
    // the real vault-2025 cache (1.1 MB at 140 classes × ~10 cmds).
    const bindings: Record<string, unknown> = {};
    for (let c = 0; c < numClasses; c++) {
      const commands = [] as unknown[];
      for (let k = 0; k < commandsPerClass; k++) {
        commands.push({
          binding: {
            id: `obsidian://vault/assetspaces/exocmd/binding-${c}-${k}-00000000-0000-0000-0000-000000000000.md`,
            targetClass: `https://exocortex.my/ontology/ems#class-${c}-Task-Project-Asset`,
            order: k,
            style: {
              showIcon: true,
              tooltip: `Run command ${k} on class ${c} — long descriptive tooltip for realism`,
              ariaLabel: `Command number ${k} for class ${c} — accessible label`,
            },
          },
          command: {
            id: `https://exocortex.my/ontology/exocmd#cmd-${c}-${k}-00000000-0000-0000-0000-000000000000`,
            name: `Command #${k} for class ${c} — human-readable label`,
            category: c % 5 === 0 ? "creation" : c % 5 === 1 ? "status" : c % 5 === 2 ? "planning" : c % 5 === 3 ? "criticality" : "maintenance",
            icon: "plus-circle-icon-variant",
            confirmMessage: `Are you sure you want to run command ${k} on the current asset of class ${c}? This action will mutate frontmatter and may cascade through related assets.`,
            successMessage: `Command ${k} on class ${c} completed successfully — refreshed view`,
            precondition: {
              type: "sparql-ask",
              query: `ASK { $target <https://exocortex.my/ontology/ems#status> ?s . FILTER(?s != <https://exocortex.my/ontology/ems#EffortStatusDone-${c}-${k}>) }`,
            },
            grounding: {
              type: "frontmatter-set",
              property: `ems__Effort_status_class_${c}_command_${k}`,
              value: `[[https://exocortex.my/ontology/ems#EffortStatusDoing-${c}-${k}]]`,
            },
          },
        });
      }
      bindings[`class-${c}`] = {
        commands,
        preconditions_signature: `fnv1a:${(c * 31).toString(16).padStart(8, "0")}`,
      };
    }
    return JSON.stringify({
      version: EXOCMD_BINDINGS_CACHE_VERSION,
      plugin_version: PLUGIN_VERSION,
      last_full_scan_at: "2026-05-18T00:00:00.000Z",
      bindings,
    });
  }

  function makeInMemoryFs(seedPath: string, seedContent: string): CacheFileSystem {
    const files = new Map<string, string>([[seedPath, seedContent]]);
    return {
      async exists(path: string) {
        return files.has(path);
      },
      async read(path: string) {
        const v = files.get(path);
        if (v === undefined) throw new Error(`ENOENT: ${path}`);
        return v;
      },
      async write(path: string, content: string) {
        files.set(path, content);
      },
      async remove(path: string) {
        files.delete(path);
      },
      async rename(oldPath: string, newPath: string) {
        const c = files.get(oldPath);
        if (c === undefined) throw new Error(`ENOENT: ${oldPath}`);
        files.delete(oldPath);
        files.set(newPath, c);
      },
      async mkdir() {
        /* no-op */
      },
    };
  }

  const noopLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  it("loads a ~1.2 MB / 140-class fixture in under 250 ms (Issue #3192 AC envelope)", async () => {
    const fixture = buildFixture(140, 10);
    // Sanity: confirm the fixture is in the same order of magnitude as the
    // production cache file the issue baseline was collected on.
    expect(fixture.length).toBeGreaterThan(500_000);
    expect(fixture.length).toBeLessThan(3_000_000);

    const fs = makeInMemoryFs(CACHE_PATH, fixture);
    const cache = new ExocmdBindingsCache(
      fs,
      CACHE_PATH,
      PLUGIN_VERSION,
      noopLogger,
    );

    const start = performance.now();
    const snapshot = await cache.load();
    const elapsedMs = performance.now() - start;

    expect(snapshot).not.toBeNull();
    // In-memory fs + JSON.parse without disk I/O: ought to be <50 ms on
    // any developer machine and <250 ms on the slowest CI runner. Bumping
    // this ceiling without rationale is a regression signal — the whole
    // point of Issue #3192 is keeping the parse phase well under the
    // user-perceptible budget.
    expect(elapsedMs).toBeLessThan(250);
  });

  it("loads a ~5 MB / 600-class fixture in under 800 ms (Issue #3192 AC #2)", async () => {
    const fixture = buildFixture(600, 10);
    expect(fixture.length).toBeGreaterThan(4_000_000);

    const fs = makeInMemoryFs(CACHE_PATH, fixture);
    const cache = new ExocmdBindingsCache(
      fs,
      CACHE_PATH,
      PLUGIN_VERSION,
      noopLogger,
    );

    const start = performance.now();
    const snapshot = await cache.load();
    const elapsedMs = performance.now() - start;

    expect(snapshot).not.toBeNull();
    expect(elapsedMs).toBeLessThan(800);
  });

  it("emits exocmd-cache-load-done mark on successful load (diagnostic instrumentation)", async () => {
    // Best-effort instrumentation: marks are wrapped in try/catch so a
    // missing performance API never breaks the load path. When the API
    // is available (jsdom test env exposes it), the marks MUST be emitted
    // so DevTools shows them on the user's machine too.
    if (
      typeof (performance as unknown as Record<string, unknown>)[
        "getEntriesByName"
      ] !== "function"
    ) {
      // Env without getEntriesByName — skip silently; the production
      // jsdom test env does have it, so this branch only protects
      // against future runtime regressions.
      return;
    }

    // Clean any leftover marks from earlier tests / suites.
    try {
      performance.clearMarks();
    } catch {
      /* not all jsdom versions support clearMarks — non-fatal */
    }

    performance.mark("exocmd-cache-read-start");
    const fs = makeInMemoryFs(CACHE_PATH, buildFixture(10, 2));
    const cache = new ExocmdBindingsCache(
      fs,
      CACHE_PATH,
      PLUGIN_VERSION,
      noopLogger,
    );
    await cache.load();

    expect(performance.getEntriesByName("exocmd-cache-fs-read-done").length)
      .toBeGreaterThan(0);
    expect(performance.getEntriesByName("exocmd-cache-parse-done").length)
      .toBeGreaterThan(0);
    expect(performance.getEntriesByName("exocmd-cache-validate-done").length)
      .toBeGreaterThan(0);
    expect(performance.getEntriesByName("exocmd-cache-load-done").length)
      .toBeGreaterThan(0);
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
