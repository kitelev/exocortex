/**
 * ExoSync durable per-device LOCAL MANIFEST store (perf, ExoSync Phase 1).
 *
 * Sibling of {@link FileWatermarkStore}: one JSON file holds every repo's
 * {@link LocalManifestRecord}, keyed by `repoKey`. The file carries the
 * `.local.` infix (`exosync-localmanifest.local.json`) so Obsidian Sync
 * excludes it AND `isSyncablePath` refuses it symmetrically — the manifest is
 * a DEVICE-LOCAL cache (file mtimes are device-specific) and must never be
 * committed.
 *
 * Purpose: the mtime-manifest skips reading + re-hashing files whose
 * `(mtimeMs, size)` are unchanged since the last sync, reusing the stored
 * `blobSha`/`uid`. On a 14-AS / ~6304-file iPhone vault that turns a no-op
 * sync's dominant cost (read + SHA-1 of every file) into a cheap stat sweep.
 *
 * Corruption tolerance (matches the watermark store, R10): a missing or
 * unparseable file yields `get() === null` for every repo — the engine then
 * reads + hashes every file (status quo), NEVER a wrong skip. The store never
 * throws on read. Writes are serialised through a promise chain (lossless RMW
 * across repos) and MUST be atomic at the IO layer (temp + rename) so a crash
 * mid-write cannot leave a torn cache.
 *
 * Reuses {@link WatermarkFileIO} — the same trivial single-file IO contract
 * (read / atomic-write) both platforms already implement for the watermark.
 */

import type { LocalManifestRecord, LocalManifestStorePort } from "./syncTypes";
import type { WatermarkFileIO } from "./FileWatermarkStore";

/** Recommended store filename — `.local.` infix is Sync-excluded. */
export const LOCAL_MANIFEST_STORE_FILENAME = "exosync-localmanifest.local.json";

interface StoreShape {
  version: 1;
  repos: Record<string, LocalManifestRecord>;
}

function isLocalManifestRecord(v: unknown): v is LocalManifestRecord {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.lastFullRehashMs === "number" &&
    r.files !== null &&
    typeof r.files === "object"
  );
}

export class FileLocalManifestStore implements LocalManifestStorePort {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly io: WatermarkFileIO) {}

  async get(repoKey: string): Promise<LocalManifestRecord | null> {
    const repos = await this.readRepos();
    const record = repos[repoKey];
    return isLocalManifestRecord(record) ? record : null;
  }

  async set(repoKey: string, record: LocalManifestRecord): Promise<void> {
    const task = this.writeChain.then(async () => {
      const repos = await this.readRepos();
      repos[repoKey] = record;
      const store: StoreShape = { version: 1, repos };
      await this.io.writeAtomic(JSON.stringify(store));
    });
    // Keep the chain alive even when a write fails — the NEXT set must still
    // run; the failure propagates to THIS caller only.
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Tolerant read: absent/corrupt file → empty store (R10, never throws). */
  private async readRepos(): Promise<Record<string, LocalManifestRecord>> {
    try {
      const raw = await this.io.read();
      if (raw === null) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      const repos = (parsed as { repos?: unknown }).repos;
      if (repos === null || typeof repos !== "object") return {};
      return { ...(repos as Record<string, LocalManifestRecord>) };
    } catch {
      return {};
    }
  }
}
