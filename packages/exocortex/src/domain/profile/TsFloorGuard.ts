/**
 * TS-floor guard (Vision Lock #17, RFC 01a83de8 §3.4 / EV8) — the single named
 * home for the always-mounted AssetSpace floor and its R24 self-brick guard.
 *
 * **floor = {exo}** (RFC 5aa2a73a): the Exocortex core is a knowledge engine
 * (`exo` ontology + SPARQL); reading knowledge needs nothing else. Both tiers
 * collapse to `{exo}`:
 *
 *   - {@link SDK_FLOOR_ASSETSPACE_UIDS} — `{exo}`. The minimal always-mounted set
 *     for any vault (engine / CLI / plugin).
 *   - {@link PLUGIN_UI_FLOOR_ASSETSPACE_UIDS} — also `{exo}`. `exocmd` (UI
 *     commands) and `shared-identities` (cross-cutting anchors) are OPTIONAL,
 *     not floor: a read-only/SPARQL-only vault works without them (no buttons,
 *     no crash). Cross-cutting TBox is relocated to home ontologies, so
 *     shared-identities is no longer load-bearing for the floor.
 *
 * The exocmd / shared-identities AssetSpace UID constants remain exported
 * (declarations, tests, relocation logic) but are no longer floor members.
 *
 * EV8 mandate: this is the ONE named guard all profile-switch sites (plugin
 * {@link FocusProfileSwitchManager}, CLI {@link CliHardSwitchService} +
 * {@link CliFocusProfileResolver}) delegate to. The previous copy-pasted inline
 * guards drifted independently; consolidating here removes that drift surface.
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

/**
 * SDK/engine floor — `{$exo}`. The minimal always-mounted set for any vault
 * (headless engine / CLI / plugin). shared-identities + exocmd are NOT floor
 * members (RFC 5aa2a73a floor={exo}) — both are optional AssetSpaces.
 */
export const SDK_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
]);

/**
 * Plugin-UI floor — just `$exo`. SPIKE (floor={exo}): shared-identities and
 * exocmd removed from the floor. exocmd is an OPTIONAL UI-command library — a
 * read-only/SPARQL-only vault works without it (no buttons, no crash);
 * cross-cutting TBox is relocated to home ontologies, so shared-identities is
 * no longer load-bearing for the floor.
 */
export const PLUGIN_UI_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
]);

/**
 * Thrown by {@link assertTsFloor} when a target profile's declared AssetSpace
 * set omits a floor AssetSpace. Distinguishable by `name` so callers (palette
 * command, CLI hard-switch command) can surface a clear refusal without any
 * filesystem mutation having occurred.
 *
 * NOTE: there is exactly ONE such class (this one). Plugin and CLI re-export it
 * so `e instanceof TsFloorViolationError` works regardless of which package the
 * caller imported the symbol from — a single class identity across packages.
 */
export class TsFloorViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TsFloorViolationError";
  }
}

/**
 * R24 TS-floor guard (EV8 single named site). The target profile's *declared*
 * AssetSpace set (pre-floor) must contain every UID in `floor`, otherwise a
 * destructive profile switch would tear a floor AssetSpace down and brick the
 * runtime. Callers pass {@link SDK_FLOOR_ASSETSPACE_UIDS} (CLI/headless) or
 * {@link PLUGIN_UI_FLOOR_ASSETSPACE_UIDS} (plugin).
 *
 * @throws {TsFloorViolationError} if any UID in `floor` is absent from
 *   `declaredAsUids`.
 */
export function assertTsFloor(
  declaredAsUids: ReadonlySet<string>,
  floor: ReadonlySet<string>,
): void {
  const missing: string[] = [];
  for (const f of floor) {
    if (!declaredAsUids.has(f)) missing.push(f);
  }
  if (missing.length > 0) {
    throw new TsFloorViolationError(
      `Target profile's declared set excludes TS-floor AssetSpace UID(s): ${missing.join(
        ", ",
      )}. Profile switch aborted to prevent runtime self-brick (R24).`,
    );
  }
}
