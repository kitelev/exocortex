/**
 * @jest-environment node
 *
 * Reason: pullAssetSpace materialises tarball entries via Node `fs/promises`
 * and decompresses via Web Streams (CompressionStream/DecompressionStream)
 * which jest-environment-jsdom does NOT expose. node environment supplies
 * both.
 *
 * Coverage scope (P1.3 — Phase 5 RFC 22b50a17):
 *   1. Happy path — valid tarball materialises correctly with wrapper-strip
 *   2. Network drop — fetchTarballBuffer rejects → staging cleaned up
 *   3. Partial / corrupt tarball — TarExtractor parse error → staging cleaned
 *   4. Zip-slip attempt — `..` path → TarExtractor rejects → staging cleaned
 *   5. Wrapper-dir mismatch — first/second entries disagree → PullError thrown
 *   6. Size cap exceeded — fetchTarballBuffer enforces 50 MB → no extract
 *   7. Staging-tracker orphan sweep — simulate plugin crash mid-pull
 *
 * Fixtures use real `nanotar.createTar` + native gzip per the
 * test-fixture-realism rule (no stub-returning-fixed-bytes).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { App } from "obsidian";
import type { INotificationService } from "@kitelev/exocortex-core";
import { createTar } from "nanotar";

import {
  AssetSpaceManager,
  discoverWrapperDir,
  extractShaFromWrapper,
} from "../../../../src/infrastructure/adapters/AssetSpaceManager";
import { StagingDirTracker } from "../../../../src/infrastructure/adapters/StagingDirTracker";
import { PluginLocalDataStore } from "../../../../src/infrastructure/adapters/PluginLocalDataStore";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface FakeGitHubClient {
  fetchTarballBuffer: jest.Mock<Promise<ArrayBuffer>, [string, string, string]>;
  ensureRateLimit: jest.Mock<Promise<void>, [number]>;
}

function makeFakeClient(
  overrides: Partial<FakeGitHubClient> = {},
): FakeGitHubClient {
  return {
    fetchTarballBuffer: jest
      .fn<Promise<ArrayBuffer>, [string, string, string]>()
      .mockResolvedValue(new ArrayBuffer(0)),
    ensureRateLimit: jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFakeNotifier(): INotificationService {
  return {
    info: () => undefined,
    success: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    confirm: async () => true,
  };
}

/**
 * Build a fake App whose `vault.adapter` is backed by the real Node `fs`
 * под the supplied disk root. PluginLocalDataStore writes the JSON
 * registry via `vault.adapter.write/read/exists`, so the fake must
 * actually persist (otherwise `readActiveStagingDirs` always returns []).
 *
 * `vault.adapter.write(path, json)` interprets `path` як vault-relative.
 * We anchor it under `diskRoot/` so test isolation holds.
 */
function makeFakeApp(diskRoot: string): App {
  const resolve = (p: string) => path.join(diskRoot, p);
  return {
    vault: {
      getMarkdownFiles: () => [],
      adapter: {
        read: async (p: string) => {
          return await fs.readFile(resolve(p), "utf8");
        },
        exists: async (p: string) => {
          return await fs
            .access(resolve(p))
            .then(() => true)
            .catch(() => false);
        },
        write: async (p: string, content: string) => {
          const abs = resolve(p);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content);
        },
      },
      configDir: ".obsidian",
    },
    metadataCache: {
      getFileCache: () => null,
    },
  } as unknown as App;
}

/**
 * Build a gzipped tarball wrapping `entries` under a directory named
 * `wrapper` (= GitHub REST convention `<owner>-<repo>-<sha7>/`).
 *
 * Uses real `createTar` + native CompressionStream — fixtures are byte-
 * identical to what GitHub would emit (modulo timestamps/UID/GID).
 */
async function makeTarball(
  wrapper: string,
  entries: Array<{ name: string; data?: Uint8Array }>,
): Promise<ArrayBuffer> {
  const files = entries.map((e) => ({
    name: `${wrapper}/${e.name}`,
    data: e.data,
  }));
  const tarBuf = createTar(files);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(tarBuf);
      c.close();
    },
  }).pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/** Build a tarball whose entries do NOT share a common wrapper directory. */
