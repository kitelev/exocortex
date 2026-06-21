/**
 * ExoSync durable per-device watermark store (RFC 4e4dc453 D8/D22, A3).
 *
 * One JSON file holds every repo's {@link WatermarkRecord}, keyed by
 * `repoKey` — the `data.local.json` pattern: the file carries the `.local.`
 * infix (convention: `exosync-watermarks.local.json`), which Obsidian Sync
 * excludes by convention AND `isSyncablePath` refuses symmetrically
 * (gitignore allowlist — the watermark must never be committed).
 *
 * Platform-free: file access goes through the injected
 * {@link WatermarkFileIO}; the adapter is trivial on both platforms
 * (plugin: `app.vault.adapter`; CLI: `node:fs` + temp+rename).
 *
 * Corruption tolerance (R10): a missing or unparseable file yields
 * `get() === null` for every repo — the engine then takes the
 * first-sync/full-conflict path (D22), never a silent overwrite. The store
 * itself never throws on read.
 *
 * Writes are serialized through an internal promise chain (lossless RMW —
 * concurrent `set` calls for different repos cannot clobber each other)
 * and MUST be atomic at the IO layer (temp file + rename) so a crash
 * mid-write cannot leave a torn store — torn watermark = wrong 3-way base.
 */

import type { WatermarkRecord, WatermarkStorePort } from "./syncTypes";

/** Single-file IO port. `writeAtomic` MUST be temp-file + rename. */
export interface WatermarkFileIO {
  /** File content, or null when the file does not exist. */
  read(): Promise<string | null>;
  writeAtomic(content: string): Promise<void>;
}

/** Recommended store filename — `.local.` infix is Sync-excluded. */
export const WATERMARK_STORE_FILENAME = "exosync-watermarks.local.json";

interface StoreShape {
  version: 1;
  repos: Record<string, WatermarkRecord>;
}

function isWatermarkRecord(v: unknown): v is WatermarkRecord {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.lastSyncedSha === "string" &&
    typeof r.rootTreeSha === "string" &&
    Array.isArray(r.files)
  );
}

export class FileWatermarkStore implements WatermarkStorePort {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly io: WatermarkFileIO) {}

  async get(repoKey: string): Promise<WatermarkRecord | null> {
    const repos = await this.readRepos();
    const record = repos[repoKey];
    return isWatermarkRecord(record) ? record : null;
  }

  async set(repoKey: string, record: WatermarkRecord): Promise<void> {
    const task = this.writeChain.then(async () => {
      const repos = await this.readRepos();
      repos[repoKey] = record;
      const store: StoreShape = { version: 1, repos };
      await this.io.writeAtomic(JSON.stringify(store, null, 2));
    });
    // Keep the chain alive even when a write fails — the NEXT set must
    // still run; the failure propagates to THIS caller only.
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Tolerant read: absent/corrupt file → empty store (R10, never throws). */
  private async readRepos(): Promise<Record<string, WatermarkRecord>> {
    try {
      const raw = await this.io.read();
      if (raw === null) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      const repos = (parsed as { repos?: unknown }).repos;
      if (repos === null || typeof repos !== "object") return {};
      return { ...(repos as Record<string, WatermarkRecord>) };
    } catch {
      return {};
    }
  }
}
