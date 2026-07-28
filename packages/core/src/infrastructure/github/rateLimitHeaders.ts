/**
 * GitHub rate-limit header extraction + error enrichment (ExoSync A, RFC
 * 6a1a6518 Phase 1).
 *
 * The transport-agnostic `restCreateCommit` core only ever observes SUCCESS
 * responses — both transports (CLI `fetch`, plugin Obsidian `requestUrl`)
 * throw on a non-2xx status and discard the Response, so the `Retry-After` /
 * `x-ratelimit-*` headers GitHub sends on a rate-limited response are lost by
 * the time `withRateLimitBackoff` catches the error. This helper lets BOTH
 * transports read those headers just before they throw and ATTACH the parsed
 * values as own-properties on the thrown Error — the backoff then honors the
 * exact `Retry-After` instead of blindly guessing an exponential.
 *
 * ⛔ CRITICAL — attach, never replace. Three parsers key off `Error.message`
 * (`isRateLimitError`, `isAuthError`, `isNonFastForwardError`); enrichment
 * MUST leave `.message` byte-for-byte identical so they classify the enriched
 * error exactly as they would the bare one. The attached fields are therefore
 * NON-ENUMERABLE own-properties — invisible to `JSON.stringify` / `Object.keys`
 * / telemetry walkers (matching the codebase's `#private`-field discipline),
 * readable only by explicit property access (the backoff decorator).
 *
 * Header casing: desktop `fetch` exposes a `Headers` object whose `.get()` is
 * case-insensitive; Obsidian `requestUrl().headers` is a plain
 * `Record<string, string>` whose casing varies by platform (desktop vs iOS).
 * {@link caseInsensitiveHeaderGetter} normalizes the plain-record path so both
 * `Retry-After` and `retry-after` resolve on the plugin transport (iOS parity).
 */

/**
 * Own-properties attached to a rate-limited transport Error (ExoSync A).
 * All optional — absent when GitHub did not send the corresponding header.
 */
export interface RateLimitErrorFields {
  /** Milliseconds to wait, parsed from the `Retry-After` header. */
  retryAfterMs?: number;
  /** `x-ratelimit-reset` — Unix epoch SECONDS the primary bucket refills. */
  rateLimitReset?: number;
  /** `x-ratelimit-remaining` — primary-bucket requests remaining. */
  rateLimitRemaining?: number;
}

/** Case-insensitive-capable header accessor (`fetch` `Headers.get` already is). */
export type HeaderGetter = (name: string) => string | null | undefined;

/**
 * Build a case-insensitive getter over an arbitrary-casing header record
 * (Obsidian `requestUrl().headers`). Tolerates an absent/undefined record.
 */
export function caseInsensitiveHeaderGetter(
  headers: Record<string, string> | undefined | null,
): HeaderGetter {
  const lower = new Map<string, string>();
  if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === "string") lower.set(k.toLowerCase(), v);
    }
  }
  return (name: string): string | undefined => lower.get(name.toLowerCase());
}

/** Parse a strict base-10 integer header value; `undefined` when unparseable. */
function parseIntHeader(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const t = v.trim();
  if (!/^-?\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse `Retry-After` → milliseconds. Per the HTTP spec the value is either
 * delta-seconds (GitHub's form for rate limits) OR an HTTP-date; both are
 * handled. Returns `undefined` when absent/unparseable. Never negative.
 */
export function parseRetryAfterMs(
  v: string | null | undefined,
  now: () => number = Date.now,
): number | undefined {
  if (v === null || v === undefined) return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  const secs = parseIntHeader(t);
  if (secs !== undefined) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(t);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - now());
  return undefined;
}

/** Extract the rate-limit fields from a header getter. */
export function extractRateLimitFields(
  get: HeaderGetter,
  now: () => number = Date.now,
): RateLimitErrorFields {
  const fields: RateLimitErrorFields = {};
  const retryAfterMs = parseRetryAfterMs(get("retry-after"), now);
  if (retryAfterMs !== undefined) fields.retryAfterMs = retryAfterMs;
  const reset = parseIntHeader(get("x-ratelimit-reset"));
  if (reset !== undefined) fields.rateLimitReset = reset;
  const remaining = parseIntHeader(get("x-ratelimit-remaining"));
  if (remaining !== undefined) fields.rateLimitRemaining = remaining;
  return fields;
}

/** Read the attached rate-limit fields off an already-enriched error. */
export function getRateLimitFields(err: unknown): RateLimitErrorFields {
  if (err === null || typeof err !== "object") return {};
  const e = err as RateLimitErrorFields;
  const fields: RateLimitErrorFields = {};
  if (typeof e.retryAfterMs === "number") fields.retryAfterMs = e.retryAfterMs;
  if (typeof e.rateLimitReset === "number")
    fields.rateLimitReset = e.rateLimitReset;
  if (typeof e.rateLimitRemaining === "number")
    fields.rateLimitRemaining = e.rateLimitRemaining;
  return fields;
}

function defineHidden(target: object, key: string, value: number): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: false, // invisible to JSON.stringify / Object.keys / telemetry
    writable: true,
    configurable: true,
  });
}

/**
 * ATTACH the rate-limit fields as NON-ENUMERABLE own-properties, preserving
 * `Error.message` byte-for-byte. Returns the same Error instance. No-op for a
 * non-object err.
 */
export function attachRateLimitFields(
  err: Error,
  fields: RateLimitErrorFields,
): Error {
  if (fields.retryAfterMs !== undefined)
    defineHidden(err, "retryAfterMs", fields.retryAfterMs);
  if (fields.rateLimitReset !== undefined)
    defineHidden(err, "rateLimitReset", fields.rateLimitReset);
  if (fields.rateLimitRemaining !== undefined)
    defineHidden(err, "rateLimitRemaining", fields.rateLimitRemaining);
  return err;
}

/**
 * One-call transport helper: read the rate-limit headers via `get` and attach
 * the parsed fields to `err` (preserving `.message`). Called by each transport
 * immediately before throwing a non-2xx error.
 */
export function enrichRateLimitError(
  err: Error,
  get: HeaderGetter,
  now: () => number = Date.now,
): Error {
  return attachRateLimitFields(err, extractRateLimitFields(get, now));
}
