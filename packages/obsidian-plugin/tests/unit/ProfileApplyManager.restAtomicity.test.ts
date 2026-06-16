/**
 * ProfileApplyManager — REST apply partial-failure atomicity (Issue #3548).
 *
 * Since the git-elim cutover (#3567) `applyProfile` routes BOTH platforms
 * through the REST path (`applyProfileViaRest` → `runRestApplyMutation`) whenever
 * `restMount`/`restMountFactory` is wired — which production does
 * unconditionally (ExocortexPlugin wires `restMountFactory` with no platform
 * gate). So the REST path is the SOLE production atomicity surface; the git
 * path (`runApplyMutation`) is a legacy/test-only fallback.
 *
 * This suite pins the partial-failure hardening:
 *
 *   1. MOUNT-BEFORE-UNMOUNT — materialize the new set FIRST; only tear down the
 *      old set once every new AssetSpace is confirmed present. On a mount
 *      failure mid-loop nothing has been unmounted yet → the to-destroy set is
 *      untouched (zero data loss).
 *   2. ROLLBACK on mount-failure — the freshly-mounted AssetSpaces (incl. the
 *      partial failed one) are unmounted, restoring the EXACT pre-apply
 *      mount-state. `activeProfileUid` stays at the pre-apply value.
 *   3. uncommittedGuard PARITY — when wired (desktop git-backed vault) a dirty
 *      to-destroy AssetSpace aborts before any mutation (Vision Lock #5 parity);
 *      when git is unavailable (mobile / non-git desktop vault) the check
 *      degrades gracefully (proceeds — the reorder provides the guarantee).
 *   4. UNMOUNT-failure after all mounts → SUPERSET (target ∪ not-yet-removed) —
 *      never data loss; re-running Apply reconciles.
 *   5. Actionable user-facing failure message on the failure path.
 *
 * Each test is a revert-verify control: with the previous unmount-then-mount,
 * no-rollback ordering the atomicity assertions FAIL; with the fix they PASS.
 *
 * Fakes mirror ProfileApplyManager.restApply.test.ts: in-memory vault.adapter,
 * production-shape AssetSpace ABox frontmatter (`_source` derives back to the
 * folder via derivePath), a FakeLocalDataStore preserving the dual AC14 slots.
 */
import type { App, TFile } from "obsidian";
import type { ApplyPlan, IConfirmGate } from "exocortex";

import {
  ProfileApplyManager,
  UncommittedChangesAbortError,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";
import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../src/infrastructure/adapters/ProfileOnloadWiring";

// ─── Fakes ────────────────────────────────────────────────────────────────

interface FakeFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
}

function makeFakeApp(files: FakeFile[]): {
  app: App;
  fsFolders: Map<string, { files: string[]; folders: string[] }>;
} {
  const fsFiles = new Map<string, string>();
  const fsFolders = new Map<string, { files: string[]; folders: string[] }>();
  const tfiles: TFile[] = files.map(
    (f) => ({ path: f.path, basename: f.basename }) as unknown as TFile,
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
        list: async (dir: string) =>
          fsFolders.get(dir) ?? { files: [], folders: [] },
      },
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = frontmatterByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  } as unknown as App;
  return { app, fsFolders };
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

interface FakeLocalState {
  activeProfileUid: string | null;
  _switchInProgress: boolean;
}

