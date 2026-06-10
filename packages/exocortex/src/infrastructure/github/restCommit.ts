/**
 * Transport-agnostic GitHub "create commit" core (Git Data API, 4-call chain).
 *
 * Extracted from the plugin's `GitHubRestClient.createCommit` so BOTH the
 * Obsidian plugin (Obsidian `requestUrl` transport) and the CLI (Node `fetch`
 * transport) reuse ONE implementation of the commit+push sequence. This is the
 * iOS-portable production path: the only platform-specific piece is the
 * injected `transport` fn; the 4-call orchestration, payload shapes, ref
 * fast-forward, and structural validation live here, platform-free.
 *
 * The 4 calls (GitHub Git Data API):
 *   1. GET  git/refs/heads/{branch}  → base ref SHA
 *   2. POST git/trees (recursive)    → new tree SHA (multi-file, atomic)
 *   3. POST git/commits              → new commit SHA
 *   4. PATCH git/refs/heads/{branch} → fast-forward ref to the new commit
 *
 * Contract with the injected transport:
 *   - The transport MUST throw on any non-2xx HTTP status (the plugin's
 *     `requestUrl` wrapper and the CLI's `fetch` wrapper both do). This core
 *     only ever observes successful responses and validates their JSON shape.
 *   - The transport returns `{ status?, json?, text? }`; only `json` is read.
 *   - PAT handling (Authorization header) + redaction of leaked tokens in
 *     HTTP-error bodies is the transport's responsibility. The optional
 *     `redact` param below is a defence-in-depth pass over this core's own
 *     structural error strings (which never embed a PAT, but are redacted
 *     anyway for parity with the plugin original).
 *
 * Partial-failure contract (unchanged from the plugin original): if steps 1-3
 * succeed but step 4 (PATCH ref) fails (network glitch, 422 non-fast-forward,
 * concurrent push race), the remote holds an **orphan commit**. On the
 * ref-mismatch path the new SHA is embedded in the thrown error message and the
 * orphan is recoverable by it; on an HTTP-error PATCH failure (e.g. 422) the
 * transport throws an error that does NOT surface the new commit SHA. Either
 * way git GC reaps unreachable commits after ~30 days. Callers MAY safely retry:
 * a subsequent successful call creates a new commit and leaves the orphan to
 * expire. Do NOT use this for branches with concurrent writers without
 * coordinated retry/locking.
 */

/** Minimal HTTP request descriptor — transport-agnostic. */
export interface RestCommitRequest {
  method: "GET" | "POST" | "PATCH";
  url: string;
  /** Set for POST/PATCH bodies. Adapter maps to `Content-Type` header. */
  contentType?: string;
  /** JSON-serialised request body for POST/PATCH. */
  body?: string;
}

/**
 * Minimal HTTP response shape both the Obsidian `requestUrl` response and a
 * `fetch`-derived adapter can satisfy. Only `json` is consumed by the core.
 */
export interface RestCommitResponse {
  status?: number;
  json?: unknown;
  text?: string;
}

/**
 * Injected transport. Plugin → adapter over `requestUrl`; CLI → adapter over
 * `fetch`. MUST throw on non-2xx (see contract above).
 */
export type RestCommitTransport = (
  req: RestCommitRequest,
) => Promise<RestCommitResponse>;

/**
 * Binary file payload (ExoSync Phase C, VL#11 — attachments as plain git
 * content, no LFS). Inline tree `content` is UTF-8-only, so binary blobs go
 * through a per-file `POST git/blobs {content: base64, encoding: "base64"}`
 * and enter the tree by `sha` reference instead.
 */
export interface BinaryFilePayload {
  base64: string;
}

/** One file's content: UTF-8 text inline, or a base64 binary payload. */
export type CommitFileContent = string | BinaryFilePayload;

export function isBinaryPayload(
  content: CommitFileContent,
): content is BinaryFilePayload {
  return typeof content !== "string";
}

export interface RestCreateCommitParams {
  owner: string;
  repo: string;
  branch: string;
  /**
   * Map of repo-relative path → file content. Non-empty. String values are
   * committed inline (UTF-8); {@link BinaryFilePayload} values are uploaded
   * as base64 blobs first (one extra API call per binary file).
   */
  files: Map<string, CommitFileContent>;
  message: string;
  /** Defaults to `https://api.github.com`. Trailing slash stripped. */
  baseURL?: string;
  /**
   * Optional defence-in-depth redactor applied to this core's own structural
   * error strings. Defaults to identity. The plugin injects its PAT redactor
   * for parity with the original `createCommit` error semantics.
   */
  redact?: (message: string) => string;
}

