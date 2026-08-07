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
import type { SyncRepoSpec } from "@kitelev/exocortex-core";
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

  /**
   * Parking safety (T3a — AC5 of task d8371554).
   *
   * Moving a mount out of the DERIVED path `assetspaces/<owner>/<repo>` and
   * into `.exocortex/parked/<owner>/<repo>` must be INERT for ExoSync: the
   * AssetSpace must not be enumerated as a sync unit, so its deletion set is
   * never computed and `push` never deletes its files on the remote.
   *
   * The guard locked here is the `adapter.exists` gate in
   * `collectSyncRepoSpecs`, which sits BETWEEN `offer()` and `commit()`. Its
   * sibling — the CLI's `existsSync` gate in `collectVaultSpecs` — is a
   * different function in a different package using a different primitive, so
   * it is locked by its own check in
   * `packages/cli/tests/unit/commands/exosync-parity.test.ts`; green here says
   * nothing about green there.
   *
   * `assetSpaceFm` declares only `exo__AssetSpace_source` — `localPath` is
   * DERIVED by `AssetSpacePathDeriver` inside `classifySpaceDeclaration`, so a
   * dead deriver cannot leave this check green.
   */
  describe("parking is invisible to enumeration @req:4eca4900-fd1f-42d2-a111-46f90a35d6f4", () => {
    const PARKED = ".exocortex/parked/o/r";

    it("excludes a parked AssetSpace while still enumerating a live one", async () => {
      const adapter = new InMemoryAdapter();
      // `o/r` is PARKED: a full copy on disk, outside `assetspaces/`.
      adapter.seedFile(`${PARKED}/assets/a.md`, "---\nexo__Asset_uid: u-a\n---\n");
      // `o/live` stays materialized — it makes the mount walk actually run and
      // doubles as an inline control: exclusion must be selective, not blanket.
      adapter.mkdirAll("assetspaces/o/live");
      // `o/adhoc` is mounted but NOT declared. It gives the FINDING-3 assertion
      // below a POSITIVE expected value: an empty `mountedNotDeclared` would
      // otherwise be indistinguishable from a dead `enumerateMountFolders`.
      adapter.mkdirAll("assetspaces/o/adhoc");
      const app = makeApp({
        adapter,
        mdFiles: [{ path: "parked.md" }, { path: "live.md" }],
        frontmatters: new Map([
          ["parked.md", assetSpaceFm("uid-parked", "https://github.com/o/r")],
          ["live.md", assetSpaceFm("uid-live", "https://github.com/o/live")],
        ]),
      });

      // Precondition — the parked copy really is on disk, just not at the
      // derived path. Without this the assertions below would be vacuous.
      expect(await adapter.exists(PARKED)).toBe(true);
      expect(await adapter.exists("assetspaces/o/r")).toBe(false);

      const result = await collectSyncRepoSpecs(app as unknown as App);

      expect(result.specs).toEqual([
        spec({ repo: "live", repoKey: `o/live#${SYNC_BRANCH}`, localPath: "assetspaces/o/live" }),
      ]);
      // …and the parked copy is not mistaken for an ad-hoc mount either
      // (FINDING-3 walks `assetspaces/` only). The expected value is the REAL
      // ad-hoc mount, not `[]`: that keeps the assertion discriminating — it
      // reds both when the parked copy leaks in AND when the mount walk dies.
      expect(result.mountedNotDeclared).toEqual(["assetspaces/o/adhoc"]);
      expect(result.warnings).toEqual([]);
    });

    it("negative control — the same declaration IS enumerated at the derived path", async () => {
      const adapter = new InMemoryAdapter();
      adapter.seedFile(`${PARKED}/assets/a.md`, "---\nexo__Asset_uid: u-a\n---\n");
      adapter.mkdirAll("assetspaces/o/r"); // now materialized as well
      const app = makeApp({
        adapter,
        mdFiles: [{ path: "as1.md" }],
        frontmatters: new Map([
          ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
        ]),
      });

      const result = await collectSyncRepoSpecs(app as unknown as App);

      expect(result.specs).toEqual([spec()]);
    });
  });

  /**
   * Mount-walk resilience — `enumerateMountFolders` carries TWO guards for the
   * single contract stated in its docstring: «a detection helper must never
   * throw into the sync path».
   *
   *   B2 — `if (!(await adapter.exists(root))) return out;`   (absent-root fast path)
   *   C  — the outer `catch` that swallows any listing failure
   *
   * Measured on a hardlink copy of origin/main@0cc49ef2, this suite:
   *
   *   | mutation        | red |
   *   |-----------------|-----|
   *   | B2 alone        |  0  |
   *   | C  alone        |  0  |
   *   | B2 + C together |  3  |
   *
   * ⛔ Zero-red-alone means the contract is held TWICE, NOT that it is
   * untested — neither guard may be deleted as «uncovered»
   * (integration-test-revert-verify §ДУБЛИРУЮЩИЕ гварды). B2 is a pure fast
   * path: C covers the very same input, so B2 has no isolable behaviour and is
   * locked only as a PAIR. C, by contrast, IS isolable — a root that exists
   * but cannot be listed reaches C and nothing else.
   *
   * Until these two checks the pair was locked only INCIDENTALLY, by three
   * tests whose subject is something else entirely («skips non-GitHub
   * sources», «warns on a FileSpace without a source», «excludes AssetSpaces
   * whose mount folder is absent») — each green merely because its fixture
   * happens to omit `assetspaces/`. The first fixture to add that folder would
   * have unlocked the pair silently.
   */
  describe("the FINDING-3 mount walk never throws into the sync path", () => {
    /** Root present but unlistable (EACCES / iOS sandbox) — reaches only C. */
    class UnreadableRootAdapter extends InMemoryAdapter {
      override async list(
        dir: string,
      ): Promise<{ files: string[]; folders: string[] }> {
        if (dir === "assetspaces") throw new Error("EACCES: permission denied");
        return super.list(dir);
      }
    }

    it("isolates the outer swallow — an unlistable mount root degrades to []", async () => {
      const adapter = new UnreadableRootAdapter();
      adapter.mkdirAll("assetspaces/o/r");
      const app = makeApp({
        adapter,
        mdFiles: [{ path: "as1.md" }],
        frontmatters: new Map([
          ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
        ]),
      });

      // Preconditions — the root EXISTS (so the B2 fast path cannot fire) and
      // listing it really does fail. Without both, the assertion is vacuous.
      expect(await adapter.exists("assetspaces")).toBe(true);
      await expect(adapter.list("assetspaces")).rejects.toThrow(/EACCES/);

      const result = await collectSyncRepoSpecs(app as unknown as App);

      // Positive expected value: the sync unit is STILL enumerated, so the
      // walk failure is contained rather than fatal. An empty `specs` here
      // would let the check pass for the wrong reason.
      expect(result.specs).toEqual([spec()]);
      expect(result.mountedNotDeclared).toEqual([]);
    });

    it("pair axis for the absent-root fast path — no `assetspaces` folder at all", async () => {
      const adapter = new InMemoryAdapter();
      const app = makeApp({
        adapter,
        mdFiles: [{ path: "as1.md" }],
        frontmatters: new Map([
          ["as1.md", assetSpaceFm("uid-1", "https://github.com/o/r")],
        ]),
      });

      expect(await adapter.exists("assetspaces")).toBe(false);

      // The discriminator is the ABSENCE of a throw: with both guards gone the
      // adapter's ENOENT escapes `collectSyncRepoSpecs` and reds this await.
      const result = await collectSyncRepoSpecs(app as unknown as App);

      expect(result.mountedNotDeclared).toEqual([]);
      expect(result.specs).toEqual([]);
    });
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
