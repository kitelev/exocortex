/**
 * ExoSync duplicate-uid convergence tests (Issue #3477 — first live M1).
 *
 * N files sharing one `exo__Asset_uid` (template-copy artifact) must sync
 * with PATH-IDENTITY semantics for the whole uid-group, end to end:
 *
 *  - rename inference suppressed (no phantom basePath, no rename-deletes);
 *  - a remote edit of one dup path pull-applies to THAT path only — it must
 *    not cross-conflict with (nor quarantine) the other group members;
 *  - edits inside the group push by path; deletes of one member propagate;
 *  - no deletion of a path that exists locally is ever pushed (data safety);
 *  - the dup-uid warning keeps firing (diagnostics preserved);
 *  - genuine renames of UNIQUE uids keep #3476 semantics (add+delete in one
 *    commit), including remote renames (1 change + 1 delete sharing a uid
 *    is a rename, NOT a remote-side dup).
 *
 * The M1 anti-loop test mirrors the live incident verbatim: identical
 * divergence must NOT survive a converged sync round (ParityValidator).
 */

import * as yaml from "js-yaml";
import {
  ParityValidator,
  SyncEngine,
  type MergeLayerPort,
  type SyncEngineDeps,
  type YamlCodec,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

const codec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

// Dup-uid daily notes (template-copy artifact) — content differs per file.
const OLD = "kitelev/2026-06-10 Note.md";
const MID = "kitelev/2026-06-11 Note.md";
const NEW = "kitelev/2026-06-12 Note.md";
const dupNote = (label: string, body = "daily body"): string =>
  `---\nexo__Asset_uid: dup-uid-1\nexo__Asset_label: "${label}"\n---\n\n${body}\n`;
const TRIO = (): Record<string, string> => ({
  [OLD]: dupNote("06-10"),
  [MID]: dupNote("06-11"),
  [NEW]: dupNote("06-12"),
});

function makeEngine(
  gh: FakeGitHubRepo,
  local: FakeLocalFiles,
  overrides: Partial<SyncEngineDeps> = {},
): { engine: SyncEngine; watermarks: FakeWatermarkStore } {
  const watermarks = new FakeWatermarkStore();
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    ...overrides,
  });
  return { engine, watermarks };
}

async function bootstrap(engine: SyncEngine, gh: FakeGitHubRepo): Promise<void> {
  const result = await engine.sync(gh.spec());
  expect(result.status).toBe("synced");
}

const quarantineAllMerger: MergeLayerPort = {
  resolve: async () => ({
    action: "quarantine",
    reason: "test: always quarantine",
  }),
};

