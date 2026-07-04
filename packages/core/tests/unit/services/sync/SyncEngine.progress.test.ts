/**
 * ExoSync in-flight per-step progress callback (#3498).
 *
 * The engine emits coarse observation-only phases WHILE a single repo is
 * processing — `detecting` → `pulling-remote` → `merging` — so a UI can
 * surface live "detecting… / pulling remote tree… / merge layer firing…"
 * trace lines. The callback is strictly observation-only: it never changes
 * the sync outcome and a throwing observer is swallowed (info-channel
 * discipline #3186 — never the warn channel).
 */

import {
  SyncEngine,
  syncProgressPhaseText,
  type MergeLayerPort,
  type SyncEngineDeps,
  type SyncProgressEvent,
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
): SyncEngine {
  return new SyncEngine({
    transport: gh.transport(),
    watermarkStore: new FakeWatermarkStore(),
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    ...overrides,
  });
}

const useMergedMerger: MergeLayerPort = {
  resolve: async (input) => ({
    action: "use-merged",
    content: input.local ?? input.remote ?? "",
  }),
};

const FILE = "assets/a.md";

describe("SyncEngine — in-flight progress callback (#3498)", () => {
  it("emits detecting → pulling-remote while applying a remote change", async () => {
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "original") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "original") });
    const engine = makeEngine(gh, local);
    await engine.sync(gh.spec()); // bootstrap watermark

    gh.commitDirect("main", { [FILE]: mdAsset("u1", "remote edit") }, "device B");

    const phases: SyncProgressEvent[] = [];
    const result = await engine.sync(gh.spec(), "sync", (e) => phases.push(e));

    expect(result.status).toBe("synced");
    const seq = phases.filter((p) => p.repoKey === gh.spec().repoKey).map((p) => p.phase);
    expect(seq).toContain("detecting");
    expect(seq).toContain("pulling-remote");
    // detecting precedes pulling-remote within a single repo cycle.
    expect(seq.indexOf("detecting")).toBeLessThan(seq.indexOf("pulling-remote"));
    // No conflict ⇒ the merge layer never fires.
    expect(seq).not.toContain("merging");
  });

  it("emits merging when a conflict engages the merge layer (full Sync)", async () => {
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "original") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "original") });
    const engine = makeEngine(gh, local, { mergeLayer: useMergedMerger });
    await engine.sync(gh.spec());

    // Both sides edit the same path → conflict → merge layer.
    gh.commitDirect("main", { [FILE]: mdAsset("u1", "remote edit") }, "device B");
    local.files.set(FILE, mdAsset("u1", "local edit"));

    const phases: SyncProgressEvent[] = [];
    const result = await engine.sync(gh.spec(), "sync", (e) => phases.push(e));

    expect(result.status).toBe("synced");
    expect(result.mergedCount).toBe(1);
    const seq = phases.map((p) => p.phase);
    expect(seq).toContain("merging");
    expect(seq.indexOf("pulling-remote")).toBeLessThan(seq.indexOf("merging"));
  });

  it("a split (pull) run never emits the merging phase even on a conflict", async () => {
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "original") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "original") });
    const engine = makeEngine(gh, local, { mergeLayer: useMergedMerger });
    await engine.sync(gh.spec());

    gh.commitDirect("main", { [FILE]: mdAsset("u1", "remote edit") }, "device B");
    local.files.set(FILE, mdAsset("u1", "local edit"));

    const phases: SyncProgressEvent[] = [];
    await engine.sync(gh.spec(), "pull", (e) => phases.push(e));

    // Split runs defer conflicts (#3473) — the merge layer does not fire.
    expect(phases.map((p) => p.phase)).not.toContain("merging");
  });

  it("a throwing observer never affects the sync outcome (observation-only)", async () => {
    const gh = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "original") });
    const local = new FakeLocalFiles({ [FILE]: mdAsset("u1", "original") });
    const engine = makeEngine(gh, local);
    await engine.sync(gh.spec());

    gh.commitDirect("main", { [FILE]: mdAsset("u1", "remote edit") }, "device B");

    const result = await engine.sync(gh.spec(), "sync", () => {
      throw new Error("observer boom");
    });

    // The faulty observer is swallowed — the sync still converges.
    expect(result.status).toBe("synced");
    expect(local.files.get(FILE)).toBe(mdAsset("u1", "remote edit"));
  });

  it("syncAll threads the observer to every repo by repoKey", async () => {
    const A = new FakeGitHubRepo({ [FILE]: mdAsset("u1", "a") });
    const localA = new FakeLocalFiles({ [FILE]: mdAsset("u1", "a") });
    const specA = A.spec();
    const engine = new SyncEngine({
      transport: A.transport(),
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => localA,
      sha1: sha1Hex,
    });
    await engine.syncAll([specA]);

    A.commitDirect("main", { [FILE]: mdAsset("u1", "edited") }, "device B");

    const phases: SyncProgressEvent[] = [];
    await engine.syncAll([specA], "sync", (e) => phases.push(e));

    expect(phases.every((p) => p.repoKey === specA.repoKey)).toBe(true);
    expect(phases.map((p) => p.phase)).toContain("detecting");
  });

  it("emits throttled fetching-blobs ticks during a large pull", async () => {
    // The blob-fetch loop is the dominant restBlob cost (one sequential REST
    // fetch per changed file). On a big pull it ran silent after a single
    // "pulling remote tree…" line, so the sync looked hung. A pull of ≥25
    // files (the announce threshold) MUST surface `fetching-blobs done/total`
    // ticks — announced (0/N) then every 10 blobs.
    const N = 30;
    const initial: Record<string, string> = {};
    const edited: Record<string, string> = {};
    for (let i = 0; i < N; i += 1) {
      initial[`assets/f${i}.md`] = mdAsset(`u${i}`, "original");
      edited[`assets/f${i}.md`] = mdAsset(`u${i}`, "remote edit");
    }
    const gh = new FakeGitHubRepo({ ...initial });
    const local = new FakeLocalFiles({ ...initial });
    const engine = makeEngine(gh, local);
    await engine.sync(gh.spec()); // bootstrap watermark

    gh.commitDirect("main", edited, "device B");

    const phases: SyncProgressEvent[] = [];
    const result = await engine.sync(gh.spec(), "sync", (e) => phases.push(e));

    expect(result.status).toBe("synced");
    const ticks = phases.filter((p) => p.phase === "fetching-blobs");
    // Announced (done=0) + a tick at 10 and 20 (every BLOB_PROGRESS_STEP=10).
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0].detail).toEqual({ done: 0, total: N });
    const dones = ticks.map((t) => t.detail!.done);
    // Every tick carries the true total, stays below N (no redundant 100%
    // tick), and advances monotonically.
    for (const t of ticks) expect(t.detail!.total).toBe(N);
    expect(dones.every((d) => d < N)).toBe(true);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    // The shared core formatter renders a human count line.
    expect(syncProgressPhaseText(ticks[1])).toBe(
      `fetching remote files ${dones[1]}/${N}…`,
    );
  });

  it("stays silent on a small pull (below the announce threshold)", async () => {
    // A handful of files finishes before a heartbeat would help — no
    // fetching-blobs noise for a 3-file pull.
    const initial: Record<string, string> = {
      "assets/a.md": mdAsset("ua", "original"),
      "assets/b.md": mdAsset("ub", "original"),
      "assets/c.md": mdAsset("uc", "original"),
    };
    const gh = new FakeGitHubRepo({ ...initial });
    const local = new FakeLocalFiles({ ...initial });
    const engine = makeEngine(gh, local);
    await engine.sync(gh.spec());

    gh.commitDirect(
      "main",
      {
        "assets/a.md": mdAsset("ua", "edit"),
        "assets/b.md": mdAsset("ub", "edit"),
        "assets/c.md": mdAsset("uc", "edit"),
      },
      "device B",
    );

    const phases: SyncProgressEvent[] = [];
    await engine.sync(gh.spec(), "sync", (e) => phases.push(e));

    expect(phases.map((p) => p.phase)).not.toContain("fetching-blobs");
  });

  it("emits reading-local ticks while snapshotting many local files", async () => {
    // A cold snapshot reads+hashes every local file (localRead — ~9s for a big
    // repo). With no tick it is silent BEFORE "detecting…" even fires. A
    // first-sync of >500 files (the read throttle step) must surface a running
    // `reading local files N…` count.
    const files: Record<string, string> = {};
    for (let i = 0; i < 501; i += 1) {
      files[`assets/f${i}.md`] = mdAsset(`u${i}`, "x");
    }
    const gh = new FakeGitHubRepo({ ...files });
    const local = new FakeLocalFiles({ ...files });
    const engine = makeEngine(gh, local);

    // First sync = bootstrap: no watermark ⇒ read every local file.
    const phases: SyncProgressEvent[] = [];
    await engine.sync(gh.spec(), "sync", (e) => phases.push(e));

    const reads = phases.filter((p) => p.phase === "reading-local");
    expect(reads.length).toBeGreaterThanOrEqual(1);
    // Running count — first tick at the 500th read, no `total`.
    expect(reads[0].detail).toEqual({ done: 500 });
    expect(reads[0].detail!.total).toBeUndefined();
    expect(syncProgressPhaseText(reads[0])).toBe("reading local files 500…");
  });

  it("emits writing-files ticks while applying many pulled files", async () => {
    // A pull writes each remote change to disk (localWrite — ~11s for a big
    // pull). A pull of >25 files (the write throttle step) must surface a
    // running `writing files N…` count.
    const N = 30;
    const base: Record<string, string> = {};
    const edited: Record<string, string> = {};
    for (let i = 0; i < N; i += 1) {
      base[`assets/f${i}.md`] = mdAsset(`u${i}`, "orig");
      edited[`assets/f${i}.md`] = mdAsset(`u${i}`, "remote edit");
    }
    const gh = new FakeGitHubRepo({ ...base });
    const local = new FakeLocalFiles({ ...base });
    const engine = makeEngine(gh, local);
    await engine.sync(gh.spec()); // bootstrap watermark

    gh.commitDirect("main", edited, "device B");

    const phases: SyncProgressEvent[] = [];
    const result = await engine.sync(gh.spec(), "sync", (e) => phases.push(e));

    expect(result.status).toBe("synced");
    expect(result.pulledCount).toBe(N);
    const writes = phases.filter((p) => p.phase === "writing-files");
    expect(writes.length).toBeGreaterThanOrEqual(1);
    // Running count — first tick at the 25th write, no `total`.
    expect(writes[0].detail).toEqual({ done: 25 });
    expect(writes[0].detail!.total).toBeUndefined();
    expect(syncProgressPhaseText(writes[0])).toBe("writing files 25…");
  });
});
