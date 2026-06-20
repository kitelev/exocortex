/**
 * First-run onboarding logic — RFC 0002 §3.1 ([P1, P2]).
 *
 * Pure (no `obsidian` runtime import) so the first-run detection predicate, the
 * canonical starter-path constants, and the `Setup` command registration
 * contract are all unit-testable with plain objects. The Obsidian-facing panel
 * lives in `presentation/modals/FirstRunOnboardingModal`; the wiring lives in
 * `ExocortexPlugin.registerProfileCommands`.
 */

import type { VaultBootstrapState } from "./BootstrapAssetSpaceCommands";

/**
 * The EKA AssetSpace **registry** (`kitelev/exoas-registry`) — the catalog of
 * `exo__AssetSpace` descriptors + their `dependsOn` DAG (EKA D18). Pre-filled
 * into the "Add the AssetSpace registry" onboarding step. Adding it lands every
 * descriptor in the vault so a later "Apply profile" can resolve a chosen
 * profile's `dependsOn` closure (the descriptors carry the `_source` URLs the
 * apply step materialises from). Public — pulls anonymously; the PAT (step 1) is
 * only needed for the *private* leaf AssetSpaces a chosen profile pulls
 * (RFC 0002 §3.1 / EKA D12 bootstrap: bootstrap exo → add registry → add
 * profiles → apply profile).
 */
export const REGISTRY_ASSETSPACE_URL =
  "https://github.com/kitelev/exoas-registry";

/**
 * The EKA **profiles** AssetSpace (`kitelev/exoas-profiles`) — the
 * `exo__Profile` instances. Pre-filled into the "Add the profiles AssetSpace"
 * onboarding step. Adding it lands the profile assets in the vault so the final
 * "Apply profile" step can list + pick one (the picker shows every profile in
 * the vault). Public — pulls anonymously.
 */
export const PROFILES_ASSETSPACE_URL =
  "https://github.com/kitelev/exoas-profiles";

/**
 * The most markdown notes a vault may hold and still count as a genuinely
 * *fresh* first-run vault. The canonical fresh-tester flow (RFC 0002 §1)
 * installs the plugin into a brand-new / empty vault; modern Obsidian seeds at
 * most a single stock `Welcome.md`, so `<= 1` covers "empty" and "only the
 * stock welcome note". Anything above that is an established vault, even if it
 * has no `assetspaces/` yet.
 */
export const FRESH_VAULT_MAX_NOTES = 1;

/**
 * First-run detection (RFC 0002 §3.1 [P1, P2]). The panel **auto-shows** on
 * plugin enable only for a genuinely fresh, not-yet-bootstrapped vault that the
 * user has not already dismissed onboarding on (this device).
 *
 * Three gates, all must pass to auto-show:
 *   1. `onboardingCompleted` is false — the device-local one-time flag persisted
 *      by the panel on close ({@link PluginLocalDataStore.getOnboardingCompleted}).
 *   2. `vaultState !== "bootstrapped"` — from
 *      {@link BootstrapAssetSpaceCommands.detectVaultState} (cross-platform,
 *      `vault.adapter`-based → identical on mobile, satisfying Desktop↔Mobile
 *      Command Parity). Both `empty` and `clone-needs-fetch` are pre-value states
 *      that still need the guided path.
 *   3. `markdownFileCount <= FRESH_VAULT_MAX_NOTES` — the vault is genuinely
 *      fresh. `detectVaultState` reports "empty" for ANY vault lacking
 *      `assetspaces/` (including an established 100-note vault that simply uses a
 *      non-bootstrap layout), so this guard prevents a false-positive auto-show
 *      over a user's existing content. Anyone this skips can still open the panel
 *      via the always-available `Setup` command (the re-entry point).
 */
export function shouldShowFirstRunPanel(
  vaultState: VaultBootstrapState,
  onboardingCompleted: boolean,
  markdownFileCount: number,
): boolean {
  if (onboardingCompleted) return false;
  if (vaultState === "bootstrapped") return false;
  return markdownFileCount <= FRESH_VAULT_MAX_NOTES;
}

