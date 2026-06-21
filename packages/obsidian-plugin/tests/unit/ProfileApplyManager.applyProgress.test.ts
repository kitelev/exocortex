/**
 * ProfileApplyManager — live per-AssetSpace progress feed during a profile
 * apply materialize (activity-log materialize progress, WBS 4b2bc60f).
 *
 * Requirement: during `applyProfile` materialize the activity log must show the
 * apply is actively progressing — a "Mounting X (2 of 5)" entry BEFORE each
 * per-AssetSpace pull/mount/unmount — not only the post-completion summary. The
 * progress feed is `onProgress` (wired to the activity log), DISTINCT from
 * `notify` (the sparse user-facing toast) so a long apply never spams toasts.
 *
 * These tests drive the PRODUCTION path (REST — desktop & mobile both route
 * through it post-#3567) and assert:
 *   1. onProgress fires once per mount, BEFORE the mount, with 1-based N-of-M.
 *   2. onProgress fires once per unmount, BEFORE the unmount, with N-of-M.
 *   3. Progress is activity-log-only — `notify` is NOT called with any progress
 *      line (only the single final summary toast).
 *   4. Ordering — every progress event precedes the op it announces.
 *
 * Revert-verify: remove the `emitProgress(...)` calls from the materialize loops
 * and tests 1/2/4 fail (zero progress events); restore → pass.
 *
 * Fakes mirror ProfileApplyManager.restApply.test.ts (production-shape AS ABox
 * frontmatter, in-memory vault.adapter, dual-slot FakeLocalDataStore).
 */
import { Platform } from "obsidian";
import type { App, TFile } from "obsidian";
import type { IConfirmGate } from "exocortex";

import {
  ProfileApplyManager,
  type ApplyProgressEvent,
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

/** Per-AssetSpace progress variant (excludes the `reindex` marker) — narrows
 *  the discriminated union so `index`/`label`/`total` are accessible. */
type PerAsProgress = Extract<ApplyProgressEvent, { as: string }>;
const perAs =
  (op: "pull" | "mount" | "unmount") =>
  (e: ApplyProgressEvent): e is PerAsProgress =>
    e.op === op && (e as PerAsProgress).step === undefined;

// ─── Fakes (mirror restApply.test.ts) ───────────────────────────────────────

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
  async refresh(): Promise<void> {}
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
    this.state = { activeProfileUid: s.activeProfileUid, _switchInProgress: s._switchInProgress };
  }
}

class FakeConfirmGate implements IConfirmGate {
  async confirmApply(): Promise<boolean> {
    return true;
  }
}

/** REST mount that appends to a SHARED trace so we can prove progress precedes the op.
 *  Mirrors the real mount core's sub-phase order (fetch → extract → materialize) by
 *  invoking the optional `onProgress` callback, so within-AS sub-step progress is testable. */
class TracingRestMount {
  mounted: string[] = [];
  unmounted: string[] = [];
  constructor(private readonly trace: string[]) {}
  async mount(
    _gitUrl: string,
    submodulePath: string,
    _ref: string,
    onProgress?: (phase: "fetch" | "extract" | "materialize") => void,
  ) {
    onProgress?.("fetch");
    this.trace.push(`mount:${submodulePath}`);
    onProgress?.("extract");
    onProgress?.("materialize");
    this.mounted.push(submodulePath);
    return { sha: "abc1234", fileCount: 1 };
  }
  async unmount(submodulePath: string): Promise<void> {
    this.trace.push(`unmount:${submodulePath}`);
    this.unmounted.push(submodulePath);
  }
}

// ─── AssetSpace topology ────────────────────────────────────────────────────

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
const FLOOR_UIDS = TS_FLOOR.map((f) => f.uid);

