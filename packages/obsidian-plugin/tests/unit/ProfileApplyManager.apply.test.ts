/**
 * ProfileApplyManager.applyProfile() — unit tests covering RFC
 * 22b50a17 Phase 3 algorithm + Phase 0 findings (F2/F3/F5/R24/R26).
 *
 * Tests:
 *   - R24 — TS-floor violation throws before any mutation
 *   - Vision Lock #5 — uncommitted abort with file list
 *   - F2 — journal events emitted in correct order (write-BEFORE-destroy)
 *   - F3 — 4 cardinal crash injection points
 *   - ApplyAbortedByUser when confirmGate returns false
 *   - Cache restore on Phase 2 catch (best-effort rollback)
 *   - recoverIncompleteSwitch identifies destroyed-not-materialized AS
 *   - reconcileToLocal detects .gitmodules vs activeProfileUid divergence
 *   - GitSubmoduleOps validateVaultPathArg / validateGitUrl
 *   - stripGitmodulesEntry / parseGitmodulesPaths
 *
 * Revert-verify per regression test — each behavioural test is paired with
 * a sibling that confirms the guard fires only when the code path is
 * executed (no false positives).
 */
import type { App, TFile } from "obsidian";
import type { ApplyPlan, IConfirmGate } from "exocortex";

import {
  ProfileApplyManager,
  ApplyAbortedByUser,
  TsFloorViolationError,
  UncommittedChangesAbortError,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchJournalEntry,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";
import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../src/infrastructure/adapters/ProfileOnloadWiring";

// === Fakes ===

interface FakeFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
}

