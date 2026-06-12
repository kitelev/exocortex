/**
 * Issue #3488 — false-positive SHACL violations from IRI-representation artifacts.
 *
 * End-to-end through `runShapesModeAction` (the JSON output path that surfaces
 * the warning counters), against real on-disk vault fixtures that mirror the
 * 2026-06-12 vault-2025 baseline mechanisms:
 *
 *   M1 — an `exo__Asset_relates` to a target that carries no resolvable type in
 *        this vault (cross-vault / dangling) → reported as a WARNING, not a
 *        violation; exit code stays 0; a dedicated `crossVaultRefWarnings`
 *        counter is surfaced.
 *
 *   M2 — a UUID-named `exo__Setting` asset that DOES carry `exo__Setting_key`
 *        must produce ZERO `sh:minCount` violations (no phantom on the synthetic
 *        `uid:<uuid>` join-key).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { runShapesModeAction } = await import(
  "../../src/commands/validate-schema.js"
);

interface JsonResponse {
  status: string;
  data: {
    vaultPath: string;
    conforms: boolean;
    violationCount: number;
    warningCount: number;
    crossVaultRefWarnings: number;
    violations: Array<{ focusNode: string; severity: string; constraint: string }>;
    warnings: Array<{ focusNode: string; severity: string; constraint: string; actualValue?: string }>;
  };
}

function lastJson(logSpy: jest.SpiedFunction<typeof console.log>): JsonResponse {
  const calls = logSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const arg = calls[i][0];
    if (typeof arg === "string" && arg.trim().startsWith("{")) {
      return JSON.parse(arg) as JsonResponse;
    }
  }
  throw new Error("no JSON line logged");
}

/** Declares `exo__Asset_relates` as an ObjectProperty (domain/range exo__Asset). */
function writeAssetRelatesShape(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });
  fs.writeFileSync(
    path.join(shapesDir, "exo__Asset_relates.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000aaaa-0000-0000-0000-00000000a001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: exo__Asset_relates
exo__Property_domain:
  - "[[exo__Asset]]"
exo__Property_range:
  - "[[exo__Asset]]"
exo__Property_severity: sh:Violation
aliases:
  - exo__Asset_relates
---
Test shape: exo__Asset_relates → exo__Asset.
`,
  );
}

/** Declares `exo__Setting_key` as a required (minCount 1) property of exo__Setting. */
function writeSettingKeyShape(vaultDir: string): void {
  const shapesDir = path.join(vaultDir, "shapes");
  fs.mkdirSync(shapesDir, { recursive: true });
  fs.writeFileSync(
    path.join(shapesDir, "exo__Setting_key.md"),
    `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: 0000aaaa-0000-0000-0000-00000000b001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: exo__Setting_key
exo__Property_domain:
  - "[[exo__Setting]]"
exo__Property_minCount: "1"
exo__Property_range: "http://www.w3.org/2001/XMLSchema#string"
exo__Property_severity: sh:Violation
aliases:
  - exo__Setting_key
---
Test shape: exo__Setting_key is required on exo__Setting.
`,
  );
}

describe("Issue #3488: validate schema --shapes-mode — IRI-representation false positives", () => {
  let tmpDir: string;
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shacl-3488-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it("M1: exo__Asset_relates to an unresolvable (cross-vault/dangling) target → warning, exit 0, counter", async () => {
    writeAssetRelatesShape(tmpDir);
    const dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    // Subject is typed exo__Asset and relates to a UUID that exists in no file
    // in this vault → its type cannot be resolved → unresolvable reference.
    fs.writeFileSync(
      path.join(dataDir, "source.md"),
      `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: 11110000-0000-4000-8000-000000000001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Asset]]"
exo__Asset_label: Source
exo__Asset_relates:
  - "[[99999999-9999-4999-8999-999999999999]]"
