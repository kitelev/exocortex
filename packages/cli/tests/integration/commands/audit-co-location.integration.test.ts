import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync, renameSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanVaultForCoLocation } from "../../../src/commands/audit-co-location.js";

const ONTO_UID = "3618eb28-233b-4b49-98e8-65c8ce186a9f";
const ASSET_UID = "11111111-2222-3333-4444-555555555555";

function writeAsset(dir: string, uid: string, isDefinedBy?: string): string {
  mkdirSync(dir, { recursive: true });
  const idb =
    isDefinedBy !== undefined ? `exo__Asset_isDefinedBy: ${isDefinedBy}\n` : "";
  const file = join(dir, `${uid}.md`);
  writeFileSync(
    file,
    `---
exo__Asset_uid: ${uid}
exo__Asset_label: Fixture ${uid}
${idb}---

Body.
`,
    "utf-8",
  );
  return file;
}

/**
 * Empirical revert→fail / restore→pass proof for `audit co-location`.
 *
 * This is NOT a cyclic metric: the audit's verdict is driven purely by the
 * asset's actual on-disk folder vs. its resolved ontology folder. We physically
 * move the file out of co-location (audit must FAIL=1), then back (audit must
 * PASS=0). If the audit reported 0 in BOTH states it would be a false-positive
 * guard — this test would catch that.
 */
describe("audit co-location — revert→fail / restore→pass (integration)", () => {
  let vault: string;
  let ontoDir: string;
  let wrongDir: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `coloc-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    ontoDir = join(vault, "assetspaces", "concepts");
    wrongDir = join(vault, "03 Knowledge", "inbox");
    mkdirSync(vault, { recursive: true });
    // Ontology file lives in assetspaces/concepts/
    writeAsset(ontoDir, ONTO_UID);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("PASS when co-located, FAIL when moved away, PASS again when restored", async () => {
    // --- State 1: co-located → audit PASS (0 violations) ---
    const coLocated = writeAsset(ontoDir, ASSET_UID, `"[[${ONTO_UID}]]"`);
    let r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBe(1);

    // --- State 2: seed mismatch (move out of ontology folder) → audit FAIL (1) ---
    mkdirSync(wrongDir, { recursive: true });
    const moved = join(wrongDir, `${ASSET_UID}.md`);
    renameSync(coLocated, moved);
    expect(existsSync(coLocated)).toBe(false);
    r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].actualFolder).toBe("03 Knowledge/inbox");
    expect(r.violations[0].expectedFolder).toBe("assetspaces/concepts");

    // --- State 3: restore (move back) → audit PASS (0 violations) ---
    renameSync(moved, coLocated);
    r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBe(1);
  });

  it("skip-accounting is independent of violations (fail-open assets never fail the audit)", async () => {
    // Misplaced resolvable asset → 1 violation
    writeAsset(wrongDir, ASSET_UID, `"[[${ONTO_UID}]]"`);
    // Bang-prefix + dangling + empty → 3 skips, 0 extra violations
    writeAsset(
      wrongDir,
      "aaaaaaaa-0000-0000-0000-000000000000",
      `"[[!kitelev]]"`,
    );
    writeAsset(
      wrongDir,
      "bbbbbbbb-0000-0000-0000-000000000000",
      `"[[deadbeef-0000-0000-0000-000000000000]]"`,
    );
    writeAsset(wrongDir, "cccccccc-0000-0000-0000-000000000000");

    const r = await scanVaultForCoLocation(vault);
    expect(r.violations).toHaveLength(1);
    expect(r.skips["bang-prefix"]).toBe(1);
    expect(r.skips.unresolvable).toBe(1);
    // empty: the standalone empty asset + the ontology file
    expect(r.skips["empty-isDefinedBy"]).toBe(2);
  });
});
