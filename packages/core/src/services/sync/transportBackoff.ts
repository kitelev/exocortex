/**
 * ExoSync rate-limit backoff (RFC 4e4dc453 A3 engineering baseline, R6).
 *
 * Transport decorator: retries a request that failed on a GitHub
 * rate-limit signal with bounded exponential backoff + jitter. Everything
 * else (404, 401/403 auth, 422 non-fast-forward — the D16 loop's job)
 * is rethrown immediately, so the decorator never masks the engine's own
 * error handling.
 *
 * `Retry-After` is unrecoverable through the thrown-Error transport
 * contract (response headers are lost) — jittered exponential is the
 * deliberate fallback. Retrying failed POSTs is safe: a 403/429 response
 * means nothing was created server-side.
 *
 * Sleep and random are injected for deterministic tests; per-call retry
 * state means failures in one repo's cycle never delay another repo
 * (per-repo backoff semantics).
 */

import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
} from "../../infrastructure/github/restCommit";

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

export interface BackoffOptions {
  /** Retries AFTER the first rate-limited failure. Default 3. */
  maxRetries?: number;
  /** First delay; doubles each retry. Default 1000 ms. */
  baseDelayMs?: number;
  /** Injected for tests. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests. Defaults to Math.random — jitter source. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a transport with per-request exponential backoff on rate-limit
 * errors. After `maxRetries` rate-limited attempts the last error is
 * rethrown — the per-repo sync cycle then fails warn-not-block (D12).
 */
export function withRateLimitBackoff(
  transport: RestCommitTransport,
  options: BackoffOptions = {},
): RestCommitTransport {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;
  // SECURITY CONTEXT: jitter source for retry timing only — deliberately
  // not cryptographically secure (no IDs/tokens are derived from it).
  const random = options.random ?? Math.random;

  return async (req: RestCommitRequest): Promise<RestCommitResponse> => {
    let attempt = 0;
    for (;;) {
      try {
        return await transport(req);
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
        const delay = baseDelayMs * 2 ** attempt * (1 + random());
        attempt++;
        await sleep(delay);
      }
    }
  };
}
