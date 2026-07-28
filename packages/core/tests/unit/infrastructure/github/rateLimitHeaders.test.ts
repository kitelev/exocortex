/**
 * ExoSync A (RFC 6a1a6518) — GitHub rate-limit header extraction + error
 * enrichment. Covers the ⛔ data-loss constraint: enrichment ATTACHES fields
 * and preserves `.message` byte-for-byte, so the three string-matching parsers
 * (`isRateLimitError` / `isAuthError` / `isNonFastForwardError`) classify the
 * enriched error IDENTICALLY to the bare one.
 *
 * @req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2
 */

import {
  caseInsensitiveHeaderGetter,
  parseRetryAfterMs,
  extractRateLimitFields,
  getRateLimitFields,
  attachRateLimitFields,
  enrichRateLimitError,
  isRateLimitError,
  isAuthError,
  isNonFastForwardError,
  type HeaderGetter,
} from "../../../../src";

const REQ_URL = "https://api.github.com/repos/o/r/git/trees";
const http = (status: number, body: string, method = "POST"): string =>
  `GitHub request ${method} ${REQ_URL} → HTTP ${status}: ${body}`;

describe("caseInsensitiveHeaderGetter", () => {
  it("resolves any casing (iOS Obsidian requestUrl Record parity)", () => {
    const get = caseInsensitiveHeaderGetter({
      "Retry-After": "120",
      "X-RateLimit-Reset": "1700000000",
    });
    expect(get("retry-after")).toBe("120");
    expect(get("Retry-After")).toBe("120");
    expect(get("RETRY-AFTER")).toBe("120");
    expect(get("x-ratelimit-reset")).toBe("1700000000");
    expect(get("missing")).toBeUndefined();
  });

  it("tolerates an absent/undefined header record", () => {
    expect(caseInsensitiveHeaderGetter(undefined)("retry-after")).toBeUndefined();
    expect(caseInsensitiveHeaderGetter(null)("retry-after")).toBeUndefined();
    expect(caseInsensitiveHeaderGetter({})("retry-after")).toBeUndefined();
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds → milliseconds (GitHub's rate-limit form)", () => {
    expect(parseRetryAfterMs("120")).toBe(120_000);
    expect(parseRetryAfterMs("  60 ")).toBe(60_000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses an HTTP-date relative to `now`", () => {
    const now = () => Date.parse("2026-01-01T00:00:00Z");
    expect(
      parseRetryAfterMs("Thu, 01 Jan 2026 00:02:00 GMT", now),
    ).toBe(120_000);
    // a past date clamps to 0 (never negative)
    expect(parseRetryAfterMs("Thu, 01 Jan 2020 00:00:00 GMT", now)).toBe(0);
  });

  it("returns undefined for absent / garbage", () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("")).toBeUndefined();
    expect(parseRetryAfterMs("soon")).toBeUndefined();
  });
});

describe("extractRateLimitFields", () => {
  it("pulls Retry-After / x-ratelimit-reset / x-ratelimit-remaining", () => {
    const get: HeaderGetter = (n) =>
      ({
        "retry-after": "90",
        "x-ratelimit-reset": "1700000000",
        "x-ratelimit-remaining": "0",
      })[n.toLowerCase()];
    expect(extractRateLimitFields(get)).toEqual({
      retryAfterMs: 90_000,
      rateLimitReset: 1700000000,
      rateLimitRemaining: 0,
    });
  });

  it("omits absent fields", () => {
    expect(extractRateLimitFields(() => undefined)).toEqual({});
  });
});

describe("attachRateLimitFields / getRateLimitFields — non-enumerable own-props", () => {
  it("attaches as NON-enumerable (invisible to JSON.stringify / Object.keys)", () => {
    const err = attachRateLimitFields(new Error("boom"), {
      retryAfterMs: 120_000,
      rateLimitReset: 42,
    });
    expect(getRateLimitFields(err)).toEqual({
      retryAfterMs: 120_000,
      rateLimitReset: 42,
    });
    // Read back directly.
    expect((err as { retryAfterMs?: number }).retryAfterMs).toBe(120_000);
    // Invisible to serialization / enumeration.
    expect(Object.keys(err)).not.toContain("retryAfterMs");
    expect(JSON.stringify(err)).toBe("{}");
  });

  it("getRateLimitFields returns {} for a bare error / non-object", () => {
    expect(getRateLimitFields(new Error("x"))).toEqual({});
    expect(getRateLimitFields("str")).toEqual({});
    expect(getRateLimitFields(null)).toEqual({});
  });
});

describe("enrichRateLimitError — ⛔ .message preserved, parsers classify identically", () => {
  const withHeaders = (headers: Record<string, string>): HeaderGetter =>
    caseInsensitiveHeaderGetter(headers);

  it("attaches retryAfterMs while keeping .message BYTE-FOR-BYTE identical", () => {
    const msg = http(403, "You have exceeded a secondary rate limit");
    const bare = new Error(msg);
    const enriched = enrichRateLimitError(new Error(msg), withHeaders({ "Retry-After": "120" }));

    // .message is untouched (attach, never replace) — the CRITICAL invariant.
    expect(enriched.message).toBe(bare.message);
    expect(enriched.message).toBe(msg);
    // The field is available for the backoff.
    expect(getRateLimitFields(enriched).retryAfterMs).toBe(120_000);
  });

  // Revert-verify anchor: if enrichment ever MUTATED/replaced `.message`, the
  // 422 case below would stop being isNonFastForwardError (→ contended push
  // bypasses quarantine → silent data loss) and the plain-403 case would stop
  // being isAuthError. These identity checks pin that it does not.
  it("@req:0fd4c819-0a48-43e5-9e4b-2a1cc3eef1c2 the three parsers classify the enriched error identically to the bare error", () => {
    const cases: Array<{ msg: string; rate: boolean; auth: boolean; nff: boolean }> = [
      { msg: http(429, "too many requests"), rate: true, auth: false, nff: false },
      { msg: http(403, "API rate limit exceeded"), rate: true, auth: false, nff: false },
      { msg: http(403, "You have triggered an abuse detection mechanism"), rate: true, auth: false, nff: false },
      { msg: http(403, "Forbidden"), rate: false, auth: true, nff: false },
      { msg: http(401, "Bad credentials", "GET"), rate: false, auth: true, nff: false },
      { msg: `GitHub request PATCH ${REQ_URL.replace("/trees", "/refs/heads/main")} → HTTP 422: Update is not a fast forward`, rate: false, auth: false, nff: true },
    ];
    // Enrich with a full rate-limit header set (worst case for byte-preservation).
    const get = withHeaders({
      "Retry-After": "60",
      "X-RateLimit-Reset": "1700000000",
      "X-RateLimit-Remaining": "0",
    });
    for (const c of cases) {
      const bare = new Error(c.msg);
      const enriched = enrichRateLimitError(new Error(c.msg), get);

      expect(enriched.message).toBe(bare.message); // byte-for-byte

      // Each parser: same verdict for bare and enriched (identity).
      expect(isRateLimitError(enriched)).toBe(isRateLimitError(bare));
      expect(isAuthError(enriched)).toBe(isAuthError(bare));
      expect(isNonFastForwardError(enriched)).toBe(isNonFastForwardError(bare));

      // …and that verdict matches the expected classification.
      expect(isRateLimitError(enriched)).toBe(c.rate);
      expect(isAuthError(enriched)).toBe(c.auth);
      expect(isNonFastForwardError(enriched)).toBe(c.nff);
    }
  });
});
