/**
 * ExoSync durable per-device mount-base store (#3590).
 *
 * One JSON file holds, per `repoKey`, the commit SHA the AssetSpace was MOUNTED
 * at — the true 3-way merge base for the FIRST sync (see
 * {@link MountBaseStorePort}). Same `data.local.json` discipline as the
 * watermark store: the `.local.` infix (`exosync-mountbase.local.json`) is
 * Sync-excluded by Obsidian convention AND refused by `isSyncablePath`, so the
 * device-specific base never leaks into a commit.
 *
 * Platform-free: file access goes through the same injected
 * {@link WatermarkFileIO} both platforms already build for the watermark store
 * (plugin: `app.vault.adapter`; CLI: `node:fs` temp+rename). Corruption-tolerant
 * (R10): a missing/unparseable file yields `get() === null`, so the engine takes
 * the conservative full-conflict path — never a silent overwrite. Writes are
 * serialized through an internal promise chain (lossless RMW) and MUST be atomic
 * at the IO layer.
 */

import type { MountBaseStorePort } from "./syncTypes";
import type { WatermarkFileIO } from "./FileWatermarkStore";

/** Recommended store filename — `.local.` infix is Sync-excluded. */
export const MOUNT_BASE_STORE_FILENAME = "exosync-mountbase.local.json";

interface MountBaseStoreShape {
  version: 1;
  /** repoKey → mounted commit SHA. */
  repos: Record<string, string>;
}

export class FileMountBaseStore implements MountBaseStorePort {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly io: WatermarkFileIO) {}

  async get(repoKey: string): Promise<string | null> {
    const repos = await this.readRepos();
    const sha = repos[repoKey];
    return typeof sha === "string" && sha.length > 0 ? sha : null;
  }

  async set(repoKey: string, sha: string): Promise<void> {
    const task = this.writeChain.then(async () => {
      const repos = await this.readRepos();
      repos[repoKey] = sha;
      const store: MountBaseStoreShape = { version: 1, repos };
      await this.io.writeAtomic(JSON.stringify(store, null, 2));
    });
    // Keep the chain alive even when a write fails — the NEXT set must still
    // run; the failure propagates to THIS caller only.
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  /** Tolerant read: absent/corrupt file → empty store (R10, never throws). */
  private async readRepos(): Promise<Record<string, string>> {
    try {
      const raw = await this.io.read();
      if (raw === null) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      const repos = (parsed as { repos?: unknown }).repos;
      if (repos === null || typeof repos !== "object") return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(repos as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
}
