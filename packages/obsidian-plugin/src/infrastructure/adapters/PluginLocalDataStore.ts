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
 *     `activeKnowledgeProfileUid`, `activeFocusProfileUid`,
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
 * (`getActiveProfileUid()`, `getActiveKnowledgeProfileUid()`,
 * `getActiveFocusProfileUid()`, `isSwitchInProgress()`) read from the
 * cache — they MUST be called only after `init()` resolves. `save()`
 * writes the cache back to disk и keeps the cache up to date.
 *
 * ## Dual active-state slots (RFC 13da049f Phase 6.5b AC14)
 *
 * The Knowledge/Focus profile split gives each switch flavour its own
 * persisted slot:
 *   - `activeKnowledgeProfileUid` — set by `hardSwitchKnowledgeProfile`
 *     (materialised filesystem state).
 *   - `activeFocusProfileUid` — set by `softSwitchFocusProfile` (RDF
 *     query-time filter only).
 * The legacy `activeProfileUid` key is retained for backward read /
 * downgrade safety; `migrateToDualActiveState()` seeds the Knowledge
 * slot from it on first AC14 load (R38 — never copies to Focus).
 */

const KEY_ACTIVE_PROFILE_UID = "activeProfileUid";
const KEY_ACTIVE_KNOWLEDGE_PROFILE_UID = "activeKnowledgeProfileUid";
const KEY_ACTIVE_FOCUS_PROFILE_UID = "activeFocusProfileUid";
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
   * Legacy single-slot active profile. Retained for backward read /
   * downgrade safety. Both switch flavours keep mirroring their target
   * here (pre-AC14 conflated semantics) so a downgraded plugin still
   * finds a selection.
   */
  activeProfileUid: string | null;
  /** Active Knowledge profile (hard switch — materialised state). AC14. */
  activeKnowledgeProfileUid: string | null;
  /** Active Focus profile (soft switch — RDF query-time filter). AC14. */
  activeFocusProfileUid: string | null;
  _switchInProgress: boolean;
}

/**
 * Input shape for {@link PluginLocalDataStore.save}. The dual AC14 slots
 * are optional: pre-AC14 callers (and the migration helper) can omit them,
 * in which case `save` leaves the on-disk value untouched (read-modify-
 * write preserve) rather than clobbering it to null.
 */
export type LocalSwitchStateInput = Pick<
  LocalSwitchState,
  "activeProfileUid" | "_switchInProgress"
> &
  Partial<
    Pick<LocalSwitchState, "activeKnowledgeProfileUid" | "activeFocusProfileUid">
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
  activeKnowledgeProfileUid: null,
  activeFocusProfileUid: null,
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

  /** Returns the cached (legacy) active profile UID. Requires `init()` first. */
  getActiveProfileUid(): string | null {
    this.assertInitialized();
    return this.cache.activeProfileUid;
  }

  /**
   * Returns the cached active Knowledge profile UID (hard switch slot).
   * Requires `init()` first. AC14.
   */
  getActiveKnowledgeProfileUid(): string | null {
    this.assertInitialized();
    return this.cache.activeKnowledgeProfileUid;
  }

  /**
   * Returns the cached active Focus profile UID (soft switch slot).
   * Requires `init()` first. AC14.
   */
  getActiveFocusProfileUid(): string | null {
    this.assertInitialized();
    return this.cache.activeFocusProfileUid;
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
   * The dual AC14 slots are written only when present on `state`; when a
   * caller omits them (pre-AC14 shape), the on-disk value is preserved via
   * RMW rather than clobbered to null. The cache is re-derived from the
   * just-persisted bytes so it always mirrors disk (including preserved
   * sibling slots).
   */
  async save(state: LocalSwitchStateInput): Promise<void> {
    const all = await this.readAllRaw();
    all[KEY_ACTIVE_PROFILE_UID] =
      state.activeProfileUid === null ? null : state.activeProfileUid;
    if (state.activeKnowledgeProfileUid !== undefined) {
      all[KEY_ACTIVE_KNOWLEDGE_PROFILE_UID] = state.activeKnowledgeProfileUid;
    }
    if (state.activeFocusProfileUid !== undefined) {
      all[KEY_ACTIVE_FOCUS_PROFILE_UID] = state.activeFocusProfileUid;
    }
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
   * Migration helper (RFC 13da049f Phase 6.5b AC14) — seed the dual
   * Knowledge/Focus active-state slots from the legacy single
   * `activeProfileUid` key. Run at plugin onload AFTER
   * {@link migrateFromLegacyIfNeeded} (which moves state из `plugin.settings`
   * into `data.local.json`).
   *
   * R38 (Mac/iPhone divergence): the legacy single slot is interpreted as a
   * **Knowledge** profile — `activeKnowledgeProfileUid = activeProfileUid`,
   * `activeFocusProfileUid = null`. The Focus slot is NEVER seeded from the
   * legacy value: copying it to Focus on every device would silently re-apply
   * an RDF filter the user never chose as a Focus selection, and could diverge
   * per-device. Users re-select a Focus profile explicitly.
   *
   * Idempotent: presence of the `activeKnowledgeProfileUid` (or
   * `activeFocusProfileUid`) key on disk marks the dual shape as already
   * established — a second call is a no-op. This makes the migration safe to
   * resume after a crash between the legacy and dual migration steps (EC1).
   *
   * Returns:
   *   - `"already-dual"`: dual keys already present; no mutation.
   *   - `"migrated"`: legacy value seeded into the Knowledge slot.
   *   - `"none"`: no legacy value to seed; both slots stay null (no write).
   */
  async migrateToDualActiveState(): Promise<
    "already-dual" | "migrated" | "none"
  > {
    const all = await this.readAllRaw();
    const hasDualKey =
      Object.prototype.hasOwnProperty.call(
        all,
        KEY_ACTIVE_KNOWLEDGE_PROFILE_UID,
      ) ||
      Object.prototype.hasOwnProperty.call(all, KEY_ACTIVE_FOCUS_PROFILE_UID);

    if (hasDualKey) {
      // Already established the dual shape — idempotent no-op.
      this.cache = this.deriveStateFromRaw(all);
      this.initialized = true;
      return "already-dual";
    }

    const legacy =
      typeof all[KEY_ACTIVE_PROFILE_UID] === "string"
        ? (all[KEY_ACTIVE_PROFILE_UID] as string)
        : null;

    if (legacy === null) {
      // Nothing to seed — keep cache derived (both slots null). Do NOT write
      // so a fresh install stays file-less until a real selection is made.
      this.cache = this.deriveStateFromRaw(all);
      this.initialized = true;
      return "none";
    }

    // R38 — seed Knowledge only; Focus stays null.
    await this.save({
      activeProfileUid: legacy,
      activeKnowledgeProfileUid: legacy,
      activeFocusProfileUid: null,
      _switchInProgress: all[KEY_SWITCH_IN_PROGRESS] === true,
    });
    return "migrated";
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
      activeKnowledgeProfileUid: asStr(all[KEY_ACTIVE_KNOWLEDGE_PROFILE_UID]),
      activeFocusProfileUid: asStr(all[KEY_ACTIVE_FOCUS_PROFILE_UID]),
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
