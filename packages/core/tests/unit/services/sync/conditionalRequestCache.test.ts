/**
 * req af002ec4-ec4e-4482-b7b5-77e79dd332df (issue #3975) — conditional Git
 * Data reads via If-None-Match / ETag.
 *
 * One axis per guarantee the requirement states, each with a mutant that reds
 * exactly it (see `conditionalRequestCache.spec.json`).
 */

import {
  ConditionalRequestCache,
  conditionalCacheKey,
  withConditionalRequests,
  type ConditionalStoreIO,
} from "../../../../src/services/sync/conditionalRequestCache";
import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
} from "../../../../src/infrastructure/github/restCommit";

const API = "https://api.github.com";
const OWNER = "kitelev";
const REPO = "exoas-public";
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);

function refUrl(repo = REPO): string {
  return `${API}/repos/${OWNER}/${repo}/git/refs/heads/main`;
}
function treeUrl(sha = TREE): string {
  return `${API}/repos/${OWNER}/${REPO}/git/trees/${sha}?recursive=1`;
}

/** In-memory single-file store, mirroring the watermark IO contract. */
function memoryStore(): ConditionalStoreIO & { raw: () => string | null } {
  let content: string | null = null;
  return {
    async read() {
      return content;
    },
    async writeAtomic(next) {
      content = next;
    },
    raw: () => content,
  };
}

interface RemoteOptions {
  /** ETag the remote currently issues. */
  etag?: string;
  /** Body the remote currently serves. */
  body?: unknown;
  /** Omit the ETag header entirely (a server that does not issue one). */
  noEtag?: boolean;
}

/**
 * Git Data fake that honours `If-None-Match` the way GitHub does. Records
 * every request so an axis can assert on what actually went out.
 */
function conditionalRemote(opts: RemoteOptions = {}): RestCommitTransport & {
  seen: RestCommitRequest[];
  conditional: () => RestCommitRequest[];
  statuses: number[];
  setEtag: (etag: string, body: unknown) => void;
} {
  let etag = opts.etag ?? '"v1"';
  let body: unknown = opts.body ?? { object: { sha: HEAD } };
  const seen: RestCommitRequest[] = [];
  const statuses: number[] = [];
  const fn = async (req: RestCommitRequest): Promise<RestCommitResponse> => {
    seen.push(req);
    const sent = req.headers?.["If-None-Match"];
    const headers = opts.noEtag
      ? (): undefined => undefined
      : (name: string): string | undefined =>
          name.toLowerCase() === "etag" ? etag : undefined;
    if (sent !== undefined && sent === etag) {
      if (req.acceptNotModified !== true) {
        // GitHub still answers 304; a transport that was not told to accept it
        // throws, exactly as the unconditional contract says.
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
    setEtag: (nextEtag: string, nextBody: unknown): void => {
      etag = nextEtag;
      body = nextBody;
    },
  });
}

function makeCache(io: ConditionalStoreIO, over: { maxEntries?: number } = {}) {
  let tick = 0;
  return new ConditionalRequestCache({
    io,
    now: () => ++tick,
    ...(over.maxEntries !== undefined ? { maxEntries: over.maxEntries } : {}),
  });
}

describe("an unchanged repository answers 304 and spends no primary quota @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  it("C1 the second read carries If-None-Match and is answered 304", async () => {
    const remote = conditionalRemote();
    const cache = makeCache(memoryStore());
    const transport = withConditionalRequests(remote, cache);

    const first = await transport({ method: "GET", url: refUrl() });
    const second = await transport({ method: "GET", url: refUrl() });

    expect(remote.statuses).toEqual([200, 304]);
    expect(remote.conditional()).toHaveLength(1);
    expect(remote.seen[1].headers?.["If-None-Match"]).toBe('"v1"');
    expect(remote.seen[1].acceptNotModified).toBe(true);
    // The caller sees a normal 200 with the body the ETag stands for.
    expect(second.json).toEqual(first.json);
    expect(second.status).toBe(200);
    expect(cache.stats()).toMatchObject({ notModified: 1, conditional: 1 });
  });

  it("C2 the first read is unconditional — there is nothing to validate yet", async () => {
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(memoryStore()));
    await transport({ method: "GET", url: refUrl() });
    expect(remote.conditional()).toHaveLength(0);
    expect(remote.statuses).toEqual([200]);
  });

  it("C3 covers refs, commits and trees alike", async () => {
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(memoryStore()));
    const urls = [
      refUrl(),
      `${API}/repos/${OWNER}/${REPO}/git/commits/${HEAD}`,
      treeUrl(),
    ];
    for (const url of urls) {
      await transport({ method: "GET", url });
      await transport({ method: "GET", url });
    }
    expect(remote.statuses).toEqual([200, 304, 200, 304, 200, 304]);
  });
});

describe("a changed repository is handled exactly as without the conditional request @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  it("C4 a moved head answers 200 with the new body, and the new ETag is remembered", async () => {
    const remote = conditionalRemote();
    const cache = makeCache(memoryStore());
    const transport = withConditionalRequests(remote, cache);

    await transport({ method: "GET", url: refUrl() });
    const moved = { object: { sha: "c".repeat(40) } };
    remote.setEtag('"v2"', moved);

    const second = await transport({ method: "GET", url: refUrl() });
    expect(second.json).toEqual(moved);
    expect(remote.statuses).toEqual([200, 200]);

    // The third read validates against the NEW ETag, not the stale one.
    const third = await transport({ method: "GET", url: refUrl() });
    expect(remote.seen[2].headers?.["If-None-Match"]).toBe('"v2"');
    expect(remote.statuses).toEqual([200, 200, 304]);
    expect(third.json).toEqual(moved);
  });
});