describe("SyncEngine — dup-uid group converges by path identity (#3477)", () => {
  it("a remote edit of ONE dup path pull-applies; the other members are untouched (no cross-file quarantine)", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const { engine } = makeEngine(gh, local, { mergeLayer: quarantineAllMerger });
    await bootstrap(engine, gh);

    gh.commitDirect("main", { [NEW]: dupNote("06-12", "remote edit") }, "device B");
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0); // no cross-file contamination
    expect(local.files.get(NEW)).toBe(dupNote("06-12", "remote edit")); // applied
    expect(local.files.get(OLD)).toBe(dupNote("06-10")); // untouched
    expect(local.files.get(MID)).toBe(dupNote("06-11")); // untouched
    expect(result.pushedDeletes ?? []).toEqual([]);

    // Convergence is REAL: the next cycle is a clean no-op, not a loop.
    const next = await engine.sync(gh.spec());
    expect(next.status).toBe("synced");
    expect(next.pushedSha).toBeUndefined();
    expect(next.quarantinedCount).toBe(0);
  });

  it("M1 anti-loop (live incident shape): the divergence does NOT survive a converged sync round", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const watermarks = new FakeWatermarkStore();
    const engine = new SyncEngine({
      transport: gh.transport(),
      watermarkStore: watermarks,
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => local,
      sha1: sha1Hex,
      mergeLayer: quarantineAllMerger,
    });
    const validator = new ParityValidator({
      transport: gh.transport(),
      sha1: sha1Hex,
      localFilesFor: () => local,
      watermarks,
      yaml: codec,
      now: () => "2026-06-12T00:00:00.000Z",
    });
    await bootstrap(engine, gh);

    gh.commitDirect("main", { [NEW]: dupNote("06-12", "remote edit") }, "device B");
    const prev = await validator.runRound([gh.spec()], { trigger: "post-sync" });
    expect(prev.m2Total).toBeGreaterThan(0); // honest pending divergence

    const syncResult = await engine.sync(gh.spec());
    const next = await validator.runRound([gh.spec()], {
      trigger: "post-sync",
      previousRound: prev,
      syncResults: [syncResult],
    });

    // Pre-#3477 this fired: «identical divergence … survived a sync round
    // unchanged (pending-local-edit → pending-local-edit)».
    expect(next.m1Total).toBe(0);
    expect(next.m2Total).toBe(0);
    expect(next.ok).toBe(true);
  });

  it("a divergent edit quarantines ONLY its own path; a disjoint edit on another dup member still pushes", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const { engine } = makeEngine(gh, local, { mergeLayer: quarantineAllMerger });
    await bootstrap(engine, gh);

    gh.commitDirect("main", { [NEW]: dupNote("06-12", "remote edit") }, "device B");
    local.files.set(NEW, dupNote("06-12", "local edit")); // genuine conflict at NEW
    local.files.set(OLD, dupNote("06-10", "disjoint local edit")); // must push
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1); // ONLY the genuinely conflicted path
    expect(gh.headFiles().get(OLD)).toBe(dupNote("06-10", "disjoint local edit"));
    expect(gh.headFiles().get(MID)).toBe(dupNote("06-11")); // untouched
    expect(result.pushedDeletes ?? []).toEqual([]);
  });

  it("an edit inside the dup group pushes by path; NO rename inference, NO deletion of any live path", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh);

    local.files.set(NEW, dupNote("06-12", "edited"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(result.pushedDeletes ?? []).toEqual([]);
    expect(result.deferredDeletes).toEqual([]);
    expect(gh.headFiles().get(NEW)).toBe(dupNote("06-12", "edited"));
    // Every dup path is alive on the remote — nothing was renamed away.
    expect(gh.headFiles().has(OLD)).toBe(true);
    expect(gh.headFiles().has(MID)).toBe(true);

    const next = await engine.sync(gh.spec());
    expect(next.pushedSha).toBeUndefined(); // converged, no loop
  });

  it("deleting ONE dup member locally propagates the delete; the other members survive", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh);

    local.files.delete(MID);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedDeletes).toEqual([MID]);
    expect(gh.headFiles().has(MID)).toBe(false); // delete landed
    expect(gh.headFiles().has(OLD)).toBe(true);
    expect(gh.headFiles().has(NEW)).toBe(true);

    const next = await engine.sync(gh.spec());
    expect(next.pushedSha).toBeUndefined();
    expect(next.deferredDeletes).toEqual([]);
  });

  it("keeps the dup-uid warning in the sync result (diagnostics preserved)", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/duplicate uid dup-uid-1/);
  });
});

describe("SyncEngine — dup-uid arrival cycle never pushes a wrongful delete (#3477 data safety)", () => {
  it("remote ADD of a dup copy + concurrent local edit of the original: the copy is never deleted and lands locally", async () => {
    const FILE = "assets/a.md";
    const COPY = "assets/copy.md";
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "original") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "original") });
    const { engine } = makeEngine(gh, local, { mergeLayer: quarantineAllMerger });
    await bootstrap(engine, gh);

    // Device B copies the asset (template-copy) while this device edits it.
    gh.commitDirect("main", { [COPY]: mdAsset("u1", "the copy") }, "device B");
    local.files.set(FILE, mdAsset("u1", "local edit"));

    const first = await engine.sync(gh.spec());
    expect(first.status).toBe("synced");
    expect(first.pushedDeletes ?? []).toEqual([]); // copy not deleted
    expect(gh.headFiles().has(COPY)).toBe(true);

    // The next cycle must RE-DERIVE the never-applied copy, not absorb it
    // into the watermark and then push its deletion (pre-#3477 hole).
    const second = await engine.sync(gh.spec());
    expect(second.status).toBe("synced");
    expect(second.pushedDeletes ?? []).toEqual([]);
    expect(gh.headFiles().has(COPY)).toBe(true); // ALIVE on remote
    expect(local.files.has(COPY)).toBe(true); // and materialized locally

    const third = await engine.sync(gh.spec());
    expect(third.pushedDeletes ?? []).toEqual([]);
    expect(gh.headFiles().has(COPY)).toBe(true);
  });
});

