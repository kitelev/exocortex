/**
 * ExoSync E1 parity harness tests (RFC 4e4dc453 Phase E — M1/M2).
 *
 * Production-shape composition (test-fixture-realism): watermarks are
 * produced by the REAL SyncEngine over the production-shape FakeGitHubRepo
 * (real blob SHAs, transport error contract) — the validator then observes
 * exactly the state a real device would carry.
 */

import * as yaml from "js-yaml";
import {
  ParityValidator,
  SyncEngine,
  summarizeParityRound,
  type ParityRoundRecord,
  type ParityValidatorDeps,
  type RepoSyncResult,
  type SyncRepoSpec,
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

const FILE_A = "assets/a.md";
const FILE_B = "assets/b.md";

interface Harness {
  gh: FakeGitHubRepo;
  local: FakeLocalFiles;
  watermarks: FakeWatermarkStore;
  engine: SyncEngine;
  validator: ParityValidator;
  spec: SyncRepoSpec;
}

function makeHarness(
  initial: Record<string, string>,
  spaceKind?: "asset" | "file",
  depsOverride: Partial<ParityValidatorDeps> = {},
): Harness {
  const gh = new FakeGitHubRepo(initial);
  const local = new FakeLocalFiles(initial);
  const watermarks = new FakeWatermarkStore();
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
  });
  const validator = new ParityValidator({
    transport: gh.transport(),
    sha1: sha1Hex,
    localFilesFor: () => local,
    watermarks,
    yaml: codec,
    now: () => "2026-06-11T00:00:00.000Z",
    ...depsOverride,
  });
  return { gh, local, watermarks, engine, validator, spec: gh.spec(spaceKind) };
}

async function bootstrap(h: Harness): Promise<void> {
  const result = await h.engine.sync(h.spec);
  expect(result.status).toBe("synced");
}

describe("ParityValidator — clean state and pending classifications", () => {
  it("reports full parity after a successful sync (M1=0, M2=∅)", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    await bootstrap(h);

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.checkedRepos).toBe(1);
    expect(round.m1Total).toBe(0);
    expect(round.m2Total).toBe(0);
    expect(round.ok).toBe(true);
    expect(round.vacuous).toBe(false);
    expect(round.repos[0].inParity).toBe(2);
    expect(round.repos[0].filesChecked).toBe(2);
    expect(summarizeParityRound(round)).toBe(
      "ExoSync parity: M1=0, M2=∅ (1 repo(s) checked)",
    );
  });

  it("classifies a local edit not yet pushed as pending-local-edit (M2 diff)", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "local edit"));

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.m2Total).toBe(1);
    expect(round.m1Total).toBe(0);
    expect(round.ok).toBe(false);
    expect(round.repos[0].discrepancies).toMatchObject([
      { path: FILE_A, presence: "both", cls: "pending-local-edit" },
    ]);
  });

  it("classifies remote-side changes: edit / add / delete", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    await bootstrap(h);
    h.gh.commitDirect(
      "main",
      { [FILE_A]: mdAsset("u1", "remote edit"), "assets/new.md": mdAsset("u3") },
      "device B",
      [FILE_B],
    );

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    const byPath = new Map(
      round.repos[0].discrepancies.map((d) => [d.path, d.cls]),
    );
    expect(byPath.get(FILE_A)).toBe("pending-remote-edit");
    expect(byPath.get("assets/new.md")).toBe("pending-remote-add");
    expect(byPath.get(FILE_B)).toBe("pending-remote-delete");
    expect(round.m2Total).toBe(3);
  });

  it("accounts a deferred local delete (A1 gap) — M2 stays clean", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    await bootstrap(h);
    h.local.files.delete(FILE_B);

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].discrepancies).toMatchObject([
      { path: FILE_B, presence: "remote-only", cls: "deferred-local-delete" },
    ]);
    expect(round.m2Total).toBe(0);
    expect(round.repos[0].accountedCount).toBe(1);
    expect(round.ok).toBe(true);
  });

  it("accounts watermark-pinned paths as quarantine-pinned", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    const record = h.watermarks.records.get(h.spec.repoKey)!;
    h.watermarks.records.set(h.spec.repoKey, {
      ...record,
      pinnedPaths: [FILE_A],
    });
    h.local.files.set(FILE_A, mdAsset("u1", "conflicted local"));
    h.gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "conflicted remote") }, "B");

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].discrepancies).toMatchObject([
      { path: FILE_A, cls: "quarantine-pinned" },
    ]);
    expect(round.m2Total).toBe(0);
    expect(round.ok).toBe(true);
  });
});

