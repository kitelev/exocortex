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
