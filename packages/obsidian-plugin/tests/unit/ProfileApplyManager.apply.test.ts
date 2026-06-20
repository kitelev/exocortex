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
        // Issue #3532 — ensureExocortexDir() calls adapter.mkdir; production
        // shape registers the folder so subsequent exists() returns true.
        mkdir: async (p: string) => {
          if (!fsFolders.has(p)) fsFolders.set(p, { files: [], folders: [] });
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
  // Issue #3532 — simulate a never-resolving pull (Obsidian `requestUrl` with no
  // native timeout on a stalled macOS-desktop connection). The watchdog must
  // reject the whole apply on its deadline instead of letting this hang.
  hangOnPull: string | null = null;
  async pullAssetSpace(asUid: string, gitUrl: string, ref: string) {
    this.pullCalls.push({ asUid, gitUrl, ref });
    if (this.hangOnPull === asUid) {
      // Never resolves — stands in for a stalled requestUrl on macOS desktop.
      return new Promise<never>(() => {});
    }
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

// REST mount fake (mirrors restApply harness) — records mount/unmount so the
// REST-aware crash-recovery resume (#1d1bcde0) can be asserted against the
// driven mount-delta.
class FakeRestMount {
  mounted: Array<{ gitUrl: string; submodulePath: string; ref: string }> = [];
  unmounted: string[] = [];
  async mount(gitUrl: string, submodulePath: string, ref: string) {
    this.mounted.push({ gitUrl, submodulePath, ref });
    return { sha: "abc1234", fileCount: 1 };
  }
  async unmount(submodulePath: string): Promise<void> {
    this.unmounted.push(submodulePath);
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
  /** Issue #3532 — never-hang watchdog deadline (ms). Default leaves it unset. */
  applyTimeoutMs?: number;
  /**
   * Issue #3532 — replace the lock manager (e.g. one whose `acquireLock` never
   * resolves, reproducing the «hang before the mutation phase» smoking gun).
   */
  lockMgrOverride?: unknown;
  /**
   * #3558 — override the `$exo` floor AssetSpace descriptor's uid + namespace to
   * simulate an EKA central-registry vault: the registry mints a DISTINCT
   * descriptor uid for `$exo` while the fork-safe namespace stays "exo". When
   * set, the `assetspaces/kitelev/exoas-exo` descriptor uses
   * `{uid, namespace}` instead of the default
   * `{TS_FLOOR_AS_UID_EXO, "exoas-exo"}`. The floor must then be recognised by
   * namespace, not by the hardcoded anchor uid.
   */
  exoDescriptor?: { uid: string; namespace: string };
  /**
   * #3557 — wire an `assetSpaceManagerFactory` (the fresh-PAT puller rebuilt per
   * apply). When set, the desktop apply materialize path pulls via the factory
   * result instead of the onload-captured `assetSpaceManager`, so a PAT
   * configured after onload is honoured without a reload.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assetSpaceManagerFactory?: () => Promise<any>;
  /**
   * #1d1bcde0 — wire the cross-platform REST mount so the apply path routes
   * through `applyProfileViaRest` (production path since #3567) and the
   * REST-aware crash-recovery resume can drive the mount-delta. Default off so
   * the existing desktop-git apply tests keep exercising the git path.
   */
  wireRestMount?: boolean;
}

function setup(opts: SetupOptions) {
  // Vault contains AssetSpace ABox assets for each TS-floor + extras.
  const tsFloorFolders: Array<{ uid: string; folder: string; namespace?: string }> = [
    {
      // #3558 — exoDescriptor override simulates an EKA central-registry vault.
      uid: opts.exoDescriptor?.uid ?? TS_FLOOR_AS_UID_EXO,
      folder: "assetspaces/kitelev/exoas-exo",
      namespace: opts.exoDescriptor?.namespace,
    },
    { uid: TS_FLOOR_AS_UID_EXOCMD, folder: "assetspaces/kitelev/exoas-exocmd" },
    { uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES, folder: "assetspaces/kitelev/exoas-shared-identities" },
  ];

  const extraAs: Array<{ uid: string; folder: string; namespace?: string }> = [
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
      const ns = as.namespace ?? as.folder.split("/").pop();
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

  const { app, fsFiles, fsFolders } = makeFakeApp(files);

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
  const lockMgr =
    (opts.lockMgrOverride as PluginLockManager | undefined) ??
    new PluginLockManager({ app });
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
  const restMount = new FakeRestMount();

  // Capture user-facing Notices (#3538 legacy flat-mount warn + others).
  const notifyMessages: string[] = [];

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
    restMount: (opts.wireRestMount ? restMount : undefined) as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
    notify: (m: string) => notifyMessages.push(m),
    vaultRootPath: "/fake/vault",
    ...(opts.isSyncBusy !== undefined ? { isSyncBusy: opts.isSyncBusy } : {}),
    ...(opts.applyTimeoutMs !== undefined
      ? { applyTimeoutMs: opts.applyTimeoutMs }
      : {}),
    ...(opts.assetSpaceManagerFactory !== undefined
      ? /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        { assetSpaceManagerFactory: opts.assetSpaceManagerFactory as any }
      : {}),
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
    restMount,
    notifyMessages,
    app,
    fsFiles,
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

  describe("#3538 follow-up — legacy flat-mount warn", () => {
    // $exo's source `https://github.com/kitelev/exoas-exo` derives to canonical
    // `assetspaces/kitelev/exoas-exo`; its pre-#3538 legacy flat path is
    // `assetspaces/exo` (deriveFolderName strips `exoas-`).
    const FLAT_EXO = "assetspaces/exo";

    it("WARNS when an AssetSpace is materialized at the legacy flat path", async () => {
      const ctx = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [TS_FLOOR_AS_UID_EXO], // floor={exo} — resolves OK
        materialized: [TS_FLOOR_AS_UID_EXO],
      });
      // Simulate the legacy flat-mount on disk (the dogfood-iPhone state).
      ctx.fsFolders.set(FLAT_EXO, { files: [`${FLAT_EXO}/file1.md`], folders: [] });

      await expect(ctx.mgr.applyProfile("target")).resolves.toBeUndefined();

      const warn = ctx.notifyMessages.find((m) =>
        m.includes("legacy flat path"),
      );
      expect(warn).toBeDefined();
      // Names the affected flat path → canonical migration target.
      expect(warn).toContain(FLAT_EXO);
      expect(warn).toContain("assetspaces/kitelev/exoas-exo");
      expect(warn).toContain("docs/explanation/profile.md");
    });

    it("REVERT-VERIFY: no warn when no flat-mount folder exists on disk", async () => {
      // Identical setup MINUS the flat folder → the guard must stay silent
      // (no false positive on a canonically-mounted vault).
      const ctx = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [TS_FLOOR_AS_UID_EXO],
        materialized: [TS_FLOOR_AS_UID_EXO],
      });

      await expect(ctx.mgr.applyProfile("target")).resolves.toBeUndefined();

      expect(
        ctx.notifyMessages.find((m) => m.includes("legacy flat path")),
      ).toBeUndefined();
    });

    it("does NOT abort apply if detection throws (best-effort, read-only)", async () => {
      const ctx = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [TS_FLOOR_AS_UID_EXO],
        materialized: [TS_FLOOR_AS_UID_EXO],
      });
      // Make the flat-mount existence probe throw — apply must still succeed.
      const realExists = ctx.app.vault.adapter.exists.bind(
        ctx.app.vault.adapter,
      );
      (ctx.app.vault.adapter as unknown as { exists: unknown }).exists = async (
        p: string,
      ) => {
        if (p === FLAT_EXO) throw new Error("simulated adapter failure");
        return realExists(p);
      };

      await expect(ctx.mgr.applyProfile("target")).resolves.toBeUndefined();
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

  describe("Phase-1 pull failure — never hangs (Issue #3530)", () => {
    // The macOS-desktop hang root cause: a private-repo tarball pull never
    // resolved (Obsidian `requestUrl` has no timeout), so `applyProfile` stayed
    // pending forever with `_switchInProgress` stuck. The GitHubRestClient
    // timeout guard now makes `pullAssetSpace` REJECT on a stalled connection;
    // here we assert the apply orchestration honours that reject deterministically
    // — it must settle (jest's default 5s test timeout would fail a real hang)
    // and clear `_switchInProgress`. `failOnPull` stands in for the timeout reject.
    function pullFailSetup() {
      return setup({
        targetUid: "target",
        sourceUid: null,
        // Floor present + one extra AS to materialise (so Phase 1 pull runs).
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
          "ems-uid",
        ],
        // ems-uid is NOT yet materialised → it lands in toMaterialize → pulled.
        materialized: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
      });
    }

    it("rejects (does NOT hang) when the Phase-1 pull fails", async () => {
      const { mgr, assetSpaceManager } = pullFailSetup();
      assetSpaceManager.failOnPull = "ems-uid";
      await expect(mgr.applyProfile("target")).rejects.toThrow(
        /Simulated pull failure/,
      );
    });

    it("clears _switchInProgress after a failed Phase-1 pull", async () => {
      const { mgr, assetSpaceManager, localDataStore } = pullFailSetup();
      assetSpaceManager.failOnPull = "ems-uid";
      await expect(mgr.applyProfile("target")).rejects.toThrow();
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });
  });

  describe("#3557 — PAT-after-onload: desktop apply rebuilds the puller per invocation", () => {
    function freshPullerSetupOpts(extra: Partial<SetupOptions>): SetupOptions {
      return {
        targetUid: "target",
        sourceUid: null,
        // Floor present + one extra AS to materialise (so Phase 1 pull runs).
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
          "ems-uid",
        ],
        // ems-uid is NOT materialised → it lands in toMaterialize → pulled.
        materialized: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        ...extra,
      };
    }

    it("pulls via assetSpaceManagerFactory (current PAT), NOT the onload-captured manager", async () => {
      const freshPuller = new FakeAssetSpaceManager();
      const { mgr, assetSpaceManager } = setup(
        freshPullerSetupOpts({ assetSpaceManagerFactory: async () => freshPuller }),
      );
      await mgr.applyProfile("target");
      // The fresh (current-PAT) puller did the materialize pull. Pre-fix the
      // apply used the onload-captured `deps.assetSpaceManager` — frozen with an
      // empty PAT when none was set at load → anonymous tarball → HTTP 404 on a
      // private repo (Issue #3557).
      expect(freshPuller.pullCalls.map((c) => c.asUid)).toContain("ems-uid");
      expect(assetSpaceManager.pullCalls).toHaveLength(0);
    });

    it("sibling (revert-verify) — falls back to the onload manager when no factory is wired", async () => {
      const { mgr, assetSpaceManager } = setup(freshPullerSetupOpts({}));
      await mgr.applyProfile("target");
      // No factory wired (tests/legacy) → the onload-captured manager pulls.
      expect(assetSpaceManager.pullCalls.map((c) => c.asUid)).toContain("ems-uid");
    });
  });

  describe("Never-hang watchdog — bounds the WHOLE post-confirm path (Issue #3532)", () => {
    // #3531 bounded only the requestUrl / git-clone steps. #3532: macOS desktop
    // STILL hung after confirm — `_switchInProgress` never flipped, no journal,
    // 0 files cloned — i.e. a stall BEFORE the mutation phase (and other
    // non-bounded `vault.adapter` / refresh awaits). The watchdog races the whole
    // post-confirm critical section (lock acquire → pull → Phase 2 → commit →
    // refresh) so a stall on ANY step rejects deterministically instead of
    // hanging. A real hang would trip jest's per-test timeout — these tests pass
    // only because the deadline fires first.
    //
    // Revert-verify: set `applyTimeoutMs: 0` (disables the watchdog) and each of
    // these tests hangs until jest's timeout fails them — confirming the guard,
    // not the harness, is what makes them settle.
    const watchdogIncludes = [
      TS_FLOOR_AS_UID_EXO,
      TS_FLOOR_AS_UID_EXOCMD,
      TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      "ems-uid",
    ];
    const watchdogMaterialized = [
      TS_FLOOR_AS_UID_EXO,
      TS_FLOOR_AS_UID_EXOCMD,
      TS_FLOOR_AS_UID_SHARED_IDENTITIES,
    ];

    it("rejects (does NOT hang) when a Phase-1 pull never resolves", async () => {
      const { mgr, assetSpaceManager } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: watchdogIncludes,
        materialized: watchdogMaterialized,
        applyTimeoutMs: 100,
      });
      assetSpaceManager.hangOnPull = "ems-uid"; // never resolves
      await expect(mgr.applyProfile("target")).rejects.toThrow(
        /timed out after 100ms.*Issue #3532/s,
      );
    });

    it("clears _switchInProgress after the watchdog fires mid-mutation", async () => {
      const { mgr, assetSpaceManager, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: watchdogIncludes,
        materialized: watchdogMaterialized,
        applyTimeoutMs: 100,
      });
      assetSpaceManager.hangOnPull = "ems-uid";
      await expect(mgr.applyProfile("target")).rejects.toThrow(/timed out/);
      // The stuck pull was AFTER `_switchInProgress=true` — the watchdog's
      // onTimeout cleanup must flip it back so the next apply is not blocked.
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });

    it("rejects (does NOT hang) when lock acquisition stalls BEFORE the mutation phase (the #3532 smoking gun)", async () => {
      // Smoking gun: `_switchInProgress=False throughout` — the stall happened
      // before the flag was ever set. A lock manager whose `acquireLock` never
      // resolves reproduces «apply does not enter the mutation phase after
      // confirm». The watchdog still rejects.
      const hangingLockMgr = {
        acquireLock: () => new Promise<boolean>(() => {}), // never resolves
        releaseLock: async () => undefined,
        heartbeat: async () => undefined,
      };
      const { mgr, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: watchdogIncludes,
        materialized: watchdogMaterialized,
        applyTimeoutMs: 100,
        lockMgrOverride: hangingLockMgr,
      });
      await expect(mgr.applyProfile("target")).rejects.toThrow(/timed out/);
      // Never reached the mutation phase, so the flag must still be false.
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });

    it("does NOT fire the watchdog on a healthy apply (no false positives)", async () => {
      const { mgr, localDataStore, gitOps } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: watchdogIncludes,
        materialized: watchdogMaterialized,
        applyTimeoutMs: 5_000, // generous — a healthy apply completes in <ms
      });
      await expect(mgr.applyProfile("target")).resolves.toBeUndefined();
      expect(localDataStore.getActiveProfileUid()).toBe("target");
      expect(localDataStore.isSwitchInProgress()).toBe(false);
      expect(gitOps.calls.some((c) => c.op === "submoduleAdd")).toBe(true);
    });

    it("releases the lock on a successful apply (generation guard normal path)", async () => {
      // Regression guard for the generation-token finally: the success path must
      // STILL release the lock (`this.applyGeneration === myGen` true when no
      // concurrent apply bumped the generation). A stuck lock would block the
      // next apply with «another apply in progress».
      const { mgr, app } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: watchdogIncludes,
        materialized: watchdogMaterialized,
        applyTimeoutMs: 5_000,
      });
      await expect(mgr.applyProfile("target")).resolves.toBeUndefined();
      expect(await app.vault.adapter.exists(".exocortex/switch-lock.json")).toBe(
        false,
      );
    });

    it("scales the deadline by AssetSpace count (per-unit budget, code-review MEDIUM)", async () => {
      // A 50ms-per-unit budget on a 2-AS materialize gives a 100ms overall
      // deadline. With the first pull hanging, the apply still rejects (proving
      // the deadline is finite and unit-scaled, not a flat per-step value).
      const { mgr, assetSpaceManager } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
          "ems-uid",
          "kpc-uid",
        ],
        materialized: [
          TS_FLOOR_AS_UID_EXO,
          TS_FLOOR_AS_UID_EXOCMD,
          TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        ],
        applyTimeoutMs: 50, // 2 units → 100ms effective deadline
      });
      assetSpaceManager.hangOnPull = "ems-uid";
      const start = Date.now();
      await expect(mgr.applyProfile("target")).rejects.toThrow(/timed out/);
      // Sanity: settled well under jest's 5s default (proves finiteness, not the
      // exact deadline — timing in CI is noisy).
      expect(Date.now() - start).toBeLessThan(2_000);
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

