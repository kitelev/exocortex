/**
 * ExoSync SyncEngine unit tests (RFC 4e4dc453 A1 — D3/D12/D16/D19).
 *
 * The GitHub side is the production-shape `FakeGitHubRepo` (real git blob
 * SHAs, transport error contract, force:false 422 semantics) — see
 * fakeGitHub.ts module docstring.
 */

import * as yaml from "js-yaml";
import {
  GatedStructuredMerger,
  InMemoryQuarantineStore,
  StructuredMerger,
  SyncEngine,
  gitBlobSha,
  orderChildrenFirst,
  isNonFastForwardError,
  type MergeConflictInput,
  type MergeDecision,
  type MergeLayerPort,
  type RestCommitTransport,
  type SyncEngineDeps,
  type SyncRepoSpec,
  type YamlCodec,
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

describe("SyncEngine — D19 full-materialization gate", () => {
  it("skips a non-fully-materialized repo with a warning and infers nothing", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({}); // empty disk — absence must NOT become deletes
    const { engine, watermarks } = makeEngine(gh, local, {
      materializationCheck: neverMaterialized("mid-mount"),
    });

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("skipped-not-materialized");
    expect(result.warnings.join(" ")).toMatch(/deletes NOT inferred/);
    expect(result.deferredDeletes).toEqual([]);
    expect(watermarks.records.size).toBe(0);
    expect(gh.headFiles().has(FILE_A)).toBe(true); // remote untouched
  });
});

describe("SyncEngine — first-sync bootstrap (D22)", () => {
  it("seeds the watermark when disk exactly equals the remote head", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.lastSyncedSha).toBe(gh.headSha());
    expect(record.files).toEqual([
      expect.objectContaining({ path: FILE_A, uid: "u1" }),
    ]);
  });

  it("returns full-conflict when disk diverges and no watermark exists (never overwrites)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1", "remote") });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1", "local-divergent"),
    });
    const { engine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("full-conflict");
    expect(result.detail).toMatch(/first-sync/);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "remote")); // remote untouched
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local-divergent")); // disk untouched
  });
});

// #3565 — the canonical onboarding (apply profile → create asset → Sync) used
// to DEADLOCK on an asset-mode AssetSpace: a purely ADDITIVE local divergence
// (local-only new files, every remote-head file still present byte-identical)
// returned `full-conflict — first-sync` and pushed nothing, with no watermark
// ever established. The fix gives asset-mode first-sync the additive-tolerant
// synthetic base file-mode already had, while RESERVING full-conflict for
// genuine overlapping edits/deletes (zero-loss intact).
describe("SyncEngine — first-sync additive divergence (#3565)", () => {
  it("pushes local-only additions when local is a pure superset of remote head", async () => {
    // Profile applied (remote materialized byte-identical), then the tester
    // created a new asset → local = remote ∪ {new file}, no watermark yet.
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1); // the local-only add — a clean ff
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2")); // landed on remote
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1")); // neighbour intact
    expect(result.warnings.join(" ")).toMatch(/pure superset/);

    // The deadlock is gone: a watermark is established, so a re-sync no-ops
    // (pre-fix every re-run reproduced full-conflict indefinitely).
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.files.map((f) => f.path).sort()).toEqual([FILE_A, FILE_B]);
    const again = await engine.sync(gh.spec());
    expect(again.status).toBe("synced");
    expect(again.pushedCount).toBe(0);
  });

  it("pushes several local-only additions in one first sync", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      ["assets/c.md"]: mdAsset("u3"),
      ["assets/d.md"]: mdAsset("u4"),
    });
    const { engine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(2);
    expect(gh.headFiles().get("assets/c.md")).toBe(mdAsset("u3"));
    expect(gh.headFiles().get("assets/d.md")).toBe(mdAsset("u4"));
  });

  it("stays full-conflict when a remote-head file is absent locally (not purely additive)", async () => {
    // R ⊄ L: a remote file is missing on disk — ambiguous (remote add vs local
    // delete) with no watermark, so the conservative zero-loss answer holds.
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("full-conflict");
    expect(result.detail).toMatch(/first-sync/);
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2")); // remote untouched
    expect(watermarks.records.size).toBe(0); // no watermark on conflict
  });

  it("stays full-conflict when an addition coincides with a same-path edit (genuine overlap)", async () => {
    // Local both edits FILE_A and adds FILE_B. The FILE_A edit breaks R ⊆ L,
    // so the whole first sync stays full-conflict — the add is NOT pushed,
    // preserving M1 zero-loss for the overlapping edit.
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1", "remote") });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1", "local-edit"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("full-conflict");
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "remote")); // untouched
    expect(gh.headFiles().has(FILE_B)).toBe(false); // add NOT pushed amid overlap
  });
});

