/**
 * ExoSync deferred-push outbox — engine auto-flush + TOCTOU (PR-3b), end-to-end
 * with the REAL {@link SyncEngine} + REAL {@link QuarantineResolver} + REAL
 * device-local cache & outbox over the production-shape {@link FakeGitHubRepo}
 * (real git blob SHAs, force:false 422). This is the zero-loss-critical path:
 * resolve offline → push deferred → next sync flushes, but ONLY when the remote
 * has not moved since (else the conflict re-surfaces — never an overwrite).
 */

import { describe, expect, it } from "@jest/globals";
import {
  LocalConflictCacheStore,
  LocalOutboxStore,
  QuarantineResolver,
  SyncEngine,
  type MergeLayerPort,
  type WatermarkFileIO,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

function memIO(): WatermarkFileIO {
  let content: string | null = null;
  return {
    async read(): Promise<string | null> {
      return content;
    },
    async writeAtomic(c: string): Promise<void> {
      content = c;
    },
  };
}

const FILE = "assets/a.md";
const BASE = mdAsset("u1", "base body");
const LOCAL = mdAsset("u1", "LOCAL edit");
const REMOTE = mdAsset("u1", "REMOTE edit");

/** Always-quarantine merge layer → a deterministic asset-mode conflict. */
const forceQuarantine: MergeLayerPort = {
  resolve: async () => ({ action: "quarantine", reason: "unmergeable (test)" }),
};

function setup() {
  const gh = new FakeGitHubRepo({ [FILE]: BASE });
  const cache = new LocalConflictCacheStore({ io: memIO() });
  const outbox = new LocalOutboxStore({ io: memIO() });
  const watermarks = new FakeWatermarkStore();
  const disk = new FakeLocalFiles({ [FILE]: BASE });
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => disk,
    sha1: sha1Hex,
    quarantine: cache, // engine caches the 3 versions here on quarantine
    outbox, // engine flushes deferred pushes from here
    mergeLayer: forceQuarantine,
  });
  const resolver = new QuarantineResolver({
    transport: gh.transport(),
    watermarkStore: watermarks,
    localFilesFor: () => disk,
    sha1: sha1Hex,
    conflictCache: cache,
    outbox,
  });
  return {
    gh,
    cache,
    outbox,
    watermarks,
    disk,
    engine,
    resolver,
    spec: gh.spec(),
  };
}

/** Bootstrap, then create a genuine quarantined+pinned+cached conflict. */
async function quarantineConflict(s: ReturnType<typeof setup>): Promise<void> {
  await s.engine.sync(s.spec); // bootstrap watermark (disk == remote)
  s.gh.commitDirect("main", { [FILE]: REMOTE }, "device B");
  s.disk.files.set(FILE, LOCAL);
  const r = await s.engine.sync(s.spec);
  expect(r.quarantinedCount).toBe(1);
}

