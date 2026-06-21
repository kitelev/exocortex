/**
 * In-memory GitHub Git Data API fake for ExoSync tests.
 *
 * Production-shape by design (test-fixture-realism): it implements the SAME
 * transport contract as the real adapters (throws on non-2xx with the message
 * shape `GitHub request {METHOD} {url} → HTTP {status}: {body}`), computes
 * REAL git blob SHAs (so disk-side `gitBlobSha` comparisons behave exactly as
 * against GitHub), returns base64 blob content with embedded newlines (as
 * GitHub does), and enforces `force:false` fast-forward semantics on PATCH —
 * a non-fast-forward ref update throws HTTP 422, which is the production race
 * signal the engine's D16 retry loop consumes.
 */

import { createHash } from "node:crypto";
import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
} from "../../../../src";
import type {
  LocalFilesPort,
  MaterializationCheckPort,
  MountBaseStorePort,
  SyncRepoSpec,
  WatermarkRecord,
  WatermarkStorePort,
} from "../../../../src";

export const sha1Hex = async (bytes: Uint8Array): Promise<string> =>
  createHash("sha1").update(bytes).digest("hex");

/** Accepts text or raw bytes — real git blob SHA over the byte stream. */
function gitBlobShaSync(content: string | Uint8Array): string {
  const body =
    typeof content === "string" ? Buffer.from(content, "utf-8") : Buffer.from(content);
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
}

function chunkBase64(content: Buffer): string {
  const b64 = content.toString("base64");
  return b64.replace(/(.{60})/g, "$1\n");
}

interface FakeCommit {
  sha: string;
  treeSha: string;
  parents: string[];
  message: string;
}

function httpError(method: string, url: string, status: number, body: string): Error {
  return new Error(`GitHub request ${method} ${url} → HTTP ${status}: ${body}`);
}

/** Test-side file content: text or raw bytes (binary attachments, Phase C). */
export type FakeFileContent = string | Uint8Array;

export class FakeGitHubRepo {
  readonly owner = "test-owner";
  readonly repo = "test-repo";
  readonly branch = "main";

  /** blobSha → raw content bytes (text stored as its UTF-8 encoding). */
  readonly blobs = new Map<string, Buffer>();
  /** treeSha → (path → blobSha) */
  readonly trees = new Map<string, Map<string, string>>();
  readonly commits = new Map<string, FakeCommit>();
  /** branch → head commit sha */
  readonly refs = new Map<string, string>();

  /** When true, recursive tree GETs report `truncated: true`. */
  truncatedTrees = false;
  /** Race-injection hook — fires before every PATCH refs validation. */
  onBeforePatch?: () => void;
  /** Race-injection hook — fires on every GET refs (1-based call count). */
  onGetRef?: (count: number) => void;
  private getRefCount = 0;
  private commitCounter = 0;

  constructor(initialFiles: Record<string, FakeFileContent> = {}) {
    this.commitDirect(this.branch, initialFiles, "init");
  }

  spec(spaceKind?: "asset" | "file"): SyncRepoSpec {
    return {
      owner: this.owner,
      repo: this.repo,
      branch: this.branch,
      repoKey: `${this.owner}/${this.repo}#${this.branch}`,
      localPath: "assetspaces/test",
      ...(spaceKind === "file" ? { spaceKind } : {}),
    };
  }

  headSha(): string {
    return this.refs.get(this.branch)!;
  }

  headFiles(): Map<string, string> {
    const tree = this.trees.get(this.commits.get(this.headSha())!.treeSha)!;
    const out = new Map<string, string>();
    for (const [path, blobSha] of tree) {
      out.set(path, this.blobs.get(blobSha)!.toString("utf-8"));
    }
    return out;
  }

  /** Raw bytes of one head-tree file (binary assertions), or undefined. */
  headBlob(path: string): Buffer | undefined {
    const tree = this.trees.get(this.commits.get(this.headSha())!.treeSha)!;
    const blobSha = tree.get(path);
    return blobSha === undefined ? undefined : this.blobs.get(blobSha);
  }

  /**
   * Test-side direct commit ("device B"): applies `files` (and `deletes`) on
   * top of the current head and moves the ref. Bypasses the transport.
   */
  commitDirect(
    branch: string,
    files: Record<string, FakeFileContent>,
    message: string,
    deletes: string[] = [],
  ): string {
    const parent = this.refs.get(branch);
    const baseTree =
      parent !== undefined
        ? new Map(this.trees.get(this.commits.get(parent)!.treeSha)!)
        : new Map<string, string>();
    for (const [path, content] of Object.entries(files)) {
      const blobSha = gitBlobShaSync(content);
      this.blobs.set(
        blobSha,
        typeof content === "string"
          ? Buffer.from(content, "utf-8")
          : Buffer.from(content),
      );
      baseTree.set(path, blobSha);
    }
    for (const path of deletes) baseTree.delete(path);
    const treeSha = this.storeTree(baseTree);
    const sha = this.newCommitSha(treeSha, parent ? [parent] : [], message);
    this.commits.set(sha, {
      sha,
      treeSha,
      parents: parent ? [parent] : [],
      message,
    });
    this.refs.set(branch, sha);
    return sha;
  }

