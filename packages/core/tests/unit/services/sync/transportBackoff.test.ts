/**
 * ExoSync A3 — rate-limit backoff transport decorator (R6) + RFC 6a1a6518 A
 * (honor Retry-After, absent → ≥60s, global per-sync budget, maxRetries ≥6).
 *
 * @req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2
 */

import {
  isAuthError,
  isRateLimitError,
  withRateLimitBackoff,
  createRateLimitBudget,
  attachRateLimitFields,
  MIN_RATE_LIMIT_WAIT_MS,
  DEFAULT_MAX_RETRIES,
  type RestCommitRequest,
  type RestCommitTransport,
  type RateLimitErrorFields,
} from "../../../../src";

const REQ: RestCommitRequest = {
  method: "GET",
  url: "https://api.github.com/repos/o/r/git/refs/heads/main",
};

const http = (status: number, body: string): string =>
  `GitHub request GET ${REQ.url} → HTTP ${status}: ${body}`;

/** Rate-limit error, optionally enriched with the fields the transport attaches. */
function rl(body: string, fields: RateLimitErrorFields = {}): Error {
  return attachRateLimitFields(new Error(http(403, body)), fields);
}

/** Transport that throws each given Error in turn, then succeeds. */
function failingTransport(
  errors: Error[],
  finalJson: unknown = { ok: true },
): { transport: RestCommitTransport; calls: () => number } {
  let n = 0;
  return {
    transport: async () => {
      n++;
      const err = errors.shift();
      if (err !== undefined) throw err;
      return { status: 200, json: finalJson };
    },
    calls: () => n,
  };
}

describe("isRateLimitError / isAuthError discrimination", () => {
  it("429 and 403+rate-limit/abuse are rate limits, not auth errors", () => {
    for (const msg of [
      http(429, "too many requests"),
      http(403, "API rate limit exceeded"),
      http(403, "You have triggered an abuse detection mechanism"),
    ]) {
      expect(isRateLimitError(new Error(msg))).toBe(true);
      expect(isAuthError(new Error(msg))).toBe(false);
    }
  });

  it("401 and plain 403 are auth errors, not rate limits", () => {
    for (const msg of [http(401, "Bad credentials"), http(403, "Forbidden")]) {
      expect(isAuthError(new Error(msg))).toBe(true);
      expect(isRateLimitError(new Error(msg))).toBe(false);
    }
  });

  it("422 non-fast-forward is neither (the D16 loop owns it)", () => {
    const msg = `GitHub request PATCH ${REQ.url} → HTTP 422: Update is not a fast forward`;
    expect(isRateLimitError(new Error(msg))).toBe(false);
    expect(isAuthError(new Error(msg))).toBe(false);
  });
});

