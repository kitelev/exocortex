import { KNOWN_CHECK_IDS } from "./checkIds";
import { extractAssetReference } from "../../utilities/extractAssetReference";
import type { VaultAssetRecord } from "./types";

/**
 * Read the enabled validation-check set — the DATA half of the Homoiconicity
 * Invariant (RFC f402002b): WHICH checks `Validate vault` runs is configured by
 * validation-check `setting__Setting` instances (created by `scaffold
 * validation-settings`), NOT by code.
 *
 * A check-Setting carries `setting__Setting_key` (a wikilink → a check-key UID
 * that is also the check-id) and `setting__Setting_value` (boolean). This
 * returns the check-ids whose value is truthy. Only KNOWN check-ids count, so
 * unrelated `setting__Setting` instances never leak in.
 *
 * Shared by both readers (CLI fs-walk + plugin warm metadataCache) so the
 * enabled-set semantics — an integrity-relevant decision — have a single home
 * (M1.5; the CLI command and the plugin `Validate vault` command both call it).
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
