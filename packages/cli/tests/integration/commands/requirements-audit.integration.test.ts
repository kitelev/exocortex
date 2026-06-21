import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import {
  loadRequirements,
  scanTestTags,
  auditTraceability,
} from "../../../src/commands/requirements-audit.js";

const REQ_CLASS_UID = "8c5af681-3413-4219-8636-0ac229d1b253";
const UID_P0_INT = "449f29ce-cbd5-4ac8-94d4-28aa56a013c2";
const UID_P0_UNIT_ONLY = "11111111-1111-4111-8111-111111111111";
const UID_P1 = "f640c8f8-3d29-43da-8610-0187ac488876";

interface ReqSpec {
  uid: string;
  label?: string;
  priority?: string; // "P0".."P3"
  bindingClasses?: string[]; // ["Unit","Integration",...] local-name suffixes
  status?: string;
  evidence?: string[]; // req__Requirement_evidence paths (rel. to the req dir)
}

/** Write a req__Requirement ABox asset that mirrors the P0 seed shape. */
function writeRequirement(dir: string, spec: ReqSpec): void {
  mkdirSync(dir, { recursive: true });
  const lines = [
    "---",
    `exo__Asset_uid: ${spec.uid}`,
    `exo__Asset_isDefinedBy: "[[anchor]]"`,
    "exo__Instance_class:",
    `  - "[[${REQ_CLASS_UID}|req__Requirement]]"`,
    `exo__Asset_label: "${spec.label ?? `req(exo): behavior ${spec.uid}`}"`,
    `req__Requirement_status: "[[s|req__RequirementStatus${spec.status ?? "Draft"}]]"`,
    `req__Requirement_priority: "[[p|req__RequirementPriority${spec.priority ?? "P0"}]]"`,
  ];
  const classes = spec.bindingClasses ?? ["Integration"];
  if (classes.length > 0) {
    lines.push("req__Requirement_bindingClass:");
    for (const c of classes) {
      lines.push(`  - "[[b|req__RequirementBindingClass${c}]]"`);
    }
  }
  if (spec.evidence && spec.evidence.length > 0) {
    lines.push("req__Requirement_evidence:");
    for (const e of spec.evidence) {
      lines.push(`  - "${e}"`);
    }
  }
  lines.push("---", "", "## Statement (Gherkin)", "");
  writeFileSync(join(dir, `${spec.uid}.md`), lines.join("\n"), "utf-8");
}

/** Write a committed evidence artifact at a path relative to the req dir. */
function writeEvidence(reqDir: string, relPath: string): void {
  const abs = join(reqDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "# evidence attestation\n", "utf-8");
}

/** Write a non-requirement asset (assetspace anchor) — must be ignored. */
function writeAnchor(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "anchor.md"),
    [
      "---",
      "exo__Asset_uid: anchor",
      'exo__Instance_class:',
      '  - "[[829b9b3b-6fc3-4276-be6a-27d3398c012e]]"',
      "exo__Asset_label: $exo-reqs",
      "---",
      "",
      "Anchor body.",
    ].join("\n"),
    "utf-8",
  );
}

function writeTest(dir: string, name: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, "utf-8");
}

