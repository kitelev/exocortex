/**
 * ExoSync device-local conflict cache (offline-resolution foundation).
 *
 * Two layers, production-shape (test-fixture-realism):
 *  1. Store mechanics over an in-memory single-file IO that mirrors the real
 *     WatermarkFileIO contract (read → string|null, atomic write).
 *  2. End-to-end: the REAL {@link SyncEngine} drives a genuine asset-mode
 *     conflict and the cache (wired as the engine's quarantine sink) captures
 *     all three versions on disk — the foundation the offline resolver reads.
 */

import { describe, expect, it } from "@jest/globals";
import * as yaml from "js-yaml";
import {
  GatedStructuredMerger,
  LocalConflictCacheStore,
  CONFLICT_CACHE_STORE_FILENAME,
  StructuredMerger,
  SyncEngine,
  type MergeLayerPort,
  type QuarantineEntry,
  type WatermarkFileIO,
  type YamlCodec,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

/** In-memory WatermarkFileIO — same single-file contract the real adapters honour. */
function memIO(): WatermarkFileIO & { content: string | null } {
  const state: { content: string | null } = { content: null };
  return {
    get content(): string | null {
      return state.content;
    },
    set content(v: string | null) {
      state.content = v;
    },
    async read(): Promise<string | null> {
      return state.content;
    },
    async writeAtomic(content: string): Promise<void> {
      state.content = content;
    },
  };
}

const ENTRY: QuarantineEntry = {
  repoKey: "o/r#main",
  path: "assets/a.md",
  uid: "u1",
  reason: "frontmatter key changed differently on both sides",
  baseContent: "base text",
  localContent: "LOCAL text",
  remoteContent: "REMOTE text",
};

const yamlCodec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

describe("LocalConflictCacheStore — store mechanics", () => {
  it("caches all three versions of one conflict and lists/gets it back", async () => {
    const io = memIO();
    const store = new LocalConflictCacheStore({
      io,
      now: () => "2026-06-21T00:00:00Z",
    });

    await store.quarantine(ENTRY);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      repoKey: "o/r#main",
      path: "assets/a.md",
      uid: "u1",
      baseContent: "base text",
      localContent: "LOCAL text",
      remoteContent: "REMOTE text",
      quarantinedAt: "2026-06-21T00:00:00Z",
    });
    const got = await store.get("o/r#main", "assets/a.md");
    expect(got?.localContent).toBe("LOCAL text");
  });

  it("stores the EXACT content unredacted — a cache that scrubbed secrets would push corruption", async () => {
    const io = memIO();
    const store = new LocalConflictCacheStore({ io });
    const withSecret: QuarantineEntry = {
      ...ENTRY,
      localContent: "token: ghp_" + "x".repeat(36),
    };

    await store.quarantine(withSecret);

    const got = await store.get(ENTRY.repoKey, ENTRY.path);
    // The `.local.` exclusion is the leak guard; the bytes must survive verbatim.
    expect(got?.localContent).toBe("token: ghp_" + "x".repeat(36));
  });

  it("round-trips a losing-local binary payload as base64 (file-mode, D18)", async () => {
    const io = memIO();
    const store = new LocalConflictCacheStore({ io });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);

    await store.quarantine({
      repoKey: "o/r#main",
      path: "img.png",
      reason: "file-mode remote-wins; losing local preserved",
      localContentBytes: bytes,
    });

    const got = await store.get("o/r#main", "img.png");
    expect(got?.localContentBytesBase64).toBe(
      Buffer.from(bytes).toString("base64"),
    );
  });

  it("batches many entries in one quarantineAll", async () => {
    const io = memIO();
    const store = new LocalConflictCacheStore({ io });
    await store.quarantineAll([
      { ...ENTRY, path: "a.md" },
      { ...ENTRY, path: "b.md" },
    ]);
    const paths = (await store.list()).map((r) => r.path).sort();
    expect(paths).toEqual(["a.md", "b.md"]);
  });

  it("preserves quarantinedAt on re-quarantine but refreshes the captured content", async () => {
    let n = 0;
    const io = memIO();
    const store = new LocalConflictCacheStore({
      io,
      now: () => `2026-06-21T00:00:0${n++}`,
    });

    await store.quarantine(ENTRY);
    await store.quarantine({ ...ENTRY, remoteContent: "REMOTE moved again" });

    const got = await store.get(ENTRY.repoKey, ENTRY.path);
    expect(got?.quarantinedAt).toBe("2026-06-21T00:00:00"); // original, not refreshed
    expect(got?.remoteContent).toBe("REMOTE moved again"); // content refreshed
  });

  it("markResolved drops the entry (no-op when absent)", async () => {
    const io = memIO();
    const store = new LocalConflictCacheStore({ io });
    await store.quarantine(ENTRY);
    expect(await store.list()).toHaveLength(1);

    await store.markResolved(ENTRY.repoKey, ENTRY.path);
    expect(await store.list()).toHaveLength(0);
    // idempotent
    await expect(
      store.markResolved(ENTRY.repoKey, ENTRY.path),
    ).resolves.toBeUndefined();
  });

  it("tolerant read: a corrupt/absent file reads as an empty cache, never throws", async () => {
    const io = memIO();
    io.content = "}{ not json";
    const store = new LocalConflictCacheStore({ io });
    expect(await store.list()).toEqual([]);
    expect(await store.get("o/r#main", "a.md")).toBeNull();
  });

  it("serializes concurrent writes without clobbering (lossless RMW)", async () => {
    const io = memIO();
    const store = new LocalConflictCacheStore({ io });
    await Promise.all([
      store.quarantine({ ...ENTRY, path: "a.md" }),
      store.quarantine({ ...ENTRY, path: "b.md" }),
      store.quarantine({ ...ENTRY, path: "c.md" }),
    ]);
    expect((await store.list()).map((r) => r.path).sort()).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("uses the Sync-excluded `.local.` filename convention", () => {
    expect(CONFLICT_CACHE_STORE_FILENAME).toContain(".local.");
    expect(CONFLICT_CACHE_STORE_FILENAME).toBe("exosync-conflicts.local.json");
  });
});

