import type {
  ISettingsStore,
  SwitchSettings,
} from "./FocusProfileSwitchManager";

/**
 * Pluggable host hook for {@link PluginSettingsStoreAdapter}. The plugin
 * passes its current `settings` object and a `saveData` thunk; the adapter
 * neither knows nor cares about the surrounding `ExocortexSettings` shape
 * — it only reads/writes the two switch-state keys per RFC 0a0791c1 §B.4
 * (`activeProfileUid`, `_switchInProgress`).
 *
 * The thunk pattern (rather than holding a direct plugin reference) keeps
 * the adapter free of `Plugin` import — useful for the test path which
 * stubs the save fn outright.
 */
export interface PluginSettingsStoreHost {
  /**
   * Reads the live settings record. Implementations should return the
   * SAME mutable reference the plugin holds, because B.4 expects
   * `settings.activeProfileUid = X` to round-trip back through the
   * `save()` thunk. A frozen / cloned object would silently drop the
   * write.
   */
  readSettings(): {
    activeProfileUid?: string | null;
    _switchInProgress?: boolean;
    [k: string]: unknown;
  };
  /** Persists the current settings object to disk (Obsidian `saveData`). */
  saveSettings(): Promise<void>;
}

/**
 * `ISettingsStore` adapter persisting via the plugin's standard
 * `saveData()` round-trip. Defaults missing fields:
 *   - `activeProfileUid` → `null` (no profile selected, full vault)
 *   - `_switchInProgress` → `false`
 *
 * Persistence target: Obsidian plugin `data.json`, which Obsidian Sync
 * replicates across devices. Per RFC 0a0791c1 + Vision Lock #1, only PATs
 * live в `data.local.json`; the active profile UID is intentionally
 * synced so the user's profile choice follows them. Per-device override
 * is a Phase D follow-up.
 */
export class PluginSettingsStoreAdapter implements ISettingsStore {
  constructor(private readonly host: PluginSettingsStoreHost) {
    if (!host) {
      throw new Error("PluginSettingsStoreAdapter: host is required");
    }
  }

  async load(): Promise<SwitchSettings> {
    const raw = this.host.readSettings();
    const activeProfileUid =
      typeof raw.activeProfileUid === "string" ? raw.activeProfileUid : null;
    const inProgress =
      typeof raw._switchInProgress === "boolean"
        ? raw._switchInProgress
        : false;
    return {
      activeProfileUid,
      _switchInProgress: inProgress,
    };
  }

  async save(s: SwitchSettings): Promise<void> {
    const raw = this.host.readSettings();
    raw.activeProfileUid = s.activeProfileUid;
    raw._switchInProgress = s._switchInProgress;
    await this.host.saveSettings();
  }
}
