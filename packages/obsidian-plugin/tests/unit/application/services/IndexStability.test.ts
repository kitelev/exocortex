/**
 * RFC 9821a379 decision 7 / AC8 (ticket 058bad52) — «индекс стабилен» =
 * a complete index exists (warm eager walk marked, or any completed full
 * rebuild) AND no full rebuild is in flight; a failed first walk is reported,
 * not waited on forever.
 *
 * revert-verify: `IndexStability.spec.json` — each mutant reddens its own axes.
 */
import {
  IndexStability,
  type IndexStabilityOutcome,
} from "../../../../src/application/services/IndexStability";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A fake indexer whose full rebuilds the test starts and settles by hand. */
function fakeIndex() {
  let current: { promise: Promise<void>; resolve: () => void } | null = null;
  let completed = 0;
  return {
    isRefreshing: () => current !== null,
    whenRefreshSettled: () => current?.promise ?? Promise.resolve(),
    completedRefreshCount: () => completed,
    start(): void {
      current = deferred();
    },
    /** Settles the running rebuild; `andStartAnother` starts the next one first. */
    settle(options: { andStartAnother?: boolean; ok?: boolean } = {}): void {
      const done = current;
      if (options.ok !== false) completed += 1;
      current = options.andStartAnother === true ? deferred() : null;
      done?.resolve();
    },
  };
}

async function outcomeWithin(
  promise: Promise<IndexStabilityOutcome>,
): Promise<IndexStabilityOutcome | "pending"> {
  let outcome: IndexStabilityOutcome | "pending" = "pending";
  void promise.then((o) => {
    outcome = o;
  });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  return outcome;
}

describe("IndexStability (RFC 9821a379 decision 7, ticket 058bad52)", () => {
  it("S1 @req:23f10730-82f7-4037-b566-da79d5fa3378 before a complete index the store is not stable even with no rebuild running; marking makes it stable", async () => {
    const stability = new IndexStability(fakeIndex());
    expect(stability.isStable()).toBe(false);
    const waiting = stability.whenStable();
    expect(await outcomeWithin(waiting)).toBe("pending");
    stability.markInitialIndexComplete();
    expect(stability.isStable()).toBe(true);
    expect(await outcomeWithin(waiting)).toEqual({ kind: "stable" });
  });

  it("S2 @req:23f10730-82f7-4037-b566-da79d5fa3378 a full rebuild in flight makes it unstable until it settles", async () => {
    const index = fakeIndex();
    const stability = new IndexStability(index);
    stability.markInitialIndexComplete();
    index.start();
    expect(stability.isStable()).toBe(false);
    const waiting = stability.whenStable();
    expect(await outcomeWithin(waiting)).toBe("pending");
    index.settle();
    expect(stability.isStable()).toBe(true);
    expect(await outcomeWithin(waiting)).toEqual({ kind: "stable" });
  });

  it("S3 @req:23f10730-82f7-4037-b566-da79d5fa3378 a second rebuild started as the first settles is waited for too", async () => {
    const index = fakeIndex();
    const stability = new IndexStability(index);
    stability.markInitialIndexComplete();
    index.start();
    const waiting = stability.whenStable();
    // Let the waiter reach the FIRST rebuild before it settles — otherwise it
    // only ever sees the second one and a single wait would pass by accident.
    expect(await outcomeWithin(waiting)).toBe("pending");
    index.settle({ andStartAnother: true });
    expect(await outcomeWithin(waiting)).toBe("pending");
    expect(stability.isStable()).toBe(false);
    index.settle();
    expect(await outcomeWithin(waiting)).toEqual({ kind: "stable" });
  });

  it("S4 @req:23f10730-82f7-4037-b566-da79d5fa3378 marking twice is harmless", () => {
    const stability = new IndexStability(fakeIndex());
    stability.markInitialIndexComplete();
    stability.markInitialIndexComplete();
    expect(stability.isStable()).toBe(true);
  });

  it("S5 @req:23f10730-82f7-4037-b566-da79d5fa3378 a failed first walk is reported to the waiter instead of a wait without end", async () => {
    const stability = new IndexStability(fakeIndex());
    const waiting = stability.whenStable();
    expect(await outcomeWithin(waiting)).toBe("pending");
    stability.markInitialIndexFailed("walk failed");
    expect(await outcomeWithin(waiting)).toEqual({
      kind: "failed",
      message: "walk failed",
    });
    expect(stability.isStable()).toBe(false);
  });

  it("S6 @req:23f10730-82f7-4037-b566-da79d5fa3378 any completed full rebuild makes the index complete — it recovers after a failed first walk", async () => {
    const index = fakeIndex();
    const stability = new IndexStability(index);
    stability.markInitialIndexFailed("walk failed");
    expect(await outcomeWithin(stability.whenStable())).toEqual({
      kind: "failed",
      message: "walk failed",
    });
    index.start();
    index.settle();
    expect(stability.isStable()).toBe(true);
    expect(await outcomeWithin(stability.whenStable())).toEqual({
      kind: "stable",
    });
  });

  it("S7 @req:23f10730-82f7-4037-b566-da79d5fa3378 a failure reported after a complete index exists is ignored", async () => {
    const index = fakeIndex();
    const stability = new IndexStability(index);
    index.start();
    index.settle();
    stability.markInitialIndexFailed("palette failed");
    expect(stability.isStable()).toBe(true);
    expect(await outcomeWithin(stability.whenStable())).toEqual({
      kind: "stable",
    });
  });

  it("S9 @req:23f10730-82f7-4037-b566-da79d5fa3378 a waiter asleep before any complete index is woken by a failure reported after a rebuild completed with no mark", async () => {
    const index = fakeIndex();
    const stability = new IndexStability(index);
    const waiting = stability.whenStable();
    expect(await outcomeWithin(waiting)).toBe("pending");
    // The rebuild starts and completes while the waiter sleeps on the signal:
    // no mark follows it, because the step after the rebuild threw.
    index.start();
    index.settle();
    expect(await outcomeWithin(waiting)).toBe("pending");
    stability.markInitialIndexFailed("palette failed");
    expect(await outcomeWithin(waiting)).toEqual({ kind: "stable" });
  });

  it("S8 @req:23f10730-82f7-4037-b566-da79d5fa3378 a rebuild that failed does not make the index complete", () => {
    const index = fakeIndex();
    const stability = new IndexStability(index);
    index.start();
    index.settle({ ok: false });
    expect(stability.isStable()).toBe(false);
  });
});