/**
 * Canonical device-local secret key for the GitHub PAT (Issue #3320 §1).
 *
 * The same literal `"pat"` is read at command-execution time by the bootstrap /
 * add-assetspace / apply-profile materialise paths (ApplyDepsFactory,
 * SyncDepsFactory, ExoSyncParityFactory) and written by the Settings PAT field
 * (`ExocortexSettingTab`). The Welcome panel's PAT step (cd9444bd) MUST write
 * under this exact key so a token entered first-thing in onboarding is the same
 * token those later steps read — mismatching it would silently break private
 * `exoas-*` repo clone/pull. Kept as a named constant here so the onboarding
 * save path can reuse it without re-typing the magic string.
 */
export const PAT_SECRET_KEY = "pat";

/**
 * Structural slice of {@link LocalSecretsStore} — keeps this module free of an
 * `obsidian` runtime import (unit-testable with a plain fake), mirroring
 * {@link OnboardingCommandRegistrar}. The real `LocalSecretsStore.setSecret`
 * satisfies this shape (passing `null`/`""` clears the entry).
 */
export interface OnboardingSecretsStore {
  setSecret(key: string, value: string | null): Promise<void>;
}

/**
 * Persist the PAT entered in the Welcome panel's first (optional) step,
 * device-local, BEFORE the bootstrap / add / apply steps run — so those steps
 * (which read {@link PAT_SECRET_KEY} fresh at command-execution time, NOT at
 * onload — Issue #3382) can authenticate private-repo clone/pull.
 *
 * Semantics mirror the Settings "Save PAT" button exactly so the two entry
 * points never diverge:
 *   - the raw token is trimmed (tokens are single-line opaque strings; copying
 *     one often drags a trailing newline);
 *   - an empty / all-whitespace value CLEARS the stored token (passes `null`),
 *     never persists empty-PAT junk — this is the "skip" path: a public-only
 *     tester who leaves the field blank and clicks through ends up with no PAT,
 *     and the materialise steps tolerate an absent PAT (public repos pull
 *     anonymously).
 */
export async function persistOnboardingPat(
  store: OnboardingSecretsStore,
  rawPat: string,
): Promise<void> {
  const trimmed = rawPat.trim();
  await store.setSecret(PAT_SECRET_KEY, trimmed.length > 0 ? trimmed : null);
}

/** Stable command id for the guided Setup entry point (RFC 0002 §3.2). */
export const SETUP_COMMAND_ID = "setup-getting-started";

/**
 * Structural slice of Obsidian's `Plugin.addCommand` — keeps this module free
 * of an `obsidian` runtime import (unit-testable with a plain object), mirroring
 * {@link ExoSyncCommandRegistrar}.
 */
export interface OnboardingCommandRegistrar {
  addCommand(command: {
    id: string;
    name: string;
    callback: () => void;
  }): unknown;
}

/**
 * Register the guided `Exocortex: Setup (Getting Started)` command — the one
 * command a new user can find by intuition and the re-entry point the first-run
 * panel (§3.1) depends on (so it ships WITH the panel in Phase 1, §3.2 bullet 1).
 *
 * Registered **unconditionally** — there is deliberately NO `Platform.isMobile`
 * gate, so the panel is reachable on both desktop and mobile (Desktop↔Mobile
 * Command Parity invariant). The panel itself renders on both platforms; its
 * step actions route through the cross-platform bootstrap / add-assetspace /
 * apply-profile flows that already run on mobile via the REST path.
 */
export function registerOnboardingCommands(
  plugin: OnboardingCommandRegistrar,
  openPanel: () => void,
): void {
  plugin.addCommand({
    id: SETUP_COMMAND_ID,
    // Sentence case per the plugin's UI-text lint rule + RFC 0002 P3
    // (de-jargon / consistent casing — the parenthetical follows the same
    // lowercase convention as the RFC's «(advanced)» flags); surfaces as
    // «Exocortex: Setup (getting started)».
    name: "Setup (getting started)",
    callback: () => openPanel(),
  });
}
