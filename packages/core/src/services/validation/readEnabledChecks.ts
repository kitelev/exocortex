import type { VaultAssetRecord } from "./types";
import { KNOWN_CHECK_IDS } from "./checkIds";
import { extractAssetReference } from "../../utilities/extractAssetReference";

/**
 * Read the enabled validation-check set (RFC f402002b, M1.5) — the DATA half of
 * the Homoiconicity Invariant: WHICH checks run is configured by
 * validation-check `setting__Setting` instances in the vault (created by
 * `Scaffold validation settings`), not by code.
 *
 * A check-Setting instance carries `setting__Setting_key` (a wikilink to one of
 * the 4 validation-check `setting__SettingKey` individuals — its UID is the
 * check-id) and `setting__Setting_value` (a boolean). This returns the check-ids
 * whose value is truthy (enabled). Only keys that are KNOWN check-ids are
 * considered, so unrelated `setting__Setting` instances (e.g. future
 * obsidian/obsplugin settings) never leak into the validation enabled-set.
 *
 * Pure over the warm one-pass asset array; never re-reads files.
 */
export function readEnabledCheckIds(
  assets: readonly VaultAssetRecord[],
): string[] {
  const enabled = new Set<string>();
  for (const a of assets) {
    const keyRef = extractAssetReference(a.frontmatter["setting__Setting_key"]);
    if (!keyRef || !KNOWN_CHECK_IDS.has(keyRef)) continue;
    const value = a.frontmatter["setting__Setting_value"];
    if (value === true || value === "true") enabled.add(keyRef);
  }
  return [...enabled];
}
