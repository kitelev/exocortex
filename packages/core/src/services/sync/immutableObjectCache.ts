/**
 * Content-addressed local cache for IMMUTABLE GitHub git objects (req
 * `086df113-16bb-4912-bb09-3a13ee187043`, issue #4410).
 *
 * `GET git/commits/{sha}`, `GET git/trees/{sha}`, `GET git/blobs/{sha}` are
 * content-addressed: for a given SHA the answer can never change. They
 * therefore need no ETag/revalidation — a cached response is valid forever,
 * and a hit costs **no network request at all** (unlike a `304`, which still
 * spends a secondary-limit point and a round trip).
 *
 * Measured motivation (2026-09-26, counting proxy — not an estimate): an idle
 * `exosync-parity` over 21 repositories issues exactly 83 requests
 * (41 `refs` + 21 `commits` + 21 `trees`); with an unmoved head **42 of 83
 * (51 %)** are the commits+trees served from here. Across vaults, 35 of 81
 * mounts are duplicates — `exoas-public` (751 files) is pulled three times per
 * three-vault sync; the cache key is per-(owner, repo, type, sha), so the 2nd
 * and 3rd vault reuse the 1st vault's objects on the same device.
 *
 * ⛔ `git/refs/**` is deliberately NOT cached: a ref is MUTABLE, and a cached
 * head would make the engine diff against a stale remote. Conditional requests
 * (`If-None-Match`) are the mechanism for that class — a separate requirement
 * (#3975). The two complement each other and do not overlap.
 *
 * ## Failure policy — fail-OPEN on absence, fail-LOUD on corruption
 *
 * | situation | behaviour |
 * |---|---|
 * | entry missing / IO read throws | fall through to the network (fail-open) |
 * | write / eviction throws | ignored — the response is already correct |
 * | entry present but **fails its integrity check** | **throws** (fail-loud) |
 *
 * The last row is the point of a content-addressed store: a cache file whose
 * content no longer hashes to the SHA it is filed under is corruption, and
 * applying it would write wrong bytes into the vault. The corrupt entry is
 * deliberately NOT auto-removed — silently healing it would turn a disk-level
 * fault into an invisible one, and the next run must reproduce the failure.
 *
 * Integrity is checked against the MECHANISM, not against a checksum we
 * invent: for blobs the git object SHA is recomputed from the decoded bytes
 * (`sha1("blob <len>\0" + content)`); for commits and trees the response's own
 * `sha` field must equal the SHA the entry is filed under.
 */

import type {
  RestCommitResponse,
  RestCommitTransport,
} from "../../infrastructure/github/restCommit";
import { base64ToBytes } from "../../utilities/base64";
import { gitBlobSha } from "./gitBlobSha";
import type { Sha1Fn } from "./syncTypes";

/** The three content-addressed Git Data endpoints. `refs` is NOT one of them. */
export type ImmutableObjectType = "commits" | "trees" | "blobs";

/** A parsed, cacheable `GET git/<type>/<sha>` request. */
export interface ImmutableObjectRef {
  owner: string;
  repo: string;
  type: ImmutableObjectType;
  sha: string;
  /**
   * Normalised query string (`recursive=1`), empty when there is none. Two
   * representations of the SAME tree (`?recursive=1` vs plain) are different
   * PAYLOADS, so they must not share a cache entry.
   */
  variant: string;
  /** Storage key — `<owner>/<repo>/<type>/<sha>[~<variant>]`. */
  key: string;
}

/** One stored entry as the IO layer sees it (for LRU accounting). */
export interface ObjectCacheEntry {
  key: string;
  /** Stored payload size in bytes. */
  size: number;
  /** Last-use timestamp (epoch ms). Drives LRU eviction. */
  lastUsedMs: number;
}

/**
 * Storage port — platform-free, mirroring the `WatermarkFileIO` contract.
 * Node adapter: one file per key under a device-wide cache dir; plugin
 * adapter: `vault.adapter` under the plugin's local (Sync-excluded) dir.
 *
 * Every method MAY throw; the cache treats a throw as "not available" and
 * falls through to the network (see the failure-policy table above).
 */
