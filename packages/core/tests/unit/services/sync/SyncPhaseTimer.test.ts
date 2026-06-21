/**
 * ExoSync Phase 0 — SyncPhaseTimer unit tests (measure-first instrumentation).
 *
 * Pure tests of the timing primitive + aggregation/formatting helpers with a
 * deterministic injected clock. The engine-integration test
 * (SyncEngine.timings.test.ts) proves the chokepoint wiring attributes a REAL
 * sync's time to the right buckets.
 */

import {
  SyncPhaseTimer,
  SYNC_PHASES,
  classifyRestPhase,
  emptyTimings,
  addTimings,
  aggregateTimings,
  totalMs,
  dominantPhase,
  fmtMs,
  formatTimingsLine,
  formatRepoTimings,
  type SyncPhaseTimings,
} from "../../../../src";
import type { RestCommitRequest } from "../../../../src";

/** Controllable clock: `now()` returns the current value, `set`/`advance` move it. */
function fakeClock(): {
  now: () => number;
  advance: (ms: number) => void;
  set: (ms: number) => void;
} {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

const get = (
  method: RestCommitRequest["method"],
  url: string,
): RestCommitRequest => ({
  method,
  url,
});

describe("classifyRestPhase", () => {
  const base = "https://api.github.com/repos/o/r";
  it("buckets GET refs/heads as restHead", () => {
    expect(classifyRestPhase(get("GET", `${base}/git/refs/heads/main`))).toBe(
      "restHead",
    );
  });
  it("buckets GET commits as restCommit", () => {
    expect(classifyRestPhase(get("GET", `${base}/git/commits/abc`))).toBe(
      "restCommit",
    );
  });
  it("buckets GET trees as restTree", () => {
    expect(
      classifyRestPhase(get("GET", `${base}/git/trees/abc?recursive=1`)),
    ).toBe("restTree");
  });
  it("buckets GET blobs as restBlob", () => {
    expect(classifyRestPhase(get("GET", `${base}/git/blobs/abc`))).toBe(
      "restBlob",
    );
  });
  it("buckets POST/PATCH (createCommit chain) as restPush", () => {
    expect(classifyRestPhase(get("POST", `${base}/git/blobs`))).toBe(
      "restPush",
    );
    expect(classifyRestPhase(get("POST", `${base}/git/trees`))).toBe(
      "restPush",
    );
    expect(classifyRestPhase(get("POST", `${base}/git/commits`))).toBe(
      "restPush",
    );
    expect(classifyRestPhase(get("PATCH", `${base}/git/refs/heads/main`))).toBe(
      "restPush",
    );
  });
  it("buckets an unknown GET conservatively as restCommit (never drops it)", () => {
    expect(classifyRestPhase(get("GET", `${base}/git/unknown/x`))).toBe(
      "restCommit",
    );
  });
});

describe("SyncPhaseTimer.time", () => {
  it("accumulates the elapsed clock delta into the phase bucket", async () => {
    const clock = fakeClock();
    const timer = new SyncPhaseTimer(clock.now);
    await timer.time("hash", async () => {
      clock.advance(7);
    });
    await timer.time("hash", async () => {
      clock.advance(3);
    });
    await timer.time("localRead", async () => {
      clock.advance(5);
    });
    const snap = timer.snapshot();
    expect(snap.durations.hash).toBe(10);
    expect(snap.durations.localRead).toBe(5);
    expect(snap.durations.restTree).toBe(0);
  });

  it("returns the op's value (transparent pass-through)", async () => {
    const timer = new SyncPhaseTimer(fakeClock().now);
    const v = await timer.time("restTree", async () => 42);
    expect(v).toBe(42);
  });

  it("still measures AND rethrows when the op throws", async () => {
    const clock = fakeClock();
    const timer = new SyncPhaseTimer(clock.now);
    await expect(
      timer.time("restBlob", async () => {
        clock.advance(9);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Timed in `finally` even on the throwing path.
    expect(timer.snapshot().durations.restBlob).toBe(9);
  });
});

describe("SyncPhaseTimer counts + snapshot immutability", () => {
  it("counts reads/hashes/writes/REST independently", () => {
    const timer = new SyncPhaseTimer(fakeClock().now);
    timer.bumpRead();
    timer.bumpRead();
    timer.bumpHashed();
    timer.bumpWritten();
    timer.bumpRest();
    timer.bumpRest();
    timer.bumpRest();
    const c = timer.snapshot().counts;
    expect(c).toEqual({
      filesRead: 2,
      filesHashed: 1,
      filesWritten: 1,
      restCalls: 3,
    });
  });

  it("snapshot is a copy — later mutations do not leak into it", () => {
    const clock = fakeClock();
    const timer = new SyncPhaseTimer(clock.now);
    timer.bumpRead();
    const snap = timer.snapshot();
    timer.bumpRead();
    expect(snap.counts.filesRead).toBe(1); // frozen at snapshot time
  });

  it("seeds every phase at zero", () => {
    const snap = new SyncPhaseTimer(fakeClock().now).snapshot();
    for (const p of SYNC_PHASES) expect(snap.durations[p]).toBe(0);
    expect(totalMs(snap)).toBe(0);
  });
});

describe("aggregation helpers", () => {
  function timings(
    durations: Partial<Record<(typeof SYNC_PHASES)[number], number>>,
    counts?: Partial<SyncPhaseTimings["counts"]>,
  ): SyncPhaseTimings {
    const t = emptyTimings();
    for (const [k, v] of Object.entries(durations)) {
      t.durations[k as (typeof SYNC_PHASES)[number]] = v as number;
    }
    Object.assign(t.counts, counts ?? {});
    return t;
  }

  it("totalMs sums all phases", () => {
    expect(totalMs(timings({ hash: 10, localRead: 5, restTree: 3 }))).toBe(18);
  });

  it("addTimings sums durations + counts pairwise", () => {
    const a = timings({ hash: 10 }, { filesHashed: 3, restCalls: 2 });
    const b = timings(
      { hash: 4, restTree: 6 },
      { filesHashed: 1, filesRead: 9 },
    );
    const sum = addTimings(a, b);
    expect(sum.durations.hash).toBe(14);
    expect(sum.durations.restTree).toBe(6);
    expect(sum.counts).toEqual({
      filesRead: 9,
      filesHashed: 4,
      filesWritten: 0,
      restCalls: 2,
    });
  });

  it("aggregateTimings sums every result's timings and ignores missing ones", () => {
    const agg = aggregateTimings([
      { timings: timings({ hash: 10 }, { filesHashed: 2 }) },
      { timings: timings({ hash: 5, restBlob: 3 }, { filesHashed: 1 }) },
      {}, // a `busy` result with no timer — contributes nothing
    ]);
    expect(agg.durations.hash).toBe(15);
    expect(agg.durations.restBlob).toBe(3);
    expect(agg.counts.filesHashed).toBe(3);
  });

  it("dominantPhase picks the single largest bucket with its share", () => {
    const dom = dominantPhase(
      timings({ hash: 80, localRead: 15, restTree: 5 }),
    );
    expect(dom).not.toBeNull();
    expect(dom!.phase).toBe("hash");
    expect(dom!.ms).toBe(80);
    expect(Math.round(dom!.pct)).toBe(80); // 80/100
  });

  it("dominantPhase is null for an idle timing", () => {
    expect(dominantPhase(emptyTimings())).toBeNull();
  });
});

describe("formatting", () => {
  it("fmtMs renders sub-second as ms and ≥1s as seconds", () => {
    expect(fmtMs(742)).toBe("742ms");
    expect(fmtMs(1500)).toBe("1.5s");
    expect(fmtMs(124800)).toBe("124.8s");
  });

  it("formatTimingsLine leads with total, sorts phases desc with shares + counts", () => {
    const t = emptyTimings();
    t.durations.hash = 78200;
    t.durations.localRead = 31100;
    t.durations.restTree = 8400;
    t.counts.filesHashed = 6304;
    t.counts.filesRead = 6304;
    t.counts.restCalls = 31;
    const line = formatTimingsLine(t);
    expect(line).toContain("⏱ ExoSync 117.7s");
    // hash is the dominant phase → appears first.
    expect(line.indexOf("hash")).toBeLessThan(line.indexOf("localRead"));
    expect(line).toContain("hash 78.2s 66%");
    expect(line).toContain("6304 hashed");
    expect(line).toContain("31 REST");
    // zero phases are omitted from the concise line.
    expect(line).not.toContain("restBlob");
  });

  it("formatTimingsLine is empty when nothing was timed", () => {
    expect(formatTimingsLine(emptyTimings())).toBe("");
  });

  it("formatRepoTimings includes ALL phases (zeros too) + counts", () => {
    const t = emptyTimings();
    t.durations.hash = 5000;
    t.counts.filesHashed = 100;
    const line = formatRepoTimings("o/r#main", t);
    expect(line).toContain("o/r#main");
    expect(line).toContain("hash=5.0s");
    expect(line).toContain("restBlob=0ms"); // zeros kept for cross-repo comparison
    expect(line).toContain("hashed 100");
  });
});