class FakeLocalDataStore {
  private state: FakeLocalState = {
    activeProfileUid: null,
    _switchInProgress: false,
  };
  setActiveProfileUid(uid: string | null): void {
    this.state.activeProfileUid = uid;
  }
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

class FakeConfirmGate implements IConfirmGate {
  approve = true;
  lastPlan: ApplyPlan | null = null;
  async confirmApply(plan: ApplyPlan): Promise<boolean> {
    this.lastPlan = plan;
    return this.approve;
  }
}

/**
 * REST mount fake with an ordered op log + failure injection. Mirrors the real
 * RestAssetSpaceMount contract closely enough for atomicity testing:
 *   - mount: appends the folder to `fsFolders` (so a subsequent
 *     `derivePhysicallyMaterializedAsUids` sees it present) THEN records.
 *     A failed mount may leave a partial folder (mirrors files-then-.gitmodules).
 *   - unmount: removes the folder from `fsFolders` (idempotent — no-op if absent).
 */
class FakeRestMount {
  ops: Array<{ op: "mount" | "unmount"; path: string }> = [];
  mounted: string[] = [];
  unmounted: string[] = [];
  /** submodulePath → throw on mount. */
  failMountOn = new Set<string>();
  /** submodulePath → throw on unmount. */
  failUnmountOn = new Set<string>();
  /** Whether a failed mount leaves a partial folder behind (real-world). */
  partialFolderOnFailedMount = true;

  constructor(
    private readonly fsFolders: Map<
      string,
      { files: string[]; folders: string[] }
    >,
  ) {}

  async mount(gitUrl: string, submodulePath: string, ref: string) {
    if (this.failMountOn.has(submodulePath)) {
      if (this.partialFolderOnFailedMount) {
        // Partial materialize: files written, folder exists, but the mount
        // threw before the `.gitmodules` append completed.
        this.fsFolders.set(submodulePath, {
          files: [`${submodulePath}/partial.md`],
          folders: [],
        });
      }
      this.ops.push({ op: "mount", path: submodulePath });
      throw new Error(`mount failed: ${submodulePath} (injected)`);
    }
    this.fsFolders.set(submodulePath, {
      files: [`${submodulePath}/f1.md`],
      folders: [],
    });
    this.ops.push({ op: "mount", path: submodulePath });
    this.mounted.push(submodulePath);
    return { sha: "abc1234", fileCount: 1 };
  }

