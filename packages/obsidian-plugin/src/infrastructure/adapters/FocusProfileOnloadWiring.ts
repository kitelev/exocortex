/**
 * TS-floor AssetSpace UIDs (Vision Lock #17) — the AssetSpaces that are ALWAYS
 * part of any profile's effective set, regardless of profile config. The
 * mount-state hard/REST switch (`FocusProfileSwitchManager`) injects these so
 * the plugin's own TBox foundations (`$exo`, `$exocmd`, `$shared-identities`)
 * can never be torn down by a profile that omits them.
 *
 * RFC 01a83de8 Phase 3 (T3b) — the query-time soft-filter onload wiring
 * (`applyActiveProfileFilter` + the Ontology→AssetSpace translation it relied
 * on) was removed; profile scoping is now mount-state based. Only these floor
 * constants survive, consumed by the hard/REST switch effective-set derivation.
 */

/** AssetSpace UID of `$exo` (per `assetspaces/exo/49fd2e56-...md`). */
export const TS_FLOOR_AS_UID_EXO = "49fd2e56-4656-4ca7-a789-f472b16ea260";
/** AssetSpace UID of `$exocmd` (per `assetspaces/exocmd/c9c65b0f-...md`). */
export const TS_FLOOR_AS_UID_EXOCMD = "c9c65b0f-1e01-47c1-a1f9-1bf70b11df6a";
/**
 * AssetSpace UID of `$shared-identities` (per
 * `assetspaces/shared-identities/0cde1557-...md`). Container for cross-cutting
 * Ontology anchors (`$shared-identities`, `$kitelev`, ...) — its TBox must
 * remain reachable to keep the UID-canon resolver functioning.
 */
export const TS_FLOOR_AS_UID_SHARED_IDENTITIES =
  "0cde1557-6320-4bd0-a7c4-8b72afc38720";

/** TS-floor AssetSpace UIDs (Vision Lock #17, AS-UID level). */
export const TS_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_EXOCMD,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
]);