describe("ExoSync deferred-push outbox — resolve queues, sync flushes (PR-3b)", () => {
  it("resolve(take-local) DEFERS: queued in outbox, path kept pinned, NOT pushed, hidden from the list", async () => {
    const s = setup();
    await quarantineConflict(s);

    const result = await s.resolver.resolve(s.spec, FILE, { take: "local" });
    expect(result.awaitingPush).toBe(true);
    expect(result.pushedSha).toBeUndefined();

    // Queued, disk has the choice, remote untouched (no push yet).
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(1);
    expect(s.disk.files.get(FILE)).toBe(LOCAL);
    expect(s.gh.headFiles().get(FILE)).toBe(REMOTE); // remote NOT overwritten yet
    // Hidden from the resolver ("resolved, awaiting push").
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
    // Still pinned (the flush owns the unpin).
    expect(s.watermarks.records.get(s.spec.repoKey)?.pinnedPaths).toContain(
      FILE,
    );
  });

  it("HAPPY PATH (zero-loss): the next sync flushes the push, converges, and re-derives NO conflict", async () => {
    const s = setup();
    await quarantineConflict(s);
    await s.resolver.resolve(s.spec, FILE, { take: "local" });

    const flush = await s.engine.sync(s.spec);
    expect(flush.outboxPushedCount).toBe(1);
    expect(flush.outboxReconflictedCount ?? 0).toBe(0);
    // Remote now carries the resolved (local) content; outbox drained; unpinned.
    expect(s.gh.headFiles().get(FILE)).toBe(LOCAL);
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);

    // A subsequent sync sees base==local==remote — no re-conflict.
    const after = await s.engine.sync(s.spec);
    expect(after.quarantinedCount).toBe(0);
    expect(after.status).toBe("synced");
  });

  it("⛤ TOCTOU (zero-loss): remote moved since the offline resolution → push REFUSED, conflict re-surfaces, remote preserved", async () => {
    const s = setup();
    await quarantineConflict(s);
    await s.resolver.resolve(s.spec, FILE, { take: "local" });

    // Device C moves the SAME path after the offline resolution.
    const MOVED = mdAsset("u1", "REMOTE moved AGAIN");
    s.gh.commitDirect("main", { [FILE]: MOVED }, "device C");

    const flush = await s.engine.sync(s.spec);
    expect(flush.outboxReconflictedCount).toBe(1);
    expect(flush.outboxPushedCount ?? 0).toBe(0);
    // ⛤ The moved remote is NEVER overwritten by the stale resolution.
    expect(s.gh.headFiles().get(FILE)).toBe(MOVED);
    // The user's choice is still on disk; the outbox is drained.
    expect(s.disk.files.get(FILE)).toBe(LOCAL);
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);
    // The conflict re-surfaces for a fresh choice (now LOCAL vs MOVED).
    const open = await s.resolver.listOpenConflicts([s.spec]);
    expect(open.map((c) => c.path)).toEqual([FILE]);
    const detail = await s.resolver.loadConflict(s.spec, FILE);
    expect(detail.local).toBe(LOCAL);
    expect(detail.remote).toBe(MOVED);
  });

  it("⛤ TOCTOU in-window (zero-loss): remote moves AFTER the flush guard-read but BEFORE restCreateCommit's ref-read → CAS refuses, no overwrite, entry retried", async () => {
    const s = setup();
    await quarantineConflict(s);
    await s.resolver.resolve(s.spec, FILE, { take: "local" });

    // The flush's guard-read sees the unchanged remote (REMOTE) and proceeds.
    // Inject a concurrent push in the narrow window between that guard-read and
    // restCreateCommit's OWN ref-read: arm-call #1 = the flush's getHeadSha,
    // #2 = restCreateCommit's GET-ref — move the SAME path right then.
    const MOVED = mdAsset("u1", "moved in the race window");
    let callsSinceArm = 0;
    s.gh.onGetRef = (): void => {
      callsSinceArm++;
      if (callsSinceArm === 2) {
        s.gh.onGetRef = undefined;
        s.gh.commitDirect("main", { [FILE]: MOVED }, "device C in-window");
      }
    };

    const flush = await s.engine.sync(s.spec);
    s.gh.onGetRef = undefined;

    // ⛤ The in-window move is NOT overwritten — the CAS aborted the push.
    expect(s.gh.headFiles().get(FILE)).toBe(MOVED);
    expect(flush.outboxPushedCount ?? 0).toBe(0);
    // The entry is left queued (not dropped) — the next sync re-checks the
    // per-path TOCTOU and re-conflicts; the user's choice stays on disk.
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(1);
    expect(s.disk.files.get(FILE)).toBe(LOCAL);
  });

  it("resolve runs fully OFFLINE: a throwing transport still queues the deferred push (cache-sourced)", async () => {
    const s = setup();
    await quarantineConflict(s); // populates the cache via a working transport

    // A resolver with a transport that THROWS on any call — proves resolve needs
    // no network (it reads the remote from the cache and defers the push).
    const offlineResolver = new QuarantineResolver({
      transport: async () => {
        throw new Error("OFFLINE: no network");
      },
      watermarkStore: s.watermarks,
      localFilesFor: () => s.disk,
      sha1: sha1Hex,
      conflictCache: s.cache,
      outbox: s.outbox,
    });

    const result = await offlineResolver.resolve(s.spec, FILE, {
      take: "local",
    });
    expect(result.awaitingPush).toBe(true);
    const queued = await s.outbox.listForRepo(s.spec.repoKey);
    expect(queued).toHaveLength(1);
    // The TOCTOU key is the cached remote's blob-SHA (so the later online flush
    // pushes only if the remote is still that version).
    expect(queued[0].chosenContent).toBe(LOCAL);
  });

  it("take-remote needs no push: converges locally with NO outbox entry", async () => {
    const s = setup();
    await quarantineConflict(s);

    const result = await s.resolver.resolve(s.spec, FILE, { take: "remote" });
    expect(result.awaitingPush ?? false).toBe(false);
    expect(s.disk.files.get(FILE)).toBe(REMOTE); // disk now matches remote
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);
    // Unpinned + a `.conflict.local.txt` backup preserves the discarded local.
    expect(
      s.watermarks.records.get(s.spec.repoKey)?.pinnedPaths ?? [],
    ).not.toContain(FILE);
    expect(result.discardedLocalBackupPath).toBeDefined();
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
  });
});

