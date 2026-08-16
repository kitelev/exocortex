import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadRequirements, auditTraceability } from "../../src/audit.js";
import {
  extractGateScript,
  runBlockingGate,
} from "../helpers/blocking-gate.js";

/**
 * Population floor for the always-on active-gate — req
 * `99e06488-2da6-48fe-bd64-30c1e20bca0f`.
 *
 * The gate's blocking step reports "✅ Active-gate OK" whenever `activeViolations`
 * is empty — which is ALSO what a corpus that never arrived looks like, because a
 * requirement is detected purely by the PRESENCE of a `req__Requirement_status`
 * predicate. Measured on `origin/main` f116f447 against the real clones: an empty
 * corpus and a corpus whose predicate was renamed in all 172 files BOTH produced
 * `BLOCKING GATE EXIT: 0`.
 *
 * Two independent axes are bound here, per the revert-verify discipline:
 *   (a) the AUDIT reports the broken input (`inputIntegrityViolation`);
 *   (b) the real blocking step in `.github/workflows/ci.yml` ACTS on it.
 * Axis (b) drives the workflow's own `node -e` script, extracted from the YAML —
 * never a hand-kept copy, which would only verify itself.
 */

const REQ_CLASS_UID = "8c5af681-3413-4219-8636-0ac229d1b253";
const UID_ACTIVE = "449f29ce-cbd5-4ac8-94d4-28aa56a013c2";
const UID_SECOND = "830ef788-0631-42cf-8b78-481ec6cfdeac";

interface ReqSpec {
  uid: string;
  status?: string;
  /** Overrides the frontmatter key carrying the status (the detection predicate). */
  statusKey?: string;
  /** Overrides `exo__Instance_class` (the property the audit deliberately ignores). */
  instanceClassUid?: string;
}

function writeRequirement(dir: string, spec: ReqSpec): void {
  mkdirSync(dir, { recursive: true });
  const statusKey = spec.statusKey ?? "req__Requirement_status";
  const lines = [
    "---",
    `exo__Asset_uid: ${spec.uid}`,
    `exo__Asset_isDefinedBy: "[[anchor]]"`,
    "exo__Instance_class:",
    `  - "[[${spec.instanceClassUid ?? REQ_CLASS_UID}|req__Requirement]]"`,
    `exo__Asset_label: "req(exo): behavior ${spec.uid}"`,
    `${statusKey}: "[[s|req__RequirementStatus${spec.status ?? "Active"}]]"`,
    `req__Requirement_priority: "[[p|req__RequirementPriorityP1]]"`,
    "req__Requirement_bindingClass:",
    `  - "[[b|req__RequirementBindingClassIntegration]]"`,
    "---",
    "",
    "## Statement (Gherkin)",
    "",
  ];
  writeFileSync(join(dir, `${spec.uid}.md`), lines.join("\n"), "utf-8");
}

