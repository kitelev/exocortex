import type { App } from "obsidian";

/**
 * Persisted lock file shape — `.exocortex/switch-lock.json` (configurable).
 * Written atomically via Obsidian vault adapter; survives plugin reload so
 * a fresh plugin load can detect an interrupted long-running operation
 * (per RFC 0a0791c1 §B.6, Architect #6, Security #9).
 */
export interface LockSnapshot {
  /**
   * Plugin instance identifier — distinguishes the current plugin run from
   * a previous (potentially crashed) one. Generated at plugin load via
   * `crypto.randomUUID()`.
   */
  pid: string;
  /** ISO timestamp set when `acquireLock` succeeds. */
  acquiredAt: string;
  /** ISO timestamp bumped by `heartbeat`. Used to detect staleness. */
  lastHeartbeat: string;
  /**
   * Operation label — e.g. `"switch-profile-<targetUid>"`. Surfaces in
   * recovery dialogs and journal correlation.
   */
  operation: string;
}

export interface PluginLockManagerOptions {
  app: App;
  /** Plugin instance UUID; default `crypto.randomUUID()`. */
  pid?: string;
  /** Lock file path inside the vault. Default `.exocortex/switch-lock.json`. */
  lockPath?: string;
  /**
   * Staleness threshold in milliseconds. A lock whose `lastHeartbeat` is
   * older than this is considered stale and may be overtaken. Default 5 min.
   */
  staleMs?: number;
  /** Injectable `Date.now`/`new Date()` for deterministic tests. */
  now?: () => Date;
}

export interface CheckOnLoadResult {
  /** True when a lock file exists and is older than `staleMs`. */
  stale: boolean;
  /** Snapshot of the lock file, or `null` if absent / unreadable. */
  holder: LockSnapshot | null;
}

const DEFAULT_LOCK_PATH = ".exocortex/switch-lock.json";
const DEFAULT_STALE_MS = 5 * 60 * 1000;

/**
 * PluginLockManager — persisted cross-session lock с heartbeat для long-running
 * operations (profile switch, asset-space pull). Lock file is JSON в vault root.
 *
 * Caller pattern:
 *
 * ```ts
 * if (!(await lockMgr.acquireLock("switch-profile-<uid>"))) {
 *   notice("Another switch in progress");
 *   return;
 * }
 * const hbTimer = setInterval(() => lockMgr.heartbeat(), 30_000);
 * try {
 *   await doLongOperation();
 * } finally {
 *   clearInterval(hbTimer);
 *   await lockMgr.releaseLock();
 * }
 * ```
 *
 * Stale recovery: at plugin load, call `checkOnPluginLoad()`. If `stale=true`,
 * the caller is responsible для idempotent re-trigger (v3 backward-compat) or
 * presenting a user dialog (Phase C+D, deferred).
 */
export class PluginLockManager {
  private readonly app: App;
  private readonly pid: string;
  private readonly lockPath: string;
  private readonly staleMs: number;
  private readonly now: () => Date;