// ── Cross-path conflict consolidation (#3729) ───────────────────────────────
// The exact production bug: a co-location reorg moved an asset on the REMOTE
// (flat `tbank-efforts/x.md` → co-located `og/x.md`) while the local vault kept
// the flat path, and the asset's frontmatter diverged on both sides (no common
// base). ExoSync correctly quarantines, but pre-fix "keep local" NEVER stuck:
// the flush read the conflict (flat) path — ABSENT on the remote — against the
// based-on remote blob and dropped the push forever as a phantom TOCTOU, while
// the co-located sibling re-introduced the conflict every sync. The fix: the
// flush detects that the based-on blob still lives at a SIBLING remote path and
// CONSOLIDATES (push chosen → conflict path + delete the stale sibling in one
// zero-loss commit) instead of dropping.
const SHARED = "shared/keep.md";
const SHARED_BODY = mdAsset("keep", "shared, unchanged on both sides");
const FLAT = "tbank-efforts/x.md"; // local (old flat) path
const COLOCATED = "og/x.md"; // remote (new co-located) path — SAME uid
const FLAT_LOCAL = mdAsset("u1", "LOCAL edit, flat isDefinedBy");
const COLOCATED_REMOTE = mdAsset("u1", "REMOTE edit, co-located isDefinedBy");

function setupXPath() {
  const gh = new FakeGitHubRepo({ [SHARED]: SHARED_BODY });
  const cache = new LocalConflictCacheStore({ io: memIO() });
  const outbox = new LocalOutboxStore({ io: memIO() });
  const watermarks = new FakeWatermarkStore();
  const disk = new FakeLocalFiles({ [SHARED]: SHARED_BODY });
  const engine = new SyncEngine({
    transport: gh.transport(),
    watermarkStore: watermarks,
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => disk,
    sha1: sha1Hex,
    quarantine: cache,
    outbox,
    mergeLayer: forceQuarantine,
  });
  const resolver = new QuarantineResolver({
    transport: gh.transport(),
    watermarkStore: watermarks,
    localFilesFor: () => disk,
    sha1: sha1Hex,
    conflictCache: cache,
    outbox,
  });
  return { gh, cache, outbox, watermarks, disk, engine, resolver, spec: gh.spec() };
}

/** Bootstrap converged, then introduce a cross-path same-uid divergence. */
async function crossPathConflict(
  s: ReturnType<typeof setupXPath>,
): Promise<string> {
  await s.engine.sync(s.spec); // bootstrap (disk == remote == {SHARED})
  // Local keeps the asset at the FLAT path; the remote co-location migration
  // put the SAME uid at the CO-LOCATED path with different frontmatter.
  s.disk.files.set(FLAT, FLAT_LOCAL);
  s.gh.commitDirect(
    "main",
    { [SHARED]: SHARED_BODY, [COLOCATED]: COLOCATED_REMOTE },
    "remote co-location migration",
  );
  const r = await s.engine.sync(s.spec);
  expect(r.quarantinedCount).toBeGreaterThanOrEqual(1);
  const open = await s.resolver.listOpenConflicts([s.spec]);
  expect(open.length).toBeGreaterThanOrEqual(1);
  return open[0].path; // the conflict (flat) path the user resolves
}

