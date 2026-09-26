/**
 * req af002ec4-ec4e-4482-b7b5-77e79dd332df (issue #3975) — conditional Git
 * Data reads as the CLI actually ships them.
 *
 * The core suite proves the mechanism BEHAVES; this suite proves it is WIRED,
 * at every call site, and on by default. Deleting a `wireConditionalRequests`
 * line reds here and nothing in the core suite — a conditional request nobody
 * sends is indistinguishable from none.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  ASSET_SPACE_CLASS_UID,
  type RestCommitRequest,
  type RestCommitResponse,
  type RestCommitTransport,
} from "@kitelev/exocortex-core";

import { runExosyncParity } from "../../../src/commands/exosync-parity.js";
import { runExosyncSync } from "../../../src/commands/exosync-sync.js";
import { wireConditionalRequests } from "../../../src/services/conditionalRequestTransport.js";

const OWNER = "kitelev";
const REPO = "exoas-public";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const FILE_A = "assets/a.md";
const CONTENT_A = `---\nexo__Asset_uid: u-a\n---\n\nbody A\n`;
const FAKE_PAT = "ghp_" + "C".repeat(36);
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);

function gitBlobShaSync(content: string): string {
  const body = Buffer.from(content, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
}

/** Git Data fake that honours `If-None-Match` the way GitHub does. */
function conditionalRemote(
  files: Record<string, string>,
): RestCommitTransport & {
  seen: RestCommitRequest[];
  statuses: number[];
  conditional: () => RestCommitRequest[];
  notModified: () => number;
} {
  const seen: RestCommitRequest[] = [];
  const statuses: number[] = [];
  const etags = new Map<string, string>();
  const blobs = new Map(
    Object.entries(files).map(([, c]) => [gitBlobShaSync(c), c] as const),
  );

  const bodyFor = (url: string): unknown | null => {
    if (/\/git\/refs\/heads\//.test(url)) return { object: { sha: HEAD } };
    if (url.includes(`/git/commits/${HEAD}`)) {
      return { sha: HEAD, tree: { sha: TREE }, parents: [] };
    }
    if (url.includes(`/git/trees/${TREE}`)) {
      return {
        sha: TREE,
        truncated: false,
        tree: Object.entries(files).map(([p, c]) => ({
          path: p,
          type: "blob",
          sha: gitBlobShaSync(c),
          size: Buffer.byteLength(c, "utf-8"),
        })),
      };
    }
    const blob = /\/git\/blobs\/([0-9a-f]{40})/.exec(url);
    if (blob) {
      const content = blobs.get(blob[1]);
      if (content === undefined) return null;
      return {
        sha: blob[1],
        content: Buffer.from(content, "utf-8").toString("base64"),
        encoding: "base64",
      };
    }
    return null;
  };

  const fn = async (req: RestCommitRequest): Promise<RestCommitResponse> => {
    seen.push(req);
    const body = bodyFor(req.url);
    if (body === null) {
      throw new Error(`GitHub request ${req.method} ${req.url} → HTTP 404`);
    }
    let etag = etags.get(req.url);
    if (etag === undefined) {
      etag = `"${createHash("sha1").update(req.url).digest("hex").slice(0, 8)}"`;
      etags.set(req.url, etag);
    }
    const headers = (name: string): string | undefined =>
      name.toLowerCase() === "etag" ? etag : undefined;
    if (req.headers?.["If-None-Match"] === etag) {
      if (req.acceptNotModified !== true) {
        throw new Error(`GitHub request ${req.method} ${req.url} → HTTP 304: `);
      }
      statuses.push(304);
      return { status: 304, headers };
    }
    statuses.push(200);
    return { status: 200, json: body, headers };
  };

  return Object.assign(fn, {
    seen,
    statuses,
    conditional: (): RestCommitRequest[] =>
      seen.filter((r) => r.headers?.["If-None-Match"] !== undefined),
    notModified: (): number => statuses.filter((s) => s === 304).length,
  });
}

function makeVault(): { vault: string; cleanup: () => void } {
  const vault = mkdtempSync(path.join(tmpdir(), "exosync-etag-"));
  writeFileSync(
    path.join(vault, "space-decl.md"),
    `---\nexo__Asset_uid: decl-uid\nexo__Instance_class:\n  - "[[${ASSET_SPACE_CLASS_UID}]]"\nexo__AssetSpace_source: https://github.com/${OWNER}/${REPO}\n---\n\nDeclaration\n`,
  );
  const full = path.join(vault, MOUNT, FILE_A);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, CONTENT_A);
  const wmDir = path.join(vault, ".obsidian", "plugins", "exocortex");
  mkdirSync(wmDir, { recursive: true });
  writeFileSync(
    path.join(wmDir, "exosync-watermarks.local.json"),
    JSON.stringify({
      version: 1,
      repos: {
        [`${OWNER}/${REPO}#main`]: {
          lastSyncedSha: HEAD,
          rootTreeSha: TREE,
          files: [{ path: FILE_A, blobSha: gitBlobShaSync(CONTENT_A) }],
        },
      },
    }),
  );
  return {
    vault,
    cleanup: () => rmSync(vault, { recursive: true, force: true }),
  };
}

