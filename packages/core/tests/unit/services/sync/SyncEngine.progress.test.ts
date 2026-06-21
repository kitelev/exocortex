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
});
