/**
 * @jest-environment node
 *
 * Reason: mount() decompresses tarballs via Web Streams
 * (CompressionStream/DecompressionStream) which jest-environment-jsdom does
 * NOT expose. node environment supplies both.
 *
 * RestAssetSpaceMount — RFC 01a83de8 Phase 3 (T1). Cross-platform (incl. iOS)
 * AssetSpace mount/unmount via GitHub REST tarball + `vault.adapter` (no git
 * binary, no node:fs). Fixtures use real `nanotar.createTar` + native gzip per
 * the test-fixture-realism rule (no stub-returning-fixed-bytes). The fake
 * `vault.adapter` mirrors the real Obsidian DataAdapter contract: `mkdir` is
 * NON-recursive, `rmdir(path, true)` removes the subtree, `read` throws on a
 * missing file, `writeBinary` does NOT auto-create parents.
 *
 * Coverage (RFC 0005 Phase 1 — git-free vault carries no `.gitmodules`):
 *   1. Happy path — files materialise under mount folder, content round-trips,
 *      nested dirs created, NO `.gitmodules` written, sha returned.
 *   2. Re-mount writes no `.gitmodules` on either pass.
 *   3. Mount does not touch a pre-existing legacy `.gitmodules`.
 *   4. unmount — removes folder subtree AND strips a pre-existing legacy
 *      `.gitmodules` stanza (hygiene).
 *   5. unmount idempotent — missing folder / absent stanza = no-op.
 *   6. Empty tarball → throws.
 *   7. Zip-slip (absolute path) → throws, no escape write.
 *   8. Rate-limit gate fires before any fetch.
 *   9. Invalid repo URL → throws before any REST call.
 *  10. Invalid submodule path (traversal) → throws.
 *  11. listMountedAssetSpaces — enumerates `assetspaces/<owner>/<repo>` folders +
 *      `deriveUrl`, ignoring any `.gitmodules`.
 */

import type { App } from "obsidian";
import { createTar } from "nanotar";

import { RestAssetSpaceMount } from "../../../../src/infrastructure/adapters/RestAssetSpaceMount";
import type { GitHubRestClient } from "../../../../src/infrastructure/adapters/GitHubRestClient";

// ─── Fakes ────────────────────────────────────────────────────────────────

interface FakeClient {
  fetchTarballBuffer: jest.Mock<Promise<ArrayBuffer>, [string, string, string]>;
  ensureRateLimit: jest.Mock<Promise<void>, [number]>;
}

function makeFakeClient(tarball: ArrayBuffer): FakeClient {
  return {
    fetchTarballBuffer: jest
      .fn<Promise<ArrayBuffer>, [string, string, string]>()
      .mockResolvedValue(tarball),
    ensureRateLimit: jest
      .fn<Promise<void>, [number]>()
      .mockResolvedValue(undefined),
  };
}

/**
 * In-memory DataAdapter mirroring the real Obsidian contract:
 *   - `mkdir` creates ONE dir level only (not recursive).
 *   - `writeBinary` does NOT create missing parents (would ENOENT on disk).
 *   - `rmdir(path, true)` removes the subtree; `rmdir(path, false)` only the
 *     leaf (modelled identically here since we always pass recursive=true).
 *   - `read` throws on a missing file.
 *   - `exists` is true for a known file OR known directory.
 */
class InMemoryAdapter {
  readonly files = new Map<string, Uint8Array>();
  readonly textFiles = new Map<string, string>();
  readonly dirs = new Set<string>();
  /** Records writeBinary targets whose parent dir was missing at write time. */
  readonly orphanWrites: string[] = [];

