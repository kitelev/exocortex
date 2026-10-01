it("A6 a truncated (unparseable) entry throws", async () => {
  const io = memoryIO();
  const transport = withImmutableObjectCache(
    countingTransport(),
    makeCache(io),
  );
  await transport({ method: "GET", url: commitUrl(HEAD) });
  io.map.set(`${OWNER}/${REPO}/commits/${HEAD}`, {
    content: '{"v": 1, "sha": "a',
    lastUsedMs: 1,
  });
  await expect(
    transport({ method: "GET", url: commitUrl(HEAD) }),
  ).rejects.toThrow(/failed its integrity check/);
});

/**
 * req 086df113-16bb-4912-bb09-3a13ee187043 (issue #4410) — content-addressed
 * cache for immutable git objects.
 *
 * One axis per guarantee the requirement states, each with a mutant that reds
 * exactly it (see `immutableObjectCache.spec.json`).
 */

import { createHash } from "node:crypto";

import {
  ImmutableObjectCache,
  parseImmutableObjectUrl,
  withImmutableObjectCache,
  type ObjectCacheEntry,
  type ObjectCacheIO,
} from "../../../../src/services/sync/immutableObjectCache";
import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
} from "../../../../src/infrastructure/github/restCommit";
import type { Sha1Fn } from "../../../../src/services/sync/syncTypes";

const API = "https://api.github.com";
const OWNER = "kitelev";
const REPO = "exoas-public";

const sha1: Sha1Fn = async (bytes) =>
  createHash("sha1").update(Buffer.from(bytes)).digest("hex");

