/**
 * SyncDepsFactory unit tests (ExoSync Phase B, RFC 4e4dc453) — spec
 * collection, LocalFilesPort/WatermarkFileIO adapters (atomic-write order),
 * and the degraded mobile D19 materialization gate.
 */

jest.mock("obsidian", () => ({
  ...jest.requireActual<Record<string, unknown>>("obsidian"),
  requestUrl: jest.fn(),
}));

import {
  collectSyncRepoSpecs,
  vaultLocalFilesPort,
  vaultWatermarkFileIO,
  vaultMaterializationCheck,
  SYNC_BRANCH,
} from "../../../src/infrastructure/adapters/SyncDepsFactory";
import type { App } from "obsidian";
import type { SyncRepoSpec } from "exocortex";
import {
  InMemoryAdapter,
  assetSpaceFm,
  makeApp,
} from "./syncTestHelpers";

const spec = (over: Partial<SyncRepoSpec> = {}): SyncRepoSpec => ({
  owner: "o",
  repo: "r",
  branch: SYNC_BRANCH,
  repoKey: `o/r#${SYNC_BRANCH}`,
  localPath: "assetspaces/o/r",
  ...over,
});

describe("collectSyncRepoSpecs", () => {
  it("collects materialized AssetSpaces with GitHub sources", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "as1.md" }],
      frontmatters: new Map([
        ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toEqual([spec()]);
    expect(result.asUidByRepoKey.get(`o/r#${SYNC_BRANCH}`)).toBe("uid-1");
    expect(result.warnings).toEqual([]);
  });

  it("excludes AssetSpaces whose mount folder is absent (VL#4)", async () => {
    const adapter = new InMemoryAdapter();
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "as1.md" }],
      frontmatters: new Map([
        ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toEqual([]);
  });

  it("skips non-GitHub sources with a warning", async () => {
    const adapter = new InMemoryAdapter();
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "as1.md" }],
      frontmatters: new Map([
        ["as1.md", assetSpaceFm("uid-1", "git@github.com:o/r.git")],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("as1.md");
  });

  it("dedupes AssetSpaces sharing one repo and ignores non-AssetSpace files", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "a.md" }, { path: "b.md" }, { path: "plain.md" }],
      frontmatters: new Map<string, Record<string, unknown>>([
        ["a.md", assetSpaceFm("uid-a", "https://github.com/o/r")],
        ["b.md", assetSpaceFm("uid-b", "https://github.com/o/r")],
        ["plain.md", { exo__Asset_uid: "x" }],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toHaveLength(1);
  });
});

describe("vaultLocalFilesPort", () => {
  it("lists recursively with repo-relative paths", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seedFile("assetspaces/o/r/top.md", "t");
    adapter.seedFile("assetspaces/o/r/sub/inner.md", "i");
    const port = vaultLocalFilesPort(
      adapter as never,
      "assetspaces/o/r",
    );

    const listing = await port.list();

    expect(listing.sort()).toEqual(["sub/inner.md", "top.md"]);
  });

  it("returns empty list when the root folder is absent", async () => {
    const adapter = new InMemoryAdapter();
    const port = vaultLocalFilesPort(adapter as never, "assetspaces/o/r");

    expect(await port.list()).toEqual([]);
  });

  it("writes atomically (no .local.tmp residue) creating parent folders", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    const port = vaultLocalFilesPort(adapter as never, "assetspaces/o/r");

    await port.write("new/depth/file.md", "content");

    expect(await adapter.read("assetspaces/o/r/new/depth/file.md")).toBe(
      "content",
    );
    const residue = [...adapter.files.keys()].filter((f) =>
      f.includes(".local.tmp"),
    );
    expect(residue).toEqual([]);
  });

  it("overwrites an existing file despite mobile rename-onto-existing failing", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seedFile("assetspaces/o/r/a.md", "old");
    const port = vaultLocalFilesPort(adapter as never, "assetspaces/o/r");

    await port.write("a.md", "new");

    expect(await adapter.read("assetspaces/o/r/a.md")).toBe("new");
  });

  it("delete is a no-op for absent paths", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    const port = vaultLocalFilesPort(adapter as never, "assetspaces/o/r");

    await expect(port.delete("ghost.md")).resolves.toBeUndefined();
  });
});

describe("vaultWatermarkFileIO", () => {
  it("read returns null for an absent file, round-trips writeAtomic", async () => {
    const adapter = new InMemoryAdapter();
    const io = vaultWatermarkFileIO(
      adapter as never,
      ".obsidian/plugins/exocortex/exosync-watermarks.local.json",
    );

    expect(await io.read()).toBeNull();
    await io.writeAtomic('{"version":1}');
    expect(await io.read()).toBe('{"version":1}');
  });
});

describe("vaultMaterializationCheck", () => {
  const base = (adapter: InMemoryAdapter) => ({
    adapter: adapter as never,
    isSwitchInProgress: () => false,
    getStagingAsUids: async () => new Set<string>(),
    asUidByRepoKey: new Map([["o/r#main", "uid-1"]]),
  });

  it("vetoes every repo while a profile apply is in flight (D11)", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seedFile("assetspaces/o/r/a.md", "x");
    const check = vaultMaterializationCheck({
      ...base(adapter),
      isSwitchInProgress: () => true,
    });

    const verdict = await check.check(spec());

    expect(verdict.fullyMaterialized).toBe(false);
    expect(verdict.reason).toContain("apply in progress");
  });

  it("vetoes a repo whose AssetSpace has an allocated staging dir", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seedFile("assetspaces/o/r/a.md", "x");
    const check = vaultMaterializationCheck({
      ...base(adapter),
      getStagingAsUids: async () => new Set(["uid-1"]),
    });

    const verdict = await check.check(spec());

    expect(verdict.fullyMaterialized).toBe(false);
    expect(verdict.reason).toContain("staging");
  });

  it("vetoes a missing or empty mount folder (mid-mount)", async () => {
    const adapter = new InMemoryAdapter();
    const check = vaultMaterializationCheck(base(adapter));
    expect((await check.check(spec())).fullyMaterialized).toBe(false);

    adapter.mkdirAll("assetspaces/o/r");
    expect((await check.check(spec())).fullyMaterialized).toBe(false);
  });

  it("passes a non-empty mount folder with no apply/staging in flight", async () => {
    const adapter = new InMemoryAdapter();
    adapter.seedFile("assetspaces/o/r/a.md", "x");
    const check = vaultMaterializationCheck(base(adapter));

    expect((await check.check(spec())).fullyMaterialized).toBe(true);
  });
});