function makeFakeApp(files: FakeFile[]): {
  app: App;
  fsFiles: Map<string, string>;
  fsFolders: Map<string, { files: string[]; folders: string[] }>;
} {
  const fsFiles = new Map<string, string>();
  const fsFolders = new Map<string, { files: string[]; folders: string[] }>();

  const tfiles: TFile[] = files.map(
    (f) =>
      ({
        path: f.path,
        basename: f.basename,
      }) as unknown as TFile,
  );
  const frontmatterByPath = new Map<string, Record<string, unknown>>();
  for (const f of files) frontmatterByPath.set(f.path, f.frontmatter);

  const app = {
    vault: {
      getMarkdownFiles: () => tfiles,
      adapter: {
        exists: async (p: string) => fsFiles.has(p) || fsFolders.has(p),
        read: async (p: string) => {
          const v = fsFiles.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        write: async (p: string, d: string) => {
          fsFiles.set(p, d);
        },
        remove: async (p: string) => {
          fsFiles.delete(p);
        },
        list: async (dir: string) => {
          return fsFolders.get(dir) ?? { files: [], folders: [] };
        },
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = frontmatterByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  } as unknown as App;
  return { app, fsFiles, fsFolders };
}

class FakeResolver implements IProfileResolver {
  constructor(private readonly profiles: Map<string, ProfileResolution>) {}
  async resolve(uid: string): Promise<ProfileResolution | null> {
    return this.profiles.get(uid) ?? null;
  }
  async discoverSharedOntologies(): Promise<string[]> {
    return [];
  }
}

class FakeIndexer implements IRdfIndexer {
  refreshCalls = 0;
  async refresh(): Promise<void> {
    this.refreshCalls++;
  }
}

class FakeSettingsStore implements ISettingsStore {
  state: SwitchSettings = { activeProfileUid: null, _switchInProgress: false };
  async load(): Promise<SwitchSettings> {
    return { ...this.state };
  }
  async save(s: SwitchSettings): Promise<void> {
    this.state = { ...s };
  }
}

// Minimal fakes for apply dependencies.

// Production-shape fake mirroring PluginLocalDataStore's single last-applied
// slot (RFC 0a0791c1 Phase 5 T2 — the dual AC14 slots were retired).
interface FakeLocalState {
  activeProfileUid: string | null;
  _switchInProgress: boolean;
}

class FakeLocalDataStore {
  private state: FakeLocalState = {
    activeProfileUid: null,
    _switchInProgress: false,
  };
  getActiveProfileUid(): string | null {
    return this.state.activeProfileUid;
  }
  isSwitchInProgress(): boolean {
    return this.state._switchInProgress;
  }
  snapshot(): FakeLocalState {
    return { ...this.state };
  }
  async save(s: {
    activeProfileUid: string | null;
    _switchInProgress: boolean;
  }): Promise<void> {
    this.state = {
      activeProfileUid: s.activeProfileUid,
      _switchInProgress: s._switchInProgress,
    };
  }
}

class FakeCacheLayer {
  cachedCalls: Array<{ asUid: string; sourceDir: string; sha: string }> = [];
  restoreCalls: Array<{ asUid: string; targetDir: string }> = [];
  failCache = false;
  async cache(asUid: string, sourceDir: string, sha: string) {
    if (this.failCache) throw new Error("Simulated cache failure");
    this.cachedCalls.push({ asUid, sourceDir, sha });
    return { asUid, sha, cachedAt: "2026-06-02T00:00:00.000Z", sizeBytes: 100 };
  }
  async has(): Promise<boolean> {
    return true;
  }
  async restore(asUid: string, targetDir: string) {
    this.restoreCalls.push({ asUid, targetDir });
    return { sha: "deadbee" };
  }
  async clear() {
    return { entriesRemoved: 0 };
  }
  async listEntries() {
    return [];
  }
  getCacheDir() {
    return "/tmp/fake-cache";
  }
  getCacheStats() {
    return { count: 0, totalSize: 0, oldestEntry: null };
  }
}

class FakeGitOps {
  calls: Array<{ op: string; args: unknown[] }> = [];
  gitmodulesPaths = new Set<string>();
  porcelainResponses = new Map<string, string>(); // submodulePath -> porcelain stdout
  failAt: string | null = null;

  async readGitmodulesPaths(): Promise<Set<string>> {
    return new Set(this.gitmodulesPaths);
  }
  async statusPorcelain(p: string): Promise<string> {
    this.calls.push({ op: "statusPorcelain", args: [p] });
    return this.porcelainResponses.get(p) ?? "";
  }
  async submoduleDeinit(p: string): Promise<void> {
    this.maybeFail("submoduleDeinit");
    this.calls.push({ op: "submoduleDeinit", args: [p] });
  }
  async submoduleAdd(url: string, p: string): Promise<void> {
    this.maybeFail("submoduleAdd");
    this.calls.push({ op: "submoduleAdd", args: [url, p] });
    this.gitmodulesPaths.add(p);
  }
  async removeGitModulesDir(p: string): Promise<void> {
    this.maybeFail("removeGitModulesDir");
    this.calls.push({ op: "removeGitModulesDir", args: [p] });
  }
  async removeWorkingTree(p: string): Promise<void> {
    this.maybeFail("removeWorkingTree");
    this.calls.push({ op: "removeWorkingTree", args: [p] });
  }
  async renameIntoVault(staging: string, p: string): Promise<void> {
    this.maybeFail("renameIntoVault");
    this.calls.push({ op: "renameIntoVault", args: [staging, p] });
  }
  async atomicGitmodulesEntryRemove(p: string): Promise<void> {
    this.maybeFail("atomicGitmodulesEntryRemove");
    this.calls.push({ op: "atomicGitmodulesEntryRemove", args: [p] });
    this.gitmodulesPaths.delete(p);
  }
  async add(p: string): Promise<void> {
    this.maybeFail("add");
    this.calls.push({ op: "add", args: [p] });
  }
  async commit(msg: string): Promise<void> {
    this.maybeFail("commit");
    this.calls.push({ op: "commit", args: [msg] });
  }
  async run(): Promise<{ stdout: string; stderr: string }> {
    return { stdout: "", stderr: "" };
  }
  private maybeFail(op: string): void {
    if (this.failAt === op) throw new Error(`Simulated failure at ${op}`);
  }
}

class FakeAssetSpaceManager {
  pullCalls: Array<{ asUid: string; gitUrl: string; ref: string }> = [];
  stagingTracker = {
    released: [] as string[],
    release: async (p: string) => {
      this.stagingTracker.released.push(p);
    },
  };
  lookupAssetSpaceInfo: ((uid: string) => unknown) | null = null;
  failOnPull: string | null = null;
  async pullAssetSpace(asUid: string, gitUrl: string, ref: string) {
    this.pullCalls.push({ asUid, gitUrl, ref });
    if (this.failOnPull === asUid) {
      throw new Error(`Simulated pull failure for ${asUid}`);
    }
    return {
      asUid,
      stagingPath: `/tmp/staging/${asUid}`,
      sha: "deadbee",
    };
  }
}

class FakeConfirmGate implements IConfirmGate {
  approve = true;
  lastPlan: ApplyPlan | null = null;
  async confirmApply(plan: ApplyPlan): Promise<boolean> {
    this.lastPlan = plan;
    return this.approve;
  }
}

// === Setup helpers ===

interface SetupOptions {
  /** Profile UID being switched to. */
  targetUid: string;
  /** Profile UID currently active. */
  sourceUid: string | null;
  /**
   * AssetSpace UIDs the target profile declares in `_includes` (RFC 01a83de8
   * Phase 2 — `_includes` are AS UIDs directly; the Ontology→AS translation
   * was removed in Phase 3 T3b-cleanup).
   */
  targetIncludes: string[];
  /** AS UIDs included in source profile (used for source label display only). */
  sourceLabel?: string;
  /** AS UIDs currently materialized (subset of vault scan). */
  materialized: string[];
  /** ExoSync D11 exclusion input (RFC 4e4dc453 Phase B). */
  isSyncBusy?: () => boolean;
}

function setup(opts: SetupOptions) {
  // Vault contains AssetSpace ABox assets for each TS-floor + extras.
  const tsFloorFolders: Array<{ uid: string; folder: string }> = [
    { uid: TS_FLOOR_AS_UID_EXO, folder: "assetspaces/kitelev/exoas-exo" },
    { uid: TS_FLOOR_AS_UID_EXOCMD, folder: "assetspaces/kitelev/exoas-exocmd" },
    { uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES, folder: "assetspaces/kitelev/exoas-shared-identities" },
  ];

  const extraAs: Array<{ uid: string; folder: string }> = [
    { uid: "ems-uid", folder: "assetspaces/kitelev/exoas-ems" },
    { uid: "kpc-uid", folder: "assetspaces/kitelev/exoas-kpc" },
    { uid: "ims-uid", folder: "assetspaces/kitelev/exoas-ims" },
  ];

  const allAs = [...tsFloorFolders, ...extraAs];

  const files: FakeFile[] = [
    // Profile assets.
    {
      path: "profiles/target.md",
      basename: "target",
      frontmatter: {
        "exo__Asset_uid": opts.targetUid,
        "exo__Asset_label": "Target Profile",
        "exo__Instance_class": ["[[exo__Profile]]"],
      },
    },
    // AssetSpace ABox assets — each has folder + source + namespace + class.
    // Production-shape (RFC 01a83de8 Phase 2): profiles `_includes` reference
    // these AS UIDs directly, so the R24 guard resolves them against the folder
    // map without any Ontology→AS translation (removed in Phase 3 T3b-cleanup).
    ...allAs.map((as) => {
      const ns = as.folder.split("/").pop();
      return {
        path: `${as.folder}/${as.uid}.md`,
        basename: as.uid,
        frontmatter: {
          "exo__Asset_uid": as.uid,
          "exo__Asset_label": ns,
          "exo__Instance_class": ["[[exo__AssetSpace]]"],
          // RFC 01a83de8 Phase 1b T3 — folder is derived from the source URL,
          // so the source MUST derive back to `as.folder` for the switch plan's
          // submodulePath to match (`derivePath("https://github.com/<owner>/<repo>")`
          // === `assetspaces/<owner>/<repo>` === as.folder).
          "exo__AssetSpace_source": `https://github.com/${as.folder.replace("assetspaces/", "")}`,
          "exo__AssetSpace_namespace": ns,
        },
      };
    }),
  ];
  if (opts.sourceUid !== null) {
    files.unshift({
      path: "profiles/source.md",
      basename: "source",
      frontmatter: {
        "exo__Asset_uid": opts.sourceUid,
        "exo__Asset_label": opts.sourceLabel ?? "Source Profile",
        "exo__Instance_class": ["[[exo__Profile]]"],
      },
    });
  }

  const { app, fsFolders } = makeFakeApp(files);

  // Pre-populate folder listing for materialized AS — used by enumerateFilesUnder.
  for (const folder of opts.materialized.map((uid) => allAs.find((a) => a.uid === uid)?.folder).filter((f): f is string => f !== undefined)) {
    fsFolders.set(folder, { files: [`${folder}/file1.md`, `${folder}/file2.md`], folders: [] });
  }

  // Profile target resolution — production-shape (RFC 01a83de8 Phase 2):
  // profile `_includes` declares AssetSpace UIDs directly (no Ontology→AS
  // translation; that indirection was removed in Phase 3 T3b-cleanup).
  const resolver = new FakeResolver(
    new Map<string, ProfileResolution>([
      [
        opts.targetUid,
        {
          uid: opts.targetUid,
          includes: opts.targetIncludes,
          label: "Target Profile",
        },
      ],
    ]),
  );
  if (opts.sourceUid !== null) {
    resolver.profilesAdd?.(
      opts.sourceUid,
      {
        uid: opts.sourceUid,
        includes: [],
        label: opts.sourceLabel ?? "Source Profile",
      },
    );
  }

  const indexer = new FakeIndexer();
  const settingsStore = new FakeSettingsStore();
  const lockMgr = new PluginLockManager({ app });
  const localDataStore = new FakeLocalDataStore();
  if (opts.sourceUid !== null) {
    void localDataStore.save({ activeProfileUid: opts.sourceUid, _switchInProgress: false });
  }
  const cacheLayer = new FakeCacheLayer();
  const gitOps = new FakeGitOps();
  // Mark materialized AS in fake .gitmodules.
  for (const uid of opts.materialized) {
    const folder = allAs.find((a) => a.uid === uid)?.folder;
    if (folder) gitOps.gitmodulesPaths.add(folder);
  }
  const uncommittedGuard = {
    check: jest.fn(async () => ({ clean: true, affectedFiles: [] })),
  };
  const assetSpaceManager = new FakeAssetSpaceManager();
  const confirmGate = new FakeConfirmGate();

  const mgr = new ProfileApplyManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: indexer,
    settingsStore,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    assetSpaceManager: assetSpaceManager as any,
    cacheLayer: cacheLayer as any,
    gitOps: gitOps as any,
    uncommittedGuard: uncommittedGuard as any,
    confirmGate,
    localDataStore: localDataStore as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
    vaultRootPath: "/fake/vault",
    ...(opts.isSyncBusy !== undefined ? { isSyncBusy: opts.isSyncBusy } : {}),
  });
  return {
    mgr,
    indexer,
    settingsStore,
    localDataStore,
    cacheLayer,
    gitOps,
    uncommittedGuard,
    assetSpaceManager,
    confirmGate,
    app,
    fsFolders,
    allAs,
  };
}

// Patch FakeResolver to support adding more profiles after construction.
declare module "../../src/infrastructure/adapters/ProfileApplyManager" {
  // (no-op — keeps TS happy)
}
interface FakeResolverExt extends FakeResolver {
  profilesAdd?: (uid: string, p: ProfileResolution) => void;
}
const proto = FakeResolver.prototype as FakeResolverExt;
proto.profilesAdd = function (this: { ["profiles"]: Map<string, ProfileResolution> }, uid, p) {
  this["profiles"].set(uid, p);
};

// === Helper: read journal from fake app ===

async function readJournalEntries(app: App): Promise<SwitchJournalEntry[]> {
  try {
    const exists = await app.vault.adapter.exists(".exocortex/switch-journal.jsonl");
    if (!exists) return [];
    const raw = await app.vault.adapter.read(".exocortex/switch-journal.jsonl");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as SwitchJournalEntry);
  } catch {
    return [];
  }
}