describe("conditional requests are on by default and off only on request @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  const passthrough: RestCommitTransport = async () => ({
    status: 200,
    json: {},
  });
  const io = { read: async () => null, writeAtomic: async () => undefined };

  it("D1 defaults to enabled", () => {
    const wired = wireConditionalRequests(passthrough, { io, env: {} });
    expect(wired.cache).not.toBeNull();
    expect(wired.transport).not.toBe(passthrough);
  });

  it("D2 --no-conditional-requests hands the transport back untouched", () => {
    const wired = wireConditionalRequests(passthrough, {
      io,
      env: {},
      enabled: false,
    });
    expect(wired.cache).toBeNull();
    expect(wired.transport).toBe(passthrough);
  });

  it.each(["0", "false", "off"])(
    "D3 EXOCORTEX_EXOSYNC_CONDITIONAL=%s disables it too",
    (value) => {
      const wired = wireConditionalRequests(passthrough, {
        io,
        env: { EXOCORTEX_EXOSYNC_CONDITIONAL: value },
      });
      expect(wired.cache).toBeNull();
    },
  );
});

describe("the wiring is pinned at the command level @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  let fixture: { vault: string; cleanup: () => void };

  beforeEach(() => {
    fixture = makeVault();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  it("D4 `exosync-parity`: the second run validates instead of re-reading", async () => {
    const remote = conditionalRemote({ [FILE_A]: CONTENT_A });
    const parity = async (over = {}): Promise<number> =>
      runExosyncParity(
        { vault: fixture.vault, token: FAKE_PAT, ...over },
        { transportFactory: () => remote, out: () => undefined, env: {} },
      );

    await parity();
    // Canary on the FIRST request, not the first run: parity reads the ref
    // twice per round (its race guard), so the saving already starts inside
    // one run — the second ref read is validated, not re-fetched.
    expect(remote.seen[0].headers?.["If-None-Match"]).toBeUndefined();
    const conditionalAfterFirst = remote.conditional().length;
    const notModifiedAfterFirst = remote.notModified();
    expect(remote.seen.length).toBeGreaterThan(0);

    await parity();
    // Every repeated read now carries If-None-Match and comes back 304 —
    // the request still goes out, but GitHub does not charge primary quota.
    expect(remote.conditional().length).toBeGreaterThan(conditionalAfterFirst);
    expect(remote.notModified()).toBeGreaterThan(notModifiedAfterFirst);
  });

  it("D5 negative control — with --no-conditional-requests nothing is validated", async () => {
    const remote = conditionalRemote({ [FILE_A]: CONTENT_A });
    const parity = async (): Promise<number> =>
      runExosyncParity(
        { vault: fixture.vault, token: FAKE_PAT, conditionalRequests: false },
        { transportFactory: () => remote, out: () => undefined, env: {} },
      );
    await parity();
    await parity();
    expect(remote.conditional()).toHaveLength(0);
    expect(remote.notModified()).toBe(0);
  });

  it("D6 `exosync sync` goes through the same wiring", async () => {
    const remote = conditionalRemote({ [FILE_A]: CONTENT_A });
    const pull = async (): Promise<number> =>
      runExosyncSync(
        "pull",
        { vault: fixture.vault, token: FAKE_PAT },
        { transportFactory: () => remote, out: () => undefined, env: {} },
      );
    await pull();
    expect(remote.conditional()).toHaveLength(0);
    await pull();
    expect(remote.conditional().length).toBeGreaterThan(0);
    expect(remote.notModified()).toBeGreaterThan(0);
  });

  it("D7 negative control — `exosync sync` with the flag off validates nothing", async () => {
    const remote = conditionalRemote({ [FILE_A]: CONTENT_A });
    const pull = async (): Promise<number> =>
      runExosyncSync(
        "pull",
        { vault: fixture.vault, token: FAKE_PAT, conditionalRequests: false },
        { transportFactory: () => remote, out: () => undefined, env: {} },
      );
    await pull();
    await pull();
    expect(remote.conditional()).toHaveLength(0);
  });

  it("D8 the sync verdict is unchanged by the conditional path", async () => {
    const withCond = conditionalRemote({ [FILE_A]: CONTENT_A });
    const withoutCond = conditionalRemote({ [FILE_A]: CONTENT_A });
    const second = makeVault();
    try {
      const run = async (
        vault: string,
        remote: RestCommitTransport,
        over = {},
      ): Promise<{ code: number; lines: string[] }> => {
        const lines: string[] = [];
        const code = await runExosyncSync(
          "pull",
          { vault, token: FAKE_PAT, ...over },
          {
            transportFactory: () => remote,
            out: (l) => lines.push(l),
            env: {},
          },
        );
        return { code, lines };
      };

      await run(fixture.vault, withCond);
      const a = await run(fixture.vault, withCond);
      await run(second.vault, withoutCond, { conditionalRequests: false });
      const b = await run(second.vault, withoutCond, {
        conditionalRequests: false,
      });

      expect(a.code).toBe(b.code);
      const summary = (l: string[]): string | undefined =>
        l.find((x) => x.startsWith("Summary:"));
      expect(summary(a.lines)).toBe(summary(b.lines));
    } finally {
      second.cleanup();
    }
  });
});
