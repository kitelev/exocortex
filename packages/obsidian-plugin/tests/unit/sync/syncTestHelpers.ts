/**
 * ExoSync Phase B test helpers (RFC 4e4dc453).
 *
 * Production-shape by design (test-fixture-realism):
 *
 *  - {@link InMemoryAdapter} mirrors the REAL `DataAdapter` contracts the
 *    wiring depends on: `list()` is NON-recursive, `write()` fails when the
 *    parent folder does not exist (desktop fs ENOENT), and `rename()` fails
 *    when the target exists (the mobile semantics that forced the
 *    remove-target-first atomic-write order).
 *  - {@link fakeRequestUrlRouter} adapts the existing `FakeGitHubRepo` Git
 *    Data API state machine to the `requestUrl` layer: the fake transport
 *    THROWS `GitHub request {M} {url} → HTTP {N}: {body}` on non-2xx, while
 *    the real `requestUrl({throw:false})` RETURNS the non-2xx response — so
 *    the router converts throw → `{status, text}` and the REAL
 *    `GitHubRestClient.request()` re-builds the production error message
 *    itself. The error-shape contract (`isNonFastForwardError`,
 *    `isRateLimitError`, `isAuthError`) is therefore exercised end-to-end.
 */

import type { FakeGitHubRepo } from "../../../../exocortex/tests/unit/services/sync/fakeGitHub";

/** Minimal `RequestUrlResponse`-shaped object. */
export interface FakeRequestUrlResponse {
  status: number;
  json?: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
}

interface FakeRequestUrlParam {
  url: string;
  method?: string;
  body?: string;
  [key: string]: unknown;
}

/**
 * In-memory `DataAdapter` stand-in with the real adapter's strictness (see
 * module docstring). Paths are vault-relative forward-slash, no leading `/`.
 */
export class InMemoryAdapter {
  readonly files = new Map<string, string | Uint8Array>();
  readonly dirs = new Set<string>([""]);

  private parent(p: string): string {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    // Real DataAdapter.read decodes bytes as UTF-8 (lossy for binary).
    return typeof content === "string"
      ? content
      : Buffer.from(content).toString("utf-8");
  }

  async write(path: string, content: string): Promise<void> {
    if (!this.dirs.has(this.parent(path))) {
      throw new Error(`ENOENT: parent folder of ${path} does not exist`);
    }
    this.files.set(path, content);
  }

  /** Real `DataAdapter.readBinary` shape — ArrayBuffer, byte-exact. */
  async readBinary(path: string): Promise<ArrayBuffer> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    const bytes =
      typeof content === "string"
        ? new Uint8Array(Buffer.from(content, "utf-8"))
        : content;
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  /** Real `DataAdapter.writeBinary` shape — same parent strictness. */
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    if (!this.dirs.has(this.parent(path))) {
      throw new Error(`ENOENT: parent folder of ${path} does not exist`);
    }
    this.files.set(path, new Uint8Array(data));
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    // Mobile semantics — rename onto an existing target fails.
    if (this.files.has(to)) {
      throw new Error(`EEXIST: ${to}`);
    }
    if (!this.dirs.has(this.parent(to))) {
      throw new Error(`ENOENT: parent folder of ${to} does not exist`);
    }
    this.files.delete(from);
    this.files.set(to, content);
  }

  async mkdir(path: string): Promise<void> {
    if (!this.dirs.has(this.parent(path))) {
      throw new Error(`ENOENT: parent folder of ${path} does not exist`);
    }
    this.dirs.add(path);
  }

  /** NON-recursive listing, full paths — the real `DataAdapter.list` shape. */
  async list(dir: string): Promise<{ files: string[]; folders: string[] }> {
    if (!this.dirs.has(dir)) throw new Error(`ENOENT: ${dir}`);
    const prefix = dir.length > 0 ? `${dir}/` : "";
    const files: string[] = [];
    const folders: string[] = [];
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
        files.push(f);
      }
    }
    for (const d of this.dirs) {
      if (
        d.length > prefix.length &&
        d.startsWith(prefix) &&
        !d.slice(prefix.length).includes("/")
      ) {
        folders.push(d);
      }
    }
    return { files, folders };
  }

  /** Test convenience — create a folder chain without parent checks. */
  mkdirAll(path: string): void {
    const segments = path.split("/").filter((s) => s.length > 0);
    let current = "";
    for (const s of segments) {
      current = current.length === 0 ? s : `${current}/${s}`;
      this.dirs.add(current);
    }
  }

  /** Test convenience — write a file, creating parent folders. */
  seedFile(path: string, content: string): void {
    const i = path.lastIndexOf("/");
    if (i > 0) this.mkdirAll(path.slice(0, i));
    this.files.set(path, content);
  }
}