  async exists(p: string): Promise<boolean> {
    if (this.files.has(p) || this.textFiles.has(p) || this.dirs.has(p)) {
      return true;
    }
    // A directory exists if any known path is under it (real-FS / Obsidian
    // DataAdapter semantics) — mount() only mkdir's the leaf path, so an
    // ancestor like `assetspaces` must still report existing.
    const prefix = p.replace(/\/+$/, "") + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    for (const k of this.textFiles.keys()) if (k.startsWith(prefix)) return true;
    for (const d of this.dirs) if (d.startsWith(prefix)) return true;
    return false;
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

function makeApp(adapter: InMemoryAdapter): App {
  return {
    vault: { adapter },
  } as unknown as App;
}

/**
 * Build a gzipped tarball wrapping `entries` under `wrapper`
 * (GitHub REST convention `<owner>-<repo>-<sha7>/`). Byte-identical to what
 * GitHub emits (modulo timestamps/UID/GID).
 */
async function makeTarball(
  wrapper: string,
  entries: Array<{ name: string; data?: Uint8Array }>,
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

const URL_OK = "https://github.com/kitelev/exoas-ems";
const PATH_OK = "assetspaces/kitelev/exoas-ems";

function makeMount(
  adapter: InMemoryAdapter,
  client: FakeClient,
): RestAssetSpaceMount {
  return new RestAssetSpaceMount({
    app: makeApp(adapter),
    client: client as unknown as GitHubRestClient,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("RestAssetSpaceMount.mount", () => {
  it("materialises tarball files under the mount folder and writes NO .gitmodules (RFC 0005 Phase 1)", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("# EMS\n") },
      { name: "ontology/Task.md", data: new TextEncoder().encode("task body") },
    ]);
    const client = makeFakeClient(tarball);
    const mount = makeMount(adapter, client);

    const result = await mount.mount(URL_OK, PATH_OK, "main");

    expect(result.sha).toBe("abc1234");
    expect(result.fileCount).toBe(2);

    // Files written under the mount folder with wrapper stripped.
    expect(adapter.files.has(`${PATH_OK}/README.md`)).toBe(true);
    expect(adapter.files.has(`${PATH_OK}/ontology/Task.md`)).toBe(true);
    expect(
      new TextDecoder().decode(adapter.files.get(`${PATH_OK}/README.md`)),
    ).toBe("# EMS\n");

    // Nested dir created before writing the nested file (no orphan write).
    expect(adapter.dirs.has(`${PATH_OK}/ontology`)).toBe(true);
    expect(adapter.orphanWrites).toEqual([]);

    // RFC 0005 Phase 1 — NO .gitmodules sidecar on a git-free vault. (Re-instating
    // the appendGitmodulesEntry write in mount() makes this RED — revert-verified.)
    expect(adapter.textFiles.has(".gitmodules")).toBe(false);

    // Rate-limit gate consulted before fetch.
    expect(client.ensureRateLimit).toHaveBeenCalledWith(1);
    expect(client.fetchTarballBuffer).toHaveBeenCalledWith(
      "kitelev",
      "exoas-ems",
      "main",
    );
  });

  it("#3590 — records the mounted commit SHA as the first-sync merge base keyed by repoKey", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("x") },
    ]);
    const recorded = new Map<string, string>();
    const mountBaseStore = {
      get: async (k: string) => recorded.get(k) ?? null,
      set: async (k: string, sha: string) => {
        recorded.set(k, sha);
      },
    };
    const mount = new RestAssetSpaceMount({
      app: makeApp(adapter),
      client: makeFakeClient(tarball) as unknown as GitHubRestClient,
      mountBaseStore,
    });

    await mount.mount(URL_OK, PATH_OK, "main");

    // repoKey == `<owner>/<repo>#<SYNC_BRANCH>` — what the sync engine reads.
    expect(recorded.get("kitelev/exoas-ems#main")).toBe("abc1234");
  });

  it("#3590 — a mount-base store write failure does NOT fail the mount (best-effort)", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("x") },
    ]);
    const mountBaseStore = {
      get: async () => null,
      set: async () => {
        throw new Error("device-local store unwritable");
      },
    };
    const mount = new RestAssetSpaceMount({
      app: makeApp(adapter),
      client: makeFakeClient(tarball) as unknown as GitHubRestClient,
      mountBaseStore,
    });

    const result = await mount.mount(URL_OK, PATH_OK, "main");

    // Mount succeeds despite the store failure — files materialised, no throw.
    expect(result.sha).toBe("abc1234");
    expect(adapter.files.has(`${PATH_OK}/README.md`)).toBe(true);
  });

  it("does NOT materialise files when the writeBinary loop is skipped (revert-verify control)", async () => {
    // Control proving the happy-path assertions above are load-bearing:
    // an empty tarball produces zero files and throws before .gitmodules.
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", []);
    const client = makeFakeClient(tarball);
    const mount = makeMount(adapter, client);

    await expect(mount.mount(URL_OK, PATH_OK)).rejects.toThrow(/tarball empty/);
    expect(adapter.files.size).toBe(0);
    expect(adapter.textFiles.has(".gitmodules")).toBe(false);
  });

  it("re-mount does not write a .gitmodules sidecar on either pass (RFC 0005 Phase 1)", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("x") },
    ]);
    const mount = makeMount(adapter, makeFakeClient(tarball));

    await mount.mount(URL_OK, PATH_OK);
    await mount.mount(URL_OK, PATH_OK);

    expect(adapter.textFiles.has(".gitmodules")).toBe(false);
  });

  it("does NOT touch a pre-existing legacy .gitmodules on mount (writer fully removed)", async () => {
    const adapter = new InMemoryAdapter();
    const legacy =
      '[submodule "assetspaces/other/repo"]\n\tpath = assetspaces/other/repo\n\turl = https://github.com/o/repo\n';
    await adapter.write(".gitmodules", legacy);
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("x") },
    ]);
    const mount = makeMount(adapter, makeFakeClient(tarball));

    await mount.mount(URL_OK, PATH_OK);

    // The mount neither adds its own stanza nor rewrites the legacy file — it
    // simply does not write .gitmodules at all.
    expect(adapter.textFiles.get(".gitmodules")).toBe(legacy);
  });

  it("rejects an empty tarball", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", []);
    const mount = makeMount(adapter, makeFakeClient(tarball));
    await expect(mount.mount(URL_OK, PATH_OK)).rejects.toThrow(/empty/);
  });

  it("rejects an entry that resolves outside the wrapper — no escape write", async () => {
    const adapter = new InMemoryAdapter();
    // nanotar's parser RESOLVES `..` (parseTarball sanitizePath pops segments),
    // so `wrapper/../../../etc/passwd` collapses to `etc/passwd`, which then
    // fails the "not under wrapper" guard (RestAssetSpaceMount.ts:152). The
    // TarExtractor absolute/`..` checks are pure defense-in-depth (unreachable
    // for sanitized input — exercised directly in TarExtractor's own suite).
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "../../../etc/passwd", data: new Uint8Array([0]) },
    ]);
    const mount = makeMount(adapter, makeFakeClient(tarball));
    await expect(mount.mount(URL_OK, PATH_OK)).rejects.toThrow();
    // Nothing written outside the mount folder.
    for (const k of adapter.files.keys()) {
      expect(k.startsWith(`${PATH_OK}/`)).toBe(true);
    }
  });

  // Note: symbolicLink / hardLink entry rejection (TarExtractor.validateEntry
  // link guard) is covered directly in TarExtractor's own suite — nanotar's
  // `createTar` does not emit a link-typed entry from the input `type` field,
  // so it cannot be exercised through a realistic fixture here without
  // hand-crafting a raw tar header. The link guard is upstream of any write,
  // so mount inherits that protection.

  it("fails on rate-limit before fetching the tarball", async () => {
    const adapter = new InMemoryAdapter();
    const client = makeFakeClient(new ArrayBuffer(0));
    client.ensureRateLimit.mockRejectedValueOnce(new Error("Rate limit guard"));
    const mount = makeMount(adapter, client);
    await expect(mount.mount(URL_OK, PATH_OK)).rejects.toThrow(/Rate limit/);
    expect(client.fetchTarballBuffer).not.toHaveBeenCalled();
  });

  it("rejects a non-github repo URL before any REST call", async () => {
    const adapter = new InMemoryAdapter();
    const client = makeFakeClient(new ArrayBuffer(0));
    const mount = makeMount(adapter, client);
    await expect(
      mount.mount("https://evil.example.com/o/r", PATH_OK),
    ).rejects.toThrow(/Invalid GitHub repo URL/);
    expect(client.ensureRateLimit).not.toHaveBeenCalled();
  });

  it("rejects a traversal submodule path before any REST call", async () => {
    const adapter = new InMemoryAdapter();
    const client = makeFakeClient(new ArrayBuffer(0));
    const mount = makeMount(adapter, client);
    await expect(mount.mount(URL_OK, "assetspaces/../../etc")).rejects.toThrow(
      /parent traversal/,
    );
    expect(client.ensureRateLimit).not.toHaveBeenCalled();
  });
});

