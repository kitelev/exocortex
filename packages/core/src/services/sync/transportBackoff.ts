/**
 * ExoSync rate-limit backoff (RFC 4e4dc453 A3 baseline R6; RFC 6a1a6518 A —
 * honor Retry-After).
 *
 * Transport decorator: retries a request that failed on a GitHub rate-limit
 * signal. Everything else (404, 401/403 auth, 422 non-fast-forward — the D16
 * loop's job) is rethrown immediately, so the decorator never masks the
 * engine's own error handling.
 *
 * Retry-After (RFC 6a1a6518 A): the transports now ATTACH the rate-limit
 * response headers to the thrown Error as own-properties (`retryAfterMs` /
 * `rateLimitReset` / `rateLimitRemaining`, see `rateLimitHeaders.ts`),
 * preserving `.message` byte-for-byte. This decorator reads `retryAfterMs` and
 * sleeps EXACTLY that; when it is absent it waits at least 60s (the documented
 * secondary-limit fallback) then exponential; when the primary bucket is
 * exhausted (`rateLimitRemaining === 0` with a `rateLimitReset`) it waits until
 * reset. Retrying failed POSTs is safe: a 403/429 response means nothing was
 * created server-side.
 *
 * A GLOBAL per-sync time-budget (see `RateLimitBudget`) bounds the TOTAL wait a
 * single top-level sync may spend here across ALL repos + requests — `syncAll`
 * is a strictly-sequential single-flight, so without a shared cap one locked
 * repo could stall the whole run for `maxRetries × Retry-After`. When the
 * budget can't cover the next wait, the decorator rethrows the rate-limit error
 * (warn-not-block, D12) instead of sleeping again; the engine resets the budget
 * at the start of each sync.
 *
 * Sleep, random, and now are injected for deterministic tests; per-call retry
 * state means failures in one repo's cycle never delay another repo (per-repo
 * backoff semantics), while the shared budget bounds the run as a whole.
 */

import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
} from "../../infrastructure/github/restCommit";
import { getRateLimitFields } from "../../infrastructure/github/rateLimitHeaders";

/**
 * GitHub rate-limit detection over the transport error-message contract
 * (`GitHub request {METHOD} {url} → HTTP {status}: {body}`): HTTP 429, or
 * HTTP 403 whose body mentions rate limiting / abuse detection (GitHub's
 * secondary limit historically used "abuse detection mechanism" wording
 * without the words "rate limit"). A plain 403 without those markers is an
 * auth problem, not a rate limit — see `isAuthError`.
 */
export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 429/.test(msg)) return true;
  return (
    /HTTP 403/.test(msg) &&
    (/rate limit/i.test(msg) || /abuse detection/i.test(msg))
  );
}

/**
 * Absent-`Retry-After` fallback floor (RFC 6a1a6518 A): GitHub's own secondary
 * rate-limit guidance is "wait at least one minute before retrying" when there
 * is no `Retry-After`. Never go below this.
 */
export const MIN_RATE_LIMIT_WAIT_MS = 60_000;

/**
 * Default retry cap AFTER the first rate-limited failure. RFC 6a1a6518 A raises
 * this from 3 to 6 — a minutes-long secondary window needs several full waits;
 * the global {@link RateLimitBudget} bounds the aggregate so this cap can be
 * generous without a single locked repo stalling the whole run.
 */
export const DEFAULT_MAX_RETRIES = 6;

/**
 * Global per-sync rate-limit wait budget (RFC 6a1a6518 A). The engine OWNS one
 * instance, passes it into the (per-request) backoff decorator, and resets it
 * at the start of each top-level `syncAll`/`sync`. When a wait can't be
 * reserved the decorator rethrows → warn-defer (never a hard block).
 */
export interface RateLimitBudget {
  /** Restore the remaining allowance to the full per-sync total. */
  reset(): void;
  /**
   * Reserve `ms` of rate-limit wait. Returns `true` (and consumes it) when the
   * FULL `ms` fits in the remaining allowance; `false` when it would overrun —
   * the caller must then stop waiting (warn-defer). A partial reservation is
   * never granted: sleeping less than `Retry-After` just re-hits the limit.
   */
  tryReserve(ms: number): boolean;
}