describe("active-gate input integrity — the corpus must actually arrive", () => {
  let root: string;
  let reqDir: string;

  beforeEach(() => {
    root = join(tmpdir(), `req-audit-integrity-${Date.now()}-${Math.random()}`);
    reqDir = join(root, "exoas-exo-reqs", "exo-reqs");
    mkdirSync(reqDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f an EMPTY corpus is a broken input, and the blocking gate refuses it", async () => {
    // Scenario 1 — nothing on disk carries the detection predicate.
    const report = auditTraceability(await loadRequirements(root), []);
    expect(report.requirementCount).toBe(0);
    expect(report.activeTotal).toBe(0);
    expect(report.activeViolations).toHaveLength(0); // vacuous — the whole point
    expect(report.inputIntegrityViolation).not.toBeNull();

    // Axis (b): the SHIPPED blocking step must act on it.
    const gate = runBlockingGate(report);
    expect(gate.code).toBe(1);
    expect(gate.stderr).toContain("INPUT integrity failure");
    expect(gate.stdout).not.toContain("Active-gate OK");
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f the refusal names a broken INPUT and both of its roots, never an absence of findings", async () => {
    // Scenario 2 — wording is production-owned, so it is assertable.
    const report = auditTraceability(await loadRequirements(root), []);
    const reason = report.inputIntegrityViolation ?? "";
    expect(reason).toMatch(/INPUT is broken, not clean/);
    expect(reason).toMatch(/EMPTY/); // root #1: the corpus is empty
    expect(reason).toMatch(/req__Requirement_status/); // root #2: predicate not found
    // Negate the COMPETING shipped wording, not a phrase nobody would write:
    // the OK line this refusal replaces starts with "✅ Active-gate OK".
    expect(reason).not.toMatch(/^\s*(OK|clean)\b/i);
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f the gate payload stays single-quote-safe — an apostrophe would break the shell in production", () => {
    // The workflow embeds this script as `node -e '<js>'` under `bash -e`, so a
    // lone apostrophe anywhere in it (easiest to introduce via a message edit —
    // "gate's input") terminates the string and breaks CI. Locked here because
    // the failure is in the SHELL layer, not in any behaviour the other axes see.
    expect(extractGateScript()).not.toContain("'");
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f a report predating the floor fails CLOSED, not open", () => {
    // A report with no `inputIntegrityViolation` field means the floor was never
    // evaluated. Treating that as "no violation" would silently restore exactly
    // the pre-floor behaviour this requirement removes.
    const gate = runBlockingGate({ activeTotal: 0, activeViolations: [] });
    expect(gate.code).toBe(1);
    expect(gate.stderr).toMatch(/predates the population floor/);
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f a RENAMED status predicate empties the corpus — the very failure the floor exists for", async () => {
    // Scenario 2 (the migration hazard) — the asset is still a requirement by
    // class, but detection keys off the PREDICATE, so the corpus reads as 0.
    writeRequirement(reqDir, {
      uid: UID_ACTIVE,
      status: "Active",
      statusKey: "flow__Requirement_state",
    });
    const report = auditTraceability(await loadRequirements(root), []);
    expect(report.requirementCount).toBe(0);
    expect(report.inputIntegrityViolation).not.toBeNull();
    expect(runBlockingGate(report).code).toBe(1);
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f a live corpus passes byte-identically — the gate still prints its OK line and exits 0", async () => {
    // Scenario 3 — the no-regression control.
    writeRequirement(reqDir, { uid: UID_ACTIVE, status: "Active" });
    const report = auditTraceability(await loadRequirements(root), [
      { uid: UID_ACTIVE, file: "a.test.ts", line: 1 },
    ]);
    expect(report.activeTotal).toBe(1);
    expect(report.activeViolations).toHaveLength(0);
    expect(report.inputIntegrityViolation).toBeNull();

    const gate = runBlockingGate(report);
    expect(gate.code).toBe(0);
    expect(gate.stdout).toContain(
      "✅ Active-gate OK — 1 active requirement(s)",
    );
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f changing exo__Instance_class is a no-op — the predicate stays the only detection key", async () => {
    // Scenario 4 — the RFC's migration invariant, asserted by execution.
    writeRequirement(reqDir, {
      uid: UID_ACTIVE,
      status: "Active",
      instanceClassUid: "11111111-1111-4111-8111-111111111111", // a different class
    });
    const report = auditTraceability(await loadRequirements(root), [
      { uid: UID_ACTIVE, file: "a.test.ts", line: 1 },
    ]);
    expect(report.requirementCount).toBe(1);
    expect(report.activeTotal).toBe(1);
    expect(report.inputIntegrityViolation).toBeNull();
    expect(runBlockingGate(report).code).toBe(0);
  });

  it("@req:99e06488-2da6-48fe-bd64-30c1e20bca0f a loaded-but-nothing-active corpus is refused with its OWN reason", async () => {
    // The second sub-case: the corpus arrived, but the gate has nothing to
    // enforce — reported distinctly so the diagnosis is not guesswork.
    writeRequirement(reqDir, { uid: UID_ACTIVE, status: "Proposed" });
    writeRequirement(reqDir, { uid: UID_SECOND, status: "Deprecated" });
    const report = auditTraceability(await loadRequirements(root), []);
    expect(report.requirementCount).toBe(2);
    expect(report.activeTotal).toBe(0);
    const reason = report.inputIntegrityViolation ?? "";
    expect(reason).toMatch(/loaded 2 requirement\(s\)/);
    expect(reason).toMatch(/INPUT is broken, not clean/);
    expect(runBlockingGate(report).code).toBe(1);
  });

  it("does not touch the pre-existing hard findings — an unbound active req still fails on ITS own reason", async () => {
    // Negative control for the `clean` / exit-code Non-goal: the floor must not
    // absorb or mask the invariant it sits next to.
    writeRequirement(reqDir, { uid: UID_ACTIVE, status: "Active" });
    const report = auditTraceability(await loadRequirements(root), []); // no @req tag
    expect(report.inputIntegrityViolation).toBeNull(); // 1 active → floor satisfied
    expect(report.activeViolations).toHaveLength(1);
    expect(report.clean).toBe(false);

    const gate = runBlockingGate(report);
    expect(gate.code).toBe(1);
    expect(gate.stderr).toContain("Active-requirement invariant violated");
    expect(gate.stderr).not.toContain("INPUT integrity failure");
  });
});
