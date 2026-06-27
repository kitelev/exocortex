/**
 * Distribution-ontology meta-setting reader (RFC f402002b, M2.2 — §5).
 *
 * WHERE a domain distributes its settings (the target AssetSpace) is itself
 * user-configurable semantics → per the Homoiconicity Invariant it lives in the
 * graph as a `setting__Setting` meta-instance on the floor-anchored `$setting`
 * ontology, NOT as a TS-hardcoded ontology UID. This module is the **code half**
 * (Q3 exc.1): a pure reader over warm floor setting-assets.
 *
 * It is DISTINCT from the non-homoiconic master switch
 * `settingsHomoiconizationEnabled` (which is on/off): this records a *target*.
 *
 * No I/O, no platform deps (Desktop↔Mobile parity) — the caller supplies the
 * warm setting-assets it read from `metadataCache` / fs.
 */
import { coerceSettingValue, extractKeyRef, readSettingValueRaw } from "./settingAsset";
import type { ImportableSettingAsset } from "./types";

/**
 * UID of the `setting__SettingKeyExocortexDistributionOntology` floor meta key
 * (datatype `string`, on the `$setting` floor `34872f64-…`). The
 * `setting__Setting` meta-instance carrying this key holds the opaque AssetSpace
 * UID the Exocortex domain distributes into.
 */
export const EXOCORTEX_DISTRIBUTION_ONTOLOGY_KEY_UID =
  "ea44f996-64e5-46ce-8953-b13d21ee750d";

/**
 * Resolve the recorded distribution-ontology target (an opaque AssetSpace UID)
 * from the floor `setting__Setting` meta-instance whose `setting__Setting_key`
 * matches `keyUid` (by UID).
 *
 * Returns the recorded UID (trimmed), or `null` when no meta-setting is present
 * or its value is blank — default-on-absence is the **location-convention**
 * (the caller picks the target), NEVER a code-hardcoded ontology UID.
 *
 * Dual-read: canonical `setting__Setting_key` / `setting__Setting_value` first,
 * then the legacy `exo__Setting_*` fallback (so a legacy-authored meta-setting
 * still resolves). The value is coerced as a `string` (the meta key's declared
 * datatype). The first non-blank match (in `assets` order) wins.
 */
export function resolveDistributionOntology(
  assets: readonly ImportableSettingAsset[],
  keyUid: string,
): string | null {
  for (const asset of assets) {
    if (extractKeyRef(asset.frontmatter) !== keyUid) continue;
    const value = coerceSettingValue(
      "string",
      readSettingValueRaw(asset.frontmatter),
    );
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}