function gitBlobShaSync(content: string): string {
  const body = Buffer.from(content, "utf-8");
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`), body]))
    .digest("hex");
}

/** In-memory store standing in for the Node/plugin adapters. */
function memoryIO(): ObjectCacheIO & {
  map: Map<string, { content: string; lastUsedMs: number }>;
} {
  const map = new Map<string, { content: string; lastUsedMs: number }>();
  let clock = 1_000;
  return {
    map,
    async read(key) {
      return map.get(key)?.content ?? null;
    },
    async write(key, content) {
      map.set(key, { content, lastUsedMs: ++clock });
    },
    async remove(key) {
      map.delete(key);
    },
    async list(): Promise<ObjectCacheEntry[]> {
      return [...map.entries()].map(([key, v]) => ({
        key,
        size: v.content.length,
        lastUsedMs: v.lastUsedMs,
      }));
    },
    async markUsed(key) {
      const v = map.get(key);
      if (v) v.lastUsedMs = ++clock;
    },
  };
}

/**
 * Build a stored envelope. `digest: "stale"` keeps the ORIGINAL digest while
 * the body changes (what a torn write or a flipped bit looks like);
 * `digest: "recomputed"` re-derives it (what a deliberate edit looks like, and
 * the only case where the content-addressing layer has to answer).
 */
async function envelope(
  sha: string,
  body: unknown,
  mode: "recomputed" | "stale" = "recomputed",
  staleFrom?: unknown,
): Promise<string> {
  const bodyText = JSON.stringify(body);
  const digestSource =
    mode === "recomputed" ? bodyText : JSON.stringify(staleFrom ?? body);
  const digest = await sha1(new TextEncoder().encode(digestSource));
  return JSON.stringify({ v: 1, sha, digest, body: bodyText });
}

function commitUrl(sha: string): string {
  return `${API}/repos/${OWNER}/${REPO}/git/commits/${sha}`;
}
function treeUrl(sha: string, recursive = true): string {
  return `${API}/repos/${OWNER}/${REPO}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`;
}
function blobUrl(sha: string): string {
  return `${API}/repos/${OWNER}/${REPO}/git/blobs/${sha}`;
}
function refUrl(): string {
  return `${API}/repos/${OWNER}/${REPO}/git/refs/heads/main`;
}

const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const BLOB_CONTENT = "---\nexo__Asset_uid: u-a\n---\n\nbody A\n";
const BLOB = gitBlobShaSync(BLOB_CONTENT);

/** Counting fake remote — every hit here is a network request that happened. */
function countingTransport(): RestCommitTransport & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (req: RestCommitRequest): Promise<RestCommitResponse> => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url.includes("/git/commits/")) {
      return {
        status: 200,
        json: { sha: HEAD, tree: { sha: TREE }, parents: [] },
      };
    }
    if (req.url.includes("/git/trees/")) {
      return { status: 200, json: { sha: TREE, truncated: false, tree: [] } };
    }
    if (req.url.includes("/git/blobs/")) {
      return {
        status: 200,
        json: {
          sha: BLOB,
          content: Buffer.from(BLOB_CONTENT, "utf-8").toString("base64"),
          encoding: "base64",
        },
      };
    }
    if (req.url.includes("/git/refs/")) {
      return { status: 200, json: { object: { sha: HEAD } } };
    }
    return { status: 200, json: {} };
  };
  return Object.assign(fn, { calls });
}

function makeCache(io: ObjectCacheIO, opts: { maxBytes?: number } = {}) {
  return new ImmutableObjectCache({
    io,
    sha1,
    sweepIntervalBytes: 0,
    ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
  });
}

describe("A1 immutable git objects are served from the cache without a network request @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A1 a repeated read of the same SHA issues exactly one request", async () => {
    const inner = countingTransport();
    const io = memoryIO();
    const transport = withImmutableObjectCache(inner, makeCache(io));

    const first = await transport({ method: "GET", url: commitUrl(HEAD) });
    const second = await transport({ method: "GET", url: commitUrl(HEAD) });

    expect(inner.calls).toEqual([`GET ${commitUrl(HEAD)}`]);
    expect(second.json).toEqual(first.json);
  });

  it("A2 covers all three content-addressed endpoints", async () => {
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(memoryIO()));
    for (const url of [commitUrl(HEAD), treeUrl(TREE), blobUrl(BLOB)]) {
      await transport({ method: "GET", url });
      await transport({ method: "GET", url });
    }
    expect(inner.calls).toHaveLength(3);
  });
});

describe("A2 a shared AssetSpace is fetched over the network once per device @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A3 a second sync run over the SAME device store reuses the first run's objects", async () => {
    const io = memoryIO(); // the device-wide store, shared by both runs
    const inner = countingTransport();

    // vault #1
    const runOne = withImmutableObjectCache(inner, makeCache(io));
    await runOne({ method: "GET", url: treeUrl(TREE) });
    await runOne({ method: "GET", url: blobUrl(BLOB) });
    expect(inner.calls).toHaveLength(2);

    // vault #2 — a fresh cache instance over the same store (a separate CLI run)
    const runTwo = withImmutableObjectCache(inner, makeCache(io));
    const tree = await runTwo({ method: "GET", url: treeUrl(TREE) });
    const blob = await runTwo({ method: "GET", url: blobUrl(BLOB) });

    expect(inner.calls).toHaveLength(2); // unchanged — no new network requests
    expect((tree.json as { sha: string }).sha).toBe(TREE);
    expect((blob.json as { sha: string }).sha).toBe(BLOB);
  });

  it("A4 negative control — a DIFFERENT repository does not reuse the entry", async () => {
    const io = memoryIO();
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(io));
    await transport({ method: "GET", url: treeUrl(TREE) });
    await transport({
      method: "GET",
      url: `${API}/repos/${OWNER}/other-repo/git/trees/${TREE}?recursive=1`,
    });
    expect(inner.calls).toHaveLength(2);
  });
});

describe("A3 a corrupted cache entry fails LOUD and is never applied @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A5 tampered blob content throws instead of returning the tampered bytes", async () => {
    const io = memoryIO();
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(io));
    await transport({ method: "GET", url: blobUrl(BLOB) });

    // Layer 1: the bytes changed, the digest did not — a torn write.
    const key = `${OWNER}/${REPO}/blobs/${BLOB}`;
    const original = {
      sha: BLOB,
      content: Buffer.from(BLOB_CONTENT, "utf-8").toString("base64"),
      encoding: "base64",
    };
    io.map.set(key, {
      content: await envelope(
        BLOB,
        {
          sha: BLOB,
          content: Buffer.from("EVIL", "utf-8").toString("base64"),
          encoding: "base64",
        },
        "stale",
        original,
      ),
      lastUsedMs: 1,
    });

    await expect(
      transport({ method: "GET", url: blobUrl(BLOB) }),
    ).rejects.toThrow(/does not match the payload/);
  });

  it("A22 a DELIBERATE blob edit — digest recomputed — is still caught by content addressing", async () => {
    const io = memoryIO();
    const transport = withImmutableObjectCache(
      countingTransport(),
      makeCache(io),
    );
    await transport({ method: "GET", url: blobUrl(BLOB) });

    // Layer 2: digest consistent, `sha` field intact — only the CONTENT lies.
    io.map.set(`${OWNER}/${REPO}/blobs/${BLOB}`, {
      content: await envelope(BLOB, {
        sha: BLOB,
        content: Buffer.from("EVIL", "utf-8").toString("base64"),
        encoding: "base64",
      }),
      lastUsedMs: 1,
    });

    await expect(
      transport({ method: "GET", url: blobUrl(BLOB) }),
    ).rejects.toThrow(/recomputed blob sha/);
  });

  it("A23 a tampered TREE entry is caught by the stored digest", async () => {
    // The case content addressing cannot answer: `?recursive=1` is a flattened
    // listing, not one git object, so its hash is not recomputable. Without
    // the digest layer this swap would be applied and `diffTrees` would fetch
    // the wrong blob for that path.
    const io = memoryIO();
    const transport = withImmutableObjectCache(
      countingTransport(),
      makeCache(io),
    );
    await transport({ method: "GET", url: treeUrl(TREE) });

    const key = `${OWNER}/${REPO}/trees/${TREE}~recursive=1`;
    const honest = { sha: TREE, truncated: false, tree: [] };
    io.map.set(key, {
      content: await envelope(
        TREE,
        {
          sha: TREE,
          truncated: false,
          tree: [{ path: "a.md", type: "blob", sha: "e".repeat(40) }],
        },
        "stale",
        honest,
      ),
      lastUsedMs: 1,
    });

    await expect(
      transport({ method: "GET", url: treeUrl(TREE) }),
    ).rejects.toThrow(/does not match the payload/);
  });

  it("A24 an entry in the OLD (pre-envelope) format is a miss, not corruption", async () => {
    const io = memoryIO();
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(io));
    io.map.set(`${OWNER}/${REPO}/commits/${HEAD}`, {
      content: JSON.stringify({ sha: HEAD, tree: { sha: TREE } }),
      lastUsedMs: 1,
    });
    const resp = await transport({ method: "GET", url: commitUrl(HEAD) });
    expect(resp.status).toBe(200);
    expect(inner.calls).toHaveLength(1); // re-fetched, nothing thrown
  });

  it("A6 a truncated (unparseable) entry throws", async () => {
    const io = memoryIO();
    const transport = withImmutableObjectCache(
      countingTransport(),
      makeCache(io),
    );
    await transport({ method: "GET", url: commitUrl(HEAD) });
    io.map.set(`${OWNER}/${REPO}/commits/${HEAD}`, {
      content: '{"sha": "a',
      lastUsedMs: 1,
    });
    await expect(
      transport({ method: "GET", url: commitUrl(HEAD) }),
    ).rejects.toThrow(/failed its integrity check/);
  });

  it("A7 a commit entry filed under the wrong sha throws", async () => {
    const io = memoryIO();
    const transport = withImmutableObjectCache(
      countingTransport(),
      makeCache(io),
    );
    await transport({ method: "GET", url: commitUrl(HEAD) });
    io.map.set(`${OWNER}/${REPO}/commits/${HEAD}`, {
      content: await envelope(HEAD, {
        sha: "c".repeat(40),
        tree: { sha: TREE },
      }),
      lastUsedMs: 1,
    });
    await expect(
      transport({ method: "GET", url: commitUrl(HEAD) }),
    ).rejects.toThrow(/does not match the requested sha/);
  });

  it("A8 an UNREADABLE store falls through to the network instead of throwing", async () => {
    const io = memoryIO();
    const failing: ObjectCacheIO = {
      ...io,
      async read() {
        throw new Error("EIO");
      },
    };
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(failing));
    const resp = await transport({ method: "GET", url: commitUrl(HEAD) });
    expect((resp.json as { sha: string }).sha).toBe(HEAD);
    expect(inner.calls).toHaveLength(1);
  });
});

describe("A4 the cache is bounded by LRU eviction @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A9 drops the LEAST-recently-used entry first, keeping the freshly used one", async () => {
    // Fixed-size synthetic entries: the eviction ORDER is the guarantee, so the
    // fixture pins sizes and last-use stamps instead of deriving them from the
    // payloads the transport happens to produce.
    const entries: ObjectCacheEntry[] = [
      { key: "o/r/blobs/old", size: 100, lastUsedMs: 10 },
      { key: "o/r/blobs/mid", size: 100, lastUsedMs: 20 },
      { key: "o/r/blobs/new", size: 100, lastUsedMs: 30 },
    ];
    const removed: string[] = [];
    const io: ObjectCacheIO = {
      async read() {
        return null;
      },
      async write() {},
      async remove(key) {
        removed.push(key);
      },
      async list() {
        return entries;
      },
      async markUsed() {},
    };
    const cache = new ImmutableObjectCache({ io, sha1, maxBytes: 250 });

    await cache.evict();

    expect(removed).toEqual(["o/r/blobs/old"]);
    expect(cache.stats().evictions).toBe(1);
  });

  it("A10 keeps evicting until the store fits under the ceiling", async () => {
    const io = memoryIO();
    const cache = makeCache(io, { maxBytes: 120 });
    const transport = withImmutableObjectCache(countingTransport(), cache);

    await transport({ method: "GET", url: commitUrl(HEAD) });
    await transport({ method: "GET", url: treeUrl(TREE) });
    await transport({ method: "GET", url: blobUrl(BLOB) });

    const total = [...io.map.values()].reduce(
      (n, v) => n + v.content.length,
      0,
    );
    expect(total).toBeLessThanOrEqual(120);
    expect(cache.stats().evictions).toBeGreaterThan(0);
  });

  it("A11 negative control — a generous ceiling evicts nothing", async () => {
    const io = memoryIO();
    const cache = makeCache(io, { maxBytes: 10 * 1024 * 1024 });
    const transport = withImmutableObjectCache(countingTransport(), cache);
    await transport({ method: "GET", url: commitUrl(HEAD) });
    await transport({ method: "GET", url: treeUrl(TREE) });
    await transport({ method: "GET", url: blobUrl(BLOB) });
    expect(cache.stats().evictions).toBe(0);
    expect(io.map.size).toBe(3);
  });
});

describe("the ceiling survives across PROCESSES, not just within one @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A25 a fresh cache over an already-oversized store evicts on its FIRST store", async () => {
    // Every CLI invocation builds a new ImmutableObjectCache over the SAME
    // device-wide store. A per-process byte counter therefore restarts at 0,
    // and a run with a small delta would never sweep however large the store
    // already was — the store would grow without bound across runs. (Review
    // finding; the axis is what keeps the fix from being undone.)
    const io = memoryIO();
    for (let i = 0; i < 5; i += 1) {
      io.map.set(`old/repo/commits/${String(i).repeat(40)}`, {
        content: "x".repeat(100),
        lastUsedMs: i,
      });
    }
    expect(io.map.size).toBe(5);

    // A brand-new cache, a ceiling the store already exceeds, and a sweep
    // interval far larger than anything this run will write.
    const cache = new ImmutableObjectCache({
      io,
      sha1,
      maxBytes: 250,
      sweepIntervalBytes: 10 * 1024 * 1024,
    });
    const transport = withImmutableObjectCache(countingTransport(), cache);
    await transport({ method: "GET", url: commitUrl(HEAD) });

    expect(cache.stats().evictions).toBeGreaterThan(0);
    const total = [...io.map.values()].reduce(
      (n, v) => n + v.content.length,
      0,
    );
    expect(total).toBeLessThanOrEqual(250);
  });
});

describe("A5 MUTABLE reads are never cached @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A12 git/refs goes to the network every single time", async () => {
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(memoryIO()));
    await transport({ method: "GET", url: refUrl() });
    await transport({ method: "GET", url: refUrl() });
    expect(inner.calls).toHaveLength(2);
  });

  it("A13 a REF-addressed tree read (git/trees/main) is not cached either", async () => {
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(memoryIO()));
    const url = `${API}/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`;
    await transport({ method: "GET", url });
    await transport({ method: "GET", url });
    expect(inner.calls).toHaveLength(2);
  });

  it("A14 non-GET requests pass through untouched", async () => {
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(memoryIO()));
    // Deliberately a URL that DOES parse as cacheable: the guard under test is
    // "a cache is a READ optimisation", not "write URLs happen to look
    // different". With the plain `POST git/trees` URL the parser alone would
    // refuse it and this axis would be vacuous.
    await transport({ method: "POST", url: blobUrl(BLOB), body: "{}" });
    await transport({ method: "POST", url: blobUrl(BLOB), body: "{}" });
    expect(inner.calls).toHaveLength(2);
  });
});

describe("A6 two representations of one tree do not share an entry @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it("A15 ?recursive=1 and the plain form are separate cache keys", async () => {
    const inner = countingTransport();
    const transport = withImmutableObjectCache(inner, makeCache(memoryIO()));
    await transport({ method: "GET", url: treeUrl(TREE, true) });
    await transport({ method: "GET", url: treeUrl(TREE, false) });
    expect(inner.calls).toHaveLength(2);
  });
});

describe("A7 URL parsing refuses anything that is not a SHA-addressed object @req:086df113-16bb-4912-bb09-3a13ee187043", () => {
  it.each([
    [`${API}/repos/${OWNER}/${REPO}/git/refs/heads/main`, "mutable ref"],
    [`${API}/repos/${OWNER}/${REPO}/git/trees/main`, "ref-addressed tree"],
    [`${API}/repos/${OWNER}/${REPO}/git/blobs/../../etc/passwd`, "traversal"],
    [`${API}/repos/${OWNER}/${REPO}/contents/x.md`, "not a git object"],
    [`${API}/repos/${OWNER}/${REPO}/git/commits/${HEAD}/extra`, "trailing seg"],
    [
      `${API}/repos/${OWNER}/${REPO}/git/commits/${HEAD.toUpperCase()}`,
      "upper",
    ],
    ["not-a-url", "unparseable"],
  ])("A16 %s → not cacheable (%s)", (url) => {
    expect(parseImmutableObjectUrl(url)).toBeNull();
  });

  // Owner and repo are the segments the Node adapter joins into a PATH, and
  // the existing traversal case only exercises the SHA position. These forms
  // SURVIVE `new URL`'s dot-segment normalisation (measured), so they really
  // do reach the character-class check — unlike a plain `..`, which the URL
  // parser removes before the parse gets there.
  it.each([
    [`${API}/repos/..%00/${REPO}/git/commits/${HEAD}`, "owner ..%00"],
    [`${API}/repos/${OWNER}/..;/git/commits/${HEAD}`, "repo ..;"],
    [`${API}/repos/%252e%252e/${REPO}/git/commits/${HEAD}`, "double-encoded"],
  ])("A19 %s → refused by the segment class (%s)", (url) => {
    expect(parseImmutableObjectUrl(url)).toBeNull();
  });

  it("A20 a plain `..` never reaches the segment check — the URL parser removes it", () => {
    // Not vacuous by accident: it documents WHICH guard answers. `repos`
    // disappears from the normalised path, so the anchor lookup fails first.
    const url = `${API}/repos/../${REPO}/git/commits/${HEAD}`;
    expect(new URL(url).pathname).not.toContain("repos");
    expect(parseImmutableObjectUrl(url)).toBeNull();
  });

  it("A21 `...` is an ordinary directory name and IS accepted", () => {
    const ref = parseImmutableObjectUrl(
      `${API}/repos/.../${REPO}/git/commits/${HEAD}`,
    );
    expect(ref?.key).toBe(`.../${REPO}/commits/${HEAD}`);
  });

  it("A17 positive control — a SHA-addressed tree IS cacheable", () => {
    const ref = parseImmutableObjectUrl(treeUrl(TREE));
    expect(ref).not.toBeNull();
    expect(ref?.key).toBe(`${OWNER}/${REPO}/trees/${TREE}~recursive=1`);
  });

  it("A18 a proxied API base is still recognised", () => {
    const ref = parseImmutableObjectUrl(
      `http://127.0.0.1:8080/gh/repos/${OWNER}/${REPO}/git/commits/${HEAD}`,
    );
    expect(ref?.key).toBe(`${OWNER}/${REPO}/commits/${HEAD}`);
  });
});
