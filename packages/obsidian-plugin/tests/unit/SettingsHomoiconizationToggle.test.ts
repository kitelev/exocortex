/**
 * Issue #3539 — feature-toggle for settings-homoiconization (default OFF).
 *
 * These assertions pin the master-switch contract at the schema level:
 *  - it exists in DEFAULT_SETTINGS with default `false` (fresh install is OFF);
 *  - it is a boolean;
 *  - it is NOT homoiconized — it must be denylisted (NON_HOMOICONIZABLE_FIELDS)
 *    and absent from VAULT_SETTINGS_REGISTRY, because a master switch cannot
 *    depend on the very feature it gates.
 *
 * The anti-drift test in VaultSettingsRegistry.test.ts ("covers every
 * ExocortexSettings field except the denylisted ones") would already fail if
 * the field were neither registered nor denylisted; these tests state the
 * intent explicitly so a future contributor cannot "fix" the drift test by
 * homoiconizing the master switch.
 */
import { DEFAULT_SETTINGS } from "../../src/domain/settings/ExocortexSettings";
import {
  NON_HOMOICONIZABLE_FIELDS,
  VAULT_SETTINGS_REGISTRY,
} from "../../src/domain/settings/VaultSettingsRegistry";

describe("settingsHomoiconizationEnabled master switch (Issue #3539)", () => {
  it("defaults to false (opt-in — fresh install is OFF)", () => {
    expect(DEFAULT_SETTINGS.settingsHomoiconizationEnabled).toBe(false);
  });

  it("is a boolean field", () => {
    expect(typeof DEFAULT_SETTINGS.settingsHomoiconizationEnabled).toBe(
      "boolean",
    );
  });

  it("is denylisted as non-homoiconizable (cannot gate-depend on itself)", () => {
    expect(NON_HOMOICONIZABLE_FIELDS).toContain(
      "settingsHomoiconizationEnabled",
    );
  });

  it("is NOT in the homoiconization registry (never a vault asset)", () => {
    const fields = VAULT_SETTINGS_REGISTRY.map((d) => d.field);
    expect(fields).not.toContain("settingsHomoiconizationEnabled");
  });
});
