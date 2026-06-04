/**
 * @jest-environment node
 *
 * Unit tests для BootstrapAssetSpaceService.
 * Uses synthetic mocked fetch + nanotar к build fake GitHub tarball responses.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { gzipSync } from "node:zlib";
import { createTar } from "nanotar";
import { BootstrapAssetSpaceService } from "../../src/services/BootstrapAssetSpaceService";

/**
 * Build a fake GitHub-style tarball (gzipped tar) с wrapper dir `<owner>-<repo>-<sha7>/`.
 */
function buildFakeGitHubTarball(
  owner: string,
  repo: string,
  sha7: string,
  files: Array<{ path: string; content: string }>,
): Uint8Array {
  const wrapper = `${owner}-${repo}-${sha7}`;
  const tarEntries: Array<{ name: string; data: Uint8Array; attrs?: Record<string, unknown> }> = [];
  for (const f of files) {
    tarEntries.push({
      name: `${wrapper}/${f.path}`,
      data: new TextEncoder().encode(f.content),
    });
  }
  const tar = createTar(tarEntries);
  return gzipSync(Buffer.from(tar));
}

function fakeFetch(response: Uint8Array): typeof fetch {
  return (async (_url: string | URL | Request) => {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

function fakeFetchError(status: number, statusText: string): typeof fetch {
  return (async () => {
    return {
      ok: false,
      status,
      statusText,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  }) as typeof fetch;
}

describe("BootstrapAssetSpaceService", () => {
  let tempBase: string;

  beforeEach(() => {
    tempBase = mkdtempSync(path.join(os.tmpdir(), "exo-bootstrap-test-"));
  });

  afterEach(() => {
    rmSync(tempBase, { recursive: true, force: true });
  });

  describe("parseGitHubURL", () => {
    it("accepts standard GitHub URL", () => {
      expect(BootstrapAssetSpaceService.parseGitHubURL("https://github.com/kitelev/exoas-exo")).toEqual({
        owner: "kitelev",
        repo: "exoas-exo",
      });
    });

    it("accepts URL с .git suffix", () => {
      expect(BootstrapAssetSpaceService.parseGitHubURL("https://github.com/kitelev/exoas-exo.git")).toEqual({
        owner: "kitelev",
        repo: "exoas-exo",
      });
    });

    it("rejects non-github URL", () => {
      expect(() => BootstrapAssetSpaceService.parseGitHubURL("https://gitlab.com/x/y")).toThrow();
    });

    it("rejects URL с path/query", () => {
      expect(() => BootstrapAssetSpaceService.parseGitHubURL("https://github.com/a/b/tree/main")).toThrow();
    });

    it("rejects http (no https)", () => {
      expect(() => BootstrapAssetSpaceService.parseGitHubURL("http://github.com/a/b")).toThrow();
    });
  });

  describe("deriveFolderName", () => {
    it("strips exoas- prefix", () => {
      expect(BootstrapAssetSpaceService.deriveFolderName("https://github.com/kitelev/exoas-pmbok-ontology")).toBe(
        "pmbok-ontology",
      );
    });

    it("keeps name without prefix", () => {
      expect(BootstrapAssetSpaceService.deriveFolderName("https://github.com/owner/some-repo")).toBe("some-repo");
    });
  });

  describe("pullAssetSpace", () => {
    it("extracts tarball files к target dir, strips wrapper, returns SHA", async () => {
      const tarball = buildFakeGitHubTarball("kitelev", "exoas-exo", "abc1234", [
        { path: "README.md", content: "# exo TBox" },
        { path: "schema/Asset.md", content: "asset class" },
      ]);
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      const target = path.join(tempBase, "assetspaces", "exo");

      const result = await svc.pullAssetSpace("https://github.com/kitelev/exoas-exo", "main", target);

      expect(result.sha).toBe("abc1234");
      expect(result.fileCount).toBe(2);
      expect(existsSync(path.join(target, "README.md"))).toBe(true);
      expect(readFileSync(path.join(target, "README.md"), "utf8")).toBe("# exo TBox");
      expect(existsSync(path.join(target, "schema/Asset.md"))).toBe(true);
    });

    it("refuses к overwrite non-empty target", async () => {
      const target = path.join(tempBase, "assetspaces", "exo");
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, "existing.md"), "x");
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(new Uint8Array()) });

      await expect(
        svc.pullAssetSpace("https://github.com/x/y", "main", target),
      ).rejects.toThrow(/exists и not empty/);
    });

    it("propagates fetch failure", async () => {
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetchError(404, "Not Found") });
      await expect(
        svc.pullAssetSpace("https://github.com/x/y", "main", path.join(tempBase, "t")),
      ).rejects.toThrow(/fetch failed.*404/);
    });

    it("rejects invalid URL shape", async () => {
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(new Uint8Array()) });
      await expect(
        svc.pullAssetSpace("not-a-github-url", "main", path.join(tempBase, "t")),
      ).rejects.toThrow(/invalid URL shape/);
    });
  });

  describe("ensureGitmodulesEntry", () => {
    it("creates .gitmodules if absent", () => {
      const svc = new BootstrapAssetSpaceService();
      const result = svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");
      expect(result.added).toBe(true);
      const content = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");
      expect(content).toContain(`[submodule "assetspaces/exo"]`);
      expect(content).toContain(`url = https://github.com/kitelev/exoas-exo`);
    });

    it("idempotent — second call returns added=false", () => {
      const svc = new BootstrapAssetSpaceService();
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");
      const second = svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");
      expect(second.added).toBe(false);
      // Still single entry.
      const content = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");
      expect(content.match(/\[submodule "assetspaces\/exo"\]/g)?.length).toBe(1);
    });

    it("appends new entry preserving existing entries", () => {
      const svc = new BootstrapAssetSpaceService();
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exocmd", "https://github.com/kitelev/exoas-exocmd");
      const content = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");
      expect(content).toContain(`[submodule "assetspaces/exo"]`);
      expect(content).toContain(`[submodule "assetspaces/exocmd"]`);
    });
  });

  describe("integration: bootstrap full flow (mocked fetch, real fs)", () => {
    it("pulls 2 AS + writes .gitmodules", async () => {
      const exoTarball = buildFakeGitHubTarball("kitelev", "exoas-exo", "111aaaa", [
        { path: "README.md", content: "exo readme" },
      ]);
      const exocmdTarball = buildFakeGitHubTarball("kitelev", "exoas-exocmd", "222bbbb", [
        { path: "README.md", content: "exocmd readme" },
      ]);

      // Build fetch that returns different tarballs per URL.
      const fakeMultiFetch = (async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : (url as URL).toString();
        const tarball = u.includes("exoas-exo/") ? exoTarball : exocmdTarball;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength),
        } as unknown as Response;
      }) as typeof fetch;

      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeMultiFetch });

      const exoResult = await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-exo",
        "main",
        path.join(tempBase, "assetspaces/exo"),
      );
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");

      const exocmdResult = await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-exocmd",
        "main",
        path.join(tempBase, "assetspaces/exocmd"),
      );
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exocmd", "https://github.com/kitelev/exoas-exocmd");

      expect(exoResult.sha).toBe("111aaaa");
      expect(exocmdResult.sha).toBe("222bbbb");
      expect(existsSync(path.join(tempBase, "assetspaces/exo/README.md"))).toBe(true);
      expect(existsSync(path.join(tempBase, "assetspaces/exocmd/README.md"))).toBe(true);
      const gitmodules = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");
      expect(gitmodules).toContain(`[submodule "assetspaces/exo"]`);
      expect(gitmodules).toContain(`[submodule "assetspaces/exocmd"]`);
    });
  });
});
