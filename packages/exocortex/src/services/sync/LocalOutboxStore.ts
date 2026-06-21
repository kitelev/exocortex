/**
 * ExoSync device-local deferred-push outbox (offline conflict resolution).
 *
 * Holds resolutions the user made WITHOUT pushing — the IntelliJ model: choose a
 * version locally (it is written to disk immediately), defer the convergent
 * commit to the AssetSpace remote until the next Sync. The engine flushes this
 * outbox at the start of every (non-pull) sync, replaying each pending push with
 * a TOCTOU guard: it pushes ONLY if the remote path has NOT moved since the
 * resolution (the stored {@link OutboxEntry.baseRemoteSha}). If the remote moved,
 * the push is REFUSED — the conflict re-surfaces (zero-loss; the chosen content
 * stays on disk and the new remote stays in git history).
 *
 * Same `.local.` (Sync-excluded) single-file store family as the watermark and
 * the conflict cache: atomic IO through the injected {@link WatermarkFileIO},
 * tolerant read (corrupt/absent → empty), serialized read-modify-write.
 */

import type { WatermarkFileIO } from "./FileWatermarkStore";

/** Recommended store filename — `.local.` infix is Sync-excluded. */
export const OUTBOX_STORE_FILENAME = "exosync-outbox.local.json";

/**
 * Sentinel `baseRemoteSha` meaning "the remote version was ABSENT (deleted) at
 * resolution time" — a take-local resolution over a remotely-deleted path. The
 * flush re-creates the file remotely only if the remote path is STILL absent.
 */
export const OUTBOX_REMOTE_ABSENT = " absent";

/** One deferred resolution awaiting a push to the AssetSpace remote. */
export interface OutboxEntry {
  version: 1;
  repoKey: string;
  /** Repo-relative forward-slash path. */
  path: string;
  /** The chosen content to push (take-local or merged — always present). */
  chosenContent: string;
  /** Which side the user kept (take-remote / delete need no push ⇒ never here). */
  resolvedTo: "local" | "merged";
  /**
   * Git blob-SHA of the REMOTE version the resolution was made against — the
   * TOCTOU key. The flush pushes ONLY when the current remote blob-SHA for this
   * path still equals it; otherwise the remote moved and the push is refused.
   * {@link OUTBOX_REMOTE_ABSENT} ⇒ the remote was deleted at resolution time.
   */
  baseRemoteSha: string;
  /** ISO timestamp of the resolution. */
  resolvedAt: string;
}

/** Read view of the outbox (the resolver hides pending paths from its list). */
export interface OutboxReadPort {
  list(): Promise<OutboxEntry[]>;
  listForRepo(repoKey: string): Promise<OutboxEntry[]>;
  has(repoKey: string, path: string): Promise<boolean>;
}

/** Read+write outbox (the resolver enqueues, the engine flush removes). */
export interface OutboxStorePort extends OutboxReadPort {
  enqueue(entry: Omit<OutboxEntry, "version">): Promise<void>;
  remove(repoKey: string, path: string): Promise<void>;
}

interface StoreShape {
  version: 1;
  /** Keyed by `repoKey\0path`. */
  entries: Record<string, OutboxEntry>;
}

function outboxKey(repoKey: string, path: string): string {
  return `${repoKey}\0${path}`;
}

function isEntry(v: unknown): v is OutboxEntry {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.repoKey === "string" &&
    typeof r.path === "string" &&
    typeof r.chosenContent === "string" &&
    typeof r.baseRemoteSha === "string"
  );
}

export interface LocalOutboxStoreDeps {
  io: WatermarkFileIO;
  /** Injected clock (ISO string) — deterministic tests. */
  now?: () => string;
}

export class LocalOutboxStore implements OutboxStorePort {
  private readonly io: WatermarkFileIO;
  private readonly now: () => string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(deps: LocalOutboxStoreDeps) {
    this.io = deps.io;
    this.now = deps.now ?? ((): string => new Date().toISOString());
  }

  async enqueue(entry: Omit<OutboxEntry, "version">): Promise<void> {
    await this.mutate((store) => {
      store.entries[outboxKey(entry.repoKey, entry.path)] = {
        version: 1,
        ...entry,
        // The store stamps the time unless the caller already supplied one.
        resolvedAt: entry.resolvedAt.length > 0 ? entry.resolvedAt : this.now(),
      };
    });
  }

  async remove(repoKey: string, path: string): Promise<void> {
    await this.mutate((store) => {
      delete store.entries[outboxKey(repoKey, path)];
    });
  }

  async list(): Promise<OutboxEntry[]> {
    const store = await this.read();
    return Object.values(store.entries).filter(isEntry);
  }

  async listForRepo(repoKey: string): Promise<OutboxEntry[]> {
    return (await this.list()).filter((e) => e.repoKey === repoKey);
  }

  async has(repoKey: string, path: string): Promise<boolean> {
    const store = await this.read();
    const e = store.entries[outboxKey(repoKey, path)];
    return e !== undefined && isEntry(e);
  }

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
        entries: { ...(entries as Record<string, OutboxEntry>) },
      };
    } catch {
      return { version: 1, entries: {} };
    }
  }
}
