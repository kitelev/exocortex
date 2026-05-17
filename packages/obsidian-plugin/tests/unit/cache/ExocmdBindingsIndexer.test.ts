import {
  ExocmdBindingsIndexer,
  type FrontmatterRecord,
} from "../../../src/cache/ExocmdBindingsIndexer";
import {
  ExocmdBindingsCache,
  type CacheFileSystem,
} from "../../../src/cache/ExocmdBindingsCache";
import { GroundingType, type ResolvedCommand } from "exocortex";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function createInMemoryFs(): CacheFileSystem & {
  __files: Map<string, string>;
} {
  const files = new Map<string, string>();
  return {
    __files: files,
    async exists(path: string) {
      return files.has(path);
    },
    async read(path: string) {
      const content = files.get(path);
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    async write(path: string, content: string) {
      files.set(path, content);
    },
    async remove(path: string) {
      files.delete(path);
    },
    async rename(oldPath: string, newPath: string) {
      const content = files.get(oldPath);
      if (content === undefined) throw new Error("ENOENT");
      files.delete(oldPath);
      files.set(newPath, content);
    },
    async mkdir() {
      /* noop */
    },
  };
}

/**
 * Lightweight ResolvedCommand factory — we only fill the fields the
 * indexer reads (id, name, precondition fields used for signature).
 */
function makeResolvedCommand(
  id: string,
  preconditionId?: string,
  sparqlAsk?: string,
): ResolvedCommand {
  return {
    command: {
      id,
      name: `cmd ${id}`,
      grounding: {
        id: `g-${id}`,
        label: `grounding ${id}`,
        type: GroundingType.PROPERTY_SET,
        targetProperty: "x",
        targetValue: "y",
      },
      precondition: preconditionId
        ? { id: preconditionId, label: "p", sparqlAsk: sparqlAsk ?? "" }
        : undefined,
    },
    binding: {
      id: `b-${id}`,
      label: `binding ${id}`,
      commandRef: id,
      targetClass: "ems__Task",
    },
  };
}

describe("ExocmdBindingsIndexer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("groups assets by primary class and caches one entry per class", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    // Two ems__Task instances + one ims__Concept instance: indexer should
    // pick one rep per class, yielding 2 entries.
    const records: FrontmatterRecord[] = [
      {
        path: "tasks/a.md",
        frontmatter: { exo__Instance_class: ["[[ems__Task]]", "[[exo__Asset]]"] },
      },
      {
        path: "tasks/b.md",
        frontmatter: { exo__Instance_class: ["[[ems__Task]]", "[[exo__Asset]]"] },
      },
      {
        path: "concepts/c.md",
        frontmatter: { exo__Instance_class: ["[[ims__Concept]]"] },
      },
      // Asset with only exo__Asset — no primary class → skipped.
      {
        path: "noprimary.md",
        frontmatter: { exo__Instance_class: ["exo__Asset"] },
      },
      // Asset without frontmatter at all — skipped.
      { path: "fm-less.md", frontmatter: null },
    ];

    const resolveSpy = jest.fn(async (_subj, classes, _proto) => {
      if (classes.includes("ems__Task")) {
        return [makeResolvedCommand("cmd-task", "pre-1", "ASK { ?s ?p ?o }")];
      }
      if (classes.includes("ims__Concept")) {
        return [makeResolvedCommand("cmd-concept")];
      }
      return [];
    });

    const evalSpy = jest.fn(async () => true);

    const indexer = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => records },
      commandResolver: { resolveForAssetMulti: resolveSpy } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });

    const summary = await indexer.runFullScan();
    expect(summary.assetsConsidered).toBe(5);
    expect(summary.classesScanned).toBe(2);
    expect(summary.classesWritten).toBe(2);
    expect(summary.errors).toBe(0);

    // ems__Task entry should reference the first ems__Task asset only.
    expect(resolveSpy).toHaveBeenCalledWith(
      "obsidian://vault/tasks/a.md",
      ["ems__Task", "exo__Asset"],
      undefined,
    );
    // ims__Concept entry should reference the only ims__Concept asset.
    expect(resolveSpy).toHaveBeenCalledWith(
      "obsidian://vault/concepts/c.md",
      ["ims__Concept", "exo__Asset"],
      undefined,
    );

    // Snapshot is in memory now; load() re-reads from disk to validate.
    const reread = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );
    await reread.load();
    expect(reread.knownClassKeys().sort()).toEqual([
      "ems__Task",
      "ims__Concept",
    ]);
    const taskEntry = reread.lookup("ems__Task");
    expect(taskEntry).not.toBeNull();
    expect(taskEntry!.commands).toHaveLength(1);
    expect(taskEntry!.commands[0].command.id).toBe("cmd-task");
    expect(taskEntry!.preconditions_signature).toMatch(/^fnv1a:[0-9a-f]{8}$/);
  });

  it("filters out commands whose preconditions evaluate to false", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    const records: FrontmatterRecord[] = [
      {
        path: "tasks/a.md",
        frontmatter: { exo__Instance_class: ["[[ems__Task]]"] },
      },
    ];

    const resolveSpy = jest.fn(async () => [
      makeResolvedCommand("yes", "pre-yes", "yes"),
      makeResolvedCommand("no", "pre-no", "no"),
    ]);
    const evalSpy = jest.fn(
      async (precondition: { id: string } | undefined) =>
        precondition?.id === "pre-yes",
    );

    const indexer = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => records },
      commandResolver: { resolveForAssetMulti: resolveSpy } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });

    const summary = await indexer.runFullScan();
    expect(summary.classesWritten).toBe(1);

    await cache.load();
    const entry = cache.lookup("ems__Task");
    expect(entry).not.toBeNull();
    expect(entry!.commands).toHaveLength(1);
    expect(entry!.commands[0].command.id).toBe("yes");
  });

  it("does not poison the cache when one class throws", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    const records: FrontmatterRecord[] = [
      {
        path: "good/a.md",
        frontmatter: { exo__Instance_class: ["[[ems__Task]]"] },
      },
      {
        path: "bad/b.md",
        frontmatter: { exo__Instance_class: ["[[broken__Class]]"] },
      },
    ];

    const resolveSpy = jest.fn(async (_subj, classes) => {
      if (classes.includes("broken__Class")) throw new Error("boom");
      if (classes.includes("ems__Task"))
        return [makeResolvedCommand("ok", "p", "ASK { ?s ?p ?o }")];
      return [];
    });
    const evalSpy = jest.fn(async () => true);

    const indexer = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => records },
      commandResolver: { resolveForAssetMulti: resolveSpy } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });

    const summary = await indexer.runFullScan();
    expect(summary.errors).toBe(1);
    expect(summary.classesWritten).toBe(1);

    await cache.load();
    expect(cache.lookup("ems__Task")).not.toBeNull();
    expect(cache.lookup("broken__Class")).toBeNull();
  });

  it("strips wikilink wrappers and alias suffixes from class refs", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    const records: FrontmatterRecord[] = [
      {
        path: "x.md",
        frontmatter: {
          exo__Instance_class: ["[[uuid-1234|ems__Task]]"],
        },
      },
    ];
    const resolveSpy = jest.fn(async () => [
      makeResolvedCommand("c1", undefined),
    ]);
    const evalSpy = jest.fn(async () => true);

    const indexer = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => records },
      commandResolver: { resolveForAssetMulti: resolveSpy } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });

    await indexer.runFullScan();
    await cache.load();
    // Alias suffix is stripped — uuid-1234 is the primary class key.
    expect(cache.knownClassKeys()).toEqual(["uuid-1234"]);
  });

  it("preserves exo__Asset_prototype reference when resolving", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    const records: FrontmatterRecord[] = [
      {
        path: "task.md",
        frontmatter: {
          exo__Instance_class: ["[[ems__Task]]"],
          exo__Asset_prototype: "[[some-proto-uid]]",
        },
      },
    ];
    const resolveSpy = jest.fn(async () => [makeResolvedCommand("c1")]);
    const evalSpy = jest.fn(async () => true);

    const indexer = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => records },
      commandResolver: { resolveForAssetMulti: resolveSpy } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });

    await indexer.runFullScan();
    expect(resolveSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      "some-proto-uid",
    );
  });

  it("returns an empty cache when no asset declares a primary class", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    const records: FrontmatterRecord[] = [
      { path: "a.md", frontmatter: { exo__Instance_class: ["exo__Asset"] } },
      { path: "b.md", frontmatter: null },
    ];
    const resolveSpy = jest.fn();
    const evalSpy = jest.fn();

    const indexer = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => records },
      commandResolver: { resolveForAssetMulti: resolveSpy } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });

    const summary = await indexer.runFullScan();
    expect(summary.classesScanned).toBe(0);
    expect(summary.classesWritten).toBe(0);
    expect(resolveSpy).not.toHaveBeenCalled();

    // Empty bindings still get persisted so a subsequent load sees a
    // schema-valid file (and avoids re-running the indexer on every cold
    // start when the vault genuinely has no classed assets).
    await cache.load();
    expect(cache.knownClassKeys()).toEqual([]);
  });

  it("emits a stable signature dependent on precondition definitions", async () => {
    const fs = createInMemoryFs();
    const cache = new ExocmdBindingsCache(
      fs,
      ".exocortex/cache/exocmd-bindings.json",
      "16.9.0",
      mockLogger,
    );

    const baseRecords: FrontmatterRecord[] = [
      { path: "a.md", frontmatter: { exo__Instance_class: ["[[ems__Task]]"] } },
    ];

    const resolveA = jest.fn(async () => [
      makeResolvedCommand("c1", "pre-1", "ASK_A"),
    ]);
    const resolveB = jest.fn(async () => [
      makeResolvedCommand("c1", "pre-1", "ASK_B"),
    ]);
    const evalSpy = jest.fn(async () => true);

    const indexerA = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => baseRecords },
      commandResolver: { resolveForAssetMulti: resolveA } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });
    await indexerA.runFullScan();
    await cache.load();
    const sigA = cache.lookup("ems__Task")!.preconditions_signature;

    const indexerB = new ExocmdBindingsIndexer({
      cache,
      vaultSource: { listAllAssets: () => baseRecords },
      commandResolver: { resolveForAssetMulti: resolveB } as any,
      preconditionEvaluator: { evaluate: evalSpy } as any,
      logger: mockLogger,
    });
    await indexerB.runFullScan();
    await cache.load();
    const sigB = cache.lookup("ems__Task")!.preconditions_signature;

    expect(sigA).not.toBe(sigB);
  });
});
