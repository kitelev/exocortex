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
 * Cross-store coexistence relies on **lossless read-modify-write** in
 * both stores. `LocalSecretsStore` was originally written to filter
 * non-string keys (its public contract returns
 * `Record<string, string>`), and an inner `readAll → persist` round
 * trip would deterministically strip booleans/nulls written by sibling
 * stores. Issue #3327 Item #3 fixed this — secrets-store internals now
 * use a typed-preserving `readAllRaw()` for the RMW path and the
 * string-filtered `readAll()` only for public-facing consumers.
 *
 * Locking is not used. Writes from the two stores can interleave under
 * a worst-case (user clicks «save PAT» during a profile switch) — the
 * last writer wins. Since each store mutates only its own key
 * namespace, the loser observes a stale read but no key collision.
 * If empirical races emerge, add file-level locking via
 * `PluginLockManager`.
 *
 * ## In-memory cache contract
 *
 * `init()` loads the file once into `this.cache`. Synchronous accessors
 * (`getActiveProfileUid()`, `isSwitchInProgress()`) read from the
 * cache — they MUST be called only after `init()` resolves. `save()`
 * writes the cache back to disk и keeps the cache up to date.
 *
 * ## Single active-state slot (RFC 0a0791c1 Phase 5 T2)
 *
 * `activeProfileUid` is the single last-applied cache slot — the profile
 * the «Apply profile» mount-state switch most recently materialised. The
 * former dual Knowledge/Focus slots (`activeKnowledgeProfileUid` /
 * `activeFocusProfileUid`, RFC 13da049f AC14) were retired together with
 * the soft RDF query-time filter in Phase 5 T2; any leftover keys on disk
 * are ignored (RMW preserves them harmlessly).
 */

const KEY_ACTIVE_PROFILE_UID = "activeProfileUid";
const KEY_SWITCH_IN_PROGRESS = "_switchInProgress";
const KEY_ACTIVE_STAGING_DIRS = "_activeStagingDirs";
const KEY_FILE_ONLY_ASSET_SPACES = "_fileOnlyAssetSpaces";

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
  /**
   * Last-applied profile cache (RFC 0a0791c1 Phase 5 T2). Set by the
   * «Apply profile» mount-state switch to the profile it most recently
   * materialised. Single source of truth — the former dual Knowledge/Focus
   * slots were retired with the soft RDF filter in Phase 5 T2.
   */
  activeProfileUid: string | null;
  _switchInProgress: boolean;
}

/**
 * Input shape for {@link PluginLocalDataStore.save}.
 */
export type LocalSwitchStateInput = Pick<
  LocalSwitchState,
  "activeProfileUid" | "_switchInProgress"
>;

/**
 * Tracked staging dir entry — registered by {@link StagingDirTracker.allocate}
 * before any tarball materialization writes, swept on plugin onload by
 * {@link StagingDirTracker.sweepOrphans} if the process crashed mid-pull
 * (RFC 22b50a17 R26 mitigation).
 */
export interface StagingDirEntry {
  asUid: string;
  path: string;
  allocatedAt: string;
}

/**
 * File-only AssetSpace registry entry — recorded when a vault is bootstrapped
 * WITHOUT a `.git` directory (RFC 13da049f Phase 6.2 AC10 / M19). Such vaults
 * cannot track AssetSpaces via `.gitmodules`, so the materialised folder + its
 * source URL are persisted device-locally instead. This lets the EC2
 * «clone-from-another-machine» recovery and future re-fetch surfaces know
 * which AssetSpaces exist even though git is unavailable.
 */
export interface FileOnlyAssetSpaceEntry {
  /** Vault-relative folder where the AssetSpace was materialised. */
  folderName: string;
  /** GitHub repo URL the tarball was pulled from. */
  url: string;
  /** 7-char tarball SHA recorded at pull time (provenance). */
  sha: string;
  addedAt: string;
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

