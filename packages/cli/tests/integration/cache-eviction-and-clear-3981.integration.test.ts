/**
 * Integration test for Issue #3981 — query-result cache eviction + `cache clear`.
 *
 * Follow-up to #3979 (which fixed the write-only cache key so identical repeats
 * HIT). Two concerns remained: the query-result cache grows unbounded from
 * distinct queries (no proactive eviction) and there was no durable way to purge
 * the accumulated bloat (18,094 files / 191 MB observed on a real machine).
 *
 * This test drives:
 *  1. the REAL `QueryResultCache` (real fs I/O in a hermetic temp dir) to prove
 *     that `set` enforces the entry-count and total-size caps with oldest-first
 *     eviction; and
 *  2. the REAL `cache clear` / `cache stats` CLI subcommands in-process (via
 *     `cacheCommand().parseAsync`, with `os.homedir` redirected to a hermetic
 *     temp home) to prove the durable purge / reporting mechanism.
 *
 * In-process (not spawn/dist) so it actually RUNS in the `test-coverage-cli`
 * CI job (that job sets CI=true and does NOT build the CLI dist).
 *
 * Revert-verify:
 *  - Eviction: remove the `await this.prune(cacheKey)` call at the end of
 *    `QueryResultCache.set` → the entry count / total size grow past the caps
 *    → the count/size assertions RED. Restore → GREEN.
 *  - `cache clear`: turn the `await cache.clear()` call in the clear action into
 *    a no-op → cached files remain → the empty-dir assertion RED. Restore → GREEN.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
// Default import (mutable CJS exports) so jest.spyOn(os, "homedir") works —
// `import * as os` yields a frozen ESM namespace whose props are read-only.
import os from "os";

const { QueryResultCache } =
  await import("../../src/cache/QueryResultCache.js");
const { cacheCommand } = await import("../../src/commands/cache.js");

const TTL = 3600; // large so nothing expires mid-test

describe("QueryResultCache eviction (Issue #3981)", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3981-evict-"));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  function countFiles(): number {
    return fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json")).length
      : 0;
  }

  it("@req:acc1b360-f923-49db-aeca-698944872f80 evicts oldest-first once the entry-count cap is exceeded on set", async () => {
    const MAX = 3;
    const cache = new QueryResultCache({
      cacheDir,
      maxEntries: MAX,
      maxSizeBytes: Number.POSITIVE_INFINITY, // isolate the count cap
    });

    // Write 6 distinct queries. Without eviction the dir would hold 6 files;
    // with the cap every set prunes back to MAX.
    for (let i = 0; i < 6; i++) {
      await cache.set(`SELECT ?s WHERE { ?s ?p ${i} }`, { row: i }, TTL);
    }

    const stats = await cache.getCacheStats();
    // Core invariant — the discriminator that reverts to RED without prune:
    expect(stats.entryCount).toBeLessThanOrEqual(MAX);
    expect(countFiles()).toBeLessThanOrEqual(MAX);

    // The just-written (newest) entry is never evicted.
    const newest = await cache.get("SELECT ?s WHERE { ?s ?p 5 }", TTL);
    expect(newest).toEqual({ row: 5 });
  }, 30000);

  it("@req:acc1b360-f923-49db-aeca-698944872f80 evicts the oldest entry (by mtime) first, keeping the newest", async () => {
    const cache = new QueryResultCache({
      cacheDir,
      maxEntries: 2,
      maxSizeBytes: Number.POSITIVE_INFINITY,
    });

    // Write the entry that must be evicted, then back-date its mtime so it is
    // deterministically the oldest regardless of same-millisecond writes.
    await cache.set("OLDEST { ?s ?p ?o }", { tag: "oldest" }, TTL);
    const oldestFile = fs
      .readdirSync(cacheDir)
      .find((f) => f.endsWith(".json"))!;
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(cacheDir, oldestFile), past, past);

    // Write 3 newer entries → count (4) exceeds cap (2) → prune runs.
    await cache.set("NEWER_A { ?s ?p ?o }", { tag: "a" }, TTL);
    await cache.set("NEWER_B { ?s ?p ?o }", { tag: "b" }, TTL);
    await cache.set("NEWER_C { ?s ?p ?o }", { tag: "c" }, TTL);

    // The back-dated oldest entry must be gone; the newest must survive.
    expect(await cache.get("OLDEST { ?s ?p ?o }", TTL)).toBeNull();
    expect(await cache.get("NEWER_C { ?s ?p ?o }", TTL)).toEqual({ tag: "c" });
  }, 30000);

  it("@req:acc1b360-f923-49db-aeca-698944872f80 evicts once the total-size cap is exceeded on set", async () => {
    // Each result serializes to well over 1 KB; cap the cache at ~4 KB so a
    // handful of writes must trigger size-based eviction.
    const big = "x".repeat(2000);
    const cache = new QueryResultCache({
      cacheDir,
      maxEntries: Number.POSITIVE_INFINITY, // isolate the size cap
      maxSizeBytes: 4096,
    });

    for (let i = 0; i < 8; i++) {
      await cache.set(`SIZE_${i} { ?s ?p ?o }`, { i, big }, TTL);
    }

    const stats = await cache.getCacheStats();
    expect(stats.totalSizeBytes).toBeLessThanOrEqual(4096);
    // Newest survives even under the size cap.
    expect(await cache.get("SIZE_7 { ?s ?p ?o }", TTL)).toEqual({ i: 7, big });
  }, 30000);
});

describe("cache clear / cache stats subcommands (Issue #3981)", () => {
  let homeDir: string;
  let cacheDir: string;
  let logged: string[];
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-3981-home-"));
    cacheDir = path.join(homeDir, ".exocortex", "cache", "query-results");
    // os.homedir() is memoized under jest (a process.env.HOME override does NOT
    // take effect), so spy on os.homedir directly — restored in afterEach.
    jest.spyOn(os, "homedir").mockReturnValue(homeDir);

    logged = [];
    consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => String(a)).join(" "));
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  async function populate(n: number): Promise<void> {
    // Populate the DEFAULT cache dir (homedir-derived) that the command reads.
    const cache = new QueryResultCache({ cacheDir });
    for (let i = 0; i < n; i++) {
      await cache.set(`POP_${i} { ?s ?p ?o }`, { i }, TTL);
    }
  }

  function jsonLine(): { success: boolean; data?: Record<string, unknown> } {
    const line = [...logged].reverse().find((l) => {
      try {
        const p = JSON.parse(l);
        return p && typeof p === "object" && "success" in p;
      } catch {
        return false;
      }
    });
    expect(line).toBeDefined();
    return JSON.parse(line as string);
  }

  it("@req:acc1b360-f923-49db-aeca-698944872f80 `cache clear` removes every cached query result and reports the count freed", async () => {
    await populate(4);
    expect(
      fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json")).length,
    ).toBe(4);

    await cacheCommand().parseAsync([
      "node",
      "cache",
      "clear",
      "--output",
      "json",
    ]);

    // Directory is now empty of cache files.
    const remaining = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter((f) => f.endsWith(".json")).length
      : 0;
    expect(remaining).toBe(0);

    // JSON response reports what was cleared.
    const res = jsonLine();
    expect(res.success).toBe(true);
    expect(res.data?.action).toBe("clear");
    expect(res.data?.clearedEntries).toBe(4);
  }, 30000);

  it("@req:acc1b360-f923-49db-aeca-698944872f80 `cache stats` reports the current entry count", async () => {
    await populate(3);

    await cacheCommand().parseAsync([
      "node",
      "cache",
      "stats",
      "--output",
      "json",
    ]);

    const res = jsonLine();
    expect(res.success).toBe(true);
    expect(res.data?.entryCount).toBe(3);
    expect(typeof res.data?.totalSizeBytes).toBe("number");
  }, 30000);
});
