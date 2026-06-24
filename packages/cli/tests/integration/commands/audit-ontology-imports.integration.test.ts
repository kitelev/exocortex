import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForOntologyImports,
  ONTOLOGY_CLASS_UID,
} from "../../../src/commands/audit-ontology-imports.js";

const ONTO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ONTO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

function writeOntology(
  dir: string,
  uid: string,
  label: string,
  imports: string[],
): string {
  mkdirSync(dir, { recursive: true });
  const importLines =
    imports.length > 0
      ? ["exo__Ontology_imports:", ...imports.map((i) => `  - "[[${i}]]"`)]
      : [];
  const file = join(dir, `${uid}.md`);
  writeFileSync(
    file,
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "${label}"`,
      "exo__Instance_class:",
      `  - "[[${ONTOLOGY_CLASS_UID}]]"`,
      `exo__Asset_isDefinedBy: "[[${uid}]]"`,
      ...importLines,
      "---",
      "",
      "Ontology.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return file;
}

function writeAsset(
  dir: string,
  uid: string,
  ontologyUid: string,
  body: string,
): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${uid}.md`);
  writeFileSync(
    file,
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_label: "Asset ${uid}"`,
      `exo__Asset_isDefinedBy: "[[${ontologyUid}]]"`,
      "---",
      "",
      body,
      "",
    ].join("\n"),
    "utf-8",
  );
  return file;
}

/**
 * Empirical revert→fail / restore→pass proof for `audit ontology-imports`
 * (rule: integration-test-revert-verify). The verdict is driven purely by the
 * vault data: a cross-ontology link is violating exactly while the declared
 * `exo__Ontology_imports` closure does not cover it. We flip the declaration
 * on disk: absent (FAIL=violation) → declared (PASS) → absent again (FAIL).
 * If the audit reported clean in BOTH states it would be a false-positive
 * guard — this test would catch that.
 */
describe("audit ontology-imports — revert→fail / restore→pass (integration)", () => {
  let vault: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `onto-imports-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
    writeAsset(
      join(vault, "alpha"),
      ASSET_A,
      ONTO_A,
      `Cross-ontology link: [[${ASSET_B}]].`,
    );
    writeAsset(join(vault, "beta"), ASSET_B, ONTO_B, "Target body.");
    writeOntology(join(vault, "beta"), ONTO_B, "$beta", []);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("FAIL without the import declaration, PASS with it, FAIL again without @req:6999f49b-6e87-4cbb-b7e9-648ee38e68da", async () => {
    // --- State 1: no declared import A→B → the a→b link is a violation ---
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", []);
    let r = await scanVaultForOntologyImports(vault);
    expect(r.clean).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].source.uid).toBe(ONTO_A);
    expect(r.violations[0].target.uid).toBe(ONTO_B);

    // --- State 2: declare the import (overwrite ontology file) → clean ---
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_B]);
    r = await scanVaultForOntologyImports(vault);
    expect(r.clean).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.linkCounts.crossOntologyValid).toBeGreaterThanOrEqual(1);

    // --- State 3: revert the declaration → violation returns ---
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", []);
    r = await scanVaultForOntologyImports(vault);
    expect(r.clean).toBe(false);
    expect(r.violations).toHaveLength(1);
  });

  it("declared-graph cycle flips the audit red and resolving it flips back", async () => {
    // Cycle: A imports B, B imports A.
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_B]);
    writeOntology(join(vault, "beta"), ONTO_B, "$beta", [ONTO_A]);
    let r = await scanVaultForOntologyImports(vault);
    expect(r.declared.acyclic).toBe(false);
    expect(r.clean).toBe(false);

    // Break the cycle: B no longer imports A.
    writeOntology(join(vault, "beta"), ONTO_B, "$beta", []);
    r = await scanVaultForOntologyImports(vault);
    expect(r.declared.acyclic).toBe(true);
    expect(r.clean).toBe(true);
  });

  it("fail-open skips never affect cleanliness", async () => {
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", [ONTO_B]);
    // Asset with a broken link + an image embed: skips, not violations.
    writeAsset(
      join(vault, "alpha"),
      "33333333-3333-4333-8333-333333333333",
      ONTO_A,
      "Broken [[99999999-9999-4999-8999-999999999999]] and ![[img.png]].",
    );

    const r = await scanVaultForOntologyImports(vault);
    expect(r.skips.broken).toBeGreaterThanOrEqual(1);
    expect(r.skips["non-markdown"]).toBe(1);
    expect(r.clean).toBe(true);
  });
});
