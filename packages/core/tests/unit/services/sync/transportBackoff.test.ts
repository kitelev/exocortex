/** ExoSync A3 — rate-limit backoff transport decorator (R6). */

import {
  isAuthError,
  isRateLimitError,
  withRateLimitBackoff,
  type RestCommitRequest,
  type RestCommitTransport,
} from "../../../../src";

const REQ: RestCommitRequest = {
  method: "GET",
  url: "https://api.github.com/repos/o/r/git/refs/heads/main",
};

function failingTransport(
  errors: string[],
  finalJson: unknown = { ok: true },
): { transport: RestCommitTransport; calls: () => number } {
  let n = 0;
  return {
    transport: async () => {
      n++;
      const err = errors.shift();
      if (err !== undefined) throw new Error(err);
      return { status: 200, json: finalJson };
    },
    calls: () => n,
  };
}

const http = (status: number, body: string): string =>
  `GitHub request GET ${REQ.url} → HTTP ${status}: ${body}`;

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

describe("withRateLimitBackoff", () => {
  it("retries rate-limited requests with exponential delays + jitter", async () => {
    const delays: number[] = [];
    const { transport, calls } = failingTransport([
      http(403, "API rate limit exceeded"),
      http(429, "slow down"),
    ]);
    const wrapped = withRateLimitBackoff(transport, {
      baseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    });

    const resp = await wrapped(REQ);

    expect(resp.json).toEqual({ ok: true });
    expect(calls()).toBe(3);
    expect(delays).toEqual([150, 300]); // 100*2^0*1.5, 100*2^1*1.5
  });

  it("rethrows after the retry cap", async () => {
    const { transport, calls } = failingTransport(
      Array(5).fill(http(429, "still limited")),
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
      const { transport, calls } = failingTransport([msg]);
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