describe("ExoSync cross-path conflict consolidation (#3729)", () => {
  it("@req:5bcfe5d0-a64c-4c87-85a4-7fb8e3140c78 keep-local of a co-located rename consolidates: pushes local to the flat path AND deletes the stale co-located remote copy, converging (was a phantom TOCTOU drop)", async () => {
    const s = setupXPath();
    const conflictPath = await crossPathConflict(s);

    await s.resolver.resolve(s.spec, conflictPath, { take: "local" });
    // Deferred (outbox), still pinned, NOT yet pushed.
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(1);

    const flush = await s.engine.sync(s.spec);
    expect(flush.outboxPushedCount).toBe(1);
    expect(flush.outboxReconflictedCount ?? 0).toBe(0);

    // Remote converged to ONE path (the flat conflict path) with the local
    // content; the stale co-located sibling is GONE (deleted, recoverable in
    // git history); SHARED untouched.
    const head = s.gh.headFiles();
    expect(head.get(conflictPath)).toBe(FLAT_LOCAL);
    expect(head.has(COLOCATED)).toBe(false);
    expect(head.get(SHARED)).toBe(SHARED_BODY);

    // Outbox drained, conflict cleared, no re-conflict on a subsequent sync.
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
    const after = await s.engine.sync(s.spec);
    expect(after.quarantinedCount).toBe(0);
    expect(after.status).toBe("synced");
  });

  it("⛤ zero-loss: a genuine cross-path TOCTOU (the stale sibling itself moved) does NOT delete anything — drops and re-conflicts", async () => {
    const s = setupXPath();
    const conflictPath = await crossPathConflict(s);
    await s.resolver.resolve(s.spec, conflictPath, { take: "local" });

    // The co-located sibling is edited again on the remote AFTER the offline
    // resolution → the based-on blob is no longer anywhere in the tree → no
    // sibling match → never delete, drop instead.
    s.gh.commitDirect(
      "main",
      { [SHARED]: SHARED_BODY, [COLOCATED]: mdAsset("u1", "remote moved AGAIN") },
      "device C",
    );

    const flush = await s.engine.sync(s.spec);
    expect(flush.outboxPushedCount ?? 0).toBe(0);
    expect(flush.outboxReconflictedCount).toBe(1);
    // The remote sibling is preserved (never overwritten/deleted).
    expect(s.gh.headFiles().get(COLOCATED)).toBe(mdAsset("u1", "remote moved AGAIN"));
  });

  it("consolidates ALL stale siblings when the based-on blob is duplicated across ≥2 remote paths (one commit deletes every copy)", async () => {
    const s = setupXPath();
    const conflictPath = await crossPathConflict(s);
    await s.resolver.resolve(s.spec, conflictPath, { take: "local" });

    // Before the flush, a SECOND remote sibling appears holding the SAME
    // based-on blob (a uid duplicated to a third co-located path). The
    // match is CONTENT-ADDRESSED (blob-SHA), so BOTH siblings must be
    // consolidated away in the single resolution commit.
    const COLOCATED_2 = "archive/x.md";
    s.gh.commitDirect(
      "main",
      {
        [SHARED]: SHARED_BODY,
        [COLOCATED]: COLOCATED_REMOTE,
        [COLOCATED_2]: COLOCATED_REMOTE, // same content → same blob-SHA
      },
      "uid duplicated to a second co-located path",
    );

    const flush = await s.engine.sync(s.spec);
    expect(flush.outboxPushedCount).toBe(1);
    expect(flush.outboxReconflictedCount ?? 0).toBe(0);

    const head = s.gh.headFiles();
    expect(head.get(conflictPath)).toBe(FLAT_LOCAL); // converged to the flat path
    expect(head.has(COLOCATED)).toBe(false); // both stale copies gone
    expect(head.has(COLOCATED_2)).toBe(false);
    expect(head.get(SHARED)).toBe(SHARED_BODY); // unrelated file untouched
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
  });
});
