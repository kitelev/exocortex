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
 *   empty vault → bootstrap → exo materialised via vault.adapter (exo-only clean
 *   bootstrap, 2026-06-20) and — RFC 0005 Phase 1 — NO `.gitmodules` written;
 *   then add-assetspace → a second folder. The mounted set is read back by
 *   enumerating the materialised `assetspaces/<owner>/<repo>` folders +
 *   re-deriving each URL via `RestAssetSpaceMount.listMountedAssetSpaces`, which
 *   is exactly what apply-profile (`listAllAssetSpaceInfos`, already filesystem-
 *   based) consumes next.
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
    bootstrapUrls?: { exoUrl: string } | null;
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
        ? { exoUrl: EXO_URL }
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
  it("empty vault → bootstrap materialises exo only via vault.adapter; the mounted set is read back from the filesystem (RFC 0005 Phase 1, no .gitmodules) @req:b02a3994-91a2-4b87-8872-fbac860e5630", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    await cmds.invokeBootstrap();

    // Exo-only clean bootstrap (2026-06-20): exo content materialised at the
    // Maven path, wrapper stripped — via writeBinary (vault.adapter), never Node
    // fs. exocmd is NOT materialised by bootstrap (added later).
    expect(adapter.files.has("assetspaces/kitelev/exoas-exo/exoas-exo.md")).toBe(
      true,
    );
    expect(
      adapter.files.has("assetspaces/kitelev/exoas-exocmd/exoas-exocmd.md"),
    ).toBe(false);
    expect(adapter.orphanWrites).toEqual([]);

    // RFC 0005 Phase 1 — WRITER STOPPED: a git-free vault carries NO .gitmodules
    // sidecar. (Re-instating the appendGitmodulesEntry write in
    // RestAssetSpaceMount.mount makes this RED — revert-verified.)
    expect(adapter.textFiles.has(".gitmodules")).toBe(false);
    expect(await adapter.exists(".gitmodules")).toBe(false);

    // READER from the FILESYSTEM: the mounted set + URLs are reconstructed by
    // enumerating assetspaces/<owner>/<repo> and deriveUrl(path) — NOT from a
    // .gitmodules registry (which does not exist). (Reverting
    // listMountedAssetSpaces to read .gitmodules returns [] here — revert-verified.)
    const entries = await restMount.listMountedAssetSpaces();
    expect(entries).toEqual([
      { submodulePath: "assetspaces/kitelev/exoas-exo", url: EXO_URL },
    ]);

    expect(notices.some((n) => /Bootstrap complete/.test(n))).toBe(true);
    expect(notices.some((n) => /file-only mode/.test(n))).toBe(false);
  });

  it("after exo-only bootstrap, add-assetspace materialises a second AssetSpace at the canonical Maven path; both appear in the filesystem-derived mounted set (#3538) @req:59afd046-eb41-4fd5-a03a-062a53d0acc5", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    await cmds.invokeBootstrap();
    await cmds.invokeAddAssetSpace();

    // #3538: add-assetspace materialises at the canonical Maven path
    // `assetspaces/<owner>/<repo>` (parity with bootstrap + apply-profile), NOT
    // the old flat `assetspaces/<name>`.
    expect(
      adapter.files.has(
        "assetspaces/kitelev/exoas-pmbok-ontology/exoas-pmbok-ontology.md",
      ),
    ).toBe(true);

    // RFC 0005 Phase 1 — still no .gitmodules; the mounted set is enumerated
    // from the two materialised folders (exo from bootstrap + pmbok from add).
    expect(adapter.textFiles.has(".gitmodules")).toBe(false);
    const entries = await restMount.listMountedAssetSpaces();
    expect(entries.map((e) => e.submodulePath).sort()).toEqual([
      "assetspaces/kitelev/exoas-exo",
      "assetspaces/kitelev/exoas-pmbok-ontology",
    ]);
    expect(notices.some((n) => /AssetSpace added/.test(n))).toBe(true);
  });

  it("re-running bootstrap on the now-materialised vault is a no-op (idempotent)", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    await cmds.invokeBootstrap();
    const before = await restMount.listMountedAssetSpaces();
    notices.length = 0;

    await cmds.invokeBootstrap();
    const after = await restMount.listMountedAssetSpaces();

    expect(after).toEqual(before);
    expect(notices.some((n) => /already has AssetSpaces/.test(n))).toBe(true);
  });

  it("clone-needs-fetch — present-but-empty assetspaces/<owner>/<repo> folder (no .gitmodules) is detected + re-fetched from the filesystem-derived URL @req:b02a3994-91a2-4b87-8872-fbac860e5630", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { cmds, restMount } = makeCmds(adapter, notices, {});

    // Simulate a vault synced WITHOUT content: the canonical Maven folder exists
    // but is empty, and there is NO .gitmodules registry (git-free, RFC 0005
    // Phase 1). The state must be derived from the filesystem alone.
    await adapter.mkdir("assetspaces");
    await adapter.mkdir("assetspaces/kitelev");
    await adapter.mkdir("assetspaces/kitelev/exoas-exo");
    expect(adapter.textFiles.has(".gitmodules")).toBe(false);

    // Detection: the empty folder is enumerated (tracked) but has no .md content
    // → clone-needs-fetch (NOT "empty", NOT "bootstrapped"). Reverting
    // listTrackedEntries to read .gitmodules would yield [] → "empty" here.
    expect(await cmds.detectVaultState()).toBe("clone-needs-fetch");

    // Bootstrap on this state re-materialises each tracked folder from its
    // deriveUrl(folderPath) URL (confirm=true wired in makeCmds), filling the
    // empty folder with content — without any stored .gitmodules URL.
    await cmds.invokeBootstrap();

    expect(adapter.files.has("assetspaces/kitelev/exoas-exo/exoas-exo.md")).toBe(
      true,
    );
    expect(adapter.textFiles.has(".gitmodules")).toBe(false);
    const entries = await restMount.listMountedAssetSpaces();
    expect(entries).toEqual([
      { submodulePath: "assetspaces/kitelev/exoas-exo", url: EXO_URL },
    ]);
    expect(notices.some((n) => /Fetched 1\/1/.test(n))).toBe(true);
  });

  it("enumerates exactly the canonical 2-level owner/repo — does not descend into a repo's namespace subdirs, and skips a stray one-level folder @req:b02a3994-91a2-4b87-8872-fbac860e5630", async () => {
    const adapter = new InMemoryAdapter();
    const notices: string[] = [];
    const { restMount } = makeCmds(adapter, notices, {});

    // A canonical mount whose content sits a level deeper (owner/repo/<ns>/file)
    // — the real EKA layout — plus a stray one-level folder directly under
    // assetspaces/ (a legacy flat remnant).
    await adapter.writeBinary(
      "assetspaces/kitelev/exoas-exo/exo/Class.md",
      new TextEncoder().encode("x").buffer,
    );
    await adapter.mkdir("assetspaces/kitelev/exoas-exo/exo");
    await adapter.mkdir("assetspaces/kitelev/exoas-exo");
    await adapter.mkdir("assetspaces/kitelev");
    await adapter.mkdir("assetspaces");
    await adapter.mkdir("assetspaces/legacyflat"); // one level → no owner/repo pair

    const entries = await restMount.listMountedAssetSpaces();
    // Exactly the canonical assetspaces/<owner>/<repo>: the enum stops at two
    // levels (it does NOT surface the inner `exo/` namespace as a fake
    // owner/repo), and the one-level `legacyflat` (no second-level child)
    // contributes nothing.
    expect(entries).toEqual([
      { submodulePath: "assetspaces/kitelev/exoas-exo", url: EXO_URL },
    ]);
  });
});