const DEFAULT_BASE_URL = "https://api.github.com";

/** Read `json.object.sha` defensively without `any`. */
function readObjectSha(json: unknown): string | undefined {
  if (json !== null && typeof json === "object" && "object" in json) {
    const obj = (json as { object?: unknown }).object;
    if (obj !== null && typeof obj === "object" && "sha" in obj) {
      const sha = (obj as { sha?: unknown }).sha;
      return typeof sha === "string" ? sha : undefined;
    }
  }
  return undefined;
}

/** Read `json.sha` defensively without `any`. */
function readSha(json: unknown): string | undefined {
  if (json !== null && typeof json === "object" && "sha" in json) {
    const sha = (json as { sha?: unknown }).sha;
    return typeof sha === "string" ? sha : undefined;
  }
  return undefined;
}

/**
 * Execute the 4-call Git Data API chain over an injected transport and return
 * the new commit SHA. See module docstring for the full contract.
 */
export async function restCreateCommit(
  transport: RestCommitTransport,
  params: RestCreateCommitParams,
): Promise<string> {
  const { owner, repo, branch, files, message } = params;
  const baseURL = (params.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const redact = params.redact ?? ((m: string): string => m);

  if (typeof owner !== "string" || owner.length === 0) {
    throw new Error("restCreateCommit: owner is required");
  }
  if (typeof repo !== "string" || repo.length === 0) {
    throw new Error("restCreateCommit: repo is required");
  }
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
  const refResp = await transport({
    method: "GET",
    url: `${baseURL}/repos/${o}/${r}/git/refs/heads/${b}`,
  });
  const baseSha = readObjectSha(refResp?.json);
  if (typeof baseSha !== "string" || baseSha.length === 0) {
    throw new Error(
      redact(`GitHub createCommit: missing object.sha for ref heads/${branch}`),
    );
  }

  // Step 1.5 — upload binary blobs (Phase C). Inline tree `content` is
  // UTF-8-only; binary payloads become blobs by sha. Uploaded sequentially
  // through the same transport (rate-limit backoff applies when wrapped).
  const blobShaByPath = new Map<string, string>();
  for (const [path, content] of files) {
    if (!isBinaryPayload(content)) continue;
    const blobResp = await transport({
      method: "POST",
      url: `${baseURL}/repos/${o}/${r}/git/blobs`,
      contentType: "application/json",
      body: JSON.stringify({ content: content.base64, encoding: "base64" }),
    });
    const blobSha = readSha(blobResp?.json);
    if (typeof blobSha !== "string" || blobSha.length === 0) {
      throw new Error(
        redact(`GitHub createCommit: blob create returned no sha for ${path}`),
      );
    }
    blobShaByPath.set(path, blobSha);
  }

  // Step 2 — create tree (recursive, multi-file atomic).
  const tree = Array.from(files.entries()).map(([path, content]) =>
    isBinaryPayload(content)
      ? {
          path,
          mode: "100644",
          type: "blob",
          sha: blobShaByPath.get(path),
        }
      : {
          path,
          mode: "100644",
          type: "blob",
          content,
        },
  );
  const treeResp = await transport({
    method: "POST",
    url: `${baseURL}/repos/${o}/${r}/git/trees`,
    contentType: "application/json",
    body: JSON.stringify({ base_tree: baseSha, tree }),
  });
  const treeSha = readSha(treeResp?.json);
  if (typeof treeSha !== "string" || treeSha.length === 0) {
    throw new Error(redact(`GitHub createCommit: tree create returned no sha`));
  }

  // Step 3 — create commit.
  const commitResp = await transport({
    method: "POST",
    url: `${baseURL}/repos/${o}/${r}/git/commits`,
    contentType: "application/json",
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [baseSha],
    }),
  });
  const commitSha = readSha(commitResp?.json);
  if (typeof commitSha !== "string" || commitSha.length === 0) {
    throw new Error(
      redact(`GitHub createCommit: commit create returned no sha`),
    );
  }

  // Step 4 — fast-forward ref to new commit.
  const patchResp = await transport({
    method: "PATCH",
    url: `${baseURL}/repos/${o}/${r}/git/refs/heads/${b}`,
    contentType: "application/json",
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  const patchedSha = readObjectSha(patchResp?.json);
  if (patchedSha !== commitSha) {
    throw new Error(
      redact(
        `GitHub createCommit: ref update mismatch (expected ${commitSha}, got ${patchedSha})`,
      ),
    );
  }

  return commitSha;
}
