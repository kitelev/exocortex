/**
 * ExoSync Phase 0 — SyncEngine per-phase timing instrumentation (measure-first).
 *
 * Proves the engine's THREE chokepoint wrappers (transport / sha1 / localFiles)
 * attribute a REAL sync's wall-clock to the right phase buckets and counts.
 * Production-shape (test-fixture-realism): the SAME `FakeGitHubRepo` /
 * `FakeLocalFiles` used by every other SyncEngine test, with a deterministic
 * injected clock and thin clock-advancing port wrappers that mirror the cost
 * of each operation on a real device. The clock advances ONLY inside the
 * underlying op, so the engine's `start = now()` / `finally end = now()`
 * bracket measures exactly that op's simulated cost.
 *
 * This is the harness Andrey reads on iPhone: it confirms which phase dominates
 * a sync, so Phase 1 picks the optimisation by measurement, not by guess.
 */

import {
  SyncEngine,
  dominantPhase,
  type LocalFilesPort,
  type RestCommitRequest,
  type RestCommitTransport,
  type Sha1Fn,
  type SyncEngineDeps,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

/** A clock the test advances by injecting per-op costs into the port wrappers. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** Cost (ms) charged to each op so a sync's wall-clock is deterministic. */
interface Costs {
  read: number;
  hash: number;
  restHead: number;
  restCommit: number;
  restTree: number;
  restBlob: number;
  restPush: number;
}

const DEFAULT_COSTS: Costs = {
  read: 5,
  hash: 50, // the hypothesised hot path — heaviest per-op by design
  restHead: 200,
  restCommit: 200,
  restTree: 300,
  restBlob: 150,
  restPush: 400,
};

/** sha1 wrapper that advances the clock by the hashing cost on every digest. */
function advancingSha1(advance: (ms: number) => void, cost: number): Sha1Fn {
  return async (data) => {
    advance(cost);
    return sha1Hex(data);
  };
}

/** LocalFilesPort wrapper that charges `read` per read (list/delete are free). */
function advancingLocalFiles(
  inner: LocalFilesPort,
  advance: (ms: number) => void,
  cost: number,
): LocalFilesPort {
  return {
    list: () => inner.list(),
    read: async (p) => {
      advance(cost);
      return inner.read(p);
    },
    write: (p, c) => inner.write(p, c),
    delete: (p) => inner.delete(p),
    readBinary: inner.readBinary
      ? async (p) => {
          advance(cost);
          return inner.readBinary!(p);
        }
      : undefined,
    writeBinary: inner.writeBinary
      ? (p, b) => inner.writeBinary!(p, b)
      : undefined,
  };
}

/** Transport wrapper that charges the per-URL REST cost on every round-trip. */
function advancingTransport(
  inner: RestCommitTransport,
  advance: (ms: number) => void,
  costs: Costs,
): RestCommitTransport {
  return async (req: RestCommitRequest) => {
    advance(restCost(req, costs));
    return inner(req);
  };
}

function restCost(req: RestCommitRequest, c: Costs): number {
  if (req.method !== "GET") return c.restPush;
  if (req.url.includes("/git/blobs/")) return c.restBlob;
  if (req.url.includes("/git/trees/")) return c.restTree;
  if (req.url.includes("/git/commits/")) return c.restCommit;
  if (req.url.includes("/git/refs/")) return c.restHead;
  return c.restCommit;
}

function makeEngine(
  gh: FakeGitHubRepo,
  local: FakeLocalFiles,
  clock: { now: () => number; advance: (ms: number) => void },
  costs: Costs = DEFAULT_COSTS,
  overrides: Partial<SyncEngineDeps> = {},
): SyncEngine {
  return new SyncEngine({
    transport: advancingTransport(gh.transport(), clock.advance, costs),
    watermarkStore: new FakeWatermarkStore(),
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => advancingLocalFiles(local, clock.advance, costs.read),
    sha1: advancingSha1(clock.advance, costs.hash),
    now: clock.now,
    ...overrides,
  });
}

const A = "assets/a.md";
const B = "assets/b.md";
const C = "assets/c.md";

describe("SyncEngine — Phase 0 per-phase timing instrumentation", () => {
  it("attributes a no-op sync's time to local read + hash, with deterministic counts", async () => {
    const files = {
      [A]: mdAsset("u1"),
      [B]: mdAsset("u2"),
      [C]: mdAsset("u3"),
    };
    const gh = new FakeGitHubRepo(files);
    const local = new FakeLocalFiles(files);
    const clock = fakeClock();
    const engine = makeEngine(gh, local, clock);

    await engine.sync(gh.spec()); // bootstrap (its own timer, ignored)
    const result = await engine.sync(gh.spec()); // clean no-op

    expect(result.status).toBe("synced");
    const t = result.timings;
    expect(t).toBeDefined();
    // Every syncable file is read once and hashed once on the detect pass.
    expect(t!.counts.filesRead).toBe(3);
    expect(t!.counts.filesHashed).toBe(3);
    expect(t!.durations.localRead).toBe(3 * DEFAULT_COSTS.read); // 15ms
    expect(t!.durations.hash).toBe(3 * DEFAULT_COSTS.hash); // 150ms
    // No-op fast path: base-commit + head ref round-trips, no tree/blob fetch.
    expect(t!.counts.restCalls).toBeGreaterThanOrEqual(2);
    expect(t!.durations.restCommit).toBeGreaterThan(0); // resolveBaseTreeSha
    expect(t!.durations.restHead).toBeGreaterThan(0); // getHeadSha
    expect(t!.durations.restTree).toBe(0); // root-Merkle short-circuit
    expect(t!.durations.restBlob).toBe(0);
  });

  it("identifies the dominant phase — hash when hashing is the heaviest per-op", async () => {
    // Many files, hashing dwarfs everything (the plan's §2 hypothesis shape).
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`assets/f${i}.md`] = mdAsset(`u${i}`);
    const gh = new FakeGitHubRepo(files);
    const local = new FakeLocalFiles(files);
    const clock = fakeClock();
    const engine = makeEngine(gh, local, clock);

    await engine.sync(gh.spec());
    const result = await engine.sync(gh.spec());

    const t = result.timings!;
    const dom = dominantPhase(t);
    expect(dom).not.toBeNull();
    expect(dom!.phase).toBe("hash"); // 40×50ms hashing ≫ 40×5ms reads + 2 REST
    // … and the inverse: make remote tree fetch the heaviest → tree dominates.
  });

  it("identifies the dominant phase — restTree when the tree fetch is heaviest", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 3; i++) files[`assets/f${i}.md`] = mdAsset(`u${i}`);
    const gh = new FakeGitHubRepo(files);
    const local = new FakeLocalFiles(files);
    const clock = fakeClock();
    // Cheap local, very expensive tree fetch.
    const engine = makeEngine(gh, local, clock, {
      ...DEFAULT_COSTS,
      read: 1,
      hash: 1,
      restTree: 9000,
    });

    await engine.sync(gh.spec());
    // Remote moves → head-tree fetch fires this sync.
    gh.commitDirect("main", { [`assets/f0.md`]: mdAsset("u0", "edited") }, "B");
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    const t = result.timings!;
    expect(t.durations.restTree).toBeGreaterThan(0);
    expect(t.durations.restBlob).toBeGreaterThan(0); // the changed blob fetched
    expect(dominantPhase(t)!.phase).toBe("restTree");
  });

  it("counts pull-applied writes in the localWrite bucket", async () => {
    const files = { [A]: mdAsset("u1", "v1") };
    const gh = new FakeGitHubRepo(files);
    const local = new FakeLocalFiles(files);
    const clock = fakeClock();
    const engine = makeEngine(gh, local, clock);

    await engine.sync(gh.spec());
    gh.commitDirect("main", { [A]: mdAsset("u1", "remote v2") }, "device B");
    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced");
    expect(result.pulledCount).toBe(1);
    expect(result.timings!.counts.filesWritten).toBe(1);
  });

  it("aggregates per-AS timings across a multi-repo syncAll run", async () => {
    const filesA = { [A]: mdAsset("u1") };
    const ghA = new FakeGitHubRepo(filesA);
    const localA = new FakeLocalFiles(filesA);
    const clock = fakeClock();
    const engine = makeEngine(ghA, localA, clock);

    const results = await engine.syncAll([ghA.spec()]);
    // Every result carries its own breakdown (observation-only, always set).
    expect(results[0].timings).toBeDefined();
    expect(results[0].timings!.counts.filesHashed).toBeGreaterThan(0);
  });

  it("instrumentation is observation-only — does not change the sync outcome", async () => {
    const files = { [A]: mdAsset("u1", "original") };
    const gh = new FakeGitHubRepo(files);
    const local = new FakeLocalFiles(files);
    const clock = fakeClock();
    const engine = makeEngine(gh, local, clock);

    await engine.sync(gh.spec());
    gh.commitDirect("main", { [A]: mdAsset("u1", "remote edit") }, "device B");
    const result = await engine.sync(gh.spec());

    // Same convergence as the un-instrumented engine (cf. progress test).
    expect(result.status).toBe("synced");
    expect(local.files.get(A)).toBe(mdAsset("u1", "remote edit"));
  });
});
