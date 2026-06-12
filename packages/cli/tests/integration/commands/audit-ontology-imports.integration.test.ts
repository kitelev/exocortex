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

  it("FAIL without the import declaration, PASS with it, FAIL again without", async () => {
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

const ONTO_X = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CROSS_TARGET = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/**
 * Empirical revert→fail / restore→pass proof for `--also` cross-vault
 * classification (RFC df39007b VL#13). The verdict is driven purely by data:
 * a primary-broken target that resolves in an `--also` vault is a cross-vault
 * violation; otherwise a fail-open broken skip. We flip the SAME link between
 * the two states by toggling `--also` (and by toggling the secondary vault's
 * content) — if the classifier reported the same bucket in both states it
 * would be a false-positive guard, which this test would catch.
 */
describe("audit ontology-imports — --also cross-vault classification (integration)", () => {
  let vault: string;
  let secondary: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vault = join(tmpdir(), `onto-imports-cv-primary-${stamp}`);
    secondary = join(tmpdir(), `onto-imports-cv-secondary-${stamp}`);
    mkdirSync(vault, { recursive: true });
    mkdirSync(secondary, { recursive: true });
    // exo__Ontology class-definition file so each ontology's
    // exo__Instance_class wikilink resolves (else it counts as a broken link).
    mkdirSync(join(vault, "exo"), { recursive: true });
    writeFileSync(
      join(vault, "exo", `${ONTOLOGY_CLASS_UID}.md`),
      ["---", `exo__Asset_uid: ${ONTOLOGY_CLASS_UID}`, 'exo__Asset_label: "exo__Ontology"', "---", "", "Class.", ""].join("\n"),
      "utf-8",
    );
    // Primary: ontology A + asset a1 linking to a UID that lives only in the
    // secondary vault.
    writeOntology(join(vault, "alpha"), ONTO_A, "$alpha", []);
    writeAsset(
      join(vault, "alpha"),
      ASSET_A,
      ONTO_A,
      `Cross-vault link: [[${CROSS_TARGET}]].`,
    );
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
    rmSync(secondary, { recursive: true, force: true });
  });

  function seedSecondaryTarget(): void {
    writeOntology(join(secondary, "xeno"), ONTO_X, "$xeno", []);
    writeAsset(join(secondary, "xeno"), CROSS_TARGET, ONTO_X, "Target in another vault.");
  }

  it("broken WITHOUT --also, cross-vault WITH --also, broken again WITHOUT", async () => {
    seedSecondaryTarget();

    // --- State 1: no --also → indistinguishable from a broken link ---
    let r = await scanVaultForOntologyImports(vault);
    expect(r.linkCounts.crossVault).toBe(0);
    expect(r.crossVault).toHaveLength(0);
    expect(r.skips.broken).toBe(1);
    expect(r.clean).toBe(true); // broken alone never fails the audit

    // --- State 2: --also reveals the target → cross-vault violation ---
    r = await scanVaultForOntologyImports(vault, { alsoPaths: [secondary] });
    expect(r.linkCounts.crossVault).toBe(1);
    expect(r.crossVault).toHaveLength(1);
    expect(r.crossVault[0].source.uid).toBe(ONTO_A);
    expect(r.crossVault[0].target.uid).toBe(ONTO_X);
    expect(r.crossVault[0].occurrences).toBe(1);
    expect(r.skips.broken).toBe(0);
    expect(r.clean).toBe(false); // cross-vault IS a violation (VL#13)

    // --- State 3: drop --also → reverts to a broken skip ---
    r = await scanVaultForOntologyImports(vault);
    expect(r.linkCounts.crossVault).toBe(0);
    expect(r.skips.broken).toBe(1);
    expect(r.clean).toBe(true);
  });

  it("stays a broken skip when --also vault does NOT contain the target", async () => {
    // Secondary vault exists but is empty → classification finds nothing.
    const r = await scanVaultForOntologyImports(vault, { alsoPaths: [secondary] });
    expect(r.linkCounts.crossVault).toBe(0);
    expect(r.crossVault).toHaveLength(0);
    expect(r.skips.broken).toBe(1);
    expect(r.clean).toBe(true);
  });

  it("never legitimizes the link — --also flips a clean audit to FAIL (VL#13)", async () => {
    seedSecondaryTarget();
    const withAlso = await scanVaultForOntologyImports(vault, {
      alsoPaths: [secondary],
    });
    const withoutAlso = await scanVaultForOntologyImports(vault);
    // Same vault, same link: --also turns a (broken-only) clean audit red.
    expect(withoutAlso.clean).toBe(true);
    expect(withAlso.clean).toBe(false);
  });
});
