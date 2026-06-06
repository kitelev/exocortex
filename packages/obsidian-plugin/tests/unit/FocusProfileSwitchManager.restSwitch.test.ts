/**
 * FocusProfileSwitchManager.restSwitchProfile() — RFC 01a83de8 Phase 3 T2.
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
 *   6. Dispatch — hardSwitchKnowledgeProfile on mobile delegates to
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
  FocusProfileSwitchManager,
  HardSwitchAbortedByUser,
  TsFloorViolationError,
  type IProfileResolver,
  type IRdfIndexer,
  type ISettingsStore,
  type ProfileResolution,
  type SwitchSettings,
} from "../../src/infrastructure/adapters/FocusProfileSwitchManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";
import {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
} from "../../src/infrastructure/adapters/FocusProfileOnloadWiring";

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
        exo__Instance_class: ["[[exo__FocusProfile]]"],
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
          exo__AssetSpace_containsOntology: [`[[ontology-${as.uid}]]`],
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
          includes: opts.targetIncludes.map((u) => `ontology-${u}`),
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

  const mgr = new FocusProfileSwitchManager({
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

describe("FocusProfileSwitchManager.restSwitchProfile", () => {
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

    // Active profile persisted (+ Knowledge mirror).
    expect(localDataStore.getActiveProfileUid()).toBe("target");
    expect(localDataStore.getActiveKnowledgeProfileUid()).toBe("target");
    expect(localDataStore.isSwitchInProgress()).toBe(false);

    // RDF re-index with the effective set (floors + ems, NOT kpc).
    expect(indexer.refreshCalls.length).toBe(1);
    const eff = indexer.refreshCalls[0];
    expect(eff.has("ems-uid")).toBe(true);
    expect(eff.has("kpc-uid")).toBe(false);
    for (const f of ALL_FLOOR_UIDS) expect(eff.has(f)).toBe(true);
  });

  it("no-ops to a soft switch when mount-state already matches (control)", async () => {
    // Target == currently materialised (floors only) ⇒ no mount/unmount;
    // restSwitchProfile falls through to the soft-switch (RDF filter) path.
    const { mgr, restMount, indexer } = setup({
      targetIncludes: ALL_FLOOR_UIDS,
      materialized: ALL_FLOOR_UIDS,
    });

    await expect(mgr.restSwitchProfile("target")).resolves.toBeUndefined();

    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
    // No mount-state mutation, but the soft-switch still refreshes the RDF
    // filter once (the coexisting visibility source, RFC v9 EV4).
    expect(indexer.refreshCalls.length).toBe(1);
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

describe("hardSwitchKnowledgeProfile dispatch (mobile → REST)", () => {
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

    await mgr.hardSwitchKnowledgeProfile("target");

    // REST path exercised…
    expect(restMount.mounted.map((m) => m.submodulePath)).toEqual([
      "assetspaces/kitelev/exoas-ems",
    ]);
    expect(restMount.unmounted).toEqual(["assetspaces/kitelev/exoas-kpc"]);
    // …and the git-binary path was NOT used.
    expect(gitOps.calls).toEqual([]);
  });
});
