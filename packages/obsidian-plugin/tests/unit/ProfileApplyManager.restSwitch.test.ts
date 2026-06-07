/**
 * ProfileApplyManager.restSwitchProfile() — RFC 01a83de8 Phase 3 T2.
 *
 * Mobile-capable profile switch via REST/tarball mount/unmount (no git binary,
 * staging, cache, or git commit). Visibility is mount-state: an AssetSpace is
 * "active" iff its derived folder exists on disk.
 *
 * Coverage:
 *   1. Happy path — diff (folder-exists) drives unmount(toDestroy) +
 *      mount(toMaterialize); persists activeProfile + Knowledge mirror; RDF
 *      re-index with the effective set.
 *   2. Revert-verify control — a target already in mount-state ⇒ no-op (soft
 *      switch only, no mount/unmount).
 *   3. R24 TS-floor — target excluding a floor AS throws before any mutation.
 *   4. ConfirmGate decline → HardSwitchAbortedByUser, no mount/unmount.
 *   5. Not wired — missing restMount throws a clear error.
 *   6. Dispatch — applyProfile on mobile delegates to
 *      restSwitchProfile (REST path; gitOps never touched).
 *
 * Fakes mirror the desktop hardSwitch harness: in-memory vault.adapter
 * (`exists` true for known files/folders), production-shape AssetSpace ABox
 * frontmatter (`_source` derives back to the folder via derivePath), and a
 * FakeLocalDataStore preserving the dual AC14 slots on partial save.
 */
import { Platform } from "obsidian";
import type { App, TFile } from "obsidian";
import type { HardSwitchPlan, IConfirmGate } from "exocortex";

import {
  ProfileApplyManager,
  HardSwitchAbortedByUser,
  TsFloorViolationError,
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
  lastPlan: HardSwitchPlan | null = null;
  async confirmHardSwitch(plan: HardSwitchPlan): Promise<boolean> {
    this.lastPlan = plan;
    return this.approve;
  }
}

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

class FakeGitOps {
  calls: string[] = [];
  async readGitmodulesPaths(): Promise<Set<string>> {
    this.calls.push("readGitmodulesPaths");
    return new Set();
  }
  async submoduleAdd(): Promise<void> {
    this.calls.push("submoduleAdd");
  }
  async submoduleDeinit(): Promise<void> {
    this.calls.push("submoduleDeinit");
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

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
];
const ALL_AS = [...TS_FLOOR, ...EXTRA];

interface SetupOpts {
  /** AS UIDs the target profile declares (ontology form auto-derived). */
  targetIncludes: string[];
  /** AS UIDs currently materialised (folder exists on disk). */
  materialized: string[];
  /** Whether to wire the REST mount (default true). */
  wireRestMount?: boolean;
  /** Whether to also wire gitOps (to assert it is NOT used). */
  wireGitOps?: boolean;
  /** Wire a fresh-PAT factory (returns `factoryMount`) preferred over capture. */
  wireRestMountFactory?: boolean;
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
  // Materialised AS == folder exists on disk (with a couple of files for the plan).
  for (const uid of opts.materialized) {
    const folder = ALL_AS.find((a) => a.uid === uid)?.folder;
    if (folder) {
      fsFolders.set(folder, {
        files: [`${folder}/file1.md`, `${folder}/file2.md`],
        folders: [],
      });
    }
  }

  const resolver = new FakeResolver(
    new Map<string, ProfileResolution>([
      [
        "target",
        {
          uid: "target",
          // RFC 01a83de8 Phase 2 — `_includes` declares AssetSpace UIDs directly
          // (Ontology→AS translation removed in Phase 3 T3b-cleanup).
          includes: opts.targetIncludes,
          label: "Target Profile",
        },
      ],
    ]),
  );
  const indexer = new FakeIndexer();
  const settingsStore = new FakeSettingsStore();
  const lockMgr = new PluginLockManager({ app });
  const localDataStore = new FakeLocalDataStore();
  const confirmGate = new FakeConfirmGate();
  const restMount = new FakeRestMount();
  const factoryMount = new FakeRestMount();
  const gitOps = new FakeGitOps();