describe("ParityValidator — semantic layer (M2 triple-set proxy)", () => {
  it("recognises format-only drift (key order + array order) as M2-clean", async () => {
    const original = `---\nexo__Asset_uid: u1\naliases:\n  - one\n  - two\nexo__Asset_label: "L"\n---\n\nbody\n`;
    const reordered = `---\nexo__Asset_label: "L"\nexo__Asset_uid: u1\naliases:\n  - two\n  - one\n---\n\nbody\n`;
    const h = makeHarness({ [FILE_A]: original });
    await bootstrap(h);
    h.local.files.set(FILE_A, reordered);
    h.gh.commitDirect("main", { [FILE_A]: original + " " }, "B"); // byte drift remote too

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].discrepancies).toMatchObject([
      { path: FILE_A, cls: "format-only-drift" },
    ]);
    expect(round.m2Total).toBe(0);
    expect(round.ok).toBe(true);
  });

  it("flags real semantic divergence with frontmatter/body flags", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "local body"));
    h.gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote body") }, "B");

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].discrepancies).toMatchObject([
      {
        path: FILE_A,
        cls: "pending-conflict",
        frontmatterEqual: true,
        bodyEqual: false,
      },
    ]);
    expect(round.m2Total).toBe(1);
  });

  it("respects the semantic-fetch cap — unverified divergence counts into M2", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") }, undefined, {
      maxSemanticFetchesPerRepo: 0,
    });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "local body"));
    h.gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "remote body") }, "B");

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].discrepancies).toMatchObject([
      { path: FILE_A, cls: "unverified-divergence" },
    ]);
    expect(round.m2Total).toBe(1);
    expect(round.repos[0].warnings.join(" ")).toMatch(/semantic-fetch cap/);
  });
});

describe("ParityValidator — repo statuses", () => {
  it("no watermark → informational status, not counted, vacuous round", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    // no bootstrap — device never synced

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].status).toBe("no-watermark");
    expect(round.checkedRepos).toBe(0);
    expect(round.vacuous).toBe(true);
    expect(round.ok).toBe(false);
    expect(summarizeParityRound(round)).toMatch(/VACUOUS/);
  });

  it("moved head mid-check → inconclusive, counts discarded", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    // First GET (after arming) anchors the check; a concurrent push lands
    // before the closing GET → the round must refuse to certify this repo.
    // The fake's counter is cumulative across the bootstrap sync, so the
    // hook counts its own invocations instead.
    let refCalls = 0;
    h.gh.onGetRef = (): void => {
      refCalls++;
      if (refCalls === 2) {
        h.gh.onGetRef = undefined;
        h.gh.commitDirect("main", { [FILE_A]: mdAsset("u1", "mid-check") }, "B");
      }
    };

    const round = await h.validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].status).toBe("inconclusive");
    expect(round.repos[0].detail).toMatch(/head moved during the check/);
    expect(round.checkedRepos).toBe(0);
  });

  it("race-window sync result → inconclusive without any API calls", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    const syncResults: RepoSyncResult[] = [
      {
        repoKey: h.spec.repoKey,
        status: "synced",
        pulledCount: 0,
        pushedCount: 1,
        mergedCount: 0,
        quarantinedCount: 0,
        warnings: ["race-window: watermark NOT advanced (…)"],
        deferredDeletes: [],
      },
    ];

    const round = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      syncResults,
    });

    expect(round.repos[0].status).toBe("inconclusive");
    expect(round.repos[0].detail).toMatch(/race window/);
  });

  it("HTTP 401 → auth-required (R8), never treated as success", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    const validator = new ParityValidator({
      transport: async () => {
        throw new Error("GitHub request GET url → HTTP 401: Bad credentials");
      },
      sha1: sha1Hex,
      localFilesFor: () => h.local,
      watermarks: h.watermarks,
      yaml: codec,
    });

    const round = await validator.runRound([h.spec], { trigger: "standalone" });

    expect(round.repos[0].status).toBe("auth-required");
    expect(round.repos[0].detail).toMatch(/update it \(R8\)/);
    expect(round.vacuous).toBe(true);
  });

  it("HTTP 404 → error with the fine-grained-PAT hint, other repos continue", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    const deadSpec: SyncRepoSpec = {
      owner: "test-owner",
      repo: "dead-repo",
      branch: "gone",
      repoKey: "test-owner/dead-repo#gone",
      localPath: "assetspaces/dead",
    };

    const round = await h.validator.runRound([deadSpec, h.spec], {
      trigger: "standalone",
    });

    expect(round.repos[0].status).toBe("error");
    expect(round.repos[0].warnings.join(" ")).toMatch(/fine-grained PAT/);
    expect(round.repos[1].status).toBe("checked");
    expect(round.checkedRepos).toBe(1);
    expect(round.ok).toBe(true); // dead pointer skipped, live repo clean
  });
});

