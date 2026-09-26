/**
 * Conditional GitHub reads via `If-None-Match` / `ETag` (req
 * `af002ec4-ec4e-4482-b7b5-77e79dd332df`, issue #3975).
 *
 * A read that repeats an unchanged resource answers **304 Not Modified**, and
 * GitHub does **not** charge the primary rate limit for it. ExoSync's idle
 * traffic is exactly that shape: an idle `exosync-parity` over 21
 * repositories issues 83 requests and **all 83** are `git/refs` +
 * `git/commits` + `git/trees` — the reads that must answer 304 when nothing
 * moved.
 *
 * Proved by execution before the code existed (2026-09-26, live headers):
 *
 * ```
 * 25 requests WITH If-None-Match  → {304: 25} → x-ratelimit-used +7  (background)
 * 25 requests WITHOUT it          → {200: 25} → x-ratelimit-used +24
 * ```
 *
 * The control shows the instrument CAN go red, and the conditional series is
 * indistinguishable from background noise. ETag is returned on all three
 * endpoint classes, each verified separately.
 *
 * ## Relationship to the immutable-object cache (#4410)
 *
 * They complement each other and do NOT overlap:
 *
 * | | mutable `git/refs` | immutable `commits`/`trees`/`blobs` |
 * |---|---|---|
 * | conditional request | **the** mechanism — the request still goes out, but a 304 is free | a hit means the SHA moved, so a 304 is unlikely |
 * | content cache by SHA | impossible — a ref's answer changes | removes the request entirely |
 *
 * ## Failure policy — fail-OPEN everywhere
 *
 * Unlike the content cache, nothing here is load-bearing for correctness: a
 * missing ETag, an unreadable store, a 304 whose body was evicted — every one
 * of them degrades to an ordinary unconditional request. The ONLY hard
 * requirement is that a 304 must never be handed to a caller as an empty
 * success, which is why a 304 without a stored body re-issues the read
 * unconditionally instead of returning `{}`.
 */

import type {
  RestCommitRequest,
  RestCommitResponse,
  RestCommitTransport,
} from "../../infrastructure/github/restCommit";

/** One remembered response: the validator plus the body it validates. */
export interface ConditionalEntry {
  /** The `ETag` header verbatim, including quotes and any `W/` prefix. */
  etag: string;
  /** `JSON.stringify` of the response body the ETag was issued for. */
  body: string;
  /** Epoch ms of the last use — drives the entry-count bound. */
  lastUsedMs: number;
}

/**
 * Storage port — platform-free, same shape as the other ExoSync stores. A
 * single serialised map is enough: the population is one entry per endpoint
 * per repo (41 refs + 21 commits + 21 trees for a 21-repo device), and every
 * body here is small.
 */
export interface ConditionalStoreIO {
  read(): Promise<string | null>;
  writeAtomic(content: string): Promise<void>;
}

export interface ConditionalRequestCacheOptions {
  io: ConditionalStoreIO;
  /** Entry ceiling; the least-recently-used entries are dropped past it. */
  maxEntries?: number;
  /** Bodies larger than this are validated but not remembered. Default 1 MiB. */
  maxBodyBytes?: number;
  /** Injected clock (tests). */
  now?: () => number;
}

export interface ConditionalRequestStats {
  /** Requests that carried `If-None-Match`. */
  conditional: number;
  /** Answers that came back 304 — i.e. primary quota not spent. */
  notModified: number;
  /** Fresh 200 answers whose ETag was remembered. */
  stored: number;
}

/**
 * Store filename, next to the watermark in the vault's device-local plugin
 * dir. The `.local.` infix is the Sync-exclusion convention — an ETag is
 * per-device state and must never be committed or replicated.
 *
 * ⛤ Per-VAULT rather than device-wide on purpose: a validator is cheap to
 * re-earn (one unconditional 200), so sharing it across vaults buys little,
 * while a shared file would put every vault's sync behind one write chain.
 */
export const CONDITIONAL_STORE_FILENAME = "exosync-etags.local.json";

const DEFAULT_MAX_ENTRIES = 4000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

interface StoreShape {
  version: 1;
  entries: Record<string, ConditionalEntry>;
}

function isEntry(v: unknown): v is ConditionalEntry {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.etag === "string" && typeof r.body === "string";
}

/**
 * Which GET reads are worth validating conditionally.
 *
 * Deliberately the Git Data READ surface and nothing else: those are the calls
 * an idle run repeats verbatim. A write is never conditional, and a URL we do
 * not recognise is passed through untouched rather than guessed at.
 */
export function conditionalCacheKey(req: RestCommitRequest): string | null {
  if (req.method !== "GET") return null;
  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  const reposAt = segments.lastIndexOf("repos");
  if (reposAt < 0) return null;
  const rest = segments.slice(reposAt + 1);
  // <owner>/<repo>/git/<kind>/...
  if (rest.length < 4 || rest[2] !== "git") return null;
  const kind = rest[3];
  if (kind !== "refs" && kind !== "commits" && kind !== "trees") return null;
  // The FULL url is the key: an ETag is issued by a specific origin for a
  // specific resource, so a different API base must not reuse it.
  return req.url;
}

/**
 * Remembers ETags and replays the bodies they validate.
 *
 * Holds no platform code: persistence is the injected {@link ConditionalStoreIO};
 * the policy (what is conditional, what a 304 means, what is bounded) lives
 * here where it is testable.
 */
