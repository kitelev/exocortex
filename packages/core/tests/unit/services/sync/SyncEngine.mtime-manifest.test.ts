/**
 * ExoSync Phase 1 (perf) — mtime-manifest local-hash skip.
 *
 * The dominant cost of an iPhone sync on a 14-AS / ~6304-file vault is the
 * UNCONDITIONAL local read + SHA-1 of EVERY file each sync (no mtime cache —
 * `exosync-perf-plan-2026-06-20.md` §2). This optimisation persists a per-file
 * `{mtimeMs, size, blobSha, uid}` manifest between syncs and SKIPS reading +
 * re-hashing files whose `(mtimeMs, size)` are unchanged, reusing the cached
 * blobSha — turning a no-op sync into a cheap stat sweep.
 *
 * ⛤ The zero-loss invariant is SACRED: the cache must NEVER cause a change to
 * be missed. These tests prove (a) the perf win (reads/hashes collapse to the
 * changed-file count), (b) OUTCOME parity (manifest on/off produce identical
 * detection — the cache changes only WHICH files are read, never the result),
 * (c) the TOCTOU guard for cache-hit pulled files, and (d) the safety net:
 * the rare mtime+size-preserving edit is missed by the cache (revert) but
 * caught by the periodic full re-hash (restore) — `integration-test-revert-verify`.
 *
 * Production-shape (`test-fixture-realism`): the SAME `FakeGitHubRepo` every
 * other SyncEngine test uses, a stat-tracking local port that mirrors a real
 * filesystem (writes bump mtime; stat reports the live byte size) and an
 * in-memory manifest store mirroring `FileLocalManifestStore`'s contract.
 */