describe("ParityValidator — M1 detector 1: edit conservation", () => {
  it("captureSnapshot collects base-divergent paths only", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "dirty"));

    const snapshot = await h.validator.captureSnapshot([h.spec]);

    const dirty = snapshot.dirtyByRepo.get(h.spec.repoKey)!;
    expect([...dirty.keys()]).toEqual([FILE_A]);
  });

  it("FAILS on a wrongful overwrite (pre-sync edit vanished) and PASSES when the merge accounts for it", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);

    // Pre-sync state: user edited FILE_A locally.
    h.local.files.set(FILE_A, mdAsset("u1", "precious local edit"));
    const snapshot = await h.validator.captureSnapshot([h.spec]);

    // Simulated WRONGFUL overwrite (the bug class the detector exists for —
    // e.g. a concurrent sync channel clobbering the file mid-round): the
    // local edit is replaced by the remote version; the head tree never saw
    // the edit; nothing was merged, quarantined or pinned.
    h.local.files.set(FILE_A, mdAsset("u1"));
    const syncedResult: RepoSyncResult = {
      repoKey: h.spec.repoKey,
      status: "synced",
      pulledCount: 1,
      pushedCount: 0,
      mergedCount: 0,
      quarantinedCount: 0,
      warnings: [],
      deferredDeletes: [],
    };

    // Revert→fail: detector MUST flag the vanished edit.
    const failing = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      snapshot,
      syncResults: [syncedResult],
    });
    expect(failing.m1Total).toBe(1);
    expect(failing.repos[0].m1Violations).toMatchObject([
      { path: FILE_A, kind: "conservation" },
    ]);
    expect(failing.ok).toBe(false);

    // Restore→pass: the SAME state is accounted when the engine reports the
    // path as legitimately merged.
    const passing = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      snapshot,
      syncResults: [{ ...syncedResult, mergedCount: 1, mergedPaths: [FILE_A] }],
    });
    expect(passing.m1Total).toBe(0);
  });

  it("an identical blob at ANOTHER path does not mask a wrongful overwrite (per-path)", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1"), [FILE_B]: mdAsset("u2") });
    await bootstrap(h);

    // Pre-sync dirty: FILE_A edited to content X.
    const contentX = mdAsset("u1", "precious X");
    h.local.files.set(FILE_A, contentX);
    const snapshot = await h.validator.captureSnapshot([h.spec]);

    // Wrongful overwrite of FILE_A — while the head happens to contain the
    // SAME bytes at a DIFFERENT path (duplicate content is realistic).
    // A whole-tree blob-set membership would find X via FILE_B and hide
    // the loss (code-reviewer MEDIUM, PR #3474 — regression pin).
    h.gh.commitDirect("main", { [FILE_B]: contentX }, "device B");
    h.local.files.set(FILE_A, mdAsset("u1"));
    h.local.files.set(FILE_B, contentX);

    const round = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      snapshot,
      syncResults: [
        {
          repoKey: h.spec.repoKey,
          status: "synced",
          pulledCount: 1,
          pushedCount: 0,
          mergedCount: 0,
          quarantinedCount: 0,
          warnings: [],
          deferredDeletes: [],
        },
      ],
    });

    expect(round.repos[0].m1Violations).toMatchObject([
      { path: FILE_A, kind: "conservation" },
    ]);
  });

  it("file-mode snapshot walks byte-exact — non-UTF8 content is not phantom-dirty", async () => {
    const binary = new Uint8Array([0x89, 0x50, 0xc3, 0x28, 0x00, 0xff]); // invalid UTF-8
    const h = makeHarness({}, "file");
    h.gh.commitDirect("main", { "img/raw.bin": binary }, "init");
    h.local.files.set("img/raw.bin", binary);
    h.watermarks.records.set(h.spec.repoKey, {
      lastSyncedSha: h.gh.headSha(),
      rootTreeSha: h.gh.commits.get(h.gh.headSha())!.treeSha,
      files: [
        {
          path: "img/raw.bin",
          blobSha: [
            ...h.gh.trees.get(h.gh.commits.get(h.gh.headSha())!.treeSha)!.values(),
          ][0],
        },
      ],
      spaceKind: "file",
    });

    // A text walk would lossy-decode the bytes → different SHA → phantom
    // dirty (code-reviewer MEDIUM, PR #3474 — regression pin).
    const snapshot = await h.validator.captureSnapshot([h.spec]);
    expect(snapshot.dirtyByRepo.size).toBe(0);
    expect(snapshot.warnings).toEqual([]);
  });

  it("conserves an edit that was pushed into the head as-is", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "to be pushed"));
    const snapshot = await h.validator.captureSnapshot([h.spec]);

    const syncResults = [await h.engine.sync(h.spec)]; // real push
    const round = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      snapshot,
      syncResults,
    });

    expect(round.m1Total).toBe(0);
    expect(round.m2Total).toBe(0);
    expect(round.ok).toBe(true);
  });
});

