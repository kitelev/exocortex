/**
 * ProfileApplyManager — «Undo last profile apply» (RFC 0002 §3.10, resolves
 * P15a).
 *
 * Exercises the REAL {@link PluginLocalDataStore} (in-memory vault.adapter) so
 * the `previousProfileUid` undo-target slot is persisted + read exactly as in
 * production, and a `FakeRestMount` that MUTATES the in-memory mount-state
 * (fsFolders) so sequential applies compute realistic mount diffs. This mirrors
 * the production REST apply path end-to-end:
 *
 *   - apply A from empty → records active=A, previous=null (no prior switch)
 *   - apply B from A      → records active=B, previous=A
 *   - undoLastApply()     → re-applies A → active=A, previous=B (toggle)
 *   - undoLastApply() with no recorded previous → NoPreviousProfileError
 *   - re-apply same profile → previous untouched
 *
 * Revert-verify: the toggle test fails if the success-save stops recording the
 * pre-apply profile as the undo target (see "revert-verify" annotation).
 */
import type { App, TFile } from "obsidian";
import type { ApplyPlan, IConfirmGate } from "exocortex";

import {
  ProfileApplyManager,
  NoPreviousProfileError,
  type IProfileResolver,
  type IRdfIndexer,
  type ProfileResolution,
} from "../../src/infrastructure/adapters/ProfileApplyManager";
import { PluginLockManager } from "../../src/infrastructure/adapters/PluginLockManager";
import { PluginLocalDataStore } from "../../src/infrastructure/adapters/PluginLocalDataStore";
import { PluginSettingsStoreAdapter } from "../../src/infrastructure/adapters/PluginSettingsStoreAdapter";
import { TS_FLOOR_AS_UID_EXO } from "../../src/infrastructure/adapters/ProfileOnloadWiring";

// ─── Fakes ────────────────────────────────────────────────────────────────

interface FakeFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
}