import {
  SyncEngine,
  type LocalFilesPort,
  type LocalManifestRecord,
  type LocalManifestStorePort,
  type SyncEngineDeps,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

/**
 * Local port with real-filesystem semantics: a write bumps the file's mtime;
 * `stat` reports the live `(mtimeMs, size)`. The cache keys off exactly this.
 */
class StatLocalFiles implements LocalFilesPort {
  readonly files = new Map<string, string>();
  private readonly mtimes = new Map<string, number>();
  private clock = 1000;

  constructor(initial: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(initial)) {
      this.files.set(p, c);
      this.mtimes.set(p, ++this.clock);
    }
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async read(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT: ${path}`);
    return c;
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.mtimes.set(path, ++this.clock); // every write bumps mtime (real FS)
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.mtimes.delete(path);
  }
  async stat(
    path: string,
  ): Promise<{ mtimeMs: number; size: number } | null> {
    const c = this.files.get(path);
    if (c === undefined) return null;
    return { mtimeMs: this.mtimes.get(path)!, size: Buffer.byteLength(c) };
  }

  // ── test mutators ──────────────────────────────────────────────────────
  /** A normal user edit through Obsidian: content + mtime change. */
  userEdit(path: string, content: string): void {
    this.files.set(path, content);
    this.mtimes.set(path, ++this.clock);
  }
  /** A new local file appears. */
  addLocal(path: string, content: string): void {
    this.files.set(path, content);
    this.mtimes.set(path, ++this.clock);
  }
  /** A local file is removed (outside the sync). */
  removeLocal(path: string): void {
    this.files.delete(path);
    this.mtimes.delete(path);
  }
  /**
   * The pathological zero-loss edge: content changes but mtime AND size are
   * BOTH preserved (a tool that restores mtime, identical byte length). Real
   * editors never do this — but the safety net must catch it anyway.
   */
  edgeEditPreservingStat(path: string, content: string): void {
    const before = this.files.get(path);
    if (before === undefined) throw new Error(`ENOENT: ${path}`);
    if (Buffer.byteLength(before) !== Buffer.byteLength(content)) {
      throw new Error("test bug: edge edit must preserve byte size");
    }
    this.files.set(path, content); // mtime deliberately NOT bumped
  }
}

/** In-memory manifest store mirroring FileLocalManifestStore's contract. */
class MemManifestStore implements LocalManifestStorePort {
  readonly records = new Map<string, LocalManifestRecord>();
  setCount = 0;
  async get(repoKey: string): Promise<LocalManifestRecord | null> {
    return this.records.get(repoKey) ?? null;
  }
  async set(repoKey: string, record: LocalManifestRecord): Promise<void> {
    this.setCount++;
    this.records.set(repoKey, JSON.parse(JSON.stringify(record)));
  }
}

/** A manifest store that returns garbage — corruption tolerance (R10). */
class CorruptManifestStore implements LocalManifestStorePort {
  async get(): Promise<LocalManifestRecord | null> {
    // simulate a torn/garbage record the store-layer parse would reject → null
    return null;
  }
  async set(): Promise<void> {
    /* writes ignored */
  }
}

function makeEngine(
  gh: FakeGitHubRepo,
  local: LocalFilesPort,
  overrides: Partial<SyncEngineDeps> = {},
): SyncEngine {
  return new SyncEngine({
    transport: gh.transport(),
    watermarkStore: new FakeWatermarkStore(),
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    now: () => 1_000_000, // fixed clock; default 12h rehash → no auto-rehash
    ...overrides,
  });
}

const A = "assets/a.md";
const B = "assets/b.md";
const C = "assets/c.md";

/**
 * Drive the engine to a WARM cache: a clean-mount first sync seeds the
 * watermark, a second sync (manifest still empty ⇒ full re-hash) writes the
 * manifest. The THIRD+ sync is the steady state under test. Returns the result
 * of the last (steady-state, no-op) sync.
 */
async function warmUp(
  engine: SyncEngine,
  gh: FakeGitHubRepo,
): Promise<void> {
  await engine.syncAll([gh.spec()], "sync"); // sync 1 — seed watermark
  await engine.syncAll([gh.spec()], "sync"); // sync 2 — seed manifest (full rehash)
}

describe("SyncEngine — mtime-manifest local-hash skip (perf, zero-loss)", () => {
  it("warm no-op sync reads + hashes ZERO files (the perf win)", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2"), [C]: mdAsset("u3") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    await warmUp(engine, gh);
    const [r] = await engine.syncAll([gh.spec()], "sync"); // steady-state no-op

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(0);
    expect(r.pulledCount).toBe(0);
    // The headline before/after signal: a no-op steady-state sync touches no
    // file content at all — only stats.
    expect(r.timings!.counts.filesRead).toBe(0);
    expect(r.timings!.counts.filesHashed).toBe(0);
  });

  it("re-hashes ONLY the changed file; unchanged files stay cache hits", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2"), [C]: mdAsset("u3") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    await warmUp(engine, gh);
    local.userEdit(B, mdAsset("u2", "edited locally")); // mtime + size change

    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(1); // only B pushed
    // The headline cache win: ONLY B is read — A and C are reused from the
    // manifest (no read ⇒ no detection hash for them).
    expect(r.timings!.counts.filesRead).toBe(1);
    // B is hashed in detection AND once more by the pre-existing phantom-push
    // guard (#3475, head-tree dedup of the pushed blob) — bounded by the push
    // count, not the working-tree size. A/C contribute zero hashes.
    expect(r.timings!.counts.filesHashed).toBe(2);
    // The edit reached the remote.
    expect(gh.headFiles().get(B)).toBe(mdAsset("u2", "edited locally"));
  });

  it("same-size edit that bumps mtime IS detected (mtime alone catches it)", async () => {
    // Real editors bump mtime even when the byte length is unchanged.
    const files = { [A]: mdAsset("u1", "aaaa") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    await warmUp(engine, gh);
    // Same byte length ("bbbb" === "aaaa".length), mtime bumped by userEdit.
    local.userEdit(A, mdAsset("u1", "bbbb"));

    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(1);
    expect(gh.headFiles().get(A)).toBe(mdAsset("u1", "bbbb"));
  });

  it("detects a local add and a local delete with the cache warm", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    await warmUp(engine, gh);
    local.addLocal(C, mdAsset("u3")); // new file
    local.removeLocal(B); // deleted file

    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(1); // C added
    expect(r.pushedDeletes).toEqual([B]); // B deletion propagated
    const head = gh.headFiles();
    expect(head.has(C)).toBe(true);
    expect(head.has(B)).toBe(false);
  });

  it("pulls a remote change onto a cache-hit (unread) file — TOCTOU guard", async () => {
    // The regression guard: a pulled file that was NOT read this sync (cache
    // hit) must NOT read as 'vanished from snapshot' and wrongly TOCTOU-skip.
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    await warmUp(engine, gh);
    // Device B edits A on the remote; locally A is unchanged (cache hit).
    gh.commitDirect(gh.branch, { [A]: mdAsset("u1", "remote edit") }, "device B");

    const [r] = await engine.syncAll([gh.spec()], "sync");

    expect(r.status).toBe("synced");
    expect(r.pulledCount).toBe(1); // A pulled — NOT skipped
    expect(local.files.get(A)).toBe(mdAsset("u1", "remote edit"));
  });

  it("OUTCOME parity: manifest ON vs OFF produce identical detection", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2"), [C]: mdAsset("u3") };
    const scenario = (local: StatLocalFiles, gh: FakeGitHubRepo): void => {
      local.userEdit(A, mdAsset("u1", "local edit")); // local modify → push
      local.addLocal("assets/d.md", mdAsset("u4")); // local add → push
      gh.commitDirect(gh.branch, { [C]: mdAsset("u3", "remote") }, "device B"); // remote → pull
    };

    // OFF — no manifest store wired (status quo: reads + hashes everything).
    const ghOff = new FakeGitHubRepo(files);
    const localOff = new StatLocalFiles(files);
    const engOff = makeEngine(ghOff, localOff);
    await engOff.syncAll([ghOff.spec()], "sync"); // seed watermark
    scenario(localOff, ghOff);
    const [off] = await engOff.syncAll([ghOff.spec()], "sync");

    // ON — manifest store wired + warm cache.
    const ghOn = new FakeGitHubRepo(files);
    const localOn = new StatLocalFiles(files);
    const engOn = makeEngine(ghOn, localOn, {
      localManifestStore: new MemManifestStore(),
    });
    await warmUp(engOn, ghOn);
    scenario(localOn, ghOn);
    const [on] = await engOn.syncAll([ghOn.spec()], "sync");

    // Identical OUTCOME — the cache changes only WHICH files are read.
    expect(on.status).toBe(off.status);
    expect(on.pushedCount).toBe(off.pushedCount);
    expect(on.pulledCount).toBe(off.pulledCount);
    expect((on.pushedDeletes ?? []).sort()).toEqual(
      (off.pushedDeletes ?? []).sort(),
    );
    // Identical final disk + remote state.
    expect([...localOn.files.entries()].sort()).toEqual(
      [...localOff.files.entries()].sort(),
    );
    expect([...ghOn.headFiles().entries()].sort()).toEqual(
      [...ghOff.headFiles().entries()].sort(),
    );
  });

  // ── ZERO-LOSS safety net (integration-test-revert-verify discipline) ─────
  // REVERT: with the safety valve OFF (rehash interval = Infinity), the cache
  // misses the pathological mtime+size-preserving edit.
  // RESTORE: with the valve ON (interval = 0 → re-hash every sync), the edit
  // is caught. Proves the periodic full re-hash is what makes the edge safe.

  it("REVERT: a mtime+size-preserving edit is MISSED while full-rehash is disabled", async () => {
    const files = { [A]: mdAsset("u1", "aaaa") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const engine = makeEngine(gh, local, {
      localManifestStore: new MemManifestStore(),
      localManifestFullRehashMs: Number.POSITIVE_INFINITY, // never re-hash
    });

    await warmUp(engine, gh);
    // Same byte length, mtime NOT bumped — the pathological edge.
    local.edgeEditPreservingStat(A, mdAsset("u1", "bbbb"));

    const [r] = await engine.syncAll([gh.spec()], "sync");

    // Demonstrates the edge: the cache wrongly treats A as unchanged → the
    // edit is NOT pushed. (This is WHY the safety valve below exists.)
    expect(r.pushedCount).toBe(0);
    expect(gh.headFiles().get(A)).toBe(mdAsset("u1", "aaaa")); // stale on remote
  });

  it("RESTORE: the periodic full re-hash CATCHES the mtime+size-preserving edit", async () => {
    const files = { [A]: mdAsset("u1", "aaaa") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const engine = makeEngine(gh, local, {
      localManifestStore: new MemManifestStore(),
      localManifestFullRehashMs: 0, // re-hash every sync (safety valve forced)
    });

    await warmUp(engine, gh);
    local.edgeEditPreservingStat(A, mdAsset("u1", "bbbb"));

    const [r] = await engine.syncAll([gh.spec()], "sync");

    // The full re-hash reads + hashes A regardless of stat → the edit IS
    // detected and pushed. Zero-loss restored.
    expect(r.pushedCount).toBe(1);
    expect(gh.headFiles().get(A)).toBe(mdAsset("u1", "bbbb"));
  });

  it("falls back to read+hash-all when no manifest store is wired (opt-in)", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const engine = makeEngine(gh, local); // no localManifestStore

    await engine.syncAll([gh.spec()], "sync"); // seed watermark
    const [r] = await engine.syncAll([gh.spec()], "sync"); // would be a no-op

    expect(r.status).toBe("synced");
    // Status quo: every file read + hashed even on a no-op (no cache).
    expect(r.timings!.counts.filesRead).toBe(2);
    expect(r.timings!.counts.filesHashed).toBe(2);
  });

  it("tolerates a corrupt/empty manifest store (full re-hash, no crash)", async () => {
    const files = { [A]: mdAsset("u1") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const engine = makeEngine(gh, local, {
      localManifestStore: new CorruptManifestStore(),
    });

    await engine.syncAll([gh.spec()], "sync");
    local.userEdit(A, mdAsset("u1", "edit"));
    const [r] = await engine.syncAll([gh.spec()], "sync");

    // get() always null → full re-hash every sync → still correct.
    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(1);
    expect(gh.headFiles().get(A)).toBe(mdAsset("u1", "edit"));
  });

  it("a pure no-op steady-state sync does NOT re-write the manifest", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    await warmUp(engine, gh); // sync 2 wrote the manifest once
    const before = manifest.setCount;
    await engine.syncAll([gh.spec()], "sync"); // pure no-op
    await engine.syncAll([gh.spec()], "sync"); // pure no-op

    expect(manifest.setCount).toBe(before); // no churn on cache-hit no-ops
  });
});

/**
 * #3751 — ZERO-LOSS: an edit made BEFORE a `pull` must still be delivered by
 * the next `push`. The mtime-manifest is rebuilt + persisted EVERY cycle
 * (including `pull`), so a `pull` after a local edit records the edited
 * `(mtime,size,blobSha)` into the manifest WITHOUT pushing the edit and WITHOUT
 * advancing the watermark (the push base). The subsequent `push` then sees a
 * `(mtime,size)` cache HIT, reuses the cached blobSha WITHOUT reading the file,
 * detection correctly flags it modified-vs-base, but the push-set builder
 * (`pinLocalChanges`) reads content from the `disk` snapshot — which a cache-hit
 * file is absent from — so the change was SILENTLY DROPPED and `push` reported
 * "synced, pushed 0" with the edit undelivered (the workaround was `touch` to
 * bump mtime). The fix gates the cache-hit skip on `cached.blobSha === base`:
 * a file divergent from the watermark base is a cache MISS → read → pushable,
 * restoring the documented invariant "a stale entry causes a re-hash, NEVER a
 * wrong skip".
 *
 * Revert-verify (integration-test-revert-verify): removing the
 * `cached.blobSha === baseBlobByPath.get(path)` clause from the cache-hit gate
 * in `SyncEngine.ts` makes the first test below RED (push delivers nothing,
 * remote stays stale); restoring it → GREEN.
 */
describe("SyncEngine — #3751 edit-before-pull is delivered by push (zero-loss)", () => {
  it("@req:702e8bda-1e13-42b0-9858-3d5697f71b6a push delivers a local edit made BEFORE a pull (manifest cache-hit must not skip a file divergent from the watermark base)", async () => {
    const files = { [A]: mdAsset("u1") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });

    // Warm the cache to steady state (watermark + manifest seeded).
    await warmUp(engine, gh);

    // Edit A locally (content + mtime + size all change). The remote is NOT
    // touched — this is a purely local pending delta.
    const edited = mdAsset("u1", "edited locally before the pull");
    local.userEdit(A, edited);

    // `pull` first (remote unchanged → pulls nothing). The pull cycle rebuilds
    // the mtime-manifest from the post-edit disk snapshot, but does NOT push the
    // edit and does NOT advance the watermark.
    const [pull] = await engine.syncAll([gh.spec()], "pull");
    expect(pull.status).toBe("synced");
    expect(pull.pushedCount).toBe(0);
    expect(pull.pulledCount).toBe(0);

    // `push` next. The edit MUST be delivered (AC#1/#2): the manifest is a perf
    // cache only — correctness of delivery must not depend on it.
    const [push] = await engine.syncAll([gh.spec()], "push");
    expect(push.status).toBe("synced");
    expect(push.pushedCount).toBe(1);

    // Zero-loss: the edited blob reached the remote.
    expect(gh.headFiles().get(A)).toBe(edited);
  });

  it("@req:702e8bda-1e13-42b0-9858-3d5697f71b6a the same edit-before-pull holds under a combined Sync after the pull, and converges to a clean parity (no residual local delta)", async () => {
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });
    await warmUp(engine, gh);

    const edited = mdAsset("u1", "edited before pull, delivered by Sync");
    local.userEdit(A, edited);

    await engine.syncAll([gh.spec()], "pull"); // manifest advances, edit unpushed
    const [sync] = await engine.syncAll([gh.spec()], "sync"); // must deliver it

    expect(sync.status).toBe("synced");
    expect(sync.pushedCount).toBe(1);
    expect(gh.headFiles().get(A)).toBe(edited);

    // Convergence: a follow-up no-op sees no residual local delta (push and the
    // base now agree — AC#3) and skips the read again (perf restored once the
    // file is genuinely in sync).
    const [noop] = await engine.syncAll([gh.spec()], "sync");
    expect(noop.pushedCount).toBe(0);
    expect(noop.timings!.counts.filesRead).toBe(0);
  });

  it("the cache-hit fast path is preserved for genuinely in-sync files (no perf regression)", async () => {
    // The fix must not turn every steady-state sync into a full re-hash: a file
    // whose cached blob equals the base is still a cache hit on a no-op.
    const files = { [A]: mdAsset("u1"), [B]: mdAsset("u2"), [C]: mdAsset("u3") };
    const gh = new FakeGitHubRepo(files);
    const local = new StatLocalFiles(files);
    const manifest = new MemManifestStore();
    const engine = makeEngine(gh, local, { localManifestStore: manifest });
    await warmUp(engine, gh);

    const [r] = await engine.syncAll([gh.spec()], "sync");
    expect(r.status).toBe("synced");
    expect(r.pushedCount).toBe(0);
    expect(r.timings!.counts.filesRead).toBe(0); // pure no-op: nothing read
    expect(r.timings!.counts.filesHashed).toBe(0);
  });
});
