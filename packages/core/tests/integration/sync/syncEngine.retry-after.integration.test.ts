/**
 * ExoSync A (RFC 6a1a6518) — Retry-After honoring, end-to-end through the REAL
 * SyncEngine over the production-shape `FakeGitHubRepo` transport (NO network).
 *
 * This is the CI-reliable integration binding for req
 * 0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2. It composes the real engine + its real
 * `withRateLimitBackoff` wrapper + the real global per-sync budget, and drives
 * a transport that ENRICHES its rate-limit errors exactly as the production
 * CLI/plugin transports do (via the real `enrichRateLimitError` helper). It
 * proves the two engine-side halves of A:
 *   1. the backoff sleeps EXACTLY the attached Retry-After (not a jittered guess);
 *   2. the GLOBAL per-sync budget warn-defers — one locked repo cannot make
 *      every later repo wait a full window (bounded total, later repos fail fast).
 *
 * @req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2
 */

import {
  SyncEngine,
  enrichRateLimitError,
  type RestCommitTransport,
  type SyncEngineDeps,
} from "../../../src";
import {
  FakeGitHubRepo,
  FakeLocalFiles,
  FakeWatermarkStore,
  alwaysMaterialized,
  mdAsset,
  sha1Hex,
} from "../../unit/services/sync/fakeGitHub";

const FILE_A = "assets/a.md";

/** A rate-limit error enriched exactly as the real transport would. */
function rateLimited(req: { method: string; url: string }, retryAfterSec: string): Error {
  const get = (name: string): string | undefined =>
    name.toLowerCase() === "retry-after" ? retryAfterSec : undefined;
  return enrichRateLimitError(
    new Error(
      `GitHub request ${req.method} ${req.url} → HTTP 403: API rate limit exceeded`,
    ),
    get,
  );
}

function makeEngine(
  gh: FakeGitHubRepo,
  local: FakeLocalFiles,
  transport: RestCommitTransport,
  backoff: SyncEngineDeps["backoff"],
): SyncEngine {
  return new SyncEngine({
    transport,
    watermarkStore: new FakeWatermarkStore(),
    materializationCheck: alwaysMaterialized(),
    localFilesFor: () => local,
    sha1: sha1Hex,
    backoff,
  });
}

describe("ExoSync A — Retry-After honored end-to-end through SyncEngine", () => {
  it("@req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2 sleeps EXACTLY the transport's Retry-After, then completes the sync", async () => {
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const inner = gh.transport();
    const sleeps: number[] = [];

    // The first two transport CALLS rate-limit (Retry-After: 90s), then the
    // real transport takes over — the engine's first request eats both throttles.
    let failures = 2;
    const transport: RestCommitTransport = async (req) => {
      if (failures > 0) {
        failures--;
        throw rateLimited(req, "90");
      }
      return inner(req);
    };

    const engine = makeEngine(gh, local, transport, {
      random: () => 0.99, // would inflate a guess; must be ignored
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await engine.sync(gh.spec());

    expect(result.status).toBe("synced"); // survived the throttle
    // Revert-verify anchor: drop the retryAfterMs read → these become 60000
    // (the ≥60s fallback) → RED.
    expect(sleeps).toEqual([90_000, 90_000]);
  });

  it("@req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2 the global per-sync budget warn-defers: one locked repo cannot stall the whole syncAll", async () => {
    // Two repos, both perpetually rate-limited (Retry-After: 90s). The default
    // maxRetries is 6 (=> up to 6 waits per repo => 12 total without a cap), but
    // a per-sync budget of 200s allows only ~2 waits for the WHOLE run.
    const gh = new FakeGitHubRepo({ [FILE_A]: mdAsset("u1") });
    const local = new FakeLocalFiles({ [FILE_A]: mdAsset("u1") });
    const specA = { ...gh.spec(), repoKey: "o/a#main", localPath: "assetspaces/a" };
    const specB = { ...gh.spec(), repoKey: "o/b#main", localPath: "assetspaces/b" };
    const sleeps: number[] = [];

    const transport: RestCommitTransport = async (req) => {
      throw rateLimited(req, "90"); // never succeeds
    };

    // Both repos share ONE engine (one budget).
    const engine = new SyncEngine({
      transport,
      watermarkStore: new FakeWatermarkStore(),
      materializationCheck: alwaysMaterialized(),
      localFilesFor: () => local,
      sha1: sha1Hex,
      backoff: {
        maxTotalRateLimitWaitMs: 200_000, // room for exactly 2 waits of 90s
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });

    const results = await engine.syncAll([specA, specB]);

    // Neither repo synced (both perpetually throttled) — warn-not-block (D12).
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.status).not.toBe("synced");
    // The budget bounded the WHOLE run to 2 waits — NOT 6-per-repo. The second
    // repo failed fast (budget already spent) rather than waiting its own window.
    // Revert-verify anchor: neutralize the budget guard → this balloons to the
    // full per-repo maxRetries (≫2) → RED.
    expect(sleeps).toEqual([90_000, 90_000]);
  });
});