export class ConditionalRequestCache {
  private readonly io: ConditionalStoreIO;
  private readonly maxEntries: number;
  private readonly maxBodyBytes: number;
  private readonly now: () => number;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly counters: ConditionalRequestStats = {
    conditional: 0,
    notModified: 0,
    stored: 0,
  };

  constructor(opts: ConditionalRequestCacheOptions) {
    this.io = opts.io;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.now = opts.now ?? ((): number => Date.now());
  }

  stats(): ConditionalRequestStats {
    return { ...this.counters };
  }

  /** The stored validator for a key, or null. Never throws. */
  async etagFor(key: string): Promise<string | null> {
    const entries = await this.readEntries();
    const entry = entries[key];
    return isEntry(entry) ? entry.etag : null;
  }

  /** The body a 304 stands for, or null when it is no longer remembered. */
  async bodyFor(key: string): Promise<unknown | null> {
    const entries = await this.readEntries();
    const entry = entries[key];
    if (!isEntry(entry)) return null;
    try {
      return JSON.parse(entry.body) as unknown;
    } catch {
      return null;
    }
  }

  /** Remember a fresh answer. Never throws — a failed store costs one 200. */
  async remember(key: string, etag: string, json: unknown): Promise<void> {
    let body: string;
    try {
      body = JSON.stringify(json);
    } catch {
      return;
    }
    if (body.length > this.maxBodyBytes) return;
    const entry: ConditionalEntry = { etag, body, lastUsedMs: this.now() };
    await this.mutate((entries) => {
      entries[key] = entry;
      this.evictIfNeeded(entries);
    });
    this.counters.stored += 1;
  }

  /** Refresh an entry's last-use stamp after a 304. Never throws. */
  async touch(key: string): Promise<void> {
    const stamp = this.now();
    await this.mutate((entries) => {
      const entry = entries[key];
      if (isEntry(entry)) entry.lastUsedMs = stamp;
    });
  }

  countConditional(): void {
    this.counters.conditional += 1;
  }

  countNotModified(): void {
    this.counters.notModified += 1;
  }

  private evictIfNeeded(entries: Record<string, ConditionalEntry>): void {
    const keys = Object.keys(entries);
    if (keys.length <= this.maxEntries) return;
    keys
      .sort(
        (a, b) => (entries[a]?.lastUsedMs ?? 0) - (entries[b]?.lastUsedMs ?? 0),
      )
      .slice(0, keys.length - this.maxEntries)
      .forEach((k) => delete entries[k]);
  }

  /** Serialised read-modify-write, so concurrent stores cannot clobber. */
  private async mutate(
    fn: (entries: Record<string, ConditionalEntry>) => void,
  ): Promise<void> {
    const task = this.writeChain.then(async () => {
      const entries = await this.readEntries();
      fn(entries);
      const store: StoreShape = { version: 1, entries };
      try {
        await this.io.writeAtomic(JSON.stringify(store));
      } catch {
        // Fail-open: an unwritable store only means the next read is unconditional.
      }
    });
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Tolerant read: absent or corrupt store → no validators at all. */
  private async readEntries(): Promise<Record<string, ConditionalEntry>> {
    try {
      const raw = await this.io.read();
      if (raw === null) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      const entries = (parsed as StoreShape).entries;
      return entries !== null && typeof entries === "object" ? entries : {};
    } catch {
      return {};
    }
  }
}

/**
 * Wrap a transport so recognised Git Data reads carry `If-None-Match` and a
 * 304 is answered from the remembered body.
 *
 * Behaviour-neutral for everything else: writes, unrecognised URLs and reads
 * with no stored validator go through byte-for-byte.
 */
export function withConditionalRequests(
  inner: RestCommitTransport,
  cache: ConditionalRequestCache,
): RestCommitTransport {
  return async (req) => {
    const key = conditionalCacheKey(req);
    if (key === null) return inner(req);

    const etag = await cache.etagFor(key);
    if (etag === null) return storeFresh(inner, cache, req, key);

    cache.countConditional();
    const resp = await inner({
      ...req,
      headers: { ...(req.headers ?? {}), "If-None-Match": etag },
      acceptNotModified: true,
    });

    if (resp.status === 304) {
      const body = await cache.bodyFor(key);
      if (body !== null) {
        cache.countNotModified();
        await cache.touch(key).catch(() => undefined);
        return { status: 200, json: body };
      }
      // The validator outlived the body it validates (store trimmed between
      // the two reads). A 304 handed on as-is would look like an empty
      // success, so re-read unconditionally instead — one wasted request, no
      // wrong answer.
      return storeFresh(inner, cache, req, key);
    }

    await rememberFrom(cache, key, resp);
    return resp;
  };
}

async function storeFresh(
  inner: RestCommitTransport,
  cache: ConditionalRequestCache,
  req: RestCommitRequest,
  key: string,
): Promise<RestCommitResponse> {
  const resp = await inner(req);
  await rememberFrom(cache, key, resp);
  return resp;
}

/**
 * ⛔ AWAITED on purpose, not fire-and-forget. Two Git Data reads of the same
 * endpoint can follow each other with no intervening yield (a retry, a
 * second repo in the same loop, a test), and a pending write would leave the
 * SECOND read unconditional — the validator exists but nobody can see it yet.
 * The cost is one serialised small-file write per fresh 200.
 */
async function rememberFrom(
  cache: ConditionalRequestCache,
  key: string,
  resp: RestCommitResponse,
): Promise<void> {
  const etag = resp.headers?.("etag");
  if (typeof etag !== "string" || etag.length === 0) return;
  if (resp.json === undefined) return;
  await cache.remember(key, etag, resp.json).catch(() => undefined);
}
