/**
 * req e5e45283 — ExoSync reads the GitHub quota from a SUCCESSFUL response.
 *
 * Before this requirement `x-ratelimit-*` was read on the failure path only
 * (both transports call `enrichRateLimitError` just before throwing;
 * `BootstrapAssetSpaceService` reads them inside `if (!response.ok)`), so the
 * remaining budget became observable exactly when it had already run out. The
 * 2026-09-26 incident was then diagnosed against `GET /rate_limit`, which is
 * blind here — it reported `used=0 remaining=5000` against an actual 379/2468.
 *
 * The axes below are split so each one can redden alone:
 *   A1  the timer parses the headers it is handed
 *   A2  the ENGINE hands them to it on a successful round-trip (the wiring —
 *       this is the axis that dies if the `observeQuota` call site is deleted,
 *       while A1 stays green)
 *   A3  a response without the headers does not erase the last real reading
 *   A4  aggregation keeps the FRESHER snapshot instead of summing states
 *   A5  absence prints `quota n/a`, never an omitted line
 */

import {
  ConditionalRequestCache,
  SyncEngine,
  SyncPhaseTimer,
  withConditionalRequests,
  addTimings,
  emptyTimings,
  formatQuota,
  formatRepoTimings,
  formatTimingsLine,
  type RestCommitRequest,
  type RestCommitResponse,
  type RestCommitTransport,
} from "../../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "./fakeGitHub";

