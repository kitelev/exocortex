/**
 * Generic Settings Distribution engine (RFC f402002b, M2.1) — public barrel.
 *
 * A source-agnostic Export/Import engine: a {@link SettingsSource} declares its
 * allowlist of setting keys + how to read/write live values; the engine
 * round-trips them through `setting__Setting` assets with an
 * allowlist-by-construction guarantee. Pure (I/O injected by the caller).
 */
export * from "./types";
export {
  SETTING_KEY_PROP,
  SETTING_VALUE_PROP,
  LEGACY_SETTING_KEY_PROPS,
  LEGACY_SETTING_VALUE_PROPS,
  coerceSettingValue,
  extractKeyRef,
  readSettingValueRaw,
  renderSettingAssetMarkdown,
} from "./settingAsset";
export { exportSettings, importSettings } from "./SettingsDistributionEngine";
export {
  EXOCORTEX_DISTRIBUTION_ONTOLOGY_KEY_UID,
  resolveDistributionOntology,
} from "./distributionOntology";