export interface ObjectCacheIO {
  /** Stored payload, or null when the key is absent. */
  read(key: string): Promise<string | null>;
  write(key: string, content: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every stored entry, for LRU eviction. */
  list(): Promise<ObjectCacheEntry[]>;
  /** Refresh an entry's `lastUsedMs` after a hit. Best-effort. */
  markUsed(key: string): Promise<void>;
}

/** Hit/miss counters — surfaced so a sync run can report what it saved. */
export interface ObjectCacheStats {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
}

export interface ImmutableObjectCacheOptions {
  io: ObjectCacheIO;
  /** Same injected SHA-1 the engine uses — blobs are verified with it. */
  sha1: Sha1Fn;
  /** Eviction ceiling for the whole store. Default 256 MiB. */
  maxBytes?: number;
  /**
   * Bytes written between LRU sweeps. Sweeping on every store would call
   * `list()` per object; the default amortises it to ~8 sweeps per full store.
   * `0` sweeps after every write (used by tests to make eviction deterministic).
   */
  sweepIntervalBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Path segments are used verbatim by the Node adapter, so anything outside
 * this set is refused rather than sanitised — a silently rewritten key would
 * collide two different repositories into one entry.
 */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
/** Git SHA-1 (40) or SHA-256 (64) — lowercase hex, nothing else. */
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** Conservative allowlist for the normalised query suffix. */
const SAFE_VARIANT_RE = /^[A-Za-z0-9=&_.-]*$/;

/**
 * Allow-list of cacheable endpoint kinds.
 *
 * ⛤ `refs` is excluded here AND excluded structurally: `git/refs/heads/main`
 * carries an extra path segment, so {@link parseImmutableObjectUrl} rejects it
 * before the type is even consulted. The mutant matrix makes that concrete —
 * adding `"refs"` to this set reds NOTHING, because the shape check already
 * covers it. Both guards stay: this one is the allow-list that decides which
 * NEW endpoint kinds may enter (e.g. `git/tags/{sha}`), the shape check is what
 * keeps ref-addressed reads out.
 */
const IMMUTABLE_TYPES: ReadonlySet<string> = new Set([
  "commits",
  "trees",
  "blobs",
]);

function normaliseVariant(search: string): string {
  if (search.length === 0) return "";
  const params = new URLSearchParams(search);
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
  pairs.sort();
  return pairs.join("&");
}

/**
 * Recognise a cacheable request, or return null (→ the transport passes it
 * through untouched).
 *
 * Refuses anything whose SHA segment is not hex of the right length — which is
 * also what keeps `GET git/trees/main` (a MUTABLE ref-addressed read, and a
 * legal call) out of the cache, and makes path traversal structurally
 * impossible rather than filtered.
 */
export function parseImmutableObjectUrl(
  url: string,
): ImmutableObjectRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  // Locate `repos` — the API base may carry a prefix (proxy, enterprise).
  const reposAt = segments.lastIndexOf("repos");
  if (reposAt < 0) return null;
  const [owner, repo, git, type, sha, ...rest] = segments.slice(reposAt + 1);
  if (rest.length > 0) return null;
  if (git !== "git") return null;
  if (
    owner === undefined ||
    repo === undefined ||
    type === undefined ||
    sha === undefined
  ) {
    return null;
  }
  if (!IMMUTABLE_TYPES.has(type)) return null;
  if (!SAFE_SEGMENT_RE.test(owner) || !SAFE_SEGMENT_RE.test(repo)) return null;
  if (!SHA_RE.test(sha)) return null;
  const variant = normaliseVariant(parsed.search.replace(/^\?/, ""));
  if (!SAFE_VARIANT_RE.test(variant)) return null;
  const key = `${owner}/${repo}/${type}/${sha}${variant ? `~${variant}` : ""}`;
  return {
    owner,
    repo,
    type: type as ImmutableObjectType,
    sha,
    variant,
    key,
  };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object"
    ? (v as Record<string, unknown>)
    : undefined;
}

function integrityError(ref: ImmutableObjectRef, detail: string): Error {
  return new Error(
    `ExoSync: cached git object ${ref.key} failed its integrity check (${detail}) — refusing to apply it. Delete the cache entry to re-fetch.`,
  );
}

/**
 * The store. Holds NO platform code: file layout, atomicity and `lastUsedMs`
 * live in the injected {@link ObjectCacheIO}; key derivation, integrity and
 * LRU policy live here, where they are testable.
 */
export class ImmutableObjectCache {
  private readonly io: ObjectCacheIO;
  private readonly sha1: Sha1Fn;
  private readonly maxBytes: number;
  private readonly sweepIntervalBytes: number;
  private writtenSinceSweep = 0;
  private readonly counters: ObjectCacheStats = {
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0,
  };

  constructor(opts: ImmutableObjectCacheOptions) {
    this.io = opts.io;
    this.sha1 = opts.sha1;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.sweepIntervalBytes =
      opts.sweepIntervalBytes ?? Math.max(1, Math.floor(this.maxBytes / 8));
  }

  stats(): ObjectCacheStats {
    return { ...this.counters };
  }

