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
 * The public, stable starter-content registry pre-filled into step 2 of the
 * onboarding panel. Unlike the Bootstrap floor URL (kept empty per EC7 — the
 * `kitelev/exoas-*` repos are Andrey's own ontology, not a generic floor), this
 * registry IS genuinely recommended for every new tester, so pre-filling it is
 * a deliberate UX affordance and not an EC7 conflict (RFC 0002 §3.1 / §3.3).
 */
export const STARTER_REGISTRY_URL =
  "https://github.com/kitelev/exoas-starter-registry";

/**
 * Initial fuzzy-filter query for step 3's profile picker, so the canonical
 * `starter` profile surfaces first (RFC 0002 §3.1 step 3 / §3.4). The picker
 * still lists all profiles — the query just pre-narrows it.
 */
export const STARTER_PROFILE_QUERY = "starter";

/**
 * First-run detection (RFC 0002 §3.1 [P1, P2]). The panel auto-shows on plugin
 * enable when the vault is **not yet bootstrapped** AND the user has not already
 * dismissed/completed onboarding on this device.
 *
 * `vaultState` comes from {@link BootstrapAssetSpaceCommands.detectVaultState}
 * (cross-platform — `vault.adapter` based, so it works identically on mobile,
 * satisfying the Desktop↔Mobile Command Parity invariant). Both `empty` and
 * `clone-needs-fetch` are pre-value states that still need the guided path;
 * only `bootstrapped` suppresses the panel.
 *
 * `onboardingCompleted` is the device-local flag persisted by the panel on
 * close (see {@link PluginLocalDataStore.getOnboardingCompleted}) so the panel
 * is genuinely one-time — re-openable only via the `Setup` command.
 */
export function shouldShowFirstRunPanel(
  vaultState: VaultBootstrapState,
  onboardingCompleted: boolean,
): boolean {
  if (onboardingCompleted) return false;
  return vaultState !== "bootstrapped";
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
