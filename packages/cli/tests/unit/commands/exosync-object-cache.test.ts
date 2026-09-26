/**
 * req 086df113-16bb-4912-bb09-3a13ee187043 (issue #4410) — the immutable-object
 * cache as the CLI actually ships it.
 *
 * The core suite proves the cache BEHAVES; this suite proves it is WIRED and
 * on by default. Deleting the `wireObjectCache(...)` call from a command reds
 * B2/B3 here and nothing in the core suite — that is the whole point of
 * keeping both (a cache nobody calls is indistinguishable from no cache).
 */

import { createHash, webcrypto } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { ASSET_SPACE_CLASS_UID } from "@kitelev/exocortex-core";
import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
  Sha1Fn,
} from "@kitelev/exocortex-core";

import { runExosyncParity } from "../../../src/commands/exosync-parity.js";
import { wireObjectCache } from "../../../src/services/objectCacheTransport.js";
import {
  nodeObjectCacheIO,
  resolveObjectCacheMaxBytes,
  resolveObjectCacheRoot,
} from "../../../src/services/nodeObjectCacheIO.js";

const OWNER = "kitelev";
const REPO = "exoas-public";
const MOUNT = `assetspaces/${OWNER}/${REPO}`;
const FILE_A = "assets/a.md";
const CONTENT_A = `---\nexo__Asset_uid: u-a\n---\n\nbody A\n`;
const FAKE_PAT = "ghp_" + "C".repeat(36);
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);

const sha1: Sha1Fn = async (bytes) => {
  const digest = await webcrypto.subtle.digest(
    "SHA-1",
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  return Buffer.from(digest).toString("hex");
};

function gitBlobShaSync(content: string): string {
  const body = Buffer.from(content, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
}

/**
 * Counting Git Data fake. Unlike the parity suite's fake this one answers the
 * blob with its real `sha` — GitHub does, and the cache verifies blobs by
 * recomputing the git object SHA from the bytes.
 */
function countingRemote(files: Record<string, string>): RestCommitTransport & {
  calls: string[];
  objectCalls: () => string[];
} {
  const calls: string[] = [];
  const blobs = new Map(
    Object.entries(files).map(([, c]) => [gitBlobShaSync(c), c] as const),
  );
  const fn = async (req: RestCommitRequest): Promise<RestCommitResponse> => {
    calls.push(`${req.method} ${req.url}`);
    const { url } = req;
    if (/\/git\/refs\/heads\//.test(url)) {
      return { status: 200, json: { object: { sha: HEAD } } };
    }
    if (url.includes(`/git/commits/${HEAD}`)) {
      return {
        status: 200,
        json: { sha: HEAD, tree: { sha: TREE }, parents: [] },
      };
    }
    if (url.includes(`/git/trees/${TREE}`)) {
      return {
        status: 200,
        json: {
          sha: TREE,
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
    const blob = /\/git\/blobs\/([0-9a-f]{40})/.exec(url);
    if (blob) {
      const content = blobs.get(blob[1]);
      if (content === undefined) {
        throw new Error(`GitHub request GET ${url} → HTTP 404: Not Found`);
      }
      return {
        status: 200,
        json: {
          sha: blob[1],
          content: Buffer.from(content, "utf-8").toString("base64"),
          encoding: "base64",
        },
      };
    }
    throw new Error(
      `GitHub request ${req.method} ${url} → HTTP 404: unhandled`,
    );
  };
  return Object.assign(fn, {
    calls,
    objectCalls: (): string[] =>
      calls.filter((c) => /\/git\/(commits|trees|blobs)\//.test(c)),
  });
}

function makeVault(): { vault: string; cleanup: () => void } {
  const vault = mkdtempSync(path.join(tmpdir(), "exosync-objcache-"));
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

describe("B1 the cache is ON by default and OFF only on request @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  const passthrough: RestCommitTransport = async () => ({
    status: 200,
    json: {},
  });

  it("B1 defaults to enabled — an untouched environment gets a cache", () => {
    const wired = wireObjectCache(passthrough, { sha1, env: {} });
    expect(wired.cache).not.toBeNull();
    expect(wired.transport).not.toBe(passthrough);
  });

  it("B2 --no-object-cache hands back the transport untouched", () => {
    const wired = wireObjectCache(passthrough, {
      sha1,
      env: {},
      enabled: false,
    });
    expect(wired.cache).toBeNull();
    expect(wired.transport).toBe(passthrough);
  });

  it.each(["0", "false", "off"])(
    "B3 EXOCORTEX_EXOSYNC_CACHE=%s disables it too",
    (value) => {
      const wired = wireObjectCache(passthrough, {
        sha1,
        env: { EXOCORTEX_EXOSYNC_CACHE: value },
      });
      expect(wired.cache).toBeNull();
      expect(wired.transport).toBe(passthrough);
    },
  );
});

describe("B2 `exosync-parity` serves immutable objects from the cache @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  let fixture: { vault: string; cleanup: () => void };
  let cacheRoot: string;
  const saved = { ...process.env };

  beforeEach(() => {
    fixture = makeVault();
    cacheRoot = mkdtempSync(path.join(tmpdir(), "exosync-objcache-store-"));
    process.env.EXOCORTEX_EXOSYNC_CACHE = "1";
    process.env.EXOCORTEX_EXOSYNC_CACHE_DIR = cacheRoot;
  });

  afterEach(() => {
    fixture.cleanup();
    rmSync(cacheRoot, { recursive: true, force: true });
    process.env.EXOCORTEX_EXOSYNC_CACHE = saved.EXOCORTEX_EXOSYNC_CACHE;
    process.env.EXOCORTEX_EXOSYNC_CACHE_DIR = saved.EXOCORTEX_EXOSYNC_CACHE_DIR;
  });

  async function parity(
    remote: RestCommitTransport,
    over: Record<string, unknown> = {},
  ): Promise<number> {
    return runExosyncParity(
      { vault: fixture.vault, token: FAKE_PAT, ...over },
      { transportFactory: () => remote, out: () => undefined, env: {} },
    );
  }

  it("B4 the SECOND run over the same device store issues no object requests at all", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });

    const first = await parity(remote);
    const afterFirst = remote.objectCalls().length;
    expect(afterFirst).toBeGreaterThan(0); // canary: the run really read objects

    const second = await parity(remote);

    expect(second).toBe(first);
    expect(remote.objectCalls()).toHaveLength(afterFirst); // no NEW object calls
    // The mutable head checks still go out — only immutable reads are cached.
    // Parity reads the ref twice per round (before and after, its race guard),
    // so two rounds must still cost four ref calls.
    expect(remote.calls.filter((c) => c.includes("/git/refs/"))).toHaveLength(
      4,
    );
  });

  it("B5 negative control — with --no-object-cache the second run repeats them", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    await parity(remote, { objectCache: false });
    const afterFirst = remote.objectCalls().length;
    await parity(remote, { objectCache: false });
    expect(remote.objectCalls().length).toBe(afterFirst * 2);
  });
});

