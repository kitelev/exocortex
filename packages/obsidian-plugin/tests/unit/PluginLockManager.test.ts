import type { App } from "obsidian";

import {
  PluginLockManager,
  type LockSnapshot,
} from "../../src/infrastructure/adapters/PluginLockManager";

// ─── Fake vault.adapter mirroring real Obsidian API ─────────────────────
// Per test-fixture-realism: read rejects/returns false for absent files;
// write+exists+remove keep an in-memory map of paths → contents.

interface FakeVaultStore {
  files: Map<string, string>;
  reads: string[];
  writes: Array<{ path: string; data: string }>;
  removes: string[];
}

function makeFakeApp(): { app: App; store: FakeVaultStore } {
  const files = new Map<string, string>();
  const reads: string[] = [];
  const writes: Array<{ path: string; data: string }> = [];
  const removes: string[] = [];

  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => files.has(path),
        read: async (path: string) => {
          reads.push(path);
          const v = files.get(path);
          if (v === undefined) throw new Error(`ENOENT: ${path}`);
          return v;
        },
        write: async (path: string, data: string) => {
          writes.push({ path, data });
          files.set(path, data);
        },
        remove: async (path: string) => {
          removes.push(path);
          files.delete(path);
        },
      },
    },
  } as unknown as App;

  return { app, store: { files, reads, writes, removes } };
}

interface Harness {
  app: App;
  store: FakeVaultStore;
  clock: { current: Date; advance: (ms: number) => void };
  mgr: PluginLockManager;
}

