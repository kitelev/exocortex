import type { App } from "obsidian";

/**
 * PluginLocalDataStore — device-local persistence для switch state
 * (`activeProfileUid`, `_switchInProgress`).
 *
 * Per Issue #3327 Item #3 + CLAUDE.md FocusProfile section refinement:
 * the active profile selection и mid-switch flag are per-device state,
 * NOT cross-device sync state. Storing них в `plugin.data.json` causes
 * Obsidian Sync to replicate the selection: device A choosing profile
 * X silently switches device B too, и a crash on device A leaves
 * `_switchInProgress=true` flag visible on device B (triggering
 * `recoverIfNeeded` for a switch that did not happen there).
 *
 * Solution mirrors {@link LocalSecretsStore}: persist в
 * `<configDir>/plugins/exocortex/data.local.json`, which Obsidian Sync
 * excludes by convention (any `.local.json` filename).
 *
 * ## Key separation from LocalSecretsStore
 *
 * Both stores write to `data.local.json` so they share the file but
 * use disjoint key namespaces:
 *   - `LocalSecretsStore` writes keys: `pat` (currently the only one)
 *   - `PluginLocalDataStore` writes keys: `activeProfileUid`,
 *     `_switchInProgress`
 *
 * Concurrent writes are not coordinated by a lock. In practice:
 *   - PAT updates are rare (user-initiated in Settings UI)
 *   - Switch state writes happen during `FocusProfileSwitchManager.switchProfile`
 *     which holds `PluginLockManager` lock (serialises switches)
 *   - Cross-store contention requires a user clicking «save PAT»
 *     during a profile switch — possible but vanishingly rare
 *
 * If empirical races emerge, add file-level locking via PluginLockManager.
 *
 * ## In-memory cache contract
 *
 * `init()` loads the file once into `this.cache`. Synchronous accessors
 * (`getActiveProfileUid()`, `isSwitchInProgress()`) read from the cache
 * — they MUST be called only after `init()` resolves. `save()` writes
 * the cache back to disk и keeps the cache up to date.
 */

const KEY_ACTIVE_PROFILE_UID = "activeProfileUid";
const KEY_SWITCH_IN_PROGRESS = "_switchInProgress";

export interface PluginLocalDataStoreOptions {
  app: App;
  /**
   * Path relative к vault root. Default uses Obsidian's runtime
   * `vault.configDir` joined с `plugins/<pluginId>/data.local.json`.
   */
  path?: string;
  /** Plugin id used to build the default path. Default `"exocortex"`. */
  pluginId?: string;
}

export interface LocalSwitchState {
  activeProfileUid: string | null;
  _switchInProgress: boolean;
}

const EMPTY_STATE: LocalSwitchState = {
  activeProfileUid: null,
  _switchInProgress: false,
};

export class PluginLocalDataStore {
  private readonly app: App;
  private readonly path: string;
  private cache: LocalSwitchState = { ...EMPTY_STATE };
  private initialized = false;

  constructor(options: PluginLocalDataStoreOptions) {
    this.app = options.app;
    if (options.path !== undefined) {
      this.path = options.path;
    } else {
      const configDir = options.app.vault.configDir;
      const pluginId = options.pluginId ?? "exocortex";
      this.path = `${configDir}/plugins/${pluginId}/data.local.json`;
    }
  }

  /**
   * Eager-load the file into the in-memory cache. Must be awaited before
   * any sync accessor. Idempotent — subsequent calls re-read the disk
   * state (useful for tests; production calls it once at plugin onload).
   */
  async init(): Promise<void> {
    this.cache = await this.readFromDisk();
    this.initialized = true;
  }

  /** Returns the cached active profile UID. Requires `init()` first. */
  getActiveProfileUid(): string | null {
    this.assertInitialized();
    return this.cache.activeProfileUid;
  }

  /** Returns the cached switch-in-progress flag. Requires `init()` first. */
  isSwitchInProgress(): boolean {
    this.assertInitialized();
    return this.cache._switchInProgress;
  }

  /** Returns a snapshot of the full cached state. */
  snapshot(): LocalSwitchState {
    this.assertInitialized();
    return { ...this.cache };
  }

  /**
   * Persist the new state to disk и refresh the cache. Read-modify-
   * write semantics preserve unknown keys (e.g. `pat` written by
   * LocalSecretsStore).
   */
  async save(state: LocalSwitchState): Promise<void> {
    const all = await this.readAllRaw();
    all[KEY_ACTIVE_PROFILE_UID] =
      state.activeProfileUid === null ? null : state.activeProfileUid;
    all[KEY_SWITCH_IN_PROGRESS] = state._switchInProgress;
    await this.persist(all);
    this.cache = { ...state };
    this.initialized = true;
  }

  /**
   * Migration helper — copy legacy `plugin.settings` keys into the local
   * store IF the local store does not already have them. Caller (plugin
   * onload) deletes the legacy keys from `plugin.settings` after this
   * resolves.
   *
   * Idempotent: if local store already has values, returns without
   * mutating (handles stale-sync edge case where legacy fields arrive
   * from another device после migration already happened).
   *
   * Returns the source from which switch state was resolved:
   *   - `"local"`: local store had values; legacy ignored
   *   - `"legacy"`: copied from legacy; local store now populated
   *   - `"none"`: neither source had values; both stay empty
   */
  async migrateFromLegacyIfNeeded(legacy: {
    activeProfileUid?: unknown;
    _switchInProgress?: unknown;
  }): Promise<"local" | "legacy" | "none"> {
    const fresh = await this.readFromDisk();
    const localHasActive =
      typeof fresh.activeProfileUid === "string" &&
      fresh.activeProfileUid.length > 0;
    const localHasFlag = fresh._switchInProgress === true;

    if (localHasActive || localHasFlag) {
      // Local already populated — prefer it. Idempotency guarantee.
      this.cache = fresh;
      this.initialized = true;
      return "local";
    }

    const legacyActive =
      typeof legacy.activeProfileUid === "string"
        ? legacy.activeProfileUid
        : null;
    const legacyFlag =
      typeof legacy._switchInProgress === "boolean"
        ? legacy._switchInProgress
        : false;

    if (legacyActive === null && legacyFlag === false) {
      // Nothing to migrate — keep cache empty.
      this.cache = { ...EMPTY_STATE };
      this.initialized = true;
      return "none";
    }

    await this.save({
      activeProfileUid: legacyActive,
      _switchInProgress: legacyFlag,
    });
    return "legacy";
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "PluginLocalDataStore: init() must be awaited before sync accessors",
      );
    }
  }

  private async readFromDisk(): Promise<LocalSwitchState> {
    const all = await this.readAllRaw();
    const activeProfileUid =
      typeof all[KEY_ACTIVE_PROFILE_UID] === "string"
        ? (all[KEY_ACTIVE_PROFILE_UID] as string)
        : null;
    const _switchInProgress =
      all[KEY_SWITCH_IN_PROGRESS] === true;
    return { activeProfileUid, _switchInProgress };
  }

  private async readAllRaw(): Promise<Record<string, unknown>> {
    try {
      const exists = await this.app.vault.adapter.exists(this.path);
      if (!exists) return {};
      const raw = await this.app.vault.adapter.read(this.path);
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") return {};
      return { ...(parsed as Record<string, unknown>) };
    } catch {
      return {};
    }
  }

  private async persist(all: Record<string, unknown>): Promise<void> {
    const json = JSON.stringify(all, null, 2);
    await this.app.vault.adapter.write(this.path, json);
  }
}
