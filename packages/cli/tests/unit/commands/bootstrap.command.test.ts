import { describe, it, expect } from "@jest/globals";

import { bootstrapCommand } from "../../../src/commands/bootstrap.js";

/**
 * req e0e5ad0f (Andrey interview 2026-06-27) — `bootstrap` installs ONLY the SDK
 * floor (exo). `exocmd` is an ordinary optional AssetSpace, added via
 * `exocortex assetspace add` — NOT a bootstrap option.
 *
 * History: issue #3426 (RFC 01a83de8 alt-G rejection) first made `--exocmd`
 * OPTIONAL (was a `.requiredOption`); req e0e5ad0f then removed the flag
 * entirely to keep bootstrap strictly about the SDK platform.
 *
 * These tests assert the Commander option configuration directly — deterministic,
 * no network / no `process.exit`.
 */
describe("bootstrap command — SDK-floor-only (req e0e5ad0f)", () => {
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

  it("registers NO --exocmd option — bootstrap installs only the SDK floor @req:e0e5ad0f-56ce-4bc8-9e1b-7a0e20a735d7", () => {
    const cmd = bootstrapCommand();
    const exocmd = cmd.options.find((o) => o.long === "--exocmd");
    // exocmd is an optional AssetSpace added via `assetspace add`, not a
    // bootstrap option. Re-adding `.option("--exocmd", ...)` makes this RED.
    expect(exocmd).toBeUndefined();
  });
});
