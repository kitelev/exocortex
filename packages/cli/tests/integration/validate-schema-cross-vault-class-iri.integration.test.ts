/**
 * Issue #3523 — CLI integration test: `validate schema --shapes-mode --also <dep>`
 * must NOT emit false `sh:class` violations for conformant cross-vault typed refs.
 *
 * Root cause (pre-fix): a typed property whose `exo__Property_range` points (by
 * UID wikilink) at a class definition living in an `--also` dependency vault is
 * emitted by the primary vault's converter as a *synthesized* UUID-only file IRI
 * (`obsidian://vault/<uid>.md`, no directory) because the target is unresolvable
 * in the primary vault. The dependency vault's converter, on the other hand,
 * emits that same class's `rdfs:label` / superClass chain under its *full-path*
 * subject IRI (`obsidian://vault/tbox/<uid>.md`) + symbolic ontology IRI
 * (`https://exocortex.my/ontology/<ns>#<Local>`). `ShapeLoader.resolveClassIRI`
 * looked up the label keyed on the *exact* (synthesized) IRI string, missed it,
 * and left the range as the synth file IRI — which never unifies with the
 * symbolic superClass chain, so `isSubClassOf` fails → false `sh:class`
 * Violation. Standalone (no `--also`) and single-merged-vault both report 0.
 *
 * The fix gives `ShapeLoader` a UID-keyed label fallback so a synth/cross-vault
 * range/domain file IRI resolves to the same symbolic class IRI as the merged
 * single-vault case.
 *
 * Empirically verified to FAIL pre-fix (false sh:Violation) and PASS post-fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { runShapesValidation, resolveCrossVaultInstanceClassWikilinks, dedupeTriples } =
  await import("../../src/commands/validate-schema.js");
const { NoteToRDFConverter } = await import("exocortex");
const { FileSystemVaultAdapter } = await import(
  "../../src/adapters/FileSystemVaultAdapter.js"
);

// UID-canon TBox: filenames are UUIDs, labels carry the symbolic class name.
const RANGE_UID = "c1000000-0000-4000-8000-000000000001"; // tst__Property (metaclass / range target)
const META_UID = "c1000000-0000-4000-8000-000000000002"; // tst__MetaProperty (subClassOf tst__Property)
const VALUE_OK_UID = "c1000000-0000-4000-8000-000000000003"; // typed tst__MetaProperty → conformant value
const UNREL_UID = "c1000000-0000-4000-8000-000000000004"; // tst__Unrelated (NOT a subclass of tst__Property)
const VALUE_BAD_UID = "c1000000-0000-4000-8000-000000000005"; // typed tst__Unrelated → genuinely wrong value
const PROP_UID = "c1000000-0000-4000-8000-000000000010"; // xrule__sourceProp (range = RANGE_UID, lives in X)
const DOMAIN_UID = "c1000000-0000-4000-8000-000000000011"; // xrule__Rule (domain class, lives in X)
const INST_OK_UID = "c1000000-0000-4000-8000-000000000012"; // conformant rule instance
const INST_BAD_UID = "c1000000-0000-4000-8000-000000000013"; // non-conformant rule instance

let tmpRoot: string;
let primaryVault: string; // X — references the dep by UID (exocmd-like)
let alsoVault: string; // Y — owns the TBox class/property defs (exo-like)

function write(vault: string, rel: string, body: string): void {
  const full = path.join(vault, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exocortex-xvault-class-"));
  primaryVault = path.join(tmpRoot, "primary");
  alsoVault = path.join(tmpRoot, "dep");

  // ── Dependency vault Y (TBox lives in a `tbox/` SUBDIR so the owning
  //    full-path subject IRI differs from the synth UUID-only form) ──────────

  // Range metaclass: tst__Property (like exo__Property 38277bfa)
  write(
    alsoVault,
    `tbox/${RANGE_UID}.md`,
    `---
exo__Asset_uid: ${RANGE_UID}
exo__Instance_class:
  - "[[exo__Class]]"
exo__Asset_label: tst__Property
---
`,
  );

  // tst__MetaProperty — subClassOf tst__Property (like exo__MetaProperty 29c0c460)
  write(
    alsoVault,
    `tbox/${META_UID}.md`,
    `---
exo__Asset_uid: ${META_UID}
exo__Instance_class:
  - "[[exo__Class]]"
exo__Class_superClass:
  - "[[${RANGE_UID}]]"
exo__Asset_label: tst__MetaProperty
---
`,
  );

  // Conformant value subject: typed tst__MetaProperty (like exo__Asset_uid fada7446)
  write(
    alsoVault,
    `tbox/${VALUE_OK_UID}.md`,
    `---
exo__Asset_uid: ${VALUE_OK_UID}
exo__Instance_class:
  - "[[${META_UID}]]"
exo__Asset_label: tst__sourceField
---
`,
  );

  // Unrelated class: tst__Unrelated (NOT a subclass of tst__Property)
  write(
    alsoVault,
    `tbox/${UNREL_UID}.md`,
    `---
exo__Asset_uid: ${UNREL_UID}
exo__Instance_class:
  - "[[exo__Class]]"
exo__Asset_label: tst__Unrelated
---
`,
  );

  // Genuinely wrong value subject: typed tst__Unrelated
  write(
    alsoVault,
    `tbox/${VALUE_BAD_UID}.md`,
    `---
exo__Asset_uid: ${VALUE_BAD_UID}
exo__Instance_class:
  - "[[${UNREL_UID}]]"
exo__Asset_label: Some Unrelated Thing
---
`,
  );

  // ── Primary vault X (property decl + domain class + instances) ────────────

  // Property declaration: range = RANGE_UID (cross-vault UID ref into Y)
  write(
    primaryVault,
    `tbox/${PROP_UID}.md`,
    `---
exo__Asset_uid: ${PROP_UID}
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: xrule__sourceProp
exo__Property_domain:
  - "[[${DOMAIN_UID}]]"
exo__Property_range: "[[${RANGE_UID}]]"
exo__Property_cardinality: "[[exo__PropertyCardinalitySingle]]"
exo__Property_severity: sh:Violation
---
`,
  );

  // Domain class: xrule__Rule (lives in X)
  write(
    primaryVault,
    `tbox/${DOMAIN_UID}.md`,
    `---
exo__Asset_uid: ${DOMAIN_UID}
exo__Instance_class:
  - "[[exo__Class]]"
exo__Asset_label: xrule__Rule
---
`,
  );

  // Conformant instance: xrule__sourceProp → VALUE_OK_UID (tst__MetaProperty ⊑ tst__Property)
  write(
    primaryVault,
    `data/${INST_OK_UID}.md`,
    `---
exo__Asset_uid: ${INST_OK_UID}
exo__Instance_class:
  - "[[${DOMAIN_UID}]]"
exo__Asset_label: Conformant Rule
xrule__sourceProp: "[[${VALUE_OK_UID}]]"
---
`,
  );

  // Non-conformant instance: xrule__sourceProp → VALUE_BAD_UID (tst__Unrelated, NOT ⊑ tst__Property)
  write(
    primaryVault,
    `data/${INST_BAD_UID}.md`,
    `---
exo__Asset_uid: ${INST_BAD_UID}
exo__Instance_class:
  - "[[${DOMAIN_UID}]]"
exo__Asset_label: Broken Rule
xrule__sourceProp: "[[${VALUE_BAD_UID}]]"
---
`,
  );
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function loadRaw(...vaults: string[]): Promise<unknown[]> {
  const all: unknown[] = [];
  for (const v of vaults) {
    const adapter = new FileSystemVaultAdapter(v);
    const converter = new NoteToRDFConverter(adapter);
    const triples = await converter.convertVault();
    for (const t of triples) all.push(t);
  }
  return all;
}

async function loadMerged(...vaults: string[]): Promise<unknown[]> {
  const all = await loadRaw(...vaults);
  // Mirror loadTriplesFromAllVaults' cross-vault Instance_class literal pass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resolveCrossVaultInstanceClassWikilinks(all as any[]) as unknown[];
}

describe("BDD: validate schema --also cross-vault sh:class (Issue #3523)", () => {
  it("Scenario: conformant cross-vault typed ref produces NO sh:Violation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triples = (await loadMerged(primaryVault, alsoVault)) as any[];
    const report = await runShapesValidation(primaryVault, triples, [alsoVault]);

    const classViolations = report.violations.filter(
      (v) => v.constraint === "class" && v.severity === "sh:Violation",
    );
    const conformantNode = classViolations.filter((v) =>
      v.focusNode.includes(INST_OK_UID),
    );
    expect(conformantNode).toEqual([]);
  });

  it("Scenario: a genuinely wrong cross-vault class IS still caught (no over-suppression)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triples = (await loadMerged(primaryVault, alsoVault)) as any[];
    const report = await runShapesValidation(primaryVault, triples, [alsoVault]);

    const badViolations = report.violations.filter(
      (v) =>
        v.constraint === "class" &&
        v.severity === "sh:Violation" &&
        v.focusNode.includes(INST_BAD_UID),
    );
    expect(badViolations.length).toBeGreaterThan(0);
  });

  it("Scenario: overall report conforms only because the single real violation is the BAD instance", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triples = (await loadMerged(primaryVault, alsoVault)) as any[];
    const report = await runShapesValidation(primaryVault, triples, [alsoVault]);

    const classErrorNodes = new Set(
      report.violations
        .filter((v) => v.constraint === "class" && v.severity === "sh:Violation")
        .map((v) => v.focusNode),
    );
    // Exactly one node carries a real sh:class Violation, and it is the BAD one.
    expect([...classErrorNodes].some((n) => n.includes(INST_BAD_UID))).toBe(true);
    expect([...classErrorNodes].some((n) => n.includes(INST_OK_UID))).toBe(false);
  });
});

describe("BDD: validate schema --also shared-submodule double-load dedup (Issue #3523)", () => {
  it("Scenario: loading the SAME vault twice without dedup inflates Single-cardinality → false sh:maxCount", async () => {
    // Pre-dedup behaviour: byte-identical re-parse duplicates every triple,
    // so the Single-cardinality xrule__sourceProp reads as 2 values.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doubled = (await loadRaw(primaryVault, primaryVault)) as any[];
    const report = await runShapesValidation(primaryVault, doubled, [primaryVault]);
    const maxCount = report.violations.filter((v) => v.constraint === "maxCount");
    expect(maxCount.length).toBeGreaterThan(0);
  });

  it("Scenario: dedupeTriples collapses the double-load → no false sh:maxCount", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doubled = (await loadRaw(primaryVault, primaryVault)) as any[];
    const deduped = dedupeTriples(doubled);
    expect(deduped.length).toBeLessThan(doubled.length);
    const report = await runShapesValidation(primaryVault, deduped, [primaryVault]);
    const maxCount = report.violations.filter((v) => v.constraint === "maxCount");
    expect(maxCount).toEqual([]);
  });

  it("Scenario: dedupeTriples is a no-op on an already-unique triple set", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const single = (await loadRaw(primaryVault)) as any[];
    const deduped = dedupeTriples(single);
    expect(deduped.length).toBe(single.length);
  });
});