describe("RestAssetSpaceMount.unmount", () => {
  it("removes the mount folder subtree AND strips a pre-existing legacy .gitmodules stanza (hygiene)", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("x") },
      { name: "ontology/Task.md", data: new TextEncoder().encode("y") },
    ]);
    const mount = makeMount(adapter, makeFakeClient(tarball));
    await mount.mount(URL_OK, PATH_OK);
    // RFC 0005 Phase 1 — mount no longer writes .gitmodules; seed a LEGACY one
    // (as a vault bootstrapped on an older plugin would have) to prove unmount
    // still strips it for hygiene.
    await adapter.write(
      ".gitmodules",
      `[submodule "${PATH_OK}"]\n\tpath = ${PATH_OK}\n\turl = ${URL_OK}\n`,
    );

    await mount.unmount(PATH_OK);

    // No file remains under the mount folder.
    for (const k of adapter.files.keys()) {
      expect(k.startsWith(`${PATH_OK}/`)).toBe(false);
    }
    expect(adapter.dirs.has(PATH_OK)).toBe(false);
    expect(adapter.dirs.has(`${PATH_OK}/ontology`)).toBe(false);

    // Legacy .gitmodules stanza stripped.
    const gm = adapter.textFiles.get(".gitmodules") ?? "";
    expect(gm).not.toContain(`[submodule "${PATH_OK}"]`);
  });

  it("is idempotent when the folder + stanza are already absent", async () => {
    const adapter = new InMemoryAdapter();
    const mount = makeMount(adapter, makeFakeClient(new ArrayBuffer(0)));
    await expect(mount.unmount(PATH_OK)).resolves.toBeUndefined();
  });

  it("rejects a traversal submodule path", async () => {
    const adapter = new InMemoryAdapter();
    const mount = makeMount(adapter, makeFakeClient(new ArrayBuffer(0)));
    await expect(mount.unmount("../escape")).rejects.toThrow(
      /absolute|parent traversal/,
    );
  });
});

