import type {
  ISettingsStore,
  SwitchSettings,
} from "./ProfileApplyManager";
import type { PluginLocalDataStore } from "./PluginLocalDataStore";

/**
 * `ISettingsStore` adapter persisting через {@link PluginLocalDataStore}
 * (Issue #3327 Item #3 — device-local switch state).
 *
 * Prior to Item #3, switch state lived в `plugin.data.json` (synced
 * across devices via Obsidian Sync). That caused two UX bugs:
 *   1. Profile selection replicated cross-device against user intent
 *      (per CLAUDE.md FocusProfile section «per-device» contract).
 *   2. `_switchInProgress=true` left on a crashed device surfaced on
 *      sibling devices as spurious `recoverIfNeeded` fires.
 *
 * Now the adapter delegates к `PluginLocalDataStore` which writes
 * `data.local.json` (Sync-excluded). Caller (plugin onload) is
 * responsible for awaiting `localDataStore.init()` and running the
 * one-time legacy-keys migration BEFORE constructing this adapter.
 *
 * The `ISettingsStore` interface contract is unchanged — `load()` /
 * `save()` shape matches what `ProfileApplyManager` and tests
 * already use.
 */
export class PluginSettingsStoreAdapter implements ISettingsStore {
  constructor(private readonly localDataStore: PluginLocalDataStore) {
    if (!localDataStore) {
      throw new Error(
        "PluginSettingsStoreAdapter: localDataStore is required",
      );
    }
  }

  async load(): Promise<SwitchSettings> {
    const snap = this.localDataStore.snapshot();
    return {
      activeProfileUid: snap.activeProfileUid,
      _switchInProgress: snap._switchInProgress,
    };
  }

  async save(s: SwitchSettings): Promise<void> {
    await this.localDataStore.save({
      activeProfileUid: s.activeProfileUid,
      _switchInProgress: s._switchInProgress,
    });
  }
}
