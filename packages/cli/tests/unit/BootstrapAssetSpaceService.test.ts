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

/**
 * Hand-craft a single USTAR header block for a non-regular entry (symlink /
 * hardlink). nanotar's `createTar` only emits regular-file (typeflag `0`)
 * entries, so a malicious symlink tarball cannot be synthesized through it —
 * we build the raw 512-byte header ourselves. typeflag `2` → symbolicLink,
 * `1` → hardLink (per nanotar `tarItemTypeMap`).
 */
function tarLinkHeader(name: string, linkname: string, typeflag: "1" | "2"): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, "utf8"); // name (≤100 bytes)
  block.write("0000777\0", 100, "ascii"); // mode
  block.write("0000000\0", 108, "ascii"); // uid
  block.write("0000000\0", 116, "ascii"); // gid
  block.write("00000000000\0", 124, "ascii"); // size = 0 (links carry no payload)
  block.write("00000000000\0", 136, "ascii"); // mtime
  block.write("        ", 148, "ascii"); // checksum placeholder (8 spaces)
  block.write(typeflag, 156, "ascii"); // typeflag
  block.write(linkname, 157, "utf8"); // linkname target (≤100 bytes)
  block.write("ustar\0", 257, "ascii"); // magic
  block.write("00", 263, "ascii"); // version
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii"); // computed checksum
  return block;
}

/**
 * Build a gzipped tar containing a single link entry under a valid GitHub
 * wrapper dir `<owner>-<repo>-<sha7>/` so the malicious entry survives the
 * wrapper-prefix + SHA validation and reaches the symlink/hardlink reject gate.
 */
function buildLinkTarball(wrapper: string, typeflag: "1" | "2"): Uint8Array {
  const header = tarLinkHeader(`${wrapper}/evil-link`, "/etc/passwd", typeflag);
  const trailer = Buffer.alloc(1024, 0); // two zero blocks terminate the archive
  return gzipSync(Buffer.concat([header, trailer]));
}

/**
 * Hand-craft a USTAR regular-file block whose full path is split across the
 * `prefix` (offset 345) and `name` (offset 0) fields — the POSIX layout GitHub
 * uses for paths > 100 bytes. Authenticated tarballs carry the FULL 40-char
 * commit SHA in the wrapper, pushing a UUID-named file past 100 chars → ustar
 * split. nanotar 0.3.0 dropped the prefix (Issue #3382); the fix restores it.
 * `createTar` can't emit prefix-split entries, so we build the raw bytes.
 */
function tarFileWithPrefix(prefix: string, name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, "utf8"); // name field (≤100)
  block.write("0000644\0", 100, "ascii"); // mode
  block.write("0000000\0", 108, "ascii"); // uid
  block.write("0000000\0", 116, "ascii"); // gid
  block.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii"); // size
  block.write("00000000000\0", 136, "ascii"); // mtime
  block.write("        ", 148, "ascii"); // checksum placeholder
  block.write("0", 156, "ascii"); // typeflag = regular file
  block.write("ustar\0", 257, "ascii"); // magic
  block.write("00", 263, "ascii"); // version
  if (prefix) block.write(prefix, 345, "utf8"); // ustar prefix field (≤155)
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
  data.copy(padded);
  return Buffer.concat([block, padded]);
}

function tarDir(name: string): Buffer {
  const block = Buffer.alloc(512, 0);
  block.write(name, 0, "utf8");
  block.write("0000755\0", 100, "ascii");
  block.write("00000000000\0", 124, "ascii"); // size = 0
  block.write("00000000000\0", 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write("5", 156, "ascii"); // typeflag = directory
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i];
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return block;
}

/**
 * Build a gzipped tarball mimicking GitHub's AUTHENTICATED REST tarball: a
 * full-40-char-SHA wrapper dir + a UUID-named asset whose 100+ char path is
 * ustar prefix-split. Reproduces the exact Issue #3382 failure shape.
 */
