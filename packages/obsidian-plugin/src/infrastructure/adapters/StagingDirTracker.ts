// Node.js builtins required for Phase 5 apply staging dirs (RFC
// 22b50a17) — staging dirs live в `os.tmpdir()` OUTSIDE the vault so
// Obsidian's vault.adapter API cannot reach them. This file is only
// instantiated on desktop — callers (AssetSpaceManager.pullAssetSpace +
// ExocortexPlugin.onload sweepOrphans) guard via Platform.isMobile.
/* eslint-disable no-restricted-imports, import/no-nodejs-modules */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
/* eslint-enable no-restricted-imports, import/no-nodejs-modules */
import type {
  PluginLocalDataStore,
  StagingDirEntry,
} from "./PluginLocalDataStore";

export interface StagingDirTrackerOptions {
  /** Persists the active staging-dir registry across plugin restarts. */
  localDataStore: PluginLocalDataStore;
  /**
   * OS-level tmpdir base. Default `os.tmpdir()`. Tests inject a custom path
   * so allocations live inside a disposable directory cleaned in afterEach.
   */
  tmpdirBase?: string;
}

/**
 * StagingDirTracker — manage Phase 5 tarball-materialization staging dirs
 * (RFC 22b50a17 R26 mitigation).
 *
 * The Phase 5 apply algorithm pulls one or more AssetSpace tarballs
 * to a staging directory before atomically moving them into the vault.
 * If the plugin crashes (or Obsidian quits) mid-pull, the staging dir
 * lives under `os.tmpdir()` and would survive forever — OS-level temp
 * sweepers may not reclaim it for days.
 *
 * This tracker writes each newly-allocated staging dir к the local data
 * store BEFORE materialization writes begin, and removes the entry once
 * the consumer releases the directory. On plugin onload, `sweepOrphans()`
 * deletes anything still tracked (= plugin crashed before release).
 *
 * **Cross-platform note:** uses Node's `fs/promises` and `os.tmpdir()`.
 * Mobile Obsidian provides neither, so the tracker should only be wired
 * на desktop. The caller (AssetSpaceManager.pullAssetSpace) guards via
 * `Platform.isDesktopApp` at entry.
 */
export class StagingDirTracker {
  private readonly localDataStore: PluginLocalDataStore;
  private readonly tmpdirBase: string;

  /**
   * Promise chain serializing `read-modify-write` of the registry. The
   * tracker's persistence backend (PluginLocalDataStore) does not lock, so
   * parallel `allocate()` calls would race: both read `[]`, both push, both
   * write — one entry lost. Chaining через this promise guarantees the
   * critical region is sequential per tracker instance.
   *
   * `fs.mkdtemp` itself is atomic and outside the lock; only the registry
   * read-modify-write is serialized. Net effect: concurrent callers see
   * sequential allocate semantics but pay only ms-scale waits.
   */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(opts: StagingDirTrackerOptions) {
    if (!opts || !opts.localDataStore) {
      throw new Error("StagingDirTracker: localDataStore is required");
    }
    this.localDataStore = opts.localDataStore;
    this.tmpdirBase = opts.tmpdirBase ?? os.tmpdir();
  }

  /**
   * Allocate a fresh staging dir for `asUid`. Returns the absolute path.
   *
   * The dir is created via `fs.mkdtemp` (unique suffix prevents races
   * between concurrent allocations for the same `asUid`), then registered
   * in the local data store. If registration fails, the dir is removed
   * synchronously so we never leak unregistered temp dirs.
   */
  async allocate(asUid: string): Promise<string> {
    if (typeof asUid !== "string" || asUid.length === 0) {
      throw new Error("StagingDirTracker.allocate: asUid is required");
    }
    return this.runSerial(async () => {
      const sanitized = asUid.replace(/[^a-zA-Z0-9-]/g, "_");
      const prefix = path.join(this.tmpdirBase, `exo-staging-${sanitized}-`);
      const dir = await fs.mkdtemp(prefix);
      try {
        const tracked = await this.localDataStore.readActiveStagingDirs();
        const entry: StagingDirEntry = {
          asUid,
          path: dir,
          allocatedAt: new Date().toISOString(),
        };
        tracked.push(entry);
        await this.localDataStore.writeActiveStagingDirs(tracked);
        return dir;
      } catch (err) {
        // Best-effort cleanup of the unregistered dir; rethrow original error.
        await fs
          .rm(dir, { recursive: true, force: true })
          .catch(() => undefined);
        throw err;
      }
    });
  }

  /**
   * Serialize critical-region work via a promise chain. The chain absorbs
   * the result (even errors) so subsequent callers always run; we re-throw
   * to the **invoker** so they see the original failure.
   */
  private runSerial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(() => task());
    // Swallow errors on the chain so the next link runs regardless. The
    // returned promise (`next`) still surfaces the error to the caller.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /**
   * Release a previously-allocated staging dir — removes it from disk and
   * from the tracker.  Idempotent: missing entries / non-existent dirs are
   * tolerated так that `release()` from a finally-block never throws over a
   * primary error.
   */
  async release(stagingPath: string): Promise<void> {
    if (typeof stagingPath !== "string" || stagingPath.length === 0) return;
    return this.runSerial(async () => {
      await fs
        .rm(stagingPath, { recursive: true, force: true })
        .catch(() => undefined);
      const tracked = await this.localDataStore.readActiveStagingDirs();
      const filtered = tracked.filter((e) => e.path !== stagingPath);
      if (filtered.length !== tracked.length) {
        await this.localDataStore.writeActiveStagingDirs(filtered);
      }
    });
  }

  /**
   * On plugin onload, delete any staging dirs that survived a crash.
   *
   * Walks the tracker registry: для каждой entry, `fs.rm(path, force: true)`
   * (no-op if dir already gone), then clears the registry. Returns counts
   * for logging/telemetry.
   */
  async sweepOrphans(): Promise<{ swept: number; tracked: number }> {
    return this.runSerial(async () => {
      const tracked = await this.localDataStore.readActiveStagingDirs();
      if (tracked.length === 0) return { swept: 0, tracked: 0 };
      let swept = 0;
      for (const entry of tracked) {
        const existed = await fs
          .access(entry.path)
          .then(() => true)
          .catch(() => false);
        if (existed) {
          await fs
            .rm(entry.path, { recursive: true, force: true })
            .catch(() => undefined);
          swept++;
        }
      }
      await this.localDataStore.writeActiveStagingDirs([]);
      return { swept, tracked: tracked.length };
    });
  }
}
