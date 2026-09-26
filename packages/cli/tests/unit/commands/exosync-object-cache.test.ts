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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
import { runExosyncSync } from "../../../src/commands/exosync-sync.js";
import { runQuarantineList } from "../../../src/commands/exosync-quarantine.js";
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

function makeVault(opts: { pinnedPaths?: string[] } = {}): {
  vault: string;
  cleanup: () => void;
} {
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
          // A pinned path is what makes `quarantine list` consult the remote
          // at all — without one it classifies from local state and issues no
          // request, which would make the wiring axis vacuous.
          ...(opts.pinnedPaths !== undefined
            ? { pinnedPaths: opts.pinnedPaths }
            : {}),
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

/**
 * ⛔ The wiring lives at THREE call sites and B4/B5 pin only `exosync-parity`.
 * Deleting the `wireObjectCache(...)` line from `exosync-sync.ts` — the main
 * command — or from `exosync-quarantine.ts` would red NOTHING without these.
 * (Found by review on the WIP commit, not by the axes.)
 */
describe("the SAME wiring is pinned at every call site @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  let fixture: { vault: string; cleanup: () => void };
  let cacheRoot: string;
  const saved = { ...process.env };

  beforeEach(() => {
    fixture = makeVault();
    cacheRoot = mkdtempSync(path.join(tmpdir(), "exosync-objcache-site-"));
    process.env.EXOCORTEX_EXOSYNC_CACHE = "1";
    process.env.EXOCORTEX_EXOSYNC_CACHE_DIR = cacheRoot;
  });

  afterEach(() => {
    fixture.cleanup();
    rmSync(cacheRoot, { recursive: true, force: true });
    process.env.EXOCORTEX_EXOSYNC_CACHE = saved.EXOCORTEX_EXOSYNC_CACHE;
    process.env.EXOCORTEX_EXOSYNC_CACHE_DIR = saved.EXOCORTEX_EXOSYNC_CACHE_DIR;
  });

  it("B9 a SECOND vault's `exosync sync` reuses the first vault's objects", async () => {
    // ⛔ NOT "the same vault twice": a second pull at an unmoved head reads no
    // objects at all, so that pair is green with and without the cache — the
    // first draft of this axis was vacuous, and B10 is what exposed it.
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    const second = makeVault();
    try {
      const pull = async (vault: string, over = {}): Promise<number> =>
        runExosyncSync(
          "pull",
          { vault, token: FAKE_PAT, ...over },
          { transportFactory: () => remote, out: () => undefined, env: {} },
        );

      await pull(fixture.vault);
      const afterFirstVault = remote.objectCalls().length;
      expect(afterFirstVault).toBeGreaterThan(0);

      await pull(second.vault);
      expect(remote.objectCalls()).toHaveLength(afterFirstVault);
    } finally {
      second.cleanup();
    }
  });

  it("B10 negative control — with --no-object-cache the second vault re-reads them", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    const second = makeVault();
    try {
      const pull = async (vault: string): Promise<number> =>
        runExosyncSync(
          "pull",
          { vault, token: FAKE_PAT, objectCache: false },
          { transportFactory: () => remote, out: () => undefined, env: {} },
        );
      await pull(fixture.vault);
      const afterFirstVault = remote.objectCalls().length;
      await pull(second.vault);
      expect(remote.objectCalls().length).toBeGreaterThan(afterFirstVault);
    } finally {
      second.cleanup();
    }
  });

  it("B11 `exosync quarantine list` goes through the same wiring", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    const pinned = makeVault({ pinnedPaths: [FILE_A] });
    try {
      // ⛔ Ось НЕ греет хранилище через `sync`: замерено, что прогон quarantine
      // ПОСЛЕ синка не делает НИ ОДНОГО запроса вовсе, и тогда
      // `objectCalls() === afterSync` удовлетворяется нулём — ось была зелёной
      // и с проводкой, и без неё (мутант M1_quarantine_wiring_removed не
      // краснил ничего). Третья точка сборки обязана судиться СВОИМИ
      // прогонами, иначе ось меряет чужую проводку.
      const list = async (): Promise<number> =>
        runQuarantineList(
          { vault: pinned.vault, token: FAKE_PAT },
          { transportFactory: () => remote, out: () => undefined, env: {} },
        );

      await list();
      const afterFirst = remote.objectCalls().length;
      expect(afterFirst).toBeGreaterThan(0); // канарейка: прогон реально читал объекты

      await list();
      // Второй прогон не платит за те же неизменяемые объекты повторно.
      expect(remote.objectCalls()).toHaveLength(afterFirst);
    } finally {
      pinned.cleanup();
    }
  });

  it("B12 a SECOND vault on the same device reuses the first vault's objects", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    const second = makeVault();
    try {
      await runExosyncParity(
        { vault: fixture.vault, token: FAKE_PAT },
        { transportFactory: () => remote, out: () => undefined, env: {} },
      );
      const afterFirstVault = remote.objectCalls().length;
      expect(afterFirstVault).toBeGreaterThan(0);

      await runExosyncParity(
        { vault: second.vault, token: FAKE_PAT },
        { transportFactory: () => remote, out: () => undefined, env: {} },
      );
      // The store is DEVICE-wide, so the second vault pays nothing for the
      // objects the first already fetched — the cross-vault half of the req.
      expect(remote.objectCalls()).toHaveLength(afterFirstVault);
    } finally {
      second.cleanup();
    }
  });

  it("B14 the saving is reported, not invisible", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    const lines: string[] = [];
    const parityWith = async (out: (l: string) => void): Promise<number> =>
      runExosyncParity(
        { vault: fixture.vault, token: FAKE_PAT },
        { transportFactory: () => remote, out, env: {} },
      );

    await parityWith(() => undefined);
    await parityWith((l) => lines.push(l));

    const report = lines.find((l) => l.startsWith("[ExoSync objects]"));
    expect(report).toBeDefined();
    expect(report).toMatch(/[1-9]\d* served from cache/);
  });

  it("B13 a tampered cache entry fails the repo's cycle loudly instead of being applied", async () => {
    const remote = countingRemote({ [FILE_A]: CONTENT_A });
    await runExosyncParity(
      { vault: fixture.vault, token: FAKE_PAT },
      { transportFactory: () => remote, out: () => undefined, env: {} },
    );

    // Tamper with the stored commit the way a torn write or a bit-flip would:
    // change the body, leave the envelope's digest as it was.
    const entryPath = path.join(
      cacheRoot,
      OWNER,
      REPO,
      "commits",
      `${HEAD}.json`,
    );
    const stored = JSON.parse(readFileSync(entryPath, "utf-8")) as {
      v: number;
      sha: string;
      digest: string;
      body: string;
    };
    writeFileSync(
      entryPath,
      JSON.stringify({
        ...stored,
        body: JSON.stringify({ sha: "f".repeat(40), tree: { sha: TREE } }),
      }),
      "utf-8",
    );

    const lines: string[] = [];
    const code = await runExosyncParity(
      { vault: fixture.vault, token: FAKE_PAT, json: true },
      { transportFactory: () => remote, out: (l) => lines.push(l), env: {} },
    );

    // The command does not throw out of the process — ExoSync reports per-repo
    // verdicts — but the repo's verdict is an ERROR naming the integrity
    // failure, and nothing from the tampered entry reaches the vault.
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toMatch(/failed its integrity check/);
  });
});