/** Markdown file stub — only `path` is consumed by the wiring under test. */
export interface FakeMdFile {
  path: string;
}

export interface MakeAppOptions {
  adapter: InMemoryAdapter;
  /** Vault markdown files (collectSyncRepoSpecs walk). */
  mdFiles?: FakeMdFile[];
  /** path → frontmatter for `metadataCache.getFileCache`. */
  frontmatters?: Map<string, Record<string, unknown>>;
  configDir?: string;
}

/** Minimal `App`-shaped object covering exactly what the wiring reads. */
export function makeApp(opts: MakeAppOptions): {
  vault: {
    adapter: InMemoryAdapter;
    configDir: string;
    getMarkdownFiles: () => FakeMdFile[];
  };
  metadataCache: {
    getFileCache: (file: FakeMdFile) => {
      frontmatter: Record<string, unknown>;
    } | null;
  };
} {
  const fms = opts.frontmatters ?? new Map<string, Record<string, unknown>>();
  return {
    vault: {
      adapter: opts.adapter,
      configDir: opts.configDir ?? ".obsidian",
      getMarkdownFiles: () => opts.mdFiles ?? [],
    },
    metadataCache: {
      getFileCache: (file: FakeMdFile) => {
        const fm = fms.get(file.path);
        return fm !== undefined ? { frontmatter: fm } : null;
      },
    },
  };
}

/**
 * Route `requestUrl` calls to per-repo {@link FakeGitHubRepo} state machines
 * by the `/repos/<owner>/<repo>/` URL segment. Unknown repos → HTTP 404.
 * Fake-transport throws are converted to non-2xx responses (the real
 * `requestUrl({throw:false})` contract — see module docstring).
 */
export function fakeRequestUrlRouter(
  repos: Record<string, FakeGitHubRepo>,
): (param: FakeRequestUrlParam) => Promise<FakeRequestUrlResponse> {
  const transports = new Map(
    Object.entries(repos).map(([key, repo]) => [key, repo.transport()]),
  );
  return async (param) => {
    const m = /\/repos\/([^/]+)\/([^/]+)\//.exec(param.url);
    const key = m !== null ? `${m[1]}/${m[2]}` : "";
    const transport = transports.get(key);
    if (transport === undefined) {
      return {
        status: 404,
        text: `no fake repo for ${key}`,
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      };
    }
    try {
      const resp = await transport({
        method: (param.method ?? "GET") as "GET" | "POST" | "PATCH",
        url: param.url,
        ...(typeof param.body === "string" ? { body: param.body } : {}),
      });
      return {
        status: resp.status ?? 200,
        json: resp.json,
        text: JSON.stringify(resp.json ?? null),
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const httpMatch = /HTTP (\d+): ([\s\S]*)$/.exec(msg);
      if (httpMatch !== null) {
        return {
          status: Number(httpMatch[1]),
          text: httpMatch[2],
          arrayBuffer: new ArrayBuffer(0),
          headers: {},
        };
      }
      throw err;
    }
  };
}

/** AssetSpace class UID (exo__AssetSpace TBox root). */
export const AS_CLASS_WIKILINK = "[[73bd00e4-ccc0-4f3f-b20d-c4388c4588fb]]";

/** Frontmatter for one AssetSpace ABox pointing at a GitHub source. */
export function assetSpaceFm(
  asUid: string,
  source: string,
): Record<string, unknown> {
  return {
    exo__Instance_class: [AS_CLASS_WIKILINK],
    exo__Asset_uid: asUid,
    exo__AssetSpace_source: source,
  };
}