describe("requirements audit — IO end-to-end (integration)", () => {
  let reqsDir: string;
  let testsDir: string;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    reqsDir = join(tmpdir(), `reqs-audit-reqs-${stamp}`);
    testsDir = join(tmpdir(), `reqs-audit-tests-${stamp}`);
    mkdirSync(reqsDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(reqsDir, { recursive: true, force: true });
    rmSync(testsDir, { recursive: true, force: true });
  });

  it("loadRequirements picks up requirement assets and ignores the anchor", async () => {
    writeRequirement(join(reqsDir, "exo-reqs"), { uid: UID_P0_INT });
    writeRequirement(join(reqsDir, "exo-reqs"), {
      uid: UID_P1,
      priority: "P1",
      bindingClasses: ["Unit"],
    });
    writeAnchor(join(reqsDir, "exo-reqs"));

    const reqs = await loadRequirements(reqsDir);
    expect(reqs.map((r) => r.uid).sort()).toEqual([UID_P0_INT, UID_P1].sort());
    const p0 = reqs.find((r) => r.uid === UID_P0_INT)!;
    expect(p0.priority).toBe("P0");
    expect(p0.bindingClasses).toEqual(["integration"]);
    expect(p0.status).toBe("Draft");
  });

  it("scanTestTags extracts @req tags from .test.ts / .spec.ts only", async () => {
    writeTest(
      join(testsDir, "a"),
      "a.test.ts",
      `it("@req:${UID_P0_INT} does thing", () => {});`,
    );
    writeTest(
      join(testsDir, "b"),
      "b.spec.ts",
      `test("@req:${UID_P1} other", () => {});`,
    );
    // Non-test file with a tag — must NOT be scanned.
    writeTest(join(testsDir, "c"), "helper.ts", `// @req:${UID_P0_UNIT_ONLY}`);

    const tags = await scanTestTags(testsDir);
    expect(tags.map((t) => t.uid).sort()).toEqual([UID_P0_INT, UID_P1].sort());
  });

  it("end-to-end: orphan + dangling + duplicate + floor over real files", async () => {
    // P0 integration-bound (will be bound), P0 unit-only (floor violation),
    // P1 unit-only (no floor), plus an orphan P0 with no tag.
    writeRequirement(join(reqsDir, "exo-reqs"), { uid: UID_P0_INT });
    writeRequirement(join(reqsDir, "exo-reqs"), {
      uid: UID_P0_UNIT_ONLY,
      priority: "P0",
      bindingClasses: ["Unit"],
    });
    writeRequirement(join(reqsDir, "exo-reqs"), {
      uid: UID_P1,
      priority: "P1",
      bindingClasses: ["Unit"],
    });

    const danglingUid = "deadbeef-0000-4000-8000-000000000000";
    writeTest(
      join(testsDir, "x"),
      "x.test.ts",
      [
        `it("@req:${UID_P0_INT} bound", () => {});`,
        `it("@req:${UID_P0_UNIT_ONLY} unit-only-bound", () => {});`,
        `it("@req:${danglingUid} stale tag", () => {});`,
      ].join("\n"),
    );
    // duplicate binding of UID_P0_INT in a second file
    writeTest(
      join(testsDir, "y"),
      "y.test.ts",
      `it("@req:${UID_P0_INT} duplicate claim", () => {});`,
    );

    const [reqs, tags] = await Promise.all([
      loadRequirements(reqsDir),
      scanTestTags(testsDir),
    ]);
    const report = auditTraceability(reqs, tags);

    expect(report.requirementCount).toBe(3);
    // UID_P1 has no tag → orphan
    expect(report.orphans.map((o) => o.uid)).toEqual([UID_P1]);
    // dangling tag
    expect(report.dangling.map((d) => d.uid)).toEqual([danglingUid]);
    // UID_P0_INT claimed twice → duplicate
    expect(report.duplicates.map((d) => d.uid)).toEqual([UID_P0_INT]);
    // UID_P0_UNIT_ONLY is P0 bound solely to unit → floor violation
    expect(report.floorViolations.map((f) => f.uid)).toEqual([UID_P0_UNIT_ONLY]);
    // hard findings present → not clean
    expect(report.clean).toBe(false);
  });

  it("end-to-end: ramp-ready when every P0 is bound, NOT ready when one is orphaned", async () => {
    // Two P0 requirements, both with a real-prod floor.
    writeRequirement(join(reqsDir, "exo-reqs"), { uid: UID_P0_INT });
    const UID_P0_SECOND = "22222222-2222-4222-8222-222222222222";
    writeRequirement(join(reqsDir, "exo-reqs"), {
      uid: UID_P0_SECOND,
      bindingClasses: ["E2e"],
    });

    // First pass: only one is bound → P0 orphan → NOT ramp-ready.
    writeTest(
      join(testsDir, "x"),
      "x.test.ts",
      `it("@req:${UID_P0_INT} bound", () => {});`,
    );
    {
      const [reqs, tags] = await Promise.all([
        loadRequirements(reqsDir),
        scanTestTags(testsDir),
      ]);
      const report = auditTraceability(reqs, tags);
      expect(report.p0Total).toBe(2);
      expect(report.p0Bound).toBe(1);
      expect(report.p0Orphans).toBe(1);
      expect(report.rampReady).toBe(false);
      // clean is still true — the P0 orphan is a soft warning
      expect(report.clean).toBe(true);
    }

    // Second pass: bind the second P0 → ramp becomes ready.
    writeTest(
      join(testsDir, "y"),
      "y.test.ts",
      `it("@req:${UID_P0_SECOND} now bound", () => {});`,
    );
    {
      const [reqs, tags] = await Promise.all([
        loadRequirements(reqsDir),
        scanTestTags(testsDir),
      ]);
      const report = auditTraceability(reqs, tags);
      expect(report.p0Bound).toBe(2);
      expect(report.p0Orphans).toBe(0);
      expect(report.rampReady).toBe(true);
    }
  });

  it("loadRequirements resolves evidence: present file → resolves, absent → evidenceMissing", async () => {
    const subDir = join(reqsDir, "exo-reqs");
    const UID_OK = "22222222-2222-4222-8222-222222222222";
    const UID_MISSING = "33333333-3333-4333-8333-333333333333";
    writeRequirement(subDir, {
      uid: UID_OK,
      bindingClasses: ["UiAcceptance"],
      evidence: ["evidence/present.md"],
    });
    writeEvidence(subDir, "evidence/present.md");
    writeRequirement(subDir, {
      uid: UID_MISSING,
      bindingClasses: ["UiAcceptance"],
      evidence: ["evidence/absent.md"],
    });

    const reqs = await loadRequirements(reqsDir);
    const ok = reqs.find((r) => r.uid === UID_OK)!;
    const missing = reqs.find((r) => r.uid === UID_MISSING)!;
    expect(ok.evidence).toEqual(["evidence/present.md"]);
    expect(ok.evidenceMissing).toEqual([]);
    expect(missing.evidence).toEqual(["evidence/absent.md"]);
    expect(missing.evidenceMissing).toEqual(["evidence/absent.md"]);
  });

  it("end-to-end: an active ui-acceptance req with a committed evidence link is clean; reverting the file makes it red", async () => {
    const subDir = join(reqsDir, "exo-reqs");
    const UID_UIA = "44444444-4444-4444-8444-444444444444";
    writeRequirement(subDir, {
      uid: UID_UIA,
      priority: "P1",
      status: "Active",
      bindingClasses: ["UiAcceptance"],
      evidence: ["evidence/uia.md"],
    });
    writeEvidence(subDir, "evidence/uia.md");

    {
      const reqs = await loadRequirements(reqsDir);
      const report = auditTraceability(reqs, []);
      expect(report.uiAcceptanceTotal).toBe(1);
      expect(report.uiAcceptanceEvidenced).toBe(1);
      expect(report.activeViolations).toHaveLength(0);
      expect(report.clean).toBe(true);
    }

    // Revert: remove the committed evidence artifact → active gate goes red.
    rmSync(join(subDir, "evidence/uia.md"));
    {
      const reqs = await loadRequirements(reqsDir);
      const report = auditTraceability(reqs, []);
      expect(report.uiAcceptanceEvidenced).toBe(0);
      expect(report.danglingEvidence.map((e) => e.uid)).toEqual([UID_UIA]);
      expect(report.activeViolations.map((a) => a.uid)).toEqual([UID_UIA]);
      expect(report.clean).toBe(false);
    }
  });
});
