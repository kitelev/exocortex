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
  orderChildrenFirst,
  isNonFastForwardError,
  type MergeConflictInput,
  type MergeDecision,
  type MergeLayerPort,
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
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1", "local-divergent") });
    const { engine } = makeEngine(gh, local);

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("full-conflict");
    expect(result.detail).toMatch(/first-sync/);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "remote")); // remote untouched
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local-divergent")); // disk untouched
  });
});

describe("SyncEngine — push-only happy path (VL#7, D3)", () => {
  it("pushes a local edit via restCreateCommit and advances the watermark", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
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
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), "img/pic.png": "PNGBYTES" });
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

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "from device B") }, "device B");
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0);
    expect(result.pulledCount).toBe(1);
    expect(local.files.get(FILE_B)).toBe(mdAsset("u2", "from device B"));
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(gh.headSha());
  });

  it("applies a remote delete locally when the file is locally untouched", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", {}, "device B deletes b", [FILE_B]);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(local.files.has(FILE_B)).toBe(false);
  });

  it("pushes local + applies remote when changes are disjoint", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote v2") }, "device B");
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

    gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote edit") }, "device B");
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("conflict");
    expect(result.detail).toMatch(/u1/);
    expect(gh.headFiles().get(FILE_A)).toBe(mdAsset("u1", "remote edit")); // remote untouched
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit")); // disk untouched
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(wmBefore); // watermark frozen
  });

  it("local delete vs remote modify → conflict", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote edit") }, "device B");
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
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(gh.headSha());
  });
});

describe("SyncEngine — deferred deletes & renames (A1: primitive cannot delete)", () => {
  it("local delete is deferred with a warning; remote keeps the file", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_B);
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.deferredDeletes).toContain(FILE_B);
    expect(result.warnings.join(" ")).toMatch(/deferred delete/);
    expect(gh.headFiles().has(FILE_B)).toBe(true); // never deleted remotely in A1
  });

  it("rename is deferred whole (no uid duplicate on remote)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    local.files.delete(FILE_A);
    local.files.set("assets/renamed.md", mdAsset("u1"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pushedCount).toBe(0); // new path NOT pushed — would duplicate uid u1
    expect(result.deferredDeletes).toContain(FILE_A);
    expect(result.warnings.join(" ")).toMatch(/deferred rename/);
    expect(gh.headFiles().has("assets/renamed.md")).toBe(false);
    expect(gh.headFiles().has(FILE_A)).toBe(true);
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
        new Error("GitHub createCommit: ref update mismatch (expected a, got b)"),
      ),
    ).toBe(true);
    expect(
      isNonFastForwardError(
        new Error("GitHub request POST https://api.github.com/repos/o/r/git/trees → HTTP 422: bad tree"),
      ),
    ).toBe(false);
    expect(isNonFastForwardError(new Error("network down"))).toBe(false);
  });

  it("recovers from a concurrent push racing the PATCH (re-pull → retry)", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());

    // Device B lands a DISJOINT commit between this engine's tree/commit
    // creation and its PATCH — the exact force:false race (D9).
    let injected = false;
    gh.onBeforePatch = (): void => {
      if (!injected) {
        injected = true;
        gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "raced in") }, "device B race");
      }
    };
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.warnings.join(" ")).toMatch(/non-fast-forward push \(attempt 1\/3\)/);
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
      gh.commitDirect("main", { [`assets/race-${counter}.md`]: mdAsset(`race-${counter}`) }, "race");
    };
    local.files.set(FILE_A, mdAsset("u1", "local edit"));
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("retry-exhausted");
    expect(result.detail).toMatch(/after 2 retries/);
    expect(local.files.get(FILE_A)).toBe(mdAsset("u1", "local edit")); // disk pristine
  });

  it("race on a NON-pushed path: watermark is not advanced and the next sync does NOT revert the concurrent change", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
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
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(baseSha);

    gh.onGetRef = undefined;
    const second = await engine.sync(gh.spec());

    expect(second.status).toBe("synced");
    expect(second.pushedCount).toBe(0); // own pushed edit converges, nothing re-pushed
    expect(gh.headFiles().get(FILE_B)).toBe(concurrent); // concurrent change NOT reverted
    expect(local.files.get(FILE_B)).toBe(concurrent); // pulled to disk
    expect(watermarks.records.get(gh.spec().repoKey)!.lastSyncedSha).toBe(gh.headSha());
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
        gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "raced overwrite") }, "race");
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
          throw new Error(`GitHub request ${req.method} ${req.url} → HTTP 500: boom`);
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
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    const { engine, watermarks } = makeEngine(gh, local);
    await bootstrap(engine, gh.spec());
    const oldEntry = watermarks.records
      .get(gh.spec().repoKey)!
      .files.find((f) => f.path === FILE_B)!;

    gh.commitDirect("main", { [FILE_B]: mdAsset("u2", "remote edit") }, "device B");
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
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
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
    expect(result.quarantinedCount).toBe(0);
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
    expect(result.mergedCount).toBe(0);
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
    expect(
      watermarks.records.get(gh.spec().repoKey)!.pinnedPaths,
    ).toContain(FILE_A);
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

    gh.commitDirect("main", { [FILE_A]: yamlAsset("Base", "remote-value") }, "B");
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
