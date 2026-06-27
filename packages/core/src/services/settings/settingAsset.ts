/**
 * Pure helpers for the Settings Distribution engine (RFC f402002b, M2.1):
 * datatype coercion, frontmatter key/value extraction (dual-read), and the
 * `setting__Setting` asset template. No I/O, no platform deps — unit-testable.
 */
import { extractAssetReference } from "../../utilities/extractAssetReference";
import type { SettingDatatype, SettingKeySpec } from "./types";

/**
 * Canonical generic predicates of the `setting__Setting` superclass
 * (RFC f402002b, M1.1 — `$setting` floor ontology). Subclasses
 * (`exo__Setting` / `obsidian__Setting` / `obsplugin__Setting`) inherit them;
 * the engine writes these (predicate unification).
 */
export const SETTING_KEY_PROP = "setting__Setting_key";
export const SETTING_VALUE_PROP = "setting__Setting_value";

/**
 * Legacy subclass-specific predicates (pre-unification `exo__Setting`, used by
 * the live-mirror `VaultSettingsStore`). Read-only fallback so the engine can
 * import assets authored by the legacy live-mirror (dual-read; RFC sec §4/§6).
 */
export const LEGACY_SETTING_KEY_PROPS: readonly string[] = ["exo__Setting_key"];
export const LEGACY_SETTING_VALUE_PROPS: readonly string[] = [
  "exo__Setting_value",
];

/**
 * Tolerant datatype coercion (mirrors `VaultSettingsStore.coerce`, F9).
 * Returns `undefined` when the raw value cannot be coerced — the caller
 * SKIPS such assets (never writes a default over a hand-edited value).
 */
export function coerceSettingValue(
  datatype: SettingDatatype,
  raw: unknown,
): unknown {
  switch (datatype) {
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") {
        const s = raw.trim().toLowerCase();
        if (s === "true") return true;
        if (s === "false") return false;
      }
      return undefined;
    }
    case "string": {
      if (typeof raw === "string") return raw;
      if (typeof raw === "number") return String(raw);
      return undefined;
    }
    case "stringList": {
      if (Array.isArray(raw)) {
        const strs = raw.filter((e): e is string => typeof e === "string");
        // Skip (return undefined) if ANY element was dropped — a partial/
        // non-string array must not silently wipe a live list to a shorter
        // (or empty) one. A legitimately empty `[]` round-trips fine.
        return strs.length === raw.length ? strs : undefined;
      }
      if (typeof raw === "string") return [raw]; // scalar → 1-elem list
      return undefined;
    }
  }
}

/** Strip a trailing `#anchor` (key-refs never carry one, but be defensive). */
function stripAnchor(ref: string): string {
  const hashIdx = ref.indexOf("#");
  return hashIdx === -1 ? ref : ref.slice(0, hashIdx).trim();
}

/**
 * Bare key-ref (uid or label) from a setting asset's frontmatter — the
 * canonical `setting__Setting_key` first, then the legacy `exo__Setting_key`
 * fallback (dual-read). Returns null when neither resolves.
 */
export function extractKeyRef(
  fm: Readonly<Record<string, unknown>>,
): string | null {
  const canonical = extractAssetReference(fm[SETTING_KEY_PROP]);
  if (canonical) return stripAnchor(canonical);
  for (const prop of LEGACY_SETTING_KEY_PROPS) {
    const legacy = extractAssetReference(fm[prop]);
    if (legacy) return stripAnchor(legacy);
  }
  return null;
}

/**
 * Raw value from a setting asset's frontmatter — canonical
 * `setting__Setting_value` first, then the legacy `exo__Setting_value`
 * fallback (dual-read). Returns undefined when no value property is present.
 */
export function readSettingValueRaw(
  fm: Readonly<Record<string, unknown>>,
): unknown {
  if (SETTING_VALUE_PROP in fm) return fm[SETTING_VALUE_PROP];
  for (const prop of LEGACY_SETTING_VALUE_PROPS) {
    if (prop in fm) return fm[prop];
  }
  return undefined;
}

/** Datatype-aware YAML lines for the `setting__Setting_value` property. */
function renderValueYaml(datatype: SettingDatatype, value: unknown): string[] {
  switch (datatype) {
    case "boolean":
      return [`${SETTING_VALUE_PROP}: ${value === true ? "true" : "false"}`];
    case "string":
      return [`${SETTING_VALUE_PROP}: ${JSON.stringify(String(value ?? ""))}`];
    case "stringList": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      if (list.length === 0) return [`${SETTING_VALUE_PROP}: []`];
      return [
        `${SETTING_VALUE_PROP}:`,
        ...list.map((e) => `  - ${JSON.stringify(e)}`),
      ];
    }
  }
}

/**
 * Render one `setting__Setting` asset (full markdown). Typed with the source's
 * `classUid`, co-located under `ontologyUid` (`exo__Asset_isDefinedBy`), key
 * `[[<keyUid>]]`, value rendered per declared datatype. Deterministic given a
 * fixed `createdAtIso` (template parity with `ValidationScaffolder`).
 */
export function renderSettingAssetMarkdown(
  spec: SettingKeySpec,
  value: unknown,
  classUid: string,
  ontologyUid: string,
  createdAtIso: string,
): string {
  return [
    "---",
    `exo__Asset_uid: ${spec.settingUid}`,
    `exo__Asset_isDefinedBy: "[[${ontologyUid}]]"`,
    `exo__Asset_createdAt: ${createdAtIso}`,
    "exo__Instance_class:",
    `  - "[[${classUid}]]"`,
    `exo__Asset_label: "Setting: ${spec.field}"`,
    `${SETTING_KEY_PROP}: "[[${spec.keyUid}]]"`,
    ...renderValueYaml(spec.datatype, value),
    "---",
    "",
    `Distributable Exocortex setting \`${spec.field}\` (${spec.datatype}), ` +
      "exported by the Settings Distribution engine (RFC f402002b, M2). " +
      "Edit `setting__Setting_value` here or re-export to overwrite.",
    "",
  ].join("\n");
}
