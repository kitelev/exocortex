/**
 * Exocortex domain binding for the generic Settings Distribution engine
 * (RFC f402002b, M2.1). Wraps the real `VAULT_SETTINGS_REGISTRY` (the 24
 * declared, homoiconizable plugin-setting keys — the allowlist) + the live
 * plugin settings object so `exportSettings` / `importSettings` can round-trip
 * exocortex settings.
 *
 * Allowlist-by-construction (onto-RFC R2): `declaredKeys()` is exactly the
 * registry, so the engine can never export/import an undeclared field
 * (`pat`, `logChannels`, …) — those are not in the registry and are listed in
 * `NON_HOMOICONIZABLE_FIELDS`. The source NEVER enumerates the live keyspace.
 *
 * Pure over injected deps (no `obsidian` runtime import) — unit-testable; the
 * I/O (vault.adapter write / warm metadataCache read) is wired by the command
 * registrar, not here.
 */
import type { SettingKeySpec, SettingsSource } from "@kitelev/exocortex-core";
import {
  SETTING_CLASS_UID,
  VAULT_SETTINGS_REGISTRY,
} from "@plugin/domain/settings/VaultSettingsRegistry";

/** The exocortex allowlist as engine key-specs (1:1 with the registry). */
export const EXOCORTEX_DECLARED_KEYS: readonly SettingKeySpec[] =
  VAULT_SETTINGS_REGISTRY.map((d) => ({
    field: d.field,
    keyUid: d.keyUid,
    keyLabel: d.keyLabel,
    datatype: d.datatype,
    settingUid: d.settingUid,
  }));

export interface ExocortexSettingsSourceDeps {
  /** Live settings accessor (the post-loadSettings object on the plugin). */
  getSettings: () => Record<string, unknown>;
  /**
   * Apply an imported value to live settings: mutate the field, run its
   * side-effect hook, and persist to data.json. Mirrors the live-mirror's
   * `applyRemote` so Import behaves identically to a cross-device change.
   */
  applyLive: (field: string, value: unknown) => Promise<void>;
}

/** {@link SettingsSource} for the exocortex plugin-settings domain. */
export class ExocortexSettingsSource implements SettingsSource {
  /** Exported assets are typed `exo__Setting` (subclass of `setting__Setting`). */
  readonly settingClassUid = SETTING_CLASS_UID;

  constructor(private readonly deps: ExocortexSettingsSourceDeps) {}

  declaredKeys(): readonly SettingKeySpec[] {
    return EXOCORTEX_DECLARED_KEYS;
  }

  readLiveValue(key: SettingKeySpec): unknown {
    return this.deps.getSettings()[key.field];
  }

  async writeLiveValue(key: SettingKeySpec, value: unknown): Promise<void> {
    await this.deps.applyLive(key.field, value);
  }
}