describe("RestAssetSpaceMount.listMountedAssetSpaces (RFC 0005 Phase 1 — filesystem-derived, no .gitmodules)", () => {
  it("returns [] when the assetspaces/ dir is absent", async () => {
    const adapter = new InMemoryAdapter();
    const mount = makeMount(adapter, makeFakeClient(new ArrayBuffer(0)));
    await expect(mount.listMountedAssetSpaces()).resolves.toEqual([]);
  });

  it("enumerates assetspaces/<owner>/<repo> folders + deriveUrl, ignoring any .gitmodules", async () => {
    const adapter = new InMemoryAdapter();
    // A stale .gitmodules must NOT be the source — the folders are.
    await adapter.write(".gitmodules", "[submodule \"stale/x\"]\n\tpath = stale/x\n\turl = https://github.com/stale/x\n");
    await adapter.mkdir("assetspaces");
    await adapter.mkdir("assetspaces/kitelev");
    await adapter.mkdir("assetspaces/kitelev/exoas-exo");
    await adapter.mkdir("assetspaces/kitelev/exoas-exocmd");
    const mount = makeMount(adapter, makeFakeClient(new ArrayBuffer(0)));
    const entries = await mount.listMountedAssetSpaces();
    expect(entries.sort((a, b) => a.submodulePath.localeCompare(b.submodulePath))).toEqual([
      {
        submodulePath: "assetspaces/kitelev/exoas-exo",
        url: "https://github.com/kitelev/exoas-exo",
      },
      {
        submodulePath: "assetspaces/kitelev/exoas-exocmd",
        url: "https://github.com/kitelev/exoas-exocmd",
      },
    ]);
  });

  it("lists the folder a mount() materialised (mount → list), with no .gitmodules involved", async () => {
    const adapter = new InMemoryAdapter();
    const tarball = await makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: new TextEncoder().encode("# EMS\n") },
    ]);
    const mount = makeMount(adapter, makeFakeClient(tarball));
    await mount.mount(URL_OK, PATH_OK, "main");

    expect(adapter.textFiles.has(".gitmodules")).toBe(false);
    await expect(mount.listMountedAssetSpaces()).resolves.toEqual([
      { submodulePath: PATH_OK, url: URL_OK },
    ]);
  });
});
