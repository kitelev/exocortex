import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForCoLocation,
  auditCoLocationCommand,
} from "../../../src/commands/audit-co-location.js";
import { auditCommand } from "../../../src/commands/audit.js";

const ONTO_UID = "3618eb28-233b-4b49-98e8-65c8ce186a9f";

/** Write an asset .md with the given uid + optional isDefinedBy line. */
function writeAsset(
  dir: string,
  uid: string,
  isDefinedBy?: string,
  label = "Test Asset",
): void {
  mkdirSync(dir, { recursive: true });
  const idbLine =
    isDefinedBy !== undefined ? `exo__Asset_isDefinedBy: ${isDefinedBy}\n` : "";
  const content = `---
exo__Asset_uid: ${uid}
exo__Asset_label: ${label}
${idbLine}---

Body.
`;
  writeFileSync(join(dir, `${uid}.md`), content, "utf-8");
}

describe("audit co-location — Commander wiring", () => {
  it("registers under 'audit' parent command", () => {
    const parent = auditCommand();
    expect(parent.name()).toBe("audit");
    const sub = parent.commands.find((c) => c.name() === "co-location");
    expect(sub).toBeDefined();
  });

  it("subcommand declares --vault required + --output options", () => {
    const sub = auditCoLocationCommand();
    expect(sub.name()).toBe("co-location");
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--vault");
    expect(opts).toContain("--output");
  });

  it("--help references co-location invariant semantics", () => {
    const sub = auditCoLocationCommand();
    expect(sub.helpInformation()).toMatch(/co-location|isDefinedBy/);
  });
});

describe("audit co-location — scanVaultForCoLocation", () => {
  let vault: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `audit-coloc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
    // Ontology file (no isDefinedBy → itself skipped) under assetspaces/concepts/
    writeAsset(
      join(vault, "assetspaces", "concepts"),
      ONTO_UID,
      undefined,
      "$concepts",
    );
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("reports 0 violations when asset is co-located with its ontology folder", async () => {
    writeAsset(
      join(vault, "assetspaces", "concepts"),
      "asset-co-located",
      `"[[${ONTO_UID}]]"`,
    );
    const r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBe(1); // the asset; ontology file skipped (empty)
  });

  it("detects a violation when asset is in the wrong folder", async () => {
    writeAsset(
      join(vault, "03 Knowledge", "inbox"),
      "asset-misplaced",
      `"[[${ONTO_UID}]]"`,
    );
    const r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].path).toBe("03 Knowledge/inbox/asset-misplaced.md");
    expect(r.violations[0].expectedFolder).toBe("assetspaces/concepts");
    expect(r.violations[0].actualFolder).toBe("03 Knowledge/inbox");
  });

  it("resolves alias-form isDefinedBy (`[[uid|alias]]`)", async () => {
    writeAsset(
      join(vault, "assetspaces", "concepts"),
      "asset-alias",
      `"[[${ONTO_UID}|$concepts]]"`,
    );
    const r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBe(1);
  });

  it("skip-accounting: empty-isDefinedBy", async () => {
    writeAsset(join(vault, "03 Knowledge"), "asset-no-idb"); // no isDefinedBy
    const r = await scanVaultForCoLocation(vault);
    // ontology file + this asset both lack isDefinedBy
    expect(r.skips["empty-isDefinedBy"]).toBe(2);
    expect(r.violations).toHaveLength(0);
  });

  it("skip-accounting: bang-prefix (intentionally unresolvable)", async () => {
    writeAsset(
      join(vault, "03 Knowledge", "inbox"),
      "asset-bang",
      `"[[!kitelev]]"`,
    );
    const r = await scanVaultForCoLocation(vault);
    expect(r.skips["bang-prefix"]).toBe(1);
    expect(r.violations).toHaveLength(0);
  });

  it("skip-accounting: unresolvable (cross-vault/missing ontology)", async () => {
    writeAsset(
      join(vault, "03 Knowledge", "inbox"),
      "asset-dangling",
      `"[[ffffffff-0000-0000-0000-000000000000]]"`,
    );
    const r = await scanVaultForCoLocation(vault);
    expect(r.skips.unresolvable).toBe(1);
    expect(r.violations).toHaveLength(0);
  });

  it("counts multiple violations across folders", async () => {
    writeAsset(join(vault, "03 Knowledge", "inbox"), "m1", `"[[${ONTO_UID}]]"`);
    writeAsset(
      join(vault, "03 Knowledge", "tbank-public"),
      "m2",
      `"[[${ONTO_UID}]]"`,
    );
    writeAsset(
      join(vault, "assetspaces", "concepts"),
      "ok1",
      `"[[${ONTO_UID}]]"`,
    );
    const r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(2);
    expect(r.checked).toBe(3);
  });

  it("does not flag misplaced .md inside .obsidian (glob) or node_modules (audit guard)", async () => {
    // Both would resolve to the concepts ontology and thus look like violations
    // if scanned — but .obsidian is excluded by glob (dot:false) and
    // node_modules is skipped by the audit guard.
    writeAsset(join(vault, ".obsidian"), "dot1", `"[[${ONTO_UID}]]"`);
    writeAsset(join(vault, "node_modules", "pkg"), "nm1", `"[[${ONTO_UID}]]"`);
    const r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBe(0); // only the ontology file (empty isDefinedBy) remains
  });
});

describe("audit co-location — command action (output + exit code)", () => {
  let vault: string;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;
  let prevExit: number | undefined;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `audit-coloc-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
    writeAsset(
      join(vault, "assetspaces", "concepts"),
      ONTO_UID,
      undefined,
      "$concepts",
    );
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    prevExit = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExit;
    rmSync(vault, { recursive: true, force: true });
  });

  it("text output, clean vault → exit 0", async () => {
    writeAsset(
      join(vault, "assetspaces", "concepts"),
      "ok",
      `"[[${ONTO_UID}]]"`,
    );
    const cmd = auditCoLocationCommand();
    await cmd.parseAsync(["--vault", vault], { from: "user" });
    expect(process.exitCode).toBeFalsy();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/0 co-location violations/);
  });

  it("text output, dirty vault → exit 1 + skip-accounting printed", async () => {
    writeAsset(
      join(vault, "03 Knowledge", "inbox"),
      "bad",
      `"[[${ONTO_UID}]]"`,
    );
    const cmd = auditCoLocationCommand();
    await cmd.parseAsync(["--vault", vault], { from: "user" });
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(err).toMatch(/1 co-location violation/);
    expect(err).toMatch(/Skipped \(fail-open/);
  });

  it("json output emits structured result", async () => {
    writeAsset(
      join(vault, "03 Knowledge", "inbox"),
      "bad",
      `"[[${ONTO_UID}]]"`,
    );
    const cmd = auditCoLocationCommand();
    await cmd.parseAsync(["--vault", vault, "--output", "json"], {
      from: "user",
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.violationCount).toBe(1);
    expect(parsed.clean).toBe(false);
    expect(parsed.skips).toBeDefined();
  });
});