describe("a missing ETag never breaks the sync (fail-open) @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  it("C5 a server that issues no ETag is read unconditionally forever", async () => {
    const remote = conditionalRemote({ noEtag: true });
    const transport = withConditionalRequests(remote, makeCache(memoryStore()));
    await transport({ method: "GET", url: refUrl() });
    await transport({ method: "GET", url: refUrl() });
    expect(remote.conditional()).toHaveLength(0);
    expect(remote.statuses).toEqual([200, 200]);
  });

  it("C6 an unreadable store degrades to unconditional reads", async () => {
    const broken: ConditionalStoreIO = {
      async read() {
        throw new Error("EIO");
      },
      async writeAtomic() {
        throw new Error("EIO");
      },
    };
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(broken));
    const first = await transport({ method: "GET", url: refUrl() });
    const second = await transport({ method: "GET", url: refUrl() });
    expect(first.json).toEqual(second.json);
    expect(remote.conditional()).toHaveLength(0);
  });

  it("C7 a corrupt store file is treated as empty, not as an error", async () => {
    const io = memoryStore();
    await io.writeAtomic("{not json");
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(io));
    const resp = await transport({ method: "GET", url: refUrl() });
    expect(resp.status).toBe(200);
    expect(remote.conditional()).toHaveLength(0);
  });

  it("C8 a 304 whose body is no longer stored re-reads unconditionally instead of returning an empty success", async () => {
    const io = memoryStore();
    const cache = makeCache(io);
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, cache);
    await transport({ method: "GET", url: refUrl() });

    // Validator survives, body does not (a trimmed / partially-written store).
    const stored = JSON.parse(io.raw() ?? "{}") as {
      entries: Record<string, { etag: string; body: string }>;
    };
    stored.entries[refUrl()].body = "{not json";
    await io.writeAtomic(JSON.stringify(stored));

    const resp = await transport({ method: "GET", url: refUrl() });
    expect(resp.status).toBe(200);
    expect(resp.json).toEqual({ object: { sha: HEAD } });
    // The conditional attempt happened, then a plain re-read followed.
    expect(remote.statuses).toEqual([200, 304, 200]);
  });
});

describe("ETags do not leak between repositories @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  it("C9 a second repository is read unconditionally, with its own validator", async () => {
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(memoryStore()));
    await transport({ method: "GET", url: refUrl("exoas-public") });
    await transport({ method: "GET", url: refUrl("exoas-my") });
    expect(remote.conditional()).toHaveLength(0);
    expect(remote.statuses).toEqual([200, 200]);
  });

  it("C10 two SHAs of the same endpoint kind keep separate validators", async () => {
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(memoryStore()));
    await transport({ method: "GET", url: treeUrl("b".repeat(40)) });
    await transport({ method: "GET", url: treeUrl("d".repeat(40)) });
    expect(remote.conditional()).toHaveLength(0);
  });
});

describe("only Git Data reads are made conditional @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  it.each([
    [
      {
        method: "POST" as const,
        url: `${API}/repos/${OWNER}/${REPO}/git/trees`,
      },
      "write",
    ],
    [
      {
        method: "GET" as const,
        url: `${API}/repos/${OWNER}/${REPO}/contents/x.md`,
      },
      "not git data",
    ],
    [
      {
        method: "GET" as const,
        url: `${API}/repos/${OWNER}/${REPO}/git/blobs/${HEAD}`,
      },
      "blob",
    ],
    [{ method: "GET" as const, url: "not-a-url" }, "unparseable"],
  ])("C11 %#: %s is not conditional", (req, _why) => {
    expect(conditionalCacheKey(req as RestCommitRequest)).toBeNull();
  });

  it("C12 positive control — a refs read IS conditional, keyed by full URL", () => {
    expect(conditionalCacheKey({ method: "GET", url: refUrl() })).toBe(
      refUrl(),
    );
  });

  it("C13 a write is passed through untouched", async () => {
    const remote = conditionalRemote();
    const transport = withConditionalRequests(remote, makeCache(memoryStore()));
    const url = `${API}/repos/${OWNER}/${REPO}/git/trees`;
    await transport({ method: "POST", url, body: "{}" });
    await transport({ method: "POST", url, body: "{}" });
    expect(remote.conditional()).toHaveLength(0);
    expect(remote.statuses).toEqual([200, 200]);
  });
});

describe("the ETag store is bounded @req:af002ec4-ec4e-4482-b7b5-77e79dd332df", () => {
  it("C14 drops the least-recently-used validator past the ceiling", async () => {
    const io = memoryStore();
    const cache = makeCache(io, { maxEntries: 2 });
    await cache.remember("k1", '"e1"', { a: 1 });
    await cache.remember("k2", '"e2"', { a: 2 });
    await cache.touch("k1"); // k2 becomes least-recently-used
    await cache.remember("k3", '"e3"', { a: 3 });

    expect(await cache.etagFor("k1")).toBe('"e1"');
    expect(await cache.etagFor("k3")).toBe('"e3"');
    expect(await cache.etagFor("k2")).toBeNull();
  });

  it("C15 an oversized body is not remembered (the read stays unconditional)", async () => {
    const io = memoryStore();
    const cache = new ConditionalRequestCache({ io, maxBodyBytes: 10 });
    await cache.remember("k", '"e"', { big: "x".repeat(100) });
    expect(await cache.etagFor("k")).toBeNull();
  });
});