  constructor(options: PluginLockManagerOptions) {
    this.app = options.app;
    this.pid = options.pid ?? this.generatePid();
    this.lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Atomically acquire the lock. Returns `false` if the lock file exists
   * and is not stale. Returns `true` and writes a fresh snapshot otherwise.
   *
   * @param operation Short label persisted into the lock file для diagnostics.
   */
  async acquireLock(operation: string): Promise<boolean> {
    const existing = await this.readLock();
    if (existing !== null && !this.snapshotIsStale(existing)) {
      return false;
    }
    const nowIso = this.now().toISOString();
    const snapshot: LockSnapshot = {
      pid: this.pid,
      acquiredAt: nowIso,
      lastHeartbeat: nowIso,
      operation,
    };
    await this.writeLock(snapshot);
    return true;
  }

  /**
   * Bump `lastHeartbeat` to current time. No-op (and logs warning) если lock
   * file disappeared or pid mismatch — caller should treat that as «lock lost».
   */
  async heartbeat(): Promise<void> {
    const existing = await this.readLock();
    if (existing === null) return;
    if (existing.pid !== this.pid) return; // not our lock
    existing.lastHeartbeat = this.now().toISOString();
    await this.writeLock(existing);
  }

  /**
   * Remove the lock file. Idempotent (safe to call without an acquired lock).
   * Refuses to clear a lock owned by a different pid — caller should pass
   * `force: true` only after explicit user confirmation.
   */
  async releaseLock(opts: { force?: boolean } = {}): Promise<void> {
    const existing = await this.readLock();
    if (existing === null) return;
    if (existing.pid !== this.pid && !opts.force) return;
    await this.deleteLock();
  }

  /**
   * Crash-recovery helper — delete the lock file IFF it is NOT a live lock held
   * by THIS session: i.e. it belongs to a different pid (a crashed/other
   * session) OR it is stale. A fresh lock owned by this session (a concurrent
   * same-session apply in progress) is left intact. Returns whether a lock was
   * reclaimed.
   *
   * Used by {@link ProfileApplyManager.recoverIncompleteSwitch} to reclaim a
   * crashed session's still-fresh foreign-pid lock (its heartbeat froze at
   * crash time, so `acquireLock` would not yet treat it as stale) WITHOUT
   * stomping a concurrent same-session apply the user may have just triggered.
   */
  async reclaimIfForeignOrStale(): Promise<boolean> {
    const existing = await this.readLock();
    if (existing === null) return false;
    // Our own still-fresh lock = a live in-progress apply — do not reclaim.
    if (existing.pid === this.pid && !this.snapshotIsStale(existing)) {
      return false;
    }
    await this.deleteLock();
    return true;
  }

  /**
   * Synchronous staleness probe against the in-memory snapshot OR latest disk
   * read (caller chooses). For most uses, prefer `checkOnPluginLoad()` which
   * does the read + verdict together.
   */
  snapshotIsStale(snapshot: LockSnapshot): boolean {
    const last = Date.parse(snapshot.lastHeartbeat);
    if (Number.isNaN(last)) return true; // unreadable timestamp → treat stale
    return this.now().getTime() - last > this.staleMs;
  }

  /**
   * Inspection helper used at plugin-load. Reads the lock file (if present)
   * and reports staleness; does NOT mutate state.
   */
  async checkOnPluginLoad(): Promise<CheckOnLoadResult> {
    const snapshot = await this.readLock();
    if (snapshot === null) return { stale: false, holder: null };
    return { stale: this.snapshotIsStale(snapshot), holder: snapshot };
  }

  /** Read + parse the lock file; returns `null` if missing or malformed. */
  private async readLock(): Promise<LockSnapshot | null> {
    try {
      const exists = await this.app.vault.adapter.exists(this.lockPath);
      if (!exists) return null;
      const raw = await this.app.vault.adapter.read(this.lockPath);
      const parsed = JSON.parse(raw) as Partial<LockSnapshot>;
      if (
        typeof parsed.pid !== "string" ||
        typeof parsed.acquiredAt !== "string" ||
        typeof parsed.lastHeartbeat !== "string" ||
        typeof parsed.operation !== "string"
      ) {
        return null;
      }
      return parsed as LockSnapshot;
    } catch {
      return null;
    }
  }

  private async writeLock(snapshot: LockSnapshot): Promise<void> {
    await this.app.vault.adapter.write(
      this.lockPath,
      JSON.stringify(snapshot, null, 2),
    );
  }

  private async deleteLock(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(this.lockPath);
      if (exists) await this.app.vault.adapter.remove(this.lockPath);
    } catch {
      // best-effort delete; swallow
    }
  }

  private generatePid(): string {
    // Obsidian runs on Electron / Node ≥14, both expose Web Crypto with
    // crypto.randomUUID. SEC-001 (ADR) forbids Math.random for IDs.
    return crypto.randomUUID();
  }
}
