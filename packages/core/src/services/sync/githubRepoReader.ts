/**
 * Read-side GitHub Git Data API helpers (ExoSync A1).
 *
 * Reuses the SAME injected `RestCommitTransport` contract as the existing
 * write primitive `restCreateCommit` (D3) — transport throws on any non-2xx,
 * only `json` is consumed. No new port is introduced (D3: no SyncTransport
 * abstraction for MVP).
 */

import type { RestCommitTransport } from "../../infrastructure/github/restCommit";
import { base64ToBytes, base64ToUtf8 } from "../../utilities/base64";

export interface RemoteTreeEntry {
  path: string;
  blobSha: string;
  /** Blob size in bytes, when GitHub reports it (file-mode size cap). */
  size?: number;
}

export interface RemoteCommitInfo {
  sha: string;
  treeSha: string;
  parents: string[];
}

const DEFAULT_BASE_URL = "https://api.github.com";

function api(baseURL: string | undefined): string {
  return (baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object"
    ? (v as Record<string, unknown>)
    : undefined;
}

function readString(obj: unknown, key: string): string | undefined {
  const rec = asRecord(obj);
  const v = rec?.[key];
  return typeof v === "string" ? v : undefined;
}

/** GET git/refs/heads/{branch} → current head commit SHA. */
export async function getHeadSha(
  transport: RestCommitTransport,
  owner: string,
  repo: string,
  branch: string,
  baseURL?: string,
): Promise<string> {
  const resp = await transport({
    method: "GET",
    url: `${api(baseURL)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`,
  });
  const sha = readString(asRecord(resp?.json)?.object, "sha");
  if (typeof sha !== "string" || sha.length === 0) {
    throw new Error(`ExoSync: missing object.sha for ref heads/${branch}`);
  }
  return sha;
}

/** GET git/commits/{sha} → tree SHA + parents (race check + D22 validation). */
export async function getCommitInfo(
  transport: RestCommitTransport,
  owner: string,
  repo: string,
  commitSha: string,
  baseURL?: string,
): Promise<RemoteCommitInfo> {
  const resp = await transport({
    method: "GET",
    url: `${api(baseURL)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(commitSha)}`,
  });
  const json = asRecord(resp?.json);
  const sha = readString(json, "sha");
  const treeSha = readString(json?.tree, "sha");
  if (!sha || !treeSha) {
    throw new Error(`ExoSync: malformed commit response for ${commitSha}`);
  }
  const parentsRaw = json?.parents;
  const parents: string[] = Array.isArray(parentsRaw)
    ? parentsRaw
        .map((p) => readString(p, "sha"))
        .filter((s): s is string => typeof s === "string")
    : [];
  return { sha, treeSha, parents };
}

/**
 * The canonical git empty tree.
 *
 * A branch head may legitimately reference it — the repo exists and the branch
 * resolves, there is simply nothing committed yet. GitHub nevertheless answers
 * **404** for `GET git/trees/<this sha>` even when the repo is reachable and
 * the PAT allowlists it: the 404 is a property of the REQUEST, not of
 * reachability. Callers that classify 404 as "repo unreachable" would report a
 * healthy empty repo as an error (req 029c90ee).
 */
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * GET git/trees/{treeSha}?recursive=1 → blob entries (path + sha).
 *
 * Fails LOUD on `truncated: true` (GitHub truncates past ~100k entries /
 * 7 MB) — a truncated tree would produce wrong diffs and phantom deletes, so
 * the caller must skip the repo with a warning instead.
 *
 * Short-circuits {@link EMPTY_TREE_SHA}: an empty tree contains zero blobs by
 * definition, so the answer is known without a round trip — and without
 * inheriting GitHub's 404 for that SHA.
 */
export async function getTree(
  transport: RestCommitTransport,
  owner: string,
  repo: string,
  treeSha: string,
  baseURL?: string,
): Promise<RemoteTreeEntry[]> {
  if (treeSha === EMPTY_TREE_SHA) return [];
  const resp = await transport({
    method: "GET",
    url: `${api(baseURL)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  });
  const json = asRecord(resp?.json);
  if (json?.truncated === true) {
    throw new Error(
      `ExoSync: tree ${treeSha} is truncated by GitHub (repo too large for recursive listing) — refusing to diff`,
    );
  }
  const treeRaw = json?.tree;
  if (!Array.isArray(treeRaw)) {
    throw new Error(`ExoSync: malformed tree response for ${treeSha}`);
  }
  const entries: RemoteTreeEntry[] = [];
  for (const item of treeRaw) {
    const rec = asRecord(item);
    if (rec?.type !== "blob") continue;
    const path = readString(rec, "path");
    const blobSha = readString(rec, "sha");
    const size = typeof rec.size === "number" ? rec.size : undefined;
    if (path && blobSha) {
      entries.push({ path, blobSha, ...(size !== undefined ? { size } : {}) });
    }
  }
  return entries;
}

/** GET git/blobs/{sha} → UTF-8 text content (base64-decoded). */
export async function getBlobText(
  transport: RestCommitTransport,
  owner: string,
  repo: string,
  blobSha: string,
  baseURL?: string,
): Promise<string> {
  const resp = await transport({
    method: "GET",
    url: `${api(baseURL)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`,
  });
  const json = asRecord(resp?.json);
  const content = readString(json, "content");
  if (typeof content !== "string") {
    throw new Error(`ExoSync: malformed blob response for ${blobSha}`);
  }
  const encoding = readString(json, "encoding");
  if (encoding === "utf-8") return content;
  // GitHub returns base64 with embedded newlines — the helper strips them.
  // Platform-neutral (no Buffer): this path is hot on every mobile sync
  // cycle and iOS WebKit has no Node globals (Issue #3486, MOBILE-003).
  return base64ToUtf8(content);
}

/**
 * GET git/blobs/{sha} → raw bytes (Phase C, binary attachments). The
 * UTF-8 decode in {@link getBlobText} silently corrupts binary content
 * (replacement characters) — opaque FileSpace blobs go through this
 * byte-exact path instead.
 */
export async function getBlobBytes(
  transport: RestCommitTransport,
  owner: string,
  repo: string,
  blobSha: string,
  baseURL?: string,
): Promise<Uint8Array> {
  const resp = await transport({
    method: "GET",
    url: `${api(baseURL)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`,
  });
  const json = asRecord(resp?.json);
  const content = readString(json, "content");
  if (typeof content !== "string") {
    throw new Error(`ExoSync: malformed blob response for ${blobSha}`);
  }
  const encoding = readString(json, "encoding");
  if (encoding === "utf-8") {
    return new TextEncoder().encode(content);
  }
  return base64ToBytes(content);
}
