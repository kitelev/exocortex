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
 * single serialised map, read ONCE per cache instance and kept in memory
 * (req `0700c0e0-3dfb-4d45-bcaa-d93792b73905`).
 *
 * ⛔ The original note here said «every body here is small». Measured
 * 2026-10-06 it was not: a bot vault's store had grown to 181 MB, 173.6 MB of
 * it recursive `git/trees` bodies (166 of them > 512 KB), because every tree
 * the object cache missed was ALSO remembered here. Re-reading and re-writing
 * that file on every request cost ~2 s of client work per REST call. Hence the
 * byte cap below and the single read.
 */
export interface ConditionalStoreIO {
  read(): Promise<string | null>;
  writeAtomic(content: string): Promise<void>;
}

export interface ConditionalRequestCacheOptions {
  io: ConditionalStoreIO;
  /** Entry ceiling; the least-recently-used entries are dropped past it. */
  maxEntries?: number;
  /**
   * Bodies larger than this are validated but not remembered, and entries
   * above it found in a loaded store are dropped. Measured as the length of
   * the serialised body in UTF-16 code units (`string.length`), not bytes on
   * disk: a body with non-ASCII text (Cyrillic paths in a tree, a commit
   * message) takes more bytes than this length — two per Cyrillic character
   * in UTF-8. Default 64 Ki.
   */
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
/**
 * ⛤ 64 KiB keeps every `git/refs` and `git/commits` answer (measured maxima
 * over four device stores 2026-10-06: refs 368 B, commits 3.6 KB) and drops
 * large recursive trees (up to 1 MB each). Those are
 * immutable by SHA and already held by the object cache, which sits OUTSIDE
 * this layer and answers them before a conditional request is built — so a
 * stored tree body is only ever replayed when the object cache is switched
 * off. Measured on the 181 MB store: entries ≤ 64 KiB total 1.0 MB.
 */
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

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
  /**
   * The store, loaded ONCE per instance (req 0700c0e0). One instance lives for
   * one CLI run, so this is the run's working copy: every lookup and mutation
   * touches memory, and the disk is only written behind it.
   */
  private loaded: Promise<Record<string, ConditionalEntry>> | null = null;
  /** A persist is pending or running; further mutations just mark it dirty. */
  private draining = false;
  private dirty = false;
  private drained: Promise<void> = Promise.resolve();
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
    const entries = await this.load();
    const entry = entries[key];
    return isEntry(entry) ? entry.etag : null;
  }

  /** The body a 304 stands for, or null when it is no longer remembered. */
  async bodyFor(key: string): Promise<unknown | null> {
    const entries = await this.load();
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

  /**
   * Resolves once every mutation whose promise has RESOLVED is on disk (or its
   * write failed — the store is fail-open). A mutation still waiting on the
   * initial load is not covered; through the transport there is none, since it
   * awaits `remember` / `touch`. The run's own lookups never need it — they are
   * served from memory; the CLI settles every wired cache before a command
   * returns or exits (`withSettledConditionalStores`), axis R7.
   */
  async flush(): Promise<void> {
    while (this.draining) {
      await this.drained;
    }
  }

  /**
   * The run's working copy, read from disk at most once (req 0700c0e0).
   *
   * Entries whose body is above the byte cap are dropped here, so a store that
   * grew under the old 1 MiB cap shrinks on its next write instead of being
   * re-read and re-written in full forever.
   */
  private load(): Promise<Record<string, ConditionalEntry>> {
    if (this.loaded === null) {
      this.loaded = this.readEntries().then((entries) => {
        for (const key of Object.keys(entries)) {
          const entry = entries[key];
          if (isEntry(entry) && entry.body.length > this.maxBodyBytes) {
            delete entries[key];
          }
        }
        return entries;
      });
    }
    return this.loaded;
  }

  /**
   * Mutate the working copy, then persist it BEHIND the caller.
   *
   * ⛔ Before req 0700c0e0 this re-read the whole store, applied `fn` and
   * rewrote it — for every 304 (`touch`) and every fresh 200 (`remember`).
   * The mutation is now synchronous on memory, so the next lookup in this run
   * sees it at once; the disk write is coalesced: while one write is running,
   * further mutations only mark the copy dirty, and the running drain writes
   * the latest state once more. The process stays alive until the pending
   * write settles (the CLI ends via `process.exitCode`, not `process.exit`).
   */
  private async mutate(
    fn: (entries: Record<string, ConditionalEntry>) => void,
  ): Promise<void> {
    const entries = await this.load();
    fn(entries);
    this.dirty = true;
    if (!this.draining) {
      this.draining = true;
      this.drained = this.drain(entries);
    }
  }

  private async drain(entries: Record<string, ConditionalEntry>): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        const store: StoreShape = { version: 1, entries };
        try {
          await this.io.writeAtomic(JSON.stringify(store));
        } catch {
          // Fail-open: an unwritable store only means the next RUN starts
          // without validators; this run keeps them in memory.
          // ⛔ LOAD-BEARING: the drain's promise is detached from every caller
          // (a mutation does not await it), so an error escaping here is an
          // unhandled rejection — a process crash, not a degraded cache.
        }
      }
    } finally {
      // Same synchronous segment as the last `dirty` check — a mutation can
      // never land between "nothing left to write" and "not draining".
      this.draining = false;
    }
  }

  /** Tolerant read: absent or corrupt store → no validators at all. */
  private async readEntries(): Promise<Record<string, ConditionalEntry>> {
    try {
      const raw = await this.io.read();
      if (raw === null) return {};
      const parsed = JSON.parse(raw) as unknown;
      // ⛤ DEFENSIVE, замерено: снятие `typeof parsed !== "object"` не
      // меняет исход НИ НА ОДНОМ входе — у примитива `.entries` даёт
      // `undefined`, и строка ниже всё равно возвращает `{}`. Мутанта на
      // него нет намеренно: различающего входа не существует, поэтому
      // ось была бы вакуумной. Проверяемое решение — `catch` ниже
      // (мутант M10_corrupt_store_is_fatal), оно и запирает терпимое чтение.
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
        // req e5e45283 — carry the REAL response's headers through. The body is
        // served from the store, but the round-trip did happen, and its
        // `x-ratelimit-*` are the freshest quota reading available. Dropping
        // them made the quota invisible on exactly the path this cache makes
        // dominant: on a second idle sync every request 304s, so the run would
        // report `quota n/a` while having spent N real round-trips.
        return {
          status: 200,
          json: body,
          ...(resp.headers === undefined ? {} : { headers: resp.headers }),
        };
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
 * Awaited, but since req 0700c0e0 this awaits only the in-memory update: the
 * disk write runs behind it (see `ConditionalRequestCache.mutate`).
 *
 * ⛔ The previous note justified the await by «a pending write would leave the
 * SECOND read unconditional». That was true while every lookup re-read the
 * file; with the working copy in memory a validator is visible to the next
 * read of the same endpoint the moment `remember` updates it, write pending or
 * not (axis R2 pins that with a write that never finishes). The await is kept
 * but no longer load-bearing: dropping it (mutant M3) changes no axis, because
 * the update is queued ahead of the next lookup's own wait on the same loaded
 * store — M3 is therefore a declared zero in `conditionalRequestCache.spec.json`.
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