  /** Returns the cached last-applied active profile UID. Requires `init()` first. */
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
   *
   * The cache is re-derived from the just-persisted bytes so it always
   * mirrors disk. Read-modify-write preserves unknown keys, including any
   * retired Knowledge/Focus slots left behind by an older plugin version.
   */
  async save(state: LocalSwitchStateInput): Promise<void> {
    const all = await this.readAllRaw();
    all[KEY_ACTIVE_PROFILE_UID] =
      state.activeProfileUid === null ? null : state.activeProfileUid;
    all[KEY_SWITCH_IN_PROGRESS] = state._switchInProgress;
    await this.persist(all);
    this.cache = this.deriveStateFromRaw(all);
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

  /**
   * Read the tracked staging-dir registry. Returns a fresh array — callers
   * can mutate без affecting future reads.
   *
   * Reads from disk на каждом call (NOT cached в `this.cache`): staging-dir
   * tracking is write-rare / read-rare (plugin onload sweep + per-pull
   * allocate/release), and the value lives outside `LocalSwitchState` so a
   * stale cache read after a sibling write would be visible across surfaces.
   */
  async readActiveStagingDirs(): Promise<StagingDirEntry[]> {
    const all = await this.readAllRaw();
    const raw = all[KEY_ACTIVE_STAGING_DIRS];
    if (!Array.isArray(raw)) return [];
    const out: StagingDirEntry[] = [];
    for (const item of raw) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).asUid === "string" &&
        typeof (item as Record<string, unknown>).path === "string" &&
        typeof (item as Record<string, unknown>).allocatedAt === "string"
      ) {
        const e = item as Record<string, unknown>;
        out.push({
          asUid: e.asUid as string,
          path: e.path as string,
          allocatedAt: e.allocatedAt as string,
        });
      }
    }
    return out;
  }

  /**
   * Replace the tracked staging-dir registry. Preserves unknown sibling
   * keys (PAT in LocalSecretsStore, switch state) via RMW.
   */
  async writeActiveStagingDirs(entries: StagingDirEntry[]): Promise<void> {
    const all = await this.readAllRaw();
    all[KEY_ACTIVE_STAGING_DIRS] = entries.map((e) => ({
      asUid: e.asUid,
      path: e.path,
      allocatedAt: e.allocatedAt,
    }));
    await this.persist(all);
  }

  /**
   * Read the file-only AssetSpace registry (RFC 13da049f AC10 / M19). Returns
   * a fresh array — callers can mutate without affecting future reads. Reads
   * from disk on each call (write-rare, lives outside `LocalSwitchState`).
   */
  async readFileOnlyAssetSpaces(): Promise<FileOnlyAssetSpaceEntry[]> {
    const all = await this.readAllRaw();
    const raw = all[KEY_FILE_ONLY_ASSET_SPACES];
    if (!Array.isArray(raw)) return [];
    const out: FileOnlyAssetSpaceEntry[] = [];
    for (const item of raw) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).folderName === "string" &&
        typeof (item as Record<string, unknown>).url === "string" &&
        typeof (item as Record<string, unknown>).sha === "string" &&
        typeof (item as Record<string, unknown>).addedAt === "string"
      ) {
        const e = item as Record<string, unknown>;
        out.push({
          folderName: e.folderName as string,
          url: e.url as string,
          sha: e.sha as string,
          addedAt: e.addedAt as string,
        });
      }
    }
    return out;
  }

  /**
   * Upsert a file-only AssetSpace entry (keyed by `folderName`). Preserves
   * unknown sibling keys via RMW. Idempotent: re-recording the same folder
   * replaces its prior entry rather than duplicating it.
   *
   * Like the rest of this store, the read-modify-write is NOT serialized — it
   * relies on callers invoking it sequentially (the bootstrap flow awaits each
   * `materialize` fully before the next). Concurrent writes to
   * `data.local.json` could clobber; if overlapping surfaces emerge, route
   * through a shared write-chain like {@link StagingDirTracker}.
   */
  async upsertFileOnlyAssetSpace(
    entry: FileOnlyAssetSpaceEntry,
  ): Promise<void> {
    const existing = await this.readFileOnlyAssetSpaces();
    const next = existing.filter((e) => e.folderName !== entry.folderName);
    next.push(entry);
    const all = await this.readAllRaw();
    all[KEY_FILE_ONLY_ASSET_SPACES] = next.map((e) => ({
      folderName: e.folderName,
      url: e.url,
      sha: e.sha,
      addedAt: e.addedAt,
    }));
    await this.persist(all);
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
    return this.deriveStateFromRaw(all);
  }

  /**
   * Normalise a raw `data.local.json` record into a fully-populated
   * {@link LocalSwitchState} (explicit nulls for absent slots). Single source
   * of truth shared by `readFromDisk` and `save`'s cache refresh so the cache
   * always mirrors disk.
   */
  private deriveStateFromRaw(all: Record<string, unknown>): LocalSwitchState {
    const asStr = (v: unknown): string | null =>
      typeof v === "string" ? v : null;
    return {
      activeProfileUid: asStr(all[KEY_ACTIVE_PROFILE_UID]),
      _switchInProgress: all[KEY_SWITCH_IN_PROGRESS] === true,
    };
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
