/**
 * VaultSettingsRegistry — allowlist binding between `ExocortexSettings`
 * fields (data.json keys) and the `exo__Setting` / `exo__SettingKey` TBox
 * shipped in `packages/exoas-exo` (onto-RFC 981b6070, D1 @ 6c0797e).
 *
 * Homoiconicity (RFC c78cc5c8): the SCHEMA of valid settings lives in the
 * graph (24 `exo__SettingKey` individuals, each declaring its datatype).
 * This module is the engine-side binding table (Q3 exception 1 — core
 * processing): it maps each graph key to the TypeScript field the plugin
 * actually reads. The registry↔graph parity unit test asserts this table
 * never drifts from the submodule TBox (onto-RFC R3).
 *
 * ## Allowlist by construction (0-leakage, onto-RFC R2)
 *
 * Migration and the vault write-path iterate ONLY over this registry.
 * Per-device state (`activeProfileUid`, `_switchInProgress` —
 * `data.local.json`), secrets (`pat` — `LocalSecretsStore`) and structural
 * settings (`displayNameSettings`, `logChannels` — deferred per onto-RFC
 * Scope OUT / D26) are not listed here and therefore can never become
 * vault assets, regardless of what extra keys a user's data.json carries
 * (the `[key: string]: unknown` index signature admits arbitrary keys).
 */

/** `exo__Setting` class asset UID (exoas-exo, D1). */
export const SETTING_CLASS_UID = "88b938af-1a55-451c-b3cc-2f03e5115fcf";

/** `exo__SettingKey` class asset UID (exoas-exo, D1). */
export const SETTING_KEY_CLASS_UID = "a37d39ec-413d-4d9c-8cf2-da9b6025b00c";

/** Frontmatter property names of the exo__Setting shape. */
export const SETTING_KEY_PROP = "exo__Setting_key";
export const SETTING_VALUE_PROP = "exo__Setting_value";

/**
 * Default vault folder where the one-shot migration materialises Setting
 * assets. Discovery is class-based and location-independent — users may
 * relocate the files anywhere (e.g. into a materialized AssetSpace mount
 * under `assetspaces/<owner>/<repo>/` so ExoSync Phase A syncs them for
 * free); the loader keeps finding them by `exo__Instance_class`.
 */
export const DEFAULT_SETTINGS_FOLDER = "exocortex-settings";

export type VaultSettingDatatype = "boolean" | "string" | "stringList";

export interface VaultSettingDescriptor {
  /** `ExocortexSettings` field name (data.json key). */
  readonly field: string;
  /** `exo__SettingKey` individual asset UID (exoas-exo, D1). */
  readonly keyUid: string;
  /** `exo__SettingKey` label, e.g. `exo__SettingKeyShowArchivedAssets`. */
  readonly keyLabel: string;
  /** Declared value datatype — mirrors `exo__SettingKey_datatype`. */
  readonly datatype: VaultSettingDatatype;
  /**
   * Canonical `exo__Asset_uid` AND basename of the Setting instance.
   * Fixed (not generated at runtime) so independent migrations on two
   * devices/vaults produce byte-identical paths — file-level sync
   * (Obsidian Sync, ExoSync, git) then converges on one file instead of
   * spawning per-device duplicates (advisor F7).
   */
  readonly settingUid: string;
}