/** In-memory {@link RateLimitBudget}. `totalMs <= 0` ⇒ effectively unbounded. */
export function createRateLimitBudget(totalMs: number): RateLimitBudget {
  const unbounded = !(totalMs > 0);
  let remaining = unbounded ? Number.POSITIVE_INFINITY : totalMs;
  return {
    reset(): void {
      remaining = unbounded ? Number.POSITIVE_INFINITY : totalMs;
    },
    tryReserve(ms: number): boolean {
      if (ms <= 0) return true;
      if (ms <= remaining) {
        remaining -= ms;
        return true;
      }
      return false;
    },
  };
}

export interface BackoffOptions {
  /** Retries AFTER the first rate-limited failure. Default {@link DEFAULT_MAX_RETRIES} (6). */
  maxRetries?: number;
  /** First delay for the absent-header exponential; doubles each retry. Default 1000 ms. */
  baseDelayMs?: number;
  /** Absent-`Retry-After` floor. Clamped up to {@link MIN_RATE_LIMIT_WAIT_MS} (≥60s). */
  minRateLimitWaitMs?: number;
  /**
   * Global per-sync wait budget instance (RFC 6a1a6518 A). Absent ⇒ unbounded
   * (historical behaviour). The engine builds this from
   * {@link maxTotalRateLimitWaitMs} and resets it per sync.
   */
  budget?: RateLimitBudget;
  /**
   * Per-sync total rate-limit wait cap (ms) the ENGINE reads to construct its
   * {@link RateLimitBudget}. The decorator itself uses {@link budget}, not this
   * value. Kept here so all backoff tuning lives in one options object.
   */
  maxTotalRateLimitWaitMs?: number;
  /** Injected for tests. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests. Defaults to Math.random — jitter source. */
  random?: () => number;
  /** Injected for tests — clock for the `x-ratelimit-reset` branch. Default Date.now. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Compute how long to wait before the next rate-limit retry, honoring GitHub's
 * documented secondary-limit guidance:
 *   1. `Retry-After` present → wait EXACTLY that (no jitter guess).
 *   2. else primary bucket exhausted (`rateLimitRemaining === 0` + a future
 *      `rateLimitReset`) → wait until reset.
 *   3. else → at least `minWaitMs` (≥60s), then exponential-with-jitter.
 */
function computeRateLimitDelay(
  err: unknown,
  attempt: number,
  baseDelayMs: number,
  minWaitMs: number,
  random: () => number,
  now: () => number,
): number {
  const f = getRateLimitFields(err);
  // 1. Explicit Retry-After — honor exactly.
  if (typeof f.retryAfterMs === "number" && f.retryAfterMs >= 0) {
    return f.retryAfterMs;
  }
  // 2. Primary bucket exhausted → wait until reset (epoch seconds → ms).
  if (f.rateLimitRemaining === 0 && typeof f.rateLimitReset === "number") {
    const untilReset = f.rateLimitReset * 1000 - now();
    if (untilReset > 0) return untilReset;
    // reset already passed → fall through to the floor+exponential fallback
  }
  // 3. Absent header — ≥60s floor, then exponential with jitter.
  const exp = baseDelayMs * 2 ** attempt * (1 + random());
  return Math.max(minWaitMs, exp);
}

/**
 * Wrap a transport with rate-limit backoff. After `maxRetries` rate-limited
 * attempts (or when the global budget can't cover the next wait) the last error
 * is rethrown — the per-repo sync cycle then fails warn-not-block (D12).
 */
export function withRateLimitBackoff(
  transport: RestCommitTransport,
  options: BackoffOptions = {},
): RestCommitTransport {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const minWaitMs = Math.max(
    MIN_RATE_LIMIT_WAIT_MS,
    options.minRateLimitWaitMs ?? MIN_RATE_LIMIT_WAIT_MS,
  );
  const budget = options.budget;
  const sleep = options.sleep ?? defaultSleep;
  // SECURITY CONTEXT: jitter source for retry timing only — deliberately
  // not cryptographically secure (no IDs/tokens are derived from it).
  const random = options.random ?? Math.random;
  const now = options.now ?? ((): number => Date.now());

  return async (req: RestCommitRequest): Promise<RestCommitResponse> => {
    let attempt = 0;
    for (;;) {
      try {
        return await transport(req);
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
        const delay = computeRateLimitDelay(
          err,
          attempt,
          baseDelayMs,
          minWaitMs,
          random,
          now,
        );
        // Global per-sync budget: if this wait would overrun the total the
        // sync may spend on rate limits, stop retrying (warn-defer) rather
        // than let one locked repo stall the whole sequential run.
        if (budget !== undefined && !budget.tryReserve(delay)) throw err;
        attempt++;
        await sleep(delay);
      }
    }
  };
}
