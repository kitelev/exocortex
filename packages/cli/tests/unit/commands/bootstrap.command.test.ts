import { describe, it, expect } from "@jest/globals";

import { bootstrapCommand } from "../../../src/commands/bootstrap.js";

/**
 * Issue #3426 (Gap 1) — `bootstrap --exocmd` must be OPTIONAL.
 *
 * RFC 01a83de8 alt-G rejection: `exo` is the SDK; `exocmd` is the optional
 * UI-command library. A bare SDK/headless vault (only `--exo`) is first-class.
 * These tests assert the Commander option configuration directly — deterministic,
 * no network / no `process.exit`.
 */
describe("bootstrap command — exocmd optionality (issue #3426)", () => {
  it("--exo is a required (mandatory) option", () => {
    const cmd = bootstrapCommand();
    const exo = cmd.options.find((o) => o.long === "--exo");
    expect(exo).toBeDefined();
    expect(exo!.mandatory).toBe(true);
  });

  it("--vault is a required (mandatory) option", () => {
    const cmd = bootstrapCommand();
    const vault = cmd.options.find((o) => o.long === "--vault");
    expect(vault).toBeDefined();
    expect(vault!.mandatory).toBe(true);
  });

  it("--exocmd is OPTIONAL (NOT mandatory) — the core of Gap 1", () => {
    const cmd = bootstrapCommand();
    const exocmd = cmd.options.find((o) => o.long === "--exocmd");
    expect(exocmd).toBeDefined();
    // Pre-#3426 this was a `.requiredOption(...)` (mandatory === true).
    expect(exocmd!.mandatory).toBeFalsy();
  });

  it("still offers --exocmd as an opt-in flag (so post-bootstrap users can add it inline)", () => {
    const cmd = bootstrapCommand();
    const exocmd = cmd.options.find((o) => o.long === "--exocmd");
    expect(exocmd).toBeDefined();
    expect(exocmd!.flags).toContain("--exocmd");
  });
});
