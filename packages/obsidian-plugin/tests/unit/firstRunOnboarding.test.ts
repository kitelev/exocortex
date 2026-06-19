/**
 * Unit tests for the pure first-run onboarding logic (RFC 0002 §3.1/§3.2):
 *   - `shouldShowFirstRunPanel` detection truth table (bootstrapped vs not,
 *     completed vs not).
 *   - the canonical starter-path constants.
 *   - `registerOnboardingCommands` — the `Setup (Getting Started)` command
 *     registers UNCONDITIONALLY (no Platform gate), so the panel is reachable on
 *     both desktop and mobile (Desktop↔Mobile Command Parity).
 *
 * No `obsidian` import — this module is deliberately pure (see firstRunOnboarding.ts).
 */
import { describe, it, expect } from "@jest/globals";

import {
  shouldShowFirstRunPanel,
  registerOnboardingCommands,
  SETUP_COMMAND_ID,
  STARTER_REGISTRY_URL,
  STARTER_PROFILE_QUERY,
  type OnboardingCommandRegistrar,
} from "../../src/infrastructure/adapters/firstRunOnboarding";
import type { VaultBootstrapState } from "../../src/infrastructure/adapters/BootstrapAssetSpaceCommands";

interface RegisteredCommand {
  id: string;
  name: string;
  callback: () => void;
}

function makeRegistrar(): {
  plugin: OnboardingCommandRegistrar;
  added: RegisteredCommand[];
} {
  const added: RegisteredCommand[] = [];
  const plugin: OnboardingCommandRegistrar = {
    addCommand: (command) => {
      added.push(command);
      return command;
    },
  };
  return { plugin, added };
}

describe("shouldShowFirstRunPanel — first-run detection (RFC 0002 §3.1)", () => {
  const notBootstrapped: VaultBootstrapState[] = ["empty", "clone-needs-fetch"];

  it.each(notBootstrapped)(
    "shows on a not-yet-bootstrapped vault (%s) when onboarding not completed",
    (state) => {
      expect(shouldShowFirstRunPanel(state, false)).toBe(true);
    },
  );

  it("does NOT show on a bootstrapped vault even when not completed", () => {
    expect(shouldShowFirstRunPanel("bootstrapped", false)).toBe(false);
  });

  it.each<VaultBootstrapState>(["empty", "clone-needs-fetch", "bootstrapped"])(
    "never shows once onboarding is completed (state %s)",
    (state) => {
      expect(shouldShowFirstRunPanel(state, true)).toBe(false);
    },
  );
});

describe("starter-path constants", () => {
  it("pre-fills the public starter registry (no EC7 conflict)", () => {
    expect(STARTER_REGISTRY_URL).toBe(
      "https://github.com/kitelev/exoas-starter-registry",
    );
  });

  it("narrows the profile picker to the canonical starter profile", () => {
    expect(STARTER_PROFILE_QUERY).toBe("starter");
  });
});

describe("registerOnboardingCommands — Setup (Getting Started)", () => {
  it("registers exactly one command with the stable id + plain-language name", () => {
    const { plugin, added } = makeRegistrar();
    registerOnboardingCommands(plugin, () => undefined);

    expect(added).toHaveLength(1);
    expect(added[0].id).toBe(SETUP_COMMAND_ID);
    expect(added[0].id).toBe("setup-getting-started");
    // Sentence case per the UI-text lint rule (RFC 0002 P3 de-jargon).
    expect(added[0].name).toBe("Setup (getting started)");
  });

  it("the command callback opens the panel", () => {
    const { plugin, added } = makeRegistrar();
    let opened = 0;
    registerOnboardingCommands(plugin, () => {
      opened++;
    });

    expect(opened).toBe(0); // registration alone does not open
    added[0].callback();
    expect(opened).toBe(1);
  });

  it("registration is platform-independent — no Platform gate (Desktop↔Mobile parity)", () => {
    // The function reads no Platform flag; calling it always yields the Setup
    // command. This guards against a future regression that adds a desktop-only
    // gate (the parity invariant the RFC's §3.9 DoD requires).
    const desktop = makeRegistrar();
    const mobile = makeRegistrar();
    registerOnboardingCommands(desktop.plugin, () => undefined);
    registerOnboardingCommands(mobile.plugin, () => undefined);

    expect(desktop.added.map((c) => c.id)).toEqual([SETUP_COMMAND_ID]);
    expect(mobile.added.map((c) => c.id)).toEqual([SETUP_COMMAND_ID]);
  });
});
