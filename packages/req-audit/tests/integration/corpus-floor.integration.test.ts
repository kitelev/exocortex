import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  loadCorpus,
  auditTraceability,
  DECLARED_REQS_ASSETSPACES,
} from "../../src/audit.js";
import { readWorkflow, runBlockingGate } from "../helpers/blocking-gate.js";

/**
 * Per-assetspace corpus floor for the always-on active-gate — req
 * `bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a` (issue #4066).
 *
 * The `99e06488` floor closed the TOTAL loss (`activeTotal === 0`). The PARTIAL
 * loss stayed silent and is the likelier one: measured on the head of PR #4065
 * against the real clones, a corpus with `exoas-ems-reqs` missing entirely
 * yielded 163 requirements / 154 active / `inputIntegrityViolation: null` →
 * `BLOCKING GATE EXIT: 0` with "✅ Active-gate OK — 154 active requirement(s),
 * all bound." Nine requirements — a whole module — left the gate's scope
 * without a single signal, because `git clone` of an emptied or renamed repo
 * exits 0 and the surviving assetspaces still produce a plausible count.
 *
 * Two independent axes are bound here, per the revert-verify discipline:
 *   (a) the AUDIT reports the broken input (`inputIntegrityViolation`);
 *   (b) the real blocking step in `.github/workflows/ci.yml` ACTS on it —
 *       driven from the workflow's own `node -e` body, never a hand-kept copy.
 */

const REQ_CLASS_UID = "8c5af681-3413-4219-8636-0ac229d1b253";
const UID_EXO = "6f2a4b1e-1c3d-4a5b-9e7f-2b8c1d0a3e45";
const UID_EMS = "b1c2d3e4-5f60-4718-9a2b-3c4d5e6f7081";

const EXO_AS = "exoas-exo-reqs";
const EMS_AS = "exoas-ems-reqs";
/** The two assetspaces the production corpus is declared to consist of. */
const DECLARED = [EXO_AS, EMS_AS];