function buildAuthGitHubTarball(
  owner: string,
  repo: string,
  sha40: string,
  uuid: string,
  content: string,
): Uint8Array {
  const wrapper = `${owner}-${repo}-${sha40}`;
  const dir = tarDir(`${wrapper}/`);
  const readme = tarFileWithPrefix("", `${wrapper}/README.md`, "# readme"); // 75c → name field
  const asset = tarFileWithPrefix(wrapper, `${uuid}.md`, content); // prefix=wrapper, name=uuid → split
  const trailer = Buffer.alloc(1024, 0);
  return gzipSync(Buffer.concat([dir, readme, asset, trailer]));
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

/**
 * Fetch fake that records the RequestInit it was called with (so tests can
 * assert on the Authorization / GitHub headers the service attaches), then
 * returns `response` as a 200.
 */
function fakeFetchCapturing(response: Uint8Array, sink: { init?: RequestInit }): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    sink.init = init;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () =>
        response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

/**
 * Fetch fake mimicking a PRIVATE GitHub repo: requires a `Bearer` Authorization
 * header. Without it → 404 (GitHub hides private-repo existence rather than 403).
 * With it → returns the tarball. Models the real auth gate end-to-end.
 */
function fakeFetchRequiringAuth(response: Uint8Array): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () =>
        response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

/**
 * Fetch fake that throws an error embedding the request headers (incl. the
 * Authorization PAT) — models a third-party fetch impl that echoes the request
 * on network failure. Used to verify the service redacts leaked PATs.
 */
function fakeFetchThrowingWithAuth(): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    throw new Error(`network down; request headers: ${JSON.stringify(headers)}`);
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

    // Issue #3382 e2e: end-to-end CLI pull of an AUTHENTICATED-shape tarball.
    // The wrapper carries the full 40-char SHA, so the UUID asset's path
    // exceeds 100 bytes and is ustar prefix-split. Before the fix the parser
    // dropped the wrapper prefix → "not under wrapper" throw; and the 40-char
    // SHA failed the 7-char wrapper match. This exercises both fixes through
    // the real `pullAssetSpace` extract+materialise path.
    it("materializes a prefix-split UUID asset from a full-40-char-SHA wrapper (#3382)", async () => {
      const SHA40 = "306f656e6159944a4ae18beeb618d13611826b9b"; // full commit SHA
      const UUID = "a1b2c3d4-e5f6-7890-abcd-ef0123456789";
      const tarball = buildAuthGitHubTarball(
        "kitelev",
        "exoas-honesttest",
        SHA40,
        UUID,
        "asset body",
      );
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      const target = path.join(tempBase, "assetspaces", "honesttest");

      const result = await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-honesttest",
        "main",
        target,
      );

      // SHA extraction accepts the full 40-char authenticated wrapper.
      expect(result.sha).toBe(SHA40);
      expect(result.fileCount).toBe(2);
      // The prefix-split UUID asset is materialised under the wrapper-stripped
      // path (its full tarball path was 105 bytes → ustar prefix + name split).
      expect(existsSync(path.join(target, `${UUID}.md`))).toBe(true);
      expect(readFileSync(path.join(target, `${UUID}.md`), "utf8")).toBe("asset body");
      expect(existsSync(path.join(target, "README.md"))).toBe(true);
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

    // PR #3367 follow-up: adversarial symlink/hardlink tarball rejection. nanotar's
    // createTar can't emit link-typed entries, so we hand-craft raw tar bytes
    // (tarLinkHeader) to synthesize a malicious upstream tarball.
    it("rejects symbolicLink-typed tar entry (security)", async () => {
      const tarball = buildLinkTarball("kitelev-evil-abc1234", "2");
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      await expect(
        svc.pullAssetSpace("https://github.com/kitelev/evil", "main", path.join(tempBase, "t")),
      ).rejects.toThrow(/symbolicLink entry .* rejected for security/);
    });

    it("rejects hardLink-typed tar entry (security)", async () => {
      const tarball = buildLinkTarball("kitelev-evil-def5678", "1");
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      await expect(
        svc.pullAssetSpace("https://github.com/kitelev/evil", "main", path.join(tempBase, "t")),
      ).rejects.toThrow(/hardLink entry .* rejected for security/);
    });

    it("does not extract any file when a malicious symlink entry is present", async () => {
      const tarball = buildLinkTarball("kitelev-evil-abc1234", "2");
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      const target = path.join(tempBase, "no-extract");
      await expect(
        svc.pullAssetSpace("https://github.com/kitelev/evil", "main", target),
      ).rejects.toThrow(/rejected for security/);
      // Target dir must not have been created with any contents (staging cleaned up).
      expect(existsSync(path.join(target, "evil-link"))).toBe(false);
    });

    it("MEDIUM-fix: accepts files с `..` в name (e.g. foo..bar.md) when no segment is `..`", async () => {
      const tarball = buildFakeGitHubTarball("kitelev", "test", "bbb2222", [
        { path: "foo..bar.md", content: "legitimate filename" },
      ]);
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      const target = path.join(tempBase, "target-dots");
      const result = await svc.pullAssetSpace("https://github.com/x/y", "main", target);
      expect(result.fileCount).toBe(1);
      expect(existsSync(path.join(target, "foo..bar.md"))).toBe(true);
    });

    it("MEDIUM-fix: rejects entries с `..` as path segment", async () => {
      const wrapper = "kitelev-test-ccc3333";
      const tar = createTar([
        { name: `${wrapper}/safe.md`, data: new TextEncoder().encode("ok") },
        { name: `${wrapper}/../escape.md`, data: new TextEncoder().encode("evil") },
      ]);
      const tarball = gzipSync(Buffer.from(tar));
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(tarball) });
      await expect(
        svc.pullAssetSpace("https://github.com/x/y", "main", path.join(tempBase, "t")),
      ).rejects.toThrow(/path traversal|not under wrapper/);
    });

    it("rejects invalid URL shape", async () => {
      const svc = new BootstrapAssetSpaceService({ fetchImpl: fakeFetch(new Uint8Array()) });
      await expect(
        svc.pullAssetSpace("not-a-github-url", "main", path.join(tempBase, "t")),
      ).rejects.toThrow(/invalid URL shape/);
    });
  });

  describe("token auth (private-repo support)", () => {
    // Classic PAT shape: ghp_ + 36 urlsafe chars → matches the service's
    // redaction PAT_REGEX (gh[pousr]_[A-Za-z0-9_]{36,}).
    const TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";

    it("attaches Authorization: Bearer + GitHub headers when token provided", async () => {
      const tarball = buildFakeGitHubTarball("kitelev", "exoas-priv", "abc1234", [
        { path: "README.md", content: "# priv" },
      ]);
      const sink: { init?: RequestInit } = {};
      const svc = new BootstrapAssetSpaceService({
        fetchImpl: fakeFetchCapturing(tarball, sink),
        token: TOKEN,
      });
      await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-priv",
        "main",
        path.join(tempBase, "priv"),
      );
      const headers = (sink.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers["User-Agent"]).toBe("exocortex-cli");
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    });

    it("omits Authorization header when no token (anonymous path unchanged)", async () => {
      const tarball = buildFakeGitHubTarball("kitelev", "exoas-pub", "def5678", [
        { path: "README.md", content: "# pub" },
      ]);
      const sink: { init?: RequestInit } = {};
      const svc = new BootstrapAssetSpaceService({
        fetchImpl: fakeFetchCapturing(tarball, sink),
      });
      await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-pub",
        "main",
        path.join(tempBase, "pub"),
      );
      // No headers attached at all — request shape byte-identical to pre-token.
      expect(sink.init?.headers).toBeUndefined();
    });

    it("treats empty-string token as anonymous (no Authorization header)", async () => {
      const tarball = buildFakeGitHubTarball("kitelev", "exoas-pub", "aaa1111", [
        { path: "README.md", content: "# pub" },
      ]);
      const sink: { init?: RequestInit } = {};
      const svc = new BootstrapAssetSpaceService({
        fetchImpl: fakeFetchCapturing(tarball, sink),
        token: "",
      });
      await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-pub",
        "main",
        path.join(tempBase, "pub-empty"),
      );
      expect(sink.init?.headers).toBeUndefined();
    });

    // Integration: private-shape AUTHENTICATED tarball (full-40-char-SHA wrapper
    // + ustar prefix-split UUID asset, the #3390 shape) behind an auth gate.
    it("materializes a private-shape tarball WITH token (40-char SHA wrapper)", async () => {
      const SHA40 = "306f656e6159944a4ae18beeb618d13611826b9b";
      const UUID = "b2c3d4e5-f6a7-8901-bcde-f01234567890";
      const tarball = buildAuthGitHubTarball("kitelev", "exoas-priv", SHA40, UUID, "private asset body");
      const svc = new BootstrapAssetSpaceService({
        fetchImpl: fakeFetchRequiringAuth(tarball),
        token: TOKEN,
      });
      const target = path.join(tempBase, "assetspaces", "priv");

      const result = await svc.pullAssetSpace(
        "https://github.com/kitelev/exoas-priv",
        "main",
        target,
      );

      expect(result.sha).toBe(SHA40);
      expect(result.fileCount).toBe(2);
      expect(existsSync(path.join(target, `${UUID}.md`))).toBe(true);
      expect(readFileSync(path.join(target, `${UUID}.md`), "utf8")).toBe("private asset body");
    });

    // revert-verify anchor: removing the header-injection block in the service
    // makes THIS test fail (no auth → 404). Verified empirically pre-merge.
    it("fails gracefully on private repo WITHOUT token — 404, no partial state", async () => {
      const SHA40 = "306f656e6159944a4ae18beeb618d13611826b9b";
      const UUID = "c3d4e5f6-a7b8-9012-cdef-012345678901";
      const tarball = buildAuthGitHubTarball("kitelev", "exoas-priv", SHA40, UUID, "private asset body");
      const svc = new BootstrapAssetSpaceService({
        fetchImpl: fakeFetchRequiringAuth(tarball),
      }); // no token → anonymous → 404
      const target = path.join(tempBase, "assetspaces", "priv-noauth");

      await expect(
        svc.pullAssetSpace("https://github.com/kitelev/exoas-priv", "main", target),
      ).rejects.toThrow(/fetch failed \(404 Not Found\).*--token/);
      // No partial state: target dir never created (fetch fails before staging).
      expect(existsSync(target)).toBe(false);
    });

    it("redacts a leaked PAT from fetch-error messages (security)", async () => {
      const svc = new BootstrapAssetSpaceService({
        fetchImpl: fakeFetchThrowingWithAuth(),
        token: TOKEN,
      });
      let caught: Error | undefined;
      try {
        await svc.pullAssetSpace(
          "https://github.com/kitelev/exoas-priv",
          "main",
          path.join(tempBase, "redact"),
        );
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).not.toContain(TOKEN);
      expect(caught!.message).toContain("***REDACTED***");
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

  describe("stripGitmodulesEntry (pure, Issue #3416 unmount)", () => {
    it("strips the matching stanza + collapses the double-blank", () => {
      const content =
        `[submodule "assetspaces/exo"]\n\tpath = assetspaces/exo\n\turl = https://github.com/kitelev/exoas-exo\n` +
        `[submodule "assetspaces/testlib"]\n\tpath = assetspaces/testlib\n\turl = https://github.com/kitelev/exoas-testlib\n`;
      const out = BootstrapAssetSpaceService.stripGitmodulesEntry(
        content,
        "assetspaces/testlib",
      );
      expect(out).toContain(`[submodule "assetspaces/exo"]`);
      expect(out).not.toContain(`assetspaces/testlib`);
    });

    it("no-op (returns identical content) for an absent stanza", () => {
      const content = `[submodule "assetspaces/exo"]\n\tpath = assetspaces/exo\n\turl = u\n`;
      expect(
        BootstrapAssetSpaceService.stripGitmodulesEntry(content, "assetspaces/missing"),
      ).toBe(content);
    });
  });

  describe("removeGitmodulesEntry (Issue #3416 unmount)", () => {
    it("removes the stanza + reports removed=true", () => {
      const svc = new BootstrapAssetSpaceService();
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/testlib", "https://github.com/kitelev/exoas-testlib");
      const res = svc.removeGitmodulesEntry(tempBase, "assetspaces/testlib");
      expect(res.removed).toBe(true);
      const content = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");
      expect(content).toContain(`[submodule "assetspaces/exo"]`);
      expect(content).not.toContain(`assetspaces/testlib`);
    });

    it("no-op (removed=false) when .gitmodules is absent", () => {
      const svc = new BootstrapAssetSpaceService();
      expect(svc.removeGitmodulesEntry(tempBase, "assetspaces/exo").removed).toBe(false);
    });

    it("no-op (removed=false) when stanza is absent", () => {
      const svc = new BootstrapAssetSpaceService();
      svc.ensureGitmodulesEntry(tempBase, "assetspaces/exo", "https://github.com/kitelev/exoas-exo");
      expect(svc.removeGitmodulesEntry(tempBase, "assetspaces/missing").removed).toBe(false);
    });
  });

  describe("unmountAssetSpace (Issue #3416)", () => {
    it("strips the .gitmodules stanza AND removes the folder", () => {
      const svc = new BootstrapAssetSpaceService();
      const mount = "assetspaces/kitelev/exoas-testlib";
      mkdirSync(path.join(tempBase, mount), { recursive: true });
      writeFileSync(path.join(tempBase, mount, "note.md"), "x");
      svc.ensureGitmodulesEntry(tempBase, mount, "https://github.com/kitelev/exoas-testlib");

      svc.unmountAssetSpace(tempBase, mount);

      expect(existsSync(path.join(tempBase, mount))).toBe(false);
      const content = readFileSync(path.join(tempBase, ".gitmodules"), "utf8");
      expect(content).not.toContain("exoas-testlib");
    });

    it("idempotent — unmounting an already-absent AS is a no-op (no throw)", () => {
      const svc = new BootstrapAssetSpaceService();
      expect(() =>
        svc.unmountAssetSpace(tempBase, "assetspaces/kitelev/nope"),
      ).not.toThrow();
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
