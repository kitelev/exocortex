import { describe, it, expect } from "@jest/globals";
import {
  auditAssetSpaceDependsCommand,
  assetspaceOfPath,
  DEFINITION_TIER_PREDICATES,
} from "../../../src/commands/audit-assetspace-depends.js";
import { auditCommand } from "../../../src/commands/audit.js";

/**
 * Wiring axis for req 04208713 (RFC 306dcb5c coverage gate): the verb exists
 * as a module AND is reachable from the `audit` parent. Deleting the
 * `cmd.addCommand(auditAssetSpaceDependsCommand())` line in audit.ts must
 * redden the first test while the scan-level integration suite stays green —
 * that is the "new code is wired into the production path" axis, distinct
 * from "new code does what it promises".
 */
describe("audit assetspace-depends — Commander wiring", () => {
  it("@req:04208713-cdd5-4438-b910-215c0cf52382 registers under the 'audit' parent command", () => {
    const parent = auditCommand();
    expect(parent.name()).toBe("audit");
    const sub = parent.commands.find((c) => c.name() === "assetspace-depends");
    expect(sub).toBeDefined();
  });

  it("subcommand declares ONE required --vault plus --registry / --self / --output", () => {
    const sub = auditAssetSpaceDependsCommand();
    expect(sub.name()).toBe("assetspace-depends");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--vault");
    expect(opts).toContain("--registry");
    expect(opts).toContain("--self");
    expect(opts).toContain("--output");
    // vault = environment (RFC eacf04c0): there is no second-vault flag.
    expect(opts).not.toContain("--also");
    const vaultOpt = sub.options.find((o) => o.long === "--vault");
    expect(vaultOpt?.required).toBe(true);
  });

  it("--help names both numbers and the one-sided / no-cycle-check frame", () => {
    const help = auditAssetSpaceDependsCommand().helpInformation();
    expect(help).toMatch(/uncovered-by-closure/i);
    expect(help).toMatch(/uncovered-directly/i);
    expect(help).toMatch(/one-sided/i);
    expect(help).toMatch(/no cycle check/i);
  });
});

describe("assetspaceOfPath", () => {
  it("keys an asset by owner/repo from the assetspaces/ prefix", () => {
    expect(assetspaceOfPath("assetspaces/kitelev/exoas-exo/exo/x.md")).toBe(
      "kitelev/exoas-exo",
    );
  });

  it("returns null outside assetspaces/", () => {
    expect(assetspaceOfPath("inbox/x.md")).toBeNull();
    expect(assetspaceOfPath("assetspaces/kitelev")).toBeNull();
  });
});

describe("DEFINITION_TIER_PREDICATES", () => {
  it("is exactly TIER_DEFS of the reference detector assetspace-cycle-detect.py (RFC 306dcb5c R3: both measurers count the same population)", () => {
    // Mirror of `TIER_DEFS` in ~/.claude/bin/assetspace-cycle-detect.py (2026-09-13).
    // Adding or removing a predicate here without the detector = two measurers
    // over two populations; the symmetric difference in the dogfood would lie.
    expect([...DEFINITION_TIER_PREDICATES].sort()).toEqual(
      [
        "exo__Ontology_imports",
        "exo__Ontology_admits",
        "exo__Property_range",
        "exo__Property_domain",
        "exo__Class_superClass",
        "exo__Property_superProperty",
        "exo__Property_cardinality",
        "exo__Property_minCount",
      ].sort(),
    );
    // Definition tier only: binding/instance predicates are a different tier.
    expect(DEFINITION_TIER_PREDICATES).not.toContain("exo__Asset_isDefinedBy");
    expect(DEFINITION_TIER_PREDICATES).not.toContain("exo__Instance_class");
  });
});
