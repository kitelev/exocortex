/**
 * ExoSync credential contract (RFC 4e4dc453 VL#10 + R8, A3).
 *
 * The PAT lives in per-device secure storage and is NEVER committed:
 *
 *  - Obsidian plugin: `LocalSecretsStore` (key `"pat"`,
 *    `.obsidian/plugins/exocortex/data.local.json` — the `.local.` infix is
 *    Obsidian-Sync-excluded by convention).
 *  - CLI / desktop: `gh auth token` (GitHub CLI's OS-keychain-backed
 *    storage; see `RestPushService.resolveToken`).
 *
 * Both already satisfy this port shape; the formal adapter classes land
 * with the Phase B wiring that actually composes a SyncEngine. A3 ships
 * the contract + the auth-failure detector the engine uses for the R8
 * "update your PAT" signal (`auth-required` status — never treated as
 * success).
 */

/** Per-device secure credential storage (VL#10). */
import { SYNC_BRANCH } from "./spaceSpecCore";

export interface CredentialStorePort {
  /** Resolve the PAT, or null when none is stored (→ prompt, R8). */
  getToken(): Promise<string | null>;
  /** Store a new PAT; null/empty clears the stored value. */
  setToken(token: string | null): Promise<void>;
}

/**
 * Auth-failure detection over the transport error-message contract
 * (`GitHub request {METHOD} {url} → HTTP {status}: {body}`): HTTP 401, or
 * HTTP 403 WITHOUT rate-limit markers (403 + "rate limit"/"abuse
 * detection" is throttling, not auth — see `isRateLimitError`).
 *
 * KNOWN BLIND SPOT: a fine-grained PAT whose repository allowlist omits the
 * repo gets **404** from GitHub on private-repo refs (existence-hiding),
 * indistinguishable from repo-not-found — so it is NOT `auth-required`.
 * `SyncEngine` / `ParityValidator` recognise that head-ref 404
 * (`isRefNotFoundError`, #4236) and report `error` with
 * {@link REF_NOT_FOUND_HINT}; documented in user-facing troubleshooting (R8).
 */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 401/.test(msg)) return true;
  return (
    /HTTP 403/.test(msg) &&
    !/rate limit/i.test(msg) &&
    !/abuse detection/i.test(msg)
  );
}

/**
 * #4236 — HTTP 404 on the head-ref lookup (`git/refs/heads/{branch}`) over
 * the transport error-message contract. GitHub answers this byte-identically
 * for THREE situations the engine cannot tell apart: a private repo outside a
 * fine-grained PAT's repository allowlist (existence-hiding), a deleted /
 * renamed repo, and a visible repo that simply has no branch of that name
 * (ExoSync syncs `main` only — a repo created with `master` lands here).
 * Consumers append {@link REF_NOT_FOUND_HINT} so the user checks the token
 * BEFORE touching anything. Anchored on the contract's `→ HTTP` so a status
 * literal inside a response body cannot match.
 */
export function isRefNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\/git\/refs\/heads\/\S* → HTTP 404\b/.test(msg);
}

/**
 * #4236 — the hint appended to a head-ref 404 (single source of wording).
 * The branch name is DERIVED from `SYNC_BRANCH` (the one place every
 * `SyncRepoSpec` gets its branch, `spaceSpecCore.ts`) so the hint can never
 * drift from what the engine actually syncs.
 */
export const REF_NOT_FOUND_HINT =
  "GitHub answers 404 for a private repo outside a fine-grained PAT's " +
  "repository allowlist (existence-hiding), for a deleted/renamed repo, and " +
  `for a visible repo that has no \`${SYNC_BRANCH}\` branch (ExoSync syncs ` +
  `\`${SYNC_BRANCH}\` only) — check the token's repository allowlist first (R8)`;