describe("ParityValidator — M1 detector 2: persistent divergence", () => {
  it("escalates an identical divergence that survived a sync round", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "stuck edit"));

    const prev = await h.validator.runRound([h.spec], { trigger: "post-sync" });
    expect(prev.m2Total).toBe(1);
    expect(prev.m1Total).toBe(0); // fresh pending — not a violation

    // A sync "ran" but converged nothing (same shas both sides) — round 2:
    const next = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      previousRound: prev,
    });

    expect(next.m1Total).toBe(1);
    expect(next.repos[0].m1Violations).toMatchObject([
      { path: FILE_A, kind: "persistent-divergence" },
    ]);
  });

  it("does NOT escalate a repo whose sync cycle did not converge (failed status)", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "stuck edit"));
    const prev = await h.validator.runRound([h.spec], { trigger: "post-sync" });

    // The sync ran but FAILED for this repo (e.g. secret-scan refusal) —
    // its pendings legitimately survive; escalation here would pollute the
    // M1 evidence window every round (code-reviewer HIGH, PR #3474).
    const failed: RepoSyncResult = {
      repoKey: h.spec.repoKey,
      status: "error",
      pulledCount: 0,
      pushedCount: 0,
      mergedCount: 0,
      quarantinedCount: 0,
      warnings: [],
      deferredDeletes: [],
      detail: "refusing to push: secret detected",
    };
    const next = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      previousRound: prev,
      syncResults: [failed],
    });
    expect(next.m1Total).toBe(0);

    // Same round shape with a CONVERGED status still escalates.
    const converged = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      previousRound: prev,
      syncResults: [{ ...failed, status: "synced", detail: undefined }],
    });
    expect(converged.m1Total).toBe(1);
  });

  it("does NOT escalate a deferred rename across synced rounds (A1 gap is not data loss)", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    // Routine note rename: same content, new path. The engine defers BOTH
    // halves by design (no delete push, no re-add push) even in a cycle
    // that reports "synced" — neither half may ever reach M1 (advisor
    // round-2 NEW-1: pending-local-add escalation flagged every rename).
    const content = h.local.files.get(FILE_A) as string;
    h.local.files.delete(FILE_A);
    h.local.files.set("assets/renamed.md", content);

    const round1 = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      syncResults: [await h.engine.sync(h.spec)],
    });
    const round2 = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      previousRound: round1,
      syncResults: [await h.engine.sync(h.spec)],
    });

    const classes = round2.repos[0].discrepancies.map((d) => d.cls).sort();
    expect(classes).toEqual(["deferred-local-delete", "pending-local-add"]);
    expect(round1.m1Total).toBe(0);
    expect(round2.m1Total).toBe(0);
  });

  it("does NOT escalate when the divergence changed or on standalone rounds", async () => {
    const h = makeHarness({ [FILE_A]: mdAsset("u1") });
    await bootstrap(h);
    h.local.files.set(FILE_A, mdAsset("u1", "edit v1"));
    const prev = await h.validator.runRound([h.spec], { trigger: "post-sync" });

    // Standalone round (no sync between) — never escalates.
    const standalone = await h.validator.runRound([h.spec], {
      trigger: "standalone",
      previousRound: prev,
    });
    expect(standalone.m1Total).toBe(0);

    // The edit progressed (different localSha) — fresh pending, no escalation.
    h.local.files.set(FILE_A, mdAsset("u1", "edit v2"));
    const progressed = await h.validator.runRound([h.spec], {
      trigger: "post-sync",
      previousRound: prev,
    });
    expect(progressed.m1Total).toBe(0);
  });
});

