/**
 * Cross-runtime AssetSpace MOUNT parity (Issue #3423).
 *
 * Mirrors the `docs/explanation/CROSS_RUNTIME_PARITY.md` validator-parity pattern, but for
 * the mount pipeline. Both the CLI Node-`fs` adapter
 * ({@link BootstrapAssetSpaceService.pullAssetSpace}) and a plugin-shape
 * in-memory adapter drive the SAME shared core
 * ({@link mountAssetSpaceFiles}) over a single tarball fixture and MUST produce
 * equivalent results (same SHA, same file count, same wrapper-stripped
 * {relPath → content} set) — the R2 mitigation against the dual-mount drift the
 * issue eliminates.
 *
 * The two adapters differ ONLY in their genuinely platform-specific write
 * strategy (CLI: atomic stage+rename onto disk; plugin: additive direct write).
 * This test proves that divergence does not change the materialised outcome.
 */

import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import { createTar } from "nanotar";

import {
  mountAssetSpaceFiles,
  appendGitmodulesEntry,
  stripGitmodulesEntry,
  type FileSystemPort,
  type AssetSpaceHttpClient,
  type MountFile,
} from "@kitelev/exocortex-core";

import { BootstrapAssetSpaceService } from "../../src/services/BootstrapAssetSpaceService";

const OWNER = "kitelev";
const REPO = "exoas-ems";
const SHA7 = "abc1234";
const WRAPPER = `${OWNER}-${REPO}-${SHA7}`;
const REPO_URL = `https://github.com/${OWNER}/${REPO}`;

/** Shared fixture content — multiple files incl. nested dirs. */
const FIXTURE_FILES: Array<{ path: string; content: string }> = [
  { path: "README.md", content: "# EMS\n" },
  { path: "ontology/Task.md", content: "task body\n" },
  { path: "ontology/sub/Deep.md", content: "deep\n" },
];

function buildTarball(): Uint8Array {
  const entries = FIXTURE_FILES.map((f) => ({
    name: `${WRAPPER}/${f.path}`,
    data: new TextEncoder().encode(f.content),
  }));
  return gzipSync(Buffer.from(createTar(entries)));
}

function fakeFetch(blob: Uint8Array): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () =>
        blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength),
    }) as unknown as Response) as typeof fetch;
}

function fakeHttp(blob: Uint8Array): AssetSpaceHttpClient {
  return { async fetchTarball() { return blob; } };
}

/** Plugin-shape additive in-memory FileSystemPort (mirrors RestAssetSpaceMount). */
function inMemoryAdditiveFs(): FileSystemPort & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();
  return {
    files,
    async exists(p) { return files.has(p) || texts.has(p); },
    async read(p) {
      const t = texts.get(p);
      if (t === undefined) throw new Error(`ENOENT ${p}`);
      return t;
    },
    async write(p, c) { texts.set(p, c); },
    async removeDir(p) {
      for (const k of [...files.keys()]) if (k === p || k.startsWith(p + "/")) files.delete(k);
    },
    async materialize(targetPath: string, mountFiles: MountFile[]): Promise<number> {
      let n = 0;
      for (const f of mountFiles) { files.set(`${targetPath}/${f.relPath}`, f.content); n++; }
      return n;
    },
  };
}

/** Recursively read a materialised tree into a {relPath → content} map. */
function readTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out.set(path.relative(root, full).split(path.sep).join("/"), readFileSync(full, "utf8"));
      }
    }
  };
  walk(root);
  return out;
}

describe("cross-runtime mount parity (Issue #3423)", () => {
  let tempBase: string;

  beforeEach(() => {
    tempBase = mkdtempSync(path.join(os.tmpdir(), "mount-parity-"));
  });
  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  it("CLI Node-fs adapter and plugin-shape in-memory adapter materialise identical results", async () => {
    const blob = buildTarball();

    // CLI Node-fs path (atomic stage+rename onto disk).
    const cliTarget = path.join(tempBase, "assetspaces", OWNER, REPO);
    const cli = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(blob) });
    const cliResult = await cli.pullAssetSpace(REPO_URL, "main", cliTarget);
    const cliTree = readTree(cliTarget);

    // Plugin-shape in-memory path (additive direct write).
    const fs = inMemoryAdditiveFs();
    const pluginTarget = "assetspaces/kitelev/exoas-ems";
    const pluginResult = await mountAssetSpaceFiles({
      http: fakeHttp(blob),
      fs,
      owner: OWNER,
      repo: REPO,
      ref: "main",
      targetPath: pluginTarget,
    });
    const pluginTree = new Map<string, string>();
    for (const [k, v] of fs.files) {
      pluginTree.set(k.slice(pluginTarget.length + 1), new TextDecoder().decode(v));
    }

    // SHA + fileCount parity.
    expect(cliResult.sha).toBe(pluginResult.sha);
    expect(cliResult.sha).toBe(SHA7);
    expect(cliResult.fileCount).toBe(pluginResult.fileCount);
    expect(cliResult.fileCount).toBe(FIXTURE_FILES.length);

    // Materialised {relPath → content} set parity.
    expect([...cliTree.keys()].sort()).toEqual([...pluginTree.keys()].sort());
    for (const [rel, content] of cliTree) {
      expect(pluginTree.get(rel)).toBe(content);
    }
    // And both match the original fixture.
    for (const f of FIXTURE_FILES) {
      expect(cliTree.get(f.path)).toBe(f.content);
      expect(pluginTree.get(f.path)).toBe(f.content);
    }
  });

  it(".gitmodules append is byte-identical across the CLI adapter and the pure core transform", () => {
    const submodulePath = "assetspaces/kitelev/exoas-ems";
    // CLI adapter writes to disk via the shared transform.
    const cli = new BootstrapAssetSpaceService({});
    cli.ensureGitmodulesEntry(tempBase, submodulePath, REPO_URL);
    const cliGitmodules = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");

    // Pure core transform from empty content.
    const { content } = appendGitmodulesEntry("", submodulePath, REPO_URL);

    expect(cliGitmodules).toBe(content);
    expect(cliGitmodules).toContain(`[submodule "${submodulePath}"]`);
    expect(cliGitmodules).toContain(`url = ${REPO_URL}`);
  });

  it("strip is byte-identical across the CLI static helper and the core transform", () => {
    const content =
      `[submodule "assetspaces/a"]\n\tpath = assetspaces/a\n\turl = u1\n` +
      `[submodule "assetspaces/b"]\n\tpath = assetspaces/b\n\turl = u2\n`;
    expect(BootstrapAssetSpaceService.stripGitmodulesEntry(content, "assetspaces/a")).toBe(
      stripGitmodulesEntry(content, "assetspaces/a"),
    );
  });

  it("unmount via the CLI adapter removes the materialised tree (round-trip)", async () => {
    const blob = buildTarball();
    const target = path.join(tempBase, "assetspaces", OWNER, REPO);
    const cli = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(blob) });
    await cli.pullAssetSpace(REPO_URL, "main", target);
    cli.ensureGitmodulesEntry(tempBase, `assetspaces/${OWNER}/${REPO}`, REPO_URL);
    expect(statSync(target).isDirectory()).toBe(true);

    cli.unmountAssetSpace(tempBase, `assetspaces/${OWNER}/${REPO}`);
    expect(() => statSync(target)).toThrow();
    expect(readFileSync(path.join(tempBase, ".gitmodules"), "utf8")).not.toContain(
      `assetspaces/${OWNER}/${REPO}`,
    );
  });
});
