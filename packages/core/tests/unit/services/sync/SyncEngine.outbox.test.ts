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

// ── Batch head-staleness: N>1 keep-local stragglers converge in ONE sync ─────
// The exact production sequel to #3729: after the cross-path consolidation fix
// shipped (v16.149.3), Andrey's `exoas-tbank` keep-local of SEVEN cross-path
// stragglers in one sync healed only ONE — the flush pushed each queued
// resolution in its OWN restCreateCommit against a head SHA captured ONCE before
// the loop, so the FIRST push moved heads/main and the 2nd..Nth pushes failed
// the expectedHeadSha CAS ("head heads/main moved since the commit"), were
// deferred and RE-quarantined in the SAME sync ("pushed 1 resolved conflict(s)"
// → group RE-DETECTED). The fix commits every pushable resolution + the union
// of stale deletions in ONE atomic tree commit (one head move), so all queued
// keep-local resolutions land in one sync.
const M_SHARED = "shared/anchor.md";
const M_SHARED_BODY = mdAsset("anchor", "anchor, unchanged");
// Three distinct same-uid cross-path stragglers (flat local ↔ co-located remote),
// each with its OWN uid/body so blob SHAs are distinct (no cross-contamination of
// the content-addressed stale-sibling match).
const STRAGGLERS = [
  {
    uid: "s1",
    flat: "tbank-efforts/s1.md",
    colocated: "og/s1.md",
    local: mdAsset("s1", "LOCAL edit s1, flat isDefinedBy"),
    remote: mdAsset("s1", "REMOTE edit s1, co-located isDefinedBy"),
  },
  {
    uid: "s2",
    flat: "tbank-efforts/s2.md",
    colocated: "toos/s2.md",
    local: mdAsset("s2", "LOCAL edit s2, flat isDefinedBy"),
    remote: mdAsset("s2", "REMOTE edit s2, co-located isDefinedBy"),
  },
  {
    uid: "s3",
    flat: "tbank-pns/2026-06-17 Note.md",
    colocated: "tbank-pn/2026-06-17 Note.md",
    local: mdAsset("s3", "LOCAL edit s3, flat isDefinedBy"),
    remote: mdAsset("s3", "REMOTE edit s3, co-located isDefinedBy"),
  },
] as const;

function setupMultiXPath() {
  const gh = new FakeGitHubRepo({ [M_SHARED]: M_SHARED_BODY });
  const cache = new LocalConflictCacheStore({ io: memIO() });
  const outbox = new LocalOutboxStore({ io: memIO() });
  const watermarks = new FakeWatermarkStore();
  const disk = new FakeLocalFiles({ [M_SHARED]: M_SHARED_BODY });
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

/**
 * Bootstrap converged, then introduce N same-uid cross-path divergences (the
 * remote co-location migration), quarantine them, and keep-local each — leaving
 * N queued resolutions in the outbox awaiting a single flush.
 */
async function quarantineAndResolveAll(
  s: ReturnType<typeof setupMultiXPath>,
): Promise<void> {
  await s.engine.sync(s.spec); // bootstrap (disk == remote == {M_SHARED})
  // Local keeps each asset at its FLAT path; the remote migration put each SAME
  // uid at its CO-LOCATED path with divergent frontmatter (no common base).
  for (const g of STRAGGLERS) s.disk.files.set(g.flat, g.local);
  s.gh.commitDirect(
    "main",
    {
      [M_SHARED]: M_SHARED_BODY,
      ...Object.fromEntries(STRAGGLERS.map((g) => [g.colocated, g.remote])),
    },
    "remote bulk co-location migration",
  );
  const r = await s.engine.sync(s.spec);
  expect(r.quarantinedCount).toBeGreaterThanOrEqual(STRAGGLERS.length);

  // Keep-local each conflict → one outbox entry per straggler.
  const open = await s.resolver.listOpenConflicts([s.spec]);
  expect(open.length).toBe(STRAGGLERS.length);
  for (const c of open) {
    await s.resolver.resolve(s.spec, c.path, { take: "local" });
  }
  expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(
    STRAGGLERS.length,
  );
}

describe("ExoSync batch head-staleness — multiple keep-local stragglers converge in ONE sync", () => {
  it("@req:e1c6bf01-0580-474b-b66b-9c81180978c6 keep-local of N>1 cross-path stragglers ALL converge in ONE sync — atomic batch commit moves the head once (was 1-per-sync 'head moved' defer + re-quarantine)", async () => {
    const s = setupMultiXPath();
    await quarantineAndResolveAll(s);

    // ── ONE flush sync resolves EVERY queued straggler ──────────────────────
    const flush = await s.engine.sync(s.spec);
    // ⛤ REVERT-VERIFY BINDING: pre-fix the per-push flush moves the head on the
    // first push, so the 2nd..Nth fail the CAS and are deferred — outboxPushedCount
    // would be 1 (received), not STRAGGLERS.length (3). The atomic batch makes it 3.
    expect(flush.outboxPushedCount).toBe(STRAGGLERS.length);
    expect(flush.outboxReconflictedCount ?? 0).toBe(0);

    // Outbox fully drained — NOTHING deferred within the batch.
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);

    // Every asset converged to its single (flat) path; every stale co-located
    // sibling is gone (deleted, recoverable in git history); the anchor is
    // untouched.
    const head = s.gh.headFiles();
    for (const g of STRAGGLERS) {
      expect(head.get(g.flat)).toBe(g.local); // converged to the flat path
      expect(head.has(g.colocated)).toBe(false); // stale sibling consolidated away
    }
    expect(head.get(M_SHARED)).toBe(M_SHARED_BODY);

    // No conflict re-surfaces for ANY straggler on a subsequent sync — keep-local
    // stuck for all of them in ONE sync.
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
    const after = await s.engine.sync(s.spec);
    expect(after.quarantinedCount).toBe(0);
    expect(after.status).toBe("synced");
  });

  it("⛤ zero-loss: a genuine concurrent EXTERNAL writer moving the head aborts the WHOLE batch (expectedHeadSha CAS) — every entry stays queued, nothing overwritten", async () => {
    const s = setupMultiXPath();
    await quarantineAndResolveAll(s);

    // The flush's guard-read (getHeadSha) sees the unchanged head and proceeds;
    // inject a concurrent EXTERNAL push in the window before the batch commit's
    // OWN ref-read (arm-call #1 = flush getHeadSha, #2 = restCreateCommit GET-ref)
    // by moving an UNRELATED remote path — the CAS must abort the entire batch.
    let getRefCalls = 0;
    s.gh.onGetRef = (): void => {
      getRefCalls++;
      if (getRefCalls === 2) {
        s.gh.onGetRef = undefined;
        s.gh.commitDirect(
          "main",
          { [M_SHARED]: mdAsset("anchor", "external writer moved the anchor") },
          "external writer in the race window",
        );
      }
    };

    const flush = await s.engine.sync(s.spec);
    s.gh.onGetRef = undefined;

    // ⛤ The whole batch aborts — NOTHING pushed, every straggler stays queued.
    expect(flush.outboxPushedCount ?? 0).toBe(0);
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(
      STRAGGLERS.length,
    );
    // The external change is preserved (never overwritten); the stale siblings
    // are all still present (no partial consolidation).
    const head = s.gh.headFiles();
    expect(head.get(M_SHARED)).toBe(mdAsset("anchor", "external writer moved the anchor"));
    for (const g of STRAGGLERS) {
      expect(head.get(g.colocated)).toBe(g.remote); // untouched
    }
  });
});