  private storeTree(entries: Map<string, string>): string {
    const serialized = [...entries.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, s]) => `${p}:${s}`)
      .join("\n");
    const treeSha = createHash("sha1").update(`tree:${serialized}`).digest("hex");
    this.trees.set(treeSha, new Map(entries));
    return treeSha;
  }

  private newCommitSha(treeSha: string, parents: string[], message: string): string {
    return createHash("sha1")
      .update(`commit:${treeSha}:${parents.join(",")}:${message}:${this.commitCounter++}`)
      .digest("hex");
  }

  transport(): RestCommitTransport {
    return async (req: RestCommitRequest): Promise<RestCommitResponse> => {
      const { method, url } = req;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const m = (re: RegExp): RegExpExecArray | null => re.exec(path);

      let match: RegExpExecArray | null;

      if (method === "GET" && (match = m(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/))) {
        this.getRefCount++;
        this.onGetRef?.(this.getRefCount);
        const sha = this.refs.get(decodeURIComponent(match[1]));
        if (sha === undefined) throw httpError(method, url, 404, "Not Found");
        return { status: 200, json: { ref: `refs/heads/${match[1]}`, object: { sha } } };
      }

      if (method === "GET" && (match = m(/^\/repos\/[^/]+\/[^/]+\/git\/commits\/([^/?]+)$/))) {
        const commit = this.commits.get(decodeURIComponent(match[1]));
        if (commit === undefined) throw httpError(method, url, 404, "Not Found");
        return {
          status: 200,
          json: {
            sha: commit.sha,
            tree: { sha: commit.treeSha },
            parents: commit.parents.map((sha) => ({ sha })),
            message: commit.message,
          },
        };
      }

      if (method === "GET" && (match = m(/^\/repos\/[^/]+\/[^/]+\/git\/trees\/([^/?]+)(\?.*)?$/))) {
        const treeSha = decodeURIComponent(match[1]);
        const tree = this.trees.get(treeSha);
        if (tree === undefined) throw httpError(method, url, 404, "Not Found");
        return {
          status: 200,
          json: {
            sha: treeSha,
            truncated: this.truncatedTrees,
            tree: [...tree.entries()].map(([p, s]) => ({
              path: p,
              type: "blob",
              mode: "100644",
              sha: s,
              // Real GitHub trees API reports blob size — the engine's
              // remote-side size cap keys off it (test-fixture-realism).
              size: this.blobs.get(s)?.byteLength ?? 0,
            })),
          },
        };
      }

      if (method === "GET" && (match = m(/^\/repos\/[^/]+\/[^/]+\/git\/blobs\/([^/?]+)$/))) {
        const content = this.blobs.get(decodeURIComponent(match[1]));
        if (content === undefined) throw httpError(method, url, 404, "Not Found");
        return {
          status: 200,
          json: { sha: match[1], content: chunkBase64(content), encoding: "base64" },
        };
      }

      if (method === "POST" && m(/^\/repos\/[^/]+\/[^/]+\/git\/blobs$/)) {
        // Binary upload path (Phase C): base64 in, REAL git blob SHA out —
        // computed over the decoded bytes, exactly as GitHub does.
        const body = JSON.parse(req.body ?? "{}") as {
          content?: string;
          encoding?: string;
        };
        if (typeof body.content !== "string" || body.encoding !== "base64") {
          throw httpError(method, url, 422, "expected base64 blob payload");
        }
        const bytes = Buffer.from(body.content.replace(/\s/g, ""), "base64");
        const blobSha = gitBlobShaSync(new Uint8Array(bytes));
        this.blobs.set(blobSha, bytes);
        return { status: 201, json: { sha: blobSha } };
      }

      if (method === "POST" && m(/^\/repos\/[^/]+\/[^/]+\/git\/trees$/)) {
        const body = JSON.parse(req.body ?? "{}") as {
          base_tree?: string;
          tree?: Array<{ path: string; content?: string; sha?: string | null }>;
        };
        // GitHub accepts a commitish base_tree (peels commit → tree).
        let base = new Map<string, string>();
        if (body.base_tree !== undefined) {
          const viaCommit = this.commits.get(body.base_tree);
          const baseTree = this.trees.get(viaCommit?.treeSha ?? body.base_tree);
          if (baseTree === undefined) {
            throw httpError(method, url, 404, "base_tree not found");
          }
          base = new Map(baseTree);
        }
        for (const entry of body.tree ?? []) {
          // Three production shapes: inline `content` (UTF-8 text), a `sha`
          // reference to a previously-uploaded blob (binary, Phase C), or
          // `sha: null` — DELETE the path from the base tree (#3476).
          if (entry.sha === null) {
            // Real GitHub rejects a sha:null entry whose path is absent
            // from base_tree with HTTP 422 GitRPC::BadObjectState
            // (empirically verified against api.github.com, 2026-06-12).
            if (!base.has(entry.path)) {
              throw httpError(method, url, 422, "GitRPC::BadObjectState");
            }
            base.delete(entry.path);
            continue;
          }
          if (typeof entry.sha === "string") {
            if (!this.blobs.has(entry.sha)) {
              throw httpError(method, url, 404, `blob ${entry.sha} not found`);
            }
            base.set(entry.path, entry.sha);
            continue;
          }
          if (typeof entry.content !== "string") {
            throw httpError(method, url, 422, "tree entry without content");
          }
          const blobSha = gitBlobShaSync(entry.content);
          this.blobs.set(blobSha, Buffer.from(entry.content, "utf-8"));
          base.set(entry.path, blobSha);
        }
        // Real GitHub cannot create an EMPTY tree — deleting every entry
        // fails HTTP 404 Not Found (empirically verified, 2026-06-12).
        if (base.size === 0) {
          throw httpError(method, url, 404, "Not Found");
        }
        return { status: 201, json: { sha: this.storeTree(base) } };
      }

      if (method === "POST" && m(/^\/repos\/[^/]+\/[^/]+\/git\/commits$/)) {
        const body = JSON.parse(req.body ?? "{}") as {
          message: string;
          tree: string;
          parents: string[];
        };
        if (!this.trees.has(body.tree)) {
          throw httpError(method, url, 422, "tree not found");
        }
        const sha = this.newCommitSha(body.tree, body.parents, body.message);
        this.commits.set(sha, {
          sha,
          treeSha: body.tree,
          parents: body.parents,
          message: body.message,
        });
        return { status: 201, json: { sha } };
      }

      if (method === "PATCH" && (match = m(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/))) {
        this.onBeforePatch?.();
        const branch = decodeURIComponent(match[1]);
        const body = JSON.parse(req.body ?? "{}") as { sha: string; force?: boolean };
        const commit = this.commits.get(body.sha);
        if (commit === undefined) throw httpError(method, url, 422, "object does not exist");
        const current = this.refs.get(branch);
        if (body.force !== true && commit.parents[0] !== current) {
          // force:false fast-forward enforcement — the production 422 signal.
          throw httpError(method, url, 422, "Update is not a fast forward");
        }
        this.refs.set(branch, body.sha);
        return { status: 200, json: { object: { sha: body.sha } } };
      }

      throw httpError(method, url, 404, `unhandled fake route`);
    };
  }
}