describe("SyncEngine — push-only happy path (VL#7, D3)", () => {
  it("pushes a local edit via restCreateCommit and advances the watermark", async () => {
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

    const edited = mdAsset("u1", "edited locally");
    local.files.set(FILE_A, edited);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(result.pushedSha).toBe(gh.headSha());
    expect(gh.headFiles().get(FILE_A)).toBe(edited); // commit landed on remote
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2")); // untouched neighbour intact
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(
      result.pushedSha,
    );
  });

  it("adds a brand-new asset", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.set(FILE_B, mdAsset("u2", "new asset"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2", "new asset"));
  });

  it("non-.md files are excluded symmetrically (binary safety)", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      "img/pic.png": "PNGBYTES",
    });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") }); // png absent locally
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec()); // bootstrap ignores the png

    local.files.set(FILE_A, mdAsset("u1", "v2"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.deferredDeletes).toEqual([]); // png absence is NOT a delete
    expect(gh.headFiles().get("img/pic.png")).toBe("PNGBYTES"); // remote binary intact
  });
});

describe("SyncEngine — pull phase (no-conflict remote changes)", () => {
  it("applies remote-only changes to disk without pushing", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect(
      "main",
      { [FILE_B]: mdAsset("u2", "from device B") },
      "device B",
    );
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    expect(result.pulledCount).toBe(1);
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2", "from device B"));
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(
      gh.headSha(),
    );
  });

  it("applies a remote delete locally when the file is locally untouched", async () => {
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

    gh.commitDirect("main", {}, "device B deletes b", [FILE_B]);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(local.files.has(FILE_B)).toBe(false);
  });

  it("pushes local + applies remote when changes are disjoint", async () => {
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

    gh.commitDirect(
      "main",
      { [FILE_B]: mdAsset("u2", "remote v2") },
      "device B",
    );
    local.files.set(FILE_A, mdAsset("u1", "local v2"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(result.pulledCount).toBe(1);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "local v2"));
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2", "remote v2"));
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2", "remote v2"));
  });
});

describe("SyncEngine — conflicts (A2/A3 deferral, never overwrite)", () => {
  it("same uid changed on both sides → conflict, nothing pushed, nothing written", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const wmBefore = watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha;

    gh.commitDirect(
      "main",
      { [FILE_A]: mdAsset("u1", "remote edit") },
      "device B",
    );
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("conflict");
    expect(result.detail).toMatch(/u1/);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "remote edit")); // remote untouched
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit")); // disk untouched
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(
      wmBefore,
    ); // watermark frozen
  });

  it("local delete vs remote modify → conflict", async () => {
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

    gh.commitDirect(
      "main",
      { [FILE_B]: mdAsset("u2", "remote edit") },
      "device B",
    );
    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("conflict");
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2", "remote edit"));
  });

  it("convergent edit (identical content both sides) is NOT a conflict and is not re-pushed", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    const same = mdAsset("u1", "identical on both sides");
    gh.commitDirect("main", { [FILE_A]: same }, "device B");
    local.files.set(FILE_A, same);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    expect(result.pushedSha).toBeUndefined();
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(
      gh.headSha(),
    );
  });
});

describe("SyncEngine — deletes & renames propagate (#3476; full coverage in SyncEngine.delete-propagation.test.ts)", () => {
  it("local delete is pushed; nothing deferred, remote drops the file", async () => {
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

    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedDeletes).toEqual([FILE_B]);
    expect(result.deferredDeletes).toEqual([]);
    expect(gh.headFiles().has(FILE_B)).toBe(false); // deletion landed remotely
  });

  it("rename pushes both halves in one commit (no uid duplicate on remote)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_A);
    local.files.set("assets/renamed.md", mdAsset("u1"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1);
    expect(result.pushedDeletes).toEqual([FILE_A]);
    expect(result.deferredDeletes).toEqual([]);
    expect(gh.headFiles().get("assets/renamed.md")).toBe(mdAsset("u1"));
    expect(gh.headFiles().has(FILE_A)).toBe(false);
  });
});

