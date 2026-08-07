/**
 * @req:d4ccc901-83a4-4495-a4bb-43d1305dfd00
 *
 * req `d4ccc901` — the REST apply path with three mount states.
 *
 * ## Why this harness wires the mount the way it does
 *
 * ⛔ `restMount` is DELIBERATELY OMITTED. Production (`ExocortexPlugin.ts:3410`)
 * wires ONLY `restMountFactory` — unconditionally, since #3410 — and the real
 * mount is resolved locally inside the apply. The sibling harnesses
 * (`restApply`, `restAtomicity`) hand the manager a `restMount` directly, which
 * is a shape production never takes; that fixture shape is exactly what hid the
 * `canPark()` bug (`this.restMount !== undefined` was false on the only live
 * path ⇒ zero parks would ever be planned, silently, with every test green).
 *
 * So: factory-only here, on purpose. Differential proof that this matters is in
 * the PR body — reverting `restWired()` back to `this.restMount !== undefined`
 * reddens the axes below and nothing else.
 *
 * ## Axes (one guard each)
 *
 *  A. production wiring plans a park at all (the bug that shipped green)
 *  B. a soft departure PARKS and its files stay OUT of the destroy bucket
 *  C. a hard departure still DESTROYS (the split is real, not "park everything")
 *  D. return from parking goes through the SAME arrival loop (AC3)
 *  E. journal carries its own stages, never `phase2-destroy-cached` (AC4/fact #10)
 *  F. reconcile computes NO deletion for a parked AS and announces the unpark (AC2)
 */
import type { App, TFile } from "obsidian";
import type { ApplyPlan, IConfirmGate } from "@kitelev/exocortex-core";