/**
 * Make a fake adapter production-shape for the fresh-vault case: real Obsidian
 * `vault.adapter.write` does NOT create parent directories, so a write into a
 * dir that doesn't exist throws ENOENT (see ProfileApplyManager.ensureExocortexDir
 * docstring). The shared makeFakeApp `write` is lenient (it just sets the file
 * regardless of the parent), which is why the original #3571 fresh-install
 * recovery bug slipped past the existing tests. This wrapper enforces the strict
 * contract so the recovery path is exercised faithfully (test-fixture-realism).
 */
function makeAdapterWriteStrict(app: App): void {
  const adapter = app.vault.adapter as unknown as {
    write: (p: string, d: string) => Promise<void>;
    exists: (p: string) => Promise<boolean>;
  };
  const origWrite = adapter.write.bind(adapter);
  adapter.write = async (p: string, d: string): Promise<void> => {
    const slash = p.lastIndexOf("/");
    if (slash > 0) {
      const dir = p.slice(0, slash);
      if (!(await adapter.exists(dir))) {
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      }
    }
    return origWrite(p, d);
  };
}

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

  // === #3571 — fresh-install false-alarm toast guard ===

  it("#3571 — fresh install (no journal, no in-progress flag): no-op, no ENOENT toast", async () => {
    const { mgr, app, notifyMessages } = setup({
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
    // Production-shape: on a fresh vault `.exocortex/` does not exist and the
    // real adapter.write throws ENOENT (it never creates parent dirs).
    makeAdapterWriteStrict(app);

    // Fresh install: no journal file, no `_switchInProgress` flag, no
    // `.exocortex/` dir. Pre-fix the unconditional `recovery-completed` journal
    // write hit ENOENT → threw → caller surfaced the scary Notice. Post-fix the
    // guard returns early.
    await expect(mgr.recoverIncompleteSwitch()).resolves.toEqual({
      restored: [],
      resumed: false,
      resumedTo: null,
    });
    // No journal entry was written (true no-op).
    expect(
      await app.vault.adapter.exists(".exocortex/switch-journal.jsonl"),
    ).toBe(false);
    // No user-facing Notice.
    expect(notifyMessages).toEqual([]);
  });

  it("#3571 — _switchInProgress set but no journal yet (crash window): recovers without ENOENT", async () => {
    const { mgr, app, localDataStore } = setup({
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
    makeAdapterWriteStrict(app);
    // Crash window: the in-progress flag was persisted before the first journal
    // write, so the flag is set but no journal / `.exocortex/` dir exists. The
    // guard must NOT early-return here (there is a real interrupted switch), and
    // the defensive ensureExocortexDir() must prevent the recovery-completed
    // write from ENOENT-ing.
    await localDataStore.save({ activeProfileUid: "x", _switchInProgress: true });

    await expect(mgr.recoverIncompleteSwitch()).resolves.toEqual({
      restored: [],
      resumed: false,
      resumedTo: null,
    });
    // Stuck flag cleared.
    expect(localDataStore.isSwitchInProgress()).toBe(false);
  });

  it("#3571 — real incomplete switch + genuine recovery failure: still throws (toast preserved)", async () => {
    const { mgr, app, localDataStore } = setup({
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
    // Real incomplete switch: in-progress flag + journal with a destroyed-not-
    // materialized AS (so the guard passes and recovery work runs).
    await localDataStore.save({ activeProfileUid: "x", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({
        phase: "phase2-destroy-cached",
        targetUid: "t",
        as: "ems-uid",
        ts: "2026-06-02T00:00:00Z",
      }) + "\n",
    );
    // Genuine recovery failure: the flag-clear save rejects. The guard must NOT
    // swallow this — the caller relies on the throw to surface the legitimate
    // "apply recovery failed" Notice.
    (localDataStore as unknown as { save: unknown }).save = async (): Promise<void> => {
      throw new Error("simulated localDataStore failure during recovery");
    };

    await expect(mgr.recoverIncompleteSwitch()).rejects.toThrow(
      "simulated localDataStore failure during recovery",
    );
  });

  // === #7c9074ce — vacuous recovery-completed guard ===
  //
  // The #3571 nothing-to-recover guard only fires on a FRESH vault (journal
  // absent). On an established vault the journal always exists, so a clean
  // reload fell through to the unconditional `recovery-completed` write —
  // appending a vacuous terminal on EVERY onload (the live journal grew to 95
  // such records). The fix extends the guard to short-circuit when there is no
  // actual recovery work: no REST resume, no destroyed-not-materialized AS to
  // restore, and no stuck `_switchInProgress` flag.
  describe("#7c9074ce — vacuous recovery-completed guard", () => {
    const FLOOR = [
      TS_FLOOR_AS_UID_EXO,
      TS_FLOOR_AS_UID_EXOCMD,
      TS_FLOOR_AS_UID_SHARED_IDENTITIES,
    ];

    it("REVERT-VERIFY: established vault, clean reindex tail (`completed`) + flag=false → does NOT append vacuous recovery-completed", async () => {
      // The live smoking gun: a clean reindex-only switch ends `starting`→
      // `completed`. `classifyInterruptedSwitch` yields kind=`reindex` (NOT
      // `none`, since `completed` is not a reset terminal), but
      // recoverIncompleteSwitch has nothing to do for a reindex — its resume is
      // a SEPARATE worker. Pre-fix it still wrote a vacuous `recovery-completed`.
      const { mgr, app, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: FLOOR,
        materialized: FLOOR,
      });
      await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
      await app.vault.adapter.write(
        ".exocortex/switch-journal.jsonl",
        [
          JSON.stringify({ phase: "starting", targetUid: "target", ts: "2026-06-02T00:00:00Z" }),
          JSON.stringify({ phase: "completed", targetUid: "target", ts: "2026-06-02T00:00:05Z" }),
        ].join("\n") + "\n",
      );

      const before = await readJournalEntries(app);
      const result = await mgr.recoverIncompleteSwitch();
      const after = await readJournalEntries(app);

      expect(result).toEqual({ restored: [], resumed: false, resumedTo: null });
      // No new entry — journal is byte-stable across the no-op recovery.
      expect(after.length).toBe(before.length);
      expect(after.filter((e) => e.phase === "recovery-completed")).toEqual([]);
    });

    it("REVERT-VERIFY: established vault, clean apply tail (`apply-completed`) + flag=false → does NOT append vacuous recovery-completed", async () => {
      // Clean apply terminal resets the classifier to kind=`none`. Pre-fix the
      // git-apply restore loop ran with an empty destroyed set and still wrote
      // a vacuous `recovery-completed`.
      const { mgr, app, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: FLOOR,
        materialized: FLOOR,
      });
      await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
      await app.vault.adapter.write(
        ".exocortex/switch-journal.jsonl",
        [
          JSON.stringify({ phase: "apply-starting", targetUid: "target", ts: "2026-06-02T00:00:00Z" }),
          JSON.stringify({ phase: "apply-completed", targetUid: "target", ts: "2026-06-02T00:00:05Z" }),
        ].join("\n") + "\n",
      );

      const before = await readJournalEntries(app);
      await mgr.recoverIncompleteSwitch();
      const after = await readJournalEntries(app);

      expect(after.length).toBe(before.length);
      expect(after.filter((e) => e.phase === "recovery-completed")).toEqual([]);
    });

    it("REGRESSION: real interrupted switch (destroyed-not-materialized) STILL restores + writes recovery-completed", async () => {
      // Guard must NOT over-suppress: a genuine incomplete git-apply left a
      // destroyed-but-not-materialized AS in the journal. Recovery must restore
      // it from cache and write its terminal `recovery-completed`.
      const { mgr, cacheLayer, app, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: FLOOR,
        materialized: FLOOR,
      });
      await localDataStore.save({ activeProfileUid: "x", _switchInProgress: true });
      await app.vault.adapter.write(
        ".exocortex/switch-journal.jsonl",
        JSON.stringify({
          phase: "phase2-destroy-cached",
          targetUid: "t",
          as: "ems-uid",
          ts: "2026-06-02T00:00:00Z",
        }) + "\n",
      );

      const result = await mgr.recoverIncompleteSwitch();

      expect(result.restored).toContain("ems-uid");
      expect(cacheLayer.restoreCalls.map((r) => r.asUid)).toContain("ems-uid");
      const after = await readJournalEntries(app);
      expect(after.some((e) => e.phase === "recovery-completed")).toBe(true);
      // Flag cleared after the genuine recovery.
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });

    it("REGRESSION: clean tail but `_switchInProgress` STUCK true → still clears flag + writes recovery-completed (no over-suppress)", async () => {
      // The guard keys on actual recovery NEED — a stuck in-progress flag IS
      // recovery work (clear it) even when the journal tail looks terminal.
      const { mgr, app, localDataStore } = setup({
        targetUid: "target",
        sourceUid: null,
        targetIncludes: FLOOR,
        materialized: FLOOR,
      });
      await localDataStore.save({ activeProfileUid: "target", _switchInProgress: true });
      await app.vault.adapter.write(
        ".exocortex/switch-journal.jsonl",
        JSON.stringify({ phase: "apply-completed", targetUid: "target", ts: "2026-06-02T00:00:05Z" }) + "\n",
      );

      await mgr.recoverIncompleteSwitch();

      expect(localDataStore.isSwitchInProgress()).toBe(false);
      const after = await readJournalEntries(app);
      expect(after.some((e) => e.phase === "recovery-completed")).toBe(true);
    });
  });
});

// ============================================================================
// #1d1bcde0 — REST-aware crash recovery (reload mid-apply on the PRODUCTION
// REST path since #3567). The dedicated apply-recovery worker previously keyed
// on `phase2-destroy-cached` events that ONLY the desktop-git mutation emits,
// so an interrupted REST apply (`apply-starting` + `phase2-materialized`, NO
// `phase2-destroy-cached`) restored nothing — the vault stayed partially
// applied with no auto-resume. The fix drives the mount-delta to the target
// idempotently via `applyProfileViaRest` (mount missing + unmount leftover).
// ============================================================================
describe("ProfileApplyManager.recoverIncompleteSwitch — REST apply resume (#1d1bcde0)", () => {
  it("REGRESSION: interrupted REST apply (phase2-materialized, NO phase2-destroy-cached) drives the mount-delta to target", async () => {
    // Pre-apply: source = floors + kpc. Target = floors + ems. The user clicks
    // Apply; runRestApplyMutation mounts ems (phase2-materialized) then CRASHES
    // (reload) BEFORE unmounting kpc (mount-before-unmount ordering). Disk at
    // recovery = floors + kpc + ems (partial); journal = apply-starting +
    // phase2-materialized(ems), NO phase2-destroy-cached; _switchInProgress=true,
    // activeProfileUid still = source (the success-save never ran).
    const { mgr, restMount, localDataStore, app } = setup({
      targetUid: "target",
      sourceUid: "source",
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "kpc-uid",
        "ems-uid",
      ],
      wireRestMount: true,
    });
    await localDataStore.save({ activeProfileUid: "source", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "apply-starting", targetUid: "target", ts: "2026-06-19T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-materialized", targetUid: "target", as: "ems-uid", ts: "2026-06-19T00:00:01Z" }),
      ].join("\n") + "\n",
    );

    const result = await mgr.recoverIncompleteSwitch();

    // The leftover source AssetSpace (kpc) is unmounted; ems is already mounted
    // so nothing is re-mounted — the mount-delta is reconciled to the target.
    expect(restMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    expect(restMount.mounted).toEqual([]);
    // activeProfileUid is declared TARGET only AFTER the mount-state matches it
    // (runRestApplyMutation's success save), and the stuck flag is cleared.
    expect(localDataStore.getActiveProfileUid()).toBe("target");
    expect(localDataStore.isSwitchInProgress()).toBe(false);
    expect(result.resumed).toBe(true);
    expect(result.resumedTo).toBe("target");
  });

  it("REGRESSION: interrupted REST apply BEFORE the first mount (apply-starting only) mounts missing + unmounts leftover", async () => {
    // Crash right after apply-starting (before mounting ems, before unmounting
    // kpc). Disk = floors + kpc (pre-apply state). Recovery drives to target
    // (mount ems, unmount kpc).
    const { mgr, restMount, localDataStore, app } = setup({
      targetUid: "target",
      sourceUid: "source",
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "kpc-uid",
      ],
      wireRestMount: true,
    });
    await localDataStore.save({ activeProfileUid: "source", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({ phase: "apply-starting", targetUid: "target", ts: "2026-06-19T00:00:00Z" }) + "\n",
    );

    const result = await mgr.recoverIncompleteSwitch();

    expect(restMount.mounted.map((m) => m.submodulePath)).toEqual([
      "assetspaces/kitelev/exoas-ems",
    ]);
    expect(restMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    expect(localDataStore.getActiveProfileUid()).toBe("target");
    expect(localDataStore.isSwitchInProgress()).toBe(false);
    expect(result.resumed).toBe(true);
  });

  it("EMPTY-delta resume (disk already == target) reconciles localDataStore to target + closes the recovery window (no churn)", async () => {
    // Crash in the window AFTER the last on-disk mount/unmount but BEFORE the
    // success-save: disk already matches the target effective set, so the resume
    // computes an empty diff and takes applyProfileViaRest's reindex-only exit
    // (which writes `completed`, not `apply-completed`). The recovery must still
    // reconcile localDataStore to target + write a terminal `recovery-completed`
    // so it does not re-resume on every subsequent reload (HIGH review catch).
    const { mgr, restMount, localDataStore, app } = setup({
      targetUid: "target",
      sourceUid: "source",
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      // Disk already == target effective set (floors + ems) — nothing to do.
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      wireRestMount: true,
    });
    await localDataStore.save({ activeProfileUid: "source", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "apply-starting", targetUid: "target", ts: "2026-06-19T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-materialized", targetUid: "target", as: "ems-uid", ts: "2026-06-19T00:00:01Z" }),
      ].join("\n") + "\n",
    );

    const result = await mgr.recoverIncompleteSwitch();

    // Empty delta — no mount/unmount — but state reconciled to target.
    expect(result.resumed).toBe(true);
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
    expect(localDataStore.getActiveProfileUid()).toBe("target");
    expect(localDataStore.isSwitchInProgress()).toBe(false);

    // Window closed: a second recovery pass does NOT re-resume (no churn loop).
    const second = await mgr.recoverIncompleteSwitch();
    expect(second.resumed).toBe(false);
  });

  it("reclaims the crashed session's still-fresh lock so the resume is not blocked (fast reload)", async () => {
    // A reload WITHIN the lock staleness window leaves a foreign-pid lock whose
    // heartbeat is recent (not yet stale). The resume must reclaim it, else
    // applyProfileViaRest's acquireLock would falsely report "another switch in
    // progress" and the recovery would never run.
    const { mgr, restMount, localDataStore, app } = setup({
      targetUid: "target",
      sourceUid: "source",
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "kpc-uid",
        "ems-uid",
      ],
      wireRestMount: true,
    });
    await localDataStore.save({ activeProfileUid: "source", _switchInProgress: true });
    // Seed the crashed session's lock — foreign pid, FRESH heartbeat (now).
    await app.vault.adapter.write(
      ".exocortex/switch-lock.json",
      JSON.stringify({
        pid: "crashed-session-9999",
        acquiredAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        operation: "apply-rest-target",
      }),
    );
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "apply-starting", targetUid: "target", ts: "2026-06-19T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-materialized", targetUid: "target", as: "ems-uid", ts: "2026-06-19T00:00:01Z" }),
      ].join("\n") + "\n",
    );

    const result = await mgr.recoverIncompleteSwitch();

    // The resume proceeded despite the foreign lock — mount-delta driven to target.
    expect(result.resumed).toBe(true);
    expect(restMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    expect(localDataStore.getActiveProfileUid()).toBe("target");
  });

  it("does NOT skip the confirm gate for a normal apply — only the recovery resume auto-resumes", async () => {
    // Sibling/control: a normal applyProfile still goes through the confirm gate
    // (proves skipConfirm is scoped to the recovery resume, not leaked).
    const { mgr, confirmGate, restMount } = setup({
      targetUid: "target",
      sourceUid: "source",
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "kpc-uid",
      ],
      wireRestMount: true,
    });
    confirmGate.approve = false;
    await expect(mgr.applyProfile("target")).rejects.toThrow(ApplyAbortedByUser);
    // Declined → no mutation.
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
  });

  it("CONTROL: the desktop-git journal (phase2-destroy-cached) still cache-restores — REST resume is path-scoped", async () => {
    // Regression guard: the existing desktop-git cache-restore path is unchanged
    // even with restMount wired — the journal's git signature
    // (`phase2-destroy-cached`) routes to the cache-restore branch, NOT the REST
    // resume.
    const { mgr, cacheLayer, restMount, app, localDataStore } = setup({
      targetUid: "target",
      sourceUid: "source",
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
      wireRestMount: true,
    });
    await localDataStore.save({ activeProfileUid: "source", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "phase2-start", targetUid: "target", ts: "2026-06-19T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-destroy-cached", targetUid: "target", as: "kpc-uid", ts: "2026-06-19T00:00:01Z" }),
        JSON.stringify({ phase: "phase2-destroyed", targetUid: "target", as: "kpc-uid", ts: "2026-06-19T00:00:02Z" }),
      ].join("\n") + "\n",
    );

    const result = await mgr.recoverIncompleteSwitch();

    // Cache-restore fired (desktop-git path); REST mount was NOT used.
    expect(result.restored).toContain("kpc-uid");
    expect(cacheLayer.restoreCalls.length).toBeGreaterThan(0);
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
    expect(result.resumed).toBe(false);
  });
});

