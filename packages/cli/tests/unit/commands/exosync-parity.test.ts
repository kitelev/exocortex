/**
 * @jest-environment node
 *
 * Unit tests for `exocortex exosync-parity` (ExoSync E1, RFC 4e4dc453
 * Phase E). Exercises the exported `runExosyncParity` core with a temp
 * vault on the real node fs + an injected fake GitHub transport — no
 * network, no process.exit.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type { RestCommitTransport } from "exocortex";
import {
  collectVaultSpecs,
  runExosyncParity,
  type ExosyncParityOptions,
} from "../../../src/commands/exosync-parity";

const ASSET_SPACE_CLASS_UID = "73bd00e4-ccc0-4f3f-b20d-c4388c4588fb";
const OWNER = "test-owner";
const REPO = "exoas-parity";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const FAKE_PAT = "ghp_" + "C".repeat(36);

function gitBlobShaSync(content: string): string {
  const body = Buffer.from(content, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
}

const FILE_A = "assets/a.md";
const CONTENT_A = `---\nexo__Asset_uid: u-a\n---\n\nbody A\n`;

/** Minimal read-side Git Data API fake for ONE repo at a fixed head. */
function fakeTransport(files: Record<string, string>): RestCommitTransport {
  const headSha = "a".repeat(40);
  const treeSha = "b".repeat(40);
  const blobs = new Map(
    Object.entries(files).map(([p, c]) => [gitBlobShaSync(c), c] as const),
  );
  return async (req) => {
    const { method, url } = req;
    if (method === "GET" && /\/git\/refs\/heads\//.test(url)) {
      if (!url.includes(`/repos/${OWNER}/${REPO}/`)) {
        throw new Error(`GitHub request GET ${url} → HTTP 404: Not Found`);
      }
      return { status: 200, json: { object: { sha: headSha } } };
    }
    if (method === "GET" && url.includes(`/git/commits/${headSha}`)) {
      return {
        status: 200,
        json: { sha: headSha, tree: { sha: treeSha }, parents: [] },
      };
    }
    if (method === "GET" && url.includes(`/git/trees/${treeSha}`)) {
      return {
        status: 200,
        json: {
          truncated: false,
          tree: Object.entries(files).map(([p, c]) => ({
            path: p,
            type: "blob",
            sha: gitBlobShaSync(c),
            size: Buffer.byteLength(c, "utf-8"),
          })),
        },
      };
    }
    const blobMatch = /\/git\/blobs\/([0-9a-f]{40})/.exec(url);
    if (method === "GET" && blobMatch) {
      const content = blobs.get(blobMatch[1]);
      if (content === undefined) {
        throw new Error(`GitHub request GET ${url} → HTTP 404: Not Found`);
      }
      return {
        status: 200,
        json: {
          content: Buffer.from(content, "utf-8").toString("base64"),
          encoding: "base64",
        },
      };
    }
    throw new Error(`GitHub request ${method} ${url} → HTTP 404: unhandled`);
  };
}

interface VaultFixture {
  vault: string;
  cleanup: () => void;
}

