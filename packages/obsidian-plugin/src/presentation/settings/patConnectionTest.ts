/**
 * Reusable PAT "Test connection" validate logic — RFC 0002.
 *
 * Verifying that a GitHub token actually reaches GitHub (before relying on it
 * for a private-repo pull) is needed in TWO places:
 *   - the Settings "GitHub PAT" section (`ExocortexSettingTab`), and
 *   - the first-run onboarding panel's PAT step (`FirstRunOnboardingModal`,
 *     cd9444bd / RFC 0002 §3.1).
 *
 * The verification is identical in both — construct a client, `GET /rate_limit`
 * (proves the token is *accepted*; `checkRateLimit` throws on HTTP 401), then
 * `GET /user/repos` (proves it can actually *see* repos — an authenticated
 * token with zero repo scopes still passes /rate_limit). So it lives here as a
 * SINGLE source: both surfaces reuse it rather than duplicating the GitHub API
 * call sequence.
 *
 * The orchestration takes a client **factory** instead of an `App`, so:
 *   - it has no Obsidian coupling (pure, unit-testable without an `obsidian`
 *     mock), and
 *   - tests inject a contract-shaped fake (resolve / throw paths mirroring the
 *     real client — test-fixture-realism) while production injects
 *     `(pat) => new GitHubRestClient({ pat, app })`.
 *
 * Desktop↔Mobile parity: the underlying `GitHubRestClient` is built on
 * Obsidian's `requestUrl()` (a REST call, not Node `fs`/git), so the connection
 * test runs identically on desktop and the mobile WebView.
 */

/**
 * The slice of `GitHubRestClient` the connection test exercises. Structural —
 * `GitHubRestClient` satisfies it without an explicit `implements`.
 */
export interface PatTestClient {
  /** GET /rate_limit → throws on a rejected token (HTTP 401) / network failure. */
  checkRateLimit(): Promise<{ remaining: number; resetAt: Date }>;
  /** GET /user/repos → `full_name[]`; `[]` when none visible; throws on failure. */
  listRepos(perPage?: number): Promise<string[]>;
}

/** The token was accepted by GitHub. */
export interface PatConnectionOk {
  readonly ok: true;
  /** Core API requests remaining for this token. */
  readonly remaining: number;
  /** When the core rate-limit window resets. */
  readonly resetAt: Date;
  /** A sample of repository `full_name`s the token can see (may be empty). */
  readonly repos: readonly string[];
  /**
   * Set when the token was accepted (/rate_limit ok) but listing repos failed.
   * The token is still valid; the repo-list signal is just unavailable.
   */
  readonly reposError?: string;
}

/** The token was rejected, the field was empty, or the client could not be built. */
export interface PatConnectionFailure {
  readonly ok: false;
  /**
   * Human-readable reason. Already PAT-redacted upstream (`GitHubRestClient`
   * routes every thrown message through `redact()`), so it is safe to display.
   */
  readonly reason: string;
}

export type PatConnectionResult = PatConnectionOk | PatConnectionFailure;

/** Extract a displayable message from an unknown thrown value. */
function reasonFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Verify a PAT against GitHub. Total — NEVER throws; an empty token, a rejected
 * token, a client-construction failure, or a network error all map to a
 * `{ ok: false }` result. `/user/repos` failing AFTER `/rate_limit` succeeded
 * is a *soft* failure (the token is valid) recorded in `reposError`.
 *
 * @param pat        Raw token value (trimmed here).
 * @param makeClient Factory the caller wires to the real client in production
 *                   and a fake in tests.
 */
export async function testPatConnection(
  pat: string,
  makeClient: (pat: string) => PatTestClient,
): Promise<PatConnectionResult> {
  const trimmed = pat.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "No token entered — paste a token first." };
  }

  let client: PatTestClient;
  let rate: { remaining: number; resetAt: Date };
  try {
    // makeClient is inside the try so a synchronous ctor throw (e.g. a missing
    // App) becomes a failure result rather than a leaked exception.
    client = makeClient(trimmed);
    rate = await client.checkRateLimit();
  } catch (error) {
    return { ok: false, reason: reasonFrom(error) };
  }

  // /rate_limit succeeded → the token is accepted. Listing repos is a softer,
  // best-effort signal; its failure does not invalidate the token.
  let repos: string[] = [];
  let reposError: string | undefined;
  try {
    repos = await client.listRepos(5);
  } catch (error) {
    reposError = reasonFrom(error);
  }

  return { ok: true, remaining: rate.remaining, resetAt: rate.resetAt, repos, reposError };
}

/**
 * Render a `PatConnectionResult` as a one-line human message — the SINGLE source
 * of the wording shown by both the Settings notice and the onboarding panel's
 * inline status (no copy drift between surfaces).
 */
export function describePatConnection(result: PatConnectionResult): string {
  if (!result.ok) {
    return `Test connection failed: ${result.reason}`;
  }
  const reposNote = result.reposError
    ? `; listRepos failed: ${result.reposError}`
    : result.repos.length === 0
      ? "; no repos visible to this PAT"
      : `; sample: ${result.repos.slice(0, 5).join(", ")}`;
  return (
    `GitHub OK — ${result.remaining} requests remaining` +
    `, resets ${result.resetAt.toISOString()}${reposNote}`
  );
}