export const VAULT_SETTINGS_REGISTRY: readonly VaultSettingDescriptor[] = [
  // ── boolean (19) ──────────────────────────────────────────────────
  {
    field: "layoutVisible",
    keyUid: "db21761d-a3d9-4db6-9bcc-b3fab60557b3",
    keyLabel: "exo__SettingKeyLayoutVisible",
    datatype: "boolean",
    settingUid: "4085fe6e-dba6-4be1-b996-2e23e90b9a0a",
  },
  {
    field: "showArchivedAssets",
    keyUid: "aa14f04c-0fc3-4d93-9f50-ea08e37d583d",
    keyLabel: "exo__SettingKeyShowArchivedAssets",
    datatype: "boolean",
    settingUid: "a6ccb161-b5b7-4660-ad25-685e4afab364",
  },
  {
    field: "showEffortArea",
    keyUid: "ac5ea9fa-06e1-4987-a705-67366dc4b486",
    keyLabel: "exo__SettingKeyShowEffortArea",
    datatype: "boolean",
    settingUid: "ce10ebba-6e8f-431f-8a90-a4c72022857b",
  },
  {
    field: "showEffortVotes",
    keyUid: "ed0ed49a-bd53-4520-979f-ae0dadfd7731",
    keyLabel: "exo__SettingKeyShowEffortVotes",
    datatype: "boolean",
    settingUid: "fc6be572-ba50-4d2b-830e-588b5dcbeb8e",
  },
  {
    field: "showFullDateInEffortTimes",
    keyUid: "23e7cda6-6ec4-4782-80f5-dcfd95e9b49c",
    keyLabel: "exo__SettingKeyShowFullDateInEffortTimes",
    datatype: "boolean",
    settingUid: "a5372600-04f4-4f5a-8e5d-2c18b93e1e97",
  },
  {
    field: "showTimeEstimate",
    keyUid: "22c1d0a8-0c73-423f-bddc-83bac6b0baef",
    keyLabel: "exo__SettingKeyShowTimeEstimate",
    datatype: "boolean",
    settingUid: "a2152041-c7b7-4e46-8c11-86966166ee77",
  },
  {
    field: "showLabelsInTabTitles",
    keyUid: "cb74f759-c1ed-4fcc-bcf3-77656c4ede37",
    keyLabel: "exo__SettingKeyShowLabelsInTabTitles",
    datatype: "boolean",
    settingUid: "9aafe724-6ab7-44ea-8496-16e1afd3990d",
  },
  {
    field: "showLabelsInProperties",
    keyUid: "575f2e31-3c09-40a5-8da6-8e41e05379b2",
    keyLabel: "exo__SettingKeyShowLabelsInProperties",
    datatype: "boolean",
    settingUid: "2a348086-8be4-442e-946e-84f1abe7f612",
  },
  {
    field: "showLabelsInBody",
    keyUid: "0992a51a-b894-4a20-870d-3ec5b6b93d25",
    keyLabel: "exo__SettingKeyShowLabelsInBody",
    datatype: "boolean",
    settingUid: "a36ac50f-661e-450c-81a6-4a9a69bb0b32",
  },
  {
    field: "showLabelsInGraphView",
    keyUid: "89680350-5c36-4bac-ad28-e7875b9b026d",
    keyLabel: "exo__SettingKeyShowLabelsInGraphView",
    datatype: "boolean",
    settingUid: "5e4e4519-ebf9-4724-9f47-2faf8faa8e07",
  },
  {
    field: "showLabelsInLivePreview",
    keyUid: "d18ce074-b428-4082-8993-f29ec4f019d9",
    keyLabel: "exo__SettingKeyShowLabelsInLivePreview",
    datatype: "boolean",
    settingUid: "3e491f6d-ee07-4283-872b-bf56f2fa2ca0",
  },
  {
    field: "autoAdjustPlannedEndTimestamp",
    keyUid: "23ace457-15c5-4d92-aa51-3bbf9247ccdc",
    keyLabel: "exo__SettingKeyAutoAdjustPlannedEndTimestamp",
    datatype: "boolean",
    settingUid: "f2cc1fc1-5dae-49b0-bf72-9dbe345896c6",
  },
  {
    field: "autoReadingModeForExocortexAssets",
    keyUid: "1c73fbe6-f3a0-4022-9e66-ea6e6dc0b148",
    keyLabel: "exo__SettingKeyAutoReadingModeForExocortexAssets",
    datatype: "boolean",
    settingUid: "2c5195c7-94c2-4d10-a694-c44a45513188",
  },
  {
    field: "enableRelationColumnSetResolver",
    keyUid: "626da39d-eda9-4b51-a847-94cc0d78185d",
    keyLabel: "exo__SettingKeyEnableRelationColumnSetResolver",
    datatype: "boolean",
    settingUid: "d33d7369-2ecb-475b-906e-be21d3e2d48c",
  },
  {
    field: "enableExoLayoutRenderer",
    keyUid: "83a97247-135f-4e09-a4a7-60a0c1d8cb7a",
    keyLabel: "exo__SettingKeyEnableExoLayoutRenderer",
    datatype: "boolean",
    settingUid: "ca01b399-09e6-4ad1-94c0-80b96ac98503",
  },
  {
    field: "showIconsInFileExplorer",
    keyUid: "d87f2805-1f3a-4f01-97b4-53df81633e9f",
    keyLabel: "exo__SettingKeyShowIconsInFileExplorer",
    datatype: "boolean",
    settingUid: "fd52049e-cb58-449b-a0d3-a0d9cc2cd986",
  },
  {
    field: "enableSparqlAutoExecute",
    keyUid: "fcd1ecb0-56cf-4d7e-b097-a8db80b90d9f",
    keyLabel: "exo__SettingKeyEnableSparqlAutoExecute",
    datatype: "boolean",
    settingUid: "bdf8a359-30ef-40d2-9ddc-94cdbf81a1e2",
  },
  {
    field: "enableShaclValidation",
    keyUid: "ecea90cb-b0eb-45d3-8ce2-97d7e4f1a793",
    keyLabel: "exo__SettingKeyEnableShaclValidation",
    datatype: "boolean",
    settingUid: "9b00b471-7321-4c49-85cc-2e14367b0617",
  },
  {
    field: "enablePropertiesLabelPatch",
    keyUid: "c9d9cf68-30c6-4543-9c3d-f34cd1f91052",
    keyLabel: "exo__SettingKeyEnablePropertiesLabelPatch",
    datatype: "boolean",
    settingUid: "a054aff7-962e-4dd9-b713-cc852fcbe2a6",
  },
  {
    // #3499 — ExoSync opt-in verbose per-step Notice toggle (default off).
    field: "exosyncStepNotices",
    keyUid: "5021effa-3a68-49fb-a6ae-48fdb9b2f4ab",
    keyLabel: "exo__SettingKeyExosyncStepNotices",
    datatype: "boolean",
    settingUid: "93440232-6683-405e-8e9d-d832fef16f6c",
  },
  // ── string (2) ────────────────────────────────────────────────────
  {
    // @deprecated in ExocortexSettings but still a live data.json field;
    // D1 grounded its SettingKey deliberately — kept for 1:1 mirroring.
    field: "displayNameTemplate",
    keyUid: "30ec5489-364d-43f9-ba0a-e63be10f18ad",
    keyLabel: "exo__SettingKeyDisplayNameTemplate",
    datatype: "string",
    settingUid: "33c8270e-4ba0-4e67-b6f1-ad31493d6387",
  },
  {
    field: "exosyncQuarantineRepoUrl",
    keyUid: "4657ef5e-bf12-486b-a114-3c5236a91d89",
    keyLabel: "exo__SettingKeyExosyncQuarantineRepoUrl",
    datatype: "string",
    settingUid: "23a3b26c-0dd1-4a89-a251-7c0470cd7c21",
  },
  // ── stringList (2) ────────────────────────────────────────────────
  {
    field: "excludedFolders",
    keyUid: "4ab4ae78-a248-4e50-b5de-bfd420e39570",
    keyLabel: "exo__SettingKeyExcludedFolders",
    datatype: "stringList",
    settingUid: "43282d2c-a936-48f3-b62c-9e7384fe3909",
  },
  {
    field: "lazyBootstrapFolders",
    keyUid: "8f4a0dc8-dbc3-4961-af0b-7c38f660d3d6",
    keyLabel: "exo__SettingKeyLazyBootstrapFolders",
    datatype: "stringList",
    settingUid: "4a540d00-ac1b-485f-86cb-14426c134292",
  },
];