function makeVault(opts: {
  mountFiles?: Record<string, string>;
  watermarkFiles?: Record<string, string>;
  declaration?: boolean;
}): VaultFixture {
  const vault = mkdtempSync(path.join(tmpdir(), "exosync-parity-test-"));
  if (opts.declaration !== false) {
    writeFileSync(
      path.join(vault, "space-decl.md"),
      `---\nexo__Asset_uid: decl-uid\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${REPO}\n---\n\nDeclaration\n`,
    );
  }
  for (const [rel, content] of Object.entries(opts.mountFiles ?? {})) {
    const full = path.join(vault, MOUNT, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  if (opts.watermarkFiles !== undefined) {
    const wmDir = path.join(vault, ".obsidian", "plugins", "exocortex");
    mkdirSync(wmDir, { recursive: true });
    const record = {
      lastSyncedSha: "a".repeat(40),
      rootTreeSha: "b".repeat(40),
      files: Object.entries(opts.watermarkFiles).map(([p, c]) => ({
        path: p,
        blobSha: gitBlobShaSync(c),
      })),
    };
    writeFileSync(
      path.join(wmDir, "exosync-watermarks.local.json"),
      JSON.stringify({
        version: 1,
        repos: { [`${OWNER}/${REPO}#main`]: record },
      }),
    );
  }
  return { vault, cleanup: () => rmSync(vault, { recursive: true, force: true }) };
}

function run(
  vault: string,
  remoteFiles: Record<string, string>,
  over: Partial<ExosyncParityOptions> = {},
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  return runExosyncParity(
    { vault, token: FAKE_PAT, ...over },
    {
      transportFactory: () => fakeTransport(remoteFiles),
      out: (l) => lines.push(l),
      env: {},
    },
  ).then((code) => ({ code, lines }));
}

describe("collectVaultSpecs", () => {
  it("collects materialized declarations through the shared classification core", () => {
    const fx = makeVault({ mountFiles: { [FILE_A]: CONTENT_A } });
    try {
      const { specs } = collectVaultSpecs(fx.vault);
      expect(specs).toEqual([
        {
          owner: OWNER,
          repo: REPO,
          branch: "main",
          repoKey: `${OWNER}/${REPO}#main`,
          localPath: MOUNT,
        },
      ]);
    } finally {
      fx.cleanup();
    }
  });

  it("skips declarations whose mount folder is not materialized", () => {
    const fx = makeVault({});
    try {
      expect(collectVaultSpecs(fx.vault).specs).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("runExosyncParity", () => {
  it("exit 0 + M2=∅ on full parity", async () => {
    const fx = makeVault({
      mountFiles: { [FILE_A]: CONTENT_A },
      watermarkFiles: { [FILE_A]: CONTENT_A },
    });
    try {
      const { code, lines } = await run(fx.vault, { [FILE_A]: CONTENT_A });
      expect(code).toBe(0);
      expect(lines.join("\n")).toMatch(/M1=0, M2=∅ \(1 repo\(s\) checked\)/);
    } finally {
      fx.cleanup();
    }
  });

  it("exit 1 + pending-local-edit on a local divergence", async () => {
    const edited = CONTENT_A.replace("body A", "edited body");
    const fx = makeVault({
      mountFiles: { [FILE_A]: edited },
      watermarkFiles: { [FILE_A]: CONTENT_A },
    });
    try {
      const { code, lines } = await run(fx.vault, { [FILE_A]: CONTENT_A });
      expect(code).toBe(1);
      expect(lines.join("\n")).toMatch(/pending-local-edit: assets\/a\.md/);
    } finally {
      fx.cleanup();
    }
  });

  it("exit 2 (vacuous) when the repo has never synced on this device", async () => {
    const fx = makeVault({ mountFiles: { [FILE_A]: CONTENT_A } }); // no watermark
    try {
      const { code, lines } = await run(fx.vault, { [FILE_A]: CONTENT_A });
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/no-watermark|VACUOUS/);
    } finally {
      fx.cleanup();
    }
  });

  it("exit 2 when no materialized sync units exist", async () => {
    const fx = makeVault({ declaration: false });
    try {
      const { code, lines } = await run(fx.vault, {});
      expect(code).toBe(2);
      expect(lines.join("\n")).toMatch(/Nothing to check/);
    } finally {
      fx.cleanup();
    }
  });

  it("--json prints the full round record", async () => {
    const fx = makeVault({
      mountFiles: { [FILE_A]: CONTENT_A },
      watermarkFiles: { [FILE_A]: CONTENT_A },
    });
    try {
      const { code, lines } = await run(
        fx.vault,
        { [FILE_A]: CONTENT_A },
        { json: true },
      );
      expect(code).toBe(0);
      const json = JSON.parse(
        lines.filter((l) => l.startsWith("{")).join("\n"),
      ) as { version: number; ok: boolean };
      expect(json.version).toBe(1);
      expect(json.ok).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it("requires a token (private sync units read as 404 without one)", async () => {
    const fx = makeVault({ mountFiles: { [FILE_A]: CONTENT_A } });
    try {
      await expect(
        runExosyncParity({ vault: fx.vault }, { env: {}, out: () => undefined }),
      ).rejects.toThrow(/GitHub token is required/);
    } finally {
      fx.cleanup();
    }
  });

  it("rejects a non-existent vault path loudly", async () => {
    await expect(
      runExosyncParity(
        { vault: "/nonexistent/vault-path", token: FAKE_PAT },
        { env: {}, out: () => undefined },
      ),
    ).rejects.toThrow(/Vault path does not exist/);
  });
});
