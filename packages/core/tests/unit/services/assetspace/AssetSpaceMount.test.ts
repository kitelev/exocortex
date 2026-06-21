/**
 * Unit tests for the shared AssetSpace mount core (Issue #3423).
 *
 * Exercises the platform-agnostic pipeline + pure helpers via in-memory fake
 * ports — no Obsidian, no Node fs, no network. The plugin- and CLI-specific
 * write/HTTP strategies are tested in their own adapter suites + the
 * cross-runtime parity test.
 */

import { gzipSync } from "node:zlib";
import { createTar } from "nanotar";
import {
  mountAssetSpaceFiles,
  discoverAssetSpaceWrapperDir,
  extractAssetSpaceSha,
  appendGitmodulesEntry,
  stripGitmodulesEntry,
  escapeGitmodulesRegex,
  type FileSystemPort,
  type AssetSpaceHttpClient,
  type MountFile,
} from "../../../../src/index";
import {
  parseTarballGzip,
  type TarballEntry,
} from "../../../../src/infrastructure/tarball/parseTarball";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a gzipped GitHub-shape tarball wrapping `entries` under `wrapper`. */
function makeTarball(
  wrapper: string,
  entries: Array<{ name: string; data?: Uint8Array }>,
): Uint8Array {
  const files = entries.map((e) => ({ name: `${wrapper}/${e.name}`, data: e.data }));
  return gzipSync(Buffer.from(createTar(files)));
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (u: Uint8Array): string => new TextDecoder().decode(u);

/** Records every materialised file; mirrors the plugin's additive write shape. */
function inMemoryFs(): FileSystemPort & { files: Map<string, Uint8Array>; texts: Map<string, string> } {
  const files = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();
  return {
    files,
    texts,
    async exists(p) {
      return texts.has(p) || files.has(p);
    },
    async read(p) {
      const t = texts.get(p);
      if (t === undefined) throw new Error(`ENOENT: ${p}`);
      return t;
    },
    async write(p, c) {
      texts.set(p, c);
    },
    async removeDir(p) {
      for (const k of [...files.keys()]) if (k === p || k.startsWith(p + "/")) files.delete(k);
    },
    async materialize(targetPath: string, mountFiles: MountFile[]): Promise<number> {
      let n = 0;
      for (const f of mountFiles) {
        files.set(`${targetPath}/${f.relPath}`, f.content);
        n++;
      }
      return n;
    },
  };
}

function fakeHttp(blob: Uint8Array): AssetSpaceHttpClient {
  return { async fetchTarball() { return blob; } };
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe("discoverAssetSpaceWrapperDir", () => {
  it("discovers the wrapper from real tarball entries", async () => {
    const entries = await parseTarballGzip(
      makeTarball("kitelev-exoas-ems-abc1234", [{ name: "README.md", data: enc("x") }]),
    );
    expect(discoverAssetSpaceWrapperDir(entries)).toBe("kitelev-exoas-ems-abc1234");
  });

  it("throws when no entry carries a wrapper path separator", () => {
    const flat: TarballEntry[] = [{ name: "README.md", type: "file", size: 1, data: enc("x") }];
    expect(() => discoverAssetSpaceWrapperDir(flat)).toThrow(/no wrapper-bearing entry/);
  });

  it("throws when an entry escapes the wrapper", () => {
    const mixed: TarballEntry[] = [
      { name: "wrap-abc1234/a.md", type: "file", size: 1, data: enc("x") },
      { name: "other-dir/b.md", type: "file", size: 1, data: enc("y") },
    ];
    expect(() => discoverAssetSpaceWrapperDir(mixed)).toThrow(/not under wrapper/);
  });
});

describe("extractAssetSpaceSha", () => {
  it("extracts a 7-char abbreviated SHA (anonymous)", () => {
    expect(extractAssetSpaceSha("kitelev-exoas-ems-abc1234")).toBe("abc1234");
  });
  it("extracts a 40-char full SHA (authenticated)", () => {
    const full = "a".repeat(40);
    expect(extractAssetSpaceSha(`kitelev-exoas-ems-${full}`)).toBe(full);
  });
  it("lowercases the SHA", () => {
    expect(extractAssetSpaceSha("o-r-ABC1234")).toBe("abc1234");
  });
  it("throws on a wrapper without a trailing hex SHA", () => {
    expect(() => extractAssetSpaceSha("kitelev-exoas-ems")).toThrow(/does not match expected GitHub pattern/);
  });
});

describe("appendGitmodulesEntry", () => {
  it("appends a stanza to empty content", () => {
    const { content, added } = appendGitmodulesEntry("", "assetspaces/x", "https://github.com/o/x");
    expect(added).toBe(true);
    expect(content).toBe(
      `[submodule "assetspaces/x"]\n\tpath = assetspaces/x\n\turl = https://github.com/o/x\n`,
    );
  });
  it("is idempotent — no-op when the path key already exists", () => {
    const first = appendGitmodulesEntry("", "assetspaces/x", "https://github.com/o/x").content;
    const { content, added } = appendGitmodulesEntry(first, "assetspaces/x", "https://github.com/o/x");
    expect(added).toBe(false);
    expect(content).toBe(first);
  });
  it("inserts a newline separator when existing content lacks a trailing newline", () => {
    const { content } = appendGitmodulesEntry("# header", "assetspaces/y", "https://github.com/o/y");
    expect(content.startsWith("# header\n[submodule")).toBe(true);
  });
});

describe("stripGitmodulesEntry", () => {
  it("strips a stanza + collapses the resulting double blank", () => {
    const content =
      `[submodule "assetspaces/a"]\n\tpath = assetspaces/a\n\turl = u1\n` +
      `[submodule "assetspaces/b"]\n\tpath = assetspaces/b\n\turl = u2\n`;
    const out = stripGitmodulesEntry(content, "assetspaces/a");
    expect(out).not.toContain("assetspaces/a");
    expect(out).toContain(`[submodule "assetspaces/b"]`);
  });
  it("returns input unchanged when no matching stanza", () => {
    const content = `[submodule "assetspaces/b"]\n\tpath = assetspaces/b\n\turl = u2\n`;
    expect(stripGitmodulesEntry(content, "assetspaces/zzz")).toBe(content);
  });
});

describe("escapeGitmodulesRegex", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeGitmodulesRegex("a.b+c")).toBe("a\\.b\\+c");
  });
});

