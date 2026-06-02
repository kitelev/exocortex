/**
 * @jest-environment node
 *
 * SwitchCacheLayer unit tests — adversarial cache/restore/has/clear flows.
 *
 * Uses real filesystem via `fs.mkdtempSync` for isolation per test.
 * tar archive emit/parse is handled by nanotar (pure JS) — no `child_process`
 * dependency in the production code, so tests don't need to inject binaries.
 * Node environment is required because nanotar relies on Web APIs
 * (CompressionStream/DecompressionStream, Response, TextEncoder) that
 * jsdom does not provide.
 *
 * Per `test-fixture-realism.md`: production-shape fixtures only. Tests
 * exercise the real archive lifecycle (collectTarInputs → createTarGzip →
 * write → parseTarGzip → readback) — no API stubs that would hide
 * regressions like the wrapper-dir convention break that was the spike's
 * primary finding.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  SwitchCacheLayer,
  CacheWriteError,
  CacheMissError,
  type CacheEntry,
} from "../../src/infrastructure/adapters/SwitchCacheLayer";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeFile(targetDir: string, relative: string, content: string): void {
  const fullPath = path.join(targetDir, relative);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

describe("SwitchCacheLayer", () => {
  let cacheDir: string;
  let sourceDir: string;
  let targetDir: string;
  let layer: SwitchCacheLayer;

  beforeEach(() => {
    cacheDir = makeTempDir("switch-cache-test");
    sourceDir = makeTempDir("switch-source");
    targetDir = makeTempDir("switch-target");
    layer = new SwitchCacheLayer({ cacheDir });
  });

  afterEach(() => {
    for (const d of [cacheDir, sourceDir, targetDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  // ─── 1. cache() happy path ────────────────────────────────────────────
  it("cache() — writes tarball + sidecar meta, returns CacheEntry", async () => {
    writeFile(sourceDir, "a.md", "alpha");
    writeFile(sourceDir, "b.md", "beta");

    const entry = await layer.cache("uid-1", sourceDir, "sha-abc123");

    expect(entry.asUid).toBe("uid-1");
    expect(entry.sha).toBe("sha-abc123");
    expect(entry.sizeBytes).toBeGreaterThan(0);
    expect(entry.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601

    const tarballPath = path.join(cacheDir, "uid-1", "sha-abc123.tar.gz");
    const metaPath = path.join(cacheDir, "uid-1", "sha-abc123.meta.json");
    expect(fs.existsSync(tarballPath)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as CacheEntry;
    expect(meta.sha).toBe("sha-abc123");
    expect(meta.sizeBytes).toBe(entry.sizeBytes);
  });

  // ─── 2. cache() F6 — non-existent source rejected ────────────────────
  it("cache() — throws CacheWriteError if sourceDir does not exist", async () => {
    const missing = path.join(sourceDir, "does-not-exist");
    await expect(
      layer.cache("uid-x", missing, "sha-zz"),
    ).rejects.toBeInstanceOf(CacheWriteError);

    // No partial cache file should remain.
    const tarballPath = path.join(cacheDir, "uid-x", "sha-zz.tar.gz");
    expect(fs.existsSync(tarballPath)).toBe(false);
  });

  // ─── 3. cache() F6 — empty source rejected (no entries) ──────────────
  it("cache() — throws CacheWriteError if sourceDir has no files (empty archive)", async () => {
    // sourceDir exists but empty. Archive would have zero entries.
    await expect(
      layer.cache("uid-empty", sourceDir, "sha-empty"),
    ).rejects.toBeInstanceOf(CacheWriteError);
    const tarballPath = path.join(cacheDir, "uid-empty", "sha-empty.tar.gz");
    expect(fs.existsSync(tarballPath)).toBe(false);
  });

  // ─── 4. cache() F6 — corrupted pre-existing archive cleanup ──────────
  it("cache() — overwrites pre-existing corrupted archive cleanly", async () => {
    // Pre-write a corrupted file at the target path. cache() must overwrite,
    // and the F6 verify on the new write must succeed.
    writeFile(sourceDir, "a.md", "real");
    const cachePath = path.join(cacheDir, "uid-overwrite", "sha-v.tar.gz");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "garbage-not-tar");

    const entry = await layer.cache("uid-overwrite", sourceDir, "sha-v");
    expect(entry.sizeBytes).toBeGreaterThan(0);

    // Now the file should be a valid archive — restore should succeed.
    const result = await layer.restore("uid-overwrite", targetDir);
    expect(result.sha).toBe("sha-v");
    expect(fs.existsSync(path.join(targetDir, "a.md"))).toBe(true);
  });

  // ─── 5. restore() F1 — plain extract (no wrapper, no strip) ──────────
  it("restore() — content lands directly under targetDir (no double-nesting)", async () => {
    writeFile(sourceDir, "a.md", "alpha");
    writeFile(sourceDir, "subdir/b.md", "beta");

    await layer.cache("uid-r", sourceDir, "sha-r1");

    const result = await layer.restore("uid-r", targetDir);
    expect(result.sha).toBe("sha-r1");

    expect(fs.existsSync(path.join(targetDir, "a.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "subdir", "b.md"))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, "a.md"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(targetDir, "subdir", "b.md"), "utf8")).toBe(
      "beta",
    );

    // F1 anti-pattern check: must NOT have wrapper directory с asUid (would
    // indicate cache-side wrapper convention with sibling --strip-components
    // expected on restore — the rejected anti-pattern).
    expect(fs.existsSync(path.join(targetDir, "uid-r"))).toBe(false);
  });

  // ─── 6. restore() picks newest by cachedAt ────────────────────────────
  it("restore() — picks newest cachedAt entry when multiple SHAs exist", async () => {
    writeFile(sourceDir, "v1.md", "v1");
    await layer.cache("uid-multi", sourceDir, "sha-old");

    // Wait briefly so ISO timestamps differ (millisecond resolution).
    await new Promise((r) => setTimeout(r, 20));

    fs.rmSync(path.join(sourceDir, "v1.md"));
    writeFile(sourceDir, "v2.md", "v2");
    await layer.cache("uid-multi", sourceDir, "sha-new");

    const result = await layer.restore("uid-multi", targetDir);
    expect(result.sha).toBe("sha-new");

    expect(fs.existsSync(path.join(targetDir, "v2.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "v1.md"))).toBe(false);
  });

  // ─── 7. restore() cache miss ─────────────────────────────────────────
  it("restore() — throws CacheMissError for unknown asUid", async () => {
    await expect(layer.restore("uid-nope", targetDir)).rejects.toBeInstanceOf(
      CacheMissError,
    );
  });

  // ─── 8. has() с SHA (R28) ─────────────────────────────────────────────
  it("has(uid, sha) — returns true only for matching cached sha (R28)", async () => {
    writeFile(sourceDir, "a.md", "x");
    await layer.cache("uid-has", sourceDir, "sha-real");

    expect(await layer.has("uid-has", "sha-real")).toBe(true);
    expect(await layer.has("uid-has", "sha-other")).toBe(false);
    expect(await layer.has("uid-unknown", "sha-real")).toBe(false);
  });

  // ─── 9. has() без SHA ─────────────────────────────────────────────────
  it("has(uid) — returns true if any cache entry exists для asUid", async () => {
    writeFile(sourceDir, "a.md", "x");
    await layer.cache("uid-any", sourceDir, "sha-any-1");

    expect(await layer.has("uid-any")).toBe(true);
    expect(await layer.has("uid-empty")).toBe(false);
  });

  // ─── 10. clear() wipe-all (Decision #6) ──────────────────────────────
  it("clear() — removes ALL cache entries across all AssetSpace dirs", async () => {
    writeFile(sourceDir, "a.md", "x");
    await layer.cache("uid-A", sourceDir, "sha-A1");
    await layer.cache("uid-A", sourceDir, "sha-A2");
    await layer.cache("uid-B", sourceDir, "sha-B1");

    const before = await layer.listEntries();
    expect(before.length).toBe(3);

    const result = await layer.clear();
    expect(result.entriesRemoved).toBe(3);

    const after = await layer.listEntries();
    expect(after.length).toBe(0);
    expect(fs.existsSync(path.join(cacheDir, "uid-A"))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, "uid-B"))).toBe(false);
  });

  // ─── 11. clear() on empty cache ──────────────────────────────────────
  it("clear() — entriesRemoved=0 when cache dir does not exist", async () => {
    const layer2 = new SwitchCacheLayer({
      cacheDir: path.join(cacheDir, "non-existent-subdir"),
    });
    const result = await layer2.clear();
    expect(result.entriesRemoved).toBe(0);
  });

  // ─── 12. listEntries() ───────────────────────────────────────────────
  it("listEntries() — returns all cache entries across all AssetSpace dirs", async () => {
    writeFile(sourceDir, "a.md", "x");
    await layer.cache("uid-X", sourceDir, "sha-X");
    await layer.cache("uid-Y", sourceDir, "sha-Y");

    const entries = await layer.listEntries();
    expect(entries.length).toBe(2);

    const uids = new Set(entries.map((e) => e.asUid));
    expect(uids.has("uid-X")).toBe(true);
    expect(uids.has("uid-Y")).toBe(true);
  });

  // ─── Bonus: zip-slip defense (nanotar normalisation + source guard) ──
  it("restore() — `..` / absolute entry paths are sanitised, files stay under targetDir", async () => {
    // Build an archive с `..` / absolute paths directly via nanotar to
    // bypass our own source walker (which would never produce traversal).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createTarGzip } = require("nanotar");
    const archive: Uint8Array = await createTarGzip([
      { name: "../escape.md", data: new TextEncoder().encode("evil") },
      { name: "/etc/passwd", data: new TextEncoder().encode("evil2") },
    ]);
    const cachePath = path.join(cacheDir, "uid-evil", "sha-evil.tar.gz");
    const metaPath = path.join(cacheDir, "uid-evil", "sha-evil.meta.json");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, archive);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        asUid: "uid-evil",
        sha: "sha-evil",
        cachedAt: new Date().toISOString(),
        sizeBytes: archive.byteLength,
      }),
      "utf8",
    );

    // nanotar normalises traversal — entries land as `escape.md` /
    // `etc/passwd` under targetDir. Our defense-in-depth check passes
    // because the resolved paths stay within targetDir. The critical
    // contract is: NO write outside targetDir.
    await layer.restore("uid-evil", targetDir);
    expect(fs.existsSync(path.join(path.dirname(targetDir), "escape.md"))).toBe(
      false,
    );
    // Sanitised entries land at `escape.md` / `etc/passwd` UNDER targetDir.
    expect(fs.existsSync(path.join(targetDir, "escape.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "etc", "passwd"))).toBe(true);
  });

  // ─── 13. has() requires sidecar (orphan tarball ignored) ─────────────
  it("has(uid, sha) — returns false for orphan tarball without sidecar", async () => {
    // Synthesize an orphan tarball at the canonical path (no sidecar).
    const orphanDir = path.join(cacheDir, "uid-orphan");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(
      path.join(orphanDir, "sha-orphan.tar.gz"),
      new Uint8Array([0x1f, 0x8b, 0x08]), // gzip magic, doesn't matter
    );
    expect(await layer.has("uid-orphan", "sha-orphan")).toBe(false);
    expect(await layer.has("uid-orphan")).toBe(false);
  });

  // ─── 14. restore() ignores orphan tarballs, picks newest valid ───────
  it("restore() — ignores orphan tarballs, prefers entries with valid sidecars", async () => {
    writeFile(sourceDir, "real.md", "real");
    await layer.cache("uid-mix", sourceDir, "sha-good");

    // Plant an orphan tarball with a newer ISO timestamp encoded in path
    // (won't matter — orphan ignored by restore).
    const dir = path.join(cacheDir, "uid-mix");
    fs.writeFileSync(
      path.join(dir, "sha-orphan.tar.gz"),
      new Uint8Array([0x1f, 0x8b]),
    );

    const result = await layer.restore("uid-mix", targetDir);
    expect(result.sha).toBe("sha-good");
    expect(fs.existsSync(path.join(targetDir, "real.md"))).toBe(true);
  });

  // ─── 15. restore() skips malformed sidecar, errors if all malformed ──
  it("restore() — skips malformed sidecar JSON, throws CacheMissError if no valid entries", async () => {
    // Write a malformed sidecar + dangling tarball.
    const dir = path.join(cacheDir, "uid-bad-meta");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "sha-x.tar.gz"),
      new Uint8Array([0x1f, 0x8b]),
    );
    fs.writeFileSync(
      path.join(dir, "sha-x.meta.json"),
      "not-valid-json-{{{",
      "utf8",
    );
    await expect(layer.restore("uid-bad-meta", targetDir)).rejects.toBeInstanceOf(
      CacheMissError,
    );
  });

  // ─── 16. restore() skips sidecar pointing to missing tarball ─────────
  it("restore() — sidecar pointing to missing tarball is skipped", async () => {
    const dir = path.join(cacheDir, "uid-orphan-meta");
    fs.mkdirSync(dir, { recursive: true });
    // Sidecar references sha-gone but no tarball file exists.
    fs.writeFileSync(
      path.join(dir, "sha-gone.meta.json"),
      JSON.stringify({
        asUid: "uid-orphan-meta",
        sha: "sha-gone",
        cachedAt: new Date().toISOString(),
        sizeBytes: 100,
      }),
      "utf8",
    );
    await expect(
      layer.restore("uid-orphan-meta", targetDir),
    ).rejects.toBeInstanceOf(CacheMissError);
  });
});

// ─── Mobile guard — every public entry throws on Platform.isMobile ──────
describe("SwitchCacheLayer — mobile guard", () => {
  let cacheDir: string;
  let sourceDir: string;
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.TEST_PLATFORM;
    process.env.TEST_PLATFORM = "mobile";
    // Reset module cache so the obsidian mock re-evaluates Platform.isMobile.
    jest.resetModules();
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env.TEST_PLATFORM;
    else process.env.TEST_PLATFORM = originalEnv;
    jest.resetModules();
  });

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-cache-mobile-"));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-source-mobile-"));
  });

  afterEach(() => {
    for (const d of [cacheDir, sourceDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("all public async entry points throw 'mobile not supported' on isMobile=true", async () => {
    // Re-import SwitchCacheLayer post-module-reset so it picks up the new
    // Platform.isMobile=true value.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../../src/infrastructure/adapters/SwitchCacheLayer");
    const Layer = mod.SwitchCacheLayer as typeof SwitchCacheLayer;
    const layer = new Layer({ cacheDir });

    await expect(layer.cache("uid", sourceDir, "sha")).rejects.toThrow(
      /mobile not supported/,
    );
    await expect(layer.has("uid")).rejects.toThrow(/mobile not supported/);
    await expect(layer.restore("uid", cacheDir)).rejects.toThrow(
      /mobile not supported/,
    );
    await expect(layer.clear()).rejects.toThrow(/mobile not supported/);
    await expect(layer.listEntries()).rejects.toThrow(/mobile not supported/);
  });

  it("getCacheStats() returns zeros on mobile (sync, no fs touch)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../../src/infrastructure/adapters/SwitchCacheLayer");
    const Layer = mod.SwitchCacheLayer as typeof SwitchCacheLayer;
    const layer = new Layer({ cacheDir });
    const stats = layer.getCacheStats();
    expect(stats).toEqual({ count: 0, totalSize: 0, oldestEntry: null });
  });
});

// ─── Sync getCacheStats() — Settings UI compat ─────────────────────────
describe("SwitchCacheLayer.getCacheStats() — sync", () => {
  let cacheDir: string;
  let sourceDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-cache-stats-test-"));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-source-stats-"));
  });

  afterEach(() => {
    for (const d of [cacheDir, sourceDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("returns zeros when cache dir empty / nonexistent", () => {
    const layer = new SwitchCacheLayer({
      cacheDir: path.join(cacheDir, "nope"),
    });
    expect(layer.getCacheStats()).toEqual({
      count: 0,
      totalSize: 0,
      oldestEntry: null,
    });
  });

  it("aggregates count + totalSize + oldestEntry from sidecar metas", async () => {
    const layer = new SwitchCacheLayer({ cacheDir });
    fs.writeFileSync(path.join(sourceDir, "a.md"), "x", "utf8");
    await layer.cache("uid-stats", sourceDir, "sha-1");
    await new Promise((r) => setTimeout(r, 10));
    await layer.cache("uid-stats", sourceDir, "sha-2");

    const stats = layer.getCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.totalSize).toBeGreaterThan(0);
    expect(stats.oldestEntry).not.toBeNull();
  });
});