describe("B3 the Node store resolves where the requirement says it does @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("B6 honours the explicit dir, then XDG, then ~/.cache", () => {
    expect(
      resolveObjectCacheRoot({ EXOCORTEX_EXOSYNC_CACHE_DIR: "/tmp/x" }),
    ).toBe("/tmp/x");
    expect(resolveObjectCacheRoot({ XDG_CACHE_HOME: "/tmp/xdg" })).toBe(
      path.join("/tmp/xdg", "exocortex", "exosync-objects"),
    );
    expect(resolveObjectCacheRoot({})).toMatch(
      /\.cache[/\\]exocortex[/\\]exosync-objects$/,
    );
  });

  it("B7 parses a size ceiling and ignores junk", () => {
    expect(
      resolveObjectCacheMaxBytes({
        EXOCORTEX_EXOSYNC_CACHE_MAX_BYTES: "1048576",
      }),
    ).toBe(1048576);
    expect(
      resolveObjectCacheMaxBytes({ EXOCORTEX_EXOSYNC_CACHE_MAX_BYTES: "nope" }),
    ).toBeUndefined();
    expect(resolveObjectCacheMaxBytes({})).toBeUndefined();
  });

  it("B8 round-trips through the real filesystem, including LRU metadata", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "exosync-objcache-io-"));
    try {
      const io = nodeObjectCacheIO(root);
      expect(await io.read(`${OWNER}/${REPO}/commits/${HEAD}`)).toBeNull();
      await io.write(`${OWNER}/${REPO}/commits/${HEAD}`, '{"sha":"x"}');
      expect(await io.read(`${OWNER}/${REPO}/commits/${HEAD}`)).toBe(
        '{"sha":"x"}',
      );

      const listed = await io.list();
      expect(listed).toHaveLength(1);
      expect(listed[0].key).toBe(`${OWNER}/${REPO}/commits/${HEAD}`);
      expect(listed[0].size).toBeGreaterThan(0);

      await io.remove(`${OWNER}/${REPO}/commits/${HEAD}`);
      expect(await io.read(`${OWNER}/${REPO}/commits/${HEAD}`)).toBeNull();
      expect(await io.list()).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
