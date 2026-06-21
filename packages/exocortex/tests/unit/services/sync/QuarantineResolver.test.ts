/**
 * QuarantineResolver — device-local-first quarantine reconcile (finding
 * a0a3d1d6). Production-shape fixtures (test-fixture-realism): the FakeGitHubRepo
 * speaks the real Git Data API transport contract and computes real git blob
 * SHAs; the watermark/local-files fakes mirror the real port contracts.
 *
 * The headline guarantees under test:
 *  - listing surfaces only GENUINE 3-way conflicts (one-sided pins filtered);
 *  - resolution converges BOTH sides in one action (disk + remote commit);
 *  - ZERO-DATA-LOSS — the discarded local version is preserved (disk backup in
 *    device-local mode), the discarded remote stays in git history;
 *  - after a resolution a REAL SyncEngine cycle is a clean no-op (no
 *    re-conflict) — the strongest proof the watermark snap is correct.
 */

import { describe, expect, it } from "@jest/globals";
import {
  GatedStructuredMerger,
  QuarantineResolver,
  StructuredMerger,
  SyncEngine,
  backupPathFor,
  gitBlobSha,
  isFileSpaceSyncablePath,
  isSyncablePath,
  type SyncRepoSpec,
  type WatermarkRecord,
  type YamlCodec,
} from "../../../../src";
import yaml from "js-yaml";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  FakeMountBaseStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

const PATH = "alpha.md";
const yamlCodec: YamlCodec = {
  parse: (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA }),
  stringify: (value) =>
    yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: -1 }),
};

/**
 * A genuine 3-way conflict on `alpha.md`: base committed in history, remote
 * (head) and local (disk) each diverged differently, and the path is pinned in
 * the device-local watermark — exactly the state the engine leaves after
 * quarantining an asset-mode conflict.
 */
async function makeConflict(opts?: {
  base?: string;
  local?: string;
  remote?: string;
  extraPinned?: string[];
}): Promise<{
  repo: FakeGitHubRepo;
  spec: SyncRepoSpec;
  disk: FakeLocalFiles;
  watermarks: FakeWatermarkStore;
  resolver: QuarantineResolver;
  base: string;
  local: string;
  remote: string;
}> {
  const base = opts?.base ?? mdAsset("uid-1", "base body");
  const local = opts?.local ?? mdAsset("uid-1", "LOCAL edit");
  const remote = opts?.remote ?? mdAsset("uid-1", "REMOTE edit");

  // Initial commit = base; the base blob stays reachable in history.
  const repo = new FakeGitHubRepo({ [PATH]: base });
  const baseSha = repo.headSha();
  const baseTreeSha = repo.commits.get(baseSha)!.treeSha;
  // Remote diverges (device B pushed).
  repo.commitDirect("main", { [PATH]: remote }, "remote edit");

  const spec = repo.spec();
  const disk = new FakeLocalFiles({ [PATH]: local });
  const watermarks = new FakeWatermarkStore();
  const record: WatermarkRecord = {
    lastSyncedSha: baseSha,
    rootTreeSha: baseTreeSha,
    files: [{ path: PATH, blobSha: await gitBlobSha(base, sha1Hex), uid: "uid-1" }],
    pinnedPaths: [PATH, ...(opts?.extraPinned ?? [])],
  };
  await watermarks.set(spec.repoKey, record);

  const resolver = new QuarantineResolver({
    transport: repo.transport(),
    watermarkStore: watermarks,
    localFilesFor: () => disk,
    sha1: sha1Hex,
  });
  return { repo, spec, disk, watermarks, resolver, base, local, remote };
}

describe("QuarantineResolver.listOpenConflicts", () => {
  it("surfaces a genuine 3-way conflict from device-local pins (no quarantine repo)", async () => {
    const { spec, resolver, local } = await makeConflict();
    const conflicts = await resolver.listOpenConflicts([spec]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      repoKey: spec.repoKey,
      path: PATH,
      uid: "uid-1",
      hasLocal: true,
      hasRemote: true,
    });
    // Sanity: it really read the disk version's uid.
    expect(local).toContain("uid-1");
  });

  it("filters out a one-sided pin (local == base) that converges on its own", async () => {
    const base = mdAsset("uid-1", "shared");
    // local equals base ⇒ only remote changed ⇒ a pull resolves it, NOT a conflict.
    const { spec, resolver } = await makeConflict({
      base,
      local: base,
      remote: mdAsset("uid-1", "REMOTE only"),
    });
    expect(await resolver.listOpenConflicts([spec])).toHaveLength(0);
  });

  it("filters out a converged pin (local == remote)", async () => {
    const same = mdAsset("uid-1", "both arrived here");
    const { spec, resolver } = await makeConflict({
      base: mdAsset("uid-1", "old base"),
      local: same,
      remote: same,
    });
    expect(await resolver.listOpenConflicts([spec])).toHaveLength(0);
  });

  it("ignores a benign extra pinned path with no real divergence", async () => {
    // `beta.md` is pinned but identical on every side (absent everywhere) — must
    // not appear as a conflict.
    const { spec, resolver } = await makeConflict({ extraPinned: ["beta.md"] });
    const conflicts = await resolver.listOpenConflicts([spec]);
    expect(conflicts.map((c) => c.path)).toEqual([PATH]);
  });

  it("skips a file-mode FileSpace spec entirely (asset-mode resolver only)", async () => {
    // Same conflict, but the spec is a `file`-mode FileSpace — binary
    // remote-wins, not user-resolvable via a UTF-8 3-way (code-reviewer round-2).
    const { spec, resolver } = await makeConflict();
    const fileSpec: SyncRepoSpec = { ...spec, spaceKind: "file" };
    expect(await resolver.listOpenConflicts([fileSpec])).toEqual([]);
  });
});