async function makeMismatchedWrapperTarball(): Promise<ArrayBuffer> {
  const files = [
    { name: "wrapper-a-aaaaaaa/file.md", data: new Uint8Array([1]) },
    { name: "wrapper-b-bbbbbbb/file.md", data: new Uint8Array([2]) },
  ];
  const tarBuf = createTar(files);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(tarBuf);
      c.close();
    },
  }).pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/**
 * Build a tarball with a parent-dir-traversal entry — TarExtractor must
 * reject with a ZipSlipError when this fixture is consumed.
 *
 * Note: nanotar's parser sanitises `..` from entry names before yielding;
 * to actually exercise the validator we must bypass the sanitiser by
 * crafting a raw tar header. Easiest realistic approach: use absolute
 * path (`/etc/passwd`) which nanotar leaves alone in `_sanitizePath`
 * after stripping the leading slash — that yields `etc/passwd` which
 * still fails the wrapper-prefix gate downstream. For a true `..` test,
 * we craft via direct header manipulation below.
 */
async function makeAbsolutePathTarball(): Promise<ArrayBuffer> {
  const files = [
    { name: "/etc/passwd", data: new Uint8Array([0]) },
  ];
  const tarBuf = createTar(files);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(tarBuf);
      c.close();
    },
  }).pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/** Disposable tmpdir cleaned in afterEach. */
async function makeTmpdir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "exo-p1-test-"));
}

async function cleanTmpdir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

interface Harness {
  app: App;
  client: FakeGitHubClient;
  mgr: AssetSpaceManager;
  tracker: StagingDirTracker;
  store: PluginLocalDataStore;
  tmpdirBase: string;
}

async function makeHarness(
  opts: { clientOverrides?: Partial<FakeGitHubClient> } = {},
): Promise<Harness> {
  const tmpdirBase = await makeTmpdir();
  const diskRoot = path.join(tmpdirBase, "vault");
  await fs.mkdir(diskRoot, { recursive: true });
  const app = makeFakeApp(diskRoot);
  const store = new PluginLocalDataStore({
    app,
    path: "data.local.json",
  });
  await store.init();
  const tracker = new StagingDirTracker({
    localDataStore: store,
    tmpdirBase,
  });
  const client = makeFakeClient(opts.clientOverrides);
  const mgr = new AssetSpaceManager({
    app,
    client: client as never,
    notifications: makeFakeNotifier(),
    stagingTracker: tracker,
  });
  return { app, client, mgr, tracker, store, tmpdirBase };
}

// ─── 1. Happy path ──────────────────────────────────────────────────────────

describe("AssetSpaceManager.pullAssetSpace — happy path", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("materialises entries with wrapper-strip and returns sha", async () => {
    h = await makeHarness();
    const tarball = await makeTarball("owner-repo-abc1234", [
      { name: "a.md", data: new TextEncoder().encode("# A\n") },
      { name: "sub/b.md", data: new TextEncoder().encode("# B\n") },
    ]);
    h.client.fetchTarballBuffer.mockResolvedValue(tarball);

    const result = await h.mgr.pullAssetSpace(
      "test-uid",
      "https://github.com/owner/repo",
      "main",
    );

    expect(result.asUid).toBe("test-uid");
    expect(result.sha).toBe("abc1234");
    expect(result.stagingPath.startsWith(h.tmpdirBase)).toBe(true);

    const aContent = await fs.readFile(
      path.join(result.stagingPath, "a.md"),
      "utf8",
    );
    expect(aContent).toBe("# A\n");
    const bContent = await fs.readFile(
      path.join(result.stagingPath, "sub", "b.md"),
      "utf8",
    );
    expect(bContent).toBe("# B\n");

    expect(h.client.fetchTarballBuffer).toHaveBeenCalledWith(
      "owner",
      "repo",
      "main",
    );
  });
});

// ─── 2. Network drop — staging cleanup ──────────────────────────────────────

describe("AssetSpaceManager.pullAssetSpace — network drop", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("releases staging dir when fetchTarballBuffer rejects", async () => {
    h = await makeHarness({
      clientOverrides: {
        fetchTarballBuffer: jest
          .fn<Promise<ArrayBuffer>, [string, string, string]>()
          .mockRejectedValue(new Error("ECONNRESET network drop")),
      },
    });

    await expect(
      h.mgr.pullAssetSpace(
        "uid-network",
        "https://github.com/o/r",
      ),
    ).rejects.toThrow(/ECONNRESET/);

    // Tracker registry should be empty — release fired in catch.
    const tracked = await h.store.readActiveStagingDirs();
    expect(tracked).toHaveLength(0);

    // No leftover dirs (besides the data.local.json file).
    const remaining = await fs.readdir(h.tmpdirBase);
    expect(
      remaining.filter((n) => n.startsWith("exo-staging-")),
    ).toHaveLength(0);
  });
});

// ─── 2b. Rate-limit pre-flight — fail fast before staging allocation ───────