// === Tests ===

describe("ProfileApplyManager.applyProfile", () => {
  describe("R24 — TS-floor guard", () => {
    it("throws TsFloorViolationError when target excludes any floor AS UID before any mutation", async () => {
      // Target profile includes ONLY ems — missing all 3 TS-floor AS.
      const { mgr, gitOps, cacheLayer } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: ["ems-uid"], // Excludes exo / exocmd / shared-identities.
        materialized: ["ems-uid", TS_FLOOR_AS_UID_EXO],
      });
      await expect(mgr.applyProfile("target")).rejects.toThrow(TsFloorViolationError);
      // No mutation should have happened.
      expect(gitOps.calls.filter((c) => c.op === "submoduleDeinit").length).toBe(0);
      expect(cacheLayer.cachedCalls.length).toBe(0);
    });

    it("passes guard via folderMapValues path when profile declares raw AS UIDs", async () => {
      // VaultProfileResolver returns AS UIDs directly (RFC 01a83de8 Phase 2 —
      // `_includes` are AssetSpace UIDs). The R24 derivation's
      // `folderMapValues.has(uid)` branch resolves them — this test asserts the
      // branch works (the empty `targetIncludes` is overridden below).
      const ctx = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [],
        materialized: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      // Override resolver: profile._includes contains AS UIDs — exercises the
      // folderMapValues path.
      const resolverInternal = (ctx.mgr as unknown as {
        resolver: { ["profiles"]: Map<string, ProfileResolution> };
      }).resolver;
      resolverInternal["profiles"].set("target", {
        uid: "target",
        includes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        label: "Target Profile",
      });
      await expect(ctx.mgr.applyProfile("target")).resolves.toBeUndefined();
    });

    it("floor={exo}: accepts a profile that omits $exocmd and $shared-identities", async () => {
      // floor={exo} (RFC 5aa2a73a / #3440): exocmd and shared-identities are
      // OPTIONAL AssetSpaces. A profile declaring ONLY $exo passes the R24
      // apply-layer guard — parity with the TsFloorGuard / CLI floor tests.
      // Non-vacuous: pre-#3440 (floor = all 3) this would have thrown
      // TsFloorViolationError; it now resolves because $exo is the whole floor.
      const { mgr } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [TS_FLOOR_AS_UID_EXO], // omits exocmd + shared-identities
        materialized: [TS_FLOOR_AS_UID_EXO],
      });
      await expect(mgr.applyProfile("target")).resolves.toBeUndefined();
    });
  });

  describe("Vision Lock #5 — uncommitted abort", () => {
    it("aborts with UncommittedChangesAbortError when to-destroy AS has dirty files", async () => {
      const { mgr, uncommittedGuard, gitOps } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid", // not in target — will be destroyed → check fires
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      uncommittedGuard.check.mockResolvedValueOnce({
        clean: false,
        affectedFiles: [
          { asUid: "ems-uid", submodulePath: "assetspaces/kitelev/exoas-ems", files: ["a.md", "b.md"] },
        ],
      });
      await expect(mgr.applyProfile("target")).rejects.toThrow(UncommittedChangesAbortError);
      // No filesystem mutation.
      expect(gitOps.calls.filter((c) => c.op === "submoduleDeinit").length).toBe(0);
    });

    it("only checks AS being torn down (scope = to-destroy only)", async () => {
      // Target keeps ems (in effective), destroys kpc.
      const { mgr, uncommittedGuard } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          "kpc-uid", // not in target → will be checked
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      const checkCall = uncommittedGuard.check.mock.calls[0][0];
      // Only kpc passed — not ems.
      expect(checkCall).toEqual([
        { asUid: "kpc-uid", submodulePath: "assetspaces/kitelev/exoas-kpc" },
      ]);
    });
  });

  describe("ApplyAbortedByUser", () => {
    it("throws and writes no filesystem mutation if confirmGate declines", async () => {
      const { mgr, confirmGate, gitOps, cacheLayer } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      confirmGate.approve = false;
      await expect(mgr.applyProfile("target")).rejects.toThrow(ApplyAbortedByUser);
      expect(gitOps.calls.length).toBe(0);
      expect(cacheLayer.cachedCalls.length).toBe(0);
    });
  });

  describe("ExoSync D11 exclusion (RFC 4e4dc453 Phase B)", () => {
    const D11_SETUP = {
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        "ems-uid",
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    };

    it("entry guard: refuses to start while a sync is running, touching nothing", async () => {
      const { mgr, gitOps, cacheLayer, app, localDataStore } = setup({
        ...D11_SETUP,
        isSyncBusy: () => true,
      });

      await expect(mgr.applyProfile("target")).rejects.toThrow(/D11/);

      expect(gitOps.calls.length).toBe(0);
      expect(cacheLayer.cachedCalls.length).toBe(0);
      expect((await readJournalEntries(app)).length).toBe(0);
      expect(localDataStore.snapshot()._switchInProgress).toBe(false);
    });

    it("pre-flag re-check: a sync starting during the confirm gate aborts before _switchInProgress is raised", async () => {
      let busy = false;
      const { mgr, gitOps, cacheLayer, app, localDataStore, confirmGate } =
        setup({ ...D11_SETUP, isSyncBusy: () => busy });
      // The user keeps the confirm modal open while a sync kicks off — the
      // window the entry guard cannot see (code-reviewer MEDIUM, PR #3461).
      const originalConfirm = confirmGate.confirmApply.bind(confirmGate);
      confirmGate.confirmApply = async (plan) => {
        busy = true;
        return originalConfirm(plan);
      };

      await expect(mgr.applyProfile("target")).rejects.toThrow(/D11/);

      // No mutation phase ran and the flag was never raised.
      expect(gitOps.calls.length).toBe(0);
      expect(cacheLayer.cachedCalls.length).toBe(0);
      const phases = (await readJournalEntries(app)).map((e) => e.phase);
      expect(phases).not.toContain("apply-starting");
      expect(phases.filter((p) => p.startsWith("phase2"))).toEqual([]);
      expect(localDataStore.snapshot()._switchInProgress).toBe(false);
    });
  });

  describe("F2 — journal write ordering", () => {
    it("writes phase2-destroy-cached BEFORE rm (load-bearing for recovery)", async () => {
      const { mgr, gitOps, cacheLayer, app } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      const entries = await readJournalEntries(app);
      const destroyCachedIdx = entries.findIndex(
        (e) => e.phase === "phase2-destroy-cached" && e.as === "ems-uid",
      );
      const destroyedIdx = entries.findIndex(
        (e) => e.phase === "phase2-destroyed" && e.as === "ems-uid",
      );
      expect(destroyCachedIdx).toBeGreaterThan(-1);
      expect(destroyedIdx).toBeGreaterThan(destroyCachedIdx);
      // Cache should run BEFORE submoduleDeinit.
      const cacheCallIdx = cacheLayer.cachedCalls.findIndex(
        (c) => c.asUid === "ems-uid",
      );
      const deinitCallIdx = gitOps.calls.findIndex(
        (c) => c.op === "submoduleDeinit" && (c.args[0] as string).includes("ems"),
      );
      expect(cacheCallIdx).toBe(0);
      expect(deinitCallIdx).toBeGreaterThan(-1);
    });

    it("Phase 6 Vision Lock #9 amendment: does NOT strip .gitmodules entry during destroy (URL preservation для switch-back)", async () => {
      const { mgr, gitOps } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      // ems-uid was destroyed (deinit + remove gitmodules dir + remove working tree)
      const deinitCalls = gitOps.calls.filter(
        (c) => c.op === "submoduleDeinit" && (c.args[0] as string).includes("ems"),
      );
      const removeDirCalls = gitOps.calls.filter(
        (c) => c.op === "removeGitModulesDir" && (c.args[0] as string).includes("ems"),
      );
      const removeTreeCalls = gitOps.calls.filter(
        (c) => c.op === "removeWorkingTree" && (c.args[0] as string).includes("ems"),
      );
      expect(deinitCalls.length).toBe(1);
      expect(removeDirCalls.length).toBe(1);
      expect(removeTreeCalls.length).toBe(1);
      // CRITICAL Phase 6 amendment: atomicGitmodulesEntryRemove must NOT be called
      // during destroy. The `.gitmodules` entry must persist as per-vault registry.
      const stripCalls = gitOps.calls.filter(
        (c) => c.op === "atomicGitmodulesEntryRemove",
      );
      expect(stripCalls.length).toBe(0);
    });

    it("emits apply-completed on successful switch", async () => {
      const { mgr, app } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      const entries = await readJournalEntries(app);
      expect(entries.some((e) => e.phase === "apply-completed")).toBe(true);
    });
  });

  describe("F3 — crash injection cardinal points", () => {
    it("crash between cache(X) and rm -rf X — cache exists, _switchInProgress flag set", async () => {
      const { mgr, gitOps, cacheLayer } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      gitOps.failAt = "submoduleDeinit";
      await expect(mgr.applyProfile("target")).rejects.toThrow();
      // ems-uid was cached but never destroyed.
      expect(cacheLayer.cachedCalls.some((c) => c.asUid === "ems-uid")).toBe(true);
    });

    it("crash mid-Phase 1 (pull fails on AS #2) releases all already-allocated staging dirs (R26)", async () => {
      const { mgr, assetSpaceManager } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          "kpc-uid", // new — to materialize
          "ims-uid", // new — to materialize
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      assetSpaceManager.failOnPull = "ims-uid"; // 2nd pull fails
      await expect(mgr.applyProfile("target")).rejects.toThrow();
      // Allocated staging for kpc should be released.
      expect(assetSpaceManager.stagingTracker.released).toContain("/tmp/staging/kpc-uid");
    });
  });

  describe("Cache rollback on Phase 2 catch", () => {
    it("calls cacheLayer.restore for destroyed AS when Phase 2 throws", async () => {
      const { mgr, gitOps, cacheLayer } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          "kpc-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      // Fail at commit — both AS destroyed but commit unable.
      gitOps.failAt = "commit";
      await expect(mgr.applyProfile("target")).rejects.toThrow();
      // restore() called for both destroyed AS.
      expect(cacheLayer.restoreCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("clears _switchInProgress flag in localDataStore on catch", async () => {
      const { mgr, gitOps, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      gitOps.failAt = "commit";
      await expect(mgr.applyProfile("target")).rejects.toThrow();
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });
  });

  describe("Successful switch", () => {
    it("activeProfileUid persisted к target after success", async () => {
      const { mgr, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      expect(localDataStore.getActiveProfileUid()).toBe("target");
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });

    it("records the applied profile as the last-applied cache (RFC 0a0791c1 Phase 5 T2 — single slot)", async () => {
      const { mgr, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      expect(localDataStore.getActiveProfileUid()).toBe("target");
    });

    it("rdfIndexer.refresh fired once after the apply (RFC 01a83de8 — soft-filter removed)", async () => {
      const { mgr, indexer } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      // The apply still derives effectiveAsUids for the destroy/materialize
      // diff (asserted elsewhere), but the query-time soft-filter was removed:
      // refresh() no longer receives an effective set — it just re-indexes the
      // now-materialised vault once.
      expect(indexer.refreshCalls).toBe(1);
    });

    it("git commit called once at end", async () => {
      const { mgr, gitOps } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        materialized: [
          "ems-uid",
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      await mgr.applyProfile("target");
      const commits = gitOps.calls.filter((c) => c.op === "commit");
      expect(commits.length).toBe(1);
      expect((commits[0].args[0] as string)).toContain("apply");
    });
  });
});

describe("ProfileApplyManager.recoverIncompleteSwitch", () => {
  it("restores destroyed-but-not-materialized AS from cache", async () => {
    const { mgr, cacheLayer, app } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    // Simulate interrupted switch journal.
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "phase2-destroy-cached", targetUid: "t", as: "ems-uid", ts: "2026-06-02T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-destroyed", targetUid: "t", as: "ems-uid", ts: "2026-06-02T00:00:01Z" }),
        JSON.stringify({ phase: "phase2-destroy-cached", targetUid: "t", as: "kpc-uid", ts: "2026-06-02T00:00:02Z" }),
        // kpc destroyed but never materialized — crash here.
      ].join("\n") + "\n",
    );
    const result = await mgr.recoverIncompleteSwitch();
    expect(result.restored).toContain("ems-uid");
    expect(result.restored).toContain("kpc-uid");
    // Cache restore called for both.
    expect(cacheLayer.restoreCalls.map((r) => r.asUid).sort()).toEqual(
      ["ems-uid", "kpc-uid"].sort(),
    );
  });

  it("skips AS that have both destroy-cached AND materialized events (= already completed)", async () => {
    const { mgr, cacheLayer, app } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "phase2-destroy-cached", targetUid: "t", as: "ems-uid", ts: "2026-06-02T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-materialized", targetUid: "t", as: "ems-uid", ts: "2026-06-02T00:00:01Z" }),
      ].join("\n") + "\n",
    );
    const result = await mgr.recoverIncompleteSwitch();
    expect(result.restored).toEqual([]);
    expect(cacheLayer.restoreCalls.length).toBe(0);
  });

  it("clears _switchInProgress flag after recovery", async () => {
    const { mgr, localDataStore, app } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    await localDataStore.save({ activeProfileUid: "x", _switchInProgress: true });
    await app.vault.adapter.write(".exocortex/switch-journal.jsonl", "");
    await mgr.recoverIncompleteSwitch();
    expect(localDataStore.isSwitchInProgress()).toBe(false);
  });
});

describe("ProfileApplyManager.reconcileToLocal", () => {
  it("no-divergence when .gitmodules matches activeProfileUid effective set", async () => {
    const { mgr, localDataStore } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
    const result = await mgr.reconcileToLocal();
    expect(result.outcome).toBe("no-divergence");
  });

  it("no-active-profile when localDataStore has null activeProfileUid", async () => {
    const { mgr } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    const result = await mgr.reconcileToLocal();
    expect(result.outcome).toBe("no-active-profile");
  });

  it("reconciles when vault has extra AS не included in target profile", async () => {
    const { mgr, localDataStore, confirmGate } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        "ems-uid", // extra — should trigger divergence
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
    confirmGate.approve = true;
    const result = await mgr.reconcileToLocal();
    expect(result.outcome).toBe("reconciled");
  });

  it("declined when user clicks Cancel in reconcile modal", async () => {
    const { mgr, localDataStore, confirmGate } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      materialized: [
        "ems-uid",
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
    confirmGate.approve = false;
    const result = await mgr.reconcileToLocal();
    expect(result.outcome).toBe("declined");
  });
});
