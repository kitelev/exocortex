import type {
  ISettingsStore,
  SwitchSettings,
} from "./FocusProfileSwitchManager";
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
 * `save()` shape matches what `FocusProfileSwitchManager` and tests
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
      activeKnowledgeProfileUid: snap.activeKnowledgeProfileUid,
      activeFocusProfileUid: snap.activeFocusProfileUid,
      _switchInProgress: snap._switchInProgress,
    };
  }

  async save(s: SwitchSettings): Promise<void> {
    // AC14 — map the dual Knowledge/Focus slots through. A caller may omit
    // them (pre-AC14 shape); preserve the current on-disk value rather than
    // clobbering to null so one slot's write never wipes the sibling.
    const cur = this.localDataStore.snapshot();
    await this.localDataStore.save({
      activeProfileUid: s.activeProfileUid,
      activeKnowledgeProfileUid:
        s.activeKnowledgeProfileUid !== undefined
          ? s.activeKnowledgeProfileUid
          : cur.activeKnowledgeProfileUid,
      activeFocusProfileUid:
        s.activeFocusProfileUid !== undefined
          ? s.activeFocusProfileUid
          : cur.activeFocusProfileUid,
      _switchInProgress: s._switchInProgress,
    });
  }
}
