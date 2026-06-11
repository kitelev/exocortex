/**
 * ExoSync SyncEngine — split-direction runs (Issue #3473).
 *
 * "pull" applies remote changes only — NOTHING leaves the device (no
 * restCreateCommit, local changes stay undiffed and re-derive on the next
 * full Sync). "push" sends the local delta only — remote changes are NEVER
 * applied to disk; their paths are pinned in the watermark so they re-derive
 * on the next pull/Sync instead of being silently reverted by a stale push.
 *
 * Split runs NEVER resolve conflicts: neither the A2 merge layer nor the
 * file-mode remote-wins (D18) policy fires — every conflicting path is
 * pinned and deferred to a full Sync.
 *
 * The GitHub side is the production-shape `FakeGitHubRepo` (real git blob
 * SHAs, transport error contract, force:false 422 semantics).
 */

import {
  InMemoryQuarantineStore,
  SyncEngine,
  type MergeLayerPort,
  type QuarantinePort,
  type SyncEngineDeps,
  type SyncRepoSpec,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

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

/** Bootstrap the watermark from a disk that mirrors the remote head. */
async function bootstrap(
  engine: SyncEngine,
  spec: SyncRepoSpec,
): Promise<void> {
  const result = await engine.sync(spec);
  expect(result.status).toBe("synced");
}

const FILE_A = "assets/a.md";
const FILE_B = "assets/b.md";
const FILE_C = "assets/c.md";

describe("SyncEngine — pull-only direction (#3473)", () => {
  it("applies remote changes, pushes nothing, and leaves local changes undiffed", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    // Device B edits FILE_B remotely; this device edits FILE_A + adds FILE_C.
    const remoteEdit = mdAsset("u2", "remote edit");
    gh.commitDirect("main", { [FILE_B]: remoteEdit }, "device B");
    const headAfterB = gh.headSha();
    const localEdit = mdAsset("u1", "local edit");
    local.files.set(FILE_A, localEdit);
    local.files.set(FILE_C, mdAsset("u3", "local add"));

    const pull = await engine.sync(gh.spec(), "pull");

    expect(pull.status).toBe("synced");
    expect(pull.pushedCount).toBe(0);
    expect(pull.pulledCount).toBe(1);
    expect(gh.headSha()).toBe(headAfterB); // no commit — nothing left the device
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1")); // remote untouched
    expect(gh.headFiles().has(FILE_C)).toBe(false); // local add NOT pushed
    expect(local.files.get(FILE_B)).toBe(remoteEdit); // remote change applied
    expect(local.files.get(FILE_A)).toBe(localEdit); // local edit intact

    // Local changes stayed DIFFABLE — the next full Sync pushes them.
    const full = await engine.sync(gh.spec());
    expect(full.status).toBe("synced");
    expect(full.pushedCount).toBe(2);
    expect(gh.headFiles().get(FILE_A)).toBe(localEdit);
    expect(gh.headFiles().get(FILE_C)).toBe(mdAsset("u3", "local add"));
  });

  it("defers a conflict: merge layer NOT invoked, disk + remote untouched, path pinned", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const resolve = jest.fn();
    const mergeLayer = { resolve } as unknown as MergeLayerPort;
    const { engine, watermarks } = makeEngine(gh, local, { mergeLayer });
    await bootstrap(engine, gh.spec());

    const remoteEdit = mdAsset("u1", "remote edit");
    gh.commitDirect("main", { [FILE_A]: remoteEdit }, "device B");
    const localEdit = mdAsset("u1", "local edit");
    local.files.set(FILE_A, localEdit);

    const pull = await engine.sync(gh.spec(), "pull");

    expect(pull.status).toBe("synced");
    expect(resolve).not.toHaveBeenCalled(); // split runs never merge
    expect(pull.pushedCount).toBe(0);
    expect(pull.pulledCount).toBe(0);
    expect(pull.deferredPaths).toEqual([FILE_A]);
    expect(pull.warnings.join(" ")).toMatch(/deferred to a full Sync/);
    expect(local.files.get(FILE_A)).toBe(localEdit); // disk untouched
    expect(gh.headFiles().get(FILE_A)).toBe(remoteEdit); // remote untouched
    expect(
      watermarks.records.get(gh.spec().repoKey)!.pinnedPaths,
    ).toContain(FILE_A);
  });

  it("file-mode first-sync under pull: remote files land, local-only files never leave the device", async () => {
    const gh = new FakeGitHubRepo({ "files/r.txt": "remote bytes" });
    const local = new FakeLocalFiles({ "files/l.txt": "local-only bytes" });
    const { engine, watermarks } = makeEngine(gh, local, {
      quarantine: new InMemoryQuarantineStore(),
    });
    const spec = gh.spec("file");

    const pull = await engine.sync(spec, "pull");

    expect(pull.status).toBe("synced");
    expect(pull.pulledCount).toBe(1);
    expect(pull.pushedCount).toBe(0);
    expect(local.files.has("files/r.txt")).toBe(true); // remote file pulled
    expect(gh.headFiles().has("files/l.txt")).toBe(false); // nothing pushed
    // First-sync synthetic base must still persist the watermark.
    expect(watermarks.records.get(spec.repoKey)).toBeDefined();
  });
});