/**
 * Fields that must NEVER be homoiconized (onto-RFC R2 denylist, D24/D26).
 * Exported for the 0-leakage unit test — the registry above is the
 * mechanism (allowlist); this list documents the intent and lets the test
 * assert the two sets stay disjoint.
 */
export const NON_HOMOICONIZABLE_FIELDS: readonly string[] = [
  "activeProfileUid", // per-device (data.local.json, Issue #3327)
  "_switchInProgress", // per-device crash-recovery flag (data.local.json)
  "pat", // secret (LocalSecretsStore) — never even in data.json
  "displayNameSettings", // structural (nested object) — deferred (D26)
  "logChannels", // structural (nested object) — deferred (D26)
];

const byField = new Map(VAULT_SETTINGS_REGISTRY.map((d) => [d.field, d]));
const byKeyUid = new Map(VAULT_SETTINGS_REGISTRY.map((d) => [d.keyUid, d]));
const byKeyLabel = new Map(
  VAULT_SETTINGS_REGISTRY.map((d) => [d.keyLabel, d]),
);

export function descriptorByField(
  field: string,
): VaultSettingDescriptor | undefined {
  return byField.get(field);
}

/**
 * Resolve a descriptor from the raw `exo__Setting_key` frontmatter value.
 * Accepts UID-form wikilinks (`[[<keyUid>]]`, `[[<keyUid>|alias]]`) and
 * label-form (`[[exo__SettingKeyShowArchivedAssets]]`) for hand-authored
 * assets. Returns undefined for unknown keys (caller warn-logs — R3).
 */
export function descriptorByKeyRef(
  raw: unknown,
): VaultSettingDescriptor | undefined {
  if (typeof raw !== "string") return undefined;
  const inner = raw.replace(/^\s*\[\[/, "").replace(/\]\]\s*$/, "");
  const target = inner.split("|")[0].split("#")[0].trim();
  return byKeyUid.get(target) ?? byKeyLabel.get(target);
}