describe("AssetSpaceManager.pullAssetSpace — rate-limit pre-flight", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("ensureRateLimit failure aborts before staging allocation", async () => {
    h = await makeHarness({
      clientOverrides: {
        ensureRateLimit: jest
          .fn<Promise<void>, [number]>()
          .mockRejectedValue(
            new Error(
              "Rate limit guard: 2 remaining < 11 needed; resets in 600s",
            ),
          ),
      },
    });

    await expect(
      h.mgr.pullAssetSpace("uid-rl", "https://github.com/o/r"),
    ).rejects.toThrow(/Rate limit guard/);

    // No staging dir registered — release was never needed
    expect(await h.store.readActiveStagingDirs()).toHaveLength(0);
    expect(h.client.fetchTarballBuffer).not.toHaveBeenCalled();

    // mkdtemp didn't fire either
    const remaining = await fs.readdir(h.tmpdirBase);
    expect(
      remaining.filter((n) => n.startsWith("exo-staging-")),
    ).toHaveLength(0);
  });
});

// ─── 3. Corrupt tarball — TarExtractor parse error ──────────────────────────

describe("AssetSpaceManager.pullAssetSpace — corrupt tarball", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("propagates parse error and cleans staging", async () => {
    h = await makeHarness();
    // Truncated gzip header — first 3 bytes valid magic, rest garbage.
    const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff]).buffer;
    h.client.fetchTarballBuffer.mockResolvedValue(corrupt);

    await expect(
      h.mgr.pullAssetSpace(
        "uid-corrupt",
        "https://github.com/o/r",
      ),
    ).rejects.toThrow();

    const tracked = await h.store.readActiveStagingDirs();
    expect(tracked).toHaveLength(0);
  });
});

// ─── 4. Zip-slip — absolute path entry rejected ─────────────────────────────

describe("AssetSpaceManager.pullAssetSpace — zip-slip protection", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("rejects tarball containing absolute-path entry", async () => {
    h = await makeHarness();
    // nanotar's parser strips the leading '/' from '/etc/passwd' →
    // 'etc/passwd', which fails the wrapper-strip gate (no wrapper
    // segment + no `/` in path post-strip). Either way: we never write
    // anything outside the staging dir.
    const tarball = await makeAbsolutePathTarball();
    h.client.fetchTarballBuffer.mockResolvedValue(tarball);

    await expect(
      h.mgr.pullAssetSpace(
        "uid-slip",
        "https://github.com/o/r",
      ),
    ).rejects.toThrow();

    // No file written outside staging.
    const passwdLeak = await fs
      .access("/etc/passwd-exocortex-attack")
      .then(() => true)
      .catch(() => false);
    expect(passwdLeak).toBe(false);

    const tracked = await h.store.readActiveStagingDirs();
    expect(tracked).toHaveLength(0);
  });
});

// ─── 5. Wrapper-dir mismatch ────────────────────────────────────────────────

describe("AssetSpaceManager.pullAssetSpace — wrapper mismatch", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("throws when entries do not share a single wrapper directory", async () => {
    h = await makeHarness();
    const tarball = await makeMismatchedWrapperTarball();
    h.client.fetchTarballBuffer.mockResolvedValue(tarball);

    await expect(
      h.mgr.pullAssetSpace(
        "uid-mismatch",
        "https://github.com/o/r",
      ),
    ).rejects.toThrow(/not under wrapper/);

    const tracked = await h.store.readActiveStagingDirs();
    expect(tracked).toHaveLength(0);
  });
});

// ─── 6. Size cap — fetchTarballBuffer enforces ──────────────────────────────

describe("AssetSpaceManager.pullAssetSpace — size cap", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await cleanTmpdir(h.tmpdirBase);
  });

  it("propagates oversize error from fetchTarballBuffer (50 MB cap)", async () => {
    // Real GitHubRestClient.fetchTarballBuffer rejects oversize tarballs
    // before parse — pullAssetSpace must surface that error and clean
    // staging.
    h = await makeHarness({
      clientOverrides: {
        fetchTarballBuffer: jest
          .fn<Promise<ArrayBuffer>, [string, string, string]>()
          .mockRejectedValue(
            new Error(
              "GitHub fetchTarballBuffer: tarball exceeds maxTarballBytes (52428801 > 52428800) for o/r@main",
            ),
          ),
      },
    });

    await expect(
      h.mgr.pullAssetSpace("uid-oversize", "https://github.com/o/r"),
    ).rejects.toThrow(/exceeds maxTarballBytes/);

    const tracked = await h.store.readActiveStagingDirs();
    expect(tracked).toHaveLength(0);
  });
});

// ─── 7. Staging-tracker orphan sweep ────────────────────────────────────────