function writeRequirement(
  dir: string,
  uid: string,
  status: "Active" | "Proposed" = "Active",
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${uid}.md`),
    [
      "---",
      `exo__Asset_uid: ${uid}`,
      `exo__Asset_isDefinedBy: "[[anchor]]"`,
      "exo__Instance_class:",
      `  - "[[${REQ_CLASS_UID}|req__Requirement]]"`,
      `exo__Asset_label: "req: behavior ${uid}"`,
      `req__Requirement_status: "[[s|req__RequirementStatus${status}]]"`,
      `req__Requirement_priority: "[[p|req__RequirementPriorityP1]]"`,
      "req__Requirement_bindingClass:",
      `  - "[[b|req__RequirementBindingClassIntegration]]"`,
      "---",
      "",
    ].join("\n"),
    "utf-8",
  );
}

/** Audit a corpus root the way `runAudit` does — corpus scan + declared floor. */
async function auditCorpus(
  root: string,
  expected: readonly string[] = DECLARED,
) {
  const corpus = await loadCorpus(root);
  return auditTraceability(
    corpus.requirements,
    corpus.requirements.map((r) => ({
      uid: r.uid,
      file: "a.test.ts",
      line: 1,
    })),
    { expectedAssetspaces: expected, droppedAssets: corpus.dropped },
  );
}

describe("corpus floor — every declared assetspace must actually contribute", () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `req-corpus-floor-${Date.now()}-${Math.random()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a a declared assetspace that contributed NOTHING is a broken input, and the blocking gate refuses it", async () => {
    // The measured scenario: exoas-exo-reqs arrived, exoas-ems-reqs did not —
    // its directory is absent entirely (an emptied/renamed clone), so there is
    // nothing on disk to enumerate. The surviving assetspace still yields a
    // plausible, fully-bound active population.
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);

    const report = await auditCorpus(root);
    expect(report.activeTotal).toBe(1); // NOT zero — the 99e06488 floor is satisfied
    expect(report.activeViolations).toHaveLength(0); // and nothing looks wrong
    expect(report.inputIntegrityViolation).not.toBeNull();

    // Axis (b): the SHIPPED blocking step must act on it.
    const gate = runBlockingGate(report);
    expect(gate.code).toBe(1);
    expect(gate.stderr).toContain("INPUT integrity failure");
    expect(gate.stdout).not.toContain("Active-gate OK");
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a the refusal names the offending assetspace and both of its roots", async () => {
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);

    const reason = (await auditCorpus(root)).inputIntegrityViolation ?? "";
    expect(reason).toContain(EMS_AS); // named, so the diagnosis is not guesswork
    expect(reason).not.toContain(EXO_AS); // the one that DID arrive is not blamed
    expect(reason).toMatch(/clone never arrived/); // root #1
    expect(reason).toMatch(/req__Requirement_status/); // root #2
    expect(reason).toMatch(/INPUT is broken, not clean/);
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a a complete corpus passes byte-identically — the gate still prints its OK line and exits 0", async () => {
    // The no-regression control: both declared assetspaces contribute.
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);
    writeRequirement(join(root, EMS_AS, "ems-reqs"), UID_EMS);

    const report = await auditCorpus(root);
    expect(report.requirementCount).toBe(2);
    expect(report.activeTotal).toBe(2);
    expect(report.inputIntegrityViolation).toBeNull();

    const gate = runBlockingGate(report);
    expect(gate.code).toBe(0);
    expect(gate.stdout).toContain(
      "✅ Active-gate OK — 2 active requirement(s)",
    );
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a an UNDECLARED empty directory does not trip the floor — only declared members are required to contribute", async () => {
    // Negative control: the floor is keyed on the DECLARED set, not on whatever
    // happens to sit under --reqs, so a stray/vendored directory is inert.
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);
    writeRequirement(join(root, EMS_AS, "ems-reqs"), UID_EMS);
    mkdirSync(join(root, "some-scratch-dir"), { recursive: true });
    writeFileSync(
      join(root, "some-scratch-dir", "notes.md"),
      "# just a note\n",
      "utf-8",
    );

    const report = await auditCorpus(root);
    expect(report.inputIntegrityViolation).toBeNull();
    expect(runBlockingGate(report).code).toBe(0);
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a an asset whose frontmatter does not parse is reported as DROPPED, not silently skipped", async () => {
    // The second road to the same silence: `catch { continue; }` +
    // `extractFrontmatter → {}` made a corrupt requirement indistinguishable
    // from one that never existed.
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);
    writeRequirement(join(root, EMS_AS, "ems-reqs"), UID_EMS);
    writeFileSync(
      join(root, EMS_AS, "ems-reqs", "corrupt.md"),
      '---\nexo__Asset_uid: "unterminated\nreq__Requirement_status: x\n---\n',
      "utf-8",
    );

    const corpus = await loadCorpus(root);
    expect(corpus.dropped).toHaveLength(1);
    expect(corpus.dropped[0].path).toContain("corrupt.md");

    const report = await auditCorpus(root);
    expect(report.droppedAssets).toHaveLength(1);
    const reason = report.inputIntegrityViolation ?? "";
    expect(reason).toContain("corrupt.md");
    expect(reason).toMatch(/BROKEN, not absent/);
    expect(runBlockingGate(report).code).toBe(1);
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a a plain markdown document without frontmatter is NOT a drop", async () => {
    // Negative control for the drop axis: a README next to the assets is an
    // ordinary document, not a broken requirement.
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);
    writeRequirement(join(root, EMS_AS, "ems-reqs"), UID_EMS);
    writeFileSync(
      join(root, EXO_AS, "README.md"),
      "# reqs\n\nprose\n",
      "utf-8",
    );

    const corpus = await loadCorpus(root);
    expect(corpus.dropped).toHaveLength(0);
    expect((await auditCorpus(root)).inputIntegrityViolation).toBeNull();
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a the report carries the INPUT size per assetspace, including a declared one that contributed zero", async () => {
    // "0 violations" must never be readable without knowing what was scanned.
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EXO);
    writeRequirement(join(root, EXO_AS, "exo-reqs"), UID_EMS, "Proposed");

    const report = await auditCorpus(root);
    const byName = Object.fromEntries(
      report.corpusByAssetspace.map((c) => [c.assetspace, c]),
    );
    expect(byName[EXO_AS]).toMatchObject({
      requirements: 2,
      active: 1,
      declared: true,
    });
    expect(byName[EMS_AS]).toMatchObject({
      requirements: 0,
      active: 0,
      declared: true,
    });
  });

  it("@req:bba7bd2b-de7a-4043-bfb8-df56bd3d2a0a the declared set matches what CI actually clones — the two carriers cannot drift apart silently", () => {
    // The floor's population is DECLARED in code; the clone destinations live
    // in the workflow. Neither can be derived from the other, so the agreement
    // is pinned here — a clone line added/removed without updating the constant
    // (or vice versa) reds this test.
    const cloned = [
      ...readWorkflow().matchAll(/"\$RUNNER_TEMP\/reqs\/([\w.-]+)"/g),
    ].map((m) => m[1]);
    expect(cloned.length).toBeGreaterThan(0); // canary: the step is still there
    expect([...cloned].sort()).toEqual([...DECLARED_REQS_ASSETSPACES].sort());
  });
});
