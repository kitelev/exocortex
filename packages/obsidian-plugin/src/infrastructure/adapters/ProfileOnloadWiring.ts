/**
 * TS-floor AssetSpace UIDs (Vision Lock #17) — the AssetSpaces that are ALWAYS
 * part of any profile's effective set, regardless of profile config. The
 * mount-state hard/REST switch (`ProfileApplyManager`) injects these so
 * the plugin's own TBox foundations can never be torn down by a profile that
 * omits them.
 *
 * RFC 01a83de8 Phase 3 (T3b) — the query-time soft-filter onload wiring was
 * removed; profile scoping is now mount-state based.
 *
 * RFC 01a83de8 §3.4 / EV8 (issue #3426) re-homed the floor to a single named
 * guard in `exocortex`
 * ({@link ../../../../../exocortex/src/domain/profile/TsFloorGuard}). RFC
 * 5aa2a73a (#3440) then collapsed the floor to **`{exo}`** for both tiers: the
 * plugin-UI floor is now just `$exo`. `exocmd` (the vault-side UI commands the
 * plugin renders) and `shared-identities` are OPTIONAL — a profile may omit
 * them without self-bricking. The constants below re-export the core guard so
 * existing plugin imports keep working.
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
 * The plugin uses the **plugin-UI floor** = `{exo}` (RFC 5aa2a73a / #3440).
 * `exocmd` and `shared-identities` are optional; only `$exo` is load-bearing,
 * so the engine never self-bricks while UI commands stay opt-in.
 */
export const TS_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> =
  PLUGIN_UI_FLOOR_ASSETSPACE_UIDS;
