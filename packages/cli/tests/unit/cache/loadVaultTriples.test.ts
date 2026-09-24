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
    // #7a84b9f0 — the full parse now calls `convertVaultWithValidation`
    // directly (the very method `convertVault` delegated to) so that
    // `skippedFiles` is no longer discarded by the narrower signature. The
    // guarantee this axis locks is unchanged — ONE conversion, through the
    // CALLER's adapter — and the spy is now on the method that observes BOTH
    // entry points, since `convertVault` still routes through it.
    jest
      .spyOn(NoteToRDFConverter.prototype, "convertVaultWithValidation")
      .mockImplementation(async function (this: NoteToRDFConverter) {
        seen.push((this as unknown as { vault: unknown }).vault);
        return {
          triples: [],
          skippedFiles: [],
          summary: { total: 0, indexed: 0, skipped: 0 },
          fileSpaces: { prefixes: [], declarationPaths: [], warnings: [] },
        };
      });
    const loadSpy = jest.spyOn(CacheManager.prototype, "loadOrBuild");

    const loaded = await loadVaultTriples(vaultPath, { useCache: false, vaultAdapter: adapter });
    expect(loaded.mode).toBe("full-parse");
    expect(loaded.cacheManager).toBeUndefined();
    // The SAME instance (identity, not deep equality — a fresh adapter for the
    // same root is deep-equal and would pass a toEqual) — its indexes are
    // shared, not rebuilt.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(adapter);
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
    expect(
      cacheLoadNotice({
        triples: [],
        cacheHit: true,
        mode: "hit",
        reparsedFiles: 0,
        explicitCount: 0,
        zeroTriplePaths: [],
      }),
    ).toBe("⚡ triple cache: hit");
    expect(
      cacheLoadNotice({
        triples: [],
        cacheHit: true,
        mode: "delta",
        reparsedFiles: 3,
        explicitCount: 0,
        zeroTriplePaths: [],
      }),
    ).toBe("♻️  triple cache: delta (3 file(s) re-parsed)");
    expect(
      cacheLoadNotice({
        triples: [],
        cacheHit: false,
        mode: "rebuild",
        reparsedFiles: 40,
        explicitCount: 0,
        zeroTriplePaths: [],
      }),
    ).toBe("🔨 triple cache: rebuild (40 file(s) parsed, cache written)");
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

// ---------------------------------------------------------------------------
// #4272 — the `zeroTriplePaths` population handed to the index-backed adapter.
// ---------------------------------------------------------------------------
const REQ_4272 = "@req:5ab3d237-cae9-498c-925c-6951b9c9c5db";

describe(`loadVaultTriples — zeroTriplePaths population (#4272) ${REQ_4272}`, () => {
  let tempDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lvt-4272-"));
    vaultPath = path.join(tempDir, "vault");
    await fs.ensureDir(path.join(vaultPath, "a"));
    // a committed asset (own triples)
    await fs.writeFile(
      path.join(vaultPath, "a", "42720000-0000-4000-8000-000000000001.md"),
      "---\nexo__Asset_uid: 42720000-0000-4000-8000-000000000001\nexo__Asset_label: Committed\nexo__Instance_class: ems__Task\n---\n",
      "utf-8",
    );
    // an invariant-skipped asset (present but EMPTY optional → the loader commits nothing)
    await fs.writeFile(
      path.join(vaultPath, "a", "42720000-0000-4000-8000-000000000002.md"),
      "---\nexo__Asset_uid: 42720000-0000-4000-8000-000000000002\nexo__Asset_label: Skipped\nexo__Instance_class: ems__Task\nems__Effort_parent:\n---\n",
      "utf-8",
    );
    // a frontmatter-less note: walked, converted, ZERO triples committed
    await fs.writeFile(
      path.join(vaultPath, "a", "plain-note.md"),
      "Just prose, no frontmatter.\n",
      "utf-8",
    );
    // a FileSpace mount (declaration OUTSIDE its mount, mount derived from the
    // source URL → assetspaces/owner/files-repo/): a well-formed asset inside
    // it is EXCLUDED by the walk before validation — zero triples committed,
    // exactly like the cache entry it gets on the cache paths.
    await fs.ensureDir(path.join(vaultPath, "spaces"));
    await fs.writeFile(
      path.join(vaultPath, "spaces", "files.md"),
      '---\nexo__Asset_uid: 42720000-0000-4000-8000-000000000003\nexo__Instance_class: "[[aad8913e-5e9f-4047-879d-93cc46befd52|exo__FileSpace]]"\nexo__Asset_label: Attachments\nexo__AssetSpace_source: https://github.com/owner/files-repo\n---\n',
      "utf-8",
    );
    await fs.ensureDir(
      path.join(vaultPath, "assetspaces", "owner", "files-repo"),
    );
    await fs.writeFile(
      path.join(vaultPath, "assetspaces", "owner", "files-repo", "blob.md"),
      "---\nexo__Asset_uid: 42720000-0000-4000-8000-000000000004\nexo__Asset_label: Blob\nexo__Instance_class: ems__Task\n---\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.remove(tempDir);
  });

  it(`U11 full parse names every walked file that committed no triples — the invariant-skipped asset, the frontmatter-less note AND the FileSpace-excluded asset — exactly as the cache paths do (rebuild, then hit) ${REQ_4272}`, async () => {
    const expected = [
      "a/42720000-0000-4000-8000-000000000002.md",
      "a/plain-note.md",
      "assetspaces/owner/files-repo/blob.md",
    ];
    const full = await loadVaultTriples(vaultPath, { useCache: false });
    expect(full.mode).toBe("full-parse");
    expect([...full.zeroTriplePaths].sort()).toEqual(expected);
    expect(full.explicitCount).toBe(full.triples.length);
    expect(full.explicitCount).toBeGreaterThan(0);

    const rebuild = await loadVaultTriples(vaultPath, { useCache: true });
    expect(rebuild.mode).toBe("rebuild");
    expect([...rebuild.zeroTriplePaths].sort()).toEqual(expected);
    expect(rebuild.explicitCount).toBe(full.explicitCount);

    const hit = await loadVaultTriples(vaultPath, { useCache: true });
    expect(hit.mode).toBe("hit");
    expect([...hit.zeroTriplePaths].sort()).toEqual(expected);
    expect(hit.explicitCount).toBe(full.explicitCount);
  });
});