describe("SyncEngine — remote-side dup uids match by path (#3477)", () => {
  it("TWO remote adds sharing one uid apply as independent files; a local edit of the same uid still pushes", async () => {
    const FILE = "assets/a.md";
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "original") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "original") });
    const { engine } = makeEngine(gh, local, { mergeLayer: quarantineAllMerger });
    await bootstrap(engine, gh);

    gh.commitDirect(
      "main",
      {
        "assets/copy1.md": mdAsset("u1", "copy one"),
        "assets/copy2.md": mdAsset("u1", "copy two"),
      },
      "device B template-copies twice",
    );
    local.files.set(FILE, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0); // no cross-file conflicts
    expect(local.files.get("assets/copy1.md")).toBe(mdAsset("u1", "copy one"));
    expect(local.files.get("assets/copy2.md")).toBe(mdAsset("u1", "copy two"));
    expect(gh.headFiles().get(FILE)).toBe(mdAsset("u1", "local edit")); // pushed
    expect(result.pushedDeletes ?? []).toEqual([]);
  });

  it("a genuine REMOTE rename (1 change + 1 delete sharing a uid) is NOT a dup — local edit at the old path still quarantines as ambiguous", async () => {
    const FILE = "assets/a.md";
    const MOVED = "assets/moved.md";
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u2", "solo") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u2", "solo") });
    const { engine } = makeEngine(gh, local, { mergeLayer: quarantineAllMerger });
    await bootstrap(engine, gh);

    gh.commitDirect(
      "main",
      { [MOVED]: mdAsset("u2", "solo") },
      "device B renames a.md",
      [FILE],
    );
    local.files.set(FILE, mdAsset("u2", "local edit at the old path"));
    const result = await engine.sync(gh.spec());

    // Rename-vs-edit ambiguity must keep quarantining (F1 guard: a remote
    // rename's change+delete pair shares a uid but is NOT a dup group).
    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1);
    expect(gh.headFiles().has(MOVED)).toBe(true); // never deleted by us

    // The consumed-but-unapplied new path must be PINNED, not absorbed:
    // an absorbed entry would read as a local delete next cycle and push
    // a wrongful deletion of the renamed file (#3477 data safety).
    const second = await engine.sync(gh.spec());
    expect(second.pushedDeletes ?? []).toEqual([]);
    expect(gh.headFiles().has(MOVED)).toBe(true); // still alive remotely
  });
});

describe("SyncEngine — #3476 rename propagation intact next to a dup group", () => {
  it("a unique-uid rename pushes add+delete in ONE commit while the dup group syncs by path", async () => {
    const SOLO_OLD = "assets/solo-old.md";
    const SOLO_NEW = "assets/solo-new.md";
    const files = { ...TRIO(), [SOLO_OLD]: mdAsset("u2", "solo") };
    const gh = new FakeGitHubRepo(files);
    const local = new FakeLocalFiles(files);
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh);
    const headBefore = gh.headSha();

    local.files.delete(SOLO_OLD);
    local.files.set(SOLO_NEW, mdAsset("u2", "solo"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedDeletes).toEqual([SOLO_OLD]);
    expect(gh.commits.get(gh.headSha())!.parents).toEqual([headBefore]); // ONE commit
    expect(gh.headFiles().get(SOLO_NEW)).toBe(mdAsset("u2", "solo"));
    expect(gh.headFiles().has(SOLO_OLD)).toBe(false);
    // The dup trio is untouched by the rename.
    expect(gh.headFiles().has(OLD)).toBe(true);
    expect(gh.headFiles().has(MID)).toBe(true);
    expect(gh.headFiles().has(NEW)).toBe(true);

    const next = await engine.sync(gh.spec());
    expect(next.pushedSha).toBeUndefined();
  });
});

describe("SyncEngine — split directions with a dup group (#3473 × #3477)", () => {
  it("pull-only applies a remote dup-path edit without any phantom rename deferral", async () => {
    const gh = new FakeGitHubRepo(TRIO());
    const local = new FakeLocalFiles(TRIO());
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh);

    gh.commitDirect("main", { [NEW]: dupNote("06-12", "remote edit") }, "device B");
    const result = await engine.sync(gh.spec(), "pull");

    expect(result.status).toBe("synced");
    expect(local.files.get(NEW)).toBe(dupNote("06-12", "remote edit"));
    expect(result.warnings.join(" ")).not.toMatch(/pull-only: rename/);
    expect(result.deferredDeletes).toEqual([]);
  });
});
