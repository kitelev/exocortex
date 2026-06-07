/**
 * TS-floor AssetSpace UIDs (Vision Lock #17) — the AssetSpaces that are ALWAYS
 * part of any profile's effective set, regardless of profile config. The
 * mount-state hard/REST switch (`FocusProfileSwitchManager`) injects these so
 * the plugin's own TBox foundations can never be torn down by a profile that
 * omits them.
 *
 * RFC 01a83de8 Phase 3 (T3b) — the query-time soft-filter onload wiring was
 * removed; profile scoping is now mount-state based.
 *
 * RFC 01a83de8 §3.4 / EV8 (issue #3426) — the floor was split into two tiers
 * and re-homed to a single named guard in `exocortex`
 * ({@link ../../../../../exocortex/src/domain/profile/TsFloorGuard}). The plugin
 * mounts the **plugin-UI floor** (SDK floor + `$exocmd`), because exocmd
 * provides the vault-side UI commands the plugin renders. The constants below
 * re-export the core guard so existing plugin imports keep working.
 */

import { PLUGIN_UI_FLOOR_ASSETSPACE_UIDS } from "exocortex";

export {
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS,
} from "exocortex";

/**
 * TS-floor AssetSpace UIDs the plugin enforces (Vision Lock #17, AS-UID level).
 * The plugin uses the **plugin-UI floor** — SDK floor (`$exo` +
 * `$shared-identities`) plus `$exocmd` — so the UI commands never self-brick.
 */
export const TS_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> =
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS;