---
Source relates to an absent (cross-vault) target.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    expect(json.data.violationCount).toBe(0);
    expect(json.data.conforms).toBe(true);
    expect(process.exitCode).toBeUndefined(); // warnings do not break exit code
    expect(json.data.warningCount).toBeGreaterThanOrEqual(1);
    expect(json.data.crossVaultRefWarnings).toBeGreaterThanOrEqual(1);
    const warn = json.data.warnings.find((w) =>
      (w.actualValue ?? "").includes("99999999-9999-4999-8999-999999999999"),
    );
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe("sh:Warning");
    expect(warn!.constraint).toBe("class");
  });

  it("M2: UUID-named exo__Setting asset WITH Setting_key → 0 minCount violations (no uid: phantom)", async () => {
    writeSettingKeyShape(tmpDir);
    const settingsDir = path.join(tmpDir, "exocortex-settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    const uid = "2a348086-8be4-442e-946e-84f1abe7f612";
    // The file is UUID-named → its subject IRI ends with <uuid>.md, which makes
    // the validator synthesize a `uid:<uuid>` join-key. That synthetic key must
    // NOT be iterated as a focus node (else a phantom Setting_key minCount).
    fs.writeFileSync(
      path.join(settingsDir, `${uid}.md`),
      `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Setting]]"
exo__Asset_label: a.setting
exo__Setting_key: "some.app.setting"
exo__Setting_value: "42"
---
A valid setting with its key present.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    expect(json.data.violationCount).toBe(0);
    expect(json.data.conforms).toBe(true);
    expect(process.exitCode).toBeUndefined();
    // explicitly: no result (error OR warning) may be focused on a uid: key
    const allResults = [...json.data.violations, ...json.data.warnings];
    expect(allResults.some((r) => r.focusNode.startsWith("uid:"))).toBe(false);
  });

  it("M2-regression: a genuinely missing Setting_key still violates (on the real subject, not uid: key)", async () => {
    writeSettingKeyShape(tmpDir);
    const settingsDir = path.join(tmpDir, "exocortex-settings");
    fs.mkdirSync(settingsDir, { recursive: true });
    const uid = "3b459197-9cf5-553f-a57f-95f2bcf8f723";
    fs.writeFileSync(
      path.join(settingsDir, `${uid}.md`),
      `---
exo__Asset_isDefinedBy: "[[!exo]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Setting]]"
exo__Asset_label: b.setting
exo__Setting_value: "no key here"
---
A setting that is genuinely missing its required key.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    expect(json.data.violationCount).toBe(1);
    expect(json.data.conforms).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(json.data.violations[0].focusNode).toContain(uid);
    expect(json.data.violations[0].focusNode.startsWith("uid:")).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // M3 / M4 — class conformance is invariant to wikilink form (Issue #3488 AC#3).
  //
  // These are characterization tests: they pass on both pre- and post-fix code
  // (Fix 1/2 are M1/M2). Their purpose is to pin AC#3/#4 — that the engine
  // already resolves class conformance / isSubClassOf identically whether a
  // class wikilink is bare `[[<uid>]]` or alias `[[<uid>|prefix__Local]]`, and
  // across a multi-hop superClass chain whose edges use the bare-uid form.
  // The baseline 99 did not contain these (they were resolved in the vault
  // data); these tests guard against re-introducing the form-dependence.
  // ───────────────────────────────────────────────────────────────────────────

  /** A property whose domain is `period__DayOfMonth` (so the shape only applies if the class resolved). */
  function writeDayOfMonthShape(vaultDir: string): void {
    const shapesDir = path.join(vaultDir, "shapes");
    fs.mkdirSync(shapesDir, { recursive: true });
    fs.writeFileSync(
      path.join(shapesDir, "period__DayOfMonth_label.md"),
      `---
exo__Asset_isDefinedBy: "[[!period]]"
exo__Asset_uid: 0000aaaa-0000-0000-0000-00000000c001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Property]]"
exo__Asset_label: period__DayOfMonth_label
exo__Property_domain:
  - "[[period__DayOfMonth]]"
exo__Property_minCount: "1"
exo__Property_range: "http://www.w3.org/2001/XMLSchema#string"
exo__Property_severity: sh:Violation
aliases:
  - period__DayOfMonth_label
---
Required label on period__DayOfMonth.
`,
    );
  }

  it("M3: exo__Instance_class is alias-form invariant — bare [[<uid>]] and [[<uid>|label]] give identical conformance", async () => {
    writeDayOfMonthShape(tmpDir);
    const classDir = path.join(tmpDir, "classes");
    fs.mkdirSync(classDir, { recursive: true });
    const classUid = "d998c82b-aaaa-4eee-9eee-96e101155228";
    // Class definition file; its label parses as period__DayOfMonth.
    fs.writeFileSync(
      path.join(classDir, `${classUid}.md`),
      `---
exo__Asset_isDefinedBy: "[[!period]]"
exo__Asset_uid: ${classUid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Class]]"
exo__Asset_label: period__DayOfMonth
---
The period__DayOfMonth class.
`,
    );
    const dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    // Asset BARE: class via [[<uid>]] (no alias). Asset ALIAS: [[<uid>|period__DayOfMonth]].
    // Both carry the required label → both must conform identically.
    for (const [name, classRef] of [
      ["bare.md", `[[${classUid}]]`],
      ["alias.md", `[[${classUid}|period__DayOfMonth]]`],
    ] as const) {
      fs.writeFileSync(
        path.join(dataDir, name),
        `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: 1111${name === "bare.md" ? "0000" : "1111"}-0000-4000-8000-00000000000${name === "bare.md" ? "1" : "2"}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "${classRef}"
period__DayOfMonth_label: "the nineteenth"
---
Day-of-month instance (${name}).
`,
      );
    }

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    // Both assets carry the required label → no minCount violation for either,
    // regardless of bare vs alias wikilink form. Form-invariant conformance.
    expect(json.data.conforms).toBe(true);
    expect(json.data.violationCount).toBe(0);
  });

  it("M4: ClassHierarchy resolves a 2-hop subclass chain whose superClass edges use bare [[<uid>]]", async () => {
    const classDir = path.join(tmpDir, "classes");
    fs.mkdirSync(classDir, { recursive: true });
    const topUid = "aaaa0000-0000-4000-8000-0000000000a0"; // ems__Agent
    const midUid = "bbbb0000-0000-4000-8000-0000000000b0"; // ims__Person
    const leafUid = "cccc0000-0000-4000-8000-0000000000c0"; // ims__Chapter
    const mk = (uid: string, label: string, superUid?: string) =>
      fs.writeFileSync(
        path.join(classDir, `${uid}.md`),
        `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: ${uid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Class]]"
exo__Asset_label: ${label}
${superUid ? `exo__Class_superClass: "[[${superUid}]]"\n` : ""}---
Class ${label}.
`,
      );
    mk(topUid, "ems__Agent");
    mk(midUid, "ims__Person", topUid); // ims__Person ⊑ ems__Agent (bare-uid edge)
    mk(leafUid, "ims__Chapter", midUid); // ims__Chapter ⊑ ims__Person (bare-uid edge)

    // Property whose RANGE is the top of the chain (ems__Agent). A value typed
    // by the LEAF class must satisfy it via the 2-hop bare-uid superClass walk.
    const shapesDir = path.join(tmpDir, "shapes");
    fs.mkdirSync(shapesDir, { recursive: true });
    fs.writeFileSync(
      path.join(shapesDir, "ems__Area_responsible.md"),
      `---
exo__Asset_isDefinedBy: "[[!ems]]"
exo__Asset_uid: 0000aaaa-0000-0000-0000-00000000d001
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__ObjectProperty]]"
exo__Asset_label: ems__Area_responsible
exo__Property_domain:
  - "[[exo__Asset]]"
exo__Property_range:
  - "[[${topUid}]]"
exo__Property_severity: sh:Violation
aliases:
  - ems__Area_responsible
---
Responsible must be an ems__Agent (the chain top).
`,
    );

    const dataDir = path.join(tmpDir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const targetUid = "dddd0000-0000-4000-8000-0000000000d0";
    // Target is typed by the LEAF class (bare-uid).
    fs.writeFileSync(
      path.join(dataDir, `${targetUid}.md`),
      `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: ${targetUid}
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[${leafUid}]]"
exo__Asset_label: A chapter member
---
A leaf-typed asset.
`,
    );
    fs.writeFileSync(
      path.join(dataDir, "source.md"),
      `---
exo__Asset_isDefinedBy: "[[!test]]"
exo__Asset_uid: eeee0000-0000-4000-8000-0000000000e0
exo__Asset_createdAt: 2025-01-01T00:00:00
exo__Instance_class:
  - "[[exo__Asset]]"
exo__Asset_label: Source
ems__Area_responsible:
  - "[[${targetUid}]]"
---
Source's responsible is a leaf-typed, in-vault agent.
`,
    );

    await runShapesModeAction({ vault: tmpDir, format: "json" });
    const json = lastJson(logSpy);

    // The target IS typed (leaf class) and IS in-vault; its class (ims__Chapter)
    // satisfies range ems__Agent via the 2-hop bare-uid superClass chain →
    // conforms, no warning, no violation. (If the chain broke, ims__Chapter is a
    // resolvable class that ⊄ ems__Agent → a genuine sh:Violation, not a warning.)
    expect(json.data.conforms).toBe(true);
    expect(json.data.violationCount).toBe(0);
    const refResult = [...json.data.violations, ...json.data.warnings].find((r) =>
      (r.actualValue ?? "").includes(targetUid),
    );
    expect(refResult).toBeUndefined();
  });
});