  /**
   * A stored response, or null on a miss. THROWS when a stored entry fails its
   * integrity check — that is the one case the caller must not paper over.
   */
  async get(ref: ImmutableObjectRef): Promise<RestCommitResponse | null> {
    let raw: string | null;
    try {
      raw = await this.io.read(ref.key);
    } catch {
      // Unreadable store → behave exactly as if the object were absent.
      this.counters.misses += 1;
      return null;
    }
    if (raw === null) {
      this.counters.misses += 1;
      return null;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw integrityError(ref, "stored payload is not valid JSON");
    }
    await this.assertIntegrity(ref, json);
    this.counters.hits += 1;
    void this.io.markUsed(ref.key).catch(() => undefined);
    return { status: 200, json, text: raw };
  }

  /** Store a fresh response. Never throws — a failed store only costs a miss. */
  async put(ref: ImmutableObjectRef, resp: RestCommitResponse): Promise<void> {
    if (resp.json === undefined) return;
    let payload: string;
    try {
      payload = JSON.stringify(resp.json);
    } catch {
      return;
    }
    // Never store something we would immediately refuse to read back.
    try {
      await this.assertIntegrity(ref, resp.json);
    } catch {
      return;
    }
    try {
      await this.io.write(ref.key, payload);
    } catch {
      return;
    }
    this.counters.stores += 1;
    this.writtenSinceSweep += payload.length;
    if (this.writtenSinceSweep >= this.sweepIntervalBytes) {
      this.writtenSinceSweep = 0;
      await this.evict().catch(() => undefined);
    }
  }

  /**
   * Drop least-recently-used entries until the store fits `maxBytes`.
   * Returns the number of entries removed.
   */
  async evict(): Promise<number> {
    const entries = await this.io.list();
    let total = 0;
    for (const e of entries) total += e.size;
    if (total <= this.maxBytes) return 0;
    const ordered = [...entries].sort((a, b) => a.lastUsedMs - b.lastUsedMs);
    let removed = 0;
    for (const entry of ordered) {
      if (total <= this.maxBytes) break;
      try {
        await this.io.remove(entry.key);
      } catch {
        continue;
      }
      total -= entry.size;
      removed += 1;
      this.counters.evictions += 1;
    }
    return removed;
  }

  /**
   * Content-addressing verified against the mechanism that produced the SHA.
   *
   * Blobs are checked HARD: the git object SHA is recomputed from the decoded
   * bytes, so a tampered `content` is caught even when the response's own
   * `sha` field was edited to match. Commits and trees carry no locally
   * recomputable digest (their git serialisation is not part of the REST
   * payload), so their check is the response's own `sha`.
   */
  private async assertIntegrity(
    ref: ImmutableObjectRef,
    json: unknown,
  ): Promise<void> {
    const rec = asRecord(json);
    if (rec === undefined) {
      throw integrityError(ref, "stored payload is not an object");
    }
    if (ref.type !== "blobs") {
      // Commits and trees carry no locally recomputable digest, so the
      // response's own `sha` is the only available check.
      const declared = rec.sha;
      if (typeof declared !== "string" || declared !== ref.sha) {
        throw integrityError(
          ref,
          `response sha ${String(declared)} does not match the requested sha`,
        );
      }
      return;
    }
    // Blobs are checked against the CONTENT, not against the server's claim —
    // strictly stronger, and it does not depend on `sha` being present in the
    // payload at all.
    const content = rec.content;
    const encoding = rec.encoding;
    if (typeof content !== "string") {
      throw integrityError(ref, "blob payload has no content");
    }
    let bytes: Uint8Array;
    try {
      bytes =
        encoding === "utf-8"
          ? new TextEncoder().encode(content)
          : base64ToBytes(content);
    } catch {
      throw integrityError(ref, "blob content is not decodable");
    }
    const recomputed = await gitBlobSha(bytes, this.sha1);
    if (recomputed !== ref.sha) {
      throw integrityError(
        ref,
        `recomputed blob sha ${recomputed} does not match the requested sha`,
      );
    }
  }
}

/**
 * Wrap a transport so cacheable GETs are served from {@link ImmutableObjectCache}.
 *
 * Everything else — writes, `git/refs`, unrecognised URLs — passes through
 * byte-for-byte, so wrapping is behaviour-neutral for every non-cacheable call.
 */
export function withImmutableObjectCache(
  inner: RestCommitTransport,
  cache: ImmutableObjectCache,
): RestCommitTransport {
  return async (req) => {
    // Double cover with the URL shape check below: no production write targets
    // a `git/<type>/<sha>` URL, so in practice the parser already refuses them.
    // The guard is kept because it states the invariant directly — a cache is a
    // READ optimisation — and it is what an axis can pin (a POST at a
    // cacheable-looking URL must still go out).
    if (req.method !== "GET") return inner(req);
    const ref = parseImmutableObjectUrl(req.url);
    if (ref === null) return inner(req);
    const hit = await cache.get(ref);
    if (hit !== null) return hit;
    const resp = await inner(req);
    await cache.put(ref, resp);
    return resp;
  };
}