  const mgr = new ProfileApplyManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: indexer,
    settingsStore,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    confirmGate,
    localDataStore: localDataStore as any,
    restMount: (opts.wireRestMount === false ? undefined : restMount) as any,
    restMountFactory: opts.wireRestMountFactory
      ? async () => factoryMount as any
      : undefined,
    gitOps: (opts.wireGitOps ? gitOps : undefined) as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
  return {
    mgr,
    indexer,
    localDataStore,
    confirmGate,
    restMount,
    factoryMount,
    gitOps,
  };
}

const ALL_FLOOR_UIDS = TS_FLOOR.map((f) => f.uid);

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ProfileApplyManager.restSwitchProfile", () => {
  it("unmounts to-destroy + mounts to-materialize, persists profile + re-indexes", async () => {
    // Currently materialised: floors + kpc. Target: floors + ems (NOT kpc).
    const { mgr, indexer, localDataStore, restMount } = setup({
      targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
      materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
    });

    await mgr.restSwitchProfile("target");

    // kpc unmounted (was materialised, not in target).
    expect(restMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    // ems mounted (in target, not materialised).
    expect(restMount.mounted.map((m) => m.submodulePath)).toEqual([
      "assetspaces/kitelev/exoas-ems",
    ]);
    expect(restMount.mounted[0].gitUrl).toBe(
      "https://github.com/kitelev/exoas-ems",
    );

    // Active profile persisted as the last-applied cache (single slot).
    expect(localDataStore.getActiveProfileUid()).toBe("target");
    expect(localDataStore.isSwitchInProgress()).toBe(false);

    // RDF re-index fired once. RFC 01a83de8 Phase 3 T3b — the query-time
    // soft-filter was removed, so the effective set is no longer threaded
    // through refresh(); the materialised mount-state (asserted above via
    // restMount.mounted/unmounted: ems mounted, kpc not) is the visibility
    // source.
    expect(indexer.refreshCalls).toBe(1);
  });

  it("no-ops to a reindex-only path when mount-state already matches (control)", async () => {
    // Target == currently materialised (floors only) ⇒ no mount/unmount;
    // restSwitchProfile falls through to the reindex-only path.
    const { mgr, restMount, indexer } = setup({
      targetIncludes: ALL_FLOOR_UIDS,
      materialized: ALL_FLOOR_UIDS,
    });

    await expect(mgr.restSwitchProfile("target")).resolves.toBeUndefined();

    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
    // No mount-state mutation, but the reindex-only fall-through still triggers
    // a single full-vault reindex.
    expect(indexer.refreshCalls).toBe(1);
  });

  it("throws TsFloorViolationError before any mount/unmount when target excludes a floor AS", async () => {
    const { mgr, restMount } = setup({
      targetIncludes: ["ems-uid"], // excludes all floor AS
      materialized: [...ALL_FLOOR_UIDS, "ems-uid"],
    });
    await expect(mgr.restSwitchProfile("target")).rejects.toThrow(
      TsFloorViolationError,
    );
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
  });

  it("aborts with HardSwitchAbortedByUser when confirmGate declines — no mutation", async () => {
    const { mgr, confirmGate, restMount } = setup({
      targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
      materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
    });
    confirmGate.approve = false;
    await expect(mgr.restSwitchProfile("target")).rejects.toThrow(
      HardSwitchAbortedByUser,
    );
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
  });

  it("throws a clear error when neither restMount nor factory is wired", async () => {
    const { mgr } = setup({
      targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
      materialized: ALL_FLOOR_UIDS,
      wireRestMount: false,
    });
    await expect(mgr.restSwitchProfile("target")).rejects.toThrow(
      /dependencies not wired/,
    );
  });

  it("prefers the fresh-PAT factory mount over the onload-captured one (Issue #3382)", async () => {
    const { mgr, restMount, factoryMount } = setup({
      targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
      materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
      wireRestMountFactory: true,
    });

    await mgr.restSwitchProfile("target");

    // Factory mount did the work…
    expect(factoryMount.mounted.map((m) => m.submodulePath)).toEqual([
      "assetspaces/kitelev/exoas-ems",
    ]);
    expect(factoryMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    // …and the onload-captured mount was NOT used.
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
  });
});

describe("applyProfile dispatch (mobile → REST)", () => {
  const original = Platform.isMobile;
  afterEach(() => {
    (Platform as unknown as { isMobile: boolean }).isMobile = original;
  });

  it("delegates to restSwitchProfile on mobile (gitOps never touched)", async () => {
    (Platform as unknown as { isMobile: boolean }).isMobile = true;
    const { mgr, restMount, gitOps } = setup({
      targetIncludes: [...ALL_FLOOR_UIDS, "ems-uid"],
      materialized: [...ALL_FLOOR_UIDS, "kpc-uid"],
      wireGitOps: true,
    });

    await mgr.applyProfile("target");

    // REST path exercised…
    expect(restMount.mounted.map((m) => m.submodulePath)).toEqual([
      "assetspaces/kitelev/exoas-ems",
    ]);
    expect(restMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    // …and the git-binary path was NOT used.
    expect(gitOps.calls).toEqual([]);
  });
});