function makeFakeApp(
  files: FakeFile[],
  fsFolders: Map<string, { files: string[]; folders: string[] }>,
): App {
  const fsFiles = new Map<string, string>();
  const tfiles: TFile[] = files.map(
    (f) => ({ path: f.path, basename: f.basename }) as unknown as TFile,
  );
  const frontmatterByPath = new Map<string, Record<string, unknown>>();
  for (const f of files) frontmatterByPath.set(f.path, f.frontmatter);

  return {
    vault: {
      configDir: ".obsidian",
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
        // Lock release (PluginLockManager.deleteLock) + any folder teardown go
        // through `remove`; without it the lock file persists and a second
        // sequential apply in the same test would fail to acquire.
        remove: async (p: string) => {
          fsFiles.delete(p);
          fsFolders.delete(p);
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

class FakeConfirmGate implements IConfirmGate {
  approve = true;
  plans: ApplyPlan[] = [];
  async confirmApply(plan: ApplyPlan): Promise<boolean> {
    this.plans.push(plan);
    return this.approve;
  }
}

/** REST mount that MUTATES the shared fsFolders so mount-state diffs are real. */
class FakeRestMount {
  mounted: string[] = [];
  unmounted: string[] = [];
  constructor(
    private readonly fsFolders: Map<
      string,
      { files: string[]; folders: string[] }
    >,
  ) {}
  async mount(_gitUrl: string, submodulePath: string, _ref: string) {
    this.mounted.push(submodulePath);
    this.fsFolders.set(submodulePath, {
      files: [`${submodulePath}/f.md`],
      folders: [],
    });
    return { sha: "abc1234", fileCount: 1 };
  }
  async unmount(submodulePath: string): Promise<void> {
    this.unmounted.push(submodulePath);
    this.fsFolders.delete(submodulePath);
  }
}

// ─── AssetSpace descriptors ─────────────────────────────────────────────────

const EXO = {
  uid: TS_FLOOR_AS_UID_EXO,
  folder: "assetspaces/kitelev/exoas-exo",
  ns: "exo",
};
const EMS = {
  uid: "ems-uid",
  folder: "assetspaces/kitelev/exoas-ems",
  ns: "ems",
};
const KPC = {
  uid: "kpc-uid",
  folder: "assetspaces/kitelev/exoas-kpc",
  ns: "kpc",
};
const ALL_AS = [EXO, EMS, KPC];

async function setup() {
  const files: FakeFile[] = [
    {
      path: "profiles/A.md",
      basename: "A",
      frontmatter: {
        exo__Asset_uid: "A",
        exo__Asset_label: "Profile A",
        exo__Instance_class: ["[[exo__Profile]]"],
      },
    },
    {
      path: "profiles/B.md",
      basename: "B",
      frontmatter: {
        exo__Asset_uid: "B",
        exo__Asset_label: "Profile B",
        exo__Instance_class: ["[[exo__Profile]]"],
      },
    },
    ...ALL_AS.map((as) => ({
      path: `${as.folder}/${as.uid}.md`,
      basename: as.uid,
      frontmatter: {
        exo__Asset_uid: as.uid,
        exo__Asset_label: as.ns,
        exo__Instance_class: ["[[exo__AssetSpace]]"],
        exo__AssetSpace_source: `https://github.com/${as.folder.replace("assetspaces/", "")}`,
        exo__AssetSpace_namespace: as.ns,
      },
    })),
  ];

  // Initial mount-state: only the floor (exo) is materialised.
  const fsFolders = new Map<string, { files: string[]; folders: string[] }>();
  fsFolders.set(EXO.folder, { files: [`${EXO.folder}/x.md`], folders: [] });

  const app = makeFakeApp(files, fsFolders);

  const resolver = new FakeResolver(
    new Map<string, ProfileResolution>([
      ["A", { uid: "A", includes: [EXO.uid, EMS.uid], label: "Profile A" }],
      ["B", { uid: "B", includes: [EXO.uid, KPC.uid], label: "Profile B" }],
      // Profile C — DISTINCT identity, IDENTICAL effective set to A (LOW #1).
      ["C", { uid: "C", includes: [EXO.uid, EMS.uid], label: "Profile C" }],
    ]),
  );

  const localDataStore = new PluginLocalDataStore({
    app,
    path: ".obsidian/plugins/exocortex/data.local.json",
  });
  await localDataStore.init();
  const settingsStore = new PluginSettingsStoreAdapter(localDataStore);
  const indexer = new FakeIndexer();
  const confirmGate = new FakeConfirmGate();
  const restMount = new FakeRestMount(fsFolders);
  const lockMgr = new PluginLockManager({ app });

  const mgr = new ProfileApplyManager({
    app,
    lockMgr,
    resolver,
    rdfIndexer: indexer,
    settingsStore,
    confirmGate,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    localDataStore: localDataStore as any,
    restMount: restMount as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
    notify: () => undefined,
  });

  return { mgr, localDataStore, restMount, confirmGate, indexer };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ProfileApplyManager — undo target recording", () => {
  it("first apply (from empty) records no undo target", async () => {
    const { mgr, localDataStore } = await setup();
    await mgr.applyProfile("A");
    expect(localDataStore.getActiveProfileUid()).toBe("A");
    expect(localDataStore.getPreviousProfileUid()).toBeNull();
    expect(mgr.getUndoTargetProfileUid()).toBeNull();
  });

  it("second apply records the previously-active profile as the undo target", async () => {
    const { mgr, localDataStore } = await setup();
    await mgr.applyProfile("A");
    await mgr.applyProfile("B");
    expect(localDataStore.getActiveProfileUid()).toBe("B");
    expect(localDataStore.getPreviousProfileUid()).toBe("A");
    expect(mgr.getUndoTargetProfileUid()).toBe("A");
  });

  it("re-applying the SAME profile leaves the undo target untouched", async () => {
    const { mgr, localDataStore } = await setup();
    await mgr.applyProfile("A");
    await mgr.applyProfile("B"); // previous = A
    await mgr.applyProfile("B"); // no-op-ish re-apply; previous must stay A
    expect(localDataStore.getActiveProfileUid()).toBe("B");
    expect(localDataStore.getPreviousProfileUid()).toBe("A");
  });
});

describe("ProfileApplyManager.undoLastApply", () => {
  it("re-applies the previous profile and toggles the undo target", async () => {
    const { mgr, localDataStore, restMount } = await setup();
    await mgr.applyProfile("A"); // mount ems
    await mgr.applyProfile("B"); // unmount ems, mount kpc; previous=A
    restMount.mounted.length = 0;
    restMount.unmounted.length = 0;

    await mgr.undoLastApply(); // back to A

    // Re-applied A → ems mounted, kpc unmounted (mount-state strict replace).
    expect(restMount.mounted).toContain(EMS.folder);
    expect(restMount.unmounted).toContain(KPC.folder);
    expect(localDataStore.getActiveProfileUid()).toBe("A");
    // revert-verify: the toggle (previous becomes the profile we undid FROM)
    // only holds because the apply success-save records the pre-apply profile
    // as the undo target. If that recording is removed, previous stays "A" and
    // this assertion fails.
    expect(localDataStore.getPreviousProfileUid()).toBe("B");
  });

  it("a second undo toggles back (single-level undo/redo)", async () => {
    const { mgr, localDataStore } = await setup();
    await mgr.applyProfile("A");
    await mgr.applyProfile("B"); // previous=A
    await mgr.undoLastApply(); // active=A, previous=B
    await mgr.undoLastApply(); // active=B, previous=A
    expect(localDataStore.getActiveProfileUid()).toBe("B");
    expect(localDataStore.getPreviousProfileUid()).toBe("A");
  });

  it("throws NoPreviousProfileError when nothing has been switched yet", async () => {
    const { mgr } = await setup();
    await expect(mgr.undoLastApply()).rejects.toBeInstanceOf(
      NoPreviousProfileError,
    );
  });

  // LOW #1 (code-review) — a switch between two DISTINCT profiles that share an
  // identical effective set takes the no-op reindex path; the undo target must
  // still be recorded so «Undo» is offered.
  it("records the undo target on the no-op path (distinct profiles, identical effective set)", async () => {
    const { mgr, localDataStore, restMount } = await setup();
    await mgr.applyProfile("A"); // mounts ems → mount-state {exo, ems}
    restMount.mounted.length = 0;
    restMount.unmounted.length = 0;
    // C declares the SAME effective set as A → empty mount diff → no-op branch.
    await mgr.applyProfile("C");
    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
    expect(localDataStore.getActiveProfileUid()).toBe("C");
    // The identity changed A→C even though nothing was (un)mounted — undo offered.
    expect(localDataStore.getPreviousProfileUid()).toBe("A");
    expect(mgr.getUndoTargetProfileUid()).toBe("A");
  });

  // LOW #2 (code-review) — undo to a profile that was since deleted from the
  // vault throws NoPreviousProfileError (clear message) rather than a confusing
  // TsFloorViolationError from an empty effective set.
  it("throws NoPreviousProfileError (not TS-floor) when the previous profile was deleted", async () => {
    const { mgr, localDataStore } = await setup();
    await mgr.applyProfile("A");
    await mgr.applyProfile("B"); // previous = A
    // Simulate A being deleted: point the undo target at an unresolvable UID.
    const snap = localDataStore.snapshot();
    await localDataStore.save({ ...snap, previousProfileUid: "ghost-deleted" });
    await expect(mgr.undoLastApply()).rejects.toBeInstanceOf(
      NoPreviousProfileError,
    );
  });

  it("getUndoTargetProfileUid returns null before any switch, the prior profile after", async () => {
    const { mgr } = await setup();
    expect(mgr.getUndoTargetProfileUid()).toBeNull();
    await mgr.applyProfile("A");
    await mgr.applyProfile("B");
    expect(mgr.getUndoTargetProfileUid()).toBe("A");
  });
});
