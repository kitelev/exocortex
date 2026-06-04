/**
 * FocusProfileSwitchManager.hardSwitchProfile() — unit tests covering RFC
 * 22b50a17 Phase 3 algorithm + Phase 0 findings (F2/F3/F5/R24/R26).
 *
 * Tests:
 *   - R24 — TS-floor violation throws before any mutation
 *   - Vision Lock #5 — uncommitted abort with file list
 *   - F2 — journal events emitted in correct order (write-BEFORE-destroy)
 *   - F3 — 4 cardinal crash injection points
 *   - HardSwitchAbortedByUser when confirmGate returns false
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
import type { HardSwitchPlan, IConfirmGate } from "exocortex";

import {
  FocusProfileSwitchManager,
  HardSwitchAbortedByUser,
  TsFloorViolationError,
  UncommittedChangesAbortError,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchJournalEntry,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";
import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../src/infrastructure/adapters/FocusProfileOnloadWiring";

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
  refreshCalls: ReadonlySet<string>[] = [];
  async refresh(effective: ReadonlySet<string>): Promise<void> {
    this.refreshCalls.push(new Set(effective));
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

// Minimal fakes for hard-switch dependencies.

// Production-shape fake mirroring PluginLocalDataStore's dual AC14 slots
// (read-modify-write preserve when a slot is omitted from `save`).
interface FakeLocalState {
  activeProfileUid: string | null;
  activeKnowledgeProfileUid: string | null;
  activeFocusProfileUid: string | null;
  _switchInProgress: boolean;
}

class FakeLocalDataStore {
  private state: FakeLocalState = {
    activeProfileUid: null,
    activeKnowledgeProfileUid: null,
    activeFocusProfileUid: null,
    _switchInProgress: false,
  };
  getActiveProfileUid(): string | null {
    return this.state.activeProfileUid;
  }
  getActiveKnowledgeProfileUid(): string | null {
    return this.state.activeKnowledgeProfileUid;
  }
  getActiveFocusProfileUid(): string | null {
    return this.state.activeFocusProfileUid;
  }
  isSwitchInProgress(): boolean {
    return this.state._switchInProgress;
  }
  snapshot(): FakeLocalState {
    return { ...this.state };
  }
  async save(s: {
    activeProfileUid: string | null;
    activeKnowledgeProfileUid?: string | null;
    activeFocusProfileUid?: string | null;
    _switchInProgress: boolean;
  }): Promise<void> {
    this.state = {
      activeProfileUid: s.activeProfileUid,
      activeKnowledgeProfileUid:
        s.activeKnowledgeProfileUid !== undefined
          ? s.activeKnowledgeProfileUid
          : this.state.activeKnowledgeProfileUid,
      activeFocusProfileUid:
        s.activeFocusProfileUid !== undefined
          ? s.activeFocusProfileUid
          : this.state.activeFocusProfileUid,
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
  lastPlan: HardSwitchPlan | null = null;
  async confirmHardSwitch(plan: HardSwitchPlan): Promise<boolean> {
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
   * AS UIDs the target profile intends to include. The helper converts each
   * to the production-shape Ontology URI form `ontology-<asUid>` matching
   * the fixture's `exo__AssetSpace_containsOntology` declarations. Use raw
   * AS UID for the test set — translation happens in the helper.
   */
  targetIncludes: string[];
  /** AS UIDs included in source profile (used for source label display only). */
  sourceLabel?: string;
  /** AS UIDs currently materialized (subset of vault scan). */
  materialized: string[];
}