describe("concurrent writers of the SAME key cannot tear an entry @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("B15 20 concurrent writes of one key leave a valid, complete file", async () => {
    // Reachable TODAY, not only under a future `syncAll`: the engine already
    // fetches blobs through a bounded pool (BLOB_FETCH_CONCURRENCY = 6) and
    // does not dedupe by blob SHA, so two vault paths with byte-identical
    // content hit the same cache key inside ONE process. A per-process temp
    // name made both writers open the same temp path with truncate semantics.
    const root = mkdtempSync(path.join(tmpdir(), "exosync-objcache-race-"));
    try {
      const io = nodeObjectCacheIO(root);
      const key = `${OWNER}/${REPO}/blobs/${gitBlobShaSync(CONTENT_A)}`;
      const payloads = Array.from({ length: 20 }, (_, i) =>
        JSON.stringify({ writer: i, filler: "x".repeat(400_000) }),
      );

      await Promise.all(payloads.map((p) => io.write(key, p)));

      const stored = await io.read(key);
      expect(stored).not.toBeNull();
      // Whichever writer won, the file must be ONE of them in full — never a
      // splice of two.
      expect(payloads).toContain(stored);
      // And no temp file survives the race.
      const leftovers = (await io.list()).filter((e) => e.key.includes(".tmp"));
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