  async unmount(submodulePath: string): Promise<void> {
    if (this.failUnmountOn.has(submodulePath)) {
      this.ops.push({ op: "unmount", path: submodulePath });
      throw new Error(`unmount failed: ${submodulePath} (injected)`);
    }
    this.fsFolders.delete(submodulePath);
    this.ops.push({ op: "unmount", path: submodulePath });
    this.unmounted.push(submodulePath);
  }
}

/** uncommittedGuard fake — configurable clean/dirty/throwing. */
class FakeUncommittedGuard {
  dirtyPaths = new Set<string>();
  throwOnCheck = false;
  /** When set, `check` throws this exact message (to test error classification). */
  throwMessage = "fatal: not a git repository (injected)";
  checkCalls = 0;
  async check(
    toDestroy: ReadonlyArray<{ asUid: string; submodulePath: string }>,
  ): Promise<{
    clean: boolean;
    affectedFiles: ReadonlyArray<{
      asUid: string;
      submodulePath: string;
      files: ReadonlyArray<string>;
    }>;
  }> {
    this.checkCalls++;
    if (this.throwOnCheck) {
      // Default mirrors a non-git vault: `git status` → `fatal: not a git
      // repository`. Override `throwMessage` to test a non-git-unavailable error.
      throw new Error(this.throwMessage);
    }
    const affected = toDestroy
      .filter((t) => this.dirtyPaths.has(t.submodulePath))
      .map((t) => ({
        asUid: t.asUid,
        submodulePath: t.submodulePath,
        files: [`${t.submodulePath}/dirty.md`],
      }));
    return { clean: affected.length === 0, affectedFiles: affected };
  }
}

// ─── AssetSpace fixtures ────────────────────────────────────────────────────

const TS_FLOOR = [
  { uid: TS_FLOOR_AS_UID_EXO, folder: "assetspaces/kitelev/exoas-exo" },
  { uid: TS_FLOOR_AS_UID_EXOCMD, folder: "assetspaces/kitelev/exoas-exocmd" },
  {
    uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES,
    folder: "assetspaces/kitelev/exoas-shared-identities",
  },
];
const EXTRA = [
  { uid: "ems-uid", folder: "assetspaces/kitelev/exoas-ems" },
  { uid: "kpc-uid", folder: "assetspaces/kitelev/exoas-kpc" },
  { uid: "lit-uid", folder: "assetspaces/kitelev/exoas-lit" },
  { uid: "pn-uid", folder: "assetspaces/kitelev/exoas-pn" },
];
const ALL_AS = [...TS_FLOOR, ...EXTRA];
const ALL_FLOOR_UIDS = TS_FLOOR.map((f) => f.uid);
const folderOf = (uid: string) =>
  ALL_AS.find((a) => a.uid === uid)?.folder ?? `assetspaces/kitelev/${uid}`;

interface SetupOpts {
  targetIncludes: string[];
  materialized: string[];
  /** Pre-apply active profile (defaults to a "source" sentinel). */
  activeProfileUid?: string | null;
  /** Wire the uncommittedGuard (desktop git-backed). Default: not wired. */
  wireUncommittedGuard?: boolean;
}

function setup(opts: SetupOpts) {
  const files: FakeFile[] = [
    {
      path: "profiles/target.md",
      basename: "target",
      frontmatter: {
        exo__Asset_uid: "target",
        exo__Asset_label: "Target Profile",
        exo__Instance_class: ["[[exo__Profile]]"],
      },
    },
    ...ALL_AS.map((as) => {
      const ns = as.folder.split("/").pop();
      return {
        path: `${as.folder}/${as.uid}.md`,
        basename: as.uid,
        frontmatter: {
          exo__Asset_uid: as.uid,
          exo__Asset_label: ns,
          exo__Instance_class: ["[[exo__AssetSpace]]"],
          exo__AssetSpace_source: `https://github.com/${as.folder.replace("assetspaces/", "")}`,
          exo__AssetSpace_namespace: ns,
        },
      };
    }),
  ];

  const { app, fsFolders } = makeFakeApp(files);
  for (const uid of opts.materialized) {
    const folder = folderOf(uid);
    fsFolders.set(folder, {
      files: [`${folder}/file1.md`, `${folder}/file2.md`],
      folders: [],
    });
  }

  const resolver = new FakeResolver(
    new Map<string, ProfileResolution>([
      [
        "target",
        { uid: "target", includes: opts.targetIncludes, label: "Target Profile" },
      ],
    ]),
  );
  const indexer = new FakeIndexer();
  const settingsStore = new FakeSettingsStore();
  const lockMgr = new PluginLockManager({ app });
  const localDataStore = new FakeLocalDataStore();
  localDataStore.setActiveProfileUid(
    opts.activeProfileUid === undefined ? "source" : opts.activeProfileUid,
  );
  const confirmGate = new FakeConfirmGate();
  const restMount = new FakeRestMount(fsFolders);
  const uncommittedGuard = new FakeUncommittedGuard();
  const notifyCalls: string[] = [];

  const mgr = new ProfileApplyManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: indexer,
    settingsStore,
    notify: (m) => notifyCalls.push(m),
    /* eslint-disable @typescript-eslint/no-explicit-any */
    confirmGate,
    localDataStore: localDataStore as any,
    restMount: restMount as any,
    uncommittedGuard: (opts.wireUncommittedGuard
      ? uncommittedGuard
      : undefined) as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
  return {
    mgr,
    indexer,
    localDataStore,
    confirmGate,
    restMount,
    uncommittedGuard,
    notifyCalls,
    app,
    fsFolders,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ProfileApplyManager REST apply atomicity (#3548)", () => {
  describe("mount-before-unmount ordering", () => {
    it("mounts the new set BEFORE unmounting the old set (revert-verify)", async () => {
      const { mgr, restMount } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
      });

      await mgr.applyProfileViaRest("target");

      // ems mounted, kpc unmounted.
      expect(restMount.mounted).toEqual([folderOf("ems-uid")]);
      expect(restMount.unmounted).toEqual([folderOf("kpc-uid")]);
      // Ordering invariant: the mount happens before the unmount.
      const mountIdx = restMount.ops.findIndex((o) => o.op === "mount");
      const unmountIdx = restMount.ops.findIndex((o) => o.op === "unmount");
      expect(mountIdx).toBeGreaterThanOrEqual(0);
      expect(unmountIdx).toBeGreaterThanOrEqual(0);
      // Pre-fix (unmount-then-mount): unmountIdx < mountIdx → FAILS here.
      expect(mountIdx).toBeLessThan(unmountIdx);
    });
  });

  describe("mount-failure → rollback to exact pre-apply set (zero data loss)", () => {
    it("never tears down the to-destroy set when a mount fails mid-loop (revert-verify)", async () => {
      // toMaterialize = [ems, lit]; toDestroy = [kpc]. Fail on the 2nd mount.
      const { mgr, restMount, localDataStore, fsFolders } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid", "lit-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
      });
      restMount.failMountOn.add(folderOf("lit-uid"));

      await expect(mgr.applyProfileViaRest("target")).rejects.toThrow(
        /mount failed/,
      );

      // CORE INVARIANT (flips pre↔post fix): the to-destroy AssetSpace must
      // NEVER be unmounted on a mount-failure. Pre-fix (unmount-first) kpc is
      // gone → FAILS. Post-fix kpc is untouched → PASSES.
      expect(restMount.unmounted).not.toContain(folderOf("kpc-uid"));
      // kpc folder still on disk → still materialized (pre-apply state intact).
      expect(fsFolders.has(folderOf("kpc-uid"))).toBe(true);

      // The freshly-mounted set is rolled back → exact pre-apply mount-state.
      expect(fsFolders.has(folderOf("ems-uid"))).toBe(false);
      expect(fsFolders.has(folderOf("lit-uid"))).toBe(false);

      // Active profile unchanged + in-progress flag cleared.
      expect(localDataStore.getActiveProfileUid()).toBe("source");
      expect(localDataStore.isSwitchInProgress()).toBe(false);
    });

    it("rolls back the partial folder of the failed mount itself", async () => {
      const { mgr, restMount, fsFolders } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
      });
      // The single to-materialize mount fails, leaving a partial folder.
      restMount.failMountOn.add(folderOf("ems-uid"));
      restMount.partialFolderOnFailedMount = true;

      await expect(mgr.applyProfileViaRest("target")).rejects.toThrow(
        /mount failed/,
      );

      // The partial folder left by the failed mount is cleaned up by rollback.
      expect(fsFolders.has(folderOf("ems-uid"))).toBe(false);
      // kpc (to-destroy) untouched.
      expect(restMount.unmounted).not.toContain(folderOf("kpc-uid"));
      expect(fsFolders.has(folderOf("kpc-uid"))).toBe(true);
    });

    it("surfaces an actionable rollback failure message", async () => {
      const { mgr, restMount, notifyCalls } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
      });
      restMount.failMountOn.add(folderOf("ems-uid"));

      await expect(mgr.applyProfileViaRest("target")).rejects.toThrow();

      const msg = notifyCalls.find((m) => /re-run/i.test(m));
      expect(msg).toBeDefined();
      // Rolled-back path → reassures the previous profile is intact.
      expect(msg).toMatch(/previous profile|rolled back|no changes/i);
    });
  });

  describe("unmount-failure after all mounts → superset, no data loss", () => {
    it("keeps the target set mounted and surfaces an actionable message", async () => {
      // toMaterialize = [ems]; toDestroy = [kpc, lit]. Unmount fails on lit.
      const { mgr, restMount, notifyCalls, fsFolders } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid", "lit-uid"],
      });
      restMount.failUnmountOn.add(folderOf("lit-uid"));

      await expect(mgr.applyProfileViaRest("target")).rejects.toThrow(
        /unmount failed/,
      );

      // Target AssetSpace mounted (all mounts completed before any unmount).
      expect(restMount.mounted).toContain(folderOf("ems-uid"));
      expect(fsFolders.has(folderOf("ems-uid"))).toBe(true);
      // kpc unmounted (succeeded); lit still present (its unmount threw) — NOT
      // a data loss: lit was slated for removal; re-running Apply reconciles.
      expect(restMount.unmounted).toContain(folderOf("kpc-uid"));
      expect(fsFolders.has(folderOf("lit-uid"))).toBe(true);
      // The newly-mounted set is NOT rolled back (mounts completed).
      expect(restMount.unmounted).not.toContain(folderOf("ems-uid"));

      const msg = notifyCalls.find((m) => /re-run/i.test(m));
      expect(msg).toBeDefined();
    });
  });

  describe("uncommittedGuard parity (Vision Lock #5)", () => {
    it("aborts before any mutation when a to-destroy AssetSpace is dirty (git-backed)", async () => {
      const { mgr, restMount, uncommittedGuard, localDataStore } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
        wireUncommittedGuard: true,
      });
      uncommittedGuard.dirtyPaths.add(folderOf("kpc-uid"));

      await expect(mgr.applyProfileViaRest("target")).rejects.toThrow(
        UncommittedChangesAbortError,
      );

      // Revert-verify: pre-fix the REST path never calls the guard → no abort →
      // it proceeds to mount/unmount → this `rejects(UncommittedChangesAbortError)`
      // FAILS. Post-fix the guard is consulted → abort BEFORE any mutation.
      expect(uncommittedGuard.checkCalls).toBe(1);
      expect(restMount.mounted).toEqual([]);
      expect(restMount.unmounted).toEqual([]);
      expect(localDataStore.getActiveProfileUid()).toBe("source");
    });

    it("proceeds when the to-destroy set is clean (git-backed, parity happy path)", async () => {
      const { mgr, restMount, uncommittedGuard } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
        wireUncommittedGuard: true,
      });

      await mgr.applyProfileViaRest("target");

      expect(uncommittedGuard.checkCalls).toBe(1);
      expect(restMount.mounted).toEqual([folderOf("ems-uid")]);
      expect(restMount.unmounted).toEqual([folderOf("kpc-uid")]);
    });

    it("degrades gracefully when git is unavailable (mobile / non-git vault)", async () => {
      const { mgr, restMount, uncommittedGuard } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
        wireUncommittedGuard: true,
      });
      uncommittedGuard.throwOnCheck = true; // `fatal: not a git repository`

      // A git-unavailable check must NOT hard-fail the apply — the mount-before
      // -unmount reorder provides the atomicity guarantee on git-free vaults.
      await expect(mgr.applyProfileViaRest("target")).resolves.toBeUndefined();
      expect(restMount.mounted).toEqual([folderOf("ems-uid")]);
      expect(restMount.unmounted).toEqual([folderOf("kpc-uid")]);
    });

    it("fails loud on an UNEXPECTED guard error (indeterminate cleanliness — no silent proceed)", async () => {
      const { mgr, restMount, uncommittedGuard, localDataStore } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
        wireUncommittedGuard: true,
      });
      // NOT a git-unavailable signature — e.g. transient index.lock / guard bug.
      uncommittedGuard.throwOnCheck = true;
      uncommittedGuard.throwMessage =
        "fatal: Unable to create '.git/index.lock': File exists";

      // Cleanliness is indeterminate → per the zero-loss mandate we must NOT
      // silently proceed (a to-destroy AssetSpace could hold uncommitted edits).
      await expect(mgr.applyProfileViaRest("target")).rejects.toThrow(/index\.lock/);
      // No mutation occurred (failed before the mount/unmount loops).
      expect(restMount.mounted).toEqual([]);
      expect(restMount.unmounted).toEqual([]);
      expect(localDataStore.getActiveProfileUid()).toBe("source");
    });

    it("does not require uncommittedGuard to be wired (mobile path)", async () => {
      const { mgr, restMount } = setup({
        targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
        materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
        // wireUncommittedGuard omitted → undefined (mobile reality).
      });

      await mgr.applyProfileViaRest("target");
      expect(restMount.mounted).toEqual([folderOf("ems-uid")]);
      expect(restMount.unmounted).toEqual([folderOf("kpc-uid")]);
    });
  });
});