describe("LocalConflictCacheStore — real SyncEngine quarantine flush (foundation)", () => {
  const FILE = "assets/a.md";

  function makeEngineWithCache(
    gh: FakeGitHubRepo,
    local: FakeLocalFiles,
    cache: LocalConflictCacheStore,
    mergeLayer?: MergeLayerPort,
  ): { engine: SyncEngine; watermarks: FakeWatermarkStore } {
    const watermarks = new FakeWatermarkStore();
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: watermarks,
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => local,
      sha1: sha1Hex,
      quarantine: cache,
      mergeLayer:
        mergeLayer ??
        new GatedStructuredMerger(new StructuredMerger(yamlCodec)),
    });
    return { engine, watermarks };
  }

  it("captures base/local/remote in the cache when the engine quarantines a genuine 3-way", async () => {
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "base body") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "base body") });
    const cache = new LocalConflictCacheStore({ io: memIO() });
    // Force a quarantine deterministically (mirrors an unmergeable conflict).
    const { engine } = makeEngineWithCache(gh, local, cache, {
      resolve: async () => ({
        action: "quarantine",
        reason: "unmergeable (test)",
      }),
    });
    await engine.sync(gh.spec()); // bootstrap watermark

    gh.commitDirect(
      "main",
      { [FILE]: mdAsset("u1", "REMOTE edit") },
      "device B",
    );
    local.files.set(FILE, mdAsset("u1", "LOCAL edit"));
    const result = await engine.sync(gh.spec());

    expect(result.quarantinedCount).toBe(1);
    const cached = await cache.get(gh.spec().repoKey, FILE);
    expect(cached).not.toBeNull();
    expect(cached?.localContent).toContain("LOCAL edit");
    expect(cached?.remoteContent).toContain("REMOTE edit");
    expect(cached?.baseContent).toContain("base body");
  });

  it("evicts the cached entry when a previously-pinned conflict converges (engine markResolved)", async () => {
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "base body") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "base body") });
    const cache = new LocalConflictCacheStore({ io: memIO() });
    const { engine } = makeEngineWithCache(gh, local, cache, {
      resolve: async () => ({
        action: "quarantine",
        reason: "unmergeable (test)",
      }),
    });
    await engine.sync(gh.spec()); // bootstrap

    // Conflict → cached + pinned.
    gh.commitDirect(
      "main",
      { [FILE]: mdAsset("u1", "REMOTE edit") },
      "device B",
    );
    local.files.set(FILE, mdAsset("u1", "LOCAL edit"));
    await engine.sync(gh.spec());
    expect(await cache.get(gh.spec().repoKey, FILE)).not.toBeNull();

    // User converges local to the remote version → next sync clears the pin and
    // the engine calls markResolved, which drops the cache entry.
    local.files.set(FILE, mdAsset("u1", "REMOTE edit"));
    await engine.sync(gh.spec());
    expect(await cache.get(gh.spec().repoKey, FILE)).toBeNull();
  });
});
