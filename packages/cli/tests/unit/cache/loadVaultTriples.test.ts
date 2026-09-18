/**
 * `loadVaultTriples` + the #4264 write-through helpers — unit axes.
 *
 * Requirement: @req:cb707868-356f-495d-825a-182e66ba8bcd
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { NoteToRDFConverter } from "@kitelev/exocortex-core";
import { FileSystemVaultAdapter } from "../../../src/adapters/FileSystemVaultAdapter.js";
import { CacheManager } from "../../../src/cache/CacheManager.js";
import {
  loadVaultTriples,
  cacheLoadNotice,
  writeThroughCache,
  writeThroughNotice,
} from "../../../src/cache/loadVaultTriples.js";

const REQ = "@req:cb707868-356f-495d-825a-182e66ba8bcd";

describe(`loadVaultTriples / write-through helpers (#4264) ${REQ}`, () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lvt-4264-"));
    vaultPath = path.join(tempDir, "vault");
    await fs.ensureDir(vaultPath);
    await fs.writeFile(
      path.join(vaultPath, "a.md"),
      "---\nexo__Asset_uid: 42640000-0000-4000-8000-0000000000f9\nexo__Asset_label: A\n---\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it(`L1 the full-parse path converts through the CALLER's adapter when one is given (no second adapter, no cache manager) ${REQ}`, async () => {
    const adapter = new FileSystemVaultAdapter(vaultPath);
    const seen: unknown[] = [];
    jest
      .spyOn(NoteToRDFConverter.prototype, "convertVault")
      .mockImplementation(async function (this: NoteToRDFConverter) {
        seen.push((this as unknown as { vault: unknown }).vault);
        return [];
      });
    const loadSpy = jest.spyOn(CacheManager.prototype, "loadOrBuild");

    const loaded = await loadVaultTriples(vaultPath, { useCache: false, vaultAdapter: adapter });
    expect(loaded.mode).toBe("full-parse");
    expect(loaded.cacheManager).toBeUndefined();
    expect(seen).toEqual([adapter]); // the SAME instance — its indexes are shared, not rebuilt
    expect(loadSpy).not.toHaveBeenCalled();
    expect(await fs.pathExists(path.join(vaultPath, ".exocortex"))).toBe(false);
  });

  it(`L2 the cache path returns the caller's CacheManager (same instance) so a later write-through diffs against the state loaded here ${REQ}`, async () => {
    const mine = new CacheManager(vaultPath);
    const loaded = await loadVaultTriples(vaultPath, { useCache: true, cacheManager: mine });
    expect(loaded.mode).toBe("rebuild");
    expect(loaded.cacheManager).toBe(mine);
    const again = await loadVaultTriples(vaultPath, { useCache: true });
    expect(again.mode).toBe("hit");
    expect(again.cacheManager).toBeInstanceOf(CacheManager);
    expect(again.cacheManager).not.toBe(mine);
  });

  it(`L3 a caller-owned CacheManager for ANOTHER vault is refused instead of serving that vault's cache as this one's triples ${REQ}`, async () => {
    const other = path.join(tempDir, "other");
    await fs.ensureDir(other);
    const foreign = new CacheManager(other);
    const loadSpy = jest.spyOn(CacheManager.prototype, "loadOrBuild");
    await expect(
      loadVaultTriples(vaultPath, { useCache: true, cacheManager: foreign }),
    ).rejects.toThrow(/belongs to .*other.*not to vault/);
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it(`L4 writeThroughCache never throws: a rejected refreshAfterWrite becomes a "failed" outcome carrying the message ${REQ}`, async () => {
    const cache = new CacheManager(vaultPath);
    jest
      .spyOn(cache, "refreshAfterWrite")
      .mockRejectedValue(new Error("EACCES (injected)"));
    await expect(writeThroughCache(cache)).resolves.toEqual({
      mode: "failed",
      reparsedFiles: 0,
      reason: "EACCES (injected)",
    });
    const ok = new CacheManager(vaultPath);
    jest.spyOn(ok, "refreshAfterWrite").mockResolvedValue({ mode: "delta", reparsedFiles: 2 });
    await expect(writeThroughCache(ok)).resolves.toEqual({ mode: "delta", reparsedFiles: 2 });
  });

  it(`L5 the notices name the mode and the counts; only the failure line says the command result is unaffected ${REQ}`, () => {
    expect(cacheLoadNotice({ triples: [], cacheHit: true, mode: "hit", reparsedFiles: 0 })).toBe(
      "⚡ triple cache: hit",
    );
    expect(cacheLoadNotice({ triples: [], cacheHit: true, mode: "delta", reparsedFiles: 3 })).toBe(
      "♻️  triple cache: delta (3 file(s) re-parsed)",
    );
    expect(cacheLoadNotice({ triples: [], cacheHit: false, mode: "rebuild", reparsedFiles: 40 })).toBe(
      "🔨 triple cache: rebuild (40 file(s) parsed, cache written)",
    );
    expect(writeThroughNotice({ mode: "delta", reparsedFiles: 2 })).toBe(
      "💾 triple cache: write-through persisted (2 file(s) re-parsed)",
    );
    expect(writeThroughNotice({ mode: "noop", reparsedFiles: 0 })).toBe(
      "💾 triple cache: write-through — nothing changed",
    );
    expect(writeThroughNotice({ mode: "skipped", reparsedFiles: 0, reason: "no cache to refresh" })).toBe(
      "💾 triple cache: write-through skipped (no cache to refresh)",
    );
    expect(writeThroughNotice({ mode: "failed", reparsedFiles: 0, reason: "disk full" })).toMatch(
      /^⚠ triple cache: write-through failed \(disk full\) — command result unaffected/,
    );
  });
});