// #1d1bcde0 F2 — recoverIfNeeded must NOT prematurely declare an interrupted
// APPLY mutation "Applied". A re-index would persist activeProfileUid=TARGET +
// clear the in-progress flag against a PARTIAL mount-state. The apply-mutation
// interruption is deferred to the apply-recovery worker (recoverIncompleteSwitch).
describe("ProfileApplyManager.recoverIfNeeded — defers apply-mutation interruptions (#1d1bcde0 F2)", () => {
  it("REGRESSION: interrupted REST apply does NOT re-index / declare target active (deferred to apply recovery)", async () => {
    const { mgr, settingsStore, app, notifyMessages } = setup({
      targetUid: "target",
      sourceUid: "source",
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "ems-uid",
      ],
      materialized: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
        "kpc-uid",
        "ems-uid",
      ],
      wireRestMount: true,
    });
    // recoverIfNeeded reads `_switchInProgress` from the settingsStore.
    await settingsStore.save({ activeProfileUid: "source", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      [
        JSON.stringify({ phase: "apply-starting", targetUid: "target", ts: "2026-06-19T00:00:00Z" }),
        JSON.stringify({ phase: "phase2-materialized", targetUid: "target", as: "ems-uid", ts: "2026-06-19T00:00:01Z" }),
      ].join("\n") + "\n",
    );

    const recovery = await mgr.recoverIfNeeded();

    // Deferred — recoverIfNeeded did not re-index / declare anything.
    expect(recovery.recovered).toBe(false);
    expect(recovery.targetUid).toBe(null);
    // activeProfileUid NOT prematurely flipped to target on a partial disk.
    const settings = await settingsStore.load();
    expect(settings.activeProfileUid).not.toBe("target");
    // No premature "Applied <target>" / "Recovering" notice.
    expect(notifyMessages).toEqual([]);
  });

  it("CONTROL: a pure reindex-only interruption (starting, no mutation) still re-indexes", async () => {
    // A reindex-only switch (no filesystem mutation) interrupted mid-reindex —
    // recoverIfNeeded SHOULD still re-trigger the idempotent re-index.
    const { mgr, settingsStore, app } = setup({
      targetUid: "target",
      sourceUid: "source",
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
    await settingsStore.save({ activeProfileUid: "source", _switchInProgress: true });
    await app.vault.adapter.write(
      ".exocortex/switch-journal.jsonl",
      JSON.stringify({ phase: "starting", targetUid: "target", ts: "2026-06-19T00:00:00Z" }) + "\n",
    );

    const recovery = await mgr.recoverIfNeeded();

    expect(recovery.recovered).toBe(true);
    expect(recovery.targetUid).toBe("target");
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

  // === #3558 — central-registry floor UID reconciliation ===
  // An EKA central-registry vault mounts $exo under a descriptor UID that
  // DIFFERS from the hardcoded TS_FLOOR_AS_UID_EXO anchor (fork-safe namespace
  // "exo" stays the same). The floor must be recognised by namespace, otherwise
  // every reload injects the hardcoded anchor into the expected set → reports the
  // already-mounted floor "missing" → perpetual false-positive reconcile modal.
  const REGISTRY_EXO_UID = "e5c47526-e72f-42e3-8535-3d243dd2db94";

  it("#3558 — no-divergence when $exo floor is mounted under a registry UID (namespace match)", async () => {
    const { mgr, localDataStore } = setup({
      targetUid: "target",
      sourceUid: null,
      // Profile + vault key the exo floor on the registry UID, namespace "exo".
      targetIncludes: [REGISTRY_EXO_UID],
      materialized: [REGISTRY_EXO_UID],
      exoDescriptor: { uid: REGISTRY_EXO_UID, namespace: "exo" },
    });
    await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
    const result = await mgr.reconcileToLocal();
    // Pre-fix: hardcoded TS_FLOOR_AS_UID_EXO injected → floor "missing" → modal
    // → outcome "reconciled". Post-fix: namespace "exo" satisfies the floor.
    expect(result.outcome).toBe("no-divergence");
  });

  it("#3558 sibling (revert-verify) — still detects divergence when $exo floor is genuinely absent", async () => {
    const { mgr, localDataStore, confirmGate } = setup({
      targetUid: "target",
      sourceUid: null,
      targetIncludes: [REGISTRY_EXO_UID],
      materialized: [], // $exo NOT mounted at all — a real divergence.
      exoDescriptor: { uid: REGISTRY_EXO_UID, namespace: "exo" },
    });
    await localDataStore.save({ activeProfileUid: "target", _switchInProgress: false });
    confirmGate.approve = false; // decline → no applyProfile side effects.
    const result = await mgr.reconcileToLocal();
    // The namespace reconciliation must NOT suppress a legitimately-missing floor.
    expect(result.outcome).toBe("declined");
  });

  // === #D2 (GUI-BDD-CI Ф3, node c470f71d) — reconcile-preview removal-delta
  // must equal the actual apply mount-delta ===
  // GUI-smoke found the reconcile modal showing «Assetspaces to remove: (none)»
  // while the subsequent apply unmounted a personal AssetSpace (privacy-boundary
  // surprise). Root cause: the reconcile preview keyed "materialized" on
  // `gitOps.readGitmodulesPaths()` (a `.gitmodules`-only scan), but the apply
  // path (`applyProfile`/`applyProfileViaRest`) keys it on the on-disk
  // descriptor-folder scan (`allInfos.map(folderName)`). A folder present on
  // disk but ABSENT from `.gitmodules` — exactly what the desktop git-free REST
  // mount (#3567) produces — was invisible to the preview yet still torn down by
  // the apply. The fix aligns the preview scan with the apply scan.
  it("#D2 — reports an on-disk AssetSpace folder ABSENT from .gitmodules as a removal (preview == apply delta)", async () => {
    const { mgr, localDataStore, confirmGate, gitOps } = setup({
      targetUid: "target",
      sourceUid: null,
      // Active profile includes ONLY the floor — the personal AssetSpace
      // ("ems-uid", standing in for exoas-my) is NOT in the effective set.
      targetIncludes: [
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
      // ems-uid IS materialized on disk (folder present) — like a personal
      // AssetSpace mounted via the desktop git-free REST path.
      materialized: [
        "ems-uid",
        TS_FLOOR_AS_UID_EXO,
        TS_FLOOR_AS_UID_EXOCMD,
        TS_FLOOR_AS_UID_SHARED_IDENTITIES,
      ],
    });
    // Reproduce the production divergence: the on-disk folder exists (setup put
    // it in `fsFolders`), but its `.gitmodules` stanza is ABSENT — the exact
    // state a desktop git-free REST mount leaves when `.gitmodules` is written
    // via `vault.adapter` and `gitOps.readGitmodulesPaths()` (Node fs) doesn't
    // see it (or `.gitmodules` is unreadable / empty). Strip it from the git
    // scan ONLY; the working-tree folder stays present.
    gitOps.gitmodulesPaths.delete("assetspaces/kitelev/exoas-ems");

    await localDataStore.save({
      activeProfileUid: "target",
      _switchInProgress: false,
    });
    // Decline → assert the PREVIEW only, no apply side effects.
    confirmGate.approve = false;

    const result = await mgr.reconcileToLocal();

    // Pre-fix (.gitmodules-only scan): ems-uid invisible → extra = [] →
    // outcome "no-divergence", confirmGate never called → preview misleads
    // ("remove none"). Post-fix (on-disk descriptor-folder scan, matching the
    // apply path): ems-uid surfaces → divergence → modal lists it for removal.
    expect(result.outcome).toBe("declined");
    expect(confirmGate.lastPlan).not.toBeNull();
    const tornDown = confirmGate.lastPlan!.assetSpacesBeingTornDown.map(
      (a) => a.asUid,
    );
    expect(tornDown).toContain("ems-uid");
    // The preview now reflects the real on-disk content that the apply removes
    // (folder has files → non-zero count, never a phantom "(none)" entry).
    const emsEntry = confirmGate.lastPlan!.assetSpacesBeingTornDown.find(
      (a) => a.asUid === "ems-uid",
    );
    expect(emsEntry?.fileCount).toBeGreaterThan(0);
  });
});