describe("QuarantineResolver.loadConflict", () => {
  it("materialises all three versions for the diff view", async () => {
    const { spec, resolver, base, local, remote } = await makeConflict();
    const detail = await resolver.loadConflict(spec, PATH);
    expect(detail.base).toBe(base);
    expect(detail.local).toBe(local);
    expect(detail.remote).toBe(remote);
    expect(detail.uid).toBe("uid-1");
  });
});

describe("QuarantineResolver.resolve — keep-local", () => {
  it("commits local to remote, snaps the watermark, and unpins (no backup)", async () => {
    const { repo, spec, disk, watermarks, resolver, local } =
      await makeConflict();

    const result = await resolver.resolve(spec, PATH, { take: "local" });

    // Disk keeps the local choice; remote head now equals it (the step that
    // bypasses "a conflicting local is never pushed").
    expect(disk.files.get(PATH)).toBe(local);
    expect(repo.headFiles().get(PATH)).toBe(local);
    expect(result.pushedSha).toBeDefined();
    // keep-local discards nothing local → no backup file.
    expect(result.discardedLocalBackupPath).toBeUndefined();
    expect([...disk.files.keys()]).not.toContain(backupPathFor(PATH));

    // Pin cleared; watermark base snapped to the chosen blob.
    const wm = await watermarks.get(spec.repoKey);
    expect(wm?.pinnedPaths ?? []).not.toContain(PATH);
    expect(wm?.files.find((f) => f.path === PATH)?.blobSha).toBe(
      await gitBlobSha(local, sha1Hex),
    );
  });
});

describe("QuarantineResolver.resolve — keep-remote (zero-loss)", () => {
  it("@req:e85487a7-695e-4dea-b076-dc5f42ce2d50 writes remote to disk, preserves the discarded local in a .txt backup, and unpins", async () => {
    const { repo, spec, disk, watermarks, resolver, local, remote } =
      await makeConflict();
    const remoteHeadBefore = repo.headSha();

    const result = await resolver.resolve(spec, PATH, { take: "remote" });

    // Disk now holds remote; remote head was already remote → no new commit.
    expect(disk.files.get(PATH)).toBe(remote);
    expect(repo.headSha()).toBe(remoteHeadBefore);
    expect(result.pushedSha).toBeUndefined();
    expect(result.resolvedTo).toBe("remote");

    // ZERO-LOSS: the discarded local lives on in the backup, byte-for-byte.
    const backup = backupPathFor(PATH);
    expect(result.discardedLocalBackupPath).toBe(backup);
    expect(disk.files.get(backup)).toBe(local);
    // The backup is a .txt — excluded from the triple store AND from BOTH sync
    // predicates (asset-mode `.md` check + file-mode `.conflict.` infix), so it
    // never leaks to a remote even in a FileSpace (code-reviewer round-2).
    expect(backup.endsWith(".txt")).toBe(true);
    expect(isSyncablePath(backup)).toBe(false);
    expect(isFileSpaceSyncablePath(backup)).toBe(false);

    const wm = await watermarks.get(spec.repoKey);
    expect(wm?.pinnedPaths ?? []).not.toContain(PATH);
  });
});

describe("QuarantineResolver.resolve — merged", () => {
  it("commits the merged content to disk + remote and backs up the discarded local", async () => {
    const { repo, spec, disk, resolver, local } = await makeConflict();
    const merged = mdAsset("uid-1", "MERGED by hand");

    const result = await resolver.resolve(spec, PATH, {
      take: "merged",
      content: merged,
    });

    expect(disk.files.get(PATH)).toBe(merged);
    expect(repo.headFiles().get(PATH)).toBe(merged);
    expect(result.pushedSha).toBeDefined();
    // local discarded → backed up.
    expect(disk.files.get(backupPathFor(PATH))).toBe(local);
  });
});

