/**
 * ExoSync delete/rename propagation tests (Issue #3476 — A1 gap closed).
 *
 * The engine extends the push path with deletions: tree entries with
 * `sha: null` on top of `base_tree` (Git Data API), through the SAME
 * `restCreateCommit` primitive (D3 — additive contract extension).
 *
 * Safety rails pinned here:
 *  - D19: deletes only in fully-materialized repos (absence ≠ delete);
 *  - delete-vs-remote-modify → merge layer / quarantine, deletion withheld;
 *  - rename = add new path + delete old path in ONE commit (no uid duplicate
 *    window on the remote);
 *  - convergent delete (both sides deleted) → NO commit (#3475/#3478
 *    phantom/empty-commit guard intact);
 *  - pull-only runs never push deletions (#3473) — they re-derive.
 *
 * GitHub side is the production-shape `FakeGitHubRepo` whose sha:null
 * semantics mirror real GitHub (422 GitRPC::BadObjectState for absent
 * paths, 404 for empty trees — empirically verified 2026-06-12).
 */

import {
  SyncEngine,
  type MergeLayerPort,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  neverMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";
import type { SyncEngineDeps, SyncRepoSpec } from "../../../../src";

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

async function bootstrap(
  engine: SyncEngine,
  spec: SyncRepoSpec,
): Promise<void> {
  const result = await engine.sync(spec);
  expect(result.status).toBe("synced");
}

/** Merge layer that quarantines everything — pins the conflict path. */
const quarantineAllMerger: MergeLayerPort = {
  resolve: async () => ({
    action: "quarantine",
    reason: "test: always quarantine",
  }),
};

const FILE_A = "assets/a.md";
const FILE_B = "assets/b.md";
const RENAMED = "assets/renamed.md";

describe("SyncEngine — local delete propagates to remote (#3476)", () => {
  it("pushes the deletion in one sync cycle; file vanishes from the remote HEAD tree", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedSha).toBe(gh.headSha());
    expect(gh.headFiles().has(FILE_B)).toBe(false); // deletion landed remotely
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1")); // neighbour intact
    expect(result.pushedDeletes).toEqual([FILE_B]);
    expect(result.deferredDeletes).toEqual([]); // nothing deferred any more
    expect(result.warnings.join(" ")).not.toMatch(/deferred delete/);
    // Watermark converged on the pushed head — the deleted path is gone.
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.lastSyncedSha).toBe(result.pushedSha);
    expect(record.files.some((f) => f.path === FILE_B)).toBe(false);
  });

  it("does NOT re-surface the delete on the next sync (watermark converged)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_B);
    await engine.sync(gh.spec());
    const next = await engine.sync(gh.spec());

    expect(next.status).toBe("synced");
    expect(next.pushedSha).toBeUndefined(); // pure no-op — nothing re-derived
    expect(next.pushedDeletes ?? []).toEqual([]);
    expect(next.deferredDeletes).toEqual([]);
    expect(next.warnings).toEqual([]);
  });

  it("pushes a content edit and a deletion in the SAME commit", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const headBefore = gh.headSha();

    local.files.set(FILE_A, mdAsset("u1", "edited"));
    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(result.pushedDeletes).toEqual([FILE_B]);
    // Exactly ONE commit on top of the previous head.
    expect(gh.commits.get(gh.headSha())!.parents).toEqual([headBefore]);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "edited"));
    expect(gh.headFiles().has(FILE_B)).toBe(false);
  });

  it("convergent delete (remote deleted it too) → NO commit (#3475/#3478 guard intact)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", {}, "device B deletes b", [FILE_B]);
    local.files.delete(FILE_B);
    const headBefore = gh.headSha();
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedSha).toBeUndefined(); // no phantom/empty commit
    expect(gh.headSha()).toBe(headBefore);
    // Watermark still converges — the path drops from the snapshot.
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.lastSyncedSha).toBe(headBefore);
    expect(record.files.some((f) => f.path === FILE_B)).toBe(false);
  });
});

