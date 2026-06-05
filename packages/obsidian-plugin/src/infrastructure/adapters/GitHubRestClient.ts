import type { App, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import { parseTarGzip } from "nanotar";
import type { TarFileItem } from "nanotar";
import { restCreateCommit, type RestCommitTransport } from "exocortex";

export interface GitHubRestClientOptions {
  pat: string;
  app: App;
  baseURL?: string;
  /**
   * Maximum tarball arrayBuffer size (bytes) accepted by `pullTarball()`.
   * Default: 50 MB. Override for sync use-cases that pull larger repos.
   * Note: nanotar 0.3.0 has no streaming parse, so the entire tarball is
   * held in memory; setting this very large can crash Obsidian renderer.
   */
  maxTarballBytes?: number;
}

export interface GitHubBranchHead {
  sha: string;
}

export interface GitHubRateLimit {
  remaining: number;
  resetAt: Date;
}

/**
 * Thin GitHub REST client built on top of Obsidian `requestUrl()`.
 *
 * Security hardening (RFC 0a0791c1 Phase B.1, Vision Lock #6):
 *   - PAT redaction (Security #3): every error message routed through redact()
 *     so PATs leaked via underlying error / response.text never reach logs.
 *   - URL allowlist (Security #4): static validateRepoURL() rejects anything
 *     except literal `https://github.com/<owner>/<repo>` (no paths, queries,
 *     fragments, non-github hosts, scheme injection, path traversal).
 *   - Pre-flight rate-limit gate (Security #10): ensureRateLimit() refuses to
 *     proceed when remaining < needed + safety buffer to avoid partial pulls.
 *
 * Streaming caveat: nanotar 0.3.0 has no streaming parse — `parseTarGzip()`
 * returns `Promise<ParsedTarFileItem[]>` (buffer→array). The async-iterable
 * return type is preserved for forward compatibility, but underlying memory
 * usage is bounded by the full tarball size, not by chunk size.
 */
export class GitHubRestClient {
  // Token shapes per https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
  //   - Legacy classic family: ghp_/gho_/ghu_/ghs_/ghr_ (personal/oauth/user/server/refresh) — 36+ urlsafe chars.
  //   - Fine-grained personal access tokens (GitHub default since 2022):
  //     github_pat_<22-char-id>_<59+-char-secret> — both segments urlsafe (per docs).
  // Both prefixes covered to prevent silent leaks via modern-format tokens.
  private static readonly PAT_REGEX =
    /(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}_[A-Za-z0-9_]{59,})/g;

  // Max tarball size accepted by pullTarball — 50 MB default. Tarball is fully
  // buffered in memory (nanotar 0.3.0 has no streaming parse), so larger pulls
  // can crash Obsidian renderer. Override via constructor `maxTarballBytes` opt.
  private static readonly DEFAULT_MAX_TARBALL_BYTES = 50 * 1024 * 1024;

  // Strict allowlist — anchored, no paths/queries/fragments, no scheme variants.
  private static readonly REPO_URL_REGEX =
    /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;

  // ECMAScript private fields — runtime-hidden (ignored by JSON.stringify,
  // Object.keys, structuredClone, devtools-inspector, telemetry walkers).
  // TS `private` is compile-only and serializable — empirically leaked the PAT
  // via JSON.stringify(client). #-prefixed fields close that hole entirely.
  #pat: string;
  readonly #app: App;
  readonly #baseURL: string;
  readonly #maxTarballBytes: number;

  constructor(opts: GitHubRestClientOptions) {
    // An EMPTY PAT is allowed and puts the client in unauthenticated mode
    // (no Authorization header → public-repo reads only, lower rate limit).
    // This is deliberate: plugin onload wires the hard-switch dependencies
    // BEFORE the user has configured a PAT, so the ctor must not throw on an
    // empty string. Authenticated operations (createCommit, private pulls)
    // then surface a clear HTTP 401 instead of the whole hard-switch command
    // palette silently disappearing. The previous «PAT is required» throw on
    // an empty string broke that wiring (gated Bootstrap/knowledge-switch
    // commands never registered on vaults without a stored PAT).
    if (typeof opts.pat !== "string") {
      throw new Error("GitHubRestClient: PAT must be a string");
    }
    if (!opts.app) {
      throw new Error("GitHubRestClient: Obsidian App is required");
    }
    this.#pat = opts.pat;
    this.#app = opts.app;
    this.#baseURL = (opts.baseURL ?? "https://api.github.com").replace(/\/$/, "");
    this.#maxTarballBytes = opts.maxTarballBytes ?? GitHubRestClient.DEFAULT_MAX_TARBALL_BYTES;
  }

  /** Obsidian App handle (needed by downstream consumers — TarExtractor, etc.). */
  public get app(): App {
    return this.#app;
  }

  /**
   * Validate a candidate `exo__AssetSpace_git` URL value against the strict
   * allowlist. Throws on mismatch; safe to call at constructor entry of any
   * consumer that takes vault-declared repo URLs.
   *
   * Defensive checks beyond the regex:
   *   - reject literal `..` repo / owner (path traversal even if regex passes)
   *   - reject leading dot on repo (e.g. `.git` directory traversal vector)
   */
  public static validateRepoURL(url: string): void {
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("Invalid GitHub repo URL: empty or non-string");
    }
    if (url.length > 256) {
      throw new Error("Invalid GitHub repo URL: exceeds 256 chars");
    }
    if (!GitHubRestClient.REPO_URL_REGEX.test(url)) {
      throw new Error(
        `Invalid GitHub repo URL: ${url} (must match https://github.com/<owner>/<repo> exactly, no paths, queries, or fragments)`,
      );
    }
    const trailing = url.slice("https://github.com/".length);
    const [owner, repo, ...rest] = trailing.split("/");
    if (rest.length > 0) {
      throw new Error(`Invalid GitHub repo URL: ${url} (extra path segments)`);
    }
    if (owner === ".." || repo === ".." || repo.startsWith(".")) {
      throw new Error(`Invalid GitHub repo URL: ${url} (path-traversal pattern)`);
    }
  }

  /**
   * GET /repos/{owner}/{repo}/branches/{branch} → commit.sha
   */
  public async getRepoHead(
    owner: string,
    repo: string,
    branch: string = "main",
  ): Promise<GitHubBranchHead> {
    this.requireOwnerRepo(owner, repo);
    const resp = await this.request({
      method: "GET",
      url: `${this.#baseURL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
    });
    const sha = resp?.json?.commit?.sha;
    if (typeof sha !== "string" || sha.length === 0) {
      throw new Error(
        this.redact(`GitHub getRepoHead: missing commit.sha in response for ${owner}/${repo}@${branch}`),
      );
    }
    return { sha };
  }

  /**
   * GET /repos/{owner}/{repo}/tarball/{ref} → raw gzipped tarball as
   * ArrayBuffer.
   *
   * Useful when the consumer wants zip-slip-safe extraction via
   * {@link ../adapters/TarExtractor} or any other parser, rather than
   * the convenience parse offered by {@link pullTarball}.
   *
   * Enforces `maxTarballBytes` (default 50 MB) before returning — protects
   * the renderer process from oversized downloads which would later be
   * fully materialised by `parseTarGzip` (nanotar 0.3.0 has no streaming).
   */
  public async fetchTarballBuffer(
    owner: string,
    repo: string,
    ref: string = "HEAD",
  ): Promise<ArrayBuffer> {
    this.requireOwnerRepo(owner, repo);
    const resp = await this.request({
      method: "GET",
      url: `${this.#baseURL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`,
    });
    if (!resp?.arrayBuffer || !(resp.arrayBuffer instanceof ArrayBuffer)) {
      throw new Error(
        this.redact(`GitHub fetchTarballBuffer: response missing arrayBuffer for ${owner}/${repo}@${ref}`),
      );
    }
    if (resp.arrayBuffer.byteLength > this.#maxTarballBytes) {
      throw new Error(
        `GitHub fetchTarballBuffer: tarball exceeds maxTarballBytes (${resp.arrayBuffer.byteLength} > ${this.#maxTarballBytes}) for ${owner}/${repo}@${ref}`,
      );
    }
    return resp.arrayBuffer;
  }

  /**
   * GET /repos/{owner}/{repo}/tarball/{ref} → parsed tar items as async iterable.
   *
   * ⚠️ Memory contract: `nanotar@0.3.0` has no streaming parse — the **entire**
   * tarball arrayBuffer is buffered, decompressed and materialised as an
   * in-memory `TarFileItem[]` before the async iterable yields its first item.
   * Memory bound is O(tarball.size), NOT O(item.size). Callers should treat
   * the iterator as "iterate-then-discard" and must not assume low memory
   * usage. A size guard (`maxTarballBytes`, default 50 MB) rejects oversized
   * tarballs before the parse to protect the Obsidian renderer process.
   *
   * **Zip-slip note:** this convenience method does NOT validate entry
   * paths. Use `fetchTarballBuffer()` + `TarExtractor.extract()` when
   * processing untrusted tarballs (production AssetSpace pulls).
   */
  public async pullTarball(
    owner: string,
    repo: string,
    ref: string = "HEAD",
  ): Promise<AsyncIterable<TarFileItem>> {
    const blob = await this.fetchTarballBuffer(owner, repo, ref);
    let items: TarFileItem[];
    try {
      items = (await parseTarGzip(blob)) as unknown as TarFileItem[];
    } catch (err) {
      throw new Error(
        this.redact(`GitHub pullTarball: tarball parse failed for ${owner}/${repo}@${ref}: ${errMsg(err)}`),
      );
    }
    return GitHubRestClient.toAsyncIterable(items);
  }

  /**
   * Create a commit on a branch with arbitrary file changes via 4-call chain:
   *   1. GET refs/heads/{branch}             → base ref SHA
   *   2. POST git/trees (recursive)          → new tree SHA
   *   3. POST git/commits                    → new commit SHA
   *   4. PATCH refs/heads/{branch}           → fast-forward to new commit
   *
   * Returns the new commit SHA.
   *
   * Partial-failure contract: if steps 1–3 succeed but step 4 (PATCH ref)
   * fails (network glitch, 422 non-fast-forward, concurrent push race), the
   * remote will have an **orphan commit**. On the ref-mismatch path the new SHA
   * is embedded in the thrown error message and the orphan is recoverable by
   * it; on an HTTP-error PATCH failure (e.g. 422) the thrown error does NOT
   * surface the new commit SHA. Either way git GC reaps unreachable commits
   * after ~30 days. Callers MAY safely retry: a subsequent successful call
   * creates a new commit and leaves the orphan to expire. Do NOT use this
   * method for branches with concurrent writers without coordinated
   * retry/locking. (See the `restCreateCommit` core docstring — same contract.)
   *
   * Implementation note: the 4-call orchestration + payload shapes + ref
   * fast-forward + structural validation live in the transport-agnostic
   * `restCreateCommit` core (`exocortex` package) so the CLI reuses the exact
   * same logic over a `fetch` transport. This method only supplies the
   * `requestUrl`-backed transport + PAT redactor; the contract above
   * (validation order, error strings, partial-failure SHA) is unchanged.
   */
  public async createCommit(
    owner: string,
    repo: string,
    branch: string,
    files: Map<string, string>,
    message: string,
  ): Promise<string> {
    this.requireOwnerRepo(owner, repo);
    // Adapter: the core's transport returns `{ status?, json?, text? }`; the
    // `requestUrl`-backed `request()` already throws on non-2xx (the core's
    // transport contract) and returns a RequestUrlResponse that satisfies that
    // shape. Caller-owned Authorization header + HTTP-error-body redaction stay
    // inside `request()`; the core's own structural errors get `this.redact`.
    const transport: RestCommitTransport = (req) => this.request(req);
    return restCreateCommit(transport, {
      owner,
      repo,
      branch,
      files,
      message,
      baseURL: this.#baseURL,
      redact: (m) => this.redact(m),
    });
  }

  /**
   * GET /rate_limit → core resource remaining + reset.
   */
  public async checkRateLimit(): Promise<GitHubRateLimit> {
    const resp = await this.request({
      method: "GET",
      url: `${this.#baseURL}/rate_limit`,
    });
    const core = resp?.json?.resources?.core;
    if (!core || typeof core.remaining !== "number" || typeof core.reset !== "number") {
      throw new Error(
        this.redact(`GitHub checkRateLimit: malformed /rate_limit response`),
      );
    }
    return {
      remaining: core.remaining,
      resetAt: new Date(core.reset * 1000),
    };
  }

  /**
   * GET /user/repos?per_page=N → list of accessible repository full_names.
   *
   * Used by the Settings UI "Test connection" path (Issue #3320 §1) to
   * surface a concrete signal that the configured PAT can actually reach
   * exoas-* repositories — checkRateLimit alone returns true for any
   * authenticated token, even one with zero repo scopes.
   *
   * Returns at most `perPage` (default 5) `full_name` strings. Caller is
   * responsible for clamping; we forward the value to GitHub which itself
   * caps at 100.
   */
  public async listRepos(perPage = 5): Promise<string[]> {
    const capped = Math.max(1, Math.min(100, Math.floor(perPage)));
    const resp = await this.request({
      method: "GET",
      url: `${this.#baseURL}/user/repos?per_page=${capped}&sort=updated`,
    });
    const items = resp?.json;
    if (!Array.isArray(items)) {
      throw new Error(
        this.redact(`GitHub listRepos: malformed /user/repos response`),
      );
    }
    const names: string[] = [];
    for (const item of items) {
      if (item && typeof (item as Record<string, unknown>).full_name === "string") {
        names.push((item as Record<string, unknown>).full_name as string);
      }
    }
    return names;
  }

  /**
   * Refuse to proceed when remaining < needed + 10 (safety buffer).
   * Throws with seconds-to-reset embedded in error message.
   */
  public async ensureRateLimit(neededCalls: number): Promise<void> {
    if (typeof neededCalls !== "number" || neededCalls < 0) {
      throw new Error("GitHub ensureRateLimit: neededCalls must be a non-negative number");
    }
    const { remaining, resetAt } = await this.checkRateLimit();
    const required = neededCalls + 10;
    if (remaining < required) {
      const waitSec = Math.max(0, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
      throw new Error(
        `Rate limit guard: ${remaining} remaining < ${required} needed; resets in ${waitSec}s`,
      );
    }
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async request(param: RequestUrlParam): Promise<RequestUrlResponse> {
    // Caller-provided headers spread FIRST so the client always owns the
    // Authorization header — prevents a callsite from accidentally (or
    // maliciously) overriding the PAT via headers passed in `param`.
    const headers: Record<string, string> = {
      ...(param.headers ?? {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "exocortex-plugin",
    };
    if (this.#pat.length > 0) {
      headers.Authorization = `Bearer ${this.#pat}`;
    } else {
      // Unauthenticated mode (empty PAT): omit Authorization entirely. Sending
      // `Bearer ` with an empty token makes GitHub reject even public reads
      // with 401, and a caller-provided Authorization must not leak through.
      delete headers.Authorization;
    }
    let resp: RequestUrlResponse;
    try {
      resp = await requestUrl({
        ...param,
        headers,
        throw: false,
      });
    } catch (err) {
      throw new Error(this.redact(`GitHub request failed: ${errMsg(err)}`));
    }
    if (resp.status < 200 || resp.status >= 300) {
      const body = typeof resp.text === "string" ? resp.text : "";
      // Redact BEFORE truncating so a PAT near the 256-char boundary cannot
      // be sliced mid-token (which would shorten it below the regex floor
      // and escape redaction).
      throw new Error(
        truncate(
          this.redact(`GitHub request ${param.method ?? "GET"} ${param.url} → HTTP ${resp.status}: ${body}`),
          512,
        ),
      );
    }
    return resp;
  }

  /**
   * Replace any PAT-shaped substring with ***REDACTED***. Idempotent.
   * Catches PATs that may have leaked into error messages, response bodies,
   * or third-party error formatters. Non-string inputs are coerced via
   * `String(message)` so even an `Error` / object slipping through still
   * receives the redaction pass.
   */
  private redact(message: unknown): string {
    const s = typeof message === "string" ? message : String(message);
    return s.replace(GitHubRestClient.PAT_REGEX, "***REDACTED***");
  }

  private requireOwnerRepo(owner: string, repo: string): void {
    if (typeof owner !== "string" || owner.length === 0 || /[^a-zA-Z0-9_-]/.test(owner)) {
      throw new Error(`Invalid GitHub owner: ${String(owner)}`);
    }
    if (typeof repo !== "string" || repo.length === 0 || /[^a-zA-Z0-9_.-]/.test(repo)) {
      throw new Error(`Invalid GitHub repo: ${String(repo)}`);
    }
    if (
      owner === ".." ||
      repo === ".." ||
      repo.startsWith(".") ||
      repo.startsWith("-") ||
      owner.startsWith("-")
    ) {
      throw new Error(`Invalid GitHub owner/repo: ${owner}/${repo} (path-traversal/flag pattern)`);
    }
  }

  private static toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const item of items) {
          yield item;
        }
      },
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
