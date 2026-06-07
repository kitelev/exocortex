/**
 * TS-floor guard (Vision Lock #17, RFC 01a83de8 §3.4 / EV8) — the single named
 * home for the always-mounted AssetSpace floor and its R24 self-brick guard.
 *
 * RFC 01a83de8 v10 rejects Alternative G ("exocmd in the SDK floor") and draws a
 * Maven-style distinction: `exo` is the SDK; `exocmd` is an OPTIONAL UI-command
 * library. The floor therefore splits into two tiers:
 *
 *   - {@link SDK_FLOOR_ASSETSPACE_UIDS} — `exo` + `shared-identities`. Mounted by
 *     the headless engine + CLI, and (as a subset) by the Obsidian plugin. A
 *     bare-bones SDK vault is a first-class configuration with NO exocmd.
 *   - {@link PLUGIN_UI_FLOOR_ASSETSPACE_UIDS} — SDK floor + `exocmd`. Mounted ONLY
 *     by the Obsidian plugin, because exocmd provides the vault-side UI commands
 *     that the plugin renders; tearing it down would self-brick the UI.
 *
 * EV8 mandate: this is the ONE named guard all profile-switch sites (plugin
 * {@link ProfileApplyManager}, CLI {@link CliApplyProfileService} +
 * {@link CliProfileResolver}) delegate to. The previous copy-pasted inline
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
 * SDK/engine floor — `$exo` + `$shared-identities`. The minimal always-mounted
 * set for a headless engine / CLI vault. Does NOT include exocmd (RFC 01a83de8
 * alt-G rejection): a bare SDK vault operates without the UI-command library.
 */
export const SDK_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
]);

/**
 * Plugin-UI floor — SDK floor + `$exocmd`. The Obsidian plugin always mounts
 * exocmd because it provides the vault-side UI commands the plugin renders;
 * excluding it would self-brick the UI (R24).
 */
export const PLUGIN_UI_FLOOR_ASSETSPACE_UIDS: ReadonlySet<string> = new Set([
  TS_FLOOR_AS_UID_EXO,
  TS_FLOOR_AS_UID_SHARED_IDENTITIES,
  TS_FLOOR_AS_UID_EXOCMD,
]);

/**
 * Thrown by {@link assertTsFloor} when a target profile's declared AssetSpace
 * set omits a floor AssetSpace. Distinguishable by `name` so callers (palette
 * command, CLI apply-profile command) can surface a clear refusal without any
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
