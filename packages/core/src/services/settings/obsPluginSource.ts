/**
 * `obsplugin__Setting` export source (RFC f402002b, M4.1) — a community-plugin
 * {@link SettingsSource} over an already-parsed plugin `data.json`.
 *
 * M4 distributes OTHER community plugins' settings (pilot: Periodic Notes) the
 * same way M2 distributes Exocortex's own: the generic
 * {@link SettingsDistributionEngine} (`exportSettings`) snapshots a domain's
 * DECLARED keys into `obsplugin__Setting` assets. The only domain-specific part
 * is this source — it maps each declared key's `field` (a dot-path into the
 * plugin's nested config object, e.g. `daily.folder`) to the live value.
 *
 * Allowlist-by-construction (RFC sec F1): `declaredKeys()` is a fixed list; the
 * engine never enumerates the live keyspace, so an undeclared plugin field can
 * never leak into an export — regardless of what extra keys `data.json` carries.
 *
 * Code-registry binding (Q3 exc.1 — core processing, consistent with M2's
 * `VAULT_SETTINGS_REGISTRY`): the field↔keyUid table is a TS constant; the
 * `obsplugin__SettingKey` individuals declare the *schema* (datatype) in the
 * graph (homoiconic). A future enhancement (RFC §7 MED) could move the
 * dot-path accessor itself into the RDF SettingKey individual — that would apply
 * to every source uniformly (engine-level), out of M4.1's export-pilot scope.
 *
 * Pure — no `obsidian` / Node deps (Desktop↔Mobile parity): the parsed config
 * is injected by the caller, which read `data.json` via `vault.adapter`.
 */
import type { SettingKeySpec, SettingsSource } from "./types";

/** `obsplugin__Setting` class UID (`$setting` floor ontology, exoas-exo, M4). */
export const OBSPLUGIN_SETTING_CLASS_UID =
  "01a9c996-fc2e-4e70-a22d-e6554d746c5f";

/**
 * Resolve a dot-path (e.g. `daily.folder`) against a parsed JSON config object.
 * Returns `undefined` when any segment is missing or a non-object is traversed.
 * Reads OWN properties only — a `__proto__`/`constructor`/inherited segment
 * yields `undefined` (no prototype-chain read), future-proofing the util now
 * that it is exported from `@kitelev/exocortex-core`. Pure — the accessor for a
 * {@link SettingKeySpec} whose `field` is a JSON path.
 */
export function resolveConfigPath(config: unknown, path: string): unknown {
  let cur: unknown = config;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * A generic {@link SettingsSource} over an already-parsed plugin config object,
 * where each declared key's `field` is a dot-path into that object. Export-only
 * for M4.1 — Import ({@link writeLiveValue}) is M4.2 (OUT OF SCOPE) and rejects.
 */
export class JsonConfigSettingsSource implements SettingsSource {
  constructor(
    readonly settingClassUid: string,
    private readonly keys: readonly SettingKeySpec[],
    private readonly config: unknown,
  ) {}

  declaredKeys(): readonly SettingKeySpec[] {
    return this.keys;
  }

  readLiveValue(key: SettingKeySpec): unknown {
    return resolveConfigPath(this.config, key.field);
  }

  writeLiveValue(): Promise<void> {
    return Promise.reject(
      new Error(
        "obsplugin settings Import is not implemented in M4.1 (export-only) — see M4.2.",
      ),
    );
  }
}

/** Periodic Notes community plugin id (folder under `.obsidian/plugins/`). */
export const PERIODIC_NOTES_PLUGIN_ID = "periodic-notes";

/** Vault-relative path to the Periodic Notes `data.json` (read via vault.adapter). */
export const PERIODIC_NOTES_DATA_PATH = `.obsidian/plugins/${PERIODIC_NOTES_PLUGIN_ID}/data.json`;

/**
 * The Periodic Notes Daily-Notes distributable keys (the export allowlist, M4.1
 * pilot). Each `field` is a dot-path into Periodic Notes' `data.json`; `keyUid`
 * → an `obsplugin__SettingKey` individual; `settingUid` → the deterministic
 * `obsplugin__Setting` asset (fixed so independent exports on two devices
 * produce byte-identical paths — sync converges instead of duplicating).
 */
export const PERIODIC_NOTES_DECLARED_KEYS: readonly SettingKeySpec[] = [
  {
    field: "daily.folder",
    keyUid: "6ba6a073-3ee9-4527-8958-34596e072a31",
    keyLabel: "obsplugin__SettingKeyPeriodicNotesDailyFolder",
    datatype: "string",
    settingUid: "2bb137e5-b2c7-4fc8-b234-60639de674a9",
  },
  {
    field: "daily.format",
    keyUid: "a8d5f2b9-ba43-49d1-a469-00d5461b7d7a",
    keyLabel: "obsplugin__SettingKeyPeriodicNotesDailyFormat",
    datatype: "string",
    settingUid: "6ed5cfdf-551b-49bc-a467-56756b822da5",
  },
  {
    field: "daily.template",
    keyUid: "524d639d-4c63-4c73-a9c5-cca2c057a380",
    keyLabel: "obsplugin__SettingKeyPeriodicNotesDailyTemplate",
    datatype: "string",
    settingUid: "5430a6c5-6be5-483e-bb94-d740d6dd2541",
  },
  {
    field: "daily.enabled",
    keyUid: "7314ec27-e1ec-4987-8101-76273d0a789f",
    keyLabel: "obsplugin__SettingKeyPeriodicNotesDailyEnabled",
    datatype: "boolean",
    settingUid: "411646dd-1a87-40d8-853d-01c37af7fb2c",
  },
];

/**
 * Build the M4.1 export {@link SettingsSource} for Periodic Notes from its
 * already-parsed `data.json`. Exported assets are typed `obsplugin__Setting`;
 * only {@link PERIODIC_NOTES_DECLARED_KEYS} are ever read (allowlist).
 */
export function buildPeriodicNotesSource(parsedConfig: unknown): SettingsSource {
  return new JsonConfigSettingsSource(
    OBSPLUGIN_SETTING_CLASS_UID,
    PERIODIC_NOTES_DECLARED_KEYS,
    parsedConfig,
  );
}