/** Header map → the case-insensitive getter shape the transport contract uses. */
function getterFor(map: Record<string, string>) {
  const lower = new Map(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return (name: string): string | null => lower.get(name.toLowerCase()) ?? null;
}

describe("req e5e45283 — quota read from a successful response", () => {
  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A1 timer parses x-ratelimit-* into a snapshot", () => {
    const timer = new SyncPhaseTimer(() => 1_000);
    timer.observeQuota(
      getterFor({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4871",
        "x-ratelimit-used": "129",
        "x-ratelimit-reset": "1790440000",
      }),
    );
    const q = timer.snapshot().quota;
    expect(q).toBeDefined();
    expect(q?.limit).toBe(5000);
    expect(q?.remaining).toBe(4871);
    expect(q?.used).toBe(129);
    expect(q?.resetEpoch).toBe(1790440000);
    expect(q?.observedAt).toBe(1_000);
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A2 the ENGINE observes quota on a successful round-trip", async () => {
    const repo = new FakeGitHubRepo({ "a.md": mdAsset("a") });
    const local = new FakeLocalFiles();
    const raw = repo.transport();
    // Every 2xx the fake returns carries the quota headers, exactly as GitHub
    // does. Nothing here touches the error path.
    const withHeaders: RestCommitTransport = async (
      req: RestCommitRequest,
    ): Promise<RestCommitResponse> => {
      const res = await raw(req);
      return {
        ...res,
        headers: getterFor({
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-used": "1",
          "x-ratelimit-reset": "1790440000",
        }),
      };
    };
    const engine = new SyncEngine({
      transport: withHeaders,
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => local,
      sha1: sha1Hex,
      now: () => 1_000_000,
    });

    const results = await engine.syncAll(
      [repo.spec()],
      "pull",
      () => undefined,
    );

    const quota = results[0]?.timings?.quota;
    expect(results[0]?.timings?.counts.restCalls).toBeGreaterThan(0);
    // ⛔ This is the WIRING axis: deleting `timer.observeQuota(res.headers)`
    // from `SyncEngine.instrumentTransport` leaves A1 green and reddens only
    // this one — which is the whole point of separating them.
    expect(quota).toBeDefined();
    expect(quota?.remaining).toBe(4999);
    expect(quota?.limit).toBe(5000);
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A3 a header-less response keeps the last real reading", () => {
    const timer = new SyncPhaseTimer(() => 7);
    timer.observeQuota(getterFor({ "x-ratelimit-remaining": "42" }));
    // A cache hit makes no request, so it reports no headers — it must not
    // erase what the last real response told us.
    timer.observeQuota(undefined);
    timer.observeQuota(getterFor({}));
    expect(timer.snapshot().quota?.remaining).toBe(42);
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A4 aggregation keeps the fresher snapshot, never the sum", () => {
    const older = new SyncPhaseTimer(() => 100);
    older.observeQuota(getterFor({ "x-ratelimit-remaining": "900" }));
    const newer = new SyncPhaseTimer(() => 200);
    newer.observeQuota(getterFor({ "x-ratelimit-remaining": "800" }));

    const merged = addTimings(older.snapshot(), newer.snapshot());
    expect(merged.quota?.remaining).toBe(800);
    // Summing states would give 1700 — a number GitHub never sent.
    expect(merged.quota?.remaining).not.toBe(1700);

    // Order must not matter: the later observation wins either way.
    expect(addTimings(newer.snapshot(), older.snapshot()).quota?.remaining).toBe(
      800,
    );
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A6 a 304 served from the conditional cache still carries the quota headers", async () => {
    // ⛔ The axis that matters most in practice. #4416 made 304 the DOMINANT
    // path of an idle run ("83 requests, all of them 304-able"), and the
    // conditional layer used to hand the body on as a synthetic 200 with no
    // headers — so the run spent N real round-trips and reported `quota n/a`.
    // Driving the REAL `withConditionalRequests` is the point: a stub
    // transport can never produce this shape.
    let content: string | null = null;
    const store = {
      read: async (): Promise<string | null> => content,
      writeAtomic: async (next: string): Promise<void> => {
        content = next;
      },
    };
    const cache = new ConditionalRequestCache({ io: store });
    const url = "https://api.github.com/repos/o/r/git/refs/heads/main";
    const etag = 'W/"abc"';
    const quotaHeaders = getterFor({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4100",
      "x-ratelimit-used": "900",
      "x-ratelimit-reset": "1790440000",
    });

    // First pass: a normal 200 that issues the validator.
    let phase: "fresh" | "notModified" = "fresh";
    const remote: RestCommitTransport = async () =>
      phase === "fresh"
        ? {
            status: 200,
            json: { object: { sha: "a".repeat(40) } },
            headers: (n: string): string | null =>
              n.toLowerCase() === "etag" ? etag : quotaHeaders(n),
          }
        : { status: 304, headers: quotaHeaders };

    const transport = withConditionalRequests(remote, cache);
    await transport({ method: "GET", url });
    phase = "notModified";
    const res = await transport({ method: "GET", url });

    expect(res.headers).toBeDefined();
    expect(res.headers?.("x-ratelimit-remaining")).toBe("4100");

    // And the timer turns that into a real reading rather than `n/a`.
    const timer = new SyncPhaseTimer(() => 1);
    timer.observeQuota(res.headers);
    expect(timer.snapshot().quota?.remaining).toBe(4100);
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A7 within one window the MORE DEPLETED reading wins, whatever the arrival order", () => {
    // Blob fetches run through a bounded worker pool, so responses do not
    // arrive in the order GitHub served them. A request issued first can
    // resolve last carrying a HIGHER remaining; taking it because it was
    // observed later would report headroom that does not exist.
    let clock = 0;
    const timer = new SyncPhaseTimer(() => ++clock);
    const at = (remaining: string) =>
      getterFor({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": remaining,
        "x-ratelimit-reset": "1790440000",
      });

    timer.observeQuota(at("4000")); // the truer, more depleted reading
    timer.observeQuota(at("4200")); // an older response, observed later
    expect(timer.snapshot().quota?.remaining).toBe(4000);

    // A new window (the reset rolled over) legitimately replaces it.
    timer.observeQuota(
      getterFor({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1790443600",
      }),
    );
    expect(timer.snapshot().quota?.remaining).toBe(4999);
  });

  it("@req:e5e45283-cf8c-45f5-8ad7-5cd08ab5442a A5 absence prints `quota n/a` and both lines carry it", () => {
    expect(formatQuota(undefined)).toBe("quota n/a");

    const t = emptyTimings();
    t.durations.hash = 5_000;
    t.counts.restCalls = 3;
    expect(formatTimingsLine(t)).toContain("quota n/a");
    expect(formatRepoTimings("o/r#main", t)).toContain("quota n/a");

    const timer = new SyncPhaseTimer(() => 0);
    timer.observeQuota(
      getterFor({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4871",
      }),
    );
    expect(formatQuota(timer.snapshot().quota)).toBe("quota 4871/5000");
  });
});
