import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanVaultForOntologyMembership,
  auditOntologyMembershipCommand,
  ONTOLOGY_CLASS_UID,
} from "../../../src/commands/audit-ontology-membership.js";
import { auditCommand } from "../../../src/commands/audit.js";

// ---- real class UIDs (verified on origin/main, vault-my) ----
const CONCEPT = "dda12c48-6886-4624-8710-ed4ba92ce2b3"; // concept__Concept
const PROPERTY = "38277bfa-d7f9-4a75-b856-b23276ab0db3"; // exo__Property
const OBJECT_PROPERTY = "9a1cf31c-9d41-4ef3-9023-584a8d087d16"; // exo__ObjectProperty ⊑ exo__Property
const EXO_CLASS = "8619c4fc-64f1-4869-b17e-e34186cacca9"; // exo__Class metaclass
const EMS_TASK = "1b20a8f0-d745-4e93-91db-4531b3df120e"; // ems__Task (a non-concept class)

// ---- synthetic fixture UIDs ----
const O1 = "11111111-1111-4111-8111-111111111111"; // concept ontology, admits [concept, ontology]
const O2 = "22222222-2222-4222-8222-222222222222"; // metaclass ontology, admits [property, ontology]
const O3 = "33333333-3333-4333-8333-333333333333"; // ontology with NO admits (fail-open)
const C1 = "aaaa0001-0000-4000-8000-000000000001"; // concept member of O1 (direct match)
const V1 = "aaaa0002-0000-4000-8000-000000000002"; // ems__Task member of O1 (VIOLATION)
const M2 = "aaaa0003-0000-4000-8000-000000000003"; // ObjectProperty member of O2 (subsumption)
const M3 = "aaaa0004-0000-4000-8000-000000000004"; // ems__Task member of O3 (fail-open skip)

interface AssetSpec {
  uid: string;
  label?: string;
  isDefinedBy?: string; // raw string, e.g. `[[<uid>]]` or `[[!exo]]`
  instanceClass?: string[]; // class UIDs
  admits?: string[]; // exo__Ontology_admits class UIDs
  superClass?: string[]; // exo__Class_superClass class UIDs
}

function writeAsset(dir: string, spec: AssetSpec): void {
  mkdirSync(dir, { recursive: true });
  const lines = [
    "---",
    `exo__Asset_uid: ${spec.uid}`,
    `exo__Asset_label: "${spec.label ?? `Asset ${spec.uid}`}"`,
  ];
  if (spec.instanceClass) {
    lines.push("exo__Instance_class:");
    for (const c of spec.instanceClass) lines.push(`  - "[[${c}]]"`);
  }
  if (spec.isDefinedBy !== undefined) {
    lines.push(`exo__Asset_isDefinedBy: "${spec.isDefinedBy}"`);
  }
  if (spec.admits) {
    lines.push("exo__Ontology_admits:");
    for (const a of spec.admits) lines.push(`  - "[[${a}]]"`);
  }
  if (spec.superClass) {
    lines.push("exo__Class_superClass:");
    for (const s of spec.superClass) lines.push(`  - "[[${s}]]"`);
  }
  lines.push("---", "", "Body.", "");
  writeFileSync(join(dir, `${spec.uid}.md`), lines.join("\n"), "utf-8");
}

/**
 * Build a fixture vault exercising every axis of the membership ratchet:
 *   O1 admits [concept__Concept, exo__Ontology] — a concept member (C1) is
 *      admitted directly, the self-anchor is admitted (F10), an ems__Task
 *      member (V1) is the ONLY violation.
 *   O2 admits [exo__Property, exo__Ontology] — an exo__ObjectProperty member
 *      (M2) is admitted via the superClass walk (F9 metaclass-mixing).
 *   O3 declares NO admits — its ems__Task member (M3) and its own anchor are
 *      SKIPPED (fail-open, audit-first).
 */
function buildFixture(dir: string): void {
  // O1 — concept ontology (self-anchored). F10: admits exo__Ontology so the
  // anchor is a legitimate self-member.
  writeAsset(dir, {
    uid: O1,
    label: "O1 (concepts)",
    instanceClass: [ONTOLOGY_CLASS_UID],
    isDefinedBy: `[[${O1}]]`,
    admits: [CONCEPT, ONTOLOGY_CLASS_UID],
  });
  writeAsset(dir, {
    uid: C1,
    label: "A concept",
    instanceClass: [CONCEPT],
    isDefinedBy: `[[${O1}]]`,
  });
  writeAsset(dir, {
    uid: V1,
    label: "A misfiled task (violation)",
    instanceClass: [EMS_TASK],
    isDefinedBy: `[[${O1}]]`,
  });

  // O2 — metaclass ontology; admits exo__Property (subclasses admitted via walk).
  writeAsset(dir, {
    uid: O2,
    label: "O2 (property TBox)",
    instanceClass: [ONTOLOGY_CLASS_UID],
    isDefinedBy: `[[${O2}]]`,
    admits: [PROPERTY, ONTOLOGY_CLASS_UID],
  });
  writeAsset(dir, {
    uid: M2,
    label: "An object property",
    instanceClass: [OBJECT_PROPERTY],
    isDefinedBy: `[[${O2}]]`,
  });
  // The exo__ObjectProperty class-def — needed so the superClass walk can reach
  // exo__Property. Not a member of any admits-ontology (bang-anchored → skipped).
  writeAsset(dir, {
    uid: OBJECT_PROPERTY,
    label: "exo__ObjectProperty",
    instanceClass: [EXO_CLASS],
    isDefinedBy: "[[!exo]]",
    superClass: [PROPERTY],
  });

  // O3 — declares NO admits (audit-first / fail-open).
  writeAsset(dir, {
    uid: O3,
    label: "O3 (no allow-list)",
    instanceClass: [ONTOLOGY_CLASS_UID],
    isDefinedBy: `[[${O3}]]`,
  });
  writeAsset(dir, {
    uid: M3,
    label: "A task under an un-gated ontology",
    instanceClass: [EMS_TASK],
    isDefinedBy: `[[${O3}]]`,
  });
}