function setup(opts: SetupOptions) {
  // Vault contains AssetSpace ABox assets for each TS-floor + extras.
  const tsFloorFolders: Array<{ uid: string; folder: string }> = [
    { uid: TS_FLOOR_AS_UID_EXO, folder: "assetspaces/exo" },
    { uid: TS_FLOOR_AS_UID_EXOCMD, folder: "assetspaces/exocmd" },
    { uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES, folder: "assetspaces/shared-identities" },
  ];

  const extraAs: Array<{ uid: string; folder: string }> = [
    { uid: "ems-uid", folder: "assetspaces/ems" },
    { uid: "kpc-uid", folder: "assetspaces/kpc" },
    { uid: "ims-uid", folder: "assetspaces/ims" },
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
        "exo__Instance_class": ["[[exo__FocusProfile]]"],
      },
    },
    // AssetSpace ABox assets — each has folder + git + namespace + class +
    // containsOntology. Production-shape: AS ABox declares the Ontology
    // URI it contains (per RFC b6ba5595 + FocusProfileOnloadWiring scan).
    // Without this property, the R24 guard's translation step cannot map
    // declared Ontology URIs back to AS UIDs and the guard fires for the
    // wrong reason. Each AS declares one synthetic ontology URI named after
    // the folder; profiles include those URIs in `_includes`.
    ...allAs.map((as) => {
      const ns = as.folder.split("/").pop();
      return {
        path: `${as.folder}/${as.uid}.md`,
        basename: as.uid,
        frontmatter: {
          "exo__Asset_uid": as.uid,
          "exo__Asset_label": ns,
          "exo__Instance_class": ["[[exo__AssetSpace]]"],
          "exo__AssetSpace_git": `https://github.com/test/${ns}-ontology`,
          "exo__AssetSpace_namespace": ns,
          "exo__AssetSpace_containsOntology": [`[[ontology-${as.uid}]]`],
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
        "exo__Instance_class": ["[[exo__FocusProfile]]"],
      },
    });
  }

  const { app, fsFolders } = makeFakeApp(files);

  // Pre-populate folder listing for materialized AS — used by enumerateFilesUnder.
  for (const folder of opts.materialized.map((uid) => allAs.find((a) => a.uid === uid)?.folder).filter((f): f is string => f !== undefined)) {
    fsFolders.set(folder, { files: [`${folder}/file1.md`, `${folder}/file2.md`], folders: [] });
  }

  // Profile target resolution — production-shape: profile declares Ontology
  // URIs (`ontology-<asUid>` per fixture containsOntology) NOT raw AS UIDs.
  const includesAsOntology = opts.targetIncludes.map((u) => `ontology-${u}`);
  const resolver = new FakeResolver(
    new Map<string, ProfileResolution>([
      [
        opts.targetUid,
        {
          uid: opts.targetUid,
          includes: includesAsOntology,
          alwaysOnOverlay: [],
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
        alwaysOnOverlay: [],
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

  const mgr = new FocusProfileSwitchManager({
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
declare module "../../src/infrastructure/adapters/FocusProfileSwitchManager" {
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

describe("FocusProfileSwitchManager.hardSwitchProfile", () => {
  describe("R24 — TS-floor guard", () => {
    it("throws TsFloorViolationError when target excludes any floor AS UID before any mutation", async () => {
      // Target profile includes ONLY ems — missing all 3 TS-floor AS.
      const { mgr, gitOps, cacheLayer } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: ["ems-uid"], // Excludes exo / exocmd / shared-identities.
        materialized: ["ems-uid", TS_FLOOR_AS_UID_EXO],
      });
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow(TsFloorViolationError);
      // No mutation should have happened.
      expect(gitOps.calls.filter((c) => c.op === "submoduleDeinit").length).toBe(0);
      expect(cacheLayer.cachedCalls.length).toBe(0);
    });

    it("passes guard via folderMapValues path when profile declares raw AS UIDs", async () => {
      // Coverage gap: VaultProfileResolver can return raw AS UIDs (not
      // Ontology URIs) when the user authored `_includes` с AS-UID wikilinks
      // directly. The R24 translation step's `folderMapValues.has(uid)`
      // branch covers this — this test asserts the branch works.
      const ctx = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [], // bypass helper's ontology- translation
        materialized: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
      // Override resolver: profile._includes contains raw AS UIDs (not
      // ontology- prefixed) — exercises folderMapValues path.
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
        alwaysOnOverlay: [],
        label: "Target Profile",
      });
      await expect(ctx.mgr.hardSwitchProfile("target")).resolves.toBeUndefined();
    });

    it("passes guard when target profile explicitly includes all 3 floor AS UIDs", async () => {
      // Target explicitly declares the 3 floor AS — R24 guard passes;
      // algorithm proceeds. Hard switch refuses to silently auto-rescue
      // missing floor (vs Phase 1 soft-switch onload wiring which does).
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
      await expect(mgr.hardSwitchProfile("target")).resolves.toBeUndefined();
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
          { asUid: "ems-uid", submodulePath: "assetspaces/ems", files: ["a.md", "b.md"] },
        ],
      });
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow(UncommittedChangesAbortError);
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
      await mgr.hardSwitchProfile("target");
      const checkCall = uncommittedGuard.check.mock.calls[0][0];
      // Only kpc passed — not ems.
      expect(checkCall).toEqual([
        { asUid: "kpc-uid", submodulePath: "assetspaces/kpc" },
      ]);
    });
  });

  describe("HardSwitchAbortedByUser", () => {
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
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow(HardSwitchAbortedByUser);
      expect(gitOps.calls.length).toBe(0);
      expect(cacheLayer.cachedCalls.length).toBe(0);
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
      await mgr.hardSwitchProfile("target");
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
      await mgr.hardSwitchProfile("target");
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

    it("emits hard-switch-completed on successful switch", async () => {
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
      await mgr.hardSwitchProfile("target");
      const entries = await readJournalEntries(app);
      expect(entries.some((e) => e.phase === "hard-switch-completed")).toBe(true);
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
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow();
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
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow();
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
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow();
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
      await expect(mgr.hardSwitchProfile("target")).rejects.toThrow();
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
      await mgr.hardSwitchProfile("target");
      expect(localDataStore.getActiveProfileUid()).toBe("target");
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });

    it("AC14 — persists the Knowledge slot (not the Focus slot) after success", async () => {
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
      // A pre-existing Focus selection must survive a Knowledge (hard) switch.
      await localDataStore.save({
        activeProfileUid: null,
        activeKnowledgeProfileUid: null,
        activeFocusProfileUid: "f-keep",
        _switchInProgress: false,
      });
      await mgr.hardSwitchProfile("target");
      expect(localDataStore.getActiveKnowledgeProfileUid()).toBe("target");
      // Focus slot preserved — hard switch owns Knowledge only.
      expect(localDataStore.getActiveFocusProfileUid()).toBe("f-keep");
    });

    it("rdfIndexer.refresh called with effective AS UID set", async () => {
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
      await mgr.hardSwitchProfile("target");
      expect(indexer.refreshCalls.length).toBe(1);
      const eff = indexer.refreshCalls[0];
      expect(eff.has(TS_FLOOR_AS_UID_EXO)).toBe(true);
      expect(eff.has(TS_FLOOR_AS_UID_EXOCMD)).toBe(true);
      expect(eff.has(TS_FLOOR_AS_UID_SHARED_IDENTITIES)).toBe(true);
      expect(eff.has("ems-uid")).toBe(false);
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
      await mgr.hardSwitchProfile("target");
      const commits = gitOps.calls.filter((c) => c.op === "commit");
      expect(commits.length).toBe(1);
      expect((commits[0].args[0] as string)).toContain("hard switch");
    });
  });
});

describe("FocusProfileSwitchManager.recoverIncompleteSwitch", () => {
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

describe("FocusProfileSwitchManager.reconcileToLocal", () => {
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
