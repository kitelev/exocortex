/**
 * @jest-environment node
 *
 * Reason: the REST mount decompresses tarballs via Web Streams
 * (CompressionStream/DecompressionStream) which jest-environment-jsdom does NOT
 * expose. The `node` environment supplies both.
 *
 * Mobile (#3535) cold-start integration — exercises the REAL
 * {@link RestAssetSpaceMount} wired into {@link BootstrapAssetSpaceCommands}
 * through the `restMount` strategy (the cross-platform path), against an
 * in-memory `vault.adapter` that mirrors the Obsidian DataAdapter contract.
 *
 * This is the mobile counterpart of `BootstrapAssetSpace.integration.test.ts`
 * (which uses the REAL desktop `GitSubmoduleOps` + a tmpdir). Here NO Node `fs`
 * is touched — every write goes through `vault.adapter`, and the only fake is
 * the GitHub HTTP client (real gzipped tarball, per test-fixture-realism).
 *
 * Proves the end-to-end mobile contract a fresh iPhone vault relies on:
 *   empty vault → bootstrap → exo + exocmd materialised via vault.adapter +
 *   `.gitmodules` written; then add-assetspace → a third entry — all readable
 *   back via `RestAssetSpaceMount.readGitmodulesEntries`, which is exactly what
 *   apply-profile (`listAllAssetSpaceInfos`) consumes next.
 *
 * Revert-verify (mobile): remove the `restMount` branch from
 * `BootstrapAssetSpaceCommands.materialize` / `listTrackedEntries` and these
 * tests FAIL (the class falls through to the absent desktop deps and throws).
 */

import type { App } from "obsidian";
import { createTar } from "nanotar";

import { RestAssetSpaceMount } from "../../../src/infrastructure/adapters/RestAssetSpaceMount";
import type { GitHubRestClient } from "../../../src/infrastructure/adapters/GitHubRestClient";
import { BootstrapAssetSpaceCommands } from "../../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";

const EXO_URL = "https://github.com/kitelev/exoas-exo";
const EXOCMD_URL = "https://github.com/kitelev/exoas-exocmd";
const PMBOK_URL = "https://github.com/kitelev/exoas-pmbok-ontology";

// ─── Fakes ────────────────────────────────────────────────────────────────

/**
 * In-memory DataAdapter mirroring the real Obsidian contract. `exists` is
 * ANCESTOR-aware (a parent of an existing file/dir exists, like a real FS), so
 * `hasMaterializedAssetSpaces` classifies a freshly materialised vault
 * correctly. `writeBinary` does NOT auto-create parents (RestAssetSpaceMount
 * ensures the dir chain itself).
 */
class InMemoryAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly textFiles = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly orphanWrites: string[] = [];

  private allKeys(): string[] {
    return [...this.files.keys(), ...this.textFiles.keys(), ...this.dirs];
  }

  async exists(p: string): Promise<boolean> {
    if (this.files.has(p) || this.textFiles.has(p) || this.dirs.has(p)) {
      return true;
    }
    // A directory exists if any known path is under it (real-FS semantics).
    const prefix = p.replace(/\/+$/, "") + "/";
    return this.allKeys().some((k) => k.startsWith(prefix));
  }

  async read(p: string): Promise<string> {
    const t = this.textFiles.get(p);
    if (t !== undefined) return t;
    const b = this.files.get(p);
    if (b !== undefined) return new TextDecoder().decode(b);
    throw new Error(`ENOENT: ${p}`);
  }

  async write(p: string, data: string): Promise<void> {
    this.textFiles.set(p, data);
    this.files.delete(p);
  }

  async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
    const parent = p.slice(0, p.lastIndexOf("/"));
    if (parent.length > 0 && !this.dirs.has(parent)) {
      this.orphanWrites.push(p);
    }
    this.files.set(p, new Uint8Array(data));
    this.textFiles.delete(p);
  }

  async mkdir(p: string): Promise<void> {
    this.dirs.add(p);
  }

  async rmdir(p: string, recursive: boolean): Promise<void> {
    this.dirs.delete(p);
    if (!recursive) return;
    const prefix = p + "/";
    for (const k of [...this.files.keys()]) {
      if (k.startsWith(prefix)) this.files.delete(k);
    }
    for (const k of [...this.textFiles.keys()]) {
      if (k.startsWith(prefix)) this.textFiles.delete(k);
    }
    for (const k of [...this.dirs]) {
      if (k.startsWith(prefix)) this.dirs.delete(k);
    }
  }

  /** Obsidian DataAdapter.list — immediate children as full vault paths. */
  async list(dir: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = dir === "" ? "" : dir.replace(/\/+$/, "") + "/";
    const files = new Set<string>();
    const folders = new Set<string>();
    const consider = (full: string, isDir: boolean): void => {
      if (!full.startsWith(prefix)) return;
      const rest = full.slice(prefix.length);
      if (rest.length === 0) return;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        (isDir ? folders : files).add(prefix + rest);
      } else {
        folders.add(prefix + rest.slice(0, slash));
      }
    };
    for (const k of this.files.keys()) consider(k, false);
    for (const k of this.textFiles.keys()) consider(k, false);
    for (const d of this.dirs) consider(d, true);
    return { files: [...files], folders: [...folders] };
  }
}