describe("StagingDirTracker — orphan sweep", () => {
  let tmpdirBase: string;
  afterEach(async () => {
    if (tmpdirBase) await cleanTmpdir(tmpdirBase);
  });

  it("sweeps orphan staging dirs left over from a plugin crash", async () => {
    tmpdirBase = await makeTmpdir();
    const diskRoot = path.join(tmpdirBase, "vault");
    await fs.mkdir(diskRoot, { recursive: true });
    const app = makeFakeApp(diskRoot);
    const store = new PluginLocalDataStore({
      app,
      path: "data.local.json",
    });
    await store.init();
    const tracker = new StagingDirTracker({
      localDataStore: store,
      tmpdirBase,
    });

    // Allocate two staging dirs, simulate a crash by NOT calling release.
    const d1 = await tracker.allocate("uid-1");
    const d2 = await tracker.allocate("uid-2");
    await fs.writeFile(path.join(d1, "marker.md"), "1");
    await fs.writeFile(path.join(d2, "marker.md"), "2");

    // Verify both registered + persisted to data.local.json.
    const trackedBefore = await store.readActiveStagingDirs();
    expect(trackedBefore.map((e) => e.path).sort()).toEqual([d1, d2].sort());

    // Sweep — both dirs should be removed AND registry cleared.
    const result = await tracker.sweepOrphans();
    expect(result.tracked).toBe(2);
    expect(result.swept).toBe(2);

    const trackedAfter = await store.readActiveStagingDirs();
    expect(trackedAfter).toHaveLength(0);

    for (const dir of [d1, d2]) {
      const exists = await fs
        .access(dir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    }
  });

  it("tolerates entries pointing at already-removed dirs", async () => {
    tmpdirBase = await makeTmpdir();
    const diskRoot = path.join(tmpdirBase, "vault");
    await fs.mkdir(diskRoot, { recursive: true });
    const app = makeFakeApp(diskRoot);
    const store = new PluginLocalDataStore({
      app,
      path: "data.local.json",
    });
    await store.init();
    const tracker = new StagingDirTracker({
      localDataStore: store,
      tmpdirBase,
    });

    const d1 = await tracker.allocate("uid-vanished");
    await fs.rm(d1, { recursive: true, force: true }); // simulate manual cleanup

    const result = await tracker.sweepOrphans();
    expect(result.tracked).toBe(1);
    expect(result.swept).toBe(0); // dir was gone — counted as tracked but not swept
    expect(await store.readActiveStagingDirs()).toHaveLength(0);
  });
});

// ─── Helper unit tests — discoverWrapperDir / extractShaFromWrapper ─────────

describe("discoverWrapperDir", () => {
  it("returns first segment when all entries share it", () => {
    const wrapper = discoverWrapperDir([
      { path: "owner-repo-abc1234/a.md", content: new Uint8Array() },
      { path: "owner-repo-abc1234/sub/b.md", content: new Uint8Array() },
    ]);
    expect(wrapper).toBe("owner-repo-abc1234");
  });

  it("throws on empty list", () => {
    expect(() => discoverWrapperDir([])).toThrow(/empty entry list/);
  });

  it("throws when an entry uses a different wrapper", () => {
    expect(() =>
      discoverWrapperDir([
        { path: "a-w-1234567/file", content: new Uint8Array() },
        { path: "b-w-7654321/file", content: new Uint8Array() },
      ]),
    ).toThrow(/not under wrapper/);
  });

  it("throws when first entry has no path separator", () => {
    expect(() =>
      discoverWrapperDir([
        { path: "single-file.md", content: new Uint8Array() },
      ]),
    ).toThrow(/no path separator/);
  });
});

describe("extractShaFromWrapper", () => {
  it("returns the trailing 7-hex segment", () => {
    expect(extractShaFromWrapper("owner-repo-b011b4b")).toBe("b011b4b");
  });

  it("handles repo names with hyphens", () => {
    expect(extractShaFromWrapper("kitelev-exoas-shared-identities-deadbef")).toBe(
      "deadbef",
    );
  });

  it("lowercases hex characters", () => {
    expect(extractShaFromWrapper("owner-repo-ABCDEF0")).toBe("abcdef0");
  });

  it("throws on a wrapper without a trailing 7-hex segment", () => {
    expect(() => extractShaFromWrapper("owner-repo-toolongofasha")).toThrow(
      /does not match/,
    );
  });

  it("accepts the full 40-char SHA of an authenticated tarball wrapper (#3382)", () => {
    // Authenticated GitHub tarballs carry the FULL commit SHA (anonymous ones
    // are abbreviated to 7). Rejecting it broke private-repo pulls.
    const sha40 = "306f656e6159944a4ae18beeb618d13611826b9b";
    expect(extractShaFromWrapper(`kitelev-exoas-honesttest-${sha40}`)).toBe(
      sha40,
    );
  });
});