describe("ParityValidator — file-mode repos (attachment sub-check)", () => {
  it("hash-set identical on clean state; binary divergence is a pending conflict", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const h = makeHarness({}, "file");
    h.gh.commitDirect("main", { "img/logo.png": png }, "init files");
    h.local.files.set("img/logo.png", png);
    const fileSync = await h.engine.sync({ ...h.spec });
    expect(fileSync.status).toBe("error"); // file mode needs quarantine sink — seed watermark manually instead
    h.watermarks.records.set(h.spec.repoKey, {
      lastSyncedSha: h.gh.headSha(),
      rootTreeSha: h.gh.commits.get(h.gh.headSha())!.treeSha,
      files: [
        {
          path: "img/logo.png",
          blobSha: [...h.gh.trees.get(h.gh.commits.get(h.gh.headSha())!.treeSha)!.values()][0],
        },
      ],
      spaceKind: "file",
    });

    const clean = await h.validator.runRound([h.spec], { trigger: "standalone" });
    expect(clean.repos[0].status).toBe("checked");
    expect(clean.repos[0].attachmentHashSetIdentical).toBe(true);
    expect(clean.ok).toBe(true);

    // Local-only divergence off the base → pending edit (path-keyed).
    h.local.files.set("img/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xff]));
    const localEdit = await h.validator.runRound([h.spec], { trigger: "standalone" });
    expect(localEdit.repos[0].attachmentHashSetIdentical).toBe(false);
    expect(localEdit.repos[0].discrepancies).toMatchObject([
      { path: "img/logo.png", cls: "pending-local-edit" },
    ]);

    // BOTH sides move off the base → opaque binary conflict, no semantic
    // layer to consult.
    h.gh.commitDirect(
      "main",
      { "img/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xaa, 0xaa]) },
      "device B",
    );
    const diverged = await h.validator.runRound([h.spec], { trigger: "standalone" });
    expect(diverged.repos[0].attachmentHashSetIdentical).toBe(false);
    expect(diverged.repos[0].discrepancies).toMatchObject([
      { path: "img/logo.png", cls: "pending-conflict" },
    ]);
    expect(diverged.repos[0].discrepancies[0].detail).toMatch(/binary/);
  });
});