function makeHarness(
  opts: { pid?: string; lockPath?: string; staleMs?: number } = {},
): Harness {
  const { app, store } = makeFakeApp();
  const startTs = new Date("2026-06-01T00:00:00.000Z");
  let current = startTs;
  const clock = {
    get current(): Date {
      return current;
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
  const mgr = new PluginLockManager({
    app,
    pid: opts.pid ?? "pid-fixed-aaaa",
    lockPath: opts.lockPath,
    staleMs: opts.staleMs,
    now: () => current,
  });
  return { app, store, clock, mgr };
}

function readSnapshot(store: FakeVaultStore, path = ".exocortex/switch-lock.json"): LockSnapshot | null {
  const raw = store.files.get(path);
  if (raw === undefined) return null;
  return JSON.parse(raw) as LockSnapshot;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("PluginLockManager.acquireLock", () => {
  it("returns true and writes snapshot when lock file absent", async () => {
    const { mgr, store } = makeHarness();
    const ok = await mgr.acquireLock("switch-profile-xyz");
    expect(ok).toBe(true);
    const snap = readSnapshot(store);
    expect(snap).not.toBeNull();
    expect(snap!.operation).toBe("switch-profile-xyz");
    expect(snap!.pid).toBe("pid-fixed-aaaa");
    expect(snap!.acquiredAt).toBe("2026-06-01T00:00:00.000Z");
    expect(snap!.lastHeartbeat).toBe(snap!.acquiredAt);
  });

  it("returns false when lock is held and not stale", async () => {
    const { mgr } = makeHarness();
    const first = await mgr.acquireLock("op-1");
    expect(first).toBe(true);
    const second = await mgr.acquireLock("op-2");
    expect(second).toBe(false);
  });

  it("returns false on concurrent attempts from a different pid", async () => {
    const a = makeHarness({ pid: "pid-A" });
    const ok1 = await a.mgr.acquireLock("op-A");
    expect(ok1).toBe(true);

    // Second manager sharing the same vault adapter
    const mgrB = new PluginLockManager({
      app: a.app,
      pid: "pid-B",
      now: () => a.clock.current,
    });
    const ok2 = await mgrB.acquireLock("op-B");
    expect(ok2).toBe(false);
  });

  it("overtakes a stale lock (lastHeartbeat older than staleMs)", async () => {
    const { mgr, clock, store } = makeHarness({ staleMs: 60_000 });
    const ok1 = await mgr.acquireLock("op-1");
    expect(ok1).toBe(true);

    // Advance well past staleMs without heartbeat
    clock.advance(120_000);

    const ok2 = await mgr.acquireLock("op-2");
    expect(ok2).toBe(true);

    const snap = readSnapshot(store);
    expect(snap!.operation).toBe("op-2");
    expect(snap!.lastHeartbeat).toBe("2026-06-01T00:02:00.000Z");
  });
});

describe("PluginLockManager.heartbeat", () => {
  it("bumps lastHeartbeat for owned lock", async () => {
    const { mgr, clock, store } = makeHarness();
    await mgr.acquireLock("op");
    const initialHeartbeat = readSnapshot(store)!.lastHeartbeat;

    clock.advance(30_000);
    await mgr.heartbeat();

    const snap = readSnapshot(store);
    expect(snap!.lastHeartbeat).toBe("2026-06-01T00:00:30.000Z");
    expect(snap!.lastHeartbeat).not.toBe(initialHeartbeat);
    // acquiredAt unchanged
    expect(snap!.acquiredAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("is a no-op when lock file is missing", async () => {
    const { mgr, store } = makeHarness();
    await mgr.heartbeat();
    expect(store.writes).toHaveLength(0);
  });

  it("does not bump heartbeat for a foreign lock (different pid)", async () => {
    const a = makeHarness({ pid: "pid-A", staleMs: 60_000 });
    await a.mgr.acquireLock("op-A");
    const beforeHeartbeat = readSnapshot(a.store)!.lastHeartbeat;

    a.clock.advance(15_000);

    const mgrB = new PluginLockManager({
      app: a.app,
      pid: "pid-B",
      now: () => a.clock.current,
    });
    await mgrB.heartbeat();

    expect(readSnapshot(a.store)!.lastHeartbeat).toBe(beforeHeartbeat);
  });
});

describe("PluginLockManager.releaseLock", () => {
  it("removes the lock file when caller owns it", async () => {
    const { mgr, store } = makeHarness();
    await mgr.acquireLock("op");
    expect(store.files.has(".exocortex/switch-lock.json")).toBe(true);
    await mgr.releaseLock();
    expect(store.files.has(".exocortex/switch-lock.json")).toBe(false);
  });

  it("is idempotent when no lock exists", async () => {
    const { mgr, store } = makeHarness();
    await mgr.releaseLock();
    expect(store.removes).toHaveLength(0);
  });

  it("refuses to clear a foreign lock without force=true", async () => {
    const a = makeHarness({ pid: "pid-A" });
    await a.mgr.acquireLock("op-A");

    const mgrB = new PluginLockManager({
      app: a.app,
      pid: "pid-B",
      now: () => a.clock.current,
    });
    await mgrB.releaseLock();
    expect(readSnapshot(a.store)).not.toBeNull(); // still held
  });

  it("force=true clears regardless of pid", async () => {
    const a = makeHarness({ pid: "pid-A" });
    await a.mgr.acquireLock("op-A");

    const mgrB = new PluginLockManager({
      app: a.app,
      pid: "pid-B",
      now: () => a.clock.current,
    });
    await mgrB.releaseLock({ force: true });
    expect(readSnapshot(a.store)).toBeNull();
  });
});

describe("PluginLockManager.reclaimIfForeignOrStale (#1d1bcde0)", () => {
  it("returns false (no reclaim) when no lock file exists", async () => {
    const { mgr, store } = makeHarness();
    expect(await mgr.reclaimIfForeignOrStale()).toBe(false);
    expect(store.removes).toHaveLength(0);
  });

  it("does NOT reclaim our own still-fresh lock (a live same-session apply)", async () => {
    const { mgr, store } = makeHarness();
    await mgr.acquireLock("apply-rest-target");
    // Same pid, fresh heartbeat → live in-progress apply, must survive.
    expect(await mgr.reclaimIfForeignOrStale()).toBe(false);
    expect(store.files.has(".exocortex/switch-lock.json")).toBe(true);
  });

  it("reclaims a FOREIGN-pid still-fresh lock (crashed/other session)", async () => {
    const a = makeHarness({ pid: "pid-A" });
    await a.mgr.acquireLock("op-A");

    // A different session (the recovering one) reclaims the crashed pid-A lock
    // even though its heartbeat is fresh.
    const recovering = new PluginLockManager({
      app: a.app,
      pid: "pid-recover",
      now: () => a.clock.current,
    });
    expect(await recovering.reclaimIfForeignOrStale()).toBe(true);
    expect(readSnapshot(a.store)).toBeNull();
  });

  it("reclaims our OWN lock once it has gone stale", async () => {
    const { mgr, store, clock } = makeHarness({ staleMs: 1000 });
    await mgr.acquireLock("op");
    clock.advance(2000); // heartbeat now older than staleMs
    expect(await mgr.reclaimIfForeignOrStale()).toBe(true);
    expect(store.files.has(".exocortex/switch-lock.json")).toBe(false);
  });
});

describe("PluginLockManager.checkOnPluginLoad", () => {
  it("returns null holder when no lock file present", async () => {
    const { mgr } = makeHarness();
    const result = await mgr.checkOnPluginLoad();
    expect(result.stale).toBe(false);
    expect(result.holder).toBeNull();
  });

  it("returns stale=false for fresh lock", async () => {
    const { mgr } = makeHarness();
    await mgr.acquireLock("op");
    const result = await mgr.checkOnPluginLoad();
    expect(result.stale).toBe(false);
    expect(result.holder).not.toBeNull();
    expect(result.holder!.operation).toBe("op");
  });

  it("returns stale=true for lock past staleMs threshold", async () => {
    const { mgr, clock } = makeHarness({ staleMs: 60_000 });
    await mgr.acquireLock("op");
    clock.advance(120_000); // 2x staleMs
    const result = await mgr.checkOnPluginLoad();
    expect(result.stale).toBe(true);
    expect(result.holder).not.toBeNull();
  });

  it("treats malformed lock file as absent (null holder)", async () => {
    const { mgr, app } = makeHarness();
    await app.vault.adapter.write(".exocortex/switch-lock.json", "{ not valid json");
    const result = await mgr.checkOnPluginLoad();
    expect(result.stale).toBe(false);
    expect(result.holder).toBeNull();
  });

  it("treats lock with malformed timestamp as stale", async () => {
    const { mgr, app } = makeHarness();
    const malformed: LockSnapshot = {
      pid: "pid-X",
      acquiredAt: "garbage-timestamp",
      lastHeartbeat: "also-garbage",
      operation: "op",
    };
    await app.vault.adapter.write(
      ".exocortex/switch-lock.json",
      JSON.stringify(malformed),
    );
    const result = await mgr.checkOnPluginLoad();
    expect(result.stale).toBe(true);
    expect(result.holder).not.toBeNull();
  });
});

describe("PluginLockManager.snapshotIsStale", () => {
  it("returns false for fresh heartbeat", () => {
    const { mgr, clock } = makeHarness({ staleMs: 60_000 });
    const snap: LockSnapshot = {
      pid: "p",
      acquiredAt: clock.current.toISOString(),
      lastHeartbeat: clock.current.toISOString(),
      operation: "op",
    };
    expect(mgr.snapshotIsStale(snap)).toBe(false);
  });

  it("returns true when older than staleMs", () => {
    const { mgr, clock } = makeHarness({ staleMs: 60_000 });
    const past = new Date(clock.current.getTime() - 120_000);
    const snap: LockSnapshot = {
      pid: "p",
      acquiredAt: past.toISOString(),
      lastHeartbeat: past.toISOString(),
      operation: "op",
    };
    expect(mgr.snapshotIsStale(snap)).toBe(true);
  });
});

describe("PluginLockManager custom lockPath / staleMs", () => {
  it("honours custom lock path", async () => {
    const { mgr, store } = makeHarness({ lockPath: ".exocortex/custom-lock.json" });
    await mgr.acquireLock("op");
    expect(store.files.has(".exocortex/custom-lock.json")).toBe(true);
    expect(store.files.has(".exocortex/switch-lock.json")).toBe(false);
  });

  it("honours custom staleMs", async () => {
    const { mgr, clock } = makeHarness({ staleMs: 1_000 });
    await mgr.acquireLock("op");
    clock.advance(2_000);
    const second = await mgr.acquireLock("op-2");
    expect(second).toBe(true); // overtaken due to small staleMs
  });
});
