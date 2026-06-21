/**
 * ExoSync device-local conflict cache (offline-resolution foundation).
 *
 * A {@link QuarantinePort} that persists the THREE versions of every
 * quarantined conflict — base / local / remote content (plus the losing-local
 * binary payload of a file-mode remote-wins resolution) — to a SINGLE
 * device-local JSON file. The `.local.` infix Sync-excludes it (the exact
 * convention the watermark store uses: Obsidian Sync skips it AND both
 * `isSyncablePath` / `isFileSpaceSyncablePath` refuse it), so the cache NEVER
 * leaves the device.
 *
 * Why it exists: today the engine HAS all three versions in memory at
 * quarantine time ({@link QuarantineEntry}) but, with no quarantine sink wired,
 * drops them — so the resolver must fetch the remote version over the network
 * to show or resolve a conflict (it cannot work offline). Capturing the three
 * versions here, on disk, is what lets the resolver list / diff / resolve a
 * conflict with ZERO network (PR-3): the remote version is already local.
 *
 * ⛤ Deliberately NOT redacted (unlike {@link SyncedQuarantineStore}). The
 * synced store redacts secrets because it COMMITS conflict copies to a remote
 * git repo — a leak vector. This cache is the OPPOSITE: it never syncs (the
 * `.local.` exclusion is the leak guard), and it MUST hold the EXACT bytes —
 * a redacted cache would make the offline resolver diff and PUSH corrupted
 * content (a redaction is not reversible). Leak mitigation here is "the file
 * never leaves the device", not "the content is scrubbed".
 *
 * Same store family as {@link FileWatermarkStore}: single file, atomic IO
 * through the injected {@link WatermarkFileIO}, tolerant read (a missing or
 * corrupt file reads as an empty cache — never throws), serialized writes
 * (a lossless read-modify-write chain so concurrent `quarantine` /
 * `markResolved` calls cannot clobber each other).
 */

import { bytesToBase64 } from "../../utilities/base64";
import type { WatermarkFileIO } from "./FileWatermarkStore";
import type { QuarantineEntry, QuarantinePort } from "./syncTypes";

/** Recommended store filename — `.local.` infix is Sync-excluded. */
export const CONFLICT_CACHE_STORE_FILENAME = "exosync-conflicts.local.json";

/** Persisted shape of one cached conflict (the 3 versions at quarantine time). */
export interface ConflictCacheRecord {
  version: 1;
  repoKey: string;
  /** Repo-relative forward-slash path. */
  path: string;
  uid?: string;
  reason: string;
  /** ISO timestamp of the FIRST time this (repoKey,path) was quarantined. */
  quarantinedAt: string;
  /** 3-way base content; absent ⇒ did not exist at the base (or unavailable). */
  baseContent?: string;
  /** Local content captured at quarantine time; absent ⇒ deleted locally. */
  localContent?: string;
  /** Remote (head-tree) content captured at quarantine time; absent ⇒ deleted remotely. */
  remoteContent?: string;
  /**
   * Base64 of the losing-LOCAL binary bytes of a file-mode remote-wins
   * resolution (D18) — the only durable copy of those bytes once the synced
   * quarantine repo is gone. Asset-mode entries never carry this.
   */
  localContentBytesBase64?: string;
}

interface StoreShape {
  version: 1;
  /** Keyed by `repoKey\0path`. */
  entries: Record<string, ConflictCacheRecord>;
}

/** Stable cache key for one conflict — repoKey + path (NUL-separated). */
function cacheKey(repoKey: string, path: string): string {
  return `${repoKey}\0${path}`;
}

function isRecord(v: unknown): v is ConflictCacheRecord {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.repoKey === "string" &&
    typeof r.path === "string" &&
    typeof r.reason === "string" &&
    typeof r.quarantinedAt === "string"
  );
}

export interface LocalConflictCacheStoreDeps {
  io: WatermarkFileIO;
  /** Injected clock (ISO string) — deterministic tests. */
  now?: () => string;
}

export class LocalConflictCacheStore implements QuarantinePort {
  private readonly io: WatermarkFileIO;
  private readonly now: () => string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(deps: LocalConflictCacheStoreDeps) {
    this.io = deps.io;
    this.now = deps.now ?? ((): string => new Date().toISOString());
  }

  async quarantine(entry: QuarantineEntry): Promise<void> {
    await this.quarantineAll([entry]);
  }

  /**
   * Cache MANY entries in one read-modify-write. A re-quarantine of an entry
   * that is already cached PRESERVES its original `quarantinedAt` (the conflict
   * has been open since then) while refreshing the captured content — the
   * disk/remote may have moved since the first capture, and the cache must
   * mirror the version the engine just observed.
   */
  async quarantineAll(entries: QuarantineEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.mutate((store) => {
      for (const entry of entries) {
        const key = cacheKey(entry.repoKey, entry.path);
        const prior = store.entries[key];
        const quarantinedAt =
          prior !== undefined && isRecord(prior)
            ? prior.quarantinedAt
            : this.now();
        store.entries[key] = {
          version: 1,
          repoKey: entry.repoKey,
          path: entry.path,
          ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
          reason: entry.reason,
          quarantinedAt,
          ...(entry.baseContent !== undefined
            ? { baseContent: entry.baseContent }
            : {}),
          ...(entry.localContent !== undefined
            ? { localContent: entry.localContent }
            : {}),
          ...(entry.remoteContent !== undefined
            ? { remoteContent: entry.remoteContent }
            : {}),
          ...(entry.localContentBytes !== undefined
            ? {
                localContentBytesBase64: bytesToBase64(entry.localContentBytes),
              }
            : {}),
        };
      }
    });
  }

  /**
   * Drop a cached entry — called by the engine when a pinned path clears
   * convergently (auto-resolve) and by the resolver after it resolves a
   * conflict. A no-op when the entry is absent (port contract).
   */
  async markResolved(repoKey: string, path: string): Promise<void> {
    const key = cacheKey(repoKey, path);
    await this.mutate((store) => {
      delete store.entries[key];
    });
  }

  /** Every cached conflict (across all repos). Tolerant — never throws. */
  async list(): Promise<ConflictCacheRecord[]> {
    const store = await this.read();
    return Object.values(store.entries).filter(isRecord);
  }

  /** One cached conflict, or null when not cached. Tolerant — never throws. */
  async get(
    repoKey: string,
    path: string,
  ): Promise<ConflictCacheRecord | null> {
    const store = await this.read();
    const record = store.entries[cacheKey(repoKey, path)];
    return record !== undefined && isRecord(record) ? record : null;
  }

  /** Serialized read-modify-write (lossless RMW, atomic IO). */
  private async mutate(fn: (store: StoreShape) => void): Promise<void> {
    const task = this.writeChain.then(async () => {
      const store = await this.read();
      fn(store);
      await this.io.writeAtomic(JSON.stringify(store, null, 2));
    });
    // Keep the chain alive even when a write fails — the NEXT mutate must still
    // run; the failure propagates to THIS caller only.
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Tolerant read: absent/corrupt file → empty store (never throws). */
  private async read(): Promise<StoreShape> {
    try {
      const raw = await this.io.read();
      if (raw === null) return { version: 1, entries: {} };
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") {
        return { version: 1, entries: {} };
      }
      const entries = (parsed as { entries?: unknown }).entries;
      if (entries === null || typeof entries !== "object") {
        return { version: 1, entries: {} };
      }
      return {
        version: 1,
        entries: { ...(entries as Record<string, ConflictCacheRecord>) },
      };
    } catch {
      return { version: 1, entries: {} };
    }
  }
}
