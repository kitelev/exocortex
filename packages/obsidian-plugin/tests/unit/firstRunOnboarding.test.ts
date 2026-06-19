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
  persistOnboardingPat,
  PAT_SECRET_KEY,
  SETUP_COMMAND_ID,
  STARTER_REGISTRY_URL,
  STARTER_PROFILE_QUERY,
  FRESH_VAULT_MAX_NOTES,
  type OnboardingCommandRegistrar,
  type OnboardingSecretsStore,
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
    "shows on a genuinely-fresh not-yet-bootstrapped vault (%s)",
    (state) => {
      // 0 notes (brand-new) and 1 note (stock Welcome.md) both count as fresh.
      expect(shouldShowFirstRunPanel(state, false, 0)).toBe(true);
      expect(shouldShowFirstRunPanel(state, false, FRESH_VAULT_MAX_NOTES)).toBe(
        true,
      );
    },
  );

  it("does NOT show on a bootstrapped vault even when fresh + not completed", () => {
    expect(shouldShowFirstRunPanel("bootstrapped", false, 0)).toBe(false);
  });

  it.each(notBootstrapped)(
    "does NOT show on a content-rich not-bootstrapped vault (%s) — false-positive guard",
    (state) => {
      // The e2e test-vault scenario: many notes but no assetspaces/ →
      // detectVaultState reports "empty", yet it is NOT a first-run vault.
      expect(shouldShowFirstRunPanel(state, false, 162)).toBe(false);
      expect(
        shouldShowFirstRunPanel(state, false, FRESH_VAULT_MAX_NOTES + 1),
      ).toBe(false);
    },
  );

  it.each<VaultBootstrapState>(["empty", "clone-needs-fetch", "bootstrapped"])(
    "never shows once onboarding is completed (state %s, even when fresh)",
    (state) => {
      expect(shouldShowFirstRunPanel(state, true, 0)).toBe(false);
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

describe("persistOnboardingPat — token-first step save (cd9444bd, RFC 0002 §3.1)", () => {
  /** Minimal device-local store fake mirroring LocalSecretsStore.setSecret. */
  function makeStore(): {
    store: OnboardingSecretsStore;
    saved: Array<{ key: string; value: string | null }>;
  } {
    const saved: Array<{ key: string; value: string | null }> = [];
    const store: OnboardingSecretsStore = {
      setSecret: async (key, value) => {
        saved.push({ key, value });
      },
    };
    return { store, saved };
  }

  it("uses the canonical 'pat' key the materialise steps read", () => {
    // Guards against key drift: the bootstrap/add/apply paths read getSecret("pat"),
    // so the onboarding save MUST write under that exact key or it silently
    // never reaches them (Issue #3320 §1).
    expect(PAT_SECRET_KEY).toBe("pat");
  });

  it("persists a trimmed token under the canonical key (private-repo access)", async () => {
    const { store, saved } = makeStore();
    await persistOnboardingPat(store, "  github_pat_abc123  ");
    expect(saved).toEqual([{ key: "pat", value: "github_pat_abc123" }]);
  });

  it("CLEARS the token (null) for an empty value — the public-only skip path", async () => {
    const { store, saved } = makeStore();
    await persistOnboardingPat(store, "");
    // null → LocalSecretsStore deletes the entry → materialise steps see no PAT
    // and pull public repos anonymously (public flow not broken).
    expect(saved).toEqual([{ key: "pat", value: null }]);
  });

  it("CLEARS the token for an all-whitespace value (never persists junk)", async () => {
    const { store, saved } = makeStore();
    await persistOnboardingPat(store, "   \n  ");
    expect(saved).toEqual([{ key: "pat", value: null }]);
  });

  it("a saved token round-trips: a later getSecret('pat') returns it", async () => {
    // Simulate the real before/after: save in step 1, then a materialise step
    // reads the same store. Without the save the read is null (private pull
    // fails); with it the token is present (private pull authenticates).
    const bag: Record<string, string | null> = {};
    const store: OnboardingSecretsStore & {
      getSecret: (k: string) => string | null;
    } = {
      setSecret: async (key, value) => {
        if (value === null) delete bag[key];
        else bag[key] = value;
      },
      getSecret: (k) => bag[k] ?? null,
    };

    expect(store.getSecret("pat")).toBeNull(); // before
    await persistOnboardingPat(store, "github_pat_live");
    expect(store.getSecret("pat")).toBe("github_pat_live"); // after
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