interface SetupOpts {
  targetIncludes: string[];
  materialized: string[];
  /** Wire a hostile onProgress that throws — proves emitProgress isolation. */
  throwingProgress?: boolean;
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
      ["target", { uid: "target", includes: opts.targetIncludes, label: "Target Profile" }],
    ]),
  );
  const trace: string[] = [];
  const restMount = new TracingRestMount(trace);
  const progressEvents: ApplyProgressEvent[] = [];
  const notifyCalls: string[] = [];

  const mgr = new ProfileApplyManager({
    app,
    lockMgr: new PluginLockManager({ app }),
    resolver,
    rdfIndexer: new FakeIndexer(),
    settingsStore: new FakeSettingsStore(),
    notify: (m) => notifyCalls.push(m),
    onProgress: (e) => {
      trace.push(
        e.op === "reindex"
          ? "progress:reindex"
          : `progress:${e.step ?? e.op}:${e.index}/${e.total}`,
      );
      progressEvents.push(e);
      if (opts.throwingProgress) throw new Error("hostile observer");
    },
    /* eslint-disable @typescript-eslint/no-explicit-any */
    confirmGate: new FakeConfirmGate(),
    localDataStore: new FakeLocalDataStore() as any,
    restMount: restMount as any,
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
  return { mgr, restMount, progressEvents, notifyCalls, trace };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ProfileApplyManager — live materialize progress feed (WBS 4b2bc60f)", () => {
  const original = Platform.isMobile;
  afterEach(() => {
    (Platform as unknown as { isMobile: boolean }).isMobile = original;
  });

  it("emits a 'mount' progress event with N-of-M BEFORE each mount (≥2 AS)", async () => {
    // Materialised: floors only. Target: floors + ems + kpc ⇒ mount 2 AS.
    const { mgr, restMount, progressEvents } = setup({
      targetIncludes: [...FLOOR_UIDS, "ems-uid", "kpc-uid"],
      materialized: FLOOR_UIDS,
    });

    await mgr.applyProfile("target");

    // Both AS mounted…
    expect(restMount.mounted.sort()).toEqual(
      ["assetspaces/kitelev/exoas-ems", "assetspaces/kitelev/exoas-kpc"].sort(),
    );
    // …and a mount progress event fired for EACH, with 1-based N-of-M.
    const mountProgress = progressEvents.filter(perAs("mount"));
    expect(mountProgress.length).toBe(2);
    expect(mountProgress.map((e) => `${e.index}/${e.total}`)).toEqual([
      "1/2",
      "2/2",
    ]);
    // Labels are meaningful (namespace from the AS descriptor), not empty.
    expect(mountProgress.map((e) => e.label).sort()).toEqual([
      "exoas-ems",
      "exoas-kpc",
    ]);
    expect(mountProgress.every((e) => e.label.length > 0)).toBe(true);
  });

  it("emits an 'unmount' progress event with N-of-M BEFORE each unmount (≥2 AS)", async () => {
    // Materialised: floors + ems + kpc. Target: floors only ⇒ unmount 2 AS.
    const { mgr, restMount, progressEvents } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: [...FLOOR_UIDS, "ems-uid", "kpc-uid"],
    });

    await mgr.applyProfile("target");

    expect(restMount.unmounted.length).toBe(2);
    const unmountProgress = progressEvents.filter(perAs("unmount"));
    expect(unmountProgress.length).toBe(2);
    expect(unmountProgress.map((e) => `${e.index}/${e.total}`)).toEqual([
      "1/2",
      "2/2",
    ]);
  });

  it("each progress event PRECEDES the op it announces (live, not post-fact)", async () => {
    const { mgr, trace } = setup({
      targetIncludes: [...FLOOR_UIDS, "ems-uid", "kpc-uid"],
      materialized: FLOOR_UIDS,
    });

    await mgr.applyProfile("target");

    // Trace interleaves progress + mount markers. For each mount marker there
    // must be a preceding progress marker (the announce precedes the work).
    const firstMount = trace.findIndex((t) => t.startsWith("mount:"));
    const firstProgress = trace.findIndex((t) => t.startsWith("progress:mount"));
    expect(firstProgress).toBeGreaterThanOrEqual(0);
    expect(firstProgress).toBeLessThan(firstMount);
    // Exactly one progress marker per mount marker, alternating progress→mount.
    const markers = trace.filter(
      (t) => t.startsWith("progress:mount") || t.startsWith("mount:"),
    );
    expect(markers).toEqual([
      "progress:mount:1/2",
      "mount:assetspaces/kitelev/exoas-ems",
      "progress:mount:2/2",
      "mount:assetspaces/kitelev/exoas-kpc",
    ]);
  });

  it("progress is activity-log-only — NEVER toasted (notify gets only the summary)", async () => {
    const { mgr, notifyCalls, progressEvents } = setup({
      targetIncludes: [...FLOOR_UIDS, "ems-uid", "kpc-uid"],
      materialized: FLOOR_UIDS,
    });

    await mgr.applyProfile("target");

    // Progress DID happen (2 mounts) …
    expect(progressEvents.filter(perAs("mount")).length).toBe(2);
    // … but the only toast is the single final reconciliation summary — no
    // per-AssetSpace "Mounting … (N of M)" line ever reaches notify().
    expect(notifyCalls.length).toBe(1);
    expect(notifyCalls[0]).toContain("mounted");
    expect(notifyCalls.some((m) => /\bof\b/.test(m) && /Mounting|Unmounting|Pulling/.test(m))).toBe(
      false,
    );
  });

  it("no progress events on a no-op apply (mount-state already matches)", async () => {
    const { mgr, progressEvents, restMount } = setup({
      targetIncludes: FLOOR_UIDS,
      materialized: FLOOR_UIDS,
    });

    await mgr.applyProfile("target");

    expect(restMount.mounted).toEqual([]);
    expect(restMount.unmounted).toEqual([]);
    expect(progressEvents).toEqual([]);
  });

  it("a throwing onProgress observer never breaks the apply (isolated)", async () => {
    const { mgr, restMount } = setup({
      targetIncludes: [...FLOOR_UIDS, "ems-uid"],
      materialized: FLOOR_UIDS,
      throwingProgress: true,
    });
    // The hostile observer throws on every emitProgress; emitProgress swallows
    // it so the apply still completes and the mount still happens.
    await expect(mgr.applyProfile("target")).resolves.toBeUndefined();
    expect(restMount.mounted).toEqual(["assetspaces/kitelev/exoas-ems"]);
  });

  // ── #al-activitylog-progress: finer within-AS sub-steps + reindex marker ──

  it("emits finer within-AS sub-step progress (fetch→extract→materialize) per mount", async () => {
    // Mount 1 AS so the sub-step sequence is unambiguous.
    const { mgr, progressEvents } = setup({
      targetIncludes: [...FLOOR_UIDS, "ems-uid"],
      materialized: FLOOR_UIDS,
    });

    await mgr.applyProfile("target");

    // The within-AS sub-steps the mount core surfaces, in order, all carrying
    // the per-AS label + N-of-M context (finer than the single baseline marker).
    const steps = progressEvents
      .filter(
        (e): e is PerAsProgress => e.op === "mount" && e.step !== undefined,
      )
      .map((e) => `${e.step}:${e.index}/${e.total}:${e.label}`);
    expect(steps).toEqual([
      "fetch:1/1:exoas-ems",
      "extract:1/1:exoas-ems",
      "materialize:1/1:exoas-ems",
    ]);
  });

  it("emits a 'reindex' progress marker AFTER mounts, before completion", async () => {
    const { mgr, progressEvents, trace } = setup({
      targetIncludes: [...FLOOR_UIDS, "ems-uid", "kpc-uid"],
      materialized: FLOOR_UIDS,
    });

    await mgr.applyProfile("target");

    // Exactly one reindex marker — the apply-tail RDF rebuild announcement.
    const reindex = progressEvents.filter((e) => e.op === "reindex");
    expect(reindex.length).toBe(1);
    // …and it comes AFTER the per-AS mount work (announces the silent tail).
    const lastMount = trace.lastIndexOf("mount:assetspaces/kitelev/exoas-kpc");
    const reindexAt = trace.indexOf("progress:reindex");
    expect(reindexAt).toBeGreaterThan(lastMount);
  });
});