// ── Cross-path keep-REMOTE / merged convergence (#3731) ──────────────────────
// The symmetric counterpart of #3729 (keep-local). For the SAME cross-path
// same-uid divergence (flat-local ↔ co-located-remote, no common base):
//
//  • keep-REMOTE needs NO remote mutation (the remote is already canonical at
//    the co-located path). The resolver writes the chosen REMOTE content to the
//    (flat) conflict path AND snaps that path's watermark base to the remote
//    blob + unpins it. That snap turns the NEXT sync into a clean remote-RENAME
//    (base@flat == remote@co-located blob, local unchanged) → the engine deletes
//    the stale flat-local copy and pulls the co-located version: disk converges
//    to the CO-LOCATED path, the stale flat-local copy is gone, zero re-conflict.
//    Zero-loss: the discarded flat-local is backed up to `.conflict.local.txt`.
//    (This already worked pre-#3731 via the snap-to-remote mechanism — #3731 was
//    a speculative follow-up to #3729; these tests LOCK the convergence so a
//    future refactor of the snap/unpin cannot silently regress it.)
//
//  • MERGED differs from BOTH sides, so it routes through the SAME deferred
//    outbox + #3729/#3732 consolidation path as keep-local: push the merged
//    content → the flat path AND delete the stale co-located remote sibling in
//    one commit → converges to the FLAT path, zero re-conflict.
const MERGED_BODY = mdAsset("u1", "MERGED edit combining flat + co-located");

