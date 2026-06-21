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
 * KNOWN BLIND SPOT: a fine-grained / under-scoped PAT gets **404** from
 * GitHub on private-repo refs (existence-hiding), indistinguishable from
 * repo-not-found — that misconfiguration surfaces as a generic error, not
 * `auth-required`. Document in user-facing troubleshooting (R8).
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