describe("audit ontology-membership — @req:c23f6f50-0867-4fa9-90c7-f768199e7fa9 (KSD ArchUnit cohesion ratchet)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `audit-membership-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    buildFixture(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("flags exactly the misfiled member (ems__Task under a concept ontology) and nothing else", async () => {
    const r = await scanVaultForOntologyMembership(dir);

    expect(r.ontologies).toBe(3);
    expect(r.ontologiesWithAdmits).toBe(2); // O1, O2 (O3 has none)
    expect(r.violations).toHaveLength(1);

    const v = r.violations[0];
    expect(v.path).toBe(`${V1}.md`);
    expect(v.ontologyUid).toBe(O1);
    expect(v.classUids).toContain(EMS_TASK);
    expect(v.admits).toEqual(expect.arrayContaining([CONCEPT, ONTOLOGY_CLASS_UID]));

    // none of the LEGITIMATE members/anchors are flagged
    const flagged = r.violations.map((x) => x.path);
    expect(flagged).not.toContain(`${C1}.md`); // direct concept match
    expect(flagged).not.toContain(`${O1}.md`); // F10 self-anchor
    expect(flagged).not.toContain(`${M2}.md`); // F9 subsumption
    expect(flagged).not.toContain(`${O2}.md`); // F10 self-anchor
    expect(flagged).not.toContain(`${M3}.md`); // fail-open (no admits)
  });

  it("admits a subclass via the superClass walk (F9 — admits exo__Property covers exo__ObjectProperty)", async () => {
    const r = await scanVaultForOntologyMembership(dir);
    // M2 (exo__ObjectProperty) under O2 (admits exo__Property) must NOT violate:
    // subsumption resolves exo__ObjectProperty ⊑ exo__Property in TS (dual-IRI:
    // pure SPARQL cannot walk it). This is the only member of O2 besides its
    // self-anchor, so O2 contributes 0 violations.
    expect(r.violations.some((v) => v.ontologyUid === O2)).toBe(false);
    expect(r.checked).toBeGreaterThanOrEqual(2); // M2 + O2 anchor were checked
  });

  it("skips every member of an ontology that declares no admits (fail-open, audit-first)", async () => {
    const r = await scanVaultForOntologyMembership(dir);
    // O3 has no exo__Ontology_admits → M3 (ems__Task) and the O3 anchor are
    // skipped, never violations (the ratchet only bites opted-in ontologies).
    expect(r.violations.some((v) => v.path === `${M3}.md`)).toBe(false);
    // M3 + O3 anchor → at least 2 no-admits skips
    expect(r.skips["ontology-no-admits"]).toBeGreaterThanOrEqual(2);
  });

  it("admits the ontology's own self-anchor when the allow-list includes exo__Ontology (F10)", async () => {
    const r = await scanVaultForOntologyMembership(dir);
    // O1 admits exo__Ontology, so its own anchor (an exo__Ontology instance
    // co-located under itself) is a legitimate self-member, not a false positive.
    expect(r.violations.some((v) => v.path === `${O1}.md`)).toBe(false);
    expect(r.violations.some((v) => v.path === `${O2}.md`)).toBe(false);
  });

  it("audit ontology-membership sets exit code 1 on a violation, 0 when clean", async () => {
    // violating fixture → exit 1
    const prev = process.exitCode;
    process.exitCode = 0;
    try {
      const cmd = auditCommand();
      await cmd.parseAsync(
        ["ontology-membership", "--vault", dir, "--output", "json"],
        { from: "user" },
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prev;
    }

    // remove the only violation → clean → exit 0
    rmSync(join(dir, `${V1}.md`), { force: true });
    process.exitCode = 0;
    try {
      const cmd2 = auditOntologyMembershipCommand();
      await cmd2.parseAsync(["--vault", dir, "--output", "json"], {
        from: "user",
      });
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = prev;
    }
  });
});
