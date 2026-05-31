import type { App, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import { parseTarGzip } from "nanotar";
import type { TarFileItem } from "nanotar";

export interface GitHubRestClientOptions {
  pat: string;
  app: App;
  baseURL?: string;
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
  // ghp_/gho_/ghu_/ghs_/ghr_ = personal/oauth/user/server/refresh tokens. 36+ urlsafe chars after prefix.
  private static readonly PAT_REGEX = /gh[pousr]_[A-Za-z0-9_]{36,}/g;

  // Strict allowlist — anchored, no paths/queries/fragments, no scheme variants.
  private static readonly REPO_URL_REGEX =
    /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;

  private readonly pat: string;
  private readonly _app: App;
  private readonly baseURL: string;

  constructor(opts: GitHubRestClientOptions) {
    if (!opts.pat || typeof opts.pat !== "string") {
      throw new Error("GitHubRestClient: PAT is required");
    }
    if (!opts.app) {
      throw new Error("GitHubRestClient: Obsidian App is required");
    }
    this.pat = opts.pat;
    this._app = opts.app;
    this.baseURL = (opts.baseURL ?? "https://api.github.com").replace(/\/$/, "");
  }

  /** Obsidian App handle (needed by downstream consumers — TarExtractor, etc.). */
  public get app(): App {
    return this._app;
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
      url: `${this.baseURL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
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
   * GET /repos/{owner}/{repo}/tarball/{ref} → parsed tar items as async iterable.
   *
   * Note: nanotar 0.3.0 buffers the full tarball. The iterable returned here
   * yields from an already-materialised array; future nanotar versions with
   * a streaming parser could replace the implementation without changing the
   * call-site contract.
   */
  public async pullTarball(
    owner: string,
    repo: string,
    ref: string = "HEAD",
  ): Promise<AsyncIterable<TarFileItem>> {
    this.requireOwnerRepo(owner, repo);
    const resp = await this.request({
      method: "GET",
      url: `${this.baseURL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`,
    });
    if (!resp?.arrayBuffer || !(resp.arrayBuffer instanceof ArrayBuffer)) {
      throw new Error(
        this.redact(`GitHub pullTarball: response missing arrayBuffer for ${owner}/${repo}@${ref}`),
      );
    }
    let items: TarFileItem[];
    try {
      items = (await parseTarGzip(resp.arrayBuffer)) as unknown as TarFileItem[];
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
   */
  public async createCommit(
    owner: string,
    repo: string,
    branch: string,
    files: Map<string, string>,
    message: string,
  ): Promise<string> {
    this.requireOwnerRepo(owner, repo);
    if (typeof branch !== "string" || branch.length === 0) {
      throw new Error("GitHub createCommit: branch is required");
    }
    if (!(files instanceof Map) || files.size === 0) {
      throw new Error("GitHub createCommit: files map must be non-empty");
    }
    if (typeof message !== "string" || message.length === 0) {
      throw new Error("GitHub createCommit: message is required");
    }

    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    const b = encodeURIComponent(branch);

    // Step 1 — get current ref SHA.
    const refResp = await this.request({
      method: "GET",
      url: `${this.baseURL}/repos/${o}/${r}/git/refs/heads/${b}`,
    });
    const baseSha = refResp?.json?.object?.sha;
    if (typeof baseSha !== "string" || baseSha.length === 0) {
      throw new Error(
        this.redact(`GitHub createCommit: missing object.sha for ref heads/${branch}`),
      );
    }

    // Step 2 — create tree (recursive).
    const tree = Array.from(files.entries()).map(([path, content]) => ({
      path,
      mode: "100644",
      type: "blob",
      content,
    }));
    const treeResp = await this.request({
      method: "POST",
      url: `${this.baseURL}/repos/${o}/${r}/git/trees`,
      contentType: "application/json",
      body: JSON.stringify({ base_tree: baseSha, tree }),
    });
    const treeSha = treeResp?.json?.sha;
    if (typeof treeSha !== "string" || treeSha.length === 0) {
      throw new Error(
        this.redact(`GitHub createCommit: tree create returned no sha`),
      );
    }

    // Step 3 — create commit.
    const commitResp = await this.request({
      method: "POST",
      url: `${this.baseURL}/repos/${o}/${r}/git/commits`,
      contentType: "application/json",
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [baseSha],
      }),
    });
    const commitSha = commitResp?.json?.sha;
    if (typeof commitSha !== "string" || commitSha.length === 0) {
      throw new Error(
        this.redact(`GitHub createCommit: commit create returned no sha`),
      );
    }

    // Step 4 — update ref.
    const patchResp = await this.request({
      method: "PATCH",
      url: `${this.baseURL}/repos/${o}/${r}/git/refs/heads/${b}`,
      contentType: "application/json",
      body: JSON.stringify({ sha: commitSha, force: false }),
    });
    const patchedSha = patchResp?.json?.object?.sha;
    if (patchedSha !== commitSha) {
      throw new Error(
        this.redact(`GitHub createCommit: ref update mismatch (expected ${commitSha}, got ${patchedSha})`),
      );
    }

    return commitSha;
  }

  /**
   * GET /rate_limit → core resource remaining + reset.
   */
  public async checkRateLimit(): Promise<GitHubRateLimit> {
    const resp = await this.request({
      method: "GET",
      url: `${this.baseURL}/rate_limit`,
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
    const headers = {
      Authorization: `Bearer ${this.pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "exocortex-plugin",
      ...(param.headers ?? {}),
    };
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
      throw new Error(
        this.redact(`GitHub request ${param.method ?? "GET"} ${param.url} → HTTP ${resp.status}: ${truncate(body, 256)}`),
      );
    }
    return resp;
  }

  /**
   * Replace any PAT-shaped substring with ***REDACTED***. Idempotent.
   * Catches PATs that may have leaked into error messages, response bodies,
   * or third-party error formatters.
   */
  private redact(message: string): string {
    if (typeof message !== "string") {
      return message;
    }
    return message.replace(GitHubRestClient.PAT_REGEX, "***REDACTED***");
  }

  private requireOwnerRepo(owner: string, repo: string): void {
    if (typeof owner !== "string" || owner.length === 0 || /[^a-zA-Z0-9_-]/.test(owner)) {
      throw new Error(`Invalid GitHub owner: ${String(owner)}`);
    }
    if (typeof repo !== "string" || repo.length === 0 || /[^a-zA-Z0-9_.-]/.test(repo)) {
      throw new Error(`Invalid GitHub repo: ${String(repo)}`);
    }
    if (owner === ".." || repo === ".." || repo.startsWith(".")) {
      throw new Error(`Invalid GitHub owner/repo: ${owner}/${repo} (path-traversal pattern)`);
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