interface FakeClient {
  fetchTarballBuffer: jest.Mock<Promise<ArrayBuffer>, [string, string, string]>;
  ensureRateLimit: jest.Mock<Promise<void>, [number]>;
}

/**
 * Per-repo tarball router — returns a real gzipped tarball whose single file is
 * named after the repo so we can assert the right content landed in the right
 * folder. The wrapper dir uses GitHub's `<owner>-<repo>-<sha7>/` convention.
 */
function makeRoutingClient(): FakeClient {
  return {
    ensureRateLimit: jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined),
    fetchTarballBuffer: jest
      .fn<Promise<ArrayBuffer>, [string, string, string]>()
      .mockImplementation(async (owner, repo) => {
        return makeTarball(`${owner}-${repo}-abc1234`, [
          {
            name: `${repo}.md`,
            data: new TextEncoder().encode(`# ${repo}\n`),
          },
        ]);
      }),
  };
}

async function makeTarball(
  wrapper: string,
  entries: Array<{ name: string; data: Uint8Array }>,
): Promise<ArrayBuffer> {
  const files = entries.map((e) => ({
    name: `${wrapper}/${e.name}`,
    data: e.data,
  }));
  const tarBuf = createTar(files);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(tarBuf);
      c.close();
    },
  }).pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function makeCmds(
  adapter: InMemoryAdapter,
  notices: string[],
  prompts: {
    bootstrapUrls?: { exoUrl: string; exocmdUrl: string } | null;
    addUrl?: { url: string } | null;
  },
): { cmds: BootstrapAssetSpaceCommands; restMount: RestAssetSpaceMount } {
  const app = { vault: { adapter } } as unknown as App;
  const restMount = new RestAssetSpaceMount({
    app,
    client: makeRoutingClient() as unknown as GitHubRestClient,
  });
  const deriveFolderName = (url: string): string => {
    const m = url.match(/github\.com\/[^/]+\/([^/]+)$/);
    const repo = m ? m[1] : "unknown";
    return repo.startsWith("exoas-") ? repo.slice("exoas-".length) : repo;
  };
  const cmds = new BootstrapAssetSpaceCommands({
    // Mobile: ONLY restMount wired (no getPuller / gitOps / localStore).
    restMount,
    vaultExists: (p) => adapter.exists(p),
    listFolder: (dir) => adapter.list(dir),
    isGitVault: () => adapter.exists(".git"),
    validateUrl: (url) => {
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(url)) {
        throw new Error(`invalid url: ${url}`);
      }
    },
    deriveFolderName,
    promptBootstrapUrls: async () =>
      prompts.bootstrapUrls === undefined
        ? { exoUrl: EXO_URL, exocmdUrl: EXOCMD_URL }
        : prompts.bootstrapUrls,
    promptAddAssetSpaceUrl: async () =>
      prompts.addUrl === undefined ? { url: PMBOK_URL } : prompts.addUrl,
    confirm: async () => true,
    notify: (m: string) => notices.push(m),
  });
  return { cmds, restMount };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Mobile bootstrap integration — real RestAssetSpaceMount + vault.adapter (#3535)", () => {
  it("empty vault → bootstrap materialises exo + exocmd via vault.adapter + writes .gitmodules", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    await cmds.invokeBootstrap();

    // Content materialised at the Maven path, wrapper stripped — via writeBinary
    // (vault.adapter), never Node fs.
    expect(adapter.files.has("assetspaces/kitelev/exoas-exo/exoas-exo.md")).toBe(
      true,
    );
    expect(
      adapter.files.has("assetspaces/kitelev/exoas-exocmd/exoas-exocmd.md"),
    ).toBe(true);
    expect(adapter.orphanWrites).toEqual([]);

    // .gitmodules written via vault.adapter (text file), readable back.
    const entries = await restMount.readGitmodulesEntries();
    expect(entries).toEqual([
      { submodulePath: "assetspaces/kitelev/exoas-exo", url: EXO_URL },
      { submodulePath: "assetspaces/kitelev/exoas-exocmd", url: EXOCMD_URL },
    ]);

    expect(notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
    expect(notices.some((n) => /file-only mode/.test(n))).toBe(false);
  });

  it("after bootstrap, add-assetspace appends a third .gitmodules entry + materialises it", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    await cmds.invokeBootstrap();
    await cmds.invokeAddAssetSpace();

    expect(
      adapter.files.has("assetspaces/pmbok-ontology/exoas-pmbok-ontology.md"),
    ).toBe(true);

    const entries = await restMount.readGitmodulesEntries();
    expect(entries.map((e) => e.submodulePath)).toEqual([
      "assetspaces/kitelev/exoas-exo",
      "assetspaces/kitelev/exoas-exocmd",
      "assetspaces/pmbok-ontology",
    ]);
    expect(notices.some((n) => /AssetSpace added/.test(n))).toBe(true);
  });

  it("re-running bootstrap on the now-materialised vault is a no-op (idempotent)", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    await cmds.invokeBootstrap();
    const before = await restMount.readGitmodulesEntries();
    notices.length = 0;

    await cmds.invokeBootstrap();
    const after = await restMount.readGitmodulesEntries();

    expect(after).toEqual(before);
    expect(notices.some((n) => /already has AssetSpaces/.test(n))).toBe(true);
  });
});