/**
 * In-memory LocalFilesPort. Mirrors the production adapter contract:
 * `read` is a text decode (corrupts binary — exactly like the real
 * DataAdapter.read), `readBinary`/`writeBinary` are byte-exact.
 */
export class FakeLocalFiles implements LocalFilesPort {
  readonly files: Map<string, FakeFileContent>;
  constructor(initial: Record<string, FakeFileContent> = {}) {
    this.files = new Map(Object.entries(initial));
  }
  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return typeof content === "string"
      ? content
      : Buffer.from(content).toString("utf-8"); // lossy — like prod read()
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path); // no-op when absent, per port contract
  }
  async readBinary(path: string): Promise<Uint8Array> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return typeof content === "string"
      ? new Uint8Array(Buffer.from(content, "utf-8"))
      : content;
  }
  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }
}

/** Text-only port (no readBinary/writeBinary) — Phase B-era adapters. */
export class FakeTextOnlyLocalFiles implements LocalFilesPort {
  private readonly inner: FakeLocalFiles;
  constructor(initial: Record<string, string> = {}) {
    this.inner = new FakeLocalFiles(initial);
  }
  list(): Promise<string[]> {
    return this.inner.list();
  }
  read(path: string): Promise<string> {
    return this.inner.read(path);
  }
  write(path: string, content: string): Promise<void> {
    return this.inner.write(path, content);
  }
  delete(path: string): Promise<void> {
    return this.inner.delete(path);
  }
}

/** In-memory WatermarkStorePort. */
export class FakeWatermarkStore implements WatermarkStorePort {
  readonly records = new Map<string, WatermarkRecord>();
  async get(repoKey: string): Promise<WatermarkRecord | null> {
    return this.records.get(repoKey) ?? null;
  }
  async set(repoKey: string, record: WatermarkRecord): Promise<void> {
    this.records.set(repoKey, record);
  }
}

/** In-memory MountBaseStorePort (#3590) — records the mounted commit SHA. */
export class FakeMountBaseStore implements MountBaseStorePort {
  readonly shas = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.shas.set(k, v);
  }
  async get(repoKey: string): Promise<string | null> {
    return this.shas.get(repoKey) ?? null;
  }
  async set(repoKey: string, sha: string): Promise<void> {
    this.shas.set(repoKey, sha);
  }
}

export function alwaysMaterialized(): MaterializationCheckPort {
  return { check: async () => ({ fullyMaterialized: true }) };
}

export function neverMaterialized(reason: string): MaterializationCheckPort {
  return { check: async () => ({ fullyMaterialized: false, reason }) };
}

export function mdAsset(uid: string, body = "body"): string {
  return `---\nexo__Asset_uid: ${uid}\nexo__Asset_label: "Asset ${uid}"\n---\n\n${body}\n`;
}
