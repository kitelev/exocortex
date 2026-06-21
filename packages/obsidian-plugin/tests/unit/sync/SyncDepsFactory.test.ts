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
    // A declared+mounted folder is NOT flagged as undeclared.
    expect(result.mountedNotDeclared).toEqual([]);
  });

  // FINDING-3 (al-ux-findings) — a mount folder on disk with no AssetSpace
  // descriptor (ad-hoc «Add a knowledge pack» by URL) is reported as
  // mounted-but-undeclared so ExoSync can warn the user it won't sync.
  it("flags a mounted folder that has no AssetSpace descriptor (FINDING-3)", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r"); // declared (descriptor as1.md below)
    adapter.mkdirAll("assetspaces/o/adhoc"); // mounted, NO descriptor
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "as1.md" }],
      frontmatters: new Map([
        ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toEqual([spec()]);
    expect(result.mountedNotDeclared).toEqual(["assetspaces/o/adhoc"]);
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

  // ---- Phase C: FileSpace declarations (onto-RFC 18808c73, D18) ----

  const fileSpaceFm = (
    asUid: string,
    source: string,
  ): Record<string, unknown> => ({
    exo__Instance_class: [
      "[[aad8913e-5e9f-4047-879d-93cc46befd52|exo__FileSpace]]",
    ],
    exo__Asset_uid: asUid,
    exo__AssetSpace_source: source,
  });

  it("collects a FileSpace declaration as a file-mode spec", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/files");
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "fs.md" }],
      frontmatters: new Map([
        ["fs.md", fileSpaceFm("uid-fs", "https://github.com/o/files")],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toEqual([
      spec({
        repo: "files",
        repoKey: `o/files#${SYNC_BRANCH}`,
        localPath: "assetspaces/o/files",
        spaceKind: "file",
      }),
    ]);
  });

  it("warns on a FileSpace without a source (mount underivable)", async () => {
    const adapter = new InMemoryAdapter();
    const fm = fileSpaceFm("uid-fs", "");
    delete fm.exo__AssetSpace_source;
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "fs.md" }],
      frontmatters: new Map([["fs.md", fm]]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/skipped FileSpace at fs\.md/);
  });

  it("dual-declared repo (AssetSpace AND FileSpace) deterministically resolves to asset, loudly", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    // Both orders must converge on `asset` (vault iteration order is
    // non-deterministic — advisor H6).
    for (const order of [
      ["as.md", "fs.md"],
      ["fs.md", "as.md"],
    ]) {
      const app = makeApp({
        adapter,
        mdFiles: order.map((path) => ({ path })),
        frontmatters: new Map([
          ["as.md", assetSpaceFm("uid-a", "https://github.com/o/r")],
          ["fs.md", fileSpaceFm("uid-f", "https://github.com/o/r")],
        ]),
      });

      const result = await collectSyncRepoSpecs(app as unknown as App);

      expect(result.specs).toHaveLength(1);
      expect(result.specs[0].spaceKind).toBeUndefined(); // asset wins
      expect(result.warnings.join(" ")).toMatch(/BOTH AssetSpace and FileSpace/);
    }
  });

  it("a single declaration carrying both class UIDs resolves to asset with a warning", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    const app = makeApp({
      adapter,
      mdFiles: [{ path: "both.md" }],
      frontmatters: new Map([
        [
          "both.md",
          {
            exo__Instance_class: [
              "[[73bd00e4-ccc0-4f3f-b20d-c4388c4588fb|exo__AssetSpace]]",
              "[[aad8913e-5e9f-4047-879d-93cc46befd52|exo__FileSpace]]",
            ],
            exo__Asset_uid: "uid-both",
            exo__AssetSpace_source: "https://github.com/o/r",
          },
        ],
      ]),
    });

    const result = await collectSyncRepoSpecs(app as unknown as App);

    expect(result.specs).toHaveLength(1);
    expect(result.specs[0].spaceKind).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/BOTH exo__AssetSpace and exo__FileSpace/);
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

  it("readBinary/writeBinary round-trip byte-exact and atomically (Phase C)", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/files");
    const port = vaultLocalFilesPort(adapter as never, "assetspaces/o/files");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);

    await port.writeBinary!("img/pic.png", png);

    expect(await port.readBinary!("img/pic.png")).toEqual(png);
    const residue = [...adapter.files.keys()].filter((f) =>
      f.includes(".local.tmp"),
    );
    expect(residue).toEqual([]);
  });

  it("writeBinary overwrites an existing file despite mobile rename-onto-existing failing", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/files");
    const port = vaultLocalFilesPort(adapter as never, "assetspaces/o/files");
    await port.writeBinary!("a.png", new Uint8Array([1]));

    await port.writeBinary!("a.png", new Uint8Array([2]));

    expect(await port.readBinary!("a.png")).toEqual(new Uint8Array([2]));
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

  it("passes an EMPTY mount folder for a file-mode spec (Phase C first-sync, advisor C1)", async () => {
    const adapter = new InMemoryAdapter();
    adapter.mkdirAll("assetspaces/o/r");
    const check = vaultMaterializationCheck(base(adapter));

    // Asset mode still vetoes empties (mid-mount ambiguity)…
    expect((await check.check(spec())).fullyMaterialized).toBe(false);
    // …file mode does not: empty folder = legitimate fresh-mount state.
    expect(
      (await check.check(spec({ spaceKind: "file" }))).fullyMaterialized,
    ).toBe(true);
  });
});