describe("SyncEngine — D16 non-fast-forward retry loop", () => {
  it("classifies the production 422 message and the structural mismatch as retryable", () => {
    expect(
      isNonFastForwardError(
        new Error(
          "GitHub request PATCH https://api.github.com/repos/o/r/git/refs/heads/main → HTTP 422: Update is not a fast forward",
        ),
      ),
    ).toBe(true);
    expect(
      isNonFastForwardError(
        new Error(
          "GitHub createCommit: ref update mismatch (expected a, got b)",
        ),
      ),
    ).toBe(true);
    expect(
      isNonFastForwardError(
        new Error(
          "GitHub request POST https://api.github.com/repos/o/r/git/trees → HTTP 422: bad tree",
        ),
      ),
    ).toBe(false);
    expect(isNonFastForwardError(new Error("network down"))).toBe(false);
  });

  it("recovers from a concurrent push racing the PATCH (re-pull → retry)", async () => {
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

    // Device B lands a DISJOINT commit between this engine's tree/commit
    // creation and its PATCH — the exact force:false race (D9).
    let injected = false;
    gh.onBeforePatch = (): void => {
      if (!injected) {
        injected = true;
        gh.commitDirect(
          "main",
          { [FILE_B]: mdAsset("u2", "raced in") },
          "device B race",
        );
      }
    };
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(
      /non-fast-forward push \(attempt 1\/3\)/,
    );
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "local edit"));
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2", "raced in"));
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2", "raced in")); // pulled on retry
  });

  it("gives up after the retry cap (D16 cap, quarantine is A3 scope)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local, { maxPushRetries: 2 });
    await bootstrap(engine, gh.spec());

    let counter = 0;
    gh.onBeforePatch = (): void => {
      counter++;
      gh.commitDirect(
        "main",
        { [`assets/race-${counter}.md`]: mdAsset(`race-${counter}`) },
        "race",
      );
    };
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("retry-exhausted");
    expect(result.detail).toMatch(/after 2 retries/);
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit")); // disk pristine
  });

  it("race on a NON-pushed path: watermark is not advanced and the next sync does NOT revert the concurrent change", async () => {
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
    const baseSha = watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha;

    // Concurrent commit touching FILE_B (NOT pushed by us) lands inside the
    // unguarded window: after the engine's head check, on the primitive's
    // internal GET-ref. Absorbing its blob into the watermark without writing
    // it to disk would make the stale local FILE_B look like a local edit on
    // the NEXT sync — a silent revert of the concurrent change.
    const concurrent = mdAsset("u2", "concurrent non-overlapping edit");
    let refCalls = 0;
    gh.onGetRef = (): void => {
      refCalls++;
      if (refCalls === 2) {
        gh.commitDirect("main", { [FILE_B]: concurrent }, "race non-overlap");
      }
    };
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const first = await engine.sync(gh.spec());

    expect(first.status).toBe("synced");
    expect(first.warnings.join(" ")).toMatch(/watermark NOT advanced/);
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(
      baseSha,
    );

    gh.onGetRef = undefined;
    const second = await engine.sync(gh.spec());

    expect(second.status).toBe("synced");
    expect(second.pushedCount).toBe(0); // own pushed edit converges, nothing re-pushed
    expect(gh.headFiles().get(FILE_B)).toBe(concurrent); // concurrent change NOT reverted
    expect(local.files.get(FILE_B)).toBe(concurrent); // pulled to disk
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(
      gh.headSha(),
    );
  });

  it("warns on the residual race window (concurrent commit between conflict check and the primitive's GET-ref)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    // The engine's pull examines head on GET-ref call N; the primitive
    // re-GETs the ref afterwards. Injecting a commit touching the SAME file
    // on the primitive's GET lands the race inside the unguarded window.
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    let refCalls = 0;
    gh.onGetRef = (): void => {
      refCalls++;
      if (refCalls === 2) {
        gh.commitDirect(
          "main",
          { [FILE_A]: mdAsset("u1", "raced overwrite") },
          "race",
        );
      }
    };
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/race-window/);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "local edit")); // local won; history holds both
  });
});

describe("SyncEngine — error paths (D12 warn-not-block)", () => {
  it("truncated remote tree → loud error result, repo skipped", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2") }, "device B");
    gh.truncatedTrees = true;
    local.files.set(FILE_A, mdAsset("u1", "v2"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/truncated/);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1")); // nothing pushed
  });

  it("watermark pointing at a rewritten/GC'd commit → full-conflict (base-mismatch)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    const record = watermarks.records.get(gh.spec().repoKey)!;
    watermarks.records.set(gh.spec().repoKey, {
      ...record,
      lastSyncedSha: "deadbeef".repeat(5), // commit unknown to the remote
    });
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("full-conflict");
    expect(result.detail).toMatch(/base-mismatch/);
  });

  it("syncAll is best-effort: a failing repo yields `error` and does not block the next one", async () => {
    const ghOk = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const localOk = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const watermarks = new FakeWatermarkStore();

    const brokenSpec: SyncRepoSpec = {
      owner: "broken-owner",
      repo: "broken-repo",
      branch: "main",
      repoKey: "broken",
      localPath: "a/b",
    };
    const okSpec = { ...ghOk.spec(), repoKey: "ok", localPath: "a" };

    const engine = new SyncEngine({
      transport: async (req) => {
        if (req.url.includes("broken-owner")) {
          throw new Error(
            `GitHub request ${req.method} ${req.url} → HTTP 500: boom`,
          );
        }
        return ghOk.transport()(req);
      },
      watermarkStore: watermarks,
      materializationCheck: alwaysMaterialized(),
      localFilesFor: (spec) =>
        spec.repoKey === "broken" ? new FakeLocalFiles({}) : localOk,
      sha1: sha1Hex,
    });

    const results = await engine.syncAll([brokenSpec, okSpec]);
    expect(results.map((r) => r.status)).toEqual(["error", "synced"]);
    expect(results[0].detail).toMatch(/HTTP 500/);
  });
});

