import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForOntologyUrl,
  auditOntologyUrlCommand,
} from "../../../src/commands/audit-ontology-url.js";

const ONTOLOGY_CLASS = "829b9b3b-6fc3-4276-be6a-27d3398c012e";

/** Write a real ontology asset with the given exo__Ontology_url. */
function writeOntology(dir: string, uid: string, url: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${uid}.md`);
  writeFileSync(
    file,
    `---
exo__Asset_uid: ${uid}
exo__Asset_label: Fixture Ontology ${uid}
exo__Instance_class:
  - "[[${ONTOLOGY_CLASS}|exo__Ontology]]"
exo__Ontology_url: ${url}
---

# Ontology ${uid}
`,
    "utf-8",
  );
  return file;
}

/**
 * Empirical revert→fail / restore→pass proof for `audit ontology-url` (issue
 * #3824 AC5). This is NOT a cyclic metric: the verdict is driven purely by the
 * on-disk `exo__Ontology_url` value. We physically REMOVE the trailing `#` from
 * a real exocortex.my ontology (audit must FAIL=1 violation), then RESTORE it
 * (audit must PASS=0). If the audit reported 0 in BOTH states it would be a
 * false-positive guard — this test would catch that.
 */
describe("audit ontology-url — revert→fail / restore→pass (integration)", () => {
  let vault: string;
  let ontoDir: string;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `onturl-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    ontoDir = join(vault, "assetspaces", "kitelev", "exoas-public", "ems");
    mkdirSync(vault, { recursive: true });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("@req:df6c979e-d432-4ce8-b652-aff31cba151c GREEN with trailing '#', RED when removed, GREEN when restored", async () => {
    const uid = "aaaa1111-2222-3333-4444-555555555555";

    // --- State 1: canonical (trailing '#') → audit GREEN (0 violations) ---
    writeOntology(ontoDir, uid, "https://exocortex.my/ontology/ems#");
    let r = await scanVaultForOntologyUrl(vault);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBe(1);

    // --- State 2: revert — REMOVE the '#' → audit RED (1 violation) ---
    writeOntology(ontoDir, uid, "https://exocortex.my/ontology/ems");
    r = await scanVaultForOntologyUrl(vault);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].path).toBe(
      "assetspaces/kitelev/exoas-public/ems/" + uid + ".md",
    );
    expect(r.violations[0].url).toBe("https://exocortex.my/ontology/ems");
    expect(r.violations[0].expected).toBe("https://exocortex.my/ontology/ems#");

    // --- State 3: restore the '#' → audit GREEN again (0 violations) ---
    writeOntology(ontoDir, uid, "https://exocortex.my/ontology/ems#");
    r = await scanVaultForOntologyUrl(vault);
    expect(r.violations).toHaveLength(0);
  });
});

/**
 * Full-vault acceptance (issue #3824 AC1–AC4) over a mixed real ontology set,
 * driven end-to-end through the Commander action (output + exit code).
 */
describe("audit ontology-url — mixed-vault acceptance (integration)", () => {
  let vault: string;
  let logSpy: ReturnType<typeof jest.spyOn>;
  let errSpy: ReturnType<typeof jest.spyOn>;
  let prevExit: number | undefined;

  beforeEach(() => {
    vault = join(
      tmpdir(),
      `onturl-mixed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(vault, { recursive: true });
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

  const emsDir = () =>
    join(vault, "assetspaces", "kitelev", "exoas-public", "ems");
  const w3cDir = () =>
    join(vault, "assetspaces", "kitelev", "exoas-w3c", "w3c");
  const periodDir = () =>
    join(vault, "assetspaces", "kitelev", "exoas-public", "kitelev-period");

  it("AC1 flags a hash-less exocortex.my ontology with the expected form; AC2 skips a foreign vocab; AC3 passes a hierarchical-path sub-ontology; exit 1", async () => {
    // AC1: exocortex.my WITHOUT '#' → violation
    writeOntology(
      emsDir(),
      "bad00000-0000-0000-0000-000000000001",
      "https://exocortex.my/ontology/ems",
    );
    // AC2: foreign vocab (w3.org) → skipped (foreign-vocab), NEVER a violation
    writeOntology(
      w3cDir(),
      "for00000-0000-0000-0000-000000000002",
      "https://www.w3.org/2000/01/rdf-schema#",
    );
    // AC3: hierarchical-path sub-ontology WITH '#' → passes
    writeOntology(
      periodDir(),
      "sub00000-0000-0000-0000-000000000003",
      "https://exocortex.my/ontology/kitelev-period/quarters#",
    );

    const r = await scanVaultForOntologyUrl(vault);
    expect(r.ontologiesFound).toBe(3);
    expect(r.checked).toBe(2); // ems (bad) + quarters (ok); w3c skipped
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].url).toBe("https://exocortex.my/ontology/ems");
    expect(r.violations[0].expected).toBe("https://exocortex.my/ontology/ems#");
    expect(r.skips["foreign-vocab"]).toBe(1);

    // Drive the command action → text output + exit code 1
    const cmd = auditOntologyUrlCommand();
    await cmd.parseAsync(["--vault", vault], { from: "user" });
    expect(process.exitCode).toBe(1);
    const err = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(err).toMatch(/1 ontology-url violation/);
    expect(err).toMatch(/expected=https:\/\/exocortex\.my\/ontology\/ems#/);
    expect(err).toMatch(/foreign-vocab=1/);
  });

  it("AC4 all-normalized vault → zero violations + exit 0", async () => {
    writeOntology(
      emsDir(),
      "ok000000-0000-0000-0000-000000000010",
      "https://exocortex.my/ontology/ems#",
    );
    writeOntology(
      periodDir(),
      "ok000000-0000-0000-0000-000000000011",
      "https://exocortex.my/ontology/kitelev-period/quarters#",
    );
    // A foreign vocab is present but must not affect the exit code.
    writeOntology(
      w3cDir(),
      "ok000000-0000-0000-0000-000000000012",
      "http://www.w3.org/2002/07/owl#",
    );

    const cmd = auditOntologyUrlCommand();
    await cmd.parseAsync(["--vault", vault], { from: "user" });
    expect(process.exitCode).toBeFalsy();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/0 ontology-url violations/);
  });

  it("json output emits structured result with expected canonical form", async () => {
    writeOntology(
      emsDir(),
      "bad00000-0000-0000-0000-000000000020",
      "https://exocortex.my/ontology/ems",
    );
    const cmd = auditOntologyUrlCommand();
    await cmd.parseAsync(["--vault", vault, "--output", "json"], {
      from: "user",
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.violationCount).toBe(1);
    expect(parsed.clean).toBe(false);
    expect(parsed.violations[0].expected).toBe(
      "https://exocortex.my/ontology/ems#",
    );
    expect(parsed.skips).toBeDefined();
  });
});