describe("SyncEngine — push-only direction (#3473)", () => {
  it("pushes the local delta, never applies remote changes, and pins them to re-derive", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    const remoteEdit = mdAsset("u2", "remote edit");
    gh.commitDirect("main", { [FILE_B]: remoteEdit }, "device B");
    const localEdit = mdAsset("u1", "local edit");
    local.files.set(FILE_A, localEdit);

    const push = await engine.sync(gh.spec(), "push");

    expect(push.status).toBe("synced");
    expect(push.pushedCount).toBe(1);
    expect(push.pulledCount).toBe(0);
    expect(gh.headFiles().get(FILE_A)).toBe(localEdit); // local delta landed
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2")); // remote NOT applied
    expect(push.deferredPaths).toEqual([FILE_B]);
    expect(
      watermarks.records.get(gh.spec().repoKey)!.pinnedPaths,
    ).toContain(FILE_B);

    // The pinned remote change re-derives and applies on the next full Sync
    // — never silently reverted by a push of the stale local copy.
    const full = await engine.sync(gh.spec());
    expect(full.status).toBe("synced");
    expect(full.pulledCount).toBe(1);
    expect(local.files.get(FILE_B)).toBe(remoteEdit);
    expect(gh.headFiles().get(FILE_B)).toBe(remoteEdit); // never reverted
  });

  it("defers a conflict WITHOUT aborting the repo: non-conflicting files still push (no merge layer)", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local); // NO merge layer (A1)
    await bootstrap(engine, gh.spec());

    const remoteEdit = mdAsset("u1", "remote edit");
    gh.commitDirect("main", { [FILE_A]: remoteEdit }, "device B");
    local.files.set(FILE_A, mdAsset("u1", "local edit")); // conflict on A
    const localB = mdAsset("u2", "local edit B");
    local.files.set(FILE_B, localB); // clean local edit

    const push = await engine.sync(gh.spec(), "push");

    // A full Sync in the same merge-layer-less composition returns
    // "conflict" and aborts the whole repo (A1). The split run instead
    // defers the conflict and pushes the rest — documented contract
    // difference (#3473).
    expect(push.status).toBe("synced");
    expect(push.pushedCount).toBe(1);
    expect(gh.headFiles().get(FILE_B)).toBe(localB);
    expect(gh.headFiles().get(FILE_A)).toBe(remoteEdit); // conflicting local NOT pushed
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit")); // remote NOT applied
    expect(push.deferredPaths).toEqual([FILE_A]);
    expect(
      watermarks.records.get(gh.spec().repoKey)!.pinnedPaths,
    ).toContain(FILE_A);
  });

  it("race-window: watermark NOT advanced — the concurrent change re-derives on the next full Sync", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const baseSha = gh.headSha();

    // Concurrent commit lands inside the unguarded window: after the
    // engine's head check, on the primitive's internal GET-ref.
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const concurrent = mdAsset("u2", "concurrent edit");
    let refCalls = 0;
    gh.onGetRef = (): void => {
      refCalls++;
      if (refCalls === 2) {
        gh.commitDirect("main", { [FILE_B]: concurrent }, "race");
      }
    };
    const push = await engine.sync(gh.spec(), "push");
    gh.onGetRef = undefined;

    expect(push.status).toBe("synced");
    expect(push.warnings.join(" ")).toMatch(/watermark NOT advanced/);
    expect(
      watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha,
    ).toBe(baseSha);
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2")); // not applied (push run)

    const full = await engine.sync(gh.spec());
    expect(full.status).toBe("synced");
    expect(local.files.get(FILE_B)).toBe(concurrent); // converges
    expect(gh.headFiles().get(FILE_B)).toBe(concurrent); // never reverted
  });

  it("re-pins a previously quarantined path instead of falsely marking it resolved", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const markResolved = jest.fn(async (): Promise<void> => undefined);
    const quarantine: QuarantinePort = {
      quarantine: async (): Promise<void> => undefined,
      markResolved,
    };
    const mergeLayer: MergeLayerPort = {
      resolve: async () => ({
        action: "quarantine",
        reason: "unmergeable (test)",
      }),
    };
    const { engine, watermarks } = makeEngine(gh, local, {
      mergeLayer,
      quarantine,
    });
    await bootstrap(engine, gh.spec());

    // Round 1 (full Sync): local + remote edits conflict → quarantined + pinned.
    const remoteEdit = mdAsset("u1", "remote edit");
    gh.commitDirect("main", { [FILE_A]: remoteEdit }, "device B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const first = await engine.sync(gh.spec());
    expect(first.quarantinedCount).toBe(1);
    expect(
      watermarks.records.get(gh.spec().repoKey)!.pinnedPaths,
    ).toContain(FILE_A);

    // User reverts the local edit; the remote change is still unapplied.
    local.files.set(FILE_A, mdAsset("u1"));

    // Push run: the re-derived remote change is deferred (NOT applied) —
    // the pin must survive and the open quarantine record must NOT be
    // auto-resolved (resolveClearedPins invariant holds on applyWrites pins).
    const push = await engine.sync(gh.spec(), "push");
    expect(push.status).toBe("synced");
    expect(markResolved).not.toHaveBeenCalled();
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1"));
    expect(
      watermarks.records.get(gh.spec().repoKey)!.pinnedPaths,
    ).toContain(FILE_A);

    // The full Sync applies the remote change and only THEN resolves the pin.
    const full = await engine.sync(gh.spec());
    expect(full.pulledCount).toBe(1);
    expect(local.files.get(FILE_A)).toBe(remoteEdit);
    expect(markResolved).toHaveBeenCalledWith(gh.spec().repoKey, FILE_A);
  });
});