describe("orderChildrenFirst (D12 children-before-parent)", () => {
  it("orders deeper localPaths first", () => {
    const mk = (localPath: string): SyncRepoSpec => ({
      owner: "o",
      repo: "r",
      branch: "main",
      repoKey: localPath,
      localPath,
    });
    const ordered = orderChildrenFirst([
      mk("assetspaces"),
      mk("assetspaces/kitelev/exoas-exodev"),
      mk("assetspaces/exo"),
    ]);
    expect(ordered.map((s) => s.localPath)).toEqual([
      "assetspaces/kitelev/exoas-exodev",
      "assetspaces/exo",
      "assetspaces",
    ]);
  });
});

describe("SyncEngine — TOCTOU guard on pull-apply (A1 review MEDIUM)", () => {
  /** read() returns mutated content from the 2nd read after arming. */
  class ToctouLocalFiles extends FakeLocalFiles {
    armed = false;
    private reads = 0;
    constructor(
      initial: Record<string, string>,
      private readonly target: string,
      private readonly mutated: string,
    ) {
      super(initial);
    }
    override async read(path: string): Promise<string> {
      if (this.armed && path === this.target && ++this.reads > 1) {
        return this.mutated;
      }
      return super.read(path);
    }
  }

  it("skips the apply, pins the watermark entry, and re-derives next sync", async () => {
    const local = new ToctouLocalFiles(
      { [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") },
      FILE_B,
      mdAsset("u2", "user edit mid-sync"),
    );
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const oldEntry = watermarks.records
      .get(gh.spec().repoKey)!
      .files.find((f) => f.path === FILE_B)!;

    gh.commitDirect(
      "main",
      { [FILE_B]: mdAsset("u2", "remote edit") },
      "device B",
    );
    local.armed = true;
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/TOCTOU/);
    expect(result.pulledCount).toBe(0);
    // Write skipped — disk still holds the snapshot content.
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2"));
    // Watermark advanced for the repo but PINNED the old entry for FILE_B —
    // the never-applied remote change must re-derive, not become a phantom
    // local edit (silent revert).
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.lastSyncedSha).toBe(gh.headSha());
    expect(record.files.find((f) => f.path === FILE_B)).toEqual(oldEntry);

    // Next sync (no mid-sync mutation): the remote change applies cleanly.
    local.armed = false;
    const second = await engine.sync(gh.spec());
    expect(second.status).toBe("synced");
    expect(second.pulledCount).toBe(1);
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2", "remote edit"));
  });

  it("skips a remote delete when the local file changed mid-sync", async () => {
    const local = new ToctouLocalFiles(
      { [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") },
      FILE_B,
      mdAsset("u2", "user edit mid-sync"),
    );
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const oldEntry = watermarks.records
      .get(gh.spec().repoKey)!
      .files.find((f) => f.path === FILE_B)!;

    gh.commitDirect("main", {}, "device B deletes", [FILE_B]);
    local.armed = true;
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/TOCTOU/);
    expect(local.files.has(FILE_B)).toBe(true); // delete skipped
    // Old entry appended even though the path left the head tree — the
    // delete (now delete-vs-modify) must re-derive next sync.
    const record = watermarks.records.get(gh.spec().repoKey)!;
    expect(record.files.find((f) => f.path === FILE_B)).toEqual(oldEntry);
  });
});

describe("SyncEngine — no-op fast path (A1 review MEDIUM perf)", () => {
  it("does not rebuild the watermark when nothing changed anywhere", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    const setSpy = jest.spyOn(watermarks, "set");
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    expect(result.pulledCount).toBe(0);
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("SyncEngine — A2 merge layer integration", () => {
  const stubMergeLayer = (
    fn: (input: MergeConflictInput) => MergeDecision,
  ): MergeLayerPort => ({ resolve: async (i) => fn(i) });

  it("use-merged: pushes the merged content AND writes it to disk", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const merged = mdAsset("u1", "merged by layer");
    const seen: MergeConflictInput[] = [];
    const { engine } = makeEngine(gh, local, {
      mergeLayer: stubMergeLayer((i) => {
        seen.push(i);
        return { action: "use-merged", content: merged, warnings: ["w1"] };
      }),
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.mergedCount).toBe(1);
    expect(result.mergedPaths).toEqual([FILE_A]); // E1 — parity conservation input
    expect(result.quarantinedCount).toBe(0);
    expect(result.quarantinedPaths).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/merge\(assets\/a\.md\): w1/);
    expect(gh.headFiles().get(FILE_A)).toBe(merged); // pushed
    expect(local.files.get(FILE_A)).toBe(merged); // written to disk
    // The merge layer received the full 3-way input.
    expect(seen[0]).toMatchObject({
      path: FILE_A,
      uid: "u1",
      base: mdAsset("u1"),
      local: mdAsset("u1", "local edit"),
      remote: mdAsset("u1", "remote edit"),
    });

    // Convergent next sync: no conflict left, nothing to do.
    const second = await engine.sync(gh.spec());
    expect(second.status).toBe("synced");
    expect(second.mergedCount).toBe(0);
    expect(second.pushedCount).toBe(0);
  });

  it("merged == remote: nothing pushed, merged applied to disk only", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const remoteContent = mdAsset("u1", "remote wins");
    const { engine } = makeEngine(gh, local, {
      mergeLayer: stubMergeLayer(() => ({
        action: "use-merged",
        content: remoteContent,
      })),
    });
    await bootstrap(engine, gh.spec());
    const headBefore = gh.refs.get("main");

    gh.commitDirect("main", { [FILE_A]: remoteContent }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.mergedCount).toBe(1);
    expect(result.pushedSha).toBeUndefined(); // no push commit created
    expect(gh.refs.get("main")).not.toBe(headBefore); // only device B's commit
    expect(local.files.get(FILE_A)).toBe(remoteContent); // disk converged
  });

  it("quarantine: both versions preserved, nothing touched, conflict re-derives", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const store = new InMemoryQuarantineStore();
    const { engine, watermarks } = makeEngine(gh, local, {
      mergeLayer: stubMergeLayer(() => ({
        action: "quarantine",
        reason: "unresolvable overlap",
      })),
      quarantine: store,
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1);
    expect(result.quarantinedPaths).toEqual([FILE_A]); // E1 — conservation input
    expect(result.mergedCount).toBe(0);
    expect(result.mergedPaths).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/quarantined assets\/a\.md/);
    // Both versions captured (D17), nothing shipped anywhere.
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({
      path: FILE_A,
      uid: "u1",
      reason: "unresolvable overlap",
      baseContent: mdAsset("u1"),
      localContent: mdAsset("u1", "local edit"),
      remoteContent: mdAsset("u1", "remote edit"),
    });
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "remote edit"));
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit"));
    // Watermark pinned → the same conflict re-derives on the next sync.
    expect(watermarks.records.get(gh.spec().repoKey)!.pinnedPaths).toContain(
      FILE_A,
    );
    const second = await engine.sync(gh.spec());
    expect(second.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(2);
  });

  it("end-to-end with the real GatedStructuredMerger: non-overlapping edits merge", async () => {
    const codec: YamlCodec = {
      parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
      stringify: (value) =>
        yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
    };
    const yamlAsset = (label: string, extra?: string): string =>
      `---\nexo__Asset_uid: u1\nexo__Asset_label: ${label}\n${extra !== undefined ? `extra: ${extra}\n` : ""}---\n\nbody\n`;
    const gh = new FakeGitHubRepo({ [FILE_A]: yamlAsset("Base") });
    const local = new FakeLocalFiles({ [FILE_A]: yamlAsset("Base") });
    const { engine } = makeEngine(gh, local, {
      mergeLayer: new GatedStructuredMerger(new StructuredMerger(codec)),
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect(
      "main",
      { [FILE_A]: yamlAsset("Base", "remote-value") },
      "B",
    );
    local.files.set(FILE_A, yamlAsset("Local"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.mergedCount).toBe(1);
    const mergedOnRemote = gh.headFiles().get(FILE_A)!;
    expect(mergedOnRemote).toContain("exo__Asset_label: Local");
    expect(mergedOnRemote).toContain("extra: remote-value");
    expect(local.files.get(FILE_A)).toBe(mergedOnRemote);
  });

  it("without a merge layer the A1 conflict contract is unchanged", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local); // no mergeLayer
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("conflict");
    expect(result.mergedCount).toBe(0);
    expect(result.quarantinedCount).toBe(0);
  });
});

describe("SyncEngine — A3: convergent rename (A2 deferred MEDIUM)", () => {
  const stubMergeLayer = (
    fn: (input: MergeConflictInput) => MergeDecision,
  ): MergeLayerPort => ({ resolve: async (i) => fn(i) });
  const RENAMED = "assets/renamed.md";

  it("identical rename a→b on both sides is consumed — no false delete-vs-modify quarantine", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const store = new InMemoryQuarantineStore();
    const { engine } = makeEngine(gh, local, {
      mergeLayer: stubMergeLayer(() => ({
        action: "quarantine",
        reason: "merge layer must not be consulted for a convergent rename",
      })),
      quarantine: store,
    });
    await bootstrap(engine, gh.spec());

    // Both devices ran the SAME rename (rename-to-uid / co-location case).
    gh.commitDirect("main", { [RENAMED]: mdAsset("u1") }, "remote rename", [
      FILE_A,
    ]);
    local.files.delete(FILE_A);
    local.files.set(RENAMED, mdAsset("u1"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(0);
    expect(store.entries).toHaveLength(0);
    expect(gh.headFiles().has(FILE_A)).toBe(false);
    expect(gh.headFiles().get(RENAMED)).toBe(mdAsset("u1"));
    expect(local.files.get(RENAMED)).toBe(mdAsset("u1"));
  });

  it("GENUINE remote delete vs local rename still quarantines (never silently resurrects)", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const store = new InMemoryQuarantineStore();
    const { engine } = makeEngine(gh, local, {
      mergeLayer: stubMergeLayer(() => ({
        action: "quarantine",
        reason: "delete-vs-rename needs a human",
      })),
      quarantine: store,
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", {}, "remote genuine delete", [FILE_A]);
    local.files.delete(FILE_A);
    local.files.set(RENAMED, mdAsset("u1"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.quarantinedCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(gh.headFiles().has(RENAMED)).toBe(false); // renamed copy NOT pushed
  });
});

describe("SyncEngine — A3: merged blob not re-fetched (A2 deferred LOW)", () => {
  it("passes mergedWrites' blob SHA into the watermark rebuild", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const inner = gh.transport();
    const blobGets: string[] = [];
    const transport: RestCommitTransport = async (req) => {
      const m = /git\/blobs\/([0-9a-f]+)/.exec(req.url);
      if (m !== null && req.method === "GET") blobGets.push(m[1]);
      return inner(req);
    };
    const merged = mdAsset("u1", "merged by layer");
    const { engine } = makeEngine(gh, local, {
      transport,
      mergeLayer: {
        resolve: async () => ({ action: "use-merged", content: merged }),
      },
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    blobGets.length = 0;
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.mergedCount).toBe(1);
    const mergedBlobSha = await gitBlobSha(merged, sha1Hex);
    expect(gh.headFiles().get(FILE_A)).toBe(merged);
    expect(blobGets).not.toContain(mergedBlobSha); // watermark rebuild reuses the known SHA
  });
});

describe("SyncEngine — A3: D16 terminal-quarantine", () => {
  it("retry exhaustion routes contended files AND pending merge entries to quarantine", async () => {
    const gh = new FakeGitHubRepo({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: mdAsset("u1"),
      [FILE_B]: mdAsset("u2"),
    });
    const store = new InMemoryQuarantineStore();
    const { engine } = makeEngine(gh, local, {
      maxPushRetries: 1,
      quarantine: store,
      // FILE_A conflicts and the layer says quarantine; FILE_B is a plain
      // local edit that keeps losing the push race.
      mergeLayer: {
        resolve: async () => ({
          action: "quarantine",
          reason: "unresolvable overlap",
        }),
      },
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    local.files.set(FILE_B, mdAsset("u2", "contended edit"));
    let n = 0;
    gh.onBeforePatch = (): void => {
      n++;
      gh.commitDirect(
        "main",
        { [`assets/race-${n}.md`]: mdAsset(`r${n}`) },
        "race",
      );
    };
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("retry-exhausted");
    expect(result.quarantinedCount).toBe(2);
    const byPath = new Map(store.entries.map((e) => [e.path, e]));
    expect(byPath.get(FILE_A)).toMatchObject({
      reason: "unresolvable overlap",
      localContent: mdAsset("u1", "local edit"),
      remoteContent: mdAsset("u1", "remote edit"),
    });
    expect(byPath.get(FILE_B)).toMatchObject({
      uid: "u2",
      reason: expect.stringMatching(
        /non-fast-forward push failed after 1 retr/,
      ),
      localContent: mdAsset("u2", "contended edit"),
      remoteContent: mdAsset("u2"), // best-effort current head version
    });
    // M1: canonical files untouched anywhere.
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2", "contended edit"));
    expect(gh.headFiles().get(FILE_B)).toBe(mdAsset("u2"));
  });

  it("terminal entry for a merge-resolved-but-contended path records the DISK version, not the merged proposal", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const store = new InMemoryQuarantineStore();
    const merged = mdAsset("u1", "merged proposal");
    const { engine } = makeEngine(gh, local, {
      maxPushRetries: 1,
      quarantine: store,
      mergeLayer: {
        resolve: async () => ({ action: "use-merged", content: merged }),
      },
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    let n = 0;
    gh.onBeforePatch = (): void => {
      n++;
      gh.commitDirect(
        "main",
        { [`assets/race-${n}.md`]: mdAsset(`r${n}`) },
        "race",
      );
    };
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("retry-exhausted");
    expect(store.entries).toHaveLength(1);
    // The durable record shows what the user actually has on disk; the
    // merged proposal was never applied and re-derives next sync.
    expect(store.entries[0].localContent).toBe(mdAsset("u1", "local edit"));
    expect(store.entries[0].reason).toMatch(/merged proposal/);
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit"));
  });

  it("a failing quarantine sink degrades to a warning, never an error status", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local, {
      mergeLayer: {
        resolve: async () => ({ action: "quarantine", reason: "overlap" }),
      },
      quarantine: {
        quarantine: async () => {
          throw new Error("quarantine repo unreachable");
        },
      },
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced"); // pin still re-derives — D17 degradation
    expect(result.quarantinedCount).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/quarantine sink failed/);
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit"));
  });

  it("a cleared pin auto-resolves its quarantine entry (markResolved)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const resolved: string[] = [];
    let verdict: MergeDecision = { action: "quarantine", reason: "overlap" };
    const { engine } = makeEngine(gh, local, {
      mergeLayer: { resolve: async () => verdict },
      quarantine: {
        quarantine: async () => {},
        markResolved: async (repoKey, path) => {
          resolved.push(`${repoKey}:${path}`);
        },
      },
    });
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    expect((await engine.sync(gh.spec())).quarantinedCount).toBe(1); // pinned

    // User resolves: merge layer now converges the conflict.
    verdict = { action: "use-merged", content: mdAsset("u1", "resolved") };
    const second = await engine.sync(gh.spec());

    expect(second.status).toBe("synced");
    expect(resolved).toEqual([`${gh.spec().repoKey}:${FILE_A}`]);
  });
});

describe("SyncEngine — A3: D11 one-operation guard, R8 auth, R5 secret-scan", () => {
  it("a second concurrent operation returns `busy` (D11), syncAll has no self-deadlock", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const inner = gh.transport();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const transport: RestCommitTransport = async (req) => {
      await gate;
      return inner(req);
    };
    const { engine } = makeEngine(gh, local, { transport });

    const first = engine.sync(gh.spec());
    const second = await engine.sync(gh.spec()); // while first is in flight
    expect(second.status).toBe("busy");

    release!();
    expect((await first).status).toBe("synced");

    // syncAll acquires ONCE — inner repos never see their own guard.
    const all = await engine.syncAll([gh.spec(), gh.spec()]);
    expect(all.map((r) => r.status)).toEqual(["synced", "synced"]);
  });

  it("HTTP 401 → `auth-required` with an update-PAT hint, never treated as success (R8)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const transport: RestCommitTransport = async (req) => {
      throw new Error(
        `GitHub request ${req.method} ${req.url} → HTTP 401: Bad credentials`,
      );
    };
    const { engine } = makeEngine(gh, local, { transport });

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("auth-required");
    expect(result.detail).toMatch(/PAT/);
  });

  it("rate-limited requests are retried transparently via the wrapped transport (R6)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const inner = gh.transport();
    let failures = 2;
    const transport: RestCommitTransport = async (req) => {
      if (failures > 0) {
        failures--;
        throw new Error(
          `GitHub request ${req.method} ${req.url} → HTTP 403: API rate limit exceeded`,
        );
      }
      return inner(req);
    };
    const { engine } = makeEngine(gh, local, {
      transport,
      backoff: { sleep: async () => {} },
    });

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced"); // bootstrap survived the throttle
  });

  it("a push payload containing a PAT is refused outright (R5) — secret never leaves the device", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const headBefore = gh.headSha();

    const pat = `ghp_${"a1B2".repeat(10)}`;
    local.files.set(FILE_A, mdAsset("u1", `oops, pasted a token: ${pat}`));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("error");
    expect(result.detail).toMatch(/secret-scan/);
    expect(result.detail).toMatch(/github-token/);
    expect(result.detail).not.toContain(pat); // path+kind only, never the secret
    expect(gh.headSha()).toBe(headBefore); // nothing pushed
  });
});

describe("SyncEngine — #3475 phantom/empty commits (detected content already in HEAD)", () => {
  /**
   * Parallel-run state (#3475): the other device already pushed the same
   * bytes (Obsidian Sync replicated the files), but THIS device's watermark
   * never recorded them — its per-file entry still carries an older blob.
   * `lastSyncedSha`/`rootTreeSha` stay CURRENT: D22 validates only the root
   * tree integrity, not the per-file snapshot (see advanceWatermark
   * docstring), so detection derives a phantom "local change" whose content
   * is byte-identical to the remote HEAD entry.
   */
  async function staleWatermarkEntry(
    watermarks: FakeWatermarkStore,
    repoKey: string,
    path: string,
    staleContent: string,
  ): Promise<void> {
    const record = watermarks.records.get(repoKey)!;
    const staleBlobSha = await gitBlobSha(staleContent, sha1Hex);
    watermarks.records.set(repoKey, {
      ...record,
      files: record.files.map((f) =>
        f.path === path ? { ...f, blobSha: staleBlobSha } : f,
      ),
    });
  }

  it("does NOT create a commit when the detected content is already in HEAD; watermark converges", async () => {
    const alreadyPushed = mdAsset(
      "u1",
      "v2 — already pushed by the other device",
    );
    const gh = new FakeGitHubRepo({
      [FILE_A]: alreadyPushed,
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: alreadyPushed,
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    await staleWatermarkEntry(
      watermarks,
      gh.spec().repoKey,
      FILE_A,
      mdAsset("u1", "v1 — stale base"),
    );

    const headBefore = gh.headSha();
    const commitsBefore = gh.commits.size;
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedSha).toBeUndefined();
    expect(result.pushedCount).toBe(0);
    expect(gh.headSha()).toBe(headBefore); // no commit landed
    expect(gh.commits.size).toBe(commitsBefore); // not even an unreferenced one
    expect(result.warnings.join(" ")).toMatch(
      /already identical in remote HEAD/,
    );

    // Watermark converged: the stale entry now records the actual blob —
    // the phantom does NOT re-derive on the next sync.
    const after = watermarks.records.get(gh.spec().repoKey)!;
    expect(after.files.find((f) => f.path === FILE_A)!.blobSha).toBe(
      await gitBlobSha(alreadyPushed, sha1Hex),
    );
    const second = await engine.sync(gh.spec());
    expect(second.status).toBe("synced");
    expect(second.pushedCount).toBe(0);
    expect(second.warnings.join(" ")).not.toMatch(/already identical/);
    expect(gh.headSha()).toBe(headBefore);
  });

  it("pushes ONLY the real delta when one of two detected files is already in HEAD; counter is exact", async () => {
    const alreadyPushed = mdAsset("u1", "already in HEAD");
    const gh = new FakeGitHubRepo({
      [FILE_A]: alreadyPushed,
      [FILE_B]: mdAsset("u2"),
    });
    const local = new FakeLocalFiles({
      [FILE_A]: alreadyPushed,
      [FILE_B]: mdAsset("u2"),
    });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    await staleWatermarkEntry(
      watermarks,
      gh.spec().repoKey,
      FILE_A,
      mdAsset("u1", "stale base"),
    );
    const realEdit = mdAsset("u2", "genuinely new content");
    local.files.set(FILE_B, realEdit);

    const headBefore = gh.headSha();
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(1); // the real delta only — NOT 2 (#3475 inflated counter)
    expect(result.pushedSha).toBe(gh.headSha());
    expect(gh.headFiles().get(FILE_B)).toBe(realEdit);
    expect(gh.headFiles().get(FILE_A)).toBe(alreadyPushed); // untouched in the tree
    // Commit message reports the FILTERED count.
    const head = gh.commits.get(gh.headSha())!;
    expect(head.message).toBe("chore(exosync): sync 1 file(s)");
    expect(head.parents).toEqual([headBefore]); // exactly one commit, no phantom sibling

    // Watermark converged for BOTH paths — nothing re-derives.
    const after = watermarks.records.get(gh.spec().repoKey)!;
    expect(after.lastSyncedSha).toBe(gh.headSha());
    expect(after.files.find((f) => f.path === FILE_A)!.blobSha).toBe(
      await gitBlobSha(alreadyPushed, sha1Hex),
    );
    const second = await engine.sync(gh.spec());
    expect(second.pushedCount).toBe(0);
    expect(gh.headSha()).toBe(result.pushedSha);
  });
});
