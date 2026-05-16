/**
 * Issue #3127 — CLI integration test: validate schema --shapes-mode --also <path>
 *
 * Two-vault scenario:
 *   vaultA/ → contains the ems__Task_count Property shape (range = xsd:integer)
 *   vaultB/ → contains an instance with ems__Task_count = "not-an-integer"
 *
 * Without --also vaultA:
 *   ShapeLoader sees no shape for ems__Task_count → no violation reported
 *   (shape is invisible to the single-vault load).
 *
 * With --also vaultA:
 *   Merged registry includes the shape → sh:datatype violation surfaces.
 *
 * This is the regression test for the false-negative case: shapes that
 * live in a separate vault must be loadable into the validation graph.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { runShapesValidation, qualifyFocusNodePath } = await import(
  "../../src/commands/validate-schema.js"
);
const { NoteToRDFConverter } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

let tmpRoot: string;
let vaultA: string;
let vaultB: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exocortex-multivault-"));
  vaultA = path.join(tmpRoot, "vaultA");
  vaultB = path.join(tmpRoot, "vaultB");
  fs.mkdirSync(path.join(vaultA, "shapes"), { recursive: true });
  fs.mkdirSync(path.join(vaultB, "data"), { recursive: true });

  // Shape lives in vaultA
  fs.writeFileSync(
    path.join(vaultA, "shapes", "ems__Task_count.md"),
    `---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: aaaa1111-1111-1111-1111-aaaaaaaaaaaa
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: ems__Task_count
exo__Property_domain:
  - "[[ems__Task]]"
exo__Property_range: "http://www.w3.org/2001/XMLSchema#integer"
exo__Property_severity: sh:Violation
aliases:
  - ems__Task_count
---
Shape def in vaultA.
`,
  );

  // Violating instance lives in vaultB
  fs.writeFileSync(
    path.join(vaultB, "data", "asset-violating.md"),
    `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: bbbb2222-2222-2222-2222-bbbbbbbbbbbb
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[ems__Task]]"
exo__Asset_label: Asset Violating
ems__Task_count: "not-an-integer"
aliases:
  - asset-violating
---
Bad integer in vaultB.
`,
  );
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function loadTriples(...vaults: string[]): Promise<unknown[]> {
  const all: unknown[] = [];
  for (const v of vaults) {
    const adapter = new FileSystemVaultAdapter(v);
    const converter = new NoteToRDFConverter(adapter);
    const triples = await converter.convertVault();
    for (const t of triples) all.push(t);
  }
  return all;
}

describe("BDD: validate schema --shapes-mode --also (Issue #3127)", () => {
  it("Scenario: single-vault validation of vaultB alone — shape from vaultA is INVISIBLE", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triples = (await loadTriples(vaultB)) as any[];
    const report = await runShapesValidation(vaultB, triples);
    // Without the shape from vaultA, no sh:datatype check is performed on ems__Task_count
    const datatypeViolations = report.violations.filter((v) =>
      v.message.includes("sh:datatype"),
    );
    expect(datatypeViolations.length).toBe(0);
  });

  it("Scenario: multi-vault validation with --also vaultA — shape is loaded and violation surfaces", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triples = (await loadTriples(vaultB, vaultA)) as any[];
    const report = await runShapesValidation(vaultB, triples, [vaultA]);
    const datatypeViolations = report.violations.filter((v) =>
      v.message.includes("sh:datatype"),
    );
    expect(datatypeViolations.length).toBeGreaterThan(0);
    const v = datatypeViolations[0];
    expect(v.focusNode).toContain("asset-violating");
    expect(v.propertyPath).toContain("Task_count");
  });

  it("Scenario: qualifyFocusNodePath resolves focusNode to the vault root that owns the file", () => {
    const focusNode = "obsidian://vault/data/asset-violating.md";
    const resolved = qualifyFocusNodePath(focusNode, [vaultA, vaultB]);
    expect(resolved).toBe(path.join(vaultB, "data", "asset-violating.md"));
  });

  it("Scenario: qualifyFocusNodePath falls back to primary vault when file not found in any root", () => {
    const focusNode = "obsidian://vault/missing/asset.md";
    const resolved = qualifyFocusNodePath(focusNode, [vaultA, vaultB]);
    expect(resolved).toBe(path.join(vaultA, "missing", "asset.md"));
  });
});