describe("QuarantineResolver.resolve — quarantine repo configured", () => {
  it("calls markResolved AND still backs up the discarded local (repo copy may be stale, HIGH-1)", async () => {
    const { repo, spec, disk, watermarks, local } = await makeConflict();
    const marked: Array<{ repoKey: string; path: string }> = [];
    const resolver = new QuarantineResolver({
      transport: repo.transport(),
      watermarkStore: watermarks,
      localFilesFor: () => disk,
      sha1: sha1Hex,
      quarantine: {
        quarantine: async () => undefined,
        markResolved: async (repoKey, path) => {
          marked.push({ repoKey, path });
        },
      },
    });

    const result = await resolver.resolve(spec, PATH, { take: "remote" });

    expect(marked).toEqual([{ repoKey: spec.repoKey, path: PATH }]);
    // Zero-loss: the EXACT disk bytes are preserved regardless of the repo copy
    // (which was captured at quarantine time and may be stale after a re-edit).
    expect(result.discardedLocalBackupPath).toBe(backupPathFor(PATH));
    expect(disk.files.get(backupPathFor(PATH))).toBe(local);
  });
});

/**
 * The strongest guarantee: after a resolution, a REAL SyncEngine cycle is a
 * clean no-op — the watermark snap means the path is NOT re-detected as a
 * conflict. Without a correct snap this would re-quarantine forever (the 14-file
 * exoas-tbank symptom).
 */
describe("QuarantineResolver — convergence with the real SyncEngine", () => {
  it("a post-resolution sync re-derives NO conflict (keep-local)", async () => {
    const { repo, spec, disk, watermarks, resolver, local } =
      await makeConflict();

    await resolver.resolve(spec, PATH, { take: "local" });

    const engine = new SyncEngine({
      transport: repo.transport(),
      watermarkStore: watermarks,
      mountBaseStore: new FakeMountBaseStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
      mergeLayer: new GatedStructuredMerger(new StructuredMerger(yamlCodec)),
    });

    const [r] = await engine.syncAll([spec], "sync");
    expect(r.status).toBe("synced");
    expect(r.quarantinedCount).toBe(0);
    expect(r.mergedCount).toBe(0);
    // Both sides already hold the chosen local content — nothing changes.
    expect(disk.files.get(PATH)).toBe(local);
    expect(repo.headFiles().get(PATH)).toBe(local);
    // The pin is gone and stays gone.
    const wm = await watermarks.get(spec.repoKey);
    expect(wm?.pinnedPaths ?? []).not.toContain(PATH);
  });
});

describe("QuarantineResolver.detectDuplicateUids", () => {
  /** Minimal resolver — detectDuplicateUids touches only localFilesFor (disk). */
  function makeResolver(disk: FakeLocalFiles): {
    resolver: QuarantineResolver;
    spec: SyncRepoSpec;
  } {
    const repo = new FakeGitHubRepo({ "seed.md": mdAsset("seed") });
    const resolver = new QuarantineResolver({
      transport: repo.transport(),
      watermarkStore: new FakeWatermarkStore(),
      localFilesFor: () => disk,
      sha1: sha1Hex,
    });
    return { resolver, spec: repo.spec() };
  }

  it("counts distinct uids appearing on >1 markdown file (the #3477 root)", async () => {
    // uid-dup on 3 paths (co-location copies), uid-dup2 on 2, uid-uniq once.
    const disk = new FakeLocalFiles({
      "tbank-efforts/a.md": mdAsset("uid-dup", "x"),
      "private/b.md": mdAsset("uid-dup", "y"),
      "og/c.md": mdAsset("uid-dup", "z"),
      "toos/d.md": mdAsset("uid-dup2", "p"),
      "pn/e.md": mdAsset("uid-dup2", "q"),
      "pns/f.md": mdAsset("uid-uniq", "r"),
    });
    const { resolver, spec } = makeResolver(disk);
    // 2 distinct uids are duplicated (uid-dup, uid-dup2); uid-uniq is not.
    expect(await resolver.detectDuplicateUids([spec])).toBe(2);
  });

  it("returns 0 when every uid is unique (no false dissonance signal)", async () => {
    const disk = new FakeLocalFiles({
      "a.md": mdAsset("uid-1"),
      "b.md": mdAsset("uid-2"),
      "c.md": mdAsset("uid-3"),
    });
    const { resolver, spec } = makeResolver(disk);
    expect(await resolver.detectDuplicateUids([spec])).toBe(0);
  });

  it("ignores non-.md files and uid-less notes (matches `exosync dedup-uids` scope)", async () => {
    const disk = new FakeLocalFiles({
      "a.md": mdAsset("uid-1"),
      // a backup written by the resolver itself — never an asset, never counted.
      "a.md.conflict.local.txt": mdAsset("uid-1", "discarded local"),
      "no-uid.md": "---\nexo__Asset_label: x\n---\nbody\n",
    });
    const { resolver, spec } = makeResolver(disk);
    expect(await resolver.detectDuplicateUids([spec])).toBe(0);
  });
});