describe("withRateLimitBackoff — honor Retry-After (RFC 6a1a6518 A)", () => {
  it("@req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2 sleeps EXACTLY the attached Retry-After (not a jittered guess)", async () => {
    const delays: number[] = [];
    // Two rate-limited failures, each carrying Retry-After: 120s.
    const { transport, calls } = failingTransport([
      rl("secondary rate limit", { retryAfterMs: 120_000 }),
      rl("secondary rate limit", { retryAfterMs: 120_000 }),
    ]);
    const wrapped = withRateLimitBackoff(transport, {
      baseDelayMs: 100, // deliberately tiny — proves Retry-After overrides it
      minRateLimitWaitMs: MIN_RATE_LIMIT_WAIT_MS,
      random: () => 0.99, // would inflate a guess; must be ignored
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    const resp = await wrapped(REQ);

    expect(resp.json).toEqual({ ok: true });
    expect(calls()).toBe(3);
    // Revert-verify anchor: remove the retryAfterMs read in
    // computeRateLimitDelay and these become the ≥60s fallback (60000) → RED.
    expect(delays).toEqual([120_000, 120_000]);
  });

  it("@req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2 absent Retry-After waits at least 60s (documented secondary fallback), then exponential", async () => {
    const delays: number[] = [];
    // Bare rate-limit errors — no attached header.
    const { transport } = failingTransport([
      new Error(http(429, "slow down")),
      new Error(http(429, "slow down")),
    ]);
    const wrapped = withRateLimitBackoff(transport, {
      baseDelayMs: 100, // exp term stays < 60s → floor dominates
      random: () => 0.5,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await wrapped(REQ);

    expect(delays).toHaveLength(2);
    for (const d of delays) expect(d).toBeGreaterThanOrEqual(MIN_RATE_LIMIT_WAIT_MS);
    expect(delays).toEqual([60_000, 60_000]);
  });

  it("the exponential term dominates the floor once it exceeds 60s", async () => {
    const delays: number[] = [];
    // baseDelayMs large enough that base*2^attempt eventually beats 60s.
    const { transport } = failingTransport([
      new Error(http(429, "x")),
      new Error(http(429, "x")),
    ]);
    const wrapped = withRateLimitBackoff(transport, {
      baseDelayMs: 50_000, // attempt0: 50k → floored 60k; attempt1: 100k → 100k
      random: () => 0, // no jitter
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await wrapped(REQ);
    expect(delays).toEqual([60_000, 100_000]);
  });

  it("waits until x-ratelimit-reset when the primary bucket is exhausted (remaining=0)", async () => {
    const delays: number[] = [];
    const NOW = 1_700_000_000_000; // fixed ms
    const RESET = 1_700_000_090; // epoch seconds → 90s after NOW
    const { transport } = failingTransport([
      rl("API rate limit exceeded", { rateLimitRemaining: 0, rateLimitReset: RESET }),
    ]);
    const wrapped = withRateLimitBackoff(transport, {
      now: () => NOW,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await wrapped(REQ);
    expect(delays).toEqual([90_000]);
  });
});

describe("withRateLimitBackoff — global per-sync budget (RFC 6a1a6518 A)", () => {
  it("@req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2 warn-defers instead of stalling every repo: the SHARED budget bounds the whole sync and later repos fail fast", async () => {
    // One shared budget across two 'repos' (two wrapped calls, budget NOT reset
    // between them — the engine resets once per syncAll). Retry-After = 60s.
    const budget = createRateLimitBudget(150_000); // room for exactly 2 waits
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    const wrap = (
      errors: Error[],
    ): { transport: RestCommitTransport; calls: () => number } => {
      const ft = failingTransport(errors);
      return {
        transport: withRateLimitBackoff(ft.transport, { budget, sleep }),
        calls: ft.calls,
      };
    };

    // Repo 1: keeps rate-limiting (never succeeds). maxRetries default is 6, but
    // the budget (2×60s) cuts it off after 2 waits → warn-defer (rethrow).
    // Revert-verify anchor: neutralize the `!budget.tryReserve(delay)` guard and
    // this sleeps 6 times (the full maxRetries) → the [60000,60000] assertion RED.
    const repo1 = wrap(
      Array.from({ length: 8 }, () => rl("rate limit", { retryAfterMs: 60_000 })),
    );
    await expect(repo1.transport(REQ)).rejects.toThrow(/HTTP 403/);
    expect(delays).toEqual([60_000, 60_000]); // budget cut it off at 2, NOT 6
    expect(repo1.calls()).toBe(3); // initial + 2 retries, then budget-defer

    // Repo 2: with the budget already spent, the FIRST rate-limit fails fast —
    // no wait — so one locked repo cannot make every later repo wait a window.
    const repo2 = wrap([rl("rate limit", { retryAfterMs: 60_000 })]);
    await expect(repo2.transport(REQ)).rejects.toThrow(/HTTP 403/);
    expect(delays).toEqual([60_000, 60_000]); // unchanged — repo 2 did NOT sleep
    expect(repo2.calls()).toBe(1); // fail-fast

    // Reset (as the engine does per syncAll) restores the full allowance: a
    // rate-limit is honored (one 60s wait) and the request then succeeds.
    budget.reset();
    const repo3 = wrap([rl("rate limit", { retryAfterMs: 60_000 })]);
    const ok = await repo3.transport(REQ);
    expect(ok.json).toEqual({ ok: true });
    expect(delays).toEqual([60_000, 60_000, 60_000]); // reset let it wait again
    expect(repo3.calls()).toBe(2); // initial (throttled) + retry (success)
  });
});

describe("withRateLimitBackoff — retry cap + pass-through", () => {
  it("defaults maxRetries to 6 (RFC 6a1a6518 A raised it from 3)", async () => {
    expect(DEFAULT_MAX_RETRIES).toBe(6);
    const { transport, calls } = failingTransport(
      Array.from({ length: 10 }, () => new Error(http(429, "still limited"))),
    );
    // No maxRetries, no budget → unbounded budget, default cap of 6.
    const wrapped = withRateLimitBackoff(transport, { sleep: async () => {} });
    await expect(wrapped(REQ)).rejects.toThrow(/HTTP 429/);
    expect(calls()).toBe(7); // initial + 6 retries
  });

  it("rethrows after an explicit retry cap", async () => {
    const { transport, calls } = failingTransport(
      Array(5).fill(0).map(() => new Error(http(429, "still limited"))),
    );
    const wrapped = withRateLimitBackoff(transport, {
      maxRetries: 2,
      sleep: async () => {},
    });

    await expect(wrapped(REQ)).rejects.toThrow(/HTTP 429/);
    expect(calls()).toBe(3); // initial + 2 retries
  });

  it("passes non-rate-limit errors through immediately (422, 404, 401)", async () => {
    for (const msg of [
      `GitHub request PATCH ${REQ.url} → HTTP 422: Update is not a fast forward`,
      http(404, "Not Found"),
      http(401, "Bad credentials"),
    ]) {
      const { transport, calls } = failingTransport([new Error(msg)]);
      const wrapped = withRateLimitBackoff(transport, {
        sleep: async () => {
          throw new Error("sleep must not be called");
        },
      });
      await expect(wrapped(REQ)).rejects.toThrow(msg.slice(-20));
      expect(calls()).toBe(1);
    }
  });
});