describe("ExoSync cross-path keep-REMOTE / merged convergence (#3731)", () => {
  it("@req:5c7e8d2a-c2f6-445d-8a6a-2fb9e434b037 keep-REMOTE of a co-located rename converges to the co-located path with NO remote mutation: accepts the remote content, the next sync removes the stale flat-local copy + pulls the co-located version, re-derives NO conflict (zero-loss backup) — symmetric counterpart of #3729 keep-local", async () => {
    const s = setupXPath();
    const conflictPath = await crossPathConflict(s); // the flat conflict path
    expect(conflictPath).toBe(FLAT);

    const res = await s.resolver.resolve(s.spec, conflictPath, { take: "remote" });
    // keep-remote needs NO push/outbox — the remote is already canonical at the
    // co-located path. The discarded flat-local is backed up (zero-loss, ⛤ M1).
    expect(res.awaitingPush ?? false).toBe(false);
    expect(res.pushedSha).toBeUndefined();
    expect(res.discardedLocalBackupPath).toBeDefined();
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);
    // The remote is untouched by the resolve itself (no commit).
    expect(s.gh.headFiles().has(FLAT)).toBe(false);
    expect(s.gh.headFiles().get(COLOCATED)).toBe(COLOCATED_REMOTE);
    // The flat path's base was snapped to the remote blob and the path unpinned.
    expect(
      s.watermarks.records.get(s.spec.repoKey)?.pinnedPaths ?? [],
    ).not.toContain(conflictPath);

    // ⛤ REVERT-VERIFY BINDING: the next sync sees base@flat == remote@co-located
    // blob (local unchanged) → a clean remote-RENAME flat→co-located. The engine
    // DELETES the stale flat-local copy and pulls the co-located version. If the
    // resolve had NOT snapped the flat base to the remote content (the broken
    // mechanism), the flat copy persists and the cross-path conflict re-surfaces
    // here as a re-quarantine — so this assertion is the gap detector.
    const after = await s.engine.sync(s.spec);
    expect(after.quarantinedCount).toBe(0);
    expect(after.status).toBe("synced");
    expect(s.disk.files.has(FLAT)).toBe(false); // stale flat-local copy removed
    expect(s.disk.files.get(COLOCATED)).toBe(COLOCATED_REMOTE); // converged to co-located
    // The remote was NEVER mutated (keep-remote = purely local convergence).
    const head = s.gh.headFiles();
    expect(head.has(FLAT)).toBe(false);
    expect(head.get(COLOCATED)).toBe(COLOCATED_REMOTE);
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);

    // A subsequent sync re-derives NO conflict — keep-remote stuck.
    const after2 = await s.engine.sync(s.spec);
    expect(after2.quarantinedCount).toBe(0);
    expect(after2.status).toBe("synced");
  });

  it("@req:5c7e8d2a-c2f6-445d-8a6a-2fb9e434b037 keep-REMOTE of N>1 cross-path stragglers ALL converge (each to its co-located path, stale flat-local copies removed) with NO cross-contamination and NO re-conflict", async () => {
    const s = setupMultiXPath();
    await s.engine.sync(s.spec); // bootstrap (disk == remote == {M_SHARED})
    for (const g of STRAGGLERS) s.disk.files.set(g.flat, g.local);
    s.gh.commitDirect(
      "main",
      {
        [M_SHARED]: M_SHARED_BODY,
        ...Object.fromEntries(STRAGGLERS.map((g) => [g.colocated, g.remote])),
      },
      "remote bulk co-location migration",
    );
    const r = await s.engine.sync(s.spec);
    expect(r.quarantinedCount).toBeGreaterThanOrEqual(STRAGGLERS.length);

    const open = await s.resolver.listOpenConflicts([s.spec]);
    expect(open.length).toBe(STRAGGLERS.length);
    for (const c of open) {
      await s.resolver.resolve(s.spec, c.path, { take: "remote" });
    }
    // keep-remote queues NOTHING (no remote mutation) — all convergence is local.
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);

    const after = await s.engine.sync(s.spec);
    expect(after.quarantinedCount).toBe(0);
    expect(after.status).toBe("synced");
    const head = s.gh.headFiles();
    for (const g of STRAGGLERS) {
      expect(s.disk.files.has(g.flat)).toBe(false); // stale flat-local removed
      expect(s.disk.files.get(g.colocated)).toBe(g.remote); // converged to co-located
      expect(head.get(g.colocated)).toBe(g.remote); // remote never mutated
    }
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
    const after2 = await s.engine.sync(s.spec);
    expect(after2.quarantinedCount).toBe(0);
  });

  it("@req:5c7e8d2a-c2f6-445d-8a6a-2fb9e434b037 MERGED of a co-located rename converges to the flat path via the consolidating push (push merged → flat + delete the stale co-located remote sibling in one commit), re-derives NO conflict", async () => {
    const s = setupXPath();
    const conflictPath = await crossPathConflict(s);
    expect(conflictPath).toBe(FLAT);

    // merged differs from both sides → deferred outbox push (same path as
    // keep-local), TOCTOU-keyed by the cached co-located remote blob.
    const res = await s.resolver.resolve(s.spec, conflictPath, {
      take: "merged",
      content: MERGED_BODY,
    });
    expect(res.awaitingPush).toBe(true);
    expect(res.discardedLocalBackupPath).toBeDefined();
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(1);

    // The flush consolidates: push merged → flat path AND delete the stale
    // co-located remote sibling in ONE commit (the #3729/#3732 path).
    const flush = await s.engine.sync(s.spec);
    expect(flush.outboxPushedCount).toBe(1);
    expect(flush.outboxReconflictedCount ?? 0).toBe(0);
    const head = s.gh.headFiles();
    expect(head.get(conflictPath)).toBe(MERGED_BODY); // converged to the flat path
    expect(head.has(COLOCATED)).toBe(false); // stale co-located sibling consolidated away
    expect(head.get(SHARED)).toBe(SHARED_BODY);
    expect(await s.outbox.listForRepo(s.spec.repoKey)).toHaveLength(0);
    expect(await s.resolver.listOpenConflicts([s.spec])).toHaveLength(0);
    const after = await s.engine.sync(s.spec);
    expect(after.quarantinedCount).toBe(0);
    expect(after.status).toBe("synced");
  });
});