import {
  ProfileApplyManager,
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
import {
  DEPENDENCY_KIND_REFERENCE_UID,
  DEPENDENCY_KIND_TBOX_UID,
  parkedPathFor,
} from "@kitelev/exocortex-core";

// ─── Fakes ────────────────────────────────────────────────────────────────

interface FakeFile {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
}

function makeFakeApp(files: FakeFile[]): {
  app: App;
  fsFolders: Map<string, { files: string[]; folders: string[] }>;
  fsFiles: Map<string, string>;
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
        mkdir: async (p: string) => {
          if (!fsFolders.has(p)) fsFolders.set(p, { files: [], folders: [] });
        },
        // Without `remove` the apply lock is never released and a SECOND apply
        // on the same instance dies with "lock held" — which would make the
        // round-trip test below unwritable, not merely red.
        remove: async (p: string) => {
          fsFiles.delete(p);
        },
        rmdir: async (p: string) => {
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
  return { app, fsFolders, fsFiles };
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

class FakeLocalDataStore {
  private state = { activeProfileUid: null as string | null, _switchInProgress: false };
  getActiveProfileUid(): string | null {
    return this.state.activeProfileUid;
  }
  isSwitchInProgress(): boolean {
    return this.state._switchInProgress;
  }
  snapshot() {
    return { ...this.state };
  }
  async save(s: { activeProfileUid: string | null; _switchInProgress: boolean }) {
    this.state = { ...s };
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

class FakeGitOps {
  async readGitmodulesPaths(): Promise<Set<string>> {
    return new Set();
  }
  async submoduleAdd(): Promise<void> {}
  async submoduleDeinit(): Promise<void> {}
}

/**
 * Records which VERB each AssetSpace received. The point of the whole task is
 * that park ≠ unmount, so a spy that collapsed them would test nothing.
 */
class MountSpy {
  mounted: string[] = [];
  unmounted: string[] = [];
  parked: string[] = [];
  unparked: string[] = [];
  /**
   * The spy MOVES folders in the fake FS rather than only recording calls, so a
   * second apply on the same instance observes what the first one actually did.
   * Without this a round-trip test would be re-reading the initial disk state
   * and could "pass" against a park that never happened.
   */
  constructor(
    private readonly fsFolders: Map<string, { files: string[]; folders: string[] }>,
    /** Simulates a crash/failure INSIDE the move, for the journal-ordering axis. */
    private readonly failPark = false,
  ) {}
  private move(from: string, to: string) {
    const entry = this.fsFolders.get(from);
    this.fsFolders.delete(from);
    this.fsFolders.set(to, entry ?? { files: [], folders: [] });
  }
  async mount(_gitUrl: string, submodulePath: string) {
    this.mounted.push(submodulePath);
    this.fsFolders.set(submodulePath, {
      files: [`${submodulePath}/file1.md`],
      folders: [],
    });
    return { sha: "abc1234", fileCount: 1 };
  }
  async unmount(submodulePath: string): Promise<void> {
    this.unmounted.push(submodulePath);
    this.fsFolders.delete(submodulePath);
  }
  async park(submodulePath: string): Promise<void> {
    if (this.failPark) throw new Error("simulated crash during park");
    this.parked.push(submodulePath);
    this.move(submodulePath, parkedPathFor(submodulePath));
  }
  async unpark(submodulePath: string): Promise<void> {
    this.unparked.push(submodulePath);
    this.move(parkedPathFor(submodulePath), submodulePath);
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const FLOOR = [
  { uid: TS_FLOOR_AS_UID_EXO, folder: "assetspaces/kitelev/exoas-exo" },
  { uid: TS_FLOOR_AS_UID_EXOCMD, folder: "assetspaces/kitelev/exoas-exocmd" },
  {
    uid: TS_FLOOR_AS_UID_SHARED_IDENTITIES,
    folder: "assetspaces/kitelev/exoas-shared-identities",
  },
];
/** Soft edge (`reference`) — content-only, safe to keep on device. */
const SOFT = { uid: "soft-uid", folder: "assetspaces/kitelev/exoas-soft" };
/** Hard edge (`tbox`) — a half-present provider is the silent state. */
const HARD = { uid: "hard-uid", folder: "assetspaces/kitelev/exoas-hard" };
const ALL_AS = [...FLOOR, SOFT, HARD];
const FLOOR_UIDS = FLOOR.map((f) => f.uid);

const KIND_BY_UID: Record<string, string | undefined> = {
  [SOFT.uid]: `[[${DEPENDENCY_KIND_REFERENCE_UID}]]`,
  [HARD.uid]: `[[${DEPENDENCY_KIND_TBOX_UID}]]`,
};

interface SetupOpts {
  targetIncludes: string[];
  /** AS whose mount folder exists on disk. */
  materialized: string[];
  /** AS whose folder sits under `.exocortex/parked/`. */
  parked?: string[];
  /**
   * ⛔ Default FALSE — production omits `restMount` entirely. Only the
   * differential control below flips this on.
   */
  wireRestMountDirectly?: boolean;
  /** `reconcileToLocal` refuses to run without gitOps + an active profile. */
  activeProfileUid?: string;
  /** Declares of the second profile (`"other"`), for round-trip applies. */
  otherIncludes?: string[];
  /** Makes `mount.park()` throw — drives the journal-ordering axis. */
  failPark?: boolean;
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
          ...(KIND_BY_UID[as.uid] !== undefined
            ? { exo__AssetSpace_dependsOnKind: KIND_BY_UID[as.uid] }
            : {}),
        },
      };
    }),
  ];

  const { app, fsFolders, fsFiles } = makeFakeApp(files);
  for (const uid of opts.materialized) {
    const folder = ALL_AS.find((a) => a.uid === uid)?.folder;
    if (folder) {
      fsFolders.set(folder, {
        files: [`${folder}/file1.md`, `${folder}/file2.md`],
        folders: [],
      });
    }
  }
  for (const uid of opts.parked ?? []) {
    const folder = ALL_AS.find((a) => a.uid === uid)?.folder;
    if (folder) {
      fsFolders.set(parkedPathFor(folder), { files: [], folders: [] });
    }
  }

  const resolver = new FakeResolver(
    new Map<string, ProfileResolution>([
      [
        "target",
        { uid: "target", includes: opts.targetIncludes, label: "Target Profile" },
      ],
      // Second profile so a round-trip (park → come back) can be driven as two
      // real applies on ONE manager instance.
      [
        "other",
        {
          uid: "other",
          includes: opts.otherIncludes ?? FLOOR_UIDS,
          label: "Other Profile",
        },
      ],
    ]),
  );
  const indexer = new FakeIndexer();
  const localDataStore = new FakeLocalDataStore();
  const confirmGate = new FakeConfirmGate();
  const mount = new MountSpy(fsFolders, opts.failPark ?? false);
  const notifyCalls: string[] = [];
  if (opts.activeProfileUid !== undefined) {
    void localDataStore.save({
      activeProfileUid: opts.activeProfileUid,
      _switchInProgress: false,
    });
  }

  const mgr = new ProfileApplyManager({
    app,
    lockMgr: new PluginLockManager({ app }),
    resolver,
    rdfIndexer: indexer,
    settingsStore: new FakeSettingsStore(),
    notify: (m) => notifyCalls.push(m),
    /* eslint-disable @typescript-eslint/no-explicit-any */
    confirmGate,
    localDataStore: localDataStore as any,
    // ⛔ PRODUCTION SHAPE — factory only, `restMount` absent (see header).
    restMount: (opts.wireRestMountDirectly ? mount : undefined) as any,
    restMountFactory: (async () => mount) as any,
    gitOps: new FakeGitOps() as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  const journal = async (): Promise<Array<Record<string, unknown>>> =>
    (fsFiles.get(".exocortex/switch-journal.jsonl") ?? "")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  return { mgr, mount, confirmGate, notifyCalls, indexer, journal, fsFolders };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("@req:d4ccc901-83a4-4495-a4bb-43d1305dfd00 ProfileApplyManager — parked mount state", () => {
  /**
   * AXIS A — the bug that shipped green. With `restMount` absent (production),
   * `canPark()` must still answer true, or a soft departure silently degrades
   * to a destroy with every other assertion in the repo untouched.
   *
   * Mutant: `restWired()` → `this.restMount !== undefined` in `canPark()`.
   * This axis and B and D reden; nothing else does.
   */
  it("PLANS a park under PRODUCTION wiring (restMountFactory only, restMount absent)", async () => {
    const { mgr, mount, confirmGate } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    expect(confirmGate.lastPlan?.assetSpacesBeingParked).toEqual([
      expect.objectContaining({ asUid: SOFT.uid, fileCount: 2 }),
    ]);
    expect(mount.parked).toEqual([SOFT.folder]);
    // …and the verb it must NOT have received.
    expect(mount.unmounted).toEqual([]);
  });

  /**
   * AXIS B — the counter honesty. The same two files must not be announced
   * twice under two verbs; a park leaves `filesToDestroy` empty.
   */
  it("keeps parked files OUT of filesToDestroy / assetSpacesBeingTornDown", async () => {
    const { mgr, confirmGate } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    const plan = confirmGate.lastPlan!;
    expect(plan.assetSpacesBeingTornDown).toEqual([]);
    const totalFiles = [...plan.filesToDestroy.values()].reduce(
      (s, f) => s + f.length,
      0,
    );
    expect(totalFiles).toBe(0);
    // The files are still ACCOUNTED for — silence would be the other failure.
    expect(plan.assetSpacesBeingParked[0].fileCount).toBe(2);
  });

  /**
   * AXIS C — the split is real. A hard (`tbox`) departure keeps the
   * pre-existing destroy semantics; "park everything" would be the lazy bug
   * that makes A and B pass for the wrong reason.
   */
  it("still DESTROYS a hard-edge departure (park is not the new default)", async () => {
    const { mgr, mount, confirmGate } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, HARD.uid],
    });

    await mgr.applyProfileViaRest("target");

    expect(mount.unmounted).toEqual([HARD.folder]);
    expect(mount.parked).toEqual([]);
    expect(confirmGate.lastPlan?.assetSpacesBeingParked).toEqual([]);
    expect(confirmGate.lastPlan?.assetSpacesBeingTornDown).toEqual([
      expect.objectContaining({ asUid: HARD.uid, fileCount: 2 }),
    ]);
  });

  /**
   * AXIS D — AC3. Coming back from parking must travel the SAME arrival loop as
   * a fresh materialise, differing only in how the bytes are acquired. The
   * evidence is that it lands in `assetSpacesBeingMaterialized` (shared
   * bookkeeping) while ALSO being marked as an unpark, and that no tarball is
   * pulled.
   */
  it("returns from parking through the SAME arrival path — rename, not download", async () => {
    const { mgr, mount, confirmGate } = setup({
      targetIncludes: [...FLOOR_UIDS, SOFT.uid],
      materialized: FLOOR_UIDS,
      parked: [SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    expect(mount.unparked).toEqual([SOFT.folder]);
    // ⛔ Nothing crossed the network: the bytes were already here.
    expect(mount.mounted).toEqual([]);
    const plan = confirmGate.lastPlan!;
    // Shared arrival bookkeeping…
    expect(plan.assetSpacesBeingMaterialized.map((m) => m.asUid)).toContain(
      SOFT.uid,
    );
    // …plus the marker that keeps the card honest about HOW it arrives.
    expect(plan.assetSpacesBeingUnparked.map((m) => m.asUid)).toEqual([SOFT.uid]);
  });

  it("a parked AssetSpace the profile does NOT want is left alone (no verb at all)", async () => {
    const { mgr, mount, confirmGate } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: FLOOR_UIDS,
      parked: [SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    expect(mount.parked).toEqual([]);
    expect(mount.unparked).toEqual([]);
    expect(mount.unmounted).toEqual([]);
    expect(confirmGate.lastPlan?.filesToDestroy.size).toBe(0);
  });

  /**
   * AXIS E — AC4 / fact #10. Parking writes its OWN journal stages. It must
   * never emit `phase2-destroy-cached`: that stage's recovery restores FROM the
   * SwitchCacheLayer archive, and parking writes no archive — so a crash would
   * send recovery hunting a tarball that never existed while the folder sat
   * intact under `.exocortex/parked/`.
   */
  it("journals its OWN stages and never claims a cached destroy", async () => {
    const { mgr, journal } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    const phases = (await journal()).map((e) => e.phase);
    expect(phases).toContain("phase2-parked");
    expect(phases).not.toContain("phase2-destroy-cached");
    expect(phases).not.toContain("phase2-destroyed");
  });

  /**
   * AXIS E2 — journal BEFORE the move, mirroring the git destroy path's F2
   * ordering. The bytes are never at risk (a park is a rename; the classifier
   * probes DISK via `isParkedOnDisk`, not the journal, so the next apply
   * reconciles either way) — what the opposite ordering loses is ROLLBACK:
   * `recoverIncompleteSwitch` restores the pre-apply mount-state from
   * `interrupted.parked`, so an unjournalled park would leave that AssetSpace
   * parked while its siblings are restored — the half-applied state recovery
   * exists to prevent.
   *
   * The discriminator has to be a FAILING move: on the happy path both orderings
   * produce the same journal, so only a crash-in-between separates them.
   */
  it("journals phase2-parked BEFORE moving, so an interrupted park is still rolled back", async () => {
    const { mgr, journal } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, SOFT.uid],
      failPark: true,
    });

    await expect(mgr.applyProfileViaRest("target")).rejects.toThrow(/simulated crash/);

    // Journal-after would leave NOTHING here — recovery would never learn the
    // park was attempted, and `interrupted.parked` would come back empty.
    expect((await journal()).map((e) => e.phase)).toContain("phase2-parked");
  });

  it("journals phase2-unparked on the way back", async () => {
    const { mgr, journal } = setup({
      targetIncludes: [...FLOOR_UIDS, SOFT.uid],
      materialized: FLOOR_UIDS,
      parked: [SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    const entries = await journal();
    expect(entries.map((e) => e.phase)).toContain("phase2-unparked");
    expect(entries.map((e) => e.phase)).not.toContain("phase2-materialized");
  });

  /**
   * A park is WORK. Before this task an apply whose only delta was a soft
   * departure had an empty destroy AND materialise set, so the no-op early exit
   * would have swallowed it — the user would apply a profile and nothing would
   * happen, with a "no changes" notice to confirm the lie.
   */
  it("does not fall through the no-op early exit when the only change is a park", async () => {
    const { mgr, mount, notifyCalls } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");

    expect(mount.parked.length).toBe(1);
    expect(notifyCalls.join("\n")).toContain("1 parked");
    expect(notifyCalls.join("\n")).not.toContain("no changes");
  });

  /**
   * ROUND TRIP — the concrete form of "undo must not re-download".
   *
   * `undoLastApply` is defined as "re-apply the previously-active profile", so
   * it routes through this exact classifier; the undo harness
   * (`ProfileApplyManager.undo.test.ts`) asserts the undo-TARGET bookkeeping and
   * carries no `dependsOnKind` in its fixtures, so every departure there still
   * resolves HARD → destroy → its recorded semantics are unchanged by this task.
   * What that harness cannot show is the thing that actually changes: going back
   * to a profile you just left must RENAME, not re-fetch. Two real applies on
   * one manager (the spy moves folders, so the second apply reads what the first
   * actually did) show it end to end.
   */
  it("park then come back: the second apply RENAMES, it never re-downloads", async () => {
    const { mgr, mount } = setup({
      // "target" drops the soft AS (→ park); "other" wants it back (→ unpark).
      targetIncludes: FLOOR_UIDS,
      otherIncludes: [...FLOOR_UIDS, SOFT.uid],
      materialized: [...FLOOR_UIDS, SOFT.uid],
    });

    await mgr.applyProfileViaRest("target");
    expect(mount.parked).toEqual([SOFT.folder]);

    await mgr.applyProfileViaRest("other");

    expect(mount.unparked).toEqual([SOFT.folder]);
    // ⛔ The whole economic argument of the task: coming back costs a rename.
    expect(mount.mounted).toEqual([]);
    expect(mount.unmounted).toEqual([]);
  });

  /**
   * AXIS F — AC2. `reconcileToLocal` must compute NO deletion for a parked
   * AssetSpace: it is on the device, merely not active. The DELETION half needs
   * no branch (materialised-ness is derived from mount-folder existence, so a
   * parked AS can never enter `extra`); the ARRIVAL half does, or the reconcile
   * card would announce a download for bytes already present.
   */
  it("reconcile computes NO deletion for a parked AS and announces an unpark", async () => {
    const { mgr, confirmGate } = setup({
      targetIncludes: [...FLOOR_UIDS, SOFT.uid],
      materialized: FLOOR_UIDS,
      parked: [SOFT.uid],
      activeProfileUid: "target",
    });
    // Decline so the assertion is about the PLAN the user is shown, and the
    // reconcile stops before mutating anything.
    confirmGate.approve = false;

    const r = await mgr.reconcileToLocal();

    expect(r.outcome).toBe("declined");
    const plan = confirmGate.lastPlan!;
    // AC2 — the parked AssetSpace is on the device, so nothing is deleted…
    expect(plan.filesToDestroy.size).toBe(0);
    expect(plan.assetSpacesBeingTornDown).toEqual([]);
    // …and its return is announced as an unpark, not a download.
    expect(plan.assetSpacesBeingUnparked.map((u) => u.asUid)).toEqual([SOFT.uid]);
  });

  /**
   * Negative control for the axis above: with the SAME divergence but the
   * AssetSpace genuinely absent, the reconcile card must NOT claim an unpark —
   * otherwise the assertion above would pass for a renderer that marks
   * everything as "already on device".
   */
  it("reconcile does NOT claim an unpark for a genuinely absent AS (control)", async () => {
    const { mgr, confirmGate } = setup({
      targetIncludes: [...FLOOR_UIDS, SOFT.uid],
      materialized: FLOOR_UIDS,
      // no `parked` — the AS is nowhere on the device
      activeProfileUid: "target",
    });
    confirmGate.approve = false;

    await mgr.reconcileToLocal();

    const plan = confirmGate.lastPlan!;
    expect(plan.assetSpacesBeingMaterialized.map((m) => m.asUid)).toContain(
      SOFT.uid,
    );
    expect(plan.assetSpacesBeingUnparked).toEqual([]);
  });
});