describe("SyncEngine — rename propagates as add+delete in ONE commit (#3476)", () => {
  it("pushes the new path and deletes the old path atomically; no uid duplicate on remote", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") , [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const headBefore = gh.headSha();

    local.files.delete(FILE_A);
    local.files.set(RENAMED, mdAsset("u1"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1); // the renamed file's content
    expect(result.pushedDeletes).toEqual([FILE_A]);
    expect(result.deferredDeletes).toEqual([]);
    expect(result.warnings.join(" ")).not.toMatch(/deferred rename/);
    // ONE commit: add of the new path and delete of the old are atomic.
    expect(gh.commits.get(gh.headSha())!.parents).toEqual([headBefore]);
    expect(gh.headFiles().get(RENAMED)).toBe(mdAsset("u1"));
    expect(gh.headFiles().has(FILE_A)).toBe(false);
    // Watermark snapshot carries the new path only.
    const record = watermarks.records.get(gh.spec().repoKey)!;
    const paths = record.files.map((f) => f.path);
    expect(paths).toContain(RENAMED);
    expect(paths).not.toContain(FILE_A);
  });

  it("does NOT re-surface the rename on the next sync", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_A);
    local.files.set(RENAMED, mdAsset("u1"));
    await engine.sync(gh.spec());
    const next = await engine.sync(gh.spec());

    expect(next.status).toBe("synced");
    expect(next.pushedSha).toBeUndefined();
    expect(next.deferredDeletes).toEqual([]);
    expect(next.warnings).toEqual([]);
  });
});

describe("SyncEngine — delete-vs-modify safety rails stay intact (#3476)", () => {
  it("A1 (no merge layer): local delete vs remote modify → conflict, deletion NOT pushed", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote edit") }, "device B");
    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("conflict");
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2", "remote edit")); // never deleted
  });

  it("A2 (merge layer quarantines): deletion withheld, remote edit survives, path re-derives", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine, watermarks } = makeEngine(gh, local, {
      mergeLayer: quarantineAllMerger,
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote edit") }, "device B");
    local.files.delete(FILE_B);
    // A disjoint local edit keeps the cycle pushing — proving the WITHHELD
    // deletion is per-path, not an all-or-nothing abort.
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1);
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2", "remote edit")); // never deleted
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "local edit")); // disjoint edit pushed
    expect(result.pushedDeletes ?? []).toEqual([]);
    expect(result.deferredDeletes).toContain(FILE_B); // honest reporting
    // Pinned — the conflict re-derives next sync.
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.pinnedPaths ?? []).toContain(FILE_B);
  });

  it("D19: partial materialization still never infers (nor pushes) deletes", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({}); // absence must NOT become a pushed delete
    const { engine } = makeEngine(gh, local, {
      materializationCheck: neverMaterialized("mid-mount"),
    });

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("skipped-not-materialized");
    expect(result.pushedDeletes ?? []).toEqual([]);
    expect(gh.headFiles().has(FILE_A)).toBe(true); // remote untouched
  });
});

describe("SyncEngine — split directions and deletions (#3473 × #3476)", () => {
  it("push-only: deletions propagate (it IS a push)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec(), "push");

    expect(result.status).toBe("synced");
    expect(result.pushedDeletes).toEqual([FILE_B]);
    expect(gh.headFiles().has(FILE_B)).toBe(false);
  });

  it("pull-only: deletions are NOT pushed and re-derive on the next full Sync", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_B);
    const pull = await engine.sync(gh.spec(), "pull");

    expect(pull.status).toBe("synced");
    expect(pull.pushedSha).toBeUndefined();
    expect(pull.pushedDeletes ?? []).toEqual([]);
    expect(pull.deferredDeletes).toContain(FILE_B); // visible, not silent
    expect(gh.headFiles().has(FILE_B)).toBe(true); // remote untouched

    // The next FULL sync propagates the delete.
    const full = await engine.sync(gh.spec());
    expect(full.status).toBe("synced");
    expect(full.pushedDeletes).toEqual([FILE_B]);
    expect(gh.headFiles().has(FILE_B)).toBe(false);
  });
});