// ─── mountAssetSpaceFiles orchestration ──────────────────────────────────────

describe("mountAssetSpaceFiles", () => {
  it("materialises wrapper-stripped files + returns sha/fileCount", async () => {
    const fs = inMemoryFs();
    const blob = makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: enc("# EMS\n") },
      { name: "ontology/Task.md", data: enc("task body") },
    ]);
    const result = await mountAssetSpaceFiles({
      http: fakeHttp(blob),
      fs,
      owner: "kitelev",
      repo: "exoas-ems",
      ref: "main",
      targetPath: "assetspaces/kitelev/exoas-ems",
    });

    expect(result.sha).toBe("abc1234");
    expect(result.fileCount).toBe(2);
    expect(dec(fs.files.get("assetspaces/kitelev/exoas-ems/README.md")!)).toBe("# EMS\n");
    expect(dec(fs.files.get("assetspaces/kitelev/exoas-ems/ontology/Task.md")!)).toBe("task body");
  });

  it("rejects an empty tarball before any materialise", async () => {
    const fs = inMemoryFs();
    await expect(
      mountAssetSpaceFiles({
        http: fakeHttp(gzipSync(Buffer.from(createTar([])))),
        fs,
        owner: "o",
        repo: "r",
        ref: "main",
        targetPath: "assetspaces/x",
      }),
    ).rejects.toThrow(/tarball empty/);
    expect(fs.files.size).toBe(0);
  });

  it("rejects a `..` traversal entry — no files written (revert-verify control)", async () => {
    const fs = inMemoryFs();
    const blob = makeTarball("o-r-abc1234", [
      { name: "ok.md", data: enc("ok") },
      { name: "../escape.md", data: enc("evil") },
    ]);
    await expect(
      mountAssetSpaceFiles({
        http: fakeHttp(blob),
        fs,
        owner: "o",
        repo: "r",
        ref: "main",
        targetPath: "assetspaces/x",
      }),
    ).rejects.toThrow(/path traversal|not under wrapper/);
    // Core validates the WHOLE entry list before calling fs.materialize, so a
    // bad entry anywhere means zero files hit the port (all-or-nothing).
    expect(fs.files.size).toBe(0);
  });

  // ── #al-activitylog-progress: finer within-AS sub-phase progress ──

  it("emits sub-phase progress in order: fetch → extract → materialize", async () => {
    const fs = inMemoryFs();
    const blob = makeTarball("kitelev-exoas-ems-abc1234", [
      { name: "README.md", data: enc("# EMS\n") },
    ]);
    const phases: string[] = [];
    await mountAssetSpaceFiles({
      http: fakeHttp(blob),
      fs,
      owner: "kitelev",
      repo: "exoas-ems",
      ref: "main",
      targetPath: "assetspaces/kitelev/exoas-ems",
      onProgress: (phase) => phases.push(phase),
    });
    expect(phases).toEqual(["fetch", "extract", "materialize"]);
  });

  it("emits 'fetch' BEFORE the network call (live, not post-fact)", async () => {
    const fs = inMemoryFs();
    const order: string[] = [];
    const http: AssetSpaceHttpClient = {
      async fetchTarball() {
        order.push("network");
        return makeTarball("o-r-abc1234", [{ name: "a.md", data: enc("a") }]);
      },
    };
    await mountAssetSpaceFiles({
      http,
      fs,
      owner: "o",
      repo: "r",
      ref: "main",
      targetPath: "assetspaces/x",
      onProgress: (phase) => order.push(`progress:${phase}`),
    });
    // The fetch announcement precedes the actual network fetch.
    expect(order[0]).toBe("progress:fetch");
    expect(order.indexOf("progress:fetch")).toBeLessThan(order.indexOf("network"));
  });

  it("a throwing onProgress observer never breaks the mount", async () => {
    const fs = inMemoryFs();
    const blob = makeTarball("o-r-abc1234", [{ name: "a.md", data: enc("a") }]);
    const result = await mountAssetSpaceFiles({
      http: fakeHttp(blob),
      fs,
      owner: "o",
      repo: "r",
      ref: "main",
      targetPath: "assetspaces/x",
      onProgress: () => {
        throw new Error("hostile observer");
      },
    });
    expect(result.fileCount).toBe(1);
    expect(fs.files.get("assetspaces/x/a.md")).toBeDefined();
  });

  it("omitting onProgress is a zero-cost no-op (CLI bootstrap path)", async () => {
    const fs = inMemoryFs();
    const blob = makeTarball("o-r-abc1234", [{ name: "a.md", data: enc("a") }]);
    await expect(
      mountAssetSpaceFiles({
        http: fakeHttp(blob),
        fs,
        owner: "o",
        repo: "r",
        ref: "main",
        targetPath: "assetspaces/x",
      }),
    ).resolves.toMatchObject({ fileCount: 1 });
  });
});
