/**
 * CLI REST commit+push service (experimental, RFC 01a83de8 Phase 0 PoC).
 *
 * Proves commit+push to a GitHub repo works WITHOUT the `git` binary — pure
 * GitHub Git Data API over Node `fetch`. The 4-call orchestration lives in the
 * shared transport-agnostic `restCreateCommit` core (`exocortex` package); this
 * service only supplies the `fetch`-backed transport + PAT redaction + `gh
 * auth token` resolution. The Obsidian plugin reuses the SAME core over a
 * `requestUrl` transport (`GitHubRestClient.createCommit`) — single
 * implementation, two platforms (iOS-portable path, de-risks RFC Phase 3).
 *
 * Security parity with plugin GitHubRestClient / BootstrapAssetSpaceService:
 *  - PAT redaction on every error string (classic + fine-grained tokens).
 *  - Token never logged; Authorization header attached only when present.
 *  - 60s fetch timeout (no indefinite hang on stalled GitHub response).
 */

import { execFileSync } from "node:child_process";
import {
  restCreateCommit,
  enrichRateLimitError,
  type RestCommitTransport,
  type RestCommitResponse,
  type HeaderGetter,
} from "@kitelev/exocortex-core";

export interface RestPushServiceOptions {
  /** GitHub PAT. Empty/undefined → unauthenticated (push WILL fail — auth required). */
  token?: string;
  /** Override fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override GitHub API base. Defaults to https://api.github.com. */
  apiBase?: string;
}

/** Injectable runner for `gh auth token` (tests stub this). */
export type GhTokenRunner = () => string;

const FETCH_TIMEOUT_MS = 60_000;

export class RestPushService {
  // Mirrors plugin GitHubRestClient.PAT_REGEX + BootstrapAssetSpaceService.
  // Classic family (ghp_/gho_/ghu_/ghs_/ghr_, 36+ urlsafe) + fine-grained
  // github_pat_<22+ id>_<59+ secret>. Redacts tokens leaked into error text.
  private static readonly PAT_REGEX =
    /(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,})/g;

  private readonly fetchImpl: typeof fetch;
  private readonly token: string;
  private readonly apiBase: string;

  constructor(opts: RestPushServiceOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.token = opts.token ?? "";
    this.apiBase = (opts.apiBase ?? "https://api.github.com").replace(
      /\/$/,
      "",
    );
  }

  /**
   * Resolve a PAT via `gh auth token`. Injectable runner for tests. Trims
   * trailing newline. Throws a redacted, actionable error if `gh` is missing
   * or unauthenticated.
   */
  static resolveGhToken(runner?: GhTokenRunner): string {
    const run: GhTokenRunner =
      runner ??
      ((): string =>
        execFileSync("gh", ["auth", "token"], {
          encoding: "utf8",
          timeout: 15_000,
        }));
    let raw: string;
    try {
      raw = run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `RestPushService: \`gh auth token\` failed — is GitHub CLI installed and authenticated? (run \`gh auth login\`). Underlying: ${msg}`.replace(
          RestPushService.PAT_REGEX,
          "***REDACTED***",
        ),
      );
    }
    const token = raw.trim();
    if (token.length === 0) {
      throw new Error(
        "RestPushService: `gh auth token` returned empty output — not authenticated. Run `gh auth login`.",
      );
    }
    return token;
  }

  /** Replace any PAT-shaped substring with ***REDACTED***. Idempotent. */
  redact(message: unknown): string {
    const s = typeof message === "string" ? message : String(message);
    return s.replace(RestPushService.PAT_REGEX, "***REDACTED***");
  }

  /**
   * Commit+push the given files to `owner/repo@branch` via the shared 4-call
   * REST core. Returns the new commit SHA.
   */
  async push(
    owner: string,
    repo: string,
    branch: string,
    files: Map<string, string>,
    message: string,
  ): Promise<string> {
    return restCreateCommit(this.buildTransport(), {
      owner,
      repo,
      branch,
      files,
      message,
      baseURL: this.apiBase,
      redact: (m) => this.redact(m),
    });
  }

  /**
   * The `fetch`-backed transport, exposed for read-side consumers (ExoSync
   * E1 `exosync-parity` reuses the SAME transport contract the write
   * primitive ships with — error shape `GitHub request {METHOD} {url} →
   * HTTP {status}: {body}` is what `isAuthError` keys off). Mirrors the
   * plugin's `GitHubRestClient.restTransport()`.
   */
  transport(): RestCommitTransport {
    return this.buildTransport();
  }

  /**
   * Build a `fetch`-backed transport with plugin-parity semantics: throws on
   * any non-2xx status (the core's transport contract), redacts PATs in all
   * error strings, returns `{ status, json, text }`.
   */
  private buildTransport(): RestCommitTransport {
    const token = this.token;
    const fetchImpl = this.fetchImpl;
    const redact = (m: string): string => this.redact(m);
    return async (req): Promise<RestCommitResponse> => {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "exocortex-cli",
      };
      if (token.length > 0) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (req.contentType) {
        headers["Content-Type"] = req.contentType;
      }
      let resp: Awaited<ReturnType<typeof fetch>>;
      try {
        resp = await fetchImpl(req.url, {
          method: req.method,
          headers,
          body: req.body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch (err) {
        throw new Error(redact(`GitHub request failed: ${errMsg(err)}`));
      }
      const text = await resp.text().catch(() => "");
      if (resp.status < 200 || resp.status >= 300) {
        // RFC 6a1a6518 A: attach Retry-After / x-ratelimit-* (own-props,
        // .message preserved) so the backoff can honor the exact wait. `fetch`
        // `Headers.get()` is already case-insensitive; tolerate a headerless
        // response (some test fakes omit it).
        const get: HeaderGetter = (name) => resp.headers?.get?.(name) ?? undefined;
        throw enrichRateLimitError(
          new Error(
            truncate(
              redact(
                `GitHub request ${req.method} ${req.url} → HTTP ${resp.status}: ${text}`,
              ),
              512,
            ),
          ),
          get,
        );
      }
      let json: unknown;
      try {
        json = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: resp.status, json, text };
    };
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}
